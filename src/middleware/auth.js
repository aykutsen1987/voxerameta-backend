// middleware/auth.js
const authMiddleware = (req, res, next) => {
  const token = req.headers['x-auth-token'] || req.headers['authorization']?.replace('Bearer ', '');
  if (process.env.NODE_ENV === 'production' && !token) {
    return res.status(401).json({ error: 'X-Auth-Token header gerekli' });
  }
  if (token && process.env.API_AUTH_TOKEN && token !== process.env.API_AUTH_TOKEN) {
    return res.status(403).json({ error: 'Geçersiz token' });
  }
  next();
};
module.exports = { authMiddleware };
