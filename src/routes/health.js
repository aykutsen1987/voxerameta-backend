// routes/health.js — VoxeraMeta v3
const express = require('express');
const router  = express.Router();

router.get('/health', (req, res) => {
  const { getProviderStatus } = require('../services/musicService');
  const providers   = getProviderStatus();
  const lyricsCount = Object.values(providers.lyrics).filter(p => p.isAvailable).length;
  const musicCount  = Object.values(providers.music).filter(p => p.isAvailable).length;

  res.json({
    status:         (lyricsCount > 0 && musicCount > 0) ? 'healthy' : 'degraded',
    version:        '3.0.0',
    activeLyrics:   lyricsCount,
    activeMusic:    musicCount,
    uptime:         process.uptime() * 1000,
    providers,
    allFree:        true,
    colabConnected: !!process.env.COLAB_MUSIC_API_URL,
    message:        `Lyrics: ${lyricsCount}/3 aktif | Müzik: ${musicCount}/3 aktif`
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
                  note: 'Her Colab oturumunda ngrok URL değişir → Render\'a güncelleyin' }
  });
});

module.exports = router;
