// ============================================================
// VoxeraMeta — Colab URL Kayıt Endpoint'i v4.2
//
// v4.2: Colab register olduğunda bekleyen işleri otomatik flush et
// ============================================================
'use strict';

const express = require('express');
const router  = express.Router();

let _colabUrl = process.env.COLAB_URL || null;

// Colab → Render: URL bildir
// POST /api/colab/register  { colab_url, secret }
router.post('/register', express.json(), async (req, res) => {
  const secret = req.body.secret || req.headers['x-colab-secret'];
  if (!secret || secret !== process.env.COLAB_SECRET) {
    console.warn(`⛔ [Colab Register] Yetkisiz istek — IP: ${req.ip}`);
    return res.status(401).json({ error: 'Geçersiz secret' });
  }

  const newUrl = (req.body.colab_url || '').trim()
    .replace(/\/$/, '')
    .replace(/\/process$/, '');
  if (!newUrl.startsWith('http')) {
    return res.status(400).json({ error: 'Geçersiz colab_url' });
  }

  _colabUrl = newUrl;
  process.env.COLAB_URL = newUrl;
  console.log(`✅ [Colab Register] URL güncellendi → ${newUrl}`);

  // [FIX] Yeni Colab bağlandığında bekleyen işleri otomatik push et
  try {
    const queue = require('../services/jobQueue');
    const flushed = await queue.flushPending();
    if (flushed > 0) {
      console.log(`📤 [Colab Register] ${flushed} bekleyen iş Colab'a iletildi`);
    }
  } catch (e) {
    console.warn(`⚠️  [Colab Register] flushPending hatası: ${e.message}`);
  }

  res.json({ ok: true, colab_url: newUrl });
});

// Mevcut URL'i öğren (debug)
router.get('/status', (req, res) => {
  res.json({
    colab_url:        _colabUrl || null,
    connected:        !!_colabUrl,
    colab_secret_set: !!process.env.COLAB_SECRET,
    base_url:         process.env.BASE_URL || null,
  });
});

function getColabUrl() { return _colabUrl; }

module.exports = { router, getColabUrl };
