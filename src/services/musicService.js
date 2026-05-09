// ============================================================
// VoxeraMeta — Müzik Üretim Servisi (Colab Mimarisi)
// Provider Zinciri: Colab MusicGen → Local (future) → Replicate (optional)
//
// Kaldırılanlar:
//   ❌ HuggingFace MusicGen entegrasyonu
//   ❌ Stability AI Stable Audio
//   ❌ demoMode fallback logic
//   ❌ HF_TOKEN / STABILITY_API_KEY bağımlılığı
//
// Eklenenler:
//   ✅ colabProvider  — Google Colab + ngrok üzerinden MusicGen
//   ✅ localProvider  — gelecek self-host için hazır stub
//   ✅ replicateProvider — opsiyonel fallback (REPLICATE_API_TOKEN yoksa atlanır)
//   ✅ MusicProvider abstraction — provider değiştirmek tek satır
// ============================================================

'use strict';

const fs = require('fs');
const { generateWithColab }     = require('./providers/colabProvider');
const { generateWithLocal }     = require('./providers/localProvider');
const { generateWithReplicate } = require('./providers/replicateProvider');

const SONGS_DIR = process.env.LOCAL_STORAGE_PATH || '/tmp/voxerameta-songs';
if (!fs.existsSync(SONGS_DIR)) fs.mkdirSync(SONGS_DIR, { recursive: true });

// ============================================================
// MusicProvider Abstraction Layer
// Yeni provider eklemek için:
//   1. src/services/providers/<ad>Provider.js oluştur
//   2. Aşağıdaki PROVIDER_CHAIN dizisine push et
// ============================================================

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

// ============================================================
// Ana Üretim Fonksiyonu
// ============================================================

async function generateMusic({ musicPrompt, genre, duration, processedLyrics }) {
  const enabledProviders = PROVIDER_CHAIN.filter(p => p.isEnabled());

  if (enabledProviders.length === 0) {
    throw new Error(
      'Hiçbir müzik provider aktif değil. ' +
      '.env dosyasına COLAB_MUSIC_API_URL ekleyin. ' +
      'Detaylar: README.md → Colab Kurulum bölümü'
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
    `Tüm müzik provider'ları başarısız:\n` +
    errors.map(e => `  • ${e}`).join('\n') + '\n' +
    'Colab notebook çalışıyor mu? ngrok URL güncel mi?'
  );
}

// ============================================================
// Provider Durum Bilgisi
// ============================================================

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
        name: 'Google Gemini Flash (Lyrics, 3. öncelik)',
        isAvailable: !!process.env.GEMINI_API_KEY,
        limit: '500 istek/gün',
        cost: 'Ücretsiz'
      }
    },
    music: {
      colab_musicgen: {
        name: 'Colab MusicGen (ANA PROVIDER)',
        isAvailable: !!process.env.COLAB_MUSIC_API_URL,
        url: process.env.COLAB_MUSIC_API_URL || null,
        limit: 'Colab GPU limiti (T4 ~12saat/gün)',
        cost: 'Ücretsiz (Google Colab)'
      },
      local_musicgen: {
        name: 'Local Self-Host MusicGen (2. öncelik — gelecek)',
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
