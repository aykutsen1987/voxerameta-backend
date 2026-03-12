// services/musicService.js
// ============================================================
// ÜCRETSİZ Müzik Üretim Servisi
// Zincir: HuggingFace MusicGen → Stability AI Stable Audio → Demo
// ============================================================

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const SONGS_DIR = process.env.LOCAL_STORAGE_PATH || '/tmp/voxerameta-songs';

// Dizin yoksa oluştur
if (!fs.existsSync(SONGS_DIR)) {
  fs.mkdirSync(SONGS_DIR, { recursive: true });
}

// ── 1. HuggingFace MusicGen (Ücretsiz) ───────────────────────
async function generateWithHuggingFace(prompt, durationSeconds) {
  if (!process.env.HUGGINGFACE_API_KEY) throw new Error('HuggingFace key eksik');

  // max 30 saniye (HF ücretsiz limit)
  const safeDuration = Math.min(durationSeconds, 30);
  const model = safeDuration > 15
    ? 'facebook/musicgen-medium'
    : 'facebook/musicgen-small';

  console.log(`🎵 HuggingFace ${model} ile müzik üretiliyor... (${safeDuration}sn)`);

  const response = await axios.post(
    `https://api-inference.huggingface.co/models/${model}`,
    {
      inputs: prompt,
      parameters: {
        duration: safeDuration,
        guidance_scale: 3,
        do_sample: true
      }
    },
    {
      headers: { 'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}` },
      responseType: 'arraybuffer',
      timeout: 150000 // 2.5 dakika — model soğuk başlayabilir
    }
  );

  if (response.status !== 200) throw new Error(`HF status: ${response.status}`);

  const filename = `song_${uuidv4()}.wav`;
  const filepath = path.join(SONGS_DIR, filename);
  fs.writeFileSync(filepath, Buffer.from(response.data));

  const audioUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/songs/${filename}`;
  console.log(`✅ HuggingFace MusicGen müzik üretildi: ${filename}`);
  return { filename, audioUrl, provider: 'huggingface_musicgen', model };
}

// ── 2. Stability AI — Stable Audio (25 ücretsiz/gün) ─────────
// API Docs: https://platform.stability.ai/docs/api-reference#tag/Generate/paths/~1v2beta~1stable-audio~1generate/post
async function generateWithStabilityAI(prompt, durationSeconds) {
  if (!process.env.STABILITY_AI_API_KEY) throw new Error('Stability AI key eksik');

  // Stable Audio max 90 saniye destekler ama ücretsiz kredili kullanırken 45sn önerilir
  const safeDuration = Math.min(durationSeconds, 45);

  console.log(`🎵 Stability AI Stable Audio ile müzik üretiliyor... (${safeDuration}sn)`);

  const response = await axios.post(
    'https://api.stability.ai/v2beta/stable-audio/generate',
    {
      prompt,
      output_format: 'mp3',
      duration: safeDuration
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.STABILITY_AI_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'audio/*'
      },
      responseType: 'arraybuffer',
      timeout: 120000 // 2 dakika
    }
  );

  if (response.status !== 200) throw new Error(`Stability AI status: ${response.status}`);

  const filename = `song_${uuidv4()}.mp3`;
  const filepath = path.join(SONGS_DIR, filename);
  fs.writeFileSync(filepath, Buffer.from(response.data));

  const audioUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/songs/${filename}`;
  console.log(`✅ Stability AI Stable Audio müzik üretildi: ${filename}`);
  return { filename, audioUrl, provider: 'stability_ai_stable_audio', model: 'stable-audio-2.0' };
}

// ── 3. Demo Modu (hiç key yoksa bile çalışır) ─────────────────
async function generateDemo(genre, lyricsPreview) {
  console.log('⚠️  Demo modu: Müzik üretim key\'leri eksik');
  return {
    filename: null,
    audioUrl: null,
    provider: 'demo',
    model: 'demo',
    demoMode: true,
    demoMessage: `Demo mod aktif. HuggingFace veya Stability AI key eklenince gerçek müzik üretilecek.\nTür: ${genre}\nLyrics: "${lyricsPreview}"`
  };
}

// ── Ana Müzik Üretim Fonksiyonu (Zincir) ─────────────────────
async function generateMusic({ musicPrompt, genre, duration, processedLyrics }) {
  // 1. HuggingFace MusicGen dene
  if (process.env.HUGGINGFACE_API_KEY) {
    try {
      return await generateWithHuggingFace(musicPrompt, duration);
    } catch (err) {
      console.warn(`⚠️  HuggingFace başarısız: ${err.message} — Stability AI deneniyor...`);
    }
  }

  // 2. Stability AI Stable Audio fallback
  if (process.env.STABILITY_AI_API_KEY) {
    try {
      return await generateWithStabilityAI(musicPrompt, duration);
    } catch (err) {
      console.warn(`⚠️  Stability AI başarısız: ${err.message} — Demo moda geçiliyor...`);
    }
  }

  // 3. Demo modu son çare
  return await generateDemo(genre, processedLyrics?.substring(0, 50) || '');
}

// ── Aktif Provider Listesi ────────────────────────────────────
function getProviderStatus() {
  return {
    groq: {
      name: 'Groq (Lyrics)',
      isAvailable: !!process.env.GROQ_API_KEY,
      limit: '1.000 istek/gün',
      cost: 'Ücretsiz'
    },
    openrouter: {
      name: 'OpenRouter :free (Lyrics)',
      isAvailable: !!process.env.OPENROUTER_API_KEY,
      limit: '200 istek/gün',
      cost: 'Ücretsiz'
    },
    gemini: {
      name: 'Google Gemini Flash (Lyrics)',
      isAvailable: !!process.env.GEMINI_API_KEY,
      limit: '500 istek/gün',
      cost: 'Ücretsiz'
    },
    huggingface: {
      name: 'HuggingFace MusicGen (Müzik — 1. öncelik)',
      isAvailable: !!process.env.HUGGINGFACE_API_KEY,
      limit: 'Rate limitli (saatlik reset)',
      cost: 'Ücretsiz'
    },
    stability_ai: {
      name: 'Stability AI Stable Audio (Müzik — 2. öncelik)',
      isAvailable: !!process.env.STABILITY_AI_API_KEY,
      limit: '25 kredi/gün (ücretsiz)',
      cost: 'Ücretsiz (25/gün) — opsiyonel API key'
    }
  };
}

module.exports = { generateMusic, getProviderStatus };
