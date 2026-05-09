// ============================================================
// VoxeraMeta — Backend Sunucusu (Colab MusicGen Mimarisi)
// ============================================================
require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const morgan   = require('morgan');
const rateLimit = require('express-rate-limit');
const path     = require('path');
const fs       = require('fs');

const songRoutes   = require('./routes/songs');
const healthRoutes = require('./routes/health');
const { errorHandler }  = require('./middleware/errorHandler');
const { authMiddleware } = require('./middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3000;

// Depolama dizini
const songsDir = process.env.LOCAL_STORAGE_PATH || '/tmp/voxerameta-songs';
if (!fs.existsSync(songsDir)) fs.mkdirSync(songsDir, { recursive: true });

// ── Middleware ────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Auth-Token', 'X-App-Version']
}));
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.MAX_REQUESTS_PER_MINUTE) || 20
}));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));

// Statik ses dosyası servisi
app.use('/songs', express.static(songsDir));

// Debug logger
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.path} [x-auth-token: ${req.headers['x-auth-token'] ? 'SET' : 'MISSING'}]`);
  if (req.method === 'POST') console.log(`📦 Body keys: ${Object.keys(req.body || {}).join(', ')}`);
  next();
});

// ── Routes ────────────────────────────────────────────────────
app.use('/api/v1', healthRoutes);
app.use('/api/v1', authMiddleware, songRoutes);

app.get('/', (req, res) => res.json({
  name: 'VoxeraMeta API',
  version: '3.0.0',
  subtitle: 'Colab MusicGen Mimarisi',
  providers: {
    lyrics: ['Groq (llama-3.3-70b)', 'OpenRouter (:free)', 'Google Gemini Flash'],
    music:  ['Colab MusicGen (ana)', 'Local Self-Host (gelecek)', 'Replicate (opsiyonel)']
  },
  endpoints: {
    health:    'GET  /api/v1/health',
    generate:  'POST /api/v1/generate-song',
    status:    'GET  /api/v1/song-status?id=ID',
    providers: 'GET  /api/v1/providers'
  }
}));

app.use(errorHandler);

// ── Başlangıç Logu ────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎵 VoxeraMeta v3.0 — Colab MusicGen Backend`);
  console.log(`📡 http://localhost:${PORT}\n`);

  console.log(`Auth: ${process.env.API_AUTH_TOKEN ? '🔒 Token zorunlu' : '🔓 Açık'}`);

  console.log(`\n📝 Lyrics Zinciri:`);
  console.log(`  ${process.env.GROQ_API_KEY       ? '✅' : '❌'} Groq llama-3.3-70b`);
  console.log(`  ${process.env.OPENROUTER_API_KEY  ? '✅' : '❌'} OpenRouter :free`);
  console.log(`  ${process.env.GEMINI_API_KEY       ? '✅' : '❌'} Google Gemini Flash`);

  console.log(`\n🎵 Müzik Üretim Zinciri:`);
  console.log(`  ${process.env.COLAB_MUSIC_API_URL  ? '✅' : '❌'} Colab MusicGen → ${process.env.COLAB_MUSIC_API_URL || 'URL YOK — .env güncelle'}`);
  console.log(`  ${process.env.LOCAL_MUSIC_API_URL  ? '✅' : '⏳'} Local Self-Host (gelecek)`);
  console.log(`  ${process.env.REPLICATE_API_TOKEN  ? '✅' : '⏭ '} Replicate (opsiyonel)\n`);

  if (!process.env.COLAB_MUSIC_API_URL) {
    console.warn(`⚠️  COLAB_MUSIC_API_URL tanımlı değil!`);
    console.warn(`   Colab notebook'u başlatın ve ngrok URL'sini .env'e ekleyin.`);
    console.warn(`   Bakınız: README.md → Colab Kurulum\n`);
  }
});

module.exports = app;
