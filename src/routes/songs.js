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
    genre           = 'POP',
    duration        = 30,
    gender          = 'male',
    language        = 'tr',
    theme           = 'Happy',
    sunoStylePrompt = null,
  } = req.body;

  if (!lyrics || lyrics.trim().length === 0) {
    return res.status(400).json({ error: 'Şarkı sözleri gerekli' });
  }

  // Colab bağlı değilse uyar ama engelleme — kullanıcı bekleyebilir
  const colabStatus = (() => {
    try { const { getColabUrl } = require('../routes/colab_register'); return !!getColabUrl(); }
    catch { return false; }
  })();

  if (!colabStatus) {
    console.warn(`⚠️  [${uuidv4()}] Colab bağlı değil — istek kuyruğa alınıyor`);
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
    genre:            safeGenre,
    gender:           safeGender,
    duration:         safeDur,
    lyricsProvider,
    sunoStylePrompt:  sunoStylePrompt || null,
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
    // audioUrl her zaman tam URL olmalı (http/https ile başlamalı)
    let audioUrl = job.audioUrl || '';
    if (audioUrl && !audioUrl.startsWith('http')) {
      const base = (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
      audioUrl = `${base}${audioUrl.startsWith('/') ? '' : '/'}${audioUrl}`;
    }
    return res.json({
      id:             job.job_id,
      status:         'completed',
      audioUrl,
      audioFile:      audioUrl,
      url:            audioUrl,       // ← Android için ek alan
      mp3:            audioUrl,       // ← bazı client versiyonları bunu kullanıyor
      title:          extractTitle(job.processedLyrics),
      genre:          job.genre,
      gender:         job.gender,
      duration:       job.duration,
      lyricsProvider: job.lyricsProvider,
      processedLyrics: job.processedLyrics,
      processingTime,
      hasVoice:       true,
      singingMode:    true,
      message:        `✅ Şarkı hazır! (${Math.round(processingTime / 1000)}s)`,
    });
  }

  if (job.status === 'failed') {
    return res.status(200).json({
      id:     job.job_id,
      status: 'failed',
      error:  job.error || 'Colab bağlantı hatası. Colab açık mı kontrol edin.',
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


// ══════════════════════════════════════════════════════════════
// SENARYO 2: MusicGen Altyapı + Harici Vokal AI
// POST /api/v1/generate-song-s2
// ══════════════════════════════════════════════════════════════

const { generateScenario2, buildInstrumentalPrompt, buildVocalPrompt, GENRE_TECH_MAP } = require('../services/scenario2Engine');

/**
 * POST /api/v1/generate-song-s2
 * Senaryo 2: MusicGen (altyapı) + Vokal AI (ses) → Mix
 * Sync endpoint — sonuç hazır olduğunda döner (5-90 sn)
 */
router.post('/generate-song-s2', async (req, res) => {
  const {
    lyrics,
    genre           = 'POP',
    duration        = 60,
    gender          = 'male',
    customPrompt    = null,
  } = req.body;

  if (!lyrics || lyrics.trim().length === 0) {
    return res.status(400).json({ error: 'Şarkı sözleri gerekli' });
  }

  const safeGenre  = genre.toUpperCase();
  const safeGender = ['male', 'female'].includes((gender || '').toLowerCase()) ? gender.toLowerCase() : 'male';
  const safeDur    = Math.max(10, Math.min(Number(duration) || 60, 180));

  console.log(`\n🎵 [S2 Route] Senaryo 2 başlatılıyor — ${safeGenre}/${safeGender}/${safeDur}s`);

  try {
    const result = await generateScenario2({
      lyrics,
      genre:        safeGenre,
      gender:       safeGender,
      duration:     safeDur,
      customPrompt: customPrompt || null,
    });

    return res.status(200).json({
      id:                   uuidv4(),
      status:               'completed',
      audioUrl:             result.audioUrl,
      audioFile:            result.audioUrl,
      url:                  result.audioUrl,
      mp3:                  result.audioUrl,
      provider:             result.provider,
      instrumentalProvider: result.instrumentalProvider,
      vocalProvider:        result.vocalProvider,
      instrumentalPrompt:   result.instrumentalPrompt,
      vocalPrompt:          result.vocalPrompt,
      genre:                safeGenre,
      gender:               safeGender,
      duration:             safeDur,
      hasVoice:             true,
      singingMode:          true,
      scenario:             2,
      message:              `✅ Senaryo 2 tamamlandı — Altyapı: ${result.instrumentalProvider} | Vokal: ${result.vocalProvider}`,
    });
  } catch (err) {
    console.error(`❌ [S2 Route] Hata: ${err.message}`);
    return res.status(500).json({
      status:  'failed',
      error:   err.message,
      hint:    'HUGGINGFACE_API_KEY veya ELEVENLABS_API_KEY eksik olabilir.',
    });
  }
});

/**
 * GET /api/v1/s2-preview-prompts
 * Android UI için: seçilen tür/cinsiyet için prompt önizlemesi döner
 * (Kullanıcı üretmeden önce ne üretileceğini görebilir)
 */
router.get('/s2-preview-prompts', (req, res) => {
  const { genre = 'POP', gender = 'male', lyrics = 'örnek şarkı sözü' } = req.query;
  const g = genre.toUpperCase();

  const techInfo        = GENRE_TECH_MAP[g] || GENRE_TECH_MAP.POP;
  const instrumentalPrompt = buildInstrumentalPrompt(g, lyrics);
  const vocalPrompt        = buildVocalPrompt(lyrics, g, gender);

  res.json({
    genre:               g,
    gender,
    bpm:                 techInfo.bpm,
    key:                 techInfo.key,
    mood:                techInfo.mood,
    style:               techInfo.style,
    instrumentalPrompt,
    vocalPrompt,
    availableVocalProviders: {
      elevenlabs: !!process.env.ELEVENLABS_API_KEY,
      openai_tts: !!process.env.OPENAI_API_KEY,
      edge_tts:   true, // her zaman mevcut (fallback)
    },
    availableInstrumentalProviders: {
      huggingface: !!process.env.HUGGINGFACE_API_KEY,
      replicate:   !!process.env.REPLICATE_API_TOKEN,
    },
  });
});
