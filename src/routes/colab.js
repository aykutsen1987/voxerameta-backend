// ============================================================
// VoxeraMeta — Colab Callback Route v5.0
//
// v5'te poll endpoint'i (/next-job) KALDIRILDI.
// Colab artık poll etmez — Render iş gönderir (POST /run-job).
// Colab bitince buraya callback atar.
//
//   POST /api/colab/job-done   → ses dosyasını alır
//   POST /api/colab/job-error  → hata bildirir
//   GET  /api/colab/status     → kuyruk durumu
// ============================================================

'use strict';

const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const multer  = require('multer');
const queue   = require('../services/jobQueue');

const SONGS_DIR = process.env.LOCAL_STORAGE_PATH || '/tmp/voxerameta-songs';
if (!fs.existsSync(SONGS_DIR)) fs.mkdirSync(SONGS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: SONGS_DIR,
    filename: (req, file, cb) => cb(null, `${req.body.job_id || 'unknown'}.mp3`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

function colabAuth(req, res, next) {
  if (req.headers['x-colab-secret'] !== process.env.COLAB_SECRET) {
    console.warn(`⛔ [Colab] Yetkisiz istek — IP: ${req.ip}`);
    return res.status(401).json({ error: 'Geçersiz secret' });
  }
  next();
}

router.use(colabAuth);

// POST /api/colab/job-done
router.post('/job-done', upload.single('audio'), (req, res) => {
  const jobId = req.body.job_id;
  if (!jobId || !req.file) {
    return res.status(400).json({ error: 'job_id ve audio gerekli' });
  }
  const base     = process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || '';
  const audioUrl = `${base}/songs/${req.file.filename}`;
  const ok       = queue.complete(jobId, audioUrl);
  if (!ok) return res.status(404).json({ error: `İş bulunamadı: ${jobId}` });
  console.log(`✅ [Colab] job-done: ${jobId} → ${audioUrl}`);
  res.json({ ok: true, audioUrl });
});

// POST /api/colab/job-error
router.post('/job-error', express.json(), (req, res) => {
  const { job_id, error } = req.body || {};
  if (!job_id) return res.status(400).json({ error: 'job_id gerekli' });
  queue.fail(job_id, error || 'Bilinmeyen Colab hatası');
  console.error(`❌ [Colab] job-error: ${job_id} — ${error}`);
  res.json({ ok: true });
});

// GET /api/colab/status
router.get('/status', (req, res) => {
  res.json({ queue: queue.stats(), serverTime: new Date().toISOString(), uptime: Math.round(process.uptime()) });
});

module.exports = router;
