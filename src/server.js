// src/server.js — VoxeraMeta v2.0 Tamamen Ücretsiz Backend
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const songRoutes = require('./routes/songs');
const healthRoutes = require('./routes/health');
const { errorHandler } = require('./middleware/errorHandler');
const { authMiddleware } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Depolama dizini
const songsDir = process.env.LOCAL_STORAGE_PATH || '/tmp/voxerameta-songs';
if (!fs.existsSync(songsDir)) fs.mkdirSync(songsDir, { recursive: true });

app.use(helmet());
app.use(cors({ origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'Authorization', 'X-Auth-Token', 'X-App-Version'] }));
app.use(rateLimit({ windowMs: 60 * 1000, max: parseInt(process.env.MAX_REQUESTS_PER_MINUTE) || 20 }));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use('/songs', express.static(songsDir));

// Auth gerektirmeyen: health
app.use('/api/v1', healthRoutes);
// Auth gerektiren: şarkı üretim
app.use('/api/v1', authMiddleware, songRoutes);

app.get('/', (req, res) => res.json({
  name: 'VoxeraMeta API',
  version: '2.0.0',
  subtitle: 'Tamamen Ücretsiz AI Müzik',
  providers: {
    lyrics: ['Groq (llama-3.3-70b)', 'OpenRouter (:free)', 'Google Gemini 2.5 Flash'],
    music: ['HuggingFace MusicGen (1. öncelik)', 'Stability AI Stable Audio (2. öncelik — fallback)']
  },
  endpoints: {
    health: 'GET /api/v1/health',
    generate: 'POST /api/v1/generate-song',
    status: 'GET /api/v1/song-status?id=ID',
    providers: 'GET /api/v1/providers',
    quota: 'GET /api/v1/quota-info'
  }
}));

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`\n🎵 VoxeraMeta v2.0 Backend — http://localhost:${PORT}`);
  console.log(`💰 Maliyet: SIFIR TL\n`);
  console.log(`AI Providers (Lyrics Zinciri):`);
  console.log(`  ${process.env.GROQ_API_KEY ? '✅' : '❌'} Groq llama-3.3-70b (1.000 istek/gün)`);
  console.log(`  ${process.env.OPENROUTER_API_KEY ? '✅' : '❌'} OpenRouter :free (200 istek/gün)`);
  console.log(`  ${process.env.GEMINI_API_KEY ? '✅' : '❌'} Google Gemini 2.5 Flash (500 istek/gün)`);
  console.log(`\nMüzik Üretim Zinciri:`);
  console.log(`  ${process.env.HUGGINGFACE_API_KEY ? '✅' : '❌'} HuggingFace MusicGen (ücretsiz — 1. öncelik)`);
  console.log(`  ${process.env.STABILITY_AI_API_KEY ? '✅' : '⚠️ '} Stability AI Stable Audio (25 kredi/gün — 2. öncelik / fallback)\n`);
});

module.exports = app;
