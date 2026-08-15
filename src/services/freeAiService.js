// ============================================================
// VoxeraMeta — Ücretsiz AI Şarkı Sözü İşleme Servisi
// Zincir: Groq → OpenRouter (:free) → Gemini 2.5 Flash → Ham metin
//
// NOT: Bu servis RENDER'da çalışır. Colab notebook'ta kullanılmaz.
//      Müzik üretimi: musicService.js + colabProvider.js
// ============================================================

const axios = require('axios');

// ── Türkçe Şarkı Yapısı Promptu ──────────────────────────────
function buildLyricsPrompt(lyrics, genre) {
  const styleMap = {
    POP:      'melankolik Türkçe pop',
    RAP:      'Türkçe rap / hip-hop',
    SLOW:     'Anadolu slow / türkü',
    LOFI:     'lo-fi chill / sakin',
    ACOUSTIC: 'akustik folk / bağlama',
    ARABESK:  'Türkçe arabesk / duygusal',
    ROCK:     'Türkçe rock'
  };
  const style = styleMap[genre] || 'melodic pop';

  return `Sen bir profesyonel Türkçe şarkı yazarısın.
Aşağıdaki şiiri/metni "${style}" tarzında bir şarkıya dönüştür.

KURALLAR:
- Yapı: [Intro], [Verse 1], [Chorus], [Verse 2], [Bridge], [Outro]
- Her bölümün başına köşeli parantez içinde müzikal direktif ekle. Örnek: [Slow Piano Intro]
- Hece sayılarını melodi akışına göre düzenle
- Chorus kısmını akılda kalıcı ve tekrarlanabilir yap
- SADECE şarkı metnini döndür, açıklama veya başlık ekleme

Dönüştürülecek metin:
${lyrics}`;
}

// ── 1. GROQ (Ücretsiz — 1.000/gün) ───────────────────────────
// NOT: llama-3.3-70b-versatile Groq tarafindan kaldirildi (16.08.2026).
// Birincil: openai/gpt-oss-120b, yedek: qwen/qwen3.6-27b.
const GROQ_MODELS = ['openai/gpt-oss-120b', 'qwen/qwen3.6-27b'];

async function processWithGroq(lyrics, genre) {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY eksik');

  let lastError = null;
  for (const model of GROQ_MODELS) {
    try {
      const res = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model,
          messages: [{ role: 'user', content: buildLyricsPrompt(lyrics, genre) }],
          max_tokens: 1500,
          temperature: 0.8
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 20000
        }
      );

      const text = res.data?.choices?.[0]?.message?.content;
      if (!text) throw new Error('Groq boş yanıt döndürdü');
      console.log(`✅ Groq (${model}) lyrics işlemi başarılı`);
      return { text, provider: `groq_${model.replace(/[^a-z0-9]/gi, '_')}`, model };
    } catch (err) {
      console.warn(`⚠️  Groq ${model} başarısız: ${err.message}`);
      lastError = err;
    }
  }
  throw lastError || new Error('Groq tüm modeller başarısız');
}

// ── 2. OPENROUTER :free Modeller (200/gün) ────────────────────
async function processWithOpenRouter(lyrics, genre) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY eksik');

  const freeModels = [
    'meta-llama/llama-3.3-70b-instruct:free',
    'mistralai/mistral-small-3.1-24b-instruct:free',
    'google/gemini-2.0-flash-exp:free',
    'deepseek/deepseek-chat-v3-0324:free'
  ];

  let lastError = null;
  for (const model of freeModels) {
    try {
      const res = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model,
          messages: [{ role: 'user', content: buildLyricsPrompt(lyrics, genre) }],
          max_tokens: 1500,
          temperature: 0.8
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://voxerameta.app',
            'X-Title': 'VoxeraMeta'
          },
          timeout: 30000
        }
      );

      const text = res.data?.choices?.[0]?.message?.content;
      if (!text) throw new Error('Boş yanıt');
      console.log(`✅ OpenRouter (${model}) lyrics işlemi başarılı`);
      return { text, provider: 'openrouter', model };
    } catch (err) {
      console.warn(`⚠️  OpenRouter ${model} başarısız: ${err.message}`);
      lastError = err;
    }
  }
  throw lastError || new Error('OpenRouter tüm modeller başarısız');
}

// ── 3. GOOGLE GEMINI 2.5 FLASH (Ücretsiz — 500/gün) ──────────
// NOT: Render'da çalışır. Colab'da KULLANILMAZ.
async function processWithGemini(lyrics, genre) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY eksik');

  const res = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      contents: [{
        parts: [{ text: buildLyricsPrompt(lyrics, genre) }]
      }],
      generationConfig: {
        maxOutputTokens: 1500,
        temperature: 0.8
      }
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    }
  );

  const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini boş yanıt döndürdü');
  console.log('✅ Gemini 2.5 Flash lyrics işlemi başarılı');
  return { text, provider: 'google_gemini_flash', model: 'gemini-2.5-flash' };
}

// ── ANA FONKSİYON: Sıralı Zincir ─────────────────────────────
async function processLyrics(lyrics, genre) {
  if (!lyrics || lyrics.trim().length < 5) return { text: lyrics, provider: 'passthrough' };

  const chain = [
    () => processWithGroq(lyrics, genre),
    () => processWithOpenRouter(lyrics, genre),
    () => processWithGemini(lyrics, genre)
  ];

  for (const fn of chain) {
    try {
      return await fn();
    } catch (err) {
      console.warn(`⚠️  Provider başarısız: ${err.message}`);
    }
  }

  console.log('⚠️  Tüm AI servisler yanıt vermedi — orijinal lyrics kullanılıyor');
  return { text: lyrics, provider: 'passthrough', model: 'none' };
}

// ── Müzik Stil Promptu ────────────────────────────────────────
function buildMusicStylePrompt(genre, hasVoiceRef) {
  const styles = {
    POP:      'turkish pop, emotional piano, soft acoustic guitar, lush strings, female vocal, 85 bpm',
    RAP:      'turkish hip-hop, 808 bass, trap hi-hats, dark melodic beat, male rap vocal, 95 bpm',
    SLOW:     'turkish slow, saz/baglama, classical oud, emotional violin, warm male vocal, 60 bpm',
    LOFI:     'lo-fi chill, vinyl crackle, mellow piano, soft jazz chords, relaxed 75 bpm',
    ACOUSTIC: 'acoustic turkish folk, fingerpicking guitar, natural reverb, intimate storytelling vocal',
    ARABESK:  'turkish arabesk, oud, melancholic, minor key, emotional strings, 70 bpm',
    ROCK:     'turkish rock, electric guitar, powerful drums, energy, 130 bpm'
  };
  const base = styles[genre] || styles.POP;
  return hasVoiceRef
    ? `${base}, voice cloned, reference vocal applied`
    : base;
}

module.exports = { processLyrics, buildMusicStylePrompt, buildLyricsPrompt };
