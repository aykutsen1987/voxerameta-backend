// ============================================================
// VoxeraMeta — İş Kuyruğu Servisi
//
// Mimari:
//   Frontend → POST /api/v1/generate-song → jobQueue.enqueue()
//   Colab    → GET  /api/colab/next-job   → jobQueue.dequeue()
//   Colab    → POST /api/colab/job-done   → jobQueue.complete()
//   Frontend → GET  /api/v1/song-status   → jobQueue.get()
//
// Kuyruk bellek içinde tutulur (Map). Render restart olursa
// uçar — production için Redis eklenebilir ama ücretsiz tier
// için yeterli.
// ============================================================

'use strict';

// İş durumları
const STATUS = {
  PENDING:    'pending',     // Kuyruğa alındı, Colab almadı
  PROCESSING: 'processing',  // Colab işliyor
  COMPLETED:  'completed',   // Ses hazır
  FAILED:     'failed',      // Pipeline hatası
};

// jobs Map: jobId → jobObject
const jobs    = new Map();
// pending kuyruk: FIFO dizisi
const pending = [];

// ── Kuyruğa ekle ─────────────────────────────────────────────
const axios = require('axios');

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

  // Colab'a PUSH yap
  const colabUrl = process.env.COLAB_URL; // ngrok URL'i buraya gelecek
  if (colabUrl) {
    try {
      job.status = STATUS.PROCESSING;
      jobs.set(jobId, job);
      
      console.log(`🚀 [Queue] Colab'a PUSH ediliyor: ${jobId} -> ${colabUrl}`);
      
      // Arka planda gönder, beklemeye gerek yok (fire and forget)
      axios.post(`${colabUrl}/process`, {
        job_id: jobId,
        lyrics: job.processedLyrics,
        genre: job.genre,
        gender: job.gender,
        duration: job.duration,
        secret: process.env.COLAB_SECRET
      }).catch(err => {
        console.error(`❌ [Queue] Colab PUSH hatası (${jobId}): ${err.message}`);
        fail(jobId, "Colab bağlantı hatası");
      });
    } catch (err) {
      console.error(`❌ [Queue] PUSH hazırlık hatası: ${err.message}`);
    }
  } else {
    console.warn(`⚠️ [Queue] COLAB_URL tanımlı değil!`);
    console.warn(`   → Render Dashboard'da COLAB_URL = <ngrok-url>/process şeklinde ekleyin.`);
    console.warn(`   → Colab hücresini çalıştırınca URL ekranda görünür.`);
    job.status = STATUS.PENDING;
    pending.push(jobId);
  }

  return job;
}

// ── Colab için sonraki işi al (FIFO) ─────────────────────────
function dequeue() {
  // Pending kuyruğundan ilk işi al
  while (pending.length > 0) {
    const jobId = pending.shift();
    const job   = jobs.get(jobId);
    if (!job) continue;                        // Silinmiş / stale
    if (job.status !== STATUS.PENDING) continue; // Zaten alınmış

    job.status    = STATUS.PROCESSING;
    job.updatedAt = Date.now();
    jobs.set(jobId, job);
    console.log(`📤 [Queue] Colab'a verildi: ${jobId}`);

    // Colab'a sadece pipeline için gereken alanları gönder
    return {
      job_id:   job.job_id,
      lyrics:   job.processedLyrics,
      genre:    job.genre,
      gender:   job.gender,
      duration: job.duration,
    };
  }
  return null; // Kuyruk boş
}

// ── Colab işi tamamladı ──────────────────────────────────────
function complete(jobId, audioUrl) {
  const job = jobs.get(jobId);
  if (!job) {
    console.warn(`⚠️  [Queue] complete() çağrıldı ama iş yok: ${jobId}`);
    return false;
  }
  job.status    = STATUS.COMPLETED;
  job.audioUrl  = audioUrl;
  job.updatedAt = Date.now();
  jobs.set(jobId, job);
  console.log(`✅ [Queue] Tamamlandı: ${jobId} → ${audioUrl}`);
  return true;
}

// ── Colab hata bildirdi ──────────────────────────────────────
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

// ── İş durumunu getir ────────────────────────────────────────
function get(jobId) {
  return jobs.get(jobId) || null;
}

// ── İstatistik ───────────────────────────────────────────────
function stats() {
  const all      = [...jobs.values()];
  const byStatus = {};
  for (const s of Object.values(STATUS)) {
    byStatus[s] = all.filter(j => j.status === s).length;
  }
  return {
    total:         all.length,
    pendingQueue:  pending.length,
    byStatus,
  };
}

// ── Eski işleri temizle (her 30 dakikada çağrılabilir) ───────
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

// Otomatik temizlik (her 30 dakika)
setInterval(() => cleanup(), 30 * 60 * 1000);

module.exports = { STATUS, enqueue, dequeue, complete, fail, get, stats };
