// ============================================================
// Uçtan uca test — GERÇEK Colab/GPU GEREKMEZ.
// Backend'i gerçekten başlatır, sahte bir "Colab worker" ile konuşturur ve
// şunları doğrular: kuyruk → push → callback → durum → indirme, heartbeat,
// Colab sonradan bağlanınca bekleyen işin akması, güvenlik kapıları.
//
// Çalıştır:   cd backend && npm install && npm test
// ============================================================
'use strict';

const http = require('http');
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { spawn } = require('child_process');

const BACKEND_PORT = 3939;
const WORKER_PORT  = 3940;
const BASE    = `http://127.0.0.1:${BACKEND_PORT}`;
const SECRET  = 'test-secret-0123456789abcdef';
const TMP     = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-e2e-'));

let passed = 0, failed = 0;
function ok(cond, name, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else      { failed++; console.log(`  ❌ ${name} ${extra}`); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const J = (r) => r.json().catch(() => ({}));

function fakeMp3() {
  const b = Buffer.alloc(4096, 0);
  b.write('ID3', 0, 'latin1');
  return b;
}

// ── Sahte Colab worker ───────────────────────────────────────
const received = [];
const worker = http.createServer((req, res) => {
  let body = '';
  req.on('data', d => body += d);
  req.on('end', async () => {
    if (req.method !== 'POST' || req.url !== '/process') { res.writeHead(404); return res.end(); }
    if (req.headers['x-colab-secret'] !== SECRET) { res.writeHead(403); return res.end('{"error":"Unauthorized"}'); }
    const job = JSON.parse(body);
    received.push(job);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"status":"accepted"}');
    setTimeout(async () => {
      const fd = new FormData();
      fd.append('audio', new Blob([fakeMp3()], { type: 'audio/mpeg' }), `${job.job_id}.mp3`);
      await fetch(`${BASE}/api/colab/callback`, {
        method: 'POST',
        headers: { 'X-Colab-Secret': SECRET, 'X-Job-Id': job.job_id },
        body: fd,
      });
    }, 200);
  });
});

async function waitFor(fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(150); }
  return null;
}

async function main() {
  console.log('\n▶ Backend başlatılıyor...');
  const srv = spawn('node', ['src/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(BACKEND_PORT), COLAB_SECRET: SECRET, BASE_URL: BASE,
           LOCAL_STORAGE_PATH: TMP, NODE_ENV: 'test', LYRICS_MODE: 'preserve' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let srvLog = '';
  srv.stdout.on('data', d => srvLog += d);
  srv.stderr.on('data', d => srvLog += d);

  const up = await waitFor(async () => { try { return (await fetch(`${BASE}/api/v1/health`)).ok; } catch { return false; } });
  ok(up, 'backend ayağa kalktı');
  if (!up) { console.log(srvLog); srv.kill(); process.exit(1); }
  await new Promise(r => worker.listen(WORKER_PORT, '127.0.0.1', r));

  try {
    // ── 1. Colab bağlı değilken iş alınır, PENDING kalır ───────
    console.log('\n1) Colab bağlı değilken');
    let h = await J(await fetch(`${BASE}/api/v1/health`));
    ok(h.colabConnected === false, 'health: Colab bağlı değil');
    const poem = 'Geceyi yırtan bir ses var içimde\nSeni arar durur her nefesimde\n\nGel de dinle gel de duy\nBu şarkı sana ait';
    let r = await fetch(`${BASE}/api/v1/generate-song`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lyrics: poem, genre: 'pop', gender: 'female', duration: 30, language: 'tr' }),
    });
    let g = await J(r);
    ok(r.status === 202 && g.status === 'pending', 'generate-song 202 pending', JSON.stringify(g));
    ok(g.colabConnected === false, 'cevap: colabConnected=false');
    const job1 = g.id;
    await sleep(400);
    let s = await J(await fetch(`${BASE}/api/v1/song-status?id=${job1}`));
    ok(s.status === 'pending', 'iş PENDING bekliyor (FAILED olmadı)', JSON.stringify(s));

    // ── 2. Colab bağlanır → bekleyen iş otomatik akar ──────────
    console.log('\n2) Colab bağlanınca (register + flush)');
    r = await fetch(`${BASE}/api/colab/register`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'X-Colab-Secret': SECRET },
      body: JSON.stringify({ colab_url: `http://127.0.0.1:${WORKER_PORT}` }),
    });
    const reg = await J(r);
    ok(r.status === 200 && reg.ok, 'register 200', JSON.stringify(reg));
    ok(reg.flushed === 1, 'bekleyen 1 iş Colab\'a gönderildi', JSON.stringify(reg));
    const done1 = await waitFor(async () => {
      const x = await J(await fetch(`${BASE}/api/v1/song-status?id=${job1}`));
      return x.status === 'completed' ? x : (x.status === 'failed' ? x : null);
    });
    ok(done1 && done1.status === 'completed', 'iş tamamlandı', JSON.stringify(done1));
    ok(received[0] && received[0].lyrics.includes('[Verse 1]') && received[0].lyrics.includes('[Chorus]'),
       'sözler korundu + bölüm etiketleri eklendi');
    ok(received[0] && received[0].lyrics.includes('Geceyi yırtan bir ses var içimde'), 'orijinal söz satırı aynen duruyor');
    ok(received[0] && received[0].genre === 'POP' && received[0].gender === 'female' && received[0].language === 'tr',
       'tür/cinsiyet/dil Colab\'a doğru iletildi');
    if (done1 && done1.audioUrl) {
      const a = await fetch(done1.audioUrl);
      const buf = Buffer.from(await a.arrayBuffer());
      ok(a.status === 200 && buf.length === 4096 && buf.slice(0, 3).toString() === 'ID3', 'mp3 indirilebiliyor');
    }
    h = await J(await fetch(`${BASE}/api/v1/health`));
    ok(h.colabConnected === true, 'health: Colab bağlı');

    // ── 3. Bağlıyken normal akış ───────────────────────────────
    console.log('\n3) Colab bağlıyken yeni iş');
    r = await fetch(`${BASE}/api/v1/generate-song`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lyrics: 'Kısa bir söz\nİkinci satır', genre: 'ROCK', gender: 'male', duration: 20 }),
    });
    g = await J(r);
    const done2 = await waitFor(async () => {
      const x = await J(await fetch(`${BASE}/api/v1/song-status?id=${g.id}`));
      return x.status === 'completed' || x.status === 'failed' ? x : null;
    });
    ok(done2 && done2.status === 'completed', 'ikinci iş tamamlandı');

    // ── 4. Güvenlik ────────────────────────────────────────────
    console.log('\n4) Güvenlik kapıları');
    const evil = async (headers, jobHeader) => {
      const fd = new FormData();
      fd.append('audio', new Blob([fakeMp3()], { type: 'audio/mpeg' }), 'x.mp3');
      return fetch(`${BASE}/api/colab/callback`, { method: 'POST', headers: { ...headers, ...(jobHeader ? { 'X-Job-Id': jobHeader } : {}) }, body: fd });
    };
    const before = fs.readdirSync(TMP).length;
    r = await evil({}, job1);
    ok(r.status === 401, 'secret olmadan callback → 401');
    r = await evil({ 'X-Colab-Secret': 'yanlis' }, job1);
    ok(r.status === 401, 'yanlış secret → 401');
    r = await evil({ 'X-Colab-Secret': SECRET }, '../../etc/passwd');
    ok(r.status === 400, 'path traversal job id → 400');
    r = await evil({ 'X-Colab-Secret': SECRET }, '11111111-1111-1111-1111-111111111111');
    ok(r.status === 404, 'olmayan iş → 404');
    r = await evil({ 'X-Colab-Secret': SECRET }, job1);
    ok(r.status === 409, 'tamamlanmış işe tekrar yükleme → 409');
    ok(fs.readdirSync(TMP).length === before, 'reddedilen isteklerde diske dosya yazılmadı');

    r = await fetch(`${BASE}/api/colab/register`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ colab_url: 'https://evil.example', secret: 'x' }) });
    ok(r.status === 401, 'secret olmadan register → 401');
    r = await fetch(`${BASE}/api/colab/error`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ job_id: job1, error: 'x' }) });
    ok(r.status === 401, 'secret olmadan error → 401');

    r = await fetch(`${BASE}/api/v1/generate-song`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lyrics: 'a\nb', voice_ref_path: 'http://169.254.169.254/latest/meta-data' }) });
    ok(r.status === 400, 'SSRF: dış adresli referans reddedildi');
    r = await fetch(`${BASE}/api/v1/generate-song`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lyrics: 'x'.repeat(5000) }) });
    ok(r.status === 400, '5000 karakterlik söz reddedildi');
    r = await fetch(`${BASE}/api/v1/generate-song`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lyrics: '   ' }) });
    ok(r.status === 400, 'boş söz reddedildi');

    r = await fetch(`${BASE}/api/colab/status`);
    const st = await J(r);
    ok(st.connected === true && !('colab_url' in st), 'status: bağlı, tam adres dışarı verilmiyor');

    // ── 5. Referans yükleme ────────────────────────────────────
    console.log('\n5) Referans yükleme');
    const fd = new FormData();
    fd.append('type', 'voice');
    fd.append('file', new Blob([fakeMp3()], { type: 'audio/mp4' }), 'kayit.m4a');
    r = await fetch(`${BASE}/api/v1/upload-ref`, { method: 'POST', body: fd });
    const up1 = await J(r);
    ok(r.status === 200 && up1.ok && /\/songs\/refs\/[0-9a-f-]{36}\.m4a$/.test(up1.refPath), 'm4a yüklendi', JSON.stringify(up1));
    const fd2 = new FormData();
    fd2.append('file', new Blob(['x'], { type: 'text/plain' }), 'x.exe');
    r = await fetch(`${BASE}/api/v1/upload-ref`, { method: 'POST', body: fd2 });
    ok(r.status >= 400, 'ses olmayan dosya reddedildi');

    // ── 6. Colab hata bildirirse ───────────────────────────────
    console.log('\n6) Colab hata bildirimi');
    worker.removeAllListeners('request');
    worker.on('request', (req, res) => {
      let b = ''; req.on('data', d => b += d);
      req.on('end', () => {
        const job = JSON.parse(b);
        res.writeHead(200); res.end('{}');
        setTimeout(() => fetch(`${BASE}/api/colab/error`, { method: 'POST',
          headers: { 'content-type': 'application/json', 'X-Colab-Secret': SECRET },
          body: JSON.stringify({ job_id: job.job_id, error: 'CUDA out of memory' }) }), 150);
      });
    });
    g = await J(await fetch(`${BASE}/api/v1/generate-song`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lyrics: 'hata testi\nsatır 2' }) }));
    const bad = await waitFor(async () => {
      const x = await J(await fetch(`${BASE}/api/v1/song-status?id=${g.id}`));
      return x.status === 'failed' ? x : null;
    });
    ok(bad && /CUDA/.test(bad.error || ''), 'hata mesajı uygulamaya ulaştı', JSON.stringify(bad));
  } catch (e) {
    failed++;
    console.log('  ❌ test istisnası:', e);
  }

  console.log(`\n══ Sonuç: ${passed} geçti, ${failed} kaldı ══`);
  if (failed) console.log('\n--- backend log (son 40 satır) ---\n' + srvLog.split('\n').slice(-40).join('\n'));
  srv.kill();
  worker.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}

main();
