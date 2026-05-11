// ============================================================
// VoxeraMeta — Replicate Provider (Opsiyonel — future)
// Replicate üzerinde MusicGen veya AudioCraft modeli
// ============================================================

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const SONGS_DIR = process.env.LOCAL_STORAGE_PATH || '/tmp/voxerameta-songs';

// Replicate MusicGen model versiyonu (güncel versiyon için kontrol edin)
const REPLICATE_MODEL_VERSION =
  process.env.REPLICATE_MODEL_VERSION ||
  'b05b1dff1d8c6dc63d14b0cdb42135378dcb87f6942d2d4edf3ca6523a5b7a4e';

/**
 * Replicate API üzerinde MusicGen çalıştırır (polling modeli).
 * REPLICATE_API_TOKEN env değişkeni gereklidir.
 */
async function generateWithReplicate(prompt, genre, duration) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('REPLICATE_API_TOKEN env değişkeni tanımlı değil');

  const safeDuration = Math.min(duration, 30);
  console.log(`🎵 [Replicate] İstek başlatılıyor...`);

  const startRes = await axios.post(
    'https://api.replicate.com/v1/predictions',
    {
      version: REPLICATE_MODEL_VERSION,
      input: {
        prompt,
        model_version: 'melody',
        duration: safeDuration,
        output_format: 'mp3'
      }
    },
    {
      headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
      timeout: 30_000
    }
  );

  const predId = startRes.data.id;
  console.log(`   Prediction ID: ${predId}`);

  // Polling — max 3 dakika
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3_000));
    const poll = await axios.get(`https://api.replicate.com/v1/predictions/${predId}`, {
      headers: { Authorization: `Token ${token}` }
    });

    if (poll.data.status === 'succeeded' && poll.data.output) {
      const audioUrl = Array.isArray(poll.data.output) ? poll.data.output[0] : poll.data.output;
      const dlRes = await axios.get(audioUrl, { responseType: 'arraybuffer', timeout: 60_000 });
      const filename = `replicate_${uuidv4()}.mp3`;
      fs.writeFileSync(path.join(SONGS_DIR, filename), Buffer.from(dlRes.data));
      const serveUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/songs/${filename}`;
      console.log(`✅ [Replicate] Audio alındı: ${filename}`);
      return { filename, audioUrl: serveUrl, provider: 'replicate_musicgen', model: 'musicgen-melody' };
    }

    if (poll.data.status === 'failed') {
      throw new Error(`Replicate başarısız: ${poll.data.error}`);
    }
  }

  throw new Error('Replicate zaman aşımı (3 dakika)');
}

module.exports = { generateWithReplicate };
