// middleware/errorHandler.js
const errorHandler = (err, req, res, next) => {
  console.error('❌ Sunucu hatası:', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Sunucu hatası',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};
module.exports = { errorHandler };
