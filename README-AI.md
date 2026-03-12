# VoxeraMeta — Tam Değişiklik & Kurulum Kılavuzu (README-AI)

> Bu belge projenin **eski hali ile yeni hali arasındaki tüm farkları**, hangi dosyaların **silindiğini, eklendiğini veya değiştirildiğini** ve tüm **API key kurulumlarını** açıklar.

---

## 📊 Özet Tablo

| Durum | Dosya / Bileşen | Eski Hal | Yeni Hal |
|-------|----------------|----------|----------|
| 🆕 YENİ | `backend/` klasörü | **YOK** | Node.js/Express backend |
| 🆕 YENİ | `hybrid/HybridPromptEngine.kt` | **YOK** | 3 katmanlı prompt motoru |
| 🆕 YENİ | `ui/HybridPromptScreen.kt` | **YOK** | Rehberli 3 adımlı UI |
| ✏️ DEĞİŞTİ | `data/RenderServerClient.kt` | Auth yok | X-Auth-Token header eklendi |
| ✏️ DEĞİŞTİ | `repository/SongRepository.kt` | Basit Map body | HybridPromptEngine entegrasyonu |
| ✏️ DEĞİŞTİ | `ui/MainScreen.kt` | Tek buton | + Hibrit Prompt Asistanı butonu |
| ⚠️ MOCK | `data/MultiApiManager.kt` | delay(2000) + sahte URL | Hâlâ mock — backend routes tamamlıyor |
| ✅ KORUNDU | Tüm mipmap ikon dosyaları | .webp ikonlar | Değişmedi |
| ✅ KORUNDU | `ui/Theme.kt` | Material3 | Değişmedi |
| ✅ KORUNDU | `ui/Components.kt` | UI bileşenleri | Değişmedi |
| ✅ KORUNDU | `ui/AudioRecorder.kt` | Ses kayıt | Değişmedi |
| ✅ KORUNDU | `model/SongRequest.kt` | Enum'lar | Değişmedi |
| ✅ KORUNDU | `model/SongResponse.kt` | Yanıt modeli | Değişmedi |
| ✅ KORUNDU | `data/ApiModels.kt` | 10 provider tanımı | Değişmedi |
| ✅ KORUNDU | `repository/AdvancedAiProcessor.kt` | Ses analizi stub | Değişmedi |
| ✅ KORUNDU | `viewmodel/SongGenerationViewModel.kt` | StateFlow | Değişmedi |
| ✅ KORUNDU | `utils/` (4 dosya) | Yardımcılar | Değişmedi |

---

## 🔴 ESKİ HAL — Ne Vardı, Ne Yoktu

### Orijinal ZIP'te Sadece Android Uygulaması Vardı

Backend hiç yoktu. Uygulama teorik olarak Render'a istek atıyordu ama sunucu gerçekte yoktu.

---

### MultiApiManager.kt — callRenderServer() MOCK'tu

```kotlin
// ESKİ KOD — GERÇEK DEĞİL, SAHTE ÇALIŞIYORDU
private suspend fun callRenderServer(...): RenderServerResponse {
    // TODO: Gerçek HTTP çağrısı (Retrofit)
    // Şu an mock olarak çalışıyor

    delay(2000) // Sadece 2 saniye bekliyordu, gerçek işlem yok

    return RenderServerResponse(
        id = UUID.randomUUID().toString(),
        status = "completed",
        // SAHTE URL — bu dosya gerçekte hiç oluşturulmuyordu
        audioUrl = "https://voxerameta-render.onrender.com/songs/${UUID.randomUUID()}.mp3",
        duration = 180,
        title = "Oluşturulan Şarkı",
        processingTime = 2000
    )
}
```
Sonuç: Uygulama "tamamlandı" diyordu ama hiçbir şey üretmiyordu.

---

### RenderServerClient.kt — Auth yoktu

```kotlin
// ESKİ KOD
.addHeader("Content-Type", "application/json")
.addHeader("Accept", "application/json")
.addHeader("User-Agent", "VoxeraMeta-Android/1.0.0")
// X-Auth-Token YOK — backend güvenlik doğrulaması yoktu
```

---

### SongRepository.kt — Basit body

```kotlin
// ESKİ KOD
private fun buildRequestBody(request: SongRequest): Map<String, Any> {
    return mapOf(
        "lyrics" to request.lyrics,
        "genre" to request.genre.name,
        "duration" to request.duration.seconds,
        "language" to request.language.code,
        "theme" to request.theme,
        "hasVoice" to (request.voiceFile != null),
        "hasMelody" to (request.melodyFile != null)
    )
    // sunoStylePrompt, voiceClonePrompt, hybridMode, strategy — YOK
}
```

---

### MainScreen.kt — Tek buton, hibrit yok

```kotlin
// ESKİ KOD
// showHybridPrompt state — YOKTU
// when bloğunda hibrit routing — YOKTU
// Sadece şu vardı:
Button(onClick = { viewModel.generateSong() }) {
    Text("Şarkı Oluştur")
}
```

---

### hybrid/ klasörü — YOKTU

```
// ESKİ PROJE YAPISI:
data/ model/ repository/ ui/ utils/ viewmodel/
// hybrid/ klasörü → TAMAMEN YOKTU
```

---

## 🟢 YENİ HAL — Eklenen ve Değişen Her Şey

---

### 1. YENİ: backend/ Klasörü (Node.js/Express)

Sıfırdan yazıldı. Render.com'a deploy edilmek üzere tasarlandı.

```
backend/
├── package.json              — Node.js bağımlılıkları
├── render.yaml               — Render.com otomatik deploy config
├── .env.example              — Tüm API key şablonu (açıklamalı)
├── .gitignore
└── src/
    ├── server.js             — Ana Express sunucusu
    ├── routes/
    │   ├── songs.js          — Şarkı endpoint'leri
    │   └── health.js         — Sistem sağlığı endpoint'leri
    ├── services/
    │   └── musicGenerator.js — AI provider zinciri
    └── middleware/
        ├── auth.js           — X-Auth-Token doğrulama
        └── errorHandler.js   — Hata yönetimi
```

---

#### src/server.js — Ne Yapar?

Express, CORS, rate limiting, logging kurar. Tüm route'ları bağlar.
Başlatınca konsola yazar: hangi API key'lerin aktif olduğunu.

---

#### src/routes/songs.js — Endpoint'ler

```
POST /api/v1/generate-song    — Android'den istek alır, job ID döner
GET  /api/v1/song-status?id=  — Android polling: durum sorgular
GET  /api/v1/download?id=     — MP3 dosyasını indirir
```

Akış: İstek gelir → job ID üretilir → arka planda AI çalışır →
Android her 3 saniyede bir polling yapar → hazır olunca MP3 URL döner.

---

#### src/routes/health.js — Endpoint'ler

```
GET /api/v1/health                        — Sistem sağlığı
GET /api/v1/provider-status?provider=XYZ  — Belirli AI sağlayıcı durumu
GET /api/v1/quota-info?provider=XYZ       — Kota bilgisi
```

---

#### src/services/musicGenerator.js — AI Provider Zinciri

```
İstek gelir
    |
    |— [1] Anthropic Claude  → lyrics'i verse/chorus/bridge yapısına dönüştürür
    |                          (sadece hybridMode=true ise çalışır)
    |
    |— [2] HuggingFace MusicGen → Ücretsiz, facebook/musicgen-small modeli
    |       Başarısız olursa
    |— [3] Replicate MusicGen   → Polling ile üretir, ~$0.002/sn
    |       Başarısız olursa
    |— [4] Stability AI Audio   → Stable Audio Open modeli
    |       Başarısız olursa
    |— [5] Demo Fallback        → "API key eksik" mesajı döner
```

---

#### src/middleware/auth.js — Güvenlik

Her /api/v1/generate-song isteğinde X-Auth-Token header kontrol edilir.
Android ile backend'deki token eşleşmezse 403 döner.

---

### 2. YENİ: hybrid/HybridPromptEngine.kt

```kotlin
// Yeni fonksiyonlar:
buildPoetryToSongPrompt()   — Claude/GPT için şiir prompt üretir
buildSunoStylePrompt()       — Suno Style kutusunu üretir
buildVoiceClonePrompt()      — RVC/Kits.ai ses parametresini üretir
buildHybridRenderRequest()   — Backend'e gönderilecek zengin body üretir
parseSongStructure()         — [Verse] etiketlerini ayrıştırır

// Yeni veri modelleri:
VoiceDescription             — Ses karakter tanımı (cinsiyet, ton, kısıklık)
SunoPromptPair               — styleBox + extendInstructions
SongStructure                — Ayrıştırılmış şarkı bölümleri
```

---

### 3. YENİ: ui/HybridPromptScreen.kt

Ana ekrandaki "Hibrit Prompt Asistanı" butonuna basılınca açılır.

```
Adım 1: Şiir kutusu + tür seçimi (Pop/Rap/Slow/Lofi/Akustik)
Adım 2: Ses karakteri (cinsiyet, ton, kısıklık checkbox, referans var/yok)
[Hibrit Promptları Oluştur] butonu
  → Çıktı 1: Claude/GPT için şarkı dönüşüm promptu  [Kopyala]
  → Çıktı 2: Suno Style kutusu + ipucu notu          [Kopyala]
  → Çıktı 3: RVC/Kits.ai ses parametresi             [Kopyala]
  → Alt kart: Suno/Kits.ai ücretsiz limit ipuçları
```

---

### 4. DEĞİŞTİ: data/RenderServerClient.kt

| Alan | Eski | Yeni |
|------|------|------|
| AUTH_TOKEN sabiti | YOKTU | Eklendi |
| X-Auth-Token header | YOKTU | Eklendi |
| Versiyon | 1.0.0 | 1.1.0 |
| BASE_URL | Aynı | Değiştirilmeli |

```kotlin
// YENİ — Eklenenler:
private const val AUTH_TOKEN = "BURAYA_BACKEND_AUTH_TOKEN_KOY"

// Header'a eklendi:
.addHeader("X-Auth-Token", AUTH_TOKEN)
.addHeader("User-Agent", "VoxeraMeta-Android/1.1.0")
```

---

### 5. DEĞİŞTİ: repository/SongRepository.kt

```kotlin
// ESKİ — 7 alan
return mapOf("lyrics", "genre", "duration", "language", "theme", "hasVoice", "hasMelody")

// YENİ — 15+ alan, HybridPromptEngine entegre
val hybridRequest = HybridPromptEngine.buildHybridRenderRequest(
    structuredLyrics = request.lyrics,
    genre = request.genre,
    language = request.language,
    voiceDescription = null,
    hasMelodyReference = request.melodyFile != null,
    durationSeconds = request.duration.seconds
)
return hybridRequest + mapOf("theme" to ..., "hasVoice" to ...)
// Artık sunoStylePrompt, voiceClonePrompt, hybridMode, strategy da gönderiliyor
```

---

### 6. DEĞİŞTİ: ui/MainScreen.kt

```kotlin
// YENİ state eklendi:
var showHybridPrompt by remember { mutableStateOf(false) }

// YENİ routing eklendi:
when {
    showHybridPrompt -> HybridPromptScreen(onBack = { showHybridPrompt = false })
    uiState is UiState.Loading -> ...
    ...
}

// YENİ buton eklendi (Şarkı Oluştur'un üstüne):
OutlinedButton(onClick = { showHybridPrompt = true }) {
    Icon(Icons.Default.AutoAwesome)
    Text("Hibrit Prompt Asistanı")
}
```

---

## ⚠️ Bilinen Eksikler (TODO)

| Eksik | Nerede | Açıklama |
|-------|--------|----------|
| callRenderServer() hâlâ mock | MultiApiManager.kt | Backend route'lar gerçek çağrıyı karşılıyor; Android'in SongRepository üzerinden direkt RenderServerClient kullanması yeterli. MultiApiManager'ın mock kısmı ileride temizlenecek. |
| AdvancedAiProcessor stub | AdvancedAiProcessor.kt | TFLite modeli henüz entegre edilmedi |
| VoiceDescription null gönderiliyor | SongRepository.kt | buildHybridRenderRequest'e voiceDescription=null, ileride SongRequest'e taşınacak |
| Multipart ses yükleme | Backend | Ses/melodi dosyası yükleme endpoint'i henüz yok |

---

## 🔑 API Key Kurulum Rehberi

### Hangi Key Ne İşe Yarar?

```
ANTHROPIC_API_KEY   → Şiiri verse/chorus/bridge yapısına dönüştürür
                      Olmadan: Orijinal lyrics direkt gönderilir (yine çalışır)

HUGGINGFACE_API_KEY → Ana müzik üretim modeli (MusicGen — ücretsiz)
                      Olmadan: Replicate'e düşer

REPLICATE_API_KEY   → HuggingFace başarısız olursa devreye girer
                      Olmadan: Stability AI'ye düşer

STABILITY_API_KEY   → Replicate başarısız olursa devreye girer
                      Olmadan: Demo moda düşer

API_AUTH_TOKEN      → Android ile backend güvenlik doğrulaması
                      Olmadan: Production'da 401 hatası

APP_SECRET          → Şifrelenmiş oturum için rastgele string
```

---

### Anthropic Claude

URL: https://console.anthropic.com/settings/keys
"Create Key" → kopyala
```
ANTHROPIC_API_KEY=sk-ant-api03-XXXXXXXX
```
Ücretsiz: İlk $5 kredi otomatik
Maliyet: claude-sonnet-4 → ~$3 / 1M token (~1500 şarkı dönüşümü)

---

### HuggingFace

URL: https://huggingface.co/settings/tokens
"New token" → "Read" → "Generate"
```
HUGGINGFACE_API_KEY=hf_XXXXXXXXXXXXXXXX
```
Ücretsiz tier: rate limit var, model soğuksa 20-30sn bekleme
PRO Plan: $9/ay → rate limit yok

---

### Replicate

URL: https://replicate.com/account/api-tokens
"Create token" → kopyala
```
REPLICATE_API_KEY=r8_XXXXXXXXXXXXXXXX
```
Maliyet: MusicGen → ~$0.0023/sn
Örnek: 30sn şarkı ≈ $0.07

---

### Stability AI

URL: https://platform.stability.ai/account/keys
"Create API Key" → kopyala
```
STABILITY_API_KEY=sk-XXXXXXXXXXXXXXXX
```
Ücretsiz: 25 kredi/gün
Ücretli: $0.01/kredi

---

### API_AUTH_TOKEN (Kendi Ürettiğin Şifre)

Bu bir API key değil, senin belirlediğin token. Android ve Backend'de aynı olmalı.

```bash
# Terminal'de rastgele üret:
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
# Örnek: a3f9b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8
```

Backend .env:
```
API_AUTH_TOKEN=a3f9b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8
```

Android RenderServerClient.kt:
```kotlin
private const val AUTH_TOKEN = "a3f9b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8"
```

---

## 🚀 Deploy Adımları

### 1. Backend GitHub'a Yükle

```bash
cd backend/
git init
git add .
git commit -m "VoxeraMeta Backend v1.1.0"
# GitHub'da yeni repo aç (Private önerilir)
git remote add origin https://github.com/KULLANICI/voxerameta-backend.git
git push -u origin main
```

### 2. Render.com Deploy

1. https://render.com → GitHub ile giriş
2. "New +" → "Web Service" → repoyu seç
3. Ayarlar: Region: Frankfurt | Build: npm install | Start: npm start
4. "Advanced" → tüm env değişkenlerini gir
5. Deploy tamamlanınca URL al: https://XXXXX.onrender.com
6. Bu URL'yi BASE_URL env'ine de ekle

### 3. Sağlık Kontrolü

```bash
curl https://XXXXX.onrender.com/api/v1/health
# {"status":"healthy","activeProviders":3,...}
```

### 4. Android Güncelle

RenderServerClient.kt içinde:
```kotlin
private const val BASE_URL = "https://XXXXX.onrender.com/"
private const val AUTH_TOKEN = "a3f9b2c1..."
```

### 5. Test

```bash
curl -X POST https://XXXXX.onrender.com/api/v1/generate-song \
  -H "Content-Type: application/json" \
  -H "X-Auth-Token: a3f9b2c1..." \
  -d '{"lyrics":"Test şarkı","genre":"POP","duration":30,"hybridMode":false}'
# {"id":"abc-123","status":"processing"}

curl "https://XXXXX.onrender.com/api/v1/song-status?id=abc-123" \
  -H "X-Auth-Token: a3f9b2c1..."
# {"status":"completed","audioUrl":"..."}
```

---

## 📋 Tam Dosya Listesi

### Android App

```
android-app/
├── README.md                                    — Genel özet
├── README-AI.md                                 — Bu belge
└── app/src/main/java/com/muzik/voxerameta/
    ├── MainActivity.kt                          ✅ Değişmedi
    ├── data/
    │   ├── ApiClient.kt                         ✅ Değişmedi
    │   ├── ApiModels.kt                         ✅ Değişmedi — 10 provider enum
    │   ├── MultiApiManager.kt                   ⚠️  mock callRenderServer hâlâ var
    │   ├── MusicApiService.kt                   ✅ Değişmedi
    │   └── RenderServerClient.kt                ✏️  AUTH_TOKEN + X-Auth-Token eklendi
    ├── hybrid/
    │   └── HybridPromptEngine.kt                🆕 YENİ — prompt motoru
    ├── model/
    │   ├── SongRequest.kt                       ✅ Değişmedi
    │   └── SongResponse.kt                      ✅ Değişmedi
    ├── repository/
    │   ├── AdvancedAiProcessor.kt               ✅ Değişmedi — stub
    │   └── SongRepository.kt                    ✏️  HybridPromptEngine entegre
    ├── ui/
    │   ├── AboutScreen.kt                       ✏️  versiyon güncellendi
    │   ├── AudioRecorder.kt                     ✅ Değişmedi
    │   ├── Components.kt                        ✅ Değişmedi
    │   ├── HybridPromptScreen.kt                🆕 YENİ — 3 adımlı UI
    │   ├── MainScreen.kt                        ✏️  yeni buton + routing
    │   └── Theme.kt                             ✅ Değişmedi
    ├── utils/
    │   ├── ErrorHandler.kt                      ✅ Değişmedi
    │   ├── FilePickerManager.kt                 ✅ Değişmedi
    │   ├── FileUtils.kt                         ✅ Değişmedi
    │   └── PermissionUtils.kt                   ✅ Değişmedi
    └── viewmodel/
        └── SongGenerationViewModel.kt           ✅ Değişmedi
```

### Backend

```
backend/                                         🆕 TAMAMEN YENİ
├── .env.example                                 — API key şablonu
├── .gitignore                                   — node_modules, .env hariç
├── package.json                                 — express, axios, dotenv, multer...
├── render.yaml                                  — Render.com deploy config
└── src/
    ├── server.js                                — Ana Express + middleware
    ├── routes/
    │   ├── songs.js                             — generate/status/download
    │   └── health.js                            — health/provider/quota
    ├── services/
    │   └── musicGenerator.js                    — AI zinciri (HF→Replicate→Stability)
    └── middleware/
        ├── auth.js                              — X-Auth-Token doğrulama
        └── errorHandler.js                      — Merkezi hata
```

---

*VoxeraMeta v1.1.0 — @aykutsen1987*
