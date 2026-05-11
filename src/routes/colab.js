// ============================================================
// VoxeraMeta — Colab Worker Endpoint'leri (Push Mimarisi)
//
// Bu route'lar SADECE Colab worker'ı içindir.
//
//   POST /api/colab/callback   → Colab ses dosyasını gönderir (job-done yerine)
//   POST /api/colab/error      → Colab hata bildirir (job-error yerine)
// ============================================================
'use strict';
const express  = require('express');
const router   = express.Router();
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const queue    = require('../services/jobQueue');

const SONGS_DIR = process.env.LOCAL_STORAGE_PATH || '/tmp/voxerameta-songs';
if (!fs.existsSync(SONGS_DIR)) fs.mkdirSync(SONGS_DIR, { recursive: true });

// ── Multer: Colab'dan gelen ses dosyası için ─────────────────
const upload = multer({
  storage: multer.diskStorage({
    destination: SONGS_DIR,
    filename: (req, file, cb) => {
      const jobId = req.body.job_id || 'unknown';
      cb(null, `${jobId}.mp3`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

// ── Secret kontrolü middleware ────────────────────────────────
function colabAuth(req, res, next) {
  const secret = req.body.secret || req.headers['x-colab-secret'];
  if (!secret || secret !== process.env.COLAB_SECRET) {
    console.warn(`⛔ [Colab] Yetkisiz istek — IP: ${req.ip}`);
    return res.status(401).json({ error: 'Geçersiz Colab secret' });
  }
  next();
}

// ── POST /api/colab/callback ──────────────────────────────────
// Colab pipeline tamamlandı, ses dosyasını gönderdi
router.post('/callback', upload.single('file'), colabAuth, (req, res) => {
  const jobId = req.body.job_id;
  if (!jobId) {
    return res.status(400).json({ error: 'job_id gerekli' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'audio dosyası gerekli' });
  }

  const filename = req.file.filename;
  const baseUrl  = process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || '';
  const audioUrl = `${baseUrl}/songs/${filename}`;

  const ok = queue.complete(jobId, audioUrl);
  if (!ok) {
    return res.status(404).json({ error: `İş bulunamadı: ${jobId}` });
  }

  console.log(`✅ [Colab Route] callback: ${jobId} → ${audioUrl}`);
  res.json({ ok: true, audioUrl });
});

// ── POST /api/colab/error ─────────────────────────────────────
// Colab pipeline hatası bildirdi
router.post('/error', express.json(), colabAuth, (req, res) => {
  const { job_id, error } = req.body || {};
  if (!job_id) return res.status(400).json({ error: 'job_id gerekli' });

  queue.fail(job_id, error || 'Bilinmeyen Colab hatası');
  console.error(`❌ [Colab Route] error: ${job_id} — ${error}`);
  res.json({ ok: true });
});

module.exports = router;
