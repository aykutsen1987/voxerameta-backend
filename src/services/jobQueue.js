// ============================================================
// VoxeraMeta — İş Kuyruğu Servisi v5.1
//
// Akış: Android → enqueue() → Colab'a PUSH (/process) → Colab callback → complete()
//
// v5.1:
//   - Colab'a ulaşılamazsa iş PENDING kalır, Colab bağlanınca otomatik gönderilir
//   - En fazla JOB_MAX_ATTEMPTS deneme; sonra iş net bir hata mesajıyla FAILED olur
//   - Takılı işler (Colab oturumu kapandı) zaman aşımıyla FAILED olur — sonsuza
//     kadar "processing" kalmaz
//   - Yeni Colab oturumu bağlanınca eski oturumda kalan işler yeniden kuyruğa alınır
//   - Secret artık gövdede değil X-Colab-Secret başlığında gider
// ============================================================
'use strict';

const axios = require('axios');

const STATUS = {
  PENDING:    'pending',
  PROCESSING: 'processing',
  COMPLETED:  'completed',
  FAILED:     'failed',
};

const MAX_ATTEMPTS          = parseInt(process.env.JOB_MAX_ATTEMPTS, 10)       || 3;
const PROCESSING_TIMEOUT_MS = (parseInt(process.env.JOB_TIMEOUT_SECONDS, 10)   || 3000) * 1000; // 50 dk (5 dk'lık şarkı + kontrol/yeniden deneme)
const PENDING_TIMEOUT_MS    = (parseInt(process.env.PENDING_TIMEOUT_SECONDS, 10) || 1800) * 1000; // 30 dk
const KEEP_FINISHED_MS      = 2 * 60 * 60 * 1000; // bitmiş işleri 2 saat tut

const jobs    = new Map();
const pending = [];          // PENDING iş kimlikleri (tekrarsız)
let   flushing = false;

// ── Yardımcılar ──────────────────────────────────────────────
function _registry() {
  try { return require('../routes/colab_register'); } catch { return null; }
}
function _getColabUrl() {
  const r = _registry();
  return (r && r.getColabUrl()) || process.env.COLAB_URL || null;
}
function _isColabAlive() {
  const r = _registry();
  return r ? r.isColabAlive() : !!process.env.COLAB_URL;
}
function _addPending(jobId) {
  if (!pending.includes(jobId)) pending.push(jobId);
}
function _removePending(jobId) {
  const i = pending.indexOf(jobId);
  if (i >= 0) pending.splice(i, 1);
}

// ── Colab'a gönder ───────────────────────────────────────────
// true  → iş işlendi (gönderildi VEYA kalıcı olarak başarısız/yeniden kuyruğa alındı)
// false → Colab adresi yok, iş PENDING kalmalı
async function _pushToColab(job) {
  const colabUrl = _getColabUrl();
  if (!colabUrl) return false;

  const endpoint = `${colabUrl.replace(/\/+$/, '').replace(/\/process$/, '')}/process`;

  job.status    = STATUS.PROCESSING;
  job.attempts  = (job.attempts || 0) + 1;
  job.updatedAt = Date.now();
  _removePending(job.job_id);

  console.log(`🚀 [Queue] Colab'a PUSH (${job.attempts}/${MAX_ATTEMPTS}): ${job.job_id}`);

  try {
    await axios.post(endpoint, {
      job_id:          job.job_id,
      lyrics:          job.processedLyrics,
      genre:           job.genre,
      gender:          job.gender,
      duration:        job.duration,
      language:        job.language,
      custom_prompt:   job.sunoStylePrompt || null,
      melody_ref_path: job.melodyRefPath   || null,
      voice_ref_path:  job.voiceRefPath    || null,
    }, {
      timeout: 30000,
      headers: {
        'X-Colab-Secret': process.env.COLAB_SECRET || '',
        'ngrok-skip-browser-warning': '1',
      },
    });
    return true;
  } catch (err) {
    const code = err.response && err.response.status;
    console.error(`❌ [Queue] Colab PUSH hatası (${job.job_id}): ${code || ''} ${err.message}`);

    if (code === 401 || code === 403) {
      fail(job.job_id, 'Colab secret uyuşmuyor — Colab ve Render’daki COLAB_SECRET aynı olmalı.');
      return true;
    }
    if (job.attempts >= MAX_ATTEMPTS) {
      fail(job.job_id, `Colab’a ulaşılamadı (${MAX_ATTEMPTS} deneme). Colab hücresi açık mı?`);
      return true;
    }
    // Geçici hata: PENDING'e geri al, sonraki süpürmede tekrar denenecek
    job.status    = STATUS.PENDING;
    job.updatedAt = Date.now();
    _addPending(job.job_id);
    return true;
  }
}

// ── Kuyruk API'si ────────────────────────────────────────────
async function enqueue({ jobId, lyrics, processedLyrics, genre, gender, duration, language,
                         lyricsProvider, sunoStylePrompt, voiceRefPath, melodyRefPath }) {
  const job = {
    job_id:          jobId,
    status:          STATUS.PENDING,
    lyrics,
    processedLyrics: processedLyrics || lyrics,
    genre,
    gender,
    duration,
    language:        language || 'tr',
    lyricsProvider,
    sunoStylePrompt: sunoStylePrompt || null,
    voiceRefPath:    voiceRefPath    || null,
    melodyRefPath:   melodyRefPath   || null,
    attempts:        0,
    createdAt:       Date.now(),
    updatedAt:       Date.now(),
    audioUrl:        null,
    error:           null,
  };
  jobs.set(jobId, job);
  _addPending(jobId);
  console.log(`📥 [Queue] Eklendi: ${jobId}`);

  try {
    const handled = await _pushToColab(job);
    if (!handled) {
      console.warn(`⚠️ [Queue] Colab adresi yok — ${jobId} PENDING (Colab bağlanınca gönderilecek)`);
    }
  } catch (e) {
    console.error(`❌ [Queue] enqueue hatası: ${e.message}`);
  }
  return job;
}

/** PENDING işleri Colab'a gönder (Colab bağlandığında / süpürmede çağrılır) */
async function flushPending() {
  if (flushing || pending.length === 0) return 0;
  if (!_getColabUrl()) return 0;
  flushing = true;
  let pushed = 0;
  try {
    for (const jobId of [...pending]) {
      const job = jobs.get(jobId);
      if (!job || job.status !== STATUS.PENDING) { _removePending(jobId); continue; }
      const ok = await _pushToColab(job);
      if (ok && job.status === STATUS.PROCESSING) pushed++;
    }
  } finally {
    flushing = false;
  }
  if (pushed > 0) console.log(`🚀 [Queue] ${pushed} bekleyen iş Colab'a gönderildi`);
  return pushed;
}

/** Yeni Colab oturumu: eski oturumda 'processing' kalan işleri yeniden kuyruğa al */
function requeueProcessing() {
  let n = 0;
  for (const job of jobs.values()) {
    if (job.status !== STATUS.PROCESSING) continue;
    if ((job.attempts || 0) >= MAX_ATTEMPTS) {
      fail(job.job_id, 'Colab oturumu kapandı ve deneme hakkı bitti. Şarkıyı tekrar oluşturun.');
      continue;
    }
    job.status    = STATUS.PENDING;
    job.updatedAt = Date.now();
    _addPending(job.job_id);
    n++;
  }
  if (n > 0) console.log(`♻️  [Queue] ${n} iş yeniden kuyruğa alındı (yeni Colab oturumu)`);
  return n;
}

function complete(jobId, audioUrl, note = null) {
  const job = jobs.get(jobId);
  if (!job) return false;
  job.status    = STATUS.COMPLETED;
  job.audioUrl  = audioUrl;
  job.note      = note || null;
  job.error     = null;
  job.updatedAt = Date.now();
  _removePending(jobId);
  console.log(`✅ [Queue] Tamamlandı: ${jobId}`);
  return true;
}

function fail(jobId, errorMsg) {
  const job = jobs.get(jobId);
  if (!job) return false;
  job.status    = STATUS.FAILED;
  job.error     = errorMsg;
  job.updatedAt = Date.now();
  _removePending(jobId);
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
    colabAlive:   _isColabAlive(),
  };
}

/** Periyodik bakım: zaman aşımı, bekleyenleri gönder, eskileri sil */
async function sweep() {
  const now = Date.now();
  for (const job of jobs.values()) {
    if (job.status === STATUS.PROCESSING && now - job.updatedAt > PROCESSING_TIMEOUT_MS) {
      fail(job.job_id, 'Zaman aşımı: Colab sonuç göndermedi. Colab oturumu kapanmış olabilir, tekrar deneyin.');
    } else if (job.status === STATUS.PENDING && now - job.createdAt > PENDING_TIMEOUT_MS) {
      fail(job.job_id, 'Colab 30 dakikadır bağlanmadı. Colab hücresini çalıştırıp tekrar deneyin.');
    } else if ((job.status === STATUS.COMPLETED || job.status === STATUS.FAILED) && now - job.updatedAt > KEEP_FINISHED_MS) {
      jobs.delete(job.job_id);
    }
  }
  if (pending.length > 0 && _isColabAlive()) {
    await flushPending();
  }
}

const _timer = setInterval(() => { sweep().catch(e => console.error('sweep hatası:', e.message)); }, 30 * 1000);
if (_timer.unref) _timer.unref();

module.exports = { STATUS, enqueue, complete, fail, get, stats, flushPending, requeueProcessing, sweep };
