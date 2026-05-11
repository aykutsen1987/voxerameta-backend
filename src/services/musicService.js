// ============================================================
// VoxeraMeta — Müzik Üretim Servisi (Render Mimarisi)
//
// Provider Zinciri (öncelik sırasıyla):
//   1. Colab MusicGen   — COLAB_MUSIC_API_URL varsa
//   2. Local Self-Host  — LOCAL_MUSIC_API_URL varsa
//   3. Replicate        — REPLICATE_API_TOKEN varsa
//
// NOT: Bu dosya RENDER'da çalışır. Colab notebook'ta kullanılmaz.
//      Gemini 2.5 Flash / Groq / OpenRouter → freeAiService.js (lyrics)
// ============================================================

'use strict';

const fs = require('fs');
const { generateWithColab }     = require('./providers/colabProvider');
const { generateWithLocal }     = require('./providers/localProvider');
const { generateWithReplicate } = require('./providers/replicateProvider');

const SONGS_DIR = process.env.LOCAL_STORAGE_PATH || '/tmp/voxerameta-songs';
if (!fs.existsSync(SONGS_DIR)) fs.mkdirSync(SONGS_DIR, { recursive: true });

const PROVIDER_CHAIN = [
  {
    name: 'colab_musicgen',
    isEnabled: () => !!process.env.COLAB_MUSIC_API_URL,
    generateFn: generateWithColab
  },
  {
    name: 'local_musicgen',
    isEnabled: () => !!process.env.LOCAL_MUSIC_API_URL,
    generateFn: generateWithLocal
  },
  {
    name: 'replicate_musicgen',
    isEnabled: () => !!process.env.REPLICATE_API_TOKEN,
    generateFn: generateWithReplicate
  }
];

async function generateMusic({ musicPrompt, genre, duration, processedLyrics }) {
  const enabledProviders = PROVIDER_CHAIN.filter(p => p.isEnabled());

  if (enabledProviders.length === 0) {
    throw new Error(
      'Hiçbir müzik provider aktif değil. ' +
      "Render Dashboard'a COLAB_MUSIC_API_URL ekleyin. " +
      'Detaylar: RENDER_ENV_SETUP.md'
    );
  }

  const errors = [];
  for (const provider of enabledProviders) {
    try {
      console.log(`🎵 [MusicService] Provider deneniyor: ${provider.name}`);
      const result = await provider.generateFn(musicPrompt, genre, duration);
      console.log(`✅ [MusicService] Başarılı: ${provider.name}`);
      return result;
    } catch (err) {
      console.warn(`⚠️  [MusicService] ${provider.name} başarısız: ${err.message}`);
      errors.push(`${provider.name}: ${err.message}`);
    }
  }

  throw new Error(
    "Tüm müzik provider'ları başarısız:\n" +
    errors.map(e => `  • ${e}`).join('\n') + '\n' +
    'Colab notebook çalışıyor mu? ngrok URL güncel mi?'
  );
}

function getProviderStatus() {
  return {
    lyrics: {
      groq: {
        name: 'Groq — llama-3.3-70b (Lyrics, 1. öncelik)',
        isAvailable: !!process.env.GROQ_API_KEY,
        limit: '1.000 istek/gün',
        cost: 'Ücretsiz'
      },
      openrouter: {
        name: 'OpenRouter :free (Lyrics, 2. öncelik)',
        isAvailable: !!process.env.OPENROUTER_API_KEY,
        limit: '200 istek/gün',
        cost: 'Ücretsiz'
      },
      gemini: {
        name: 'Google Gemini 2.5 Flash (Lyrics, 3. öncelik)',
        isAvailable: !!process.env.GEMINI_API_KEY,
        limit: '500 istek/gün',
        cost: 'Ücretsiz'
      }
    },
    music: {
      colab_musicgen: {
        name: 'Colab MusicGen + RVC (ANA PROVIDER)',
        isAvailable: !!process.env.COLAB_MUSIC_API_URL,
        url: process.env.COLAB_MUSIC_API_URL
          ? process.env.COLAB_MUSIC_API_URL.replace(/\/(generate-music|generate-song)$/, '')
          : null,
        limit: 'Colab GPU limiti (T4 ~12saat/gün)',
        cost: 'Ücretsiz (Google Colab)'
      },
      local_musicgen: {
        name: 'Local Self-Host MusicGen (2. öncelik)',
        isAvailable: !!process.env.LOCAL_MUSIC_API_URL,
        limit: 'Kendi sunucu kapasitesi',
        cost: 'Ücretsiz'
      },
      replicate_musicgen: {
        name: 'Replicate MusicGen (3. öncelik — opsiyonel)',
        isAvailable: !!process.env.REPLICATE_API_TOKEN,
        limit: 'Replicate ücretsiz tier',
        cost: 'Ücretsiz tier / kullanıma göre'
      }
    }
  };
}

module.exports = { generateMusic, getProviderStatus };
