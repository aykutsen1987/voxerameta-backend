// ============================================================
// VoxeraMeta — İş Kuyruğu Servisi v4.1
//
// v4.1: COLAB_URL artık process.env.COLAB_URL yerine
//       /api/colab/register ile dinamik güncellenir.
// ============================================================
'use strict';

const STATUS = {
  PENDING:    'pending',
  PROCESSING: 'processing',
  COMPLETED:  'completed',
  FAILED:     'failed',
};

const jobs    = new Map();
const pending = [];
const axios   = require('axios');

// Dinamik Colab URL getter (colab_register modülünden)
function _getColabUrl() {
  try {
    // Runtime'da yüklü route'tan al (register ile güncellenen)
    const { getColabUrl } = require('../routes/colab_register');
    return getColabUrl() || process.env.COLAB_URL || null;
  } catch {
    return process.env.COLAB_URL || null;
  }
}

async function enqueue({ jobId, lyrics, genre, gender, duration, processedLyrics, lyricsProvider }) {
  const job = {
    job_id:          jobId,
    status:          STATUS.PENDING,
    lyrics,
    processedLyrics: processedLyrics || lyrics,
    genre,
    gender,
    duration,
    lyricsProvider,
    createdAt:       Date.now(),
    updatedAt:       Date.now(),
    audioUrl:        null,
    error:           null,
  };
  jobs.set(jobId, job);
  console.log(`📥 [Queue] Eklendi: ${jobId}`);

  const colabUrl = _getColabUrl();

  if (colabUrl) {
    try {
      job.status = STATUS.PROCESSING;
      jobs.set(jobId, job);
      console.log(`🚀 [Queue] Colab'a PUSH: ${jobId} → ${colabUrl}/process`);

      axios.post(`${colabUrl.replace(/\/$/, '')}/process`, {
        job_id:   jobId,
        lyrics:   job.processedLyrics,
        genre:    job.genre,
        gender:   job.gender,
        duration: job.duration,
        secret:   process.env.COLAB_SECRET,
      }, { timeout: 30000 }).catch(err => {
        console.error(`❌ [Queue] Colab PUSH hatası (${jobId}): ${err.message}`);
        fail(jobId, 'Colab bağlantı hatası: ' + err.message);
      });
    } catch (err) {
      console.error(`❌ [Queue] PUSH hatası: ${err.message}`);
    }
  } else {
    console.warn(`⚠️ [Queue] Colab URL bulunamadı!`);
    console.warn(`   → Colab hücresini çalıştır, URL otomatik kaydedilir.`);
    job.status = STATUS.FAILED;
    job.error  = 'Colab bağlı değil. Colab notebook\'unu başlatın.';
    jobs.set(jobId, job);
  }

  return job;
}

function dequeue() {
  while (pending.length > 0) {
    const jobId = pending.shift();
    const job   = jobs.get(jobId);
    if (!job || job.status !== STATUS.PENDING) continue;
    job.status    = STATUS.PROCESSING;
    job.updatedAt = Date.now();
    jobs.set(jobId, job);
    return { job_id: job.job_id, lyrics: job.processedLyrics, genre: job.genre, gender: job.gender, duration: job.duration };
  }
  return null;
}

function complete(jobId, audioUrl) {
  const job = jobs.get(jobId);
  if (!job) return false;
  job.status    = STATUS.COMPLETED;
  job.audioUrl  = audioUrl;
  job.updatedAt = Date.now();
  jobs.set(jobId, job);
  console.log(`✅ [Queue] Tamamlandı: ${jobId} → ${audioUrl}`);
  return true;
}

function fail(jobId, errorMsg) {
  const job = jobs.get(jobId);
  if (!job) return false;
  job.status    = STATUS.FAILED;
  job.error     = errorMsg;
  job.updatedAt = Date.now();
  jobs.set(jobId, job);
  console.error(`❌ [Queue] Başarısız: ${jobId} — ${errorMsg}`);
  return true;
}

function get(jobId) { return jobs.get(jobId) || null; }

function stats() {
  const all = [...jobs.values()];
  const byStatus = {};
  for (const s of Object.values(STATUS)) byStatus[s] = all.filter(j => j.status === s).length;
  return { total: all.length, pendingQueue: pending.length, byStatus, colabUrl: _getColabUrl() || 'BAĞLI DEĞİL' };
}

function cleanup(maxAgeMs = 2 * 60 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const [id, job] of jobs.entries()) {
    if (job.updatedAt < cutoff && job.status !== STATUS.PROCESSING) { jobs.delete(id); removed++; }
  }
  if (removed > 0) console.log(`🧹 [Queue] ${removed} eski iş temizlendi`);
  return removed;
}

setInterval(() => cleanup(), 30 * 60 * 1000);

module.exports = { STATUS, enqueue, dequeue, complete, fail, get, stats };
