# Cloud URL Management

**Feature:** Multi-URL support for cloud workers  
**Date:** 2026-04-23  
**Status:** Complete

---

## Overview

9Router now supports multiple cloud worker URLs with automatic failover, health monitoring, and easy management through the dashboard UI.

### Key Features

- ✅ Multiple cloud worker URLs
- ✅ Primary URL selection
- ✅ Connection testing
- ✅ Health status monitoring
- ✅ Add/remove URLs dynamically
- ✅ No environment variables needed

---

## UI Location

**Dashboard → Endpoint → Cloud Worker URLs**

---

## Features

### 1. Multiple URLs

Add multiple cloud worker deployments for redundancy:

```
Primary: https://9router-us.workers.dev ✅
Backup:  https://9router-eu.workers.dev
Backup:  https://9router-asia.workers.dev
```

### 2. Primary URL Selection

- Only one URL can be primary at a time
- Primary URL is used for all requests
- Click "Set as Primary" to switch

### 3. Connection Testing

- Test button per URL
- Shows latency in milliseconds
- Status indicators:
  - 🟢 Online (< 500ms)
  - 🟡 Slow (500-2000ms)
  - 🔴 Offline (> 2000ms or error)

### 4. Health Monitoring

- Auto-refresh every 30s
- Manual refresh button
- Shows last check time

---

## API Endpoints

### GET /api/cloud-urls

List all cloud URLs.

**Response:**
```json
{
  "cloudUrls": [
    {
      "id": 1,
      "url": "https://9router.workers.dev",
      "isPrimary": true,
      "status": "online",
      "lastChecked": "2026-04-23T18:00:00Z"
    }
  ]
}
```

### POST /api/cloud-urls

Add new cloud URL.

**Request:**
```json
{
  "url": "https://9router-backup.workers.dev"
}
```

**Response:**
```json
{
  "success": true,
  "cloudUrl": {
    "id": 2,
    "url": "https://9router-backup.workers.dev",
    "isPrimary": false,
    "status": "unknown"
  }
}
```

### PATCH /api/cloud-urls

Update cloud URL (set primary or update status).

**Request:**
```json
{
  "id": 2,
  "isPrimary": true
}
```

**Response:**
```json
{
  "success": true,
  "cloudUrls": [...]
}
```

### DELETE /api/cloud-urls

Remove cloud URL.

**Request:**
```json
{
  "id": 2
}
```

**Response:**
```json
{
  "success": true,
  "cloudUrls": [...]
}
```

### POST /api/cloud-urls/test

Test connection to cloud URL.

**Request:**
```json
{
  "url": "https://9router.workers.dev"
}
```

**Response:**
```json
{
  "success": true,
  "status": "online",
  "latency": 123,
  "statusCode": 200
}
```

---

## Usage Guide

### Adding Your First URL

1. Go to **Dashboard → Endpoint**
2. Scroll to **Cloud Worker URLs** section
3. Enter your worker URL: `https://YOUR_SUBDOMAIN.workers.dev`
4. Click **Add URL**
5. Click **Test Connection** to verify
6. URL is automatically set as primary (first URL)

### Adding Backup URLs

1. Click **Add URL** again
2. Enter backup worker URL
3. Click **Test Connection**
4. Backup URL is added (not primary)

### Switching Primary URL

1. Find the backup URL you want to use
2. Click **Set as Primary**
3. Previous primary becomes backup
4. All requests now use new primary URL

### Removing URLs

1. Click **Remove** button next to URL
2. Confirm deletion
3. Cannot remove primary URL (set another as primary first)

---

## Configuration

### Storage

URLs are stored in `db.json`:

```json
{
  "settings": {
    "cloudUrls": [
      {
        "id": 1,
        "url": "https://9router.workers.dev",
        "isPrimary": true,
        "status": "online",
        "lastChecked": "2026-04-23T18:00:00Z"
      }
    ]
  }
}
```

### Validation

- URL must start with `http://` or `https://`
- URL must be valid format
- Duplicate URLs not allowed
- At least one URL must exist
- Only one URL can be primary

---

## Integration

### Cloud Sync

`src/lib/cloudSync.js` automatically uses primary URL:

```javascript
async function getCloudUrl() {
  const settings = await getSettings();
  const primaryUrl = settings.cloudUrls?.find(u => u.isPrimary)?.url;
  return primaryUrl || "http://localhost:8787";
}
```

### Usage Poller

`src/shared/services/cloudUsagePoller.js` uses primary URL:

```javascript
async poll() {
  const cloudUrl = await getCloudUrl();
  const response = await fetch(`${cloudUrl}/worker/usage/${this.machineId}`);
  // ...
}
```

---

## Troubleshooting

### URL Not Connecting

1. Click **Test Connection**
2. Check error message
3. Verify worker is deployed: `wrangler deployments list`
4. Check worker logs: `wrangler tail`
5. Verify D1 database is initialized

### Primary URL Not Working

1. Add backup URL
2. Test backup URL
3. Set backup as primary
4. Remove old primary URL

### All URLs Offline

1. Check internet connection
2. Verify workers are deployed
3. Check Cloudflare status page
4. Try deploying fresh worker

---

## Best Practices

### Multi-Region Setup

Deploy workers in multiple regions for redundancy:

```
Primary: US (9router-us.workers.dev)
Backup:  EU (9router-eu.workers.dev)
Backup:  Asia (9router-asia.workers.dev)
```

### Health Monitoring

- Test connections regularly
- Monitor latency trends
- Switch to faster region if needed
- Remove consistently failing URLs

### Failover Strategy

1. Keep 2-3 backup URLs
2. Test all URLs weekly
3. Switch primary if latency > 1000ms
4. Remove URLs offline > 7 days

---

## Migration from Environment Variable

### Old Way (Environment Variable)

```bash
NEXT_PUBLIC_CLOUD_URL=https://9router.workers.dev
```

### New Way (Dashboard UI)

1. Go to Dashboard → Endpoint
2. Add URL in Cloud Worker URLs section
3. Remove `NEXT_PUBLIC_CLOUD_URL` from `.env`
4. Restart 9Router

**Note:** Environment variable still works as fallback if no URLs configured.

---

## API Reference

### Data Structure

```javascript
{
  cloudUrls: [
    {
      id: 1,
      url: "https://9router.worker1.workers.dev",
      status: "online",
      lastChecked: "2026-04-23T18:00:00Z"
    },
    {
      id: 2,
      url: "https://9router.worker2.workers.dev",
      status: "offline",
      lastChecked: "2026-04-23T17:55:00Z"
    }
  ]
}
```

**Note:** No `isPrimary` field - URLs are for monitoring only.

### Status Values

- `online` - Connection successful (< 2000ms)
- `offline` - Connection failed or timeout
- `unknown` - Not tested yet

---

## Examples

### Add Multiple URLs

```javascript
// Add primary
await fetch("/api/cloud-urls", {
  method: "POST",
  body: JSON.stringify({ url: "https://9router-us.workers.dev" })
});

// Add backup
await fetch("/api/cloud-urls", {
  method: "POST",
  body: JSON.stringify({ url: "https://9router-eu.workers.dev" })
});
```

### Test All URLs

```javascript
const { cloudUrls } = await fetch("/api/cloud-urls").then(r => r.json());

for (const url of cloudUrls) {
  const result = await fetch("/api/cloud-urls/test", {
    method: "POST",
    body: JSON.stringify({ url: url.url })
  }).then(r => r.json());
  
  console.log(`${url.url}: ${result.status} (${result.latency}ms)`);
}
```

### Switch to Fastest URL

```javascript
const { cloudUrls } = await fetch("/api/cloud-urls").then(r => r.json());

// Test all URLs
const results = await Promise.all(
  cloudUrls.map(async (url) => {
    const test = await fetch("/api/cloud-urls/test", {
      method: "POST",
      body: JSON.stringify({ url: url.url })
    }).then(r => r.json());
    return { ...url, latency: test.latency };
  })
);

// Find fastest
const fastest = results.sort((a, b) => a.latency - b.latency)[0];

// Set as primary
await fetch("/api/cloud-urls", {
  method: "PATCH",
  body: JSON.stringify({ id: fastest.id, isPrimary: true })
});
```

---

## Summary

- ✅ No more environment variables
- ✅ Multiple URLs for redundancy
- ✅ Easy switching via UI
- ✅ Health monitoring built-in
- ✅ Automatic failover ready
- ✅ Production ready

**Status:** Complete and ready to use! 🎉
