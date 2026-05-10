// routes/songs.js — VoxeraMeta v2 (RVC Singing Voice)
const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { processLyrics, buildMusicStylePrompt } = require('../services/freeAiService');
const { generateMusic }                        = require('../services/musicService');
const { generateSongWithRVC, generateVocalOnly } = require('../services/providers/colabProvider');

const jobs = new Map();

// ── POST /api/v1/generate-song ────────────────────────────────────
// Ana endpoint: lyrics → şarkı söyleyen ses + melodi
router.post('/generate-song', async (req, res) => {
  const {
    lyrics,
    genre      = 'POP',
    duration   = 30,
    language   = 'tr',
    gender     = 'male',       // YENİ: 'male' | 'female'
    theme      = 'Happy',
    hasVoice   = false,
    hasMelody  = false,
    sunoStylePrompt,
    hybridMode = false,
    singingMode = true         // YENİ: true = RVC pipeline, false = eski enstrümantal
  } = req.body;

  if (!lyrics || lyrics.trim().length === 0) {
    return res.status(400).json({ error: 'Şarkı sözleri gerekli' });
  }

  const jobId     = uuidv4();
  const startTime = Date.now();
  const safeGender = ['male', 'female'].includes((gender || '').toLowerCase())
    ? gender.toLowerCase() : 'male';

  console.log(`🎵 [${jobId}] Başladı — Genre: ${genre} | Gender: ${safeGender} | Singing: ${singingMode}`);

  try {
    // ── Adım 1: Lyrics işle (AI zinciri) ──────────────────────
    console.log(`📝 [${jobId}] Lyrics işleniyor...`);
    const lyricsResult    = await processLyrics(lyrics, genre);
    const processedLyrics = lyricsResult.text;
    const lyricsProvider  = lyricsResult.provider;
    console.log(`✅ [${jobId}] Lyrics hazır — Provider: ${lyricsProvider}`);

    let result;

    if (singingMode && process.env.COLAB_MUSIC_API_URL) {
      // ── RVC PIPELINE: Tam şarkı (vokal + melodi) ────────────
      console.log(`🎤 [${jobId}] RVC pipeline başlıyor (${safeGender})...`);
      const musicResult = await generateSongWithRVC(
        processedLyrics, genre, safeGender,
        Math.min(Number(duration), 60)
      );

      result = {
        id:             jobId,
        status:         'completed',
        audioUrl:       musicResult.audioUrl,
        audioFile:      musicResult.audioUrl,
        duration:       Math.min(Number(duration), 60),
        title:          extractTitle(processedLyrics),
        provider:       musicResult.provider,
        lyricsProvider,
        processingTime: Date.now() - startTime,
        demoMode:       false,
        hasVoice:       true,
        gender:         safeGender,
        singingMode:    true,
        message:        `✅ Şarkı hazır! ${safeGender === 'male' ? '👨' : '👩'} ${genre} — ${Math.round((Date.now() - startTime) / 1000)}s`,
        processedLyrics
      };

    } else {
      // ── ESKİ PIPELINE: Sadece enstrümantal ──────────────────
      console.log(`🎹 [${jobId}] Enstrümantal pipeline (singingMode kapalı veya Colab yok)`);
      const musicPrompt = sunoStylePrompt || buildMusicStylePrompt(genre, hasVoice || hasMelody);
      const musicResult = await generateMusic({
        musicPrompt, genre,
        duration: Math.min(Number(duration), 30),
        processedLyrics
      });

      result = {
        id:             jobId,
        status:         'completed',
        audioUrl:       musicResult.audioUrl || null,
        audioFile:      musicResult.audioUrl || null,
        duration:       Math.min(Number(duration), 30),
        title:          extractTitle(processedLyrics),
        provider:       musicResult.provider,
        lyricsProvider,
        processingTime: Date.now() - startTime,
        demoMode:       musicResult.demoMode || false,
        hasVoice:       false,
        gender:         null,
        singingMode:    false,
        message:        musicResult.demoMode
          ? '⚠️ Demo mod: Enstrümantal müzik (singingMode kapalı)'
          : `✅ Enstrümantal hazır! (${Math.round((Date.now() - startTime) / 1000)}s)`,
        processedLyrics
      };
    }

    jobs.set(jobId, result);
    console.log(`✅ [${jobId}] Tamamlandı (${result.processingTime}ms)`);
    res.json(result);

  } catch (err) {
    const processingTime = Date.now() - startTime;
    console.error(`❌ [${jobId}] Hata (${processingTime}ms):`, err.message);
    const errResult = { id: jobId, status: 'failed', error: err.message, processingTime };
    jobs.set(jobId, errResult);
    res.status(500).json(errResult);
  }
});

// ── POST /api/v1/generate-vocal ───────────────────────────────────
// Sadece RVC vokal döndürür (melodi olmadan)
router.post('/generate-vocal', async (req, res) => {
  const { lyrics, gender = 'male' } = req.body;

  if (!lyrics || lyrics.trim().length === 0) {
    return res.status(400).json({ error: 'Şarkı sözleri gerekli' });
  }

  if (!process.env.COLAB_MUSIC_API_URL) {
    return res.status(503).json({ error: 'Colab bağlı değil. COLAB_MUSIC_API_URL gerekli.' });
  }

  try {
    const result = await generateVocalOnly(lyrics, gender);
    res.json({ status: 'completed', audioUrl: result.audioUrl, gender: result.gender, provider: result.provider });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/v1/song-status ───────────────────────────────────────
router.get('/song-status', (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id parametresi gerekli' });
  const job = jobs.get(id);
  if (!job) return res.status(404).json({ error: 'İş bulunamadı', id });
  res.json(job);
});

// ── GET /api/v1/providers ─────────────────────────────────────────
router.get('/providers', (req, res) => {
  const { getProviderStatus } = require('../services/musicService');
  const status = getProviderStatus();
  // RVC bilgisini ekle
  status.singing = {
    rvc_male:   { name: 'RVC Erkek Şarkıcı (Edge-TTS + RVC v2)', isAvailable: !!process.env.COLAB_MUSIC_API_URL },
    rvc_female: { name: 'RVC Kadın Şarkıcı (Edge-TTS + RVC v2)', isAvailable: !!process.env.COLAB_MUSIC_API_URL }
  };
  res.json({ providers: status, totalFree: true });
});

// ── Yardımcı ─────────────────────────────────────────────────────
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
