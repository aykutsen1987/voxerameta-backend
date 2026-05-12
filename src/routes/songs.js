// ============================================================
// VoxeraMeta — Songs Route v5.0
//
// Akış:
//   1. POST /generate-song → lyrics işle → kuyruğa al
//   2. Render → Colab FastAPI'ye push et (POST /run-job)
//   3. Colab callback → /api/colab/job-done → kuyruk güncellenir
//   4. Frontend GET /song-status ile sonucu alır
// ============================================================

'use strict';

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');

const { processLyrics }                    = require('../services/freeAiService');
const queue                                = require('../services/jobQueue');
const { pushJobToColab, checkColabHealth } = require('../services/providers/colabProvider');

// ── POST /api/v1/generate-song ────────────────────────────────
router.post('/generate-song', async (req, res) => {
  const {
    lyrics,
    genre    = 'POP',
    duration = 30,
    gender   = 'male',
  } = req.body;

  if (!lyrics || lyrics.trim().length === 0) {
    return res.status(400).json({ error: 'Şarkı sözleri gerekli' });
  }
  if (!process.env.COLAB_WORKER_URL) {
    return res.status(503).json({
      error: 'Colab worker bağlı değil.',
      hint:  'Colab notebook\'u başlatın, ngrok URL\'sini Render\'a COLAB_WORKER_URL olarak ekleyin.',
    });
  }

  const jobId      = uuidv4();
  const safeGender = ['male', 'female'].includes((gender || '').toLowerCase())
    ? gender.toLowerCase() : 'male';
  const safeGenre  = genre.toUpperCase();
  const safeDur    = Math.max(5, Math.min(Number(duration), 60));

  console.log(`🎵 [${jobId}] Başladı — ${safeGenre}/${safeGender}/${safeDur}s`);

  // Lyrics işle (Render'da — Groq/OpenRouter/Gemini)
  let processedLyrics = lyrics;
  let lyricsProvider  = 'passthrough';
  try {
    const r     = await processLyrics(lyrics, safeGenre);
    processedLyrics = r.text;
    lyricsProvider  = r.provider;
    console.log(`✅ [${jobId}] Lyrics hazır — ${lyricsProvider}`);
  } catch (err) {
    console.warn(`⚠️  [${jobId}] Lyrics işleme başarısız: ${err.message}`);
  }

  // Kuyruğa ekle
  queue.enqueue({
    jobId,
    lyrics,
    processedLyrics,
    genre:    safeGenre,
    gender:   safeGender,
    duration: safeDur,
    lyricsProvider,
  });

  // Colab'a hemen gönder
  try {
    await pushJobToColab({
      job_id:   jobId,
      lyrics:   processedLyrics,
      genre:    safeGenre,
      gender:   safeGender,
      duration: safeDur,
    });
    console.log(`📤 [${jobId}] Colab'a gönderildi`);
  } catch (err) {
    console.error(`❌ [${jobId}] Colab push hatası: ${err.message}`);
    queue.fail(jobId, `Colab ulaşılamadı: ${err.message}`);
    return res.status(503).json({
      id:     jobId,
      status: 'failed',
      error:  err.message,
      hint:   'Colab notebook açık mı? COLAB_WORKER_URL güncel mi?',
    });
  }

  res.status(202).json({
    id:       jobId,
    status:   'processing',
    message:  '✅ Colab pipeline başladı. Durum için /song-status?id=' + jobId,
    pollUrl:  `/api/v1/song-status?id=${jobId}`,
    genre:    safeGenre,
    gender:   safeGender,
    duration: safeDur,
  });
});

// ── GET /api/v1/song-status ───────────────────────────────────
router.get('/song-status', (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id gerekli' });

  const job = queue.get(id);
  if (!job) return res.status(404).json({ error: 'İş bulunamadı', id });

  const processingTime = Date.now() - job.createdAt;

  if (job.status === 'completed') {
    return res.json({
      id:             job.job_id,
      status:         'completed',
      audioUrl:       job.audioUrl,
      audioFile:      job.audioUrl,
      title:          extractTitle(job.processedLyrics),
      genre:          job.genre,
      gender:         job.gender,
      duration:       job.duration,
      lyricsProvider: job.lyricsProvider,
      processingTime,
      hasVoice:       true,
      singingMode:    true,
      message:        `✅ Şarkı hazır! (${Math.round(processingTime / 1000)}s)`,
    });
  }

  if (job.status === 'failed') {
    return res.status(500).json({
      id:     job.job_id,
      status: 'failed',
      error:  job.error,
      processingTime,
    });
  }

  res.json({
    id:          job.job_id,
    status:      job.status,
    processingTime,
    message:     '⏳ Colab pipeline çalışıyor...',
  });
});

// ── GET /api/v1/colab-health ──────────────────────────────────
router.get('/colab-health', async (req, res) => {
  try {
    const h = await checkColabHealth();
    if (h) return res.json({ connected: true, ...h });
    res.status(503).json({ connected: false, error: 'Colab\'a ulaşılamıyor' });
  } catch (err) {
    res.status(503).json({ connected: false, error: err.message });
  }
});

// ── GET /api/v1/queue-stats ───────────────────────────────────
router.get('/queue-stats', (req, res) => res.json(queue.stats()));

// ── GET /api/v1/providers ─────────────────────────────────────
router.get('/providers', (req, res) => {
  const { getProviderStatus } = require('../services/musicService');
  const status = getProviderStatus();
  status.singing = {
    colab_worker: {
      name:        'Colab FastAPI Worker (RVC + MusicGen)',
      isAvailable: !!process.env.COLAB_WORKER_URL,
      url:         process.env.COLAB_WORKER_URL || null,
    },
  };
  res.json({ providers: status, totalFree: true });
});

function extractTitle(lyrics) {
  if (!lyrics) return 'Oluşturulan Şarkı';
  return lyrics
    .replace(/\[[^\]]+\]/g, '')
    .split('\n')
    .find(l => l.trim().length > 3)
    ?.trim()
    .substring(0, 40) || 'Oluşturulan Şarkı';
}

module.exports = router;
