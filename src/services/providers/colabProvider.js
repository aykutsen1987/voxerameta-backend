// ============================================================
// VoxeraMeta — Colab Provider v2 (RVC Singing Voice)
// ============================================================
//
// Desteklenen endpoint'ler:
//   /generate-music  → eski enstrümantal (geriye dönük uyumluluk)
//   /generate-song   → YENİ: lyrics + gender → şarkı söyleyen ses + melodi
//   /generate-vocal  → sadece RVC vokal (melodi olmadan)
//
// BASE_URL öncelik sırası:
//   process.env.BASE_URL → process.env.RENDER_EXTERNAL_URL → hata
// ============================================================

'use strict';

const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');
const { v4: uuidv4 } = require('uuid');

const SONGS_DIR = process.env.LOCAL_STORAGE_PATH || '/tmp/voxerameta-songs';
if (!fs.existsSync(SONGS_DIR)) fs.mkdirSync(SONGS_DIR, { recursive: true });

function getBaseUrl() {
  const url = process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || null;
  if (!url || url.includes('localhost')) {
    throw new Error(
      "BASE_URL Render dashboard'a eklenmedi! " +
      'Örnek: https://voxerameta-ai-backend.onrender.com'
    );
  }
  return url.replace(/\/$/, '');
}

// ── Ortak: Colab'a POST at, yanıtı işle ─────────────────────────
async function callColab(endpoint, payload, logPrefix = 'Colab') {
  const colabUrl = process.env.COLAB_MUSIC_API_URL;
  if (!colabUrl) throw new Error('COLAB_MUSIC_API_URL env değişkeni tanımlı değil');

  const url = `${colabUrl.replace(/\/$/, '')}/${endpoint}`;
  console.log(`🎵 [${logPrefix}] → ${url}`, JSON.stringify(payload).slice(0, 120));

  const response = await axios.post(url, payload, {
    headers: { 'Content-Type': 'application/json' },
    responseType: 'arraybuffer',
    timeout: 900000,   // 15 dakika (RVC pipeline uzun sürebilir)
    validateStatus: () => true
  });

  if (response.status !== 200) {
    const errText = Buffer.from(response.data).toString('utf8').slice(0, 400);
    throw new Error(`Colab HTTP ${response.status}: ${errText}`);
  }

  const contentType = response.headers['content-type'] || '';

  // CASE 1: Audio binary
  if (contentType.startsWith('audio/')) {
    const ext      = contentType.includes('mpeg') ? 'mp3' : 'wav';
    const filename = `colab_${uuidv4()}.${ext}`;
    const filepath = path.join(SONGS_DIR, filename);
    fs.writeFileSync(filepath, Buffer.from(response.data));
    const audioUrl = `${getBaseUrl()}/songs/${filename}`;
    console.log(`✅ [${logPrefix}] Audio kaydedildi → ${audioUrl}`);
    return { filename, audioUrl };
  }

  // CASE 2: JSON
  const text = Buffer.from(response.data).toString('utf8');
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error('Colab JSON parse hatası: ' + text.slice(0, 200)); }

  if (json.error) throw new Error(`Colab hatası: ${json.error}`);

  if (json.audio_url && json.audio_url.startsWith('http')) {
    console.log(`✅ [${logPrefix}] Direkt URL → ${json.audio_url}`);
    return { filename: path.basename(json.audio_url), audioUrl: json.audio_url };
  }

  if (json.audio_base64) {
    const ext      = json.format || 'mp3';
    const filename = `colab_${uuidv4()}.${ext}`;
    const filepath = path.join(SONGS_DIR, filename);
    fs.writeFileSync(filepath, Buffer.from(json.audio_base64, 'base64'));
    const audioUrl = `${getBaseUrl()}/songs/${filename}`;
    console.log(`✅ [${logPrefix}] Base64 audio → ${audioUrl}`);
    return { filename, audioUrl };
  }

  throw new Error('Colab geçersiz yanıt: ' + text.slice(0, 200));
}

// ── 1. generateWithColab (eski, enstrümantal) ────────────────────
async function generateWithColab(prompt, genre, duration) {
  const safeDuration = Math.min(Number(duration || 15), 30);
  const { filename, audioUrl } = await callColab(
    'generate-music',
    { prompt, genre, duration: safeDuration },
    'Colab/Instrumental'
  );
  return { filename, audioUrl, provider: 'colab_musicgen', model: 'musicgen' };
}

// ── 2. generateSongWithRVC (YENİ — şarkıcı sesi) ────────────────
async function generateSongWithRVC(lyrics, genre, gender, duration) {
  const safeGender   = ['male', 'female'].includes((gender || '').toLowerCase())
    ? gender.toLowerCase() : 'male';
  const safeDuration = Math.min(Number(duration || 20), 60);

  console.log(`🎤 [Colab/RVC] Şarkı pipeline: genre=${genre} gender=${safeGender} dur=${safeDuration}s`);

  const { filename, audioUrl } = await callColab(
    'generate-song',
    { lyrics, genre, gender: safeGender, duration: safeDuration },
    'Colab/RVC'
  );

  return { filename, audioUrl, provider: 'colab_rvc_singer',
           model: `rvc_${safeGender}`, gender: safeGender, hasVoice: true };
}

// ── 3. generateVocalOnly (sadece RVC vokal) ──────────────────────
async function generateVocalOnly(lyrics, gender) {
  const safeGender = ['male', 'female'].includes((gender || '').toLowerCase())
    ? gender.toLowerCase() : 'male';

  const { filename, audioUrl } = await callColab(
    'generate-vocal',
    { lyrics, gender: safeGender },
    'Colab/Vocal'
  );

  return { filename, audioUrl, provider: 'colab_rvc_vocal',
           model: `rvc_${safeGender}`, gender: safeGender, hasVoice: true };
}

module.exports = { generateWithColab, generateSongWithRVC, generateVocalOnly };
