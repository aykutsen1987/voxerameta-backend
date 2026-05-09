// ============================================================
// VoxeraMeta — Colab MusicGen Provider (FIXED VERSION)
// ============================================================

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const SONGS_DIR =
  process.env.LOCAL_STORAGE_PATH || "/tmp/voxerameta-songs";

if (!fs.existsSync(SONGS_DIR)) {
  fs.mkdirSync(SONGS_DIR, { recursive: true });
}

async function generateWithColab(prompt, genre, duration) {
  const colabUrl = process.env.COLAB_MUSIC_API_URL;

  if (!colabUrl) {
    throw new Error("COLAB_MUSIC_API_URL env değişkeni tanımlı değil");
  }

  const safeDuration = Math.min(Number(duration || 15), 30);

  // ✔ URL FIX (slash problemi çözülmüş)
  const baseUrl = colabUrl.replace(/\/$/, "");
  const url = `${baseUrl}/generate-music`;

  console.log(`🎵 [Colab MusicGen] İstek → ${url}`);
  console.log(`   Prompt  : ${prompt?.substring(0, 80)}...`);
  console.log(`   Genre   : ${genre} | Duration: ${safeDuration}s`);

  try {
    const response = await axios.post(
      url,
      { prompt, genre, duration: safeDuration },
      {
        headers: { "Content-Type": "application/json" },
        responseType: "arraybuffer",
        timeout: 600000,
        validateStatus: () => true // ✔ HTTP hatalarını yakalamak için
      }
    );

    const contentType = response.headers["content-type"] || "";

    // ❌ HTTP error kontrol
    if (response.status !== 200) {
      const text = Buffer.from(response.data).toString("utf8");
      throw new Error(
        `Colab HTTP ${response.status} | ${text.slice(0, 200)}`
      );
    }

    // =========================================================
    // ✔ CASE 1: AUDIO (wav/mp3)
    // =========================================================
    if (contentType.startsWith("audio/")) {
      const ext = contentType.includes("mpeg") ? "mp3" : "wav";
      const filename = `colab_${uuidv4()}.${ext}`;
      const filepath = path.join(SONGS_DIR, filename);

      fs.writeFileSync(filepath, Buffer.from(response.data));

      const audioUrl = `${
        process.env.BASE_URL || "http://localhost:3000"
      }/songs/${filename}`;

      console.log(`✅ Audio saved: ${filename}`);

      return {
        filename,
        audioUrl,
        provider: "colab_musicgen",
        model: "musicgen"
      };
    }

    // =========================================================
    // ✔ CASE 2: JSON RESPONSE
    // =========================================================
    const text = Buffer.from(response.data).toString("utf8");

    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error("Colab response JSON parse edilemedi");
    }

    if (json.audio_url) {
      const dlRes = await axios.get(json.audio_url, {
        responseType: "arraybuffer",
        timeout: 120000
      });

      const ext = json.audio_url.includes(".mp3") ? "mp3" : "wav";
      const filename = `colab_${uuidv4()}.${ext}`;
      const filepath = path.join(SONGS_DIR, filename);

      fs.writeFileSync(filepath, Buffer.from(dlRes.data));

      const audioUrl = `${
        process.env.BASE_URL || "http://localhost:3000"
      }/songs/${filename}`;

      console.log(`✅ Audio downloaded from URL`);

      return {
        filename,
        audioUrl,
        provider: "colab_musicgen",
        model: "musicgen"
      };
    }

    if (json.error) {
      throw new Error(`Colab error: ${json.error}`);
    }

    throw new Error("Colab invalid response format");
  } catch (err) {
    console.error("❌ Colab error:", err.message);
    throw err;
  }
}

module.exports = { generateWithColab };
