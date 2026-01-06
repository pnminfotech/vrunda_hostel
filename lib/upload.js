const path = require('path');
const multer = require('multer');
const fs = require('fs');

function ensure(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

// docs
const docsDir = path.join(__dirname, '..', 'uploads', 'docs');
ensure(docsDir);
const docsStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, docsDir),
  filename   : (_req, file, cb) => {
    const ts = Date.now();
    const safe = file.originalname.replace(/\s+/g,'_');
    cb(null, `${ts}_${safe}`);
  }
});
const docsUpload = multer({ storage: docsStorage });

// avatars
const avatarDir = path.join(__dirname, '..', 'uploads', 'avatars');
ensure(avatarDir);
const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, avatarDir),
  filename   : (_req, file, cb) => {
    const ts = Date.now();
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${ts}${ext}`);
  }
});
const avatarUpload = multer({ storage: avatarStorage });

// eKYC
const ekycDir = path.join(__dirname, '..', 'uploads', 'ekyc');
ensure(ekycDir);
const ekycStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, ekycDir),
  filename   : (_req, file, cb) => {
    const ts = Date.now();
    const safe = file.originalname.replace(/\s+/g,'_');
    cb(null, `${ts}_${safe}`);
  }
});
const ekycUpload = multer({ storage: ekycStorage });

module.exports = { docsUpload, avatarUpload, ekycUpload };
