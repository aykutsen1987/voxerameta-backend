// ============================================================
// VoxeraMeta — Colab Worker Endpoint'leri
//
// Bu route'lar SADECE Colab worker'ı içindir.
// Frontend bu endpoint'lere erişemez (X-Colab-Secret kontrolü).
//
//   GET  /api/colab/next-job   → Colab iş ister
//   POST /api/colab/job-done   → Colab ses dosyasını gönderir
//   POST /api/colab/job-error  → Colab hata bildirir
//   GET  /api/colab/status     → Worker sağlık kontrolü
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
  fileFilter: (req, file, cb) => {
    const ok = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav'].includes(file.mimetype);
    cb(ok ? null : new Error('Yalnızca audio dosyası kabul edilir'), ok);
  },
});

// ── Secret kontrolü middleware ────────────────────────────────
function colabAuth(req, res, next) {
  const secret = req.headers['x-colab-secret'];
  if (!secret || secret !== process.env.COLAB_SECRET) {
    console.warn(`⛔ [Colab] Yetkisiz istek — IP: ${req.ip}`);
    return res.status(401).json({ error: 'Geçersiz Colab secret' });
  }
  next();
}

router.use(colabAuth);

// ── GET /api/colab/next-job ───────────────────────────────────
// Colab çalışan iş var mı diye sorguluyor (polling)
router.get('/next-job', (req, res) => {
  const job = queue.dequeue();
  if (!job) {
    // 204 No Content — kuyruk boş, Colab poll etmeye devam eder
    return res.status(204).end();
  }
  console.log(`📤 [Colab Route] İş gönderildi: ${job.job_id}`);
  res.json(job);
});

// ── POST /api/colab/job-done ──────────────────────────────────
// Colab pipeline tamamlandı, ses dosyasını multipart olarak gönderdi
router.post('/job-done', upload.single('audio'), (req, res) => {
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

  console.log(`✅ [Colab Route] job-done: ${jobId} → ${audioUrl}`);
  res.json({ ok: true, audioUrl });
});

// ── POST /api/colab/job-error ─────────────────────────────────
// Colab pipeline hatası bildirdi
router.post('/job-error', express.json(), (req, res) => {
  const { job_id, error } = req.body || {};
  if (!job_id) return res.status(400).json({ error: 'job_id gerekli' });

  queue.fail(job_id, error || 'Bilinmeyen Colab hatası');
  console.error(`❌ [Colab Route] job-error: ${job_id} — ${error}`);
  res.json({ ok: true });
});

// ── GET /api/colab/status ─────────────────────────────────────
// Colab worker'ın heartbeat / kuyruk durumu
router.get('/status', (req, res) => {
  const s = queue.stats();
  res.json({
    queue:      s,
    serverTime: new Date().toISOString(),
    uptime:     Math.round(process.uptime()),
  });
});

module.exports = router;
