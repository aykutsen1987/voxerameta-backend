// ============================================================
// VoxeraMeta — Müzik Üretim Servisi v4.0
//
// v4 mimarisinde Colab'a DOĞRUDAN bağlantı yok.
// Colab iletişimi jobQueue + /api/colab/* route'ları üzerinden.
//
// Bu servis:
//   - Local Self-Host  — LOCAL_MUSIC_API_URL varsa
//   - Replicate        — REPLICATE_API_TOKEN varsa
//   - getProviderStatus() — health endpoint için durum raporu
// ============================================================

'use strict';

const fs = require('fs');
const { generateWithLocal }     = require('./providers/localProvider');
const { generateWithReplicate } = require('./providers/replicateProvider');

const SONGS_DIR = process.env.LOCAL_STORAGE_PATH || '/tmp/voxerameta-songs';
if (!fs.existsSync(SONGS_DIR)) fs.mkdirSync(SONGS_DIR, { recursive: true });

const PROVIDER_CHAIN = [
  {
    name:       'local_musicgen',
    isEnabled:  () => !!process.env.LOCAL_MUSIC_API_URL,
    generateFn: generateWithLocal,
  },
  {
    name:       'replicate_musicgen',
    isEnabled:  () => !!process.env.REPLICATE_API_TOKEN,
    generateFn: generateWithReplicate,
  },
];

async function generateMusic({ musicPrompt, genre, duration }) {
  const enabled = PROVIDER_CHAIN.filter(p => p.isEnabled());
  if (enabled.length === 0) {
    throw new Error(
      'Enstrümantal provider aktif değil. ' +
      'Ana pipeline Colab Worker üzerinden çalışır (jobQueue).'
    );
  }
  const errors = [];
  for (const p of enabled) {
    try {
      console.log(`🎵 [MusicService] Provider: ${p.name}`);
      return await p.generateFn(musicPrompt, genre, duration);
    } catch (err) {
      console.warn(`⚠️  [MusicService] ${p.name} başarısız: ${err.message}`);
      errors.push(`${p.name}: ${err.message}`);
    }
  }
  throw new Error('Tüm provider\'lar başarısız:\n' + errors.join('\n'));
}

function getProviderStatus() {
  return {
    lyrics: {
      groq: {
        name:        'Groq — llama-3.3-70b',
        isAvailable: !!process.env.GROQ_API_KEY,
        cost:        'Ücretsiz',
      },
      openrouter: {
        name:        'OpenRouter :free',
        isAvailable: !!process.env.OPENROUTER_API_KEY,
        cost:        'Ücretsiz',
      },
      gemini: {
        name:        'Google Gemini 2.5 Flash',
        isAvailable: !!process.env.GEMINI_API_KEY,
        cost:        'Ücretsiz',
      },
    },
    music: {
      colab_worker: {
        name:        'Colab Worker — RVC + MusicGen (Ana Pipeline)',
        isAvailable: !!process.env.COLAB_SECRET,
        note:        'Async kuyruk — ngrok URL gerekmez',
        cost:        'Ücretsiz (Google Colab)',
      },
      local_musicgen: {
        name:        'Local Self-Host MusicGen',
        isAvailable: !!process.env.LOCAL_MUSIC_API_URL,
        cost:        'Ücretsiz',
      },
      replicate_musicgen: {
        name:        'Replicate MusicGen (opsiyonel)',
        isAvailable: !!process.env.REPLICATE_API_TOKEN,
        cost:        'Ücretsiz tier',
      },
    },
  };
}

module.exports = { generateMusic, getProviderStatus };
