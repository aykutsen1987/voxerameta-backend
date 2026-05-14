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
app.use(helmet());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Auth-Token', 'X-App-Version', 'X-Colab-Secret'],
}));
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.MAX_REQUESTS_PER_MINUTE) || 20,
}));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));

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
