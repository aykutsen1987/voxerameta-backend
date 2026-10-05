// ============================================================
// VoxeraMeta — Güvenlik yardımcıları
//
//  - safeEqual        : zamanlama saldırısına dayanıklı string karşılaştırma
//  - isValidJobId     : iş kimliği SADECE UUID olabilir (dosya adı için güvenli)
//  - requireColabSecret: Colab'dan gelen isteklerde secret kontrolü
// ============================================================
'use strict';

const crypto = require('crypto');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function isValidJobId(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}

/**
 * Secret önce X-Colab-Secret başlığından, yoksa JSON gövdesinden okunur.
 * Multipart (dosya yükleme) isteklerinde gövde henüz çözülmediği için
 * Colab secret'i MUTLAKA başlıkla göndermelidir.
 */
function requireColabSecret(req, res, next) {
  const expected = process.env.COLAB_SECRET;
  if (!expected) {
    return res.status(503).json({ error: 'COLAB_SECRET sunucuda tanımlı değil (Render → Environment)' });
  }
  const given = req.headers['x-colab-secret'] || (req.body && req.body.secret) || '';
  if (!safeEqual(String(given), expected)) {
    console.warn(`⛔ [Colab] Yetkisiz istek — ${req.method} ${req.path} — IP: ${req.ip}`);
    return res.status(401).json({ error: 'Geçersiz Colab secret' });
  }
  next();
}

module.exports = { safeEqual, isValidJobId, requireColabSecret };
