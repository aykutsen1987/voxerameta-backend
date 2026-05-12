// ============================================================
// VoxeraMeta — Colab Provider v5.0
//
// Mimari değişikliği (v5):
//   ESKİ: Colab poll eder → Render'dan iş çeker
//   YENİ: Render → Colab FastAPI'ye POST atar → Colab callback atar
//
// Env değişkeni:
//   COLAB_WORKER_URL = https://xxxx.ngrok-free.app   (ngrok URL)
//   COLAB_SECRET     = Colab ile aynı secret
// ============================================================

'use strict';

const axios = require('axios');

function getColabUrl() {
  const url = process.env.COLAB_WORKER_URL;
  if (!url) throw new Error('COLAB_WORKER_URL tanımlı değil. Colab\'ı başlatıp URL\'yi Render\'a ekleyin.');
  return url.replace(/\/$/, '');
}

// Colab'a iş gönder (fire & forget — callback bekler)
async function pushJobToColab(job) {
  const url = `${getColabUrl()}/run-job`;

  console.log(`🚀 [ColabProvider] Colab'a gönderiliyor: ${job.job_id} → ${url}`);

  const resp = await axios.post(url, {
    job_id:   job.job_id,
    lyrics:   job.lyrics,
    genre:    job.genre,
    gender:   job.gender,
    duration: job.duration,
  }, {
    headers: {
      'Content-Type':    'application/json',
      'X-Colab-Secret':  process.env.COLAB_SECRET || '',
    },
    timeout: 30000, // sadece bağlantı için — pipeline çok uzun sürer, callback bekler
    validateStatus: () => true,
  });

  if (resp.status === 429) {
    throw new Error('Colab meşgul (başka iş işleniyor). Kısa süre sonra tekrar denenecek.');
  }
  if (resp.status === 401) {
    throw new Error('Colab secret hatalı. COLAB_SECRET env değişkenini kontrol edin.');
  }
  if (resp.status !== 200 && resp.status !== 202) {
    throw new Error(`Colab HTTP ${resp.status}: ${JSON.stringify(resp.data).slice(0, 200)}`);
  }

  console.log(`✅ [ColabProvider] Colab iş aldı: ${job.job_id} (pipeline arka planda çalışıyor)`);
  return true;
}

// Colab sağlık kontrolü
async function checkColabHealth() {
  try {
    const resp = await axios.get(`${getColabUrl()}/health`, {
      headers: { 'X-Colab-Secret': process.env.COLAB_SECRET || '' },
      timeout: 10000,
    });
    return resp.status === 200 ? resp.data : null;
  } catch {
    return null;
  }
}

module.exports = { pushJobToColab, checkColabHealth, getColabUrl };
