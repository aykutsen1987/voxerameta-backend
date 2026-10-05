// middleware/auth.js
//
// API_AUTH_TOKEN tanımlıysa uygulamadan gelen isteklerde X-Auth-Token başlığı zorunlu olur.
// Tanımlı değilse endpoint herkese açıktır (varsayılan).
//
// NOT: Android uygulamasına gömülen bir token gerçek bir sır değildir (APK'dan okunabilir).
//      Bu yalnızca rastgele taramaları azaltır. Asıl koruma: hız sınırı + Colab secret.
const { safeEqual } = require('../utils/security');

const authMiddleware = (req, res, next) => {
  const expected = process.env.API_AUTH_TOKEN;
  if (!expected) return next();
  const given = req.headers['x-auth-token'] || '';
  if (!safeEqual(String(given), expected)) {
    return res.status(401).json({ error: 'Yetkisiz istek (X-Auth-Token)' });
  }
  next();
};

module.exports = { authMiddleware };
