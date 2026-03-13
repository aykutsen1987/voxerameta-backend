// routes/songs.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { processLyrics, buildMusicStylePrompt } = require('../services/freeAiService');
const { generateMusic } = require('../services/musicService');

// In-memory job store (polling için hâlâ tutuyoruz)
const jobs = new Map();

// ── POST /api/v1/generate-song ────────────────────────────────
// Senkron: tamamlanana kadar bekler, tek seferde cevap döner
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
    hybridMode = false
  } = req.body;

  if (!lyrics || lyrics.trim().length === 0) {
    return res.status(400).json({ error: 'Şarkı sözleri gerekli' });
  }

  const jobId = uuidv4();
  const startTime = Date.now();

  console.log(`🎵 [${jobId}] Şarkı üretimi başladı — Genre: ${genre}, Duration: ${duration}s`);

  try {
    // Adım 1: Lyrics işle (Groq → OpenRouter → Gemini zinciri)
    console.log(`📝 [${jobId}] Lyrics işleniyor...`);
    const lyricsResult = await processLyrics(lyrics, genre);
    const processedLyrics = lyricsResult.text;
    const lyricsProvider = lyricsResult.provider;
    console.log(`✅ [${jobId}] Lyrics hazır — Provider: ${lyricsProvider}`);

    // Adım 2: Müzik stil promptu
    const musicPrompt = sunoStylePrompt || buildMusicStylePrompt(genre, hasVoice || hasMelody);

    // Adım 3: Müzik üret (HuggingFace → StabilityAI → Demo)
    console.log(`🎹 [${jobId}] Müzik üretiliyor...`);
    const musicResult = await generateMusic({
      musicPrompt,
      genre,
      duration: Math.min(duration, 30),
      processedLyrics
    });

    const processingTime = Date.now() - startTime;
    const title = extractTitle(processedLyrics);

    const result = {
      id: jobId,
      status: 'completed',
      audioUrl: musicResult.audioUrl || null,
      audioFile: musicResult.filename || null,
      duration: Math.min(duration, 30),
      title,
      provider: musicResult.provider,
      lyricsProvider,
      processingTime,
      demoMode: musicResult.demoMode || false,
      message: musicResult.demoMode
        ? '⚠️ Demo mod: Müzik API key\'i eksik. Gerçek şarkı için HuggingFace veya Stability AI key ekleyin.'
        : `✅ Şarkı hazır! (${Math.round(processingTime / 1000)}s)`,
      processedLyrics
    };

    // Polling için de sakla
    jobs.set(jobId, result);

    console.log(`✅ [${jobId}] Tamamlandı (${processingTime}ms) — demoMode: ${result.demoMode}`);
    res.json(result);

  } catch (err) {
    const processingTime = Date.now() - startTime;
    console.error(`❌ [${jobId}] Hata (${processingTime}ms):`, err.message);

    const errResult = {
      id: jobId,
      status: 'failed',
      error: err.message,
      processingTime
    };
    jobs.set(jobId, errResult);
    res.status(500).json(errResult);
  }
});

// ── GET /api/v1/song-status ───────────────────────────────────
router.get('/song-status', (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id parametresi gerekli' });
  const job = jobs.get(id);
  if (!job) return res.status(404).json({ error: 'İş bulunamadı', id });
  res.json(job);
});

// ── GET /api/v1/providers ─────────────────────────────────────
router.get('/providers', (req, res) => {
  const { getProviderStatus } = require('../services/musicService');
  res.json({ providers: getProviderStatus(), totalFree: true });
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
