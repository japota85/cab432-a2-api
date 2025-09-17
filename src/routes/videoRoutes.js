import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuid } from "uuid";
import { requireAuth } from "../middleware/requireAuth.js";
import pool from "../config/db.js";
import { exec } from "child_process";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { s3Client } from "../config/s3Client.js";
import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";



const router = express.Router();

const BUCKET_NAME = process.env.S3_BUCKET;

// ---- ensure ./uploads/raw exists ----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAW_DIR = path.join(__dirname, "..", "..", "uploads", "raw");
fs.mkdirSync(RAW_DIR, { recursive: true });

const OUT_DIR = path.join(__dirname, "..", "..", "uploads", "processed");
fs.mkdirSync(OUT_DIR, { recursive: true });

// ---- Multer config ----
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, RAW_DIR),
  filename: (_req, file, cb) => {
    const id = uuid();
    const ext = path.extname(file.originalname || "");
    cb(null, `${id}${ext || ".mp4"}`);
  },
});

const fileFilter = (_req, file, cb) => {
  const ok = /^video\//.test(file.mimetype);
  cb(ok ? null : new Error("Only video files are allowed"), ok);
};

const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 200);
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
});

// ---- Routes ----

// POST /api/videos/upload  (protected)
router.post("/upload", requireAuth, upload.single("video"), async (req, res) => {
  try {
    const file = req.file;
    const rawKey = `raw/${file.originalname}`;
    const processedKey = `processed/${file.originalname}`;

    // 1. Upload original to S3
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: rawKey,
      Body: fs.createReadStream(file.path),
      ContentType: file.mimetype
    }));

    // 2. Process with ffmpeg
    const processedPath = path.join(OUT_DIR, file.originalname);
    await new Promise((resolve, reject) => {
      const cmd = `ffmpeg -i "${file.path}" -vf scale=640:-1 -c:v libx264 -preset fast -crf 28 -c:a aac "${processedPath}" -y`;
      exec(cmd, (error, stdout, stderr) => {
        if (error) return reject(error);
        resolve();
      });
    });

    // 3. Upload processed to S3
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: processedKey,
      Body: fs.createReadStream(processedPath),
      ContentType: "video/mp4"
    }));

    // 4. Clean up local
    try { fs.unlinkSync(file.path); } catch (_) {}
    try { fs.unlinkSync(processedPath); } catch (_) {}

    // 5. Save metadata in RDS
    const { rows } = await pool.query(
      `INSERT INTO videos (id, s3_key, original_name, mime, size, owner_sub)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        uuid(),                  // id
        processedKey,            // use processed file
        file.originalname,       // original_name
        "video/mp4",             // mime
        file.size,               // size in bytes
        req.user?.sub || null    // Cognito subject
      ]
    );

    // 6. Respond
    res.json({
      message: "Upload & processing successful!",
      video: rows[0]
    });

  } catch (err) {
    console.error("[videos] upload error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

// GET /videos - List all videos from RDS
router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, s3_key, original_name, mime, size, uploaded_at FROM videos ORDER BY uploaded_at DESC"
    );

    res.json(rows);
  } catch (err) {
    console.error("[videos] list error:", err);
    res.status(500).json({ error: "Failed to list videos" });
  }
});

// GET /api/videos/:key - Generate a pre-signed URL for download
router.get(/^\/raw\/(.+)$/, async (req, res) => {
  const key = req.params[0]; // capture group from regex
  console.log("Download request for key:", key);

  try {
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: `raw/${key}`
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    res.json({ downloadUrl: url });
  } catch (err) {
    console.error("Download error:", err);
    res.status(500).json({ error: "Failed to generate download URL" });
  }
});

// GET /videos/:id/stream - Get presigned S3 URL for playback
router.get("/:id/stream", async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Look up in RDS
    const { rows } = await pool.query("SELECT s3_key FROM videos WHERE id = $1", [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Video not found" });
    }

    const s3Key = rows[0].s3_key;

    // 2. Generate presigned URL
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: s3Key,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1 hour

    // 3. Send back the presigned URL
    res.json({ url });
  } catch (err) {
    console.error("[videos] stream error:", err);
    res.status(500).json({ error: "Failed to generate stream URL" });
  }
});

// Save a record
router.post("/save", async (req, res) => {
  try {
    const { filename, user_id } = req.body;
    const result = await pool.query(
      "INSERT INTO videos (filename, user_id) VALUES ($1, $2) RETURNING *",
      [filename, user_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database insert failed" });
  }
});

// DELETE /api/videos/:id  (protected)
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Look up the video in RDS
    const { rows } = await pool.query(
      "SELECT s3_key FROM videos WHERE id = $1",
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Video not found" });
    }
    const s3Key = rows[0].s3_key;

    // 2. Delete from S3
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: s3Key,
      })
    );

    // 3. Delete from RDS
    await pool.query("DELETE FROM videos WHERE id = $1", [id]);

    res.json({ message: `Video ${id} deleted successfully` });
  } catch (err) {
    console.error("[videos] delete error:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

export default router;
