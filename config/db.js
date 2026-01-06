// config/db.js  (COMMONJS VERSION)
const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('❌ MONGO_URI missing in .env');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      retryWrites: true,
    });
    console.log('✅ DB Connected');
  } catch (err) {
    // Do NOT crash the process; log and keep server running
    console.error('❌ DB connect failed:', err.message);
  }
}

module.exports = { connectDB };
