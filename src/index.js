require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const songRoutes = require('./routes/songs');
const healthRoutes = require('./routes/health');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Güvenlik Middleware ──
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-App-Version', 'X-API-Key']
}));

// ── Rate Limiting ──
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 dakika
  max: 100,
  message: { error: 'Çok fazla istek. 15 dakika sonra tekrar deneyin.' }
});
app.use('/api/', limiter);

// ── Body Parsing ──
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Logging ──
app.use(morgan('combined'));

// ── Routes ──
app.use('/api/v1', songRoutes);
app.use('/api/v1', healthRoutes);

// ── Root ──
app.get('/', (req, res) => {
  res.json({
    name: 'VoxeraMeta Backend',
    version: '1.0.0',
    status: 'running',
    docs: '/api/v1/health'
  });
});

// ── Error Handler ──
app.use(errorHandler);

// ── Start ──
app.listen(PORT, () => {
  console.log(`✅ VoxeraMeta Backend çalışıyor: http://localhost:${PORT}`);
  console.log(`🔑 Aktif API'ler:`);
  if (process.env.SUNO_COOKIE) console.log('  ✓ Suno AI');
  if (process.env.HUGGINGFACE_API_KEY) console.log('  ✓ HuggingFace MusicGen');
  if (process.env.REPLICATE_API_TOKEN) console.log('  ✓ Replicate (MusicGen/AudioCraft)');
  if (process.env.STABILITY_API_KEY) console.log('  ✓ Stability AI');
  if (process.env.OPENAI_API_KEY) console.log('  ✓ OpenAI');
  console.log(`📡 Port: ${PORT}`);
});

module.exports = app;
