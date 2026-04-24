# Endpoint Tabs with Go Proxy Management

## Overview

Tab-based UI for endpoint management with integrated Go Proxy runtime management.

## Features

### Tab Navigation
- **Main Tab:** API keys, local endpoints, remote access controls, security settings
- **Cloud Tab:** Cloudflare Tunnel, Tailscale Funnel, Worker routing settings
- **Go Proxy Tab:** Runtime management with status monitoring, controls, configuration, and logs

### Go Proxy Management

**Runtime Control:**
- Start/Stop/Restart operations
- Auto-start on app launch
- Auto-restart on configuration changes
- 3x retry with exponential backoff (1s, 2s, 4s)

**Monitoring:**
- Real-time status updates (2s interval)
- Uptime tracking
- Request count display
- Health check to NineRouter
- Live logs viewer with auto-refresh

**Configuration:**
- Port setting (default: 20138)
- HTTP timeout (default: 30s)
- Binary path: `~/.9router/bin/9router-go-proxy` (fixed)

## Architecture

```
EndpointPageClient (29 lines)
├── MainTab (299 lines)
├── CloudTab (275 lines)
└── GoProxyTab (294 lines)
    └── Shared Components
        ├── GlassCard
        ├── StatusBadge
        ├── ToggleRow
        └── SectionHeader
```

**Backend:**
- `goProxyManager.js` - Process lifecycle management
- 5 REST API endpoints under `/api/runtime/go-proxy/*`

## Usage

### Accessing the UI

Navigate to: `http://localhost:20128/dashboard/endpoint`

### Starting Go Proxy

1. Click "Go Proxy" tab
2. Click "Start" button
3. Monitor status and logs

### Changing Configuration

1. Modify port or timeout values
2. Click "Save Config"
3. Confirm restart in modal
4. Go Proxy restarts with new settings

### Viewing Logs

1. Click logs section to expand
2. Logs auto-refresh every 2 seconds
3. Auto-scrolls to bottom
4. Click again to collapse

## Environment Variables

Required for Go Proxy operation:

```bash
INTERNAL_PROXY_RESOLVE_TOKEN=your_token_here
INTERNAL_PROXY_REPORT_TOKEN=your_token_here
```

## API Endpoints

### GET `/api/runtime/go-proxy`
Get current runtime status

**Response:**
```json
{
  "running": true,
  "pid": 12345,
  "port": 20138,
  "uptime": 3600,
  "requestCount": 1234,
  "health": {
    "connected": true,
    "ninerouterUrl": "http://localhost:20128"
  }
}
```

### POST `/api/runtime/go-proxy/start`
Start Go Proxy runtime

**Request:**
```json
{
  "port": 20138,
  "httpTimeoutSeconds": 30
}
```

### POST `/api/runtime/go-proxy/stop`
Stop Go Proxy runtime

### POST `/api/runtime/go-proxy/restart`
Restart Go Proxy runtime with new config

### GET `/api/runtime/go-proxy/logs?lines=50`
Get recent logs

**Response:**
```json
{
  "logs": [
    "[2024-01-15 10:23:45] INFO: go-proxy listening on 127.0.0.1:20138",
    "[2024-01-15 10:23:46] INFO: connected to NineRouter"
  ]
}
```

## Design System

**Glassmorphism Components:**
- Semi-transparent backgrounds with backdrop blur
- Radial gradient overlays
- Subtle borders and shadows
- Consistent spacing and typography

**Responsive Design:**
- Mobile: Single column, horizontal tab scroll
- Tablet: Optimized layouts
- Desktop: Full width with max constraints

**Accessibility:**
- Keyboard navigation support
- ARIA labels
- Touch targets ≥ 44px
- High contrast mode support

## Error Handling

**Retry Logic:**
- Automatic retry on failure (3 attempts)
- Exponential backoff: 1s, 2s, 4s
- Clear error messages
- Manual restart option

**Common Errors:**
- Port already in use
- Cannot connect to NineRouter
- Binary not found
- Missing environment variables

## Performance

- Status API: < 50ms
- Start operation: < 2s
- Stop operation: < 1s
- Restart operation: < 3s
- UI refresh: 2s interval
- Logs fetch: < 20ms

## Testing

See test guides:
- `docs/testing/go-proxy-lifecycle-tests.md`
- `docs/testing/responsive-design-tests.md`

## Troubleshooting

**Go Proxy won't start:**
1. Check binary exists at `~/.9router/bin/9router-go-proxy`
2. Verify environment variables are set
3. Check port 20138 is not in use
4. Ensure NineRouter is running on port 20128

**Health check fails:**
1. Verify NineRouter is running
2. Check network connectivity
3. Review logs for connection errors

**Logs not updating:**
1. Ensure logs section is expanded
2. Check browser console for errors
3. Verify Go Proxy is running

## Development

**File Structure:**
```
src/app/(dashboard)/dashboard/endpoint/
├── EndpointPageClient.js
├── components/
│   ├── MainTab.js
│   ├── CloudTab.js
│   ├── GoProxyTab.js
│   └── shared/
│       ├── GlassCard.js
│       ├── StatusBadge.js
│       ├── ToggleRow.js
│       └── SectionHeader.js
src/app/api/runtime/go-proxy/
├── route.js (status)
├── start/route.js
├── stop/route.js
├── restart/route.js
└── logs/route.js
src/lib/
└── goProxyManager.js
```

## Contributing

When modifying:
1. Maintain glassmorphism design consistency
2. Follow responsive design patterns
3. Update test documentation
4. Ensure accessibility compliance
5. Test on multiple viewports

## License

Part of 9Router project.
