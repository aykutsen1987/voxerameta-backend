// routes/health.js
const express = require('express');
const router = express.Router();

router.get('/health', (req, res) => {
  const { getProviderStatus } = require('../services/musicService');
  const providers = getProviderStatus();
  const activeCount = Object.values(providers).filter(p => p.isAvailable).length;

  res.json({
    status: activeCount > 0 ? 'healthy' : 'degraded',
    version: '2.0.0',
    activeProviders: activeCount,
    totalProviders: Object.keys(providers).length,
    uptime: process.uptime() * 1000,
    providers,
    allFree: true,
    message: `${activeCount}/${Object.keys(providers).length} ücretsiz provider aktif`
  });
});

router.get('/provider-status', (req, res) => {
  const { getProviderStatus } = require('../services/musicService');
  const { provider } = req.query;
  const statuses = getProviderStatus();

  if (provider) {
    const s = statuses[provider.toLowerCase()];
    return res.json(s || { error: 'Provider bulunamadı', available: ['groq','openrouter','gemini','huggingface'] });
  }
  res.json(statuses);
});

router.get('/quota-info', (req, res) => {
  res.json({
    groq: { limit: '1.000/gün (llama-3.3-70b)', resetTime: 'Günlük gece yarısı UTC', cost: '$0' },
    openrouter: { limit: '200/gün (:free modeller)', resetTime: 'Günlük', cost: '$0' },
    gemini: { limit: '500/gün (2.5-flash), 100/gün (2.5-pro)', resetTime: 'Gece yarısı Pacific Time', cost: '$0' },
    huggingface: { limit: 'Rate limitli (50-100/gün)', resetTime: 'Saatlik', cost: '$0', priority: '1. öncelik (müzik)' },
    stability_ai: { limit: '25 kredi/gün (ücretsiz tier)', resetTime: 'Günlük', cost: '$0 (ücretsiz tier)', priority: '2. öncelik / fallback (müzik)', note: 'HuggingFace başarısız olursa devreye girer. API key opsiyoneldir.' }
  });
});

module.exports = router;
