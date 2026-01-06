// payment-Backend/routes/uploadRoutes.js
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const router = express.Router();

// Ensure uploads/docs exists
const DOCS_DIR = path.join(__dirname, "..", "uploads", "docs");
fs.mkdirSync(DOCS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DOCS_DIR),
  filename: (req, file, cb) => {
    // keep it unique but readable
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/\s+/g, "_");
    cb(null, `${Date.now()}_${base}${ext}`);
  },
});
const upload = multer({ storage });

// POST /api/uploads/docs
router.post("/docs", upload.array("documents", 10), (req, res) => {
  const files = (req.files || []).map((f) => ({
    // public URL your React app can open directly
    url: `/uploads/docs/${f.filename}`,
    filename: f.originalname,
    storedName: f.filename,
    mimetype: f.mimetype,
    size: f.size,
  }));

  return res.json({ files });
});

module.exports = router;
