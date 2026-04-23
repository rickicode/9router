# Cloud Worker Routing - Quick Start

## Setup Cepat (5 Menit)

### 1. Deploy Worker

```bash
cd cloud
npm install
wrangler login
wrangler kv namespace create KV
wrangler d1 create 9router-db
```

Edit `wrangler.toml` dengan ID yang dihasilkan, lalu:

```bash
wrangler d1 execute 9router-db --remote --file=./migrations/0001_init.sql
npm run deploy
```

### 2. Konfigurasi 9Router

Set environment variable:
```bash
NEXT_PUBLIC_CLOUD_URL=https://9router.YOUR_SUBDOMAIN.workers.dev
```

Atau via Dashboard → Endpoint → Cloud Worker

### 3. Enable Routing

Dashboard → Endpoint → Cloud Worker Settings:
- ✅ Enable Round-Robin
- ✅ Enable Sticky Sessions (optional)
- Set Sticky Duration: 300s
- Klik "Save Settings"

### 4. Monitor

Dashboard → Endpoint:
- 🟢 Health Status: Healthy
- 📊 Usage Stats: Real-time updates

---

## Fitur Utama

| Fitur | Deskripsi | Status |
|-------|-----------|--------|
| Round-Robin | Distribusi merata ke semua credentials | ✅ |
| Sticky Sessions | Konsistensi routing per client | ✅ |
| Usage Tracking | Real-time statistics | ✅ |
| Health Monitoring | Status kesehatan worker | ✅ |
| Auto Fallback | Fallback ke local jika worker down | ✅ |

---

## Endpoints

| Endpoint | Method | Deskripsi |
|----------|--------|-----------|
| `/sync/:machineId` | POST | Sync config dari 9Router |
| `/worker/usage/:machineId` | GET | Get usage statistics |
| `/worker/health/:machineId` | GET | Get health status |
| `/v1/chat/completions` | POST | OpenAI format dengan routing |
| `/v1/messages` | POST | Anthropic format dengan routing |

---

## Troubleshooting

**Worker Down?**
```bash
curl https://YOUR_WORKER_URL/health/test-machine
```

**Sync Failing?**
```bash
curl -X POST http://localhost:20128/api/cloud/sync
```

**Usage Not Updating?**
```bash
tail -f logs/9router.log | grep USAGE_POLL
```

---

## Dokumentasi Lengkap

📖 [CLOUD_WORKER_ROUTING.md](./CLOUD_WORKER_ROUTING.md)

- Setup & Deployment detail
- Konfigurasi lengkap
- API Reference
- Troubleshooting guide
- Best practices
- FAQ

---

## Support

- **Issues**: https://github.com/decolua/9router/issues
- **Docs**: [Full Documentation](./CLOUD_WORKER_ROUTING.md)
- **Discord**: https://discord.gg/9router
