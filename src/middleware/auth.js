// middleware/auth.js
// API_AUTH_TOKEN kontrolü kaldırıldı — endpoint herkese açık
const authMiddleware = (req, res, next) => {
  next();
};
module.exports = { authMiddleware };
