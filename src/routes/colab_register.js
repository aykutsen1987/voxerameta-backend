// ============================================================
// VoxeraMeta — Colab URL Kayıt + Heartbeat v5.1
//
//   POST /api/colab/register  { colab_url }   (secret: X-Colab-Secret başlığı)
//   GET  /api/colab/status
//
// Colab her ~2 dakikada bir bu endpoint'i tekrar çağırır (heartbeat).
// Böylece Render yeniden başlasa bile Colab adresini yeniden öğrenir ve
// "Colab bağlı mı?" sorusuna güvenilir cevap verebilir.
// ============================================================
'use strict';

const express = require('express');
const router  = express.Router();
const { requireColabSecret } = require('../utils/security');

let _colabUrl  = process.env.COLAB_URL || null;
let _lastSeen  = 0;   // ms — Colab'dan gelen son kayıt/heartbeat
let _message   = '';  // Colab hücresindeki APP_MESSAGE (uygulamada gösterilir)
let _activeSince = 0; // ms — Colab oturumu / mesaj en son ne zaman değişti (uygulama mesajı bir kez göstersin diye)
const DEFAULT_MESSAGE = 'Sistem hazır! Şarkını şimdi oluşturabilirsin 🎵';
const ALIVE_MS = (parseInt(process.env.COLAB_ALIVE_SECONDS, 10) || 360) * 1000;

function getColabUrl() { return _colabUrl; }

/** Colab son birkaç dakika içinde haber verdi mi? */
function isColabAlive() {
  return !!_colabUrl && (Date.now() - _lastSeen) < ALIVE_MS;
}

/** Uygulamaya gösterilecek duyuru: {message, id}. Colab bağlı değilse boş. */
function getAnnouncement() {
  if (!isColabAlive()) return { message: '', id: '' };
  const message = _message || String(process.env.COLAB_MESSAGE || '').trim() || DEFAULT_MESSAGE;
  return { message, id: String(_activeSince) };
}

function lastSeenSecondsAgo() {
  return _lastSeen ? Math.round((Date.now() - _lastSeen) / 1000) : null;
}

function normalizeUrl(raw) {
  let u = String(raw || '').trim().replace(/\/+$/, '').replace(/\/process$/, '');
  try {
    const parsed = new URL(u);
    const isLocal = ['localhost', '127.0.0.1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(isLocal && process.env.NODE_ENV !== 'production')) return null;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

// Colab → Render: URL bildir / heartbeat
router.post('/register', express.json(), requireColabSecret, async (req, res) => {
  const newUrl = normalizeUrl(req.body && req.body.colab_url);
  if (!newUrl) return res.status(400).json({ error: 'Geçersiz colab_url (https olmalı)' });

  const changed = newUrl !== _colabUrl;
  const newMsg  = String((req.body && req.body.message) || '').trim().slice(0, 200);
  if (changed || newMsg !== _message || !_activeSince) _activeSince = Date.now();
  _message  = newMsg;
  _colabUrl = newUrl;
  _lastSeen = Date.now();
  process.env.COLAB_URL = newUrl;

  let flushed = 0, requeued = 0;
  try {
    const queue = require('../services/jobQueue');
    // Yeni bir Colab oturumu başladıysa eski oturumda "processing" kalan işler kaybolmuştur
    if (changed) requeued = queue.requeueProcessing();
    flushed = await queue.flushPending();
  } catch (e) {
    console.warn(`⚠️  [Colab Register] kuyruk işlemi hatası: ${e.message}`);
  }

  if (changed) console.log(`✅ [Colab Register] Yeni Colab oturumu → ${newUrl} (flush=${flushed}, requeue=${requeued})`);
  res.json({ ok: true, changed, flushed, requeued });
});

// Durum (debug) — tam adresi dışarı vermez
router.get('/status', (req, res) => {
  res.json({
    connected:        isColabAlive(),
    colab_url_set:    !!_colabUrl,
    last_seen_sec:    lastSeenSecondsAgo(),
    colab_secret_set: !!process.env.COLAB_SECRET,
    base_url:         process.env.BASE_URL || null,
  });
});

module.exports = { router, getColabUrl, isColabAlive, lastSeenSecondsAgo, getAnnouncement };
