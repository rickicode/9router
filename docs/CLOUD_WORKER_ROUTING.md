# Cloud Worker Routing - Panduan Lengkap

## Daftar Isi
- [Pengenalan](#pengenalan)
- [Arsitektur](#arsitektur)
- [Setup & Deployment](#setup--deployment)
- [Konfigurasi](#konfigurasi)
- [Cara Penggunaan](#cara-penggunaan)
- [API Reference](#api-reference)
- [Troubleshooting](#troubleshooting)

---

## Pengenalan

Cloud Worker Routing adalah fitur yang memungkinkan 9Router untuk:
- **Round-Robin**: Mendistribusikan request ke multiple credentials secara merata
- **Sticky Sessions**: Menjaga konsistensi routing per client untuk durasi tertentu
- **Usage Tracking**: Melacak statistik penggunaan real-time per connection
- **Health Monitoring**: Memantau status kesehatan worker

### Keuntungan

✅ **Load Balancing**: Request terdistribusi merata ke semua akun  
✅ **Quota Optimization**: Maksimalkan penggunaan semua credentials  
✅ **Zero Downtime**: Fallback otomatis jika worker down  
✅ **Real-time Monitoring**: Dashboard menampilkan health status dan usage  

---

## Arsitektur

```
┌─────────────────────────────────────────────────────────┐
│  9Router (localhost:20128)                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Job Scheduler (setelah quota check selesai)     │   │
│  │ → Push config ke worker (credentials + settings)│   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Usage Poller (setiap 1 detik)                   │   │
│  │ → Poll usage dari worker                        │   │
│  │ → Update dashboard                              │   │
│  └─────────────────────────────────────────────────┘   │
└────────────┬────────────────────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────────────────────┐
│  Cloudflare Worker (edge)                               │
│  ┌─────────────────────────────────────────────────┐   │
│  │ D1 Storage (persistent)                         │   │
│  │ - Credentials                                   │   │
│  │ - Settings (roundRobin, sticky, dll)            │   │
│  │ - Models & Combos                               │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Memory State (ephemeral)                        │   │
│  │ - Round-robin indexes                           │   │
│  │ - Sticky session map                            │   │
│  │ - Usage statistics                              │   │
│  └─────────────────────────────────────────────────┘   │
└────────────┬────────────────────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────────────────────┐
│  AI Providers (Claude, OpenAI, Gemini, dll)            │
└─────────────────────────────────────────────────────────┘
```

### Komponen

**9Router (Control Plane):**
- Manage semua credentials & token refresh
- Push config ke worker setelah quota check
- Poll usage setiap 1 detik
- Display health status di dashboard

**Cloudflare Worker (Execution Layer):**
- Terima config dari 9Router
- Store config di D1 (persistent)
- Maintain routing state di memory (ephemeral)
- Route requests menggunakan round-robin/sticky logic
- Track usage statistics
- Report health status

---

## Setup & Deployment

### 1. Setup Cloudflare Worker

```bash
# Login ke Cloudflare
npm install -g wrangler
wrangler login

# Masuk ke folder cloud
cd cloud
npm install

# Buat KV & D1 namespace
wrangler kv namespace create KV
wrangler d1 create 9router-db

# Copy ID yang dihasilkan ke wrangler.toml
```

Edit `cloud/wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "KV"
id = "YOUR_KV_NAMESPACE_ID"  # Paste ID dari command di atas

[[d1_databases]]
binding = "DB"
database_name = "9router-db"
database_id = "YOUR_D1_DATABASE_ID"  # Paste ID dari command di atas
```

### 2. Initialize Database

```bash
# Jalankan migration
wrangler d1 execute 9router-db --remote --file=./migrations/0001_init.sql
```

### 3. Deploy Worker

```bash
# Deploy ke Cloudflare
npm run deploy

# Output akan menampilkan URL worker, contoh:
# https://9router.YOUR_SUBDOMAIN.workers.dev
```

### 4. Konfigurasi 9Router

Edit `.env` atau set environment variable:
```bash
NEXT_PUBLIC_CLOUD_URL=https://9router.YOUR_SUBDOMAIN.workers.dev
```

Atau set di dashboard:
1. Buka Dashboard → Endpoint
2. Scroll ke "Cloud Worker"
3. Masukkan Worker URL
4. Klik "Save"

---

## Konfigurasi

### Settings di 9Router Dashboard

Buka **Dashboard → Endpoint → Cloud Worker Settings**

#### 1. Round-Robin

**Enable/Disable**: Toggle switch  
**Fungsi**: Mendistribusikan request ke semua credentials secara bergiliran

**Contoh:**
- Punya 3 akun Codex: A, B, C
- Request 1 → Akun A
- Request 2 → Akun B
- Request 3 → Akun C
- Request 4 → Akun A (kembali ke awal)

**Kapan digunakan:**
- ✅ Punya multiple credentials per provider
- ✅ Ingin maksimalkan quota semua akun
- ✅ Load balancing penting

**Kapan tidak digunakan:**
- ❌ Hanya punya 1 credential per provider
- ❌ Ingin prioritas akun tertentu

#### 2. Sticky Sessions

**Enable/Disable**: Toggle switch  
**Fungsi**: Menjaga client menggunakan credential yang sama untuk durasi tertentu

**Contoh:**
- Client A request pertama → Akun 1
- Client A request berikutnya (dalam durasi sticky) → Akun 1 juga
- Client B request pertama → Akun 2
- Client B request berikutnya (dalam durasi sticky) → Akun 2 juga

**Kapan digunakan:**
- ✅ Aplikasi butuh konsistensi (misal: conversation context)
- ✅ Debugging lebih mudah (1 client = 1 akun)
- ✅ Rate limit per-client

**Kapan tidak digunakan:**
- ❌ Ingin distribusi benar-benar merata
- ❌ Client banyak tapi credentials sedikit

#### 3. Sticky Duration

**Default**: 300 detik (5 menit)  
**Range**: 60 - 3600 detik (1 menit - 1 jam)  
**Fungsi**: Berapa lama sticky session bertahan

**Rekomendasi:**
- **Short sessions (60-300s)**: Chat/completion requests
- **Medium sessions (300-900s)**: Conversation dengan context
- **Long sessions (900-3600s)**: Development/debugging

### Kombinasi Settings

**Scenario 1: Maximum Load Balancing**
```
Round-Robin: ✅ Enabled
Sticky: ❌ Disabled
```
→ Setiap request ke credential berbeda, distribusi paling merata

**Scenario 2: Balanced with Consistency**
```
Round-Robin: ✅ Enabled
Sticky: ✅ Enabled
Sticky Duration: 300s
```
→ Client dapat credential via round-robin, lalu stick ke credential itu selama 5 menit

**Scenario 3: Simple Fallback**
```
Round-Robin: ❌ Disabled
Sticky: ❌ Disabled
```
→ Selalu gunakan credential pertama yang available (default behavior)

---

## Cara Penggunaan

### 1. Enable Cloud Worker

Dashboard → Endpoint → Cloud Worker:
1. Masukkan Worker URL
2. Enable "Use Cloud Worker"
3. Klik "Save"

### 2. Konfigurasi Routing

Dashboard → Endpoint → Cloud Worker Settings:
1. Enable Round-Robin (jika punya multiple credentials)
2. Enable Sticky Sessions (jika butuh konsistensi)
3. Set Sticky Duration (default 300s)
4. Klik "Save Settings"

### 3. Monitor Health Status

Dashboard → Endpoint → Cloud Worker Health:

**Status Indicators:**
- 🟢 **Healthy**: Last sync < 60s ago (normal)
- 🟠 **Degraded**: Last sync 60-300s ago (sync failing tapi masih working)
- 🔴 **Down**: Last sync > 300s ago atau no data (worker down)

**Sync Age**: Menampilkan berapa detik sejak sync terakhir

### 4. Monitor Usage

Dashboard → Usage:
- Real-time statistics per connection
- Requests count
- Tokens input/output
- Error count
- Last used timestamp

---

## API Reference

### Worker Endpoints

#### POST /sync/:machineId

Sync config dari 9Router ke worker.

**Request:**
```json
{
  "providers": [
    {
      "id": "conn_123",
      "provider": "codex",
      "accountId": "user@email.com",
      "accessToken": "eyJ...",
      "refreshToken": "rt_...",
      "expiresAt": "2026-04-23T19:00:00Z",
      "isActive": true
    }
  ],
  "modelAliases": {
    "if/kimi-k2": {
      "provider": "kimi-coding",
      "model": "kimi-k2-thinking"
    }
  },
  "combos": [
    {
      "name": "if/kimi-k2-thinking",
      "models": ["kimi-coding/kimi-k2-thinking", "codex/claude-sonnet-4.5"]
    }
  ],
  "settings": {
    "roundRobin": true,
    "sticky": false,
    "stickyDuration": 300,
    "comboStrategy": "fallback",
    "comboStrategies": {},
    "providerStrategies": {}
  }
}
```

**Response:**
```json
{
  "success": true,
  "syncId": "sync_1745342400000",
  "receivedAt": "2026-04-23T18:00:01.234Z",
  "credentialsCount": 5,
  "modelsCount": 10,
  "combosCount": 3
}
```

#### GET /worker/usage/:machineId

Get usage statistics dari worker.

**Response:**
```json
{
  "timestamp": "2026-04-23T18:00:05Z",
  "lastSyncAt": "2026-04-23T18:00:00Z",
  "usage": {
    "conn_123": {
      "requests": 45,
      "tokensInput": 12500,
      "tokensOutput": 8300,
      "errors": 2,
      "lastUsed": "2026-04-23T18:00:03Z"
    }
  }
}
```

#### GET /worker/health/:machineId

Get health status worker.

**Response:**
```json
{
  "status": "healthy",
  "lastSyncAt": "2026-04-23T18:00:00Z",
  "syncAge": 45,
  "details": {
    "hasMachineData": true,
    "credentialsCount": 5,
    "lastSyncError": null,
    "uptime": 3600
  }
}
```

#### POST /v1/chat/completions

OpenAI-compatible chat endpoint dengan routing.

**Request:**
```json
{
  "model": "codex/claude-sonnet-4.5",
  "messages": [
    {"role": "user", "content": "Hello"}
  ],
  "stream": true
}
```

**Routing Logic:**
1. Resolve model → provider
2. Get eligible credentials untuk provider
3. Apply sticky session (jika enabled)
4. Apply round-robin (jika enabled)
5. Select credential
6. Call provider API
7. Record usage
8. Stream response

#### POST /v1/messages

Anthropic-compatible messages endpoint dengan routing.

**Request:**
```json
{
  "model": "claude-sonnet-4.5",
  "messages": [
    {"role": "user", "content": "Hello"}
  ],
  "max_tokens": 1024
}
```

### 9Router API Endpoints

#### GET /api/settings

Get current settings including worker routing config.

**Response:**
```json
{
  "roundRobin": false,
  "sticky": false,
  "stickyDuration": 300,
  "cloudEnabled": true,
  "cloudUrl": "https://9router.YOUR_SUBDOMAIN.workers.dev"
}
```

#### PATCH /api/settings

Update worker routing settings.

**Request:**
```json
{
  "roundRobin": true,
  "sticky": true,
  "stickyDuration": 600
}
```

**Response:**
```json
{
  "success": true
}
```

---

## Troubleshooting

### Worker Status: Down

**Gejala:**
- Health status menampilkan 🔴 Down
- Sync age > 300s

**Penyebab:**
1. Worker belum di-deploy
2. Worker URL salah
3. Network issue
4. 9Router tidak running

**Solusi:**
```bash
# 1. Cek worker deployed
wrangler deployments list

# 2. Cek worker URL di .env
echo $NEXT_PUBLIC_CLOUD_URL

# 3. Test worker langsung
curl https://YOUR_WORKER_URL/health/test-machine

# 4. Cek 9Router running
ps aux | grep node
```

### Worker Status: Degraded

**Gejala:**
- Health status menampilkan 🟠 Degraded
- Sync age 60-300s

**Penyebab:**
1. Quota scheduler belum running
2. Sync failing (network timeout)
3. Worker D1 issue

**Solusi:**
```bash
# 1. Restart 9Router
npm run dev

# 2. Check logs
tail -f logs/9router.log | grep SYNC

# 3. Manual sync test
curl -X POST http://localhost:20128/api/cloud/sync
```

### Round-Robin Tidak Bekerja

**Gejala:**
- Semua request ke credential yang sama
- Round-robin enabled tapi tidak rotate

**Penyebab:**
1. Hanya punya 1 credential per provider
2. Settings belum di-sync ke worker
3. Worker cold start (state reset)

**Solusi:**
```bash
# 1. Cek jumlah credentials
curl http://localhost:20128/api/providers

# 2. Force sync
curl -X POST http://localhost:20128/api/cloud/sync

# 3. Cek worker state
curl https://YOUR_WORKER_URL/worker/health/YOUR_MACHINE_ID
```

### Usage Tidak Update

**Gejala:**
- Dashboard usage tidak berubah
- Usage stats kosong

**Penyebab:**
1. Usage poller tidak running
2. Worker tidak record usage
3. Connection ID mismatch

**Solusi:**
```bash
# 1. Cek poller running
# Check logs untuk "[USAGE_POLL]"
tail -f logs/9router.log | grep USAGE_POLL

# 2. Test usage endpoint
curl https://YOUR_WORKER_URL/worker/usage/YOUR_MACHINE_ID

# 3. Restart 9Router
npm run dev
```

### Sticky Session Tidak Persist

**Gejala:**
- Client dapat credential berbeda setiap request
- Sticky enabled tapi tidak stick

**Penyebab:**
1. Sticky duration terlalu pendek
2. Worker cold start (memory reset)
3. API key berbeda per request

**Solusi:**
1. Increase sticky duration (600s+)
2. Tunggu worker warm up (1-2 menit)
3. Pastikan client menggunakan API key yang sama

### High Latency

**Gejala:**
- Request lambat via worker
- Timeout errors

**Penyebab:**
1. Worker cold start
2. D1 query slow
3. Network latency

**Solusi:**
```bash
# 1. Warm up worker
for i in {1..10}; do
  curl https://YOUR_WORKER_URL/health/test-machine
done

# 2. Check worker logs
wrangler tail

# 3. Use local 9Router untuk development
# Set NEXT_PUBLIC_CLOUD_URL=""
```

---

## Best Practices

### Development

1. **Local Testing**: Gunakan `wrangler dev` untuk test worker locally
2. **Staging**: Deploy ke staging worker dulu sebelum production
3. **Monitoring**: Enable observability untuk track errors

### Production

1. **Multiple Workers**: Deploy ke multiple regions untuk redundancy
2. **Rate Limiting**: Set rate limit per credential di 9Router
3. **Quota Monitoring**: Monitor quota usage via dashboard
4. **Backup**: Selalu punya fallback ke local 9Router

### Security

1. **API Keys**: Generate unique API key per client
2. **CORS**: Configure CORS di worker untuk production domain
3. **Secrets**: Store sensitive data di Cloudflare secrets
4. **Encryption**: Encrypt credentials di D1 (future enhancement)

---

## FAQ

**Q: Apakah worker bisa autonomous refresh token?**  
A: Tidak. Worker hanya execution layer. 9Router tetap handle token refresh dan push config ke worker.

**Q: Berapa lama usage data disimpan?**  
A: Usage data di memory, hilang saat worker restart. 9Router poll every 1s untuk update local DB.

**Q: Apakah bisa multiple 9Router instance share 1 worker?**  
A: Ya, setiap 9Router punya machineId unik. Worker handle multiple machines.

**Q: Berapa cost Cloudflare Worker?**  
A: Free tier: 100k requests/day. Paid: $5/month untuk 10M requests.

**Q: Apakah worker support semua providers?**  
A: Ya, worker generic. Support semua providers yang 9Router support.

**Q: Bagaimana jika worker down?**  
A: 9Router otomatis fallback ke local routing. Zero downtime.

---

## Changelog

### v1.0.0 (2026-04-23)
- ✨ Initial release
- ✨ Round-robin routing
- ✨ Sticky sessions
- ✨ Usage tracking
- ✨ Health monitoring
- ✨ Dashboard UI
- 📝 Complete documentation

---

## Support

**Issues**: https://github.com/decolua/9router/issues  
**Discord**: https://discord.gg/9router  
**Email**: support@9router.com

---

**Dibuat dengan ❤️ oleh 9Router Team**
