// ============================================================
// VoxeraMeta — Colab MusicGen Provider
// POST https://<ngrok-url>/generate-music
// input : { prompt, genre, duration }
// output: audio binary (wav/mp3) veya { audio_url: "..." }
// ============================================================

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const SONGS_DIR = process.env.LOCAL_STORAGE_PATH || '/tmp/voxerameta-songs';

/**
 * Google Colab üzerinde çalışan MusicGen Flask/FastAPI sunucusuna istek atar.
 *
 * Colab endpoint'i iki farklı yanıt formatı döndürebilir:
 *   A) Binary audio (Content-Type: audio/*) — doğrudan WAV/MP3 baytları
 *   B) JSON  { audio_url: "https://..." }   — indirilecek URL
 *
 * Her iki format da desteklenmektedir.
 *
 * @param {string} prompt      - Müzik stil açıklaması
 * @param {string} genre       - POP | RAP | SLOW | LOFI | ACOUSTIC
 * @param {number} duration    - Saniye cinsinden süre (Colab kısıtlamasına göre kırpılır)
 * @returns {{ filename, audioUrl, provider, model }}
 */
async function generateWithColab(prompt, genre, duration) {
  const colabUrl = process.env.COLAB_MUSIC_API_URL;
  if (!colabUrl) throw new Error('COLAB_MUSIC_API_URL env değişkeni tanımlı değil');

  const safeDuration = Math.min(duration, 30); // MusicGen-small max ~30sn

  console.log(`🎵 [Colab MusicGen] İstek gönderiliyor → ${colabUrl}`);
  console.log(`   Prompt  : ${prompt.substring(0, 80)}...`);
  console.log(`   Genre   : ${genre} | Duration: ${safeDuration}s`);

  // ── İstek ────────────────────────────────────────────────────
  const response = await axios.post(
  `${colabUrl}/generate-music`,
  { prompt, genre, duration: safeDuration },
  {
    headers: { 'Content-Type': 'application/json' },
    responseType: 'arraybuffer',
    timeout: 300000
  }
);

  if (response.status !== 200) {
    throw new Error(`Colab MusicGen HTTP ${response.status}`);
  }

  const contentType = response.headers['content-type'] || '';

  // ── Senaryo A: Binary Audio ───────────────────────────────────
  if (contentType.startsWith('audio/')) {
    const ext = contentType.includes('mpeg') ? 'mp3' : 'wav';
    const filename = `colab_${uuidv4()}.${ext}`;
    const filepath = path.join(SONGS_DIR, filename);
    fs.writeFileSync(filepath, Buffer.from(response.data));

    const audioUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/songs/${filename}`;
    console.log(`✅ [Colab MusicGen] Binary audio alındı: ${filename}`);
    return { filename, audioUrl, provider: 'colab_musicgen', model: 'musicgen' };
  }

  // ── Senaryo B: JSON { audio_url } ────────────────────────────
  try {
    const json = JSON.parse(Buffer.from(response.data).toString('utf8'));

    if (json.audio_url) {
      // Uzak URL'den indir
      const dlRes = await axios.get(json.audio_url, {
        responseType: 'arraybuffer',
        timeout: 120_000
      });
      const ext = json.audio_url.endsWith('.mp3') ? 'mp3' : 'wav';
      const filename = `colab_${uuidv4()}.${ext}`;
      const filepath = path.join(SONGS_DIR, filename);
      fs.writeFileSync(filepath, Buffer.from(dlRes.data));

      const audioUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/songs/${filename}`;
      console.log(`✅ [Colab MusicGen] URL üzerinden audio indirildi: ${filename}`);
      return { filename, audioUrl, provider: 'colab_musicgen', model: 'musicgen' };
    }

    if (json.error) throw new Error(`Colab hata mesajı: ${json.error}`);
  } catch (parseErr) {
    // JSON parse başarısız → bilinmeyen format
    throw new Error(`Colab bilinmeyen yanıt formatı: ${parseErr.message}`);
  }

  throw new Error('Colab yanıtı ne binary audio ne de {audio_url} içeriyor');
}

module.exports = { generateWithColab };
