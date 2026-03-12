// ============================================================
// VoxeraMeta AI Müzik Üretim Servisi
// Sıralı Provider Zinciri: HuggingFace → Replicate → Stability AI → Demo
// ============================================================

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const SONGS_DIR = process.env.LOCAL_STORAGE_PATH || '/tmp/voxerameta-songs';

// ── 1. ANTHROPIC: Şiir → Şarkı Yapısı ──────────────────────
async function convertPoetryToSong(lyrics, genre, language) {
  if (!process.env.ANTHROPIC_API_KEY) return lyrics;
  const genreLabel = { POP: 'Melankolik Pop', RAP: 'Türkçe Rap', SLOW: 'Anadolu Slow', LOFI: 'Lo-fi', ACOUSTIC: 'Akustik' }[genre] || 'Pop';
  try {
    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: `Bu metni [${genreLabel}] tarzında şarkıya dönüştür.\nYapı: [Intro], [Verse 1], [Chorus], [Verse 2], [Bridge], [Outro]\nHer bölüme parantez içi müzikal direktif ekle. Sadece şarkı metnini döndür.\n\nMetin:\n${lyrics}` }]
    }, { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, timeout: 30000 });
    return response.data?.content?.[0]?.text || lyrics;
  } catch (err) {
    console.error('Anthropic hatası:', err.message);
    return lyrics;
  }
}

// ── 2. HUGGINGFACE: MusicGen (ÜCRETSİZ) ─────────────────────
async function generateWithHuggingFace(prompt, durationSeconds) {
  if (!process.env.HUGGINGFACE_API_KEY) throw new Error('HuggingFace API key eksik');
  console.log('🎵 HuggingFace MusicGen ile üretiliyor...');
  const model = durationSeconds > 120 ? 'facebook/musicgen-medium' : 'facebook/musicgen-small';
  const response = await axios.post(`https://api-inference.huggingface.co/models/${model}`,
    { inputs: prompt, parameters: { duration: Math.min(durationSeconds, 30), guidance_scale: 3, do_sample: true } },
    { headers: { 'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}` }, responseType: 'arraybuffer', timeout: 120000 }
  );
  if (response.status !== 200) throw new Error(`HuggingFace hata: ${response.status}`);
  const filename = `${uuidv4()}.wav`;
  fs.writeFileSync(path.join(SONGS_DIR, filename), Buffer.from(response.data));
  return { filename, provider: 'huggingface_musicgen' };
}

// ── 3. REPLICATE: MusicGen Fallback ──────────────────────────
async function generateWithReplicate(prompt, durationSeconds) {
  if (!process.env.REPLICATE_API_KEY) throw new Error('Replicate API key eksik');
  console.log('🎵 Replicate ile üretiliyor...');
  const startRes = await axios.post('https://api.replicate.com/v1/predictions', {
    version: 'b05b1dff1d8c6dc63d14b0cdb42135378dcb87f6942d2d4ed'+'f3ca6523a5b7a4e',
    input: { prompt, model_version: 'melody', duration: Math.min(durationSeconds, 30), output_format: 'mp3' }
  }, { headers: { 'Authorization': `Token ${process.env.REPLICATE_API_KEY}` }, timeout: 30000 });
  const predId = startRes.data.id;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const res = await axios.get(`https://api.replicate.com/v1/predictions/${predId}`,
      { headers: { 'Authorization': `Token ${process.env.REPLICATE_API_KEY}` } });
    if (res.data.status === 'succeeded' && res.data.output) {
      const audioUrl = Array.isArray(res.data.output) ? res.data.output[0] : res.data.output;
      const audioRes = await axios.get(audioUrl, { responseType: 'arraybuffer', timeout: 60000 });
      const filename = `${uuidv4()}.mp3`;
      fs.writeFileSync(path.join(SONGS_DIR, filename), Buffer.from(audioRes.data));
      return { filename, provider: 'replicate_musicgen' };
    }
    if (res.data.status === 'failed') throw new Error(`Replicate başarısız: ${res.data.error}`);
  }
  throw new Error('Replicate zaman aşımı');
}

// ── 4. STABILITY AI: Stable Audio ────────────────────────────
async function generateWithStability(prompt, durationSeconds) {
  if (!process.env.STABILITY_API_KEY) throw new Error('Stability API key eksik');
  console.log('🎵 Stability AI ile üretiliyor...');
  const response = await axios.post('https://api.stability.ai/v2beta/audio/stable-audio/generate',
    { prompt, seconds_start: 0, seconds_total: Math.min(durationSeconds, 45), cfg_scale: 7 },
    { headers: { 'Authorization': `Bearer ${process.env.STABILITY_API_KEY}`, 'Accept': 'audio/mpeg' }, responseType: 'arraybuffer', timeout: 120000 }
  );
  const filename = `${uuidv4()}.mp3`;
  fs.writeFileSync(path.join(SONGS_DIR, filename), Buffer.from(response.data));
  return { filename, provider: 'stability_ai' };
}

// ── 5. DEMO Fallback ─────────────────────────────────────────
async function generateFallback(genre) {
  console.log('⚠️  Demo modu aktif — API anahtarları eksik');
  return { filename: null, provider: 'fallback_demo', demoMode: true,
    message: `Demo mod. .env dosyasına API anahtarı ekle. Genre: ${genre}` };
}

// ── ANA FONKSİYON ─────────────────────────────────────────────
async function generateMusic({ lyrics, genre, duration, language, sunoStylePrompt, hasMelodyReference, hybridMode }) {
  const musicPrompt = sunoStylePrompt || buildMusicPrompt(lyrics, genre);
  let processedLyrics = lyrics;
  if (hybridMode) processedLyrics = await convertPoetryToSong(lyrics, genre, language);

  const providers = [
    () => generateWithHuggingFace(musicPrompt, duration),
    () => generateWithReplicate(musicPrompt, duration),
    () => generateWithStability(musicPrompt, duration),
    () => generateFallback(genre)
  ];

  for (const fn of providers) {
    try { return { ...(await fn()), processedLyrics, originalLyrics: lyrics, musicPrompt }; }
    catch (err) { console.warn(`⚠️  Provider başarısız: ${err.message}`); }
  }
  throw new Error('Tüm providerlar başarısız');
}

function buildMusicPrompt(lyrics, genre) {
  const styles = { POP: 'melodic pop, emotional piano, soft drums', RAP: 'hip-hop beat, 808 bass, trap hi-hats',
    SLOW: 'slow ballad, classical guitar, violin', LOFI: 'lo-fi hip hop, vinyl crackle, mellow chords', ACOUSTIC: 'acoustic guitar, fingerpicking, natural reverb' };
  const style = styles[genre] || 'melodic, emotional';
  return `${style}. Inspired by: "${lyrics.substring(0, 100).replace(/\n/g, ' ')}"`;
}

module.exports = { generateMusic, convertPoetryToSong };
