// ============================================================
// VoxeraMeta — Backend Sunucusu v5.0 (Render)
// ============================================================

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const fs         = require('fs');

const songRoutes         = require('./routes/songs');
const healthRoutes       = require('./routes/health');
const colabRoutes        = require('./routes/colab');
const { errorHandler }   = require('./middleware/errorHandler');
const { authMiddleware } = require('./middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3000;

const songsDir = process.env.LOCAL_STORAGE_PATH || '/tmp/voxerameta-songs';
if (!fs.existsSync(songsDir)) fs.mkdirSync(songsDir, { recursive: true });

app.use(helmet());
app.use(cors({ origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'Authorization', 'X-Auth-Token', 'X-Colab-Secret'] }));
app.use(rateLimit({ windowMs: 60 * 1000, max: parseInt(process.env.MAX_REQUESTS_PER_MINUTE) || 30 }));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));

app.use('/songs', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Accept-Ranges', 'bytes');
  next();
}, express.static(songsDir, {
  setHeaders: (res, p) => {
    if (p.endsWith('.mp3')) res.setHeader('Content-Type', 'audio/mpeg');
    if (p.endsWith('.wav')) res.setHeader('Content-Type', 'audio/wav');
  },
}));

app.use((req, res, next) => {
  if (!req.path.startsWith('/songs')) console.log(`📥 ${req.method} ${req.path}`);
  next();
});

app.use('/api/v1',    healthRoutes);
app.use('/api/v1',    authMiddleware, songRoutes);
app.use('/api/colab', colabRoutes);

app.get('/', (req, res) => res.json({
  name: 'VoxeraMeta API', version: '5.0.0',
  arch: 'Render → Colab FastAPI (poll-free)',
  endpoints: {
    health:     'GET  /api/v1/health',
    generate:   'POST /api/v1/generate-song',
    status:     'GET  /api/v1/song-status?id=JOB_ID',
    colabCheck: 'GET  /api/v1/colab-health',
    colabDone:  'POST /api/colab/job-done',
    colabError: 'POST /api/colab/job-error',
  },
}));

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`\n🎵 VoxeraMeta v5.0 — http://localhost:${PORT}`);
  console.log(`  ${process.env.GROQ_API_KEY       ? '✅' : '❌'} Groq`);
  console.log(`  ${process.env.OPENROUTER_API_KEY  ? '✅' : '❌'} OpenRouter`);
  console.log(`  ${process.env.GEMINI_API_KEY       ? '✅' : '❌'} Gemini`);
  console.log(`  ${process.env.COLAB_WORKER_URL    ? '✅' : '❌'} COLAB_WORKER_URL: ${process.env.COLAB_WORKER_URL || 'YOK!'}`);
  console.log(`  ${process.env.COLAB_SECRET        ? '✅' : '❌'} COLAB_SECRET`);
  console.log(`  ${process.env.BASE_URL            ? '✅' : '❌'} BASE_URL: ${process.env.BASE_URL || 'YOK!'}`);
});

module.exports = app;
