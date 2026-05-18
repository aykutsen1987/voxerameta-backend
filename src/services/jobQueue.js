// ============================================================
// VoxeraMeta — İş Kuyruğu Servisi v4.2
//
// v4.2 DÜZELTMELER:
//   [FIX-1] Colab URL yokken job FAILED'a düşmüyor, PENDING kalıyor
//           Colab bağlandıktan sonra bekleyen işleri otomatik push et
//   [FIX-2] dequeue() hâlâ çalışıyor (Colab pull-mode için)
// ============================================================
'use strict';

const STATUS = {
  PENDING:    'pending',
  PROCESSING: 'processing',
  COMPLETED:  'completed',
  FAILED:     'failed',
};

const jobs    = new Map();
const pending = [];   // pull-mode için (Colab poll ederse)
const axios   = require('axios');

// Dinamik Colab URL getter (colab_register modülünden)
function _getColabUrl() {
  try {
    const { getColabUrl } = require('../routes/colab_register');
    return getColabUrl() || process.env.COLAB_URL || null;
  } catch {
    return process.env.COLAB_URL || null;
  }
}

async function _pushToColab(job) {
  const colabUrl = _getColabUrl();
  if (!colabUrl) return false;

  const colabBase = colabUrl.replace(/\/$/, '').replace(/\/process$/, '');
  const endpoint  = job.scenario === 2
    ? `${colabBase}/process-s2`
    : `${colabBase}/process`;

  console.log(`🚀 [Queue] Colab'a PUSH (${job.scenario === 2 ? 'S2' : 'S1'}): ${job.job_id} → ${endpoint}`);

  try {
    job.status    = STATUS.PROCESSING;
    job.updatedAt = Date.now();
    jobs.set(job.job_id, job);

    axios.post(endpoint, {
      job_id:           job.job_id,
      lyrics:           job.processedLyrics,
      genre:            job.genre,
      gender:           job.gender,
      duration:         job.duration,
      secret:           process.env.COLAB_SECRET,
      custom_prompt:    job.sunoStylePrompt || null,
      melody_ref_path:  job.melodyRefPath  || null,  // v6: hibrit melody conditioning
      scenario:         job.scenario || 1,
    }, { timeout: 30000 }).catch(err => {
      console.error(`❌ [Queue] Colab PUSH hatası (${job.job_id}): ${err.message}`);
      // PUSH hatasında PENDING'e geri al — bir sonraki bağlantıda tekrar dene
      const j = jobs.get(job.job_id);
      if (j && j.status === STATUS.PROCESSING) {
        j.status    = STATUS.PENDING;
        j.updatedAt = Date.now();
        pending.push(job.job_id);  // tekrar kuyruğa ekle
        jobs.set(job.job_id, j);
      }
    });
    return true;
  } catch (err) {
    console.error(`❌ [Queue] PUSH hazırlık hatası: ${err.message}`);
    return false;
  }
}

async function enqueue({ jobId, lyrics, genre, gender, duration, processedLyrics, lyricsProvider, sunoStylePrompt }) {
  const job = {
    job_id:          jobId,
    status:          STATUS.PENDING,
    lyrics,
    processedLyrics: processedLyrics || lyrics,
    genre,
    gender,
    duration,
    lyricsProvider,
    sunoStylePrompt: sunoStylePrompt || null,
    createdAt:       Date.now(),
    updatedAt:       Date.now(),
    audioUrl:        null,
    error:           null,
  };
  jobs.set(jobId, job);
  console.log(`📥 [Queue] Eklendi: ${jobId}`);

  const pushed = await _pushToColab(job);

  if (!pushed) {
    // [FIX-1] Colab yoksa FAILED değil PENDING — pull-mode kuyruğuna ekle
    console.warn(`⚠️ [Queue] Colab URL bulunamadı — ${jobId} PENDING kalıyor (Colab bağlantısı bekleniyor)`);
    console.warn(`   → Colab hücresini çalıştır, URL /api/colab/register ile otomatik kaydedilir.`);
    pending.push(jobId);
  }

  return job;
}

// Yeni Colab bağlandığında bekleyen işleri push et
async function flushPending() {
  if (pending.length === 0) return 0;
  const colabUrl = _getColabUrl();
  if (!colabUrl) return 0;

  let pushed = 0;
  const toProcess = [...pending];
  pending.length = 0;  // önce boşalt

  for (const jobId of toProcess) {
    const job = jobs.get(jobId);
    if (!job || job.status !== STATUS.PENDING) continue;
    const ok = await _pushToColab(job);
    if (ok) pushed++;
    else pending.push(jobId);  // başarısız ise geri koy
  }

  if (pushed > 0) {
    console.log(`🚀 [Queue] ${pushed} bekleyen iş Colab'a push edildi (flushPending)`);
  }
  return pushed;
}

function dequeue() {
  while (pending.length > 0) {
    const jobId = pending.shift();
    const job   = jobs.get(jobId);
    if (!job || job.status !== STATUS.PENDING) continue;
    job.status    = STATUS.PROCESSING;
    job.updatedAt = Date.now();
    jobs.set(jobId, job);
    return {
      job_id:   job.job_id,
      lyrics:   job.processedLyrics,
      genre:    job.genre,
      gender:   job.gender,
      duration: job.duration,
    };
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
  return {
    total:        all.length,
    pendingQueue: pending.length,
    byStatus,
    colabUrl:     _getColabUrl() || 'BAĞLI DEĞİL',
  };
}

function cleanup(maxAgeMs = 2 * 60 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  let removed  = 0;
  for (const [id, job] of jobs.entries()) {
    if (job.updatedAt < cutoff && job.status !== STATUS.PROCESSING) {
      jobs.delete(id);
      removed++;
    }
  }
  if (removed > 0) console.log(`🧹 [Queue] ${removed} eski iş temizlendi`);
  return removed;
}

setInterval(() => cleanup(), 30 * 60 * 1000);

module.exports = { STATUS, enqueue, dequeue, complete, fail, get, stats, flushPending };
