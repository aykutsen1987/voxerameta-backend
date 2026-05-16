// ============================================================
// VoxeraMeta — Backend Sunucusu v4.1 (Render)
//
// v4.1 değişiklikleri:
//   - /api/colab/register endpoint'i eklendi (Colab URL otomatik kayıt)
//   - Colab URL artık env gerekmeden runtime'da güncellenir
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
const { router: colabRegisterRouter } = require('./routes/colab_register');
const { errorHandler }  = require('./middleware/errorHandler');
const { authMiddleware } = require('./middleware/auth');

const app  = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

const songsDir = process.env.LOCAL_STORAGE_PATH || '/tmp/voxerameta-songs';
if (!fs.existsSync(songsDir)) fs.mkdirSync(songsDir, { recursive: true });

// ── Middleware ────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Auth-Token', 'X-App-Version', 'X-Colab-Secret'],
}));

// Rate limit: SADECE generate-song'da, poll endpoint'leri hariç
app.use('/api/v1/generate-song', rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.MAX_REQUESTS_PER_MINUTE) || 30,
  message: { error: 'Çok fazla istek. 1 dakika bekleyin.', retry_after: 60 },
  standardHeaders: true,
  legacyHeaders: false,
}));

app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));

// ── BASE_URL otomatik tespiti (Render'da RENDER_EXTERNAL_URL set edilir) ──────
if (!process.env.BASE_URL && process.env.RENDER_EXTERNAL_URL) {
  process.env.BASE_URL = process.env.RENDER_EXTERNAL_URL;
}
if (!process.env.BASE_URL) {
  process.env.BASE_URL = 'https://voxerameta-ai-backend.onrender.com';
}

// ── Render free tier uyku önleyici self-ping ──────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const https = require('https');
  const http  = require('http');
  setInterval(() => {
    const url  = (process.env.BASE_URL || '').replace(/\/$/, '') + '/api/v1/health';
    const mod  = url.startsWith('https') ? https : http;
    mod.get(url, (r) => {
      if (r.statusCode !== 200) console.log(`⏰ Self-ping: ${r.statusCode}`);
    }).on('error', () => {});
  }, 14 * 60 * 1000); // 14 dakikada bir — Render 15 dakikada uyutuyor
  console.log('⏰ Self-ping aktif (14dk)');
}

app.use('/songs', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  next();
}, express.static(songsDir, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.wav')) {
      res.setHeader('Content-Type', 'audio/wav');
    }
    if (filePath.endsWith('.mp3')) {
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Accept-Ranges', 'bytes');
    }
  },
}));

// /songs/:id.mp3 bulunamazsa 404 yerine açıklayıcı JSON ver
app.use('/songs', (req, res) => {
  res.status(404).json({ error: 'Ses dosyası bulunamadı', path: req.path,
    hint: 'Render free tier /tmp klasörünü sıfırlar. Colab\'dan tekrar üretin.' });
});

app.use((req, res, next) => {
  if (!req.path.startsWith('/songs')) console.log(`📥 ${req.method} ${req.path}`);
  next();
});

// ── Routes ───────────────────────────────────────────────────
app.use('/api/v1',    healthRoutes);
app.use('/api/v1',    authMiddleware, songRoutes);
app.use('/api/colab', colabRoutes);
app.use('/api/colab', colabRegisterRouter);  // YENİ: register + status

app.get('/', (req, res) => res.json({
  name:    'VoxeraMeta API',
  version: '4.1.0',
  endpoints: {
    health:         'GET  /api/v1/health',
    generate:       'POST /api/v1/generate-song',
    status:         'GET  /api/v1/song-status?id=JOB_ID',
    colabRegister:  'POST /api/colab/register  (Colab → URL bildir)',
    colabStatus:    'GET  /api/colab/status     (Colab bağlı mı?)',
    colabCallback:  'POST /api/colab/callback   (Colab → ses gönder)',
    colabError:     'POST /api/colab/error      (Colab → hata bildir)',
  },
}));

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`\n🎵 VoxeraMeta v4.1 — Render Backend`);
  console.log(`📡 http://localhost:${PORT}\n`);
  console.log(`📝 Lyrics Zinciri:`);
  console.log(`  ${process.env.GROQ_API_KEY       ? '✅' : '❌'} Groq`);
  console.log(`  ${process.env.OPENROUTER_API_KEY  ? '✅' : '❌'} OpenRouter`);
  console.log(`  ${process.env.GEMINI_API_KEY       ? '✅' : '❌'} Gemini`);
  console.log(`\n🎵 Colab Worker:`);
  console.log(`  ${process.env.COLAB_SECRET ? '✅' : '❌'} COLAB_SECRET`);
  console.log(`  ${process.env.BASE_URL     ? '✅' : '❌'} BASE_URL → ${process.env.BASE_URL || 'YOK!'}`);
  console.log(`  ℹ️  COLAB_URL → Colab /api/colab/register ile otomatik güncellenir`);
});

module.exports = app;
