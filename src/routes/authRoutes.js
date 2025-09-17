import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { users } from "../data/users.js";

const router = Router();

// --- Config ---
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
if (!process.env.JWT_SECRET) {
  console.warn("[auth] JWT_SECRET not set; using insecure dev secret");
}
const JWT_EXPIRES_IN = "1h";

// --- Helpers ---
function signToken(user) {
  // Keep payload small; sub = subject (user id)
  return jwt.sign(
    { sub: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function bearer(tokenHeader) {
  if (!tokenHeader) return null;
  const [scheme, token] = tokenHeader.split(" ");
  return scheme?.toLowerCase() === "bearer" ? token : null;
}

// --- Middleware to protect routes ---
function requireAuth(req, res, next) {
  try {
    const token = bearer(req.headers.authorization);
    if (!token) return res.status(401).json({ error: "Missing bearer token" });

    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { sub, username, iat, exp }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * POST /api/auth/login
 * Body: { "username": "janph", "password": "1234" }
 * Success: { token, user: { id, username } }
 */
// ...top of file unchanged...

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body ?? {};
    console.log("[auth] body =", req.body);               // ← 1

    if (!username || !password) {
      return res.status(400).json({ error: "username and password are required" });
    }

    const user = users.find(u => u.username === username);
    console.log("[auth] user found?", !!user, "name:", user?.username);  // ← 2
    if (!user) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    console.log("[auth] bcrypt ok?", ok);                  // ← 3
    if (!ok) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const token = signToken(user);
    return res.json({
      message: "Login successful",
      token,
      user: { id: user.id, username: user.username },
    });
  } catch (err) {
    console.error("[auth] login error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
});
/**
 * GET /api/auth/me
 * Header: Authorization: Bearer <token>
 * Success: { id, username }
 */
router.get("/me", requireAuth, (req, res) => {
  // req.user was set by requireAuth (contains sub & username)
  return res.json({ id: req.user.sub, username: req.user.username });
});

export default router;
