import express from "express";
import { fork } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// POST /api/cpu/burn?seconds=300
router.post("/burn", (req, res) => {
  const seconds = Number(req.query.seconds || 60);

  const scriptPath = path.join(__dirname, "..", "scripts", "cpuBurner.js");
  const child = fork(scriptPath, [String(seconds)], {
    stdio: "inherit" // so you can see logs in the container/terminal
  });

  // Respond immediately; CPU load continues in background
  res.status(202).json({
    message: "CPU load started",
    seconds,
    pid: child.pid
  });

  child.on("exit", (code) => {
    console.log(`[cpu] burner (pid ${child.pid}) finished with code ${code}`);
  });
});

export default router;
