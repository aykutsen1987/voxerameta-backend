// routes/songs.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { processLyrics, buildMusicStylePrompt } = require('../services/freeAiService');
const { generateMusic } = require('../services/musicService');

// In-memory job store
const jobs = new Map();

// ── POST /api/v1/generate-song ────────────────────────────────
router.post('/generate-song', async (req, res) => {
  const {
    lyrics,
    genre = 'POP',
    duration = 60,
    language = 'tr',
    theme = 'Happy',
    hasVoice = false,
    hasMelody = false,
    sunoStylePrompt,
    voiceClonePrompt,
    hybridMode = false
  } = req.body;

  if (!lyrics || lyrics.trim().length === 0) {
    return res.status(400).json({ error: 'Şarkı sözleri gerekli (lyrics boş olamaz)' });
  }

  const jobId = uuidv4();

  // İşi anında kaydet
  jobs.set(jobId, {
    id: jobId,
    status: 'processing',
    createdAt: new Date().toISOString(),
    genre, duration, language
  });

  // Android'e hemen "processing" döndür
  res.json({
    id: jobId,
    status: 'processing',
    message: 'Şarkı üretimi başladı — ücretsiz AI zincirine gönderildi',
    estimatedSeconds: 20
  });

  // Arka planda işle
  ;(async () => {
    const startTime = Date.now();
    try {
      // Adım 1: Lyrics → Groq → OpenRouter → Gemini zinciri
      const lyricsResult = await processLyrics(lyrics, genre);
      const processedLyrics = lyricsResult.text;
      const lyricsProvider = lyricsResult.provider;

      // Adım 2: Müzik stil promptu oluştur
      const musicPrompt = sunoStylePrompt || buildMusicStylePrompt(genre, hasVoice || hasMelody);

      // Adım 3: HuggingFace MusicGen ile müzik üret
      const musicResult = await generateMusic({
        musicPrompt,
        genre,
        duration: Math.min(duration, 30), // HF max 30sn
        processedLyrics
      });

      const processingTime = Date.now() - startTime;

      jobs.set(jobId, {
        id: jobId,
        status: 'completed',
        audioUrl: musicResult.audioUrl,
        audioFile: musicResult.filename,
        duration: Math.min(duration, 30),
        title: extractTitle(processedLyrics),
        provider: musicResult.provider,
        lyricsProvider,
        processingTime,
        message: musicResult.demoMode
          ? musicResult.demoMessage
          : `Şarkı oluşturuldu — Lyrics: ${lyricsProvider}, Müzik: ${musicResult.provider}`,
        demoMode: musicResult.demoMode || false,
        processedLyrics,
        originalLyrics: lyrics,
        musicPrompt
      });

      console.log(`✅ Job [${jobId}] tamamlandı (${processingTime}ms)`);
    } catch (err) {
      jobs.set(jobId, { id: jobId, status: 'failed', error: err.message });
      console.error(`❌ Job [${jobId}] başarısız:`, err.message);
    }
  })();
});

// ── GET /api/v1/song-status ───────────────────────────────────
router.get('/song-status', (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id parametresi gerekli' });

  const job = jobs.get(id);
  if (!job) return res.status(404).json({ error: 'İş bulunamadı', id });

  res.json({
    id: job.id,
    status: job.status,
    audioUrl: job.audioUrl || null,
    duration: job.duration || 0,
    title: job.title || 'Oluşturulan Şarkı',
    provider: job.provider || null,
    lyricsProvider: job.lyricsProvider || null,
    processingTime: job.processingTime || 0,
    message: job.message || null,
    error: job.error || null,
    demoMode: job.demoMode || false,
    processedLyrics: job.processedLyrics || null
  });
});

// ── GET /api/v1/providers ─────────────────────────────────────
router.get('/providers', (req, res) => {
  const { getProviderStatus } = require('../services/musicService');
  res.json({
    providers: getProviderStatus(),
    totalFree: true,
    note: 'Tüm servisler ücretsiz veya günlük limitli'
  });
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
