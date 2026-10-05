// ============================================================
// VoxeraMeta — Colab Worker Endpoint'leri (Push Mimarisi) v5.1
//
//   POST /api/colab/callback   → Colab bitmiş mp3'ü gönderir
//   POST /api/colab/error      → Colab hata bildirir
//
// v5.1 GÜVENLİK DÜZELTMELERİ:
//   - Secret kontrolü dosya yazılmadan ÖNCE yapılır (eskiden sonra yapılıyordu)
//   - Dosya adı yalnızca doğrulanmış UUID'den üretilir (path traversal kapatıldı)
//   - İş kimliği başlıktan (X-Job-Id) okunur ve kuyrukta var olmalıdır
//   - Yüklenen dosyanın gerçekten mp3 olup olmadığı kontrol edilir
// ============================================================
'use strict';

const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const queue   = require('../services/jobQueue');
const { requireColabSecret, isValidJobId } = require('../utils/security');

const SONGS_DIR = process.env.LOCAL_STORAGE_PATH || '/tmp/voxerameta-songs';
if (!fs.existsSync(SONGS_DIR)) fs.mkdirSync(SONGS_DIR, { recursive: true });

// ── İş kimliğini doğrula (multer'dan ÖNCE) ───────────────────
function prepareCallback(req, res, next) {
  const jobId = req.headers['x-job-id'];
  if (!isValidJobId(jobId)) {
    return res.status(400).json({ error: 'X-Job-Id başlığı geçerli bir UUID olmalı' });
  }
  const job = queue.get(jobId);
  if (!job) {
    return res.status(404).json({ error: `İş bulunamadı: ${jobId}` });
  }
  if (job.status === 'completed') {
    return res.status(409).json({ error: 'İş zaten tamamlanmış' });
  }
  req.colabJobId = jobId;
  next();
}

const upload = multer({
  storage: multer.diskStorage({
    destination: SONGS_DIR,
    filename: (req, file, cb) => cb(null, `${req.colabJobId}.mp3`),
  }),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 }, // 50 MB
});

// mp3 başlığı: "ID3" etiketi veya 0xFF 0xEx frame sync
function looksLikeMp3(filePath) {
  try {
    const fd  = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(3);
    fs.readSync(fd, buf, 0, 3, 0);
    fs.closeSync(fd);
    const isId3  = buf.toString('latin1') === 'ID3';
    const isSync = buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
    return isId3 || isSync;
  } catch {
    return false;
  }
}

// ── POST /api/colab/callback ──────────────────────────────────
router.post('/callback', requireColabSecret, prepareCallback, upload.single('audio'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'audio dosyası gerekli (alan adı: audio)' });
  }
  if (req.file.size < 1024 || !looksLikeMp3(req.file.path)) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(400).json({ error: 'Yüklenen dosya geçerli bir mp3 değil' });
  }

  const baseUrl = (
    process.env.BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    `${req.protocol}://${req.get('host')}`
  ).replace(/\/$/, '');
  const audioUrl = `${baseUrl}/songs/${req.file.filename}`;

  queue.complete(req.colabJobId, audioUrl);
  console.log(`✅ [Colab Route] callback: ${req.colabJobId} → ${audioUrl}`);
  res.json({ ok: true, audioUrl });
});

// ── POST /api/colab/error ─────────────────────────────────────
router.post('/error', express.json(), requireColabSecret, (req, res) => {
  const { job_id, error } = req.body || {};
  if (!isValidJobId(job_id)) return res.status(400).json({ error: 'job_id geçerli bir UUID olmalı' });

  const msg = String(error || 'Bilinmeyen Colab hatası').slice(0, 500);
  if (!queue.fail(job_id, msg)) return res.status(404).json({ error: 'İş bulunamadı' });

  console.error(`❌ [Colab Route] error: ${job_id} — ${msg}`);
  res.json({ ok: true });
});

module.exports = router;
