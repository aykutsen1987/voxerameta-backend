// ============================================================
// VoxeraMeta — Local Provider (Gelecek: self-host MusicGen)
// Kendi sunucunda veya Docker container'ında çalışan endpoint
// ============================================================

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const SONGS_DIR = process.env.LOCAL_STORAGE_PATH || '/tmp/voxerameta-songs';

/**
 * Yerel / self-host MusicGen veya benzeri servise bağlanır.
 * LOCAL_MUSIC_API_URL env değişkeni ile yapılandırılır.
 * API contract Colab provider ile aynıdır:
 *   POST <url>  { prompt, genre, duration }
 *   → binary audio  VEYA  { audio_url }
 *
 * @param {string} prompt
 * @param {string} genre
 * @param {number} duration
 */
async function generateWithLocal(prompt, genre, duration) {
  const localUrl = process.env.LOCAL_MUSIC_API_URL;
  if (!localUrl) throw new Error('LOCAL_MUSIC_API_URL env değişkeni tanımlı değil');

  console.log(`🎵 [Local Provider] İstek gönderiliyor → ${localUrl}`);

  const response = await axios.post(
    localUrl,
    { prompt, genre, duration: Math.min(duration, 30) },
    { responseType: 'arraybuffer', timeout: 180_000 }
  );

  if (response.status !== 200) throw new Error(`Local Provider HTTP ${response.status}`);

  const contentType = response.headers['content-type'] || '';

  if (contentType.startsWith('audio/')) {
    const ext = contentType.includes('mpeg') ? 'mp3' : 'wav';
    const filename = `local_${uuidv4()}.${ext}`;
    fs.writeFileSync(path.join(SONGS_DIR, filename), Buffer.from(response.data));
    const audioUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/songs/${filename}`;
    console.log(`✅ [Local Provider] Audio alındı: ${filename}`);
    return { filename, audioUrl, provider: 'local_musicgen', model: 'musicgen-local' };
  }

  // JSON fallback
  const json = JSON.parse(Buffer.from(response.data).toString('utf8'));
  if (json.audio_url) {
    const dlRes = await axios.get(json.audio_url, { responseType: 'arraybuffer', timeout: 60_000 });
    const filename = `local_${uuidv4()}.wav`;
    fs.writeFileSync(path.join(SONGS_DIR, filename), Buffer.from(dlRes.data));
    const audioUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/songs/${filename}`;
    return { filename, audioUrl, provider: 'local_musicgen', model: 'musicgen-local' };
  }

  throw new Error('Local Provider bilinmeyen yanıt formatı');
}

module.exports = { generateWithLocal };
