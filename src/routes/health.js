// routes/health.js — VoxeraMeta v4.1
const express = require('express');
const router  = express.Router();

router.get('/health', (req, res) => {
  const { getProviderStatus } = require('../services/musicService');
  const providers   = getProviderStatus();
  const lyricsCount = Object.values(providers.lyrics).filter(p => p.isAvailable).length;
  const musicCount  = Object.values(providers.music).filter(p => p.isAvailable).length;

  // Colab durumu: son heartbeat birkaç dakika içindeyse "bağlı"
  let colabConnected = false;
  let lastSeen       = null;
  try {
    const reg = require('../routes/colab_register');
    colabConnected = reg.isColabAlive();
    lastSeen       = reg.lastSeenSecondsAgo();
  } catch {}

  // Sözler artık varsayılan olarak LLM'siz hazırlanır; sağlık, Colab bağlantısına bağlıdır
  res.json({
    status:         colabConnected ? 'healthy' : 'degraded',
    version:        '5.1.0',
    activeLyrics:   lyricsCount,
    activeMusic:    musicCount,
    uptime:         process.uptime() * 1000,
    providers,
    allFree:        true,
    colabConnected,
    colabLastSeenSec: lastSeen,
    colabSecret:    !!process.env.COLAB_SECRET,
    message:        `Colab: ${colabConnected ? '✅ Bağlı' : '❌ Bağlı değil'} | Söz modu: ${(process.env.LYRICS_MODE || 'preserve')}`,
  });
});

router.get('/provider-status', (req, res) => {
  const { getProviderStatus } = require('../services/musicService');
  const { provider } = req.query;
  const statuses = getProviderStatus();

  if (provider) {
    const section = statuses.lyrics?.[provider] || statuses.music?.[provider];
    return res.json(section || { error: 'Provider bulunamadı' });
  }
  res.json(statuses);
});

router.get('/quota-info', (req, res) => {
  res.json({
    groq:       { limit: '1.000/gün (llama-3.3-70b)',     resetTime: 'Günlük gece yarısı UTC', cost: '$0' },
    openrouter: { limit: '200/gün (:free modeller)',       resetTime: 'Günlük',                cost: '$0' },
    gemini:     { limit: '500/gün (gemini-2.5-flash)',     resetTime: 'Gece yarısı Pacific',   cost: '$0' },
    colab:      { limit: 'T4 GPU ~12saat/gün',            resetTime: 'Colab oturumu',          cost: '$0',
                  note: 'Colab her başladığında /api/colab/register ile URL otomatik güncellenir.' }
  });
});

module.exports = router;
