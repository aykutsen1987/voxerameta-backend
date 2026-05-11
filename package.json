// ============================================================
// VoxeraMeta — Backend Sunucusu v4.0 (Render)
//
// Değişiklikler (v4):
//   - /api/colab/* route'ları eklendi (Colab worker iletişimi)
//   - colabProvider.js kaldırıldı (artık jobQueue kullanılıyor)
//   - multer eklendi (Colab'dan ses dosyası almak için)
// ============================================================

require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const morgan    = require('morgan');
const rateLimit = require('express-rate-limit');
const fs        = require('fs');

const songRoutes   = require('./routes/songs');
const healthRoutes = require('./routes/health');
const colabRoutes  = require('./routes/colab');
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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Auth-Token', 'X-App-Version'],
}));
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.MAX_REQUESTS_PER_MINUTE) || 20,
}));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));

// Statik ses dosyası servisi
app.use('/songs', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Accept-Ranges', 'bytes');
  next();
}, express.static(songsDir, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.wav')) res.setHeader('Content-Type', 'audio/wav');
    if (filePath.endsWith('.mp3')) res.setHeader('Content-Type', 'audio/mpeg');
  },
}));

// Debug logger
app.use((req, res, next) => {
  if (!req.path.startsWith('/songs')) {
    console.log(`📥 ${req.method} ${req.path}`);
  }
  next();
});

// ── Routes ───────────────────────────────────────────────────
app.use('/api/v1',    healthRoutes);
app.use('/api/v1',    authMiddleware, songRoutes);
app.use('/api/colab', colabRoutes);   // Colab worker — kendi auth'u var (X-Colab-Secret)

app.get('/', (req, res) => res.json({
  name:     'VoxeraMeta API',
  version:  '4.0.0',
  subtitle: 'Colab Worker + MusicGen + RVC Pipeline',
  architecture: 'async-queue',
  providers: {
    lyrics: ['Groq llama-3.3-70b', 'OpenRouter :free', 'Google Gemini 2.5 Flash'],
    music:  ['Colab Worker (RVC + MusicGen)'],
  },
  endpoints: {
    health:      'GET  /api/v1/health',
    generate:    'POST /api/v1/generate-song  → 202 + jobId',
    status:      'GET  /api/v1/song-status?id=JOB_ID',
    queueStats:  'GET  /api/v1/queue-stats',
    providers:   'GET  /api/v1/providers',
    colabNext:   'GET  /api/colab/next-job    (Colab worker)',
    colabDone:   'POST /api/colab/job-done    (Colab worker)',
    colabError:  'POST /api/colab/job-error   (Colab worker)',
    colabStatus: 'GET  /api/colab/status      (Colab worker)',
  },
}));

app.use(errorHandler);

// ── Başlangıç Logu ────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎵 VoxeraMeta v4.0 — Render Backend`);
  console.log(`📡 http://localhost:${PORT}\n`);

  console.log(`📝 Lyrics Zinciri:`);
  console.log(`  ${process.env.GROQ_API_KEY        ? '✅' : '❌'} Groq llama-3.3-70b`);
  console.log(`  ${process.env.OPENROUTER_API_KEY   ? '✅' : '❌'} OpenRouter :free`);
  console.log(`  ${process.env.GEMINI_API_KEY        ? '✅' : '❌'} Google Gemini 2.5 Flash`);

  console.log(`\n🎵 Colab Worker:`);
  console.log(`  ${process.env.COLAB_SECRET  ? '✅' : '❌'} COLAB_SECRET (worker kimlik doğrulaması)`);
  console.log(`  ${process.env.BASE_URL      ? '✅' : '❌'} BASE_URL → ${process.env.BASE_URL || 'YOK!'}`);

  if (!process.env.COLAB_SECRET) {
    console.warn(`\n⚠️  COLAB_SECRET tanımlı değil!`);
    console.warn(`   Render Dashboard → Environment → COLAB_SECRET ekleyin.`);
    console.warn(`   Colab notebook'taki COLAB_SECRET ile aynı olmalı.\n`);
  }
  if (!process.env.BASE_URL) {
    console.warn(`⚠️  BASE_URL tanımlı değil! Ses dosyası URL'leri çalışmaz.`);
    console.warn(`   Render Dashboard → Settings → Custom Domains veya onrender.com adresi.\n`);
  }
});

module.exports = app;
