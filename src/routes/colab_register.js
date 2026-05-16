// ============================================================
// VoxeraMeta — Colab URL Kayıt Endpoint'i
//
// Colab her başladığında kendi ngrok URL'ini buraya bildirir.
// Bu sayede Render env değişkenini güncellemeye gerek kalmaz.
// ============================================================
'use strict';

const express = require('express');
const router  = express.Router();

// Colab'ın ngrok URL'ini bellekte tut
let _colabUrl = process.env.COLAB_URL || null;

// Colab → Render: "Benim URL'm bu"
// POST /api/colab/register  { colab_url, secret }
router.post('/register', express.json(), (req, res) => {
  const secret = req.body.secret || req.headers['x-colab-secret'];
  if (!secret || secret !== process.env.COLAB_SECRET) {
    console.warn(`⛔ [Colab Register] Yetkisiz istek — IP: ${req.ip}`);
    return res.status(401).json({ error: 'Geçersiz secret' });
  }

  const newUrl = (req.body.colab_url || '').trim()
    .replace(/\/$/, '')
    .replace(/\/process$/, '');  // Colab bazen /process ile birlikte gönderir — strip et
  if (!newUrl.startsWith('http')) {
    return res.status(400).json({ error: 'Geçersiz colab_url' });
  }

  _colabUrl = newUrl;
  // jobQueue da güncelle
  process.env.COLAB_URL = newUrl;
  console.log(`✅ [Colab Register] URL güncellendi → ${newUrl}`);
  res.json({ ok: true, colab_url: newUrl });
});

// Mevcut URL'i öğren (debug)
router.get('/status', (req, res) => {
  res.json({
    colab_url: _colabUrl || null,
    connected: !!_colabUrl,
    colab_secret_set: !!process.env.COLAB_SECRET,
    base_url: process.env.BASE_URL || null,
  });
});

// Diğer modüller için getter
function getColabUrl() { return _colabUrl; }

module.exports = { router, getColabUrl };
