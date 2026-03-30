const mongoose = require('mongoose');

const connect = async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/eduai';
  try {
    await mongoose.connect(uri);
    console.log(`[DB] Connected to MongoDB: ${uri.split('@').pop()}`);
  } catch (err) {
    console.error('[DB] Connection failed:', err.message);
    process.exit(1);
  }
};

mongoose.connection.on('disconnected', () => {
  console.warn('[DB] Disconnected — attempting reconnect…');
});

module.exports = { connect };
