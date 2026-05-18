// ============================================================
// VoxeraMeta — Songs Route v4.2
//
// v4.2 DÜZELTMELER:
//   [FIX-1] song-status cevabında id alanı job.job_id yerine
//           job.id veya job.job_id kontrolü yapılıyor (undefined önlendi)
//   [FIX-2] colabStatus kontrolü doğru modülden yapılıyor
// ============================================================

'use strict';

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const { processLyrics, buildMusicStylePrompt } = require('../services/freeAiService');
const queue = require('../services/jobQueue');

// ── Referans dosya upload dizini ──────────────────────────────
const REF_DIR = process.env.REF_STORAGE_PATH || '/tmp/voxerameta-refs';
if (!fs.existsSync(REF_DIR)) fs.mkdirSync(REF_DIR, { recursive: true });

const refUpload = multer({
  storage: multer.diskStorage({
    destination: REF_DIR,
    filename: (req, file, cb) => {
      const uid  = uuidv4();
      const ext  = path.extname(file.originalname) || '.mp3';
      cb(null, `${uid}${ext}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (req, file, cb) => {
    const allowed = /\.(mp3|wav|m4a|aac|flac|ogg)$/i;
    if (allowed.test(file.originalname)) cb(null, true);
    else cb(new Error('Sadece ses dosyaları kabul edilir (mp3/wav/m4a/aac/flac/ogg)'));
  },
});

// ── POST /api/v1/upload-ref ───────────────────────────────────
// Ses veya melodi referans dosyasını yükler, sunucu path'ini döner.
// type=voice → voice_ref_path olarak kullanılır
// type=melody → melody_ref_path olarak kullanılır
router.post('/upload-ref', refUpload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Dosya yüklenmedi (field adı: file)' });
  }
  const refType = (req.body.type || 'melody').toLowerCase(); // 'voice' | 'melody'
  const refPath = req.file.path; // sunucuda mutlak yol — Colab'a bu gönderilir
  const size    = req.file.size;

  console.log(`📎 [upload-ref] ${refType} → ${refPath} (${Math.round(size / 1024)} KB)`);

  res.json({
    ok:      true,
    refType,
    refPath,                          // Colab push'unda kullanılacak
    filename: req.file.filename,
    sizeKB:  Math.round(size / 1024),
    message: `${refType === 'voice' ? 'Ses' : 'Melodi'} referansı yüklendi`,
  });
});

// ── POST /api/v1/generate-song ────────────────────────────────
router.post('/generate-song', async (req, res) => {
  const {
    lyrics,
    genre           = 'POP',
    duration        = 30,
    gender          = 'male',
    language        = 'tr',
    theme           = 'Happy',
    sunoStylePrompt = null,
    voice_ref_path  = null,   // v5: kullanıcı ses referansı (RVC clone için)
    melody_ref_path = null,   // v5: melodi referansı (MusicGen conditioning için)
  } = req.body;

  if (!lyrics || lyrics.trim().length === 0) {
    return res.status(400).json({ error: 'Şarkı sözleri gerekli' });
  }

  // [FIX-2] Colab bağlantı durumunu doğru modülden al
  let colabStatus = false;
  try {
    const { getColabUrl } = require('../routes/colab_register');
    colabStatus = !!getColabUrl();
  } catch {}

  if (!colabStatus) {
    console.warn(`⚠️  Colab bağlı değil — istek kuyruğa alınıyor (Colab bağlanınca otomatik işlenecek)`);
  }

  const jobId      = uuidv4();
  const safeGender = ['male', 'female'].includes((gender || '').toLowerCase())
    ? gender.toLowerCase() : 'male';
  const safeGenre  = genre.toUpperCase();
  const safeDur    = Math.max(5, Math.min(Number(duration), 60));

  console.log(`🎵 [${jobId}] Kuyruğa alınıyor — ${safeGenre}/${safeGender}/${safeDur}s${melody_ref_path ? ' 🎼melodi' : ''}${voice_ref_path ? ' 🎤ses' : ''}`);

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

  queue.enqueue({
    jobId,
    lyrics,
    processedLyrics,
    genre:            safeGenre,
    gender:           safeGender,
    duration:         safeDur,
    lyricsProvider,
    sunoStylePrompt:  sunoStylePrompt || null,
    voiceRefPath:     voice_ref_path  || null,   // v5: ses klonu referansı
    melodyRefPath:    melody_ref_path || null,   // v5: melodi conditioning
  });

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
router.get('/song-status', (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id parametresi gerekli' });

  const job = queue.get(id);
  if (!job) return res.status(404).json({ error: 'İş bulunamadı', id });

  // [FIX-1] job.job_id veya job.id — hangisi dolu ise kullan
  const jobId = job.job_id || job.id || id;
  const processingTime = Date.now() - job.createdAt;

  if (job.status === 'completed') {
    let audioUrl = job.audioUrl || '';
    if (audioUrl && !audioUrl.startsWith('http')) {
      const base = (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
      audioUrl = `${base}${audioUrl.startsWith('/') ? '' : '/'}${audioUrl}`;
    }
    return res.json({
      id:              jobId,
      status:          'completed',
      audioUrl,
      audioFile:       audioUrl,
      url:             audioUrl,
      mp3:             audioUrl,
      title:           extractTitle(job.processedLyrics),
      genre:           job.genre,
      gender:          job.gender,
      duration:        job.duration,
      lyricsProvider:  job.lyricsProvider,
      processedLyrics: job.processedLyrics,
      processingTime,
      hasVoice:        true,
      singingMode:     true,
      message:         `✅ Şarkı hazır! (${Math.round(processingTime / 1000)}s)`,
    });
  }

  if (job.status === 'failed') {
    return res.status(200).json({
      id:     jobId,
      status: 'failed',
      error:  job.error || 'Colab bağlantı hatası. Colab açık mı kontrol edin.',
      processingTime,
    });
  }

  res.json({
    id:             jobId,
    status:         job.status,
    processingTime,
    message: job.status === 'processing'
      ? '⏳ Colab pipeline çalışıyor...'
      : '⏳ Colab worker\'ı bekleniyor...',
  });
});

// ── GET /api/v1/queue-stats ───────────────────────────────────
router.get('/queue-stats', (req, res) => {
  res.json(queue.stats());
});

// ── GET /api/v1/providers ─────────────────────────────────────
router.get('/providers', (req, res) => {
  const { getProviderStatus } = require('../services/musicService');
  const status = getProviderStatus();
  status.singing = {
    rvc_male:   { name: 'RVC Erkek Şarkıcı (Edge-TTS + RVC v2)', isAvailable: !!process.env.COLAB_SECRET },
    rvc_female: { name: 'RVC Kadın Şarkıcı (Edge-TTS + RVC v2)', isAvailable: !!process.env.COLAB_SECRET },
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
// SENARYO 2
// ══════════════════════════════════════════════════════════════

const { generateScenario2, buildInstrumentalPrompt, buildVocalPrompt, GENRE_TECH_MAP } = require('../services/scenario2Engine');

router.post('/generate-song-s2', async (req, res) => {
  const {
    lyrics,
    genre        = 'POP',
    duration     = 60,
    gender       = 'male',
    customPrompt = null,
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
      status: 'failed',
      error:  err.message,
      hint:   'HUGGINGFACE_API_KEY veya ELEVENLABS_API_KEY eksik olabilir.',
    });
  }
});

router.get('/s2-preview-prompts', (req, res) => {
  const { genre = 'POP', gender = 'male', lyrics = 'örnek şarkı sözü' } = req.query;
  const g = genre.toUpperCase();

  const techInfo           = GENRE_TECH_MAP[g] || GENRE_TECH_MAP.POP;
  const instrumentalPrompt = buildInstrumentalPrompt(g, lyrics);
  const vocalPrompt        = buildVocalPrompt(lyrics, g, gender);

  res.json({
    genre: g, gender,
    bpm:   techInfo.bpm, key: techInfo.key, mood: techInfo.mood, style: techInfo.style,
    instrumentalPrompt, vocalPrompt,
    availableVocalProviders: {
      elevenlabs: !!process.env.ELEVENLABS_API_KEY,
      openai_tts: !!process.env.OPENAI_API_KEY,
      edge_tts:   true,
    },
    availableInstrumentalProviders: {
      huggingface: !!process.env.HUGGINGFACE_API_KEY,
      replicate:   !!process.env.REPLICATE_API_TOKEN,
    },
  });
});
