// ============================================================
// VoxeraMeta — Senaryo 2 Motoru v2.1 (DÜZELTİLMİŞ)
// MusicGen (Altyapı) + Harici Vokal AI (TTS → İşleme → Mix)
//
// DÜZELTMELER:
//   [BUG-1] HuggingFace router URL → inference API URL değiştirildi
//   [BUG-2] mixTracks'te amix duration=first yerine duration=longest
//   [BUG-3] _vocalFromEdgeTTS kabuk injection açığı kapatıldı
//   [BUG-4] generateInstrumental'da HuggingFace content-type kontrolü gevşetildi
//   [BUG-5] mixTracks filterComplex EQ virgül/noktalı virgül sırası düzeltildi
//   [BUG-6] Replicate poll döngüsü race condition düzeltildi
//   [BUG-7] Temp dosya cleanup finally bloğu sağlamlaştırıldı
//   [BUG-8] buildVocalPrompt lyrics sınırı 500→1500 karaktere çıkarıldı
// ============================================================

'use strict';

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');
const { v4: uuidv4 } = require('uuid');
const { execSync, execFile } = require('child_process');

const SONGS_DIR = process.env.LOCAL_STORAGE_PATH || '/tmp/voxerameta-songs';
if (!fs.existsSync(SONGS_DIR)) fs.mkdirSync(SONGS_DIR, { recursive: true });

// ──────────────────────────────────────────────────────────────────────────────
// BÖLÜM 1: TEKNİK PROMPT MÜHENDİSLİĞİ
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

// [BUG-8] DÜZELTİLDİ: lyrics 500 → 1500 karakter (kısa sözlerde vokal prompt kesiliyordu)
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
    `[Lyrics/Content]: ${lyrics.substring(0, 1500)}`  // BUG-8: 500→1500
  );
}

function getBpmForGenre(genre) {
  const g    = genre.toUpperCase();
  const tech = GENRE_TECH_MAP[g] || GENRE_TECH_MAP.POP;
  return tech.bpm;
}

// ──────────────────────────────────────────────────────────────────────────────
// BÖLÜM 2: ALTYAPI ÜRETİMİ (MUSICGEN)
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

  console.warn(`⚠️  [Scenario2] Tüm altyapı provider'lar başarısız — sine wave oluşturuluyor`);
  return _instrumentalFallback(durationSeconds);
}

// [BUG-1] DÜZELTİLDİ: router.huggingface.co → api-inference.huggingface.co
// [BUG-4] DÜZELTİLDİ: content-type kontrolü audio/* yerine audio veya octet-stream kabul ediyor
async function _instrumentalFromHuggingFace(prompt, durationSeconds) {
  if (!process.env.HUGGINGFACE_API_KEY) throw new Error('HUGGINGFACE_API_KEY eksik');

  const cleanPrompt = prompt.replace(/\[.*?\]/g, '').trim().substring(0, 300) +
    ', frequency space left open for lead vocals, no melody in mid-range';

  console.log(`🎵 [Scenario2→HuggingFace] Prompt: ${cleanPrompt.substring(0, 80)}...`);

  const response = await axios.post(
    // BUG-1: Eski URL router.huggingface.co → Doğru Inference API URL
    'https://api-inference.huggingface.co/models/facebook/musicgen-small',
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

  // BUG-4: HuggingFace bazen 'audio/flac' veya 'application/octet-stream' döner
  const contentType = response.headers['content-type'] || '';
  if (!contentType.includes('audio') && !contentType.includes('octet-stream')) {
    throw new Error(`HuggingFace ses döndürmedi: ${contentType}`);
  }

  const filename = `instrumental_hf_${uuidv4()}.wav`;
  const filepath = path.join(SONGS_DIR, filename);
  fs.writeFileSync(filepath, Buffer.from(response.data));

  return { filename, filepath, provider: 'huggingface_musicgen' };
}

// [BUG-6] DÜZELTİLDİ: Poll döngüsünde await sırası race condition → for-of + sleep önce
async function _instrumentalFromReplicate(prompt, durationSeconds) {
  if (!process.env.REPLICATE_API_TOKEN) throw new Error('REPLICATE_API_TOKEN eksik');

  const cleanPrompt = prompt.replace(/\[.*?\]/g, '').trim().substring(0, 300);

  const token   = process.env.REPLICATE_API_TOKEN;
  const version = process.env.REPLICATE_MODEL_VERSION ||
    'b05b1dff1d8c6dc63d14b0cdb42135378dcb87f6942d2d4edf3ca6523a5b7a4e';

  console.log(`🎵 [Scenario2→Replicate] İstek başlatılıyor...`);

  const startRes = await axios.post(
    'https://api.replicate.com/v1/predictions',
    {
      version,
      input: {
        prompt:        cleanPrompt,
        model_version: 'melody',
        duration:      Math.min(durationSeconds, 30),
        output_format: 'mp3',
      },
    },
    { headers: { Authorization: `Token ${token}` }, timeout: 30_000 }
  );

  const predId = startRes.data.id;

  // BUG-6: Sleep ÖNCE poll SONRA — başlar başlamaz sorgu yerine bekle sonra sor
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5_000)); // 3s→5s: cold start için daha güvenli

    const poll = await axios.get(
      `https://api.replicate.com/v1/predictions/${predId}`,
      { headers: { Authorization: `Token ${token}` } }
    );

    const { status, output, error } = poll.data;

    if (status === 'succeeded' && output) {
      const audioUrl = Array.isArray(output) ? output[0] : output;
      const dlRes    = await axios.get(audioUrl, { responseType: 'arraybuffer', timeout: 60_000 });
      const filename = `instrumental_rep_${uuidv4()}.mp3`;
      const filepath = path.join(SONGS_DIR, filename);
      fs.writeFileSync(filepath, Buffer.from(dlRes.data));
      return { filename, filepath, provider: 'replicate_musicgen' };
    }

    if (status === 'failed') throw new Error(`Replicate başarısız: ${error}`);
    // 'starting' veya 'processing' → devam et
  }
  throw new Error('Replicate zaman aşımı (5dk)');
}

function _instrumentalFallback(durationSeconds) {
  const filename = `instrumental_fallback_${uuidv4()}.wav`;
  const filepath = path.join(SONGS_DIR, filename);
  try {
    execSync(
      `ffmpeg -f lavfi -i "sine=frequency=440:duration=${durationSeconds}" -b:a 192k "${filepath}" -y`,
      { timeout: 15_000, stdio: 'pipe' }
    );
  } catch {
    fs.writeFileSync(filepath, Buffer.alloc(100));
  }
  return { filename, filepath, provider: 'fallback_sine' };
}

// ──────────────────────────────────────────────────────────────────────────────
// BÖLÜM 3: VOKAL ÜRETİMİ
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
  throw new Error("Tüm vokal provider'lar başarısız: " + errors.join(' | '));
}

async function _vocalFromElevenLabs(lyrics, gender) {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY eksik');

  const voiceId = gender === 'female'
    ? (process.env.ELEVENLABS_VOICE_FEMALE || 'EXAVITQu4vr4xnSDxMaL')
    : (process.env.ELEVENLABS_VOICE_MALE   || 'ErXwobaYiN019PkySvjV');

  console.log(`🎤 [Scenario2→ElevenLabs] Voice: ${voiceId} (${gender})`);

  const response = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      text: lyrics.substring(0, 2500),
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability:        0.5,
        similarity_boost: 0.8,
        style:            0.0,
        use_speaker_boost: true,
      },
    },
    {
      headers: {
        'xi-api-key':   process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Accept':       'audio/mpeg',
      },
      responseType: 'arraybuffer',
      timeout:      60_000,
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

  const voice = gender === 'female' ? 'nova' : 'onyx';

  console.log(`🎤 [Scenario2→OpenAI TTS] Voice: ${voice}`);

  const response = await axios.post(
    'https://api.openai.com/v1/audio/speech',
    {
      model: 'tts-1-hd',
      voice,
      input: lyrics.substring(0, 4096),
      speed: 0.95,
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      responseType: 'arraybuffer',
      timeout:      60_000,
    }
  );

  const filename = `vocal_oai_${uuidv4()}.mp3`;
  const filepath = path.join(SONGS_DIR, filename);
  fs.writeFileSync(filepath, Buffer.from(response.data));

  return { filename, filepath, provider: 'openai_tts', voice };
}

// [BUG-3] DÜZELTİLDİ: execSync + string interpolation → execFile + args array (injection güvenli)
async function _vocalFromEdgeTTS(lyrics, gender) {
  const voice = gender === 'female' ? 'tr-TR-EmelNeural' : 'tr-TR-AhmetNeural';

  console.log(`🎤 [Scenario2→EdgeTTS] Voice: ${voice}`);

  const filename = `vocal_edge_${uuidv4()}.mp3`;
  const filepath = path.join(SONGS_DIR, filename);

  // Geçici metin dosyası — kabuk injection önlemek için args yerine dosya kullan
  const textFile = path.join(SONGS_DIR, `_edgetmp_${uuidv4()}.txt`);
  try {
    fs.writeFileSync(textFile, lyrics.substring(0, 1000), 'utf8');

    await new Promise((resolve, reject) => {
      // BUG-3: execSync+interpolation yerine execFile+array (shell injection YOK)
      execFile(
        'edge-tts',
        ['--voice', voice, '--file', textFile, '--write-media', filepath],
        { timeout: 60_000 },
        (err) => {
          if (err) reject(new Error(`edge-tts başarısız: ${err.message}`));
          else resolve();
        }
      );
    });

    if (!fs.existsSync(filepath) || fs.statSync(filepath).size < 1000) {
      throw new Error('edge-tts çıktı dosyası oluşturulamadı veya çok küçük');
    }
    return { filename, filepath, provider: 'edge_tts', voice };
  } finally {
    // Geçici metin dosyasını her durumda sil
    try { if (fs.existsSync(textFile)) fs.unlinkSync(textFile); } catch {}
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// BÖLÜM 4: PROFESYONEL MIX
// [BUG-2] DÜZELTİLDİ: amix duration=first → duration=longest (vokal kısa olduğunda mix kesiliyordu)
// [BUG-5] DÜZELTİLDİ: filterComplex zincirinde eksik noktalı virgül düzeltildi
// ──────────────────────────────────────────────────────────────────────────────

async function mixTracks(instrumentalPath, vocalPath, outputPath, duration) {
  if (!fs.existsSync(instrumentalPath)) throw new Error('Altyapı dosyası bulunamadı');
  if (!fs.existsSync(vocalPath))        throw new Error('Vokal dosyası bulunamadı');

  console.log(`🎚️  [Scenario2→Mix] ${path.basename(instrumentalPath)} + ${path.basename(vocalPath)}`);

  // BUG-5: Her filter zinciri arasında ; (noktalı virgül) doğru yerleştirildi
  // BUG-2: duration=first → duration=longest
  const filterComplex =
    // [0] = vocal input, [1] = instrumental input
    '[1:a]' +
      'volume=0.28,' +
      // Bass boost — vokal frekans alanını işgal etmeden
      'equalizer=f=200:width_type=o:width=2:g=3,' +
      // 2kHz kes — vokalin enerji bölgesi, altyapıda boş bırak
      'equalizer=f=2000:width_type=o:width=1:g=-4' +
    '[bg];' +
    '[0:a]volume=1.15[voc];' +
    // BUG-2: duration=longest — her iki track de tam uzunluğa kadar çalışır
    '[voc][bg]amix=inputs=2:duration=longest:dropout_transition=3[mixed];' +
    '[mixed]' +
      'acompressor=threshold=-16dB:ratio=3.5:attack=3:release=80:makeup=1.5,' +
      'equalizer=f=80:width_type=o:width=2:g=2,' +
      'equalizer=f=12000:width_type=o:width=2:g=1.5,' +
      // Yayın standardı: -14 LUFS (Spotify/Apple Music uyumlu)
      'loudnorm=I=-14:TP=-1.5:LRA=9' +
    '[out]';

  execSync(
    `ffmpeg -y -i "${vocalPath}" -i "${instrumentalPath}" ` +
    `-filter_complex "${filterComplex}" ` +
    `-map [out] -t ${duration} ` +
    `-c:a libmp3lame -b:a 192k -ar 44100 "${outputPath}"`,
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
// [BUG-7] DÜZELTİLDİ: finally cleanup null-check + hata yutulmaması
// ──────────────────────────────────────────────────────────────────────────────

async function generateScenario2({ lyrics, genre, gender, duration, customPrompt }) {
  const jobId = uuidv4();
  console.log(`\n🚀 [Scenario2] Pipeline başladı: ${jobId}`);
  console.log(`   Genre: ${genre} | Gender: ${gender} | Duration: ${duration}s`);

  // BUG-7: tmpFiles obje array olarak tutulur — daha güvenli cleanup
  const tmpFiles = [];

  try {
    const instrumentalPrompt = customPrompt || buildInstrumentalPrompt(genre, lyrics.substring(0, 100));
    const vocalPrompt        = buildVocalPrompt(lyrics, genre, gender);
    console.log(`\n📝 [Scenario2] Altyapı Promptu:\n   ${instrumentalPrompt.substring(0, 120)}...`);
    console.log(`\n🎤 [Scenario2] Vokal Promptu:\n   ${vocalPrompt.substring(0, 120)}...`);

    console.log(`\n⚡ [Scenario2] Altyapı + Vokal paralel üretimi başlıyor...`);
    const [instrumentalResult, vocalResult] = await Promise.all([
      generateInstrumental(instrumentalPrompt, duration),
      generateVocal(lyrics, gender, genre),
    ]);

    // BUG-7: null kontrolü ile kayıt
    if (instrumentalResult?.filepath) tmpFiles.push(instrumentalResult.filepath);
    if (vocalResult?.filepath)        tmpFiles.push(vocalResult.filepath);

    const outputFilename = `scenario2_${jobId}.mp3`;
    const outputPath     = path.join(SONGS_DIR, outputFilename);
    await mixTracks(instrumentalResult.filepath, vocalResult.filepath, outputPath, duration);

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
    // BUG-7: cleanup hatası ana hatayı yutmasın → try-catch per file
    for (const f of tmpFiles) {
      try {
        if (f && fs.existsSync(f)) {
          fs.unlinkSync(f);
          console.log(`🗑️  [Scenario2] Temp dosya silindi: ${path.basename(f)}`);
        }
      } catch (cleanupErr) {
        console.warn(`⚠️  [Scenario2] Temp dosya silinemedi: ${f} — ${cleanupErr.message}`);
      }
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
