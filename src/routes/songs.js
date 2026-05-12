// ============================================================
// VoxeraMeta — Songs Route v4.0
//
// Colab'a DOĞRUDAN HTTP atmaz.
// Tüm iletişim jobQueue üzerinden:
//   enqueue → Colab poll eder → complete/fail → frontend poll eder
// ============================================================

'use strict';

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');

const { processLyrics, buildMusicStylePrompt } = require('../services/freeAiService');
const queue = require('../services/jobQueue');

// ── POST /api/v1/generate-song ────────────────────────────────
// Şarkıyı kuyruğa alır, jobId döner (async)
router.post('/generate-song', async (req, res) => {
  const {
    lyrics,
    genre    = 'POP',
    duration = 30,
    gender   = 'male',
    language = 'tr',
    theme    = 'Happy',
  } = req.body;

  if (!lyrics || lyrics.trim().length === 0) {
    return res.status(400).json({ error: 'Şarkı sözleri gerekli' });
  }

  // Colab bağlı değilse hata ver (kuyruk dolmasın)
  if (!process.env.COLAB_SECRET) {
    return res.status(503).json({
      error: 'Colab worker bağlı değil. COLAB_SECRET env değişkeni eksik.',
      hint:  'Render Dashboard → Environment → COLAB_SECRET ekleyin.',
    });
  }

  const jobId      = uuidv4();
  const safeGender = ['male', 'female'].includes((gender || '').toLowerCase())
    ? gender.toLowerCase() : 'male';
  const safeGenre  = genre.toUpperCase();
  const safeDur    = Math.max(5, Math.min(Number(duration), 60));

  console.log(`🎵 [${jobId}] Kuyruğa alınıyor — ${safeGenre}/${safeGender}/${safeDur}s`);

  // Lyrics işlemi (Render'da, Groq/OpenRouter/Gemini ile)
  let processedLyrics = lyrics;
  let lyricsProvider  = 'passthrough';
  try {
    const result   = await processLyrics(lyrics, safeGenre);
    processedLyrics = result.text;
    lyricsProvider  = result.provider;
    console.log(`✅ [${jobId}] Lyrics hazır — ${lyricsProvider}`);
  } catch (err) {
    console.warn(`⚠️  [${jobId}] Lyrics işleme başarısız, orijinal kullanılıyor: ${err.message}`);
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

  // Hemen job_id döndür — frontend poll edecek
  res.status(202).json({
    id:       jobId,
    status:   'pending',
    message:  '✅ Kuyruğa alındı. Durum için /song-status?id=' + jobId,
    pollUrl:  `/api/v1/song-status?id=${jobId}`,
    genre:    safeGenre,
    gender:   safeGender,
    duration: safeDur,
  });
});

// ── GET /api/v1/song-status ───────────────────────────────────
// Frontend işin durumunu sorgular
router.get('/song-status', (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id parametresi gerekli' });

  const job = queue.get(id);
  if (!job) return res.status(404).json({ error: 'İş bulunamadı', id });

  const processingTime = Date.now() - job.createdAt;

  // Tamamlandıysa ses URL'i ile döndür
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

  // pending veya processing
  res.json({
    id:             job.job_id,
    status:         job.status,
    processingTime,
    message: job.status === 'processing'
      ? '⏳ Colab pipeline çalışıyor...'
      : '⏳ Colab worker\'ı bekliyor...',
  });
});

// ── GET /api/v1/queue-stats ───────────────────────────────────
// Debug / monitoring
router.get('/queue-stats', (req, res) => {
  res.json(queue.stats());
});

// ── GET /api/v1/providers ─────────────────────────────────────
router.get('/providers', (req, res) => {
  const { getProviderStatus } = require('../services/musicService');
  const status = getProviderStatus();
  status.singing = {
    rvc_male:   {
      name:        'RVC Erkek Şarkıcı (Edge-TTS + RVC v2)',
      isAvailable: !!process.env.COLAB_SECRET,
    },
    rvc_female: {
      name:        'RVC Kadın Şarkıcı (Edge-TTS + RVC v2)',
      isAvailable: !!process.env.COLAB_SECRET,
    },
  };
  res.json({ providers: status, totalFree: true });
});

// ── Yardımcı ─────────────────────────────────────────────────
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
