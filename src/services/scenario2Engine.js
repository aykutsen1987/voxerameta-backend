// ============================================================
// VoxeraMeta — Senaryo 2 Motoru
// MusicGen (Altyapı) + Harici Vokal AI (TTS → İşleme → Mix)
//
// Akış:
//   1. buildInstrumentalPrompt()  → MusicGen için teknik prompt
//   2. buildVocalPrompt()         → Vokal AI için teknik prompt
//   3. generateInstrumental()     → HuggingFace / Replicate / Colab
//   4. generateVocal()            → edge-tts / ElevenLabs / OpenAI TTS
//   5. mixTracks()                → FFmpeg ile profesyonel mix
// ============================================================

'use strict';

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');
const { v4: uuidv4 } = require('uuid');
const { execSync } = require('child_process');

const SONGS_DIR = process.env.LOCAL_STORAGE_PATH || '/tmp/voxerameta-songs';
if (!fs.existsSync(SONGS_DIR)) fs.mkdirSync(SONGS_DIR, { recursive: true });

// ──────────────────────────────────────────────────────────────────────────────
// BÖLÜM 1: TEKNİK PROMPT MÜHENDİSLİĞİ
// Her genre için: BPM, Key, vokal frekans boşluğu, enstrüman seti
// ──────────────────────────────────────────────────────────────────────────────

const GENRE_TECH_MAP = {
  POP: {
    bpm: 90, key: 'A Minor', mood: 'emotional',
    instruments: 'clean acoustic guitar chord progressions, soft ambient piano pads, deep sub-bass, minimal acoustic pop drum kit',
    arrangement: 'low-energy intro, building up with sidechain synth pads, wide stereo imaging',
    style: 'Modern Emotional Turkish Pop',
  },
  MODERN_POP: {
    bpm: 100, key: 'C Major', mood: 'uplifting',
    instruments: 'bright piano, layered synths, punchy kick, deep bass, atmospheric pads',
    arrangement: 'energetic verse, dynamic chorus, breakdown bridge',
    style: 'Modern Radio Pop',
  },
  RAP: {
    bpm: 85, key: 'D Minor', mood: 'aggressive',
    instruments: '808 bass, trap hi-hats, punchy snare, dark synth pad, vinyl scratch',
    arrangement: 'hard intro, verse boom-bap, drop chorus, freestyle bridge',
    style: 'Turkish Hip-Hop Trap',
  },
  HIP_HOP: {
    bpm: 90, key: 'F Minor', mood: 'dark',
    instruments: '808 sub bass, dusty samples, boom-bap drums, lo-fi keys',
    arrangement: 'classic boom-bap structure, sample-based melody, scratching outro',
    style: 'Turkish Hip-Hop',
  },
  SLOW: {
    bpm: 65, key: 'E Minor', mood: 'melancholic',
    instruments: 'classical guitar fingerpicking, soft cello, ambient piano, light brushed drums',
    arrangement: 'intimate intro, building verse, emotional chorus, sparse bridge',
    style: 'Turkish Slow Ballad',
  },
  LOFI: {
    bpm: 75, key: 'G Major', mood: 'chill',
    instruments: 'vinyl-textured piano, lo-fi jazz guitar, mellow bass, soft brushed drums, rain ambience',
    arrangement: 'repeated loop structure, subtle variation, dreamy atmosphere',
    style: 'Lo-fi Chill Hop',
  },
  ACOUSTIC: {
    bpm: 80, key: 'D Major', mood: 'warm',
    instruments: 'steel-string acoustic guitar, light cajon, soft harmonica, finger-picked bass',
    arrangement: 'folk verse structure, campfire chorus, minimal breakdown',
    style: 'Acoustic Folk',
  },
  ARABESK: {
    bpm: 72, key: 'A Hijaz', mood: 'dramatic',
    instruments: 'emotional violin lead, bağlama, oud, soft piano, deep bass, subtle zurna',
    arrangement: 'dramatic intro, building verse, heartbreak chorus, orchestral bridge',
    style: 'Turkish Arabesk',
  },
  ROCK: {
    bpm: 120, key: 'E Minor', mood: 'powerful',
    instruments: 'distorted electric guitar, power chords, bass guitar, rock drum kit, light synth layer',
    arrangement: 'hard riff intro, verse groove, anthemic chorus, guitar solo bridge',
    style: 'Turkish Rock',
  },
  DANCE: {
    bpm: 128, key: 'G Minor', mood: 'energetic',
    instruments: 'four-on-the-floor kick, synth bass drop, arpeggiated synth, tropical stabs, claps',
    arrangement: 'build-up intro, drop chorus, filter breakdown, second drop',
    style: 'Turkish Dance / Club',
  },
  ELECTRONIC: {
    bpm: 130, key: 'F# Minor', mood: 'futuristic',
    instruments: 'synthesizer lead, modular bass, electronic drums, pad textures, arpeggiator',
    arrangement: 'ambient intro, electro verse, massive chorus drop, glitch breakdown',
    style: 'Electronic / EDM',
  },
  JAZZ: {
    bpm: 95, key: 'Bb Major', mood: 'smooth',
    instruments: 'upright bass, brushed snare, Rhodes piano, muted trumpet, jazz guitar chords',
    arrangement: 'walking bass intro, jazz standard verse, improvised solo section',
    style: 'Turkish Jazz Fusion',
  },
  CLASSICAL: {
    bpm: 70, key: 'C Minor', mood: 'orchestral',
    instruments: 'string quartet, piano, light flute, soft timpani, harp glissando',
    arrangement: 'classical sonata structure, theme and variation, gradual crescendo',
    style: 'Cinematic Classical',
  },
};

/**
 * MusicGen için teknik altyapı promptu oluştur
 * BPM, Key, mood, enstrümanlar ve vokal frekans boşluğu dahil
 */
function buildInstrumentalPrompt(genre, customHint = '') {
  const g = genre.toUpperCase();
  const tech = GENRE_TECH_MAP[g] || GENRE_TECH_MAP.POP;

  const base =
    `[Style: ${tech.style}] [Tempo: ${tech.bpm} BPM] [Key: ${tech.key}] ` +
    `[Instruments: ${tech.instruments}] ` +
    `[Arrangement: ${tech.arrangement}] ` +
    `[Production: High quality studio mix, polished master, ` +
    `frequency space left open for lead vocals between 200Hz-4kHz, ` +
    `44.1kHz sample rate, 192kbps, professional master]`;

  return customHint ? `${base} [Theme: ${customHint.substring(0, 80)}]` : base;
}

/**
 * Vokal AI modeli için teknik prompt oluştur
 * Vokal tipi, BPM senkronizasyon, dry (efektsiz) ses talebi
 */
function buildVocalPrompt(lyrics, genre, gender) {
  const g      = genre.toUpperCase();
  const tech   = GENRE_TECH_MAP[g] || GENRE_TECH_MAP.POP;
  const singer = gender === 'female'
    ? 'Female, mid-range soprano, clear pronunciation, expressive emotion'
    : 'Male, mid-range tenor, clear pronunciation, expressive emotion';

  return (
    `[Vocalist: ${singer}] ` +
    `[Timing: Synchronized with ${tech.bpm} BPM ${tech.style} rhythm, ` +
    `rhythmic cadence, explicit pause markers between verses] ` +
    `[Audio Quality: Studio condenser microphone, dry vocal without reverb, ` +
    `no background noise, 44.1kHz] ` +
    `[Mood: ${tech.mood}] ` +
    `[Lyrics/Content]: ${lyrics.substring(0, 500)}`
  );
}

/**
 * Verilen genre için BPM değerini döndür (mix sync için)
 */
function getBpmForGenre(genre) {
  const g    = genre.toUpperCase();
  const tech = GENRE_TECH_MAP[g] || GENRE_TECH_MAP.POP;
  return tech.bpm;
}

// ──────────────────────────────────────────────────────────────────────────────
// BÖLÜM 2: ALTYAPI ÜRETİMİ (MUSICGEN)
// Provider zinciri: HuggingFace → Replicate → Colab → Sine Wave Fallback
// ──────────────────────────────────────────────────────────────────────────────

async function generateInstrumental(prompt, durationSeconds) {
  const providers = [
    _instrumentalFromHuggingFace,
    _instrumentalFromReplicate,
  ];

  const errors = [];
  for (const fn of providers) {
    try {
      const result = await fn(prompt, durationSeconds);
      if (result && result.filename) {
        console.log(`✅ [Scenario2] Altyapı üretildi: ${result.filename} (${result.provider})`);
        return result;
      }
    } catch (err) {
      console.warn(`⚠️  [Scenario2] Altyapı provider başarısız: ${err.message}`);
      errors.push(err.message);
    }
  }

  // Son çare: fallback sine wave (her zaman çalışır)
  console.warn(`⚠️  [Scenario2] Tüm altyapı provider'lar başarısız — sine wave oluşturuluyor`);
  return _instrumentalFallback(durationSeconds);
}

async function _instrumentalFromHuggingFace(prompt, durationSeconds) {
  if (!process.env.HUGGINGFACE_API_KEY) throw new Error('HUGGINGFACE_API_KEY eksik');

  // Sadece vocal-friendly kısmı gönder (max 300 karakter — HF limiti)
  const cleanPrompt = prompt.replace(/\[.*?\]/g, '').trim().substring(0, 300) +
    ', frequency space left open for lead vocals, no melody in mid-range';

  console.log(`🎵 [Scenario2→HuggingFace] Prompt: ${cleanPrompt.substring(0, 80)}...`);

  const response = await axios.post(
    'https://router.huggingface.co/hf-inference/models/facebook/musicgen-small',
    { inputs: cleanPrompt },
    {
      headers: {
        'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      responseType: 'arraybuffer',
      timeout: 120_000,
    }
  );

  if (response.status !== 200) throw new Error(`HuggingFace HTTP ${response.status}`);
  const contentType = response.headers['content-type'] || '';
  if (!contentType.includes('audio')) throw new Error(`HuggingFace ses döndürmedi: ${contentType}`);

  const filename = `instrumental_hf_${uuidv4()}.wav`;
  const filepath = path.join(SONGS_DIR, filename);
  fs.writeFileSync(filepath, Buffer.from(response.data));

  return { filename, filepath, provider: 'huggingface_musicgen' };
}

async function _instrumentalFromReplicate(prompt, durationSeconds) {
  if (!process.env.REPLICATE_API_TOKEN) throw new Error('REPLICATE_API_TOKEN eksik');

  const cleanPrompt = prompt.replace(/\[.*?\]/g, '').trim().substring(0, 300);

  const token    = process.env.REPLICATE_API_TOKEN;
  const version  = process.env.REPLICATE_MODEL_VERSION ||
    'b05b1dff1d8c6dc63d14b0cdb42135378dcb87f6942d2d4edf3ca6523a5b7a4e';

  console.log(`🎵 [Scenario2→Replicate] İstek başlatılıyor...`);

  const startRes = await axios.post(
    'https://api.replicate.com/v1/predictions',
    { version, input: { prompt: cleanPrompt, model_version: 'melody', duration: Math.min(durationSeconds, 30), output_format: 'mp3' } },
    { headers: { Authorization: `Token ${token}` }, timeout: 30_000 }
  );

  const predId = startRes.data.id;

  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3_000));
    const poll = await axios.get(
      `https://api.replicate.com/v1/predictions/${predId}`,
      { headers: { Authorization: `Token ${token}` } }
    );

    if (poll.data.status === 'succeeded' && poll.data.output) {
      const audioUrl = Array.isArray(poll.data.output) ? poll.data.output[0] : poll.data.output;
      const dlRes    = await axios.get(audioUrl, { responseType: 'arraybuffer', timeout: 60_000 });
      const filename = `instrumental_rep_${uuidv4()}.mp3`;
      const filepath = path.join(SONGS_DIR, filename);
      fs.writeFileSync(filepath, Buffer.from(dlRes.data));
      return { filename, filepath, provider: 'replicate_musicgen' };
    }
    if (poll.data.status === 'failed') throw new Error(`Replicate başarısız: ${poll.data.error}`);
  }
  throw new Error('Replicate zaman aşımı');
}

function _instrumentalFallback(durationSeconds) {
  const filename = `instrumental_fallback_${uuidv4()}.wav`;
  const filepath = path.join(SONGS_DIR, filename);
  // 440 Hz sine wave — ffmpeg ile
  try {
    execSync(
      `ffmpeg -f lavfi -i "sine=frequency=440:duration=${durationSeconds}" -b:a 192k "${filepath}" -y`,
      { timeout: 15_000, stdio: 'pipe' }
    );
  } catch {
    // ffmpeg yoksa boş dosya
    fs.writeFileSync(filepath, Buffer.alloc(100));
  }
  return { filename, filepath, provider: 'fallback_sine' };
}

// ──────────────────────────────────────────────────────────────────────────────
// BÖLÜM 3: VOKAL ÜRETİMİ
// Provider zinciri: ElevenLabs → OpenAI TTS → Edge-TTS (local)
// Kritik: dry vocal (reverb/efekt YOK) → mix aşamasında eklenir
// ──────────────────────────────────────────────────────────────────────────────

async function generateVocal(lyrics, gender, genre) {
  const vocalPrompt = buildVocalPrompt(lyrics, genre, gender);

  const providers = [
    () => _vocalFromElevenLabs(lyrics, gender),
    () => _vocalFromOpenAiTTS(lyrics, gender),
    () => _vocalFromEdgeTTS(lyrics, gender),
  ];

  const errors = [];
  for (const fn of providers) {
    try {
      const result = await fn();
      if (result && result.filename) {
        console.log(`✅ [Scenario2] Vokal üretildi: ${result.filename} (${result.provider})`);
        return result;
      }
    } catch (err) {
      console.warn(`⚠️  [Scenario2] Vokal provider başarısız: ${err.message}`);
      errors.push(err.message);
    }
  }
  throw new Error('Tüm vokal provider\'lar başarısız: ' + errors.join(' | '));
}

async function _vocalFromElevenLabs(lyrics, gender) {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY eksik');

  // Dry, studio vocal için optimize sesler
  // Male: Antoni (erkek, net tenor) | Female: Bella (kadın, soprano)
  const voiceId = gender === 'female'
    ? (process.env.ELEVENLABS_VOICE_FEMALE || 'EXAVITQu4vr4xnSDxMaL')  // Bella
    : (process.env.ELEVENLABS_VOICE_MALE   || 'ErXwobaYiN019PkySvjV');  // Antoni

  console.log(`🎤 [Scenario2→ElevenLabs] Voice: ${voiceId} (${gender})`);

  const response = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      text: lyrics.substring(0, 2500),
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.8,
        style: 0.0,        // 0 = dry, doğal ses
        use_speaker_boost: true,
      },
    },
    {
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      responseType: 'arraybuffer',
      timeout: 60_000,
    }
  );

  if (response.status !== 200) throw new Error(`ElevenLabs HTTP ${response.status}`);

  const filename = `vocal_el_${uuidv4()}.mp3`;
  const filepath = path.join(SONGS_DIR, filename);
  fs.writeFileSync(filepath, Buffer.from(response.data));

  return { filename, filepath, provider: 'elevenlabs', voiceId };
}

async function _vocalFromOpenAiTTS(lyrics, gender) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY eksik');

  // onyx = erkek, derin | nova = kadın, berrak
  const voice = gender === 'female' ? 'nova' : 'onyx';

  console.log(`🎤 [Scenario2→OpenAI TTS] Voice: ${voice}`);

  const response = await axios.post(
    'https://api.openai.com/v1/audio/speech',
    {
      model: 'tts-1-hd',   // tts-1-hd: daha yüksek kalite
      voice,
      input: lyrics.substring(0, 4096),
      speed: 0.95,         // hafif yavaş — şarkı ritmi için
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      responseType: 'arraybuffer',
      timeout: 60_000,
    }
  );

  const filename = `vocal_oai_${uuidv4()}.mp3`;
  const filepath = path.join(SONGS_DIR, filename);
  fs.writeFileSync(filepath, Buffer.from(response.data));

  return { filename, filepath, provider: 'openai_tts', voice };
}

async function _vocalFromEdgeTTS(lyrics, gender) {
  // edge-tts paket kurulu olmalı: pip install edge-tts
  const voice = gender === 'female' ? 'tr-TR-EmelNeural' : 'tr-TR-AhmetNeural';

  console.log(`🎤 [Scenario2→EdgeTTS] Voice: ${voice}`);

  const filename = `vocal_edge_${uuidv4()}.mp3`;
  const filepath = path.join(SONGS_DIR, filename);

  try {
    // Python edge-tts komutu
    execSync(
      `edge-tts --voice "${voice}" --text "${lyrics.substring(0, 1000).replace(/"/g, "'")}" --write-media "${filepath}"`,
      { timeout: 60_000, stdio: 'pipe' }
    );
    if (!fs.existsSync(filepath) || fs.statSync(filepath).size < 1000) {
      throw new Error('edge-tts çıktı dosyası oluşturulamadı');
    }
    return { filename, filepath, provider: 'edge_tts', voice };
  } catch (err) {
    throw new Error(`edge-tts başarısız: ${err.message}`);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// BÖLÜM 4: PROFESYONEL MIX
// Altyapı + Vokal birleştirme — FFmpeg filter_complex
// Vokal öne, altyapı arka — compressor + EQ + loudnorm
// ──────────────────────────────────────────────────────────────────────────────

async function mixTracks(instrumentalPath, vocalPath, outputPath, duration) {
  if (!fs.existsSync(instrumentalPath)) throw new Error('Altyapı dosyası bulunamadı');
  if (!fs.existsSync(vocalPath))        throw new Error('Vokal dosyası bulunamadı');

  console.log(`🎚️  [Scenario2→Mix] ${path.basename(instrumentalPath)} + ${path.basename(vocalPath)}`);

  const filterComplex =
    // Altyapıyı %20 azalt — vokal için yer aç
    '[1:a]volume=0.28,' +
    // Altyapıya hafif bass boost (vokal frekans alanını işgal etmeden)
    'equalizer=f=200:width_type=o:width=2:g=3,' +
    // 2-4kHz'i kes — vokalin en çok yaşadığı bölge, altyapıda boş bırak
    'equalizer=f=2000:width_type=o:width=1:g=-4[bg];' +
    // Vokal ses seviyesi +%15
    '[0:a]volume=1.15[voc];' +
    // İkisini birleştir
    '[voc][bg]amix=inputs=2:duration=first:dropout_transition=3[mixed];' +
    // Kompressör — dinamik aralığı dengele
    '[mixed]acompressor=threshold=-16dB:ratio=3.5:attack=3:release=80:makeup=1.5,' +
    // Master EQ — alt bass netleştir, hava frekansı ekle
    'equalizer=f=80:width_type=o:width=2:g=2,' +
    'equalizer=f=12000:width_type=o:width=2:g=1.5,' +
    // Loudness normalizasyon — yayın standardı (-14 LUFS)
    'loudnorm=I=-14:TP=-1.5:LRA=9[out]';

  execSync(
    `ffmpeg -y -i "${vocalPath}" -i "${instrumentalPath}" ` +
    `-filter_complex "${filterComplex}" ` +
    `-map [out] -t ${duration} ` +
    `-c:a libmp3lame -b:a 192k "${outputPath}"`,
    { timeout: 120_000, stdio: 'pipe' }
  );

  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 5000) {
    throw new Error('Mix çıktısı oluşturulamadı veya çok küçük');
  }

  console.log(`✅ [Scenario2→Mix] Tamamlandı: ${outputPath}`);
  return outputPath;
}

// ──────────────────────────────────────────────────────────────────────────────
// BÖLÜM 5: ANA FONKSİYON — generateScenario2
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Senaryo 2: MusicGen altyapı + Harici Vokal AI → Profesyonel Mix
 *
 * @param {object} opts
 * @param {string} opts.lyrics          - Şarkı sözleri
 * @param {string} opts.genre           - Müzik türü (POP, RAP, SLOW...)
 * @param {string} opts.gender          - Şarkıcı cinsiyeti (male/female)
 * @param {number} opts.duration        - Süre (saniye)
 * @param {string} [opts.customPrompt]  - Özel altyapı promptu (opsiyonel)
 * @returns {Promise<{filename, audioUrl, provider, vocalProvider, instrumentalProvider}>}
 */
async function generateScenario2({ lyrics, genre, gender, duration, customPrompt }) {
  const jobId = uuidv4();
  console.log(`\n🚀 [Scenario2] Pipeline başladı: ${jobId}`);
  console.log(`   Genre: ${genre} | Gender: ${gender} | Duration: ${duration}s`);

  const tmpFiles = [];

  try {
    // 1. Prompt mühendisliği
    const instrumentalPrompt = customPrompt || buildInstrumentalPrompt(genre, lyrics.substring(0, 100));
    const vocalPrompt        = buildVocalPrompt(lyrics, genre, gender);
    console.log(`\n📝 [Scenario2] Altyapı Promptu:\n   ${instrumentalPrompt.substring(0, 120)}...`);
    console.log(`\n🎤 [Scenario2] Vokal Promptu:\n   ${vocalPrompt.substring(0, 120)}...`);

    // 2. Paralel üretim — altyapı ve vokal aynı anda
    console.log(`\n⚡ [Scenario2] Altyapı + Vokal paralel üretimi başlıyor...`);
    const [instrumentalResult, vocalResult] = await Promise.all([
      generateInstrumental(instrumentalPrompt, duration),
      generateVocal(lyrics, gender, genre),
    ]);

    tmpFiles.push(instrumentalResult.filepath, vocalResult.filepath);

    // 3. Profesyonel Mix
    const outputFilename = `scenario2_${jobId}.mp3`;
    const outputPath     = path.join(SONGS_DIR, outputFilename);
    await mixTracks(instrumentalResult.filepath, vocalResult.filepath, outputPath, duration);

    // 4. Serve URL
    const base     = (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000').replace(/\/$/, '');
    const audioUrl = `${base}/songs/${outputFilename}`;

    console.log(`\n✅ [Scenario2] Pipeline TAMAMLANDI: ${outputFilename}`);
    console.log(`   Altyapı: ${instrumentalResult.provider}`);
    console.log(`   Vokal:   ${vocalResult.provider}`);
    console.log(`   URL:     ${audioUrl}`);

    return {
      filename:             outputFilename,
      audioUrl,
      provider:             `scenario2:${instrumentalResult.provider}+${vocalResult.provider}`,
      instrumentalProvider: instrumentalResult.provider,
      vocalProvider:        vocalResult.provider,
      instrumentalPrompt,
      vocalPrompt,
    };
  } finally {
    // Geçici dosyaları temizle
    for (const f of tmpFiles) {
      try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch {}
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
module.exports = {
  generateScenario2,
  buildInstrumentalPrompt,
  buildVocalPrompt,
  generateInstrumental,
  generateVocal,
  mixTracks,
  getBpmForGenre,
  GENRE_TECH_MAP,
};
