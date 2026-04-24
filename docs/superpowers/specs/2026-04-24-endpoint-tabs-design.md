# Design: Endpoint Management with Tabs

**Date:** 2026-04-24  
**Status:** Approved  
**Author:** AI Assistant

---

## Overview

Refactor `/dashboard/endpoint` page into a tab-based interface with three tabs: **Main**, **Cloud**, and **Go Proxy**. This design maintains the existing glassmorphism aesthetic while improving organization and adding Go Proxy runtime management capabilities.

---

## Goals

1. **Better Organization:** Separate concerns into logical tabs (local settings, cloud services, runtime management)
2. **Add Go Proxy Management:** Provide UI for Go Proxy runtime control and monitoring
3. **Maintain Consistency:** Reuse existing glassmorphism design system
4. **Improve Maintainability:** Extract components for reusability

---

## Architecture

### Component Structure

```
src/app/(dashboard)/dashboard/endpoint/
├── page.js (server component, unchanged)
├── EndpointPageClient.js (refactored: tab container + navigation)
└── components/
    ├── MainTab.js (API keys, local endpoints, remote access, security)
    ├── CloudTab.js (Tunnel details, Tailscale details, Worker settings)
    ├── GoProxyTab.js (NEW: runtime management)
    └── shared/
        ├── GlassCard.js (reusable glassmorphism card)
        ├── StatusBadge.js (status indicators)
        ├── ToggleRow.js (toggle with description)
        └── SectionHeader.js (consistent section headers)
```

### State Management

- Each tab manages its own state independently
- Shared state (machineId, global settings) passed via props from parent
- API calls isolated per tab
- No global state library needed (React useState sufficient)

### Routing

- Client-side tab switching only (no route changes)
- Active tab stored in component state
- No URL parameters for tab state

---

## Tab Navigation

### Visual Design

```
┌─────────────────────────────────────────────────────┐
│  [Main]  [Cloud]  [Go Proxy]                        │
│  ━━━━━                                               │
└─────────────────────────────────────────────────────┘
```

### Features

- Glassmorphism style tabs
- Active tab: gradient underline (blue → violet)
- Inactive tabs: subtle hover effect
- Smooth transition animation
- Responsive: horizontal scroll on mobile

### Implementation

```jsx
const [activeTab, setActiveTab] = useState('Main');

<div className="flex gap-1 border-b border-white/10 mb-6 overflow-x-auto">
  {['Main', 'Cloud', 'Go Proxy'].map(tab => (
    <button
      key={tab}
      onClick={() => setActiveTab(tab)}
      className={`px-4 py-2 relative whitespace-nowrap transition-colors ${
        activeTab === tab 
          ? 'text-primary' 
          : 'text-text-muted hover:text-text'
      }`}
    >
      {tab}
      {activeTab === tab && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 to-violet-500" />
      )}
    </button>
  ))}
</div>
```

---

## Tab 1: Main

### Purpose

Quick access to local settings, remote access controls, and security configuration.

### Sections

#### 1. API Keys Management

**Content:**
- List of API keys with columns: Name, Key (masked), Created Date
- Eye icon to toggle key visibility
- Copy button per key
- Delete button with confirmation modal
- "Add New Key" button (opens modal)

**Layout:** Glassmorphism card

#### 2. Local Endpoints

**Content:**
- Local URL display: `http://localhost:20128/v1`
- Copy button
- Machine ID display with copy button

**Layout:** Glassmorphism card

#### 3. Remote Access

**Content:**
- Section header: "Remote Access"
- **Cloudflare Tunnel:**
  - Status badge (Enabled/Disabled)
  - Enable/Disable button
  - Public URL display (when enabled) with copy button
- **Tailscale Funnel:**
  - Status badge (Enabled/Disabled)
  - Enable/Disable button
  - Tailscale URL display (when enabled) with copy button

**Purpose:** Quick enable/disable for remote access methods. Detailed management in Cloud tab.

**Layout:** Glassmorphism card with two sub-sections

#### 4. Security Settings

**Content:**
- Toggle: "Require API Key" with description
- Toggle: "Require Login" with description
- Password status indicator
- Toggle: "Tunnel Dashboard Access" with description

**Layout:** Glassmorphism card with toggle rows

---

## Tab 2: Cloud

### Purpose

Detailed management and monitoring of cloud services (Cloudflare Tunnel, Tailscale Funnel, Cloudflare Worker).

### Sections

#### 1. Cloudflare Tunnel Details

**Content:**
- Status card showing:
  - Runtime state (Running/Stopped/Error)
  - Uptime
  - Last error (if any)
- Public URL display with copy button
- Connection health indicator
- Logs viewer (collapsible, last 50 lines, auto-scroll)

**Purpose:** Monitor and troubleshoot Cloudflare Tunnel for exposing local 9router instance.

**Layout:** Glassmorphism card

#### 2. Tailscale Funnel Details

**Content:**
- Status card showing:
  - Runtime state (Running/Stopped/Error)
  - Uptime
  - Last error (if any)
- Tailscale URL display with copy button
- Connection status
- Logs viewer (collapsible, last 50 lines, auto-scroll)

**Purpose:** Monitor and troubleshoot Tailscale Funnel for exposing local 9router instance.

**Layout:** Glassmorphism card

#### 3. Cloudflare Worker Settings

**Content:**
- **Round-Robin toggle** with description: "Distribute requests across multiple credentials"
- **Sticky Sessions toggle** with description: "Maintain consistent routing per client"
- **Sticky Duration input** (conditional, shows when sticky enabled):
  - Number input, default 300 seconds
  - Description: "Defines how long a client stays pinned..."
- **Cloud URLs Management:**
  - List of worker URLs
  - Add new URL input with "Add" button
  - Test URL button per URL
  - Delete URL button per URL
- **Cloud Health Status:**
  - Last sync timestamp
  - Health check result
  - Refresh button
- **Save Settings button** (gradient style, bottom right)

**Purpose:** Configure Cloudflare Worker routing behavior (separate from Tunnel).

**Layout:** Glassmorphism card

---

## Tab 3: Go Proxy

### Purpose

Manage and monitor Go Proxy runtime (local data plane proxy for high-performance request forwarding).

### Single Compact Card Design

**Structure:**
```
┌─────────────────────────────────────────────────────┐
│ GO PROXY RUNTIME                    ● Running       │
│                                                      │
│ Status Section                                      │
│ Controls Section                                    │
│ Configuration Section                               │
│ Logs Section (collapsible)                         │
└─────────────────────────────────────────────────────┘
```

### Status Section

**Content:**
- Runtime state badge (Running/Stopped/Error)
- Uptime counter (live update every second)
- Port display
- Request count (fetched from /usage API)
- Health check status: "Connected to NineRouter" or error message
- Last error display (when stopped due to error)

**Visual Example:**
```
• Runtime: Running
• Uptime: 2h 34m
• Port: 20138
• Requests: 1,234
• Health: ✓ Connected to NineRouter
```

### Controls Section

**Content:**
- Start button (disabled when running, shows loading state)
- Stop button (disabled when stopped, shows loading state)
- Restart button (enabled when running, shows loading state)

**Layout:** Horizontal button group with gradient styling

### Configuration Section

**Content:**
- Port input (number, default 20138, validation: 1024-65535)
- HTTP Timeout input (seconds, default 30, validation: 5-300)
- Binary path display (read-only, informational): `~/.9router/bin/9router-go-proxy`
- Save Config button (gradient style, triggers auto-restart)

**Behavior:**
- Auto-restart when Save Config clicked
- Show confirmation: "Saving will restart Go Proxy. Continue?"

### Logs Section

**Content:**
- Collapsible section with ▼/▶ icon
- Last 50 lines of logs
- Format: `[timestamp] LEVEL: message`
- Monospace font
- Max height 300px with scroll
- Auto-scroll to bottom when new logs arrive

**Example:**
```
[2024-01-15 10:23:45] INFO: go-proxy listening on 127.0.0.1:20138
[2024-01-15 10:23:46] INFO: connected to NineRouter at http://localhost:20128
[2024-01-15 10:24:12] INFO: forwarded request to openai (200 OK)
```

---

## Go Proxy Runtime Behavior

### Auto-Start

- Go Proxy automatically starts when 9router app launches
- Reads config from settings (port, timeout)
- Connects to NineRouter at `http://localhost:20128`
- Binary path fixed at `~/.9router/bin/9router-go-proxy`

### Auto-Restart on Config Change

1. User changes port/timeout
2. Click "Save Config"
3. Show confirmation modal: "Saving will restart Go Proxy. Continue?"
4. On confirm:
   - Save settings to database
   - Stop Go Proxy process
   - Start Go Proxy with new config
   - Update UI status
5. Show loading state during restart

### Error Handling

**Retry Logic:**
- On error: auto-retry 3 times with exponential backoff (1s, 2s, 4s)
- After 3 failures: stop and display error message

**Error Display:**
- Status badge: "Stopped"
- Stop reason: "Stopped due to error after 3 retry attempts"
- Last error: actual error message
- Timestamp of failure

**User Recovery:**
- User can manually click Start to retry
- Change port if port conflict detected
- Check NineRouter is running if connection error

### Stop Behavior

When stopped (manually or due to error), display:
- Status badge: "Stopped"
- Stop reason: "Manually stopped" or "Stopped due to error after 3 retry attempts"
- Last error (if applicable)
- Timestamp

---

## API Endpoints

### New Endpoints for Go Proxy

#### GET `/api/runtime/go-proxy`

**Purpose:** Get current Go Proxy runtime status

**Response:**
```json
{
  "enabled": true,
  "running": true,
  "status": "running",
  "pid": 12345,
  "host": "127.0.0.1",
  "port": 20138,
  "startedAt": "2024-01-15T10:23:45Z",
  "uptime": 9234,
  "lastError": null,
  "lastExitCode": null,
  "requestCount": 1234,
  "health": {
    "connected": true,
    "ninerouterUrl": "http://localhost:20128",
    "lastCheck": "2024-01-15T12:58:19Z"
  }
}
```

#### POST `/api/runtime/go-proxy/start`

**Purpose:** Start Go Proxy runtime

**Request:**
```json
{
  "port": 20138,
  "httpTimeoutSeconds": 30
}
```

**Response:** Same as GET `/api/runtime/go-proxy`

#### POST `/api/runtime/go-proxy/stop`

**Purpose:** Stop Go Proxy runtime

**Response:** Same as GET `/api/runtime/go-proxy`

#### POST `/api/runtime/go-proxy/restart`

**Purpose:** Restart Go Proxy runtime with new config

**Request:**
```json
{
  "port": 20138,
  "httpTimeoutSeconds": 30
}
```

**Response:** Same as GET `/api/runtime/go-proxy`

#### GET `/api/runtime/go-proxy/logs`

**Purpose:** Get recent Go Proxy logs

**Query params:** `?lines=50`

**Response:**
```json
{
  "logs": [
    "[2024-01-15 10:23:45] INFO: go-proxy listening on 127.0.0.1:20138",
    "[2024-01-15 10:23:46] INFO: connected to NineRouter at http://localhost:20128",
    "[2024-01-15 10:24:12] INFO: forwarded request to openai (200 OK)"
  ]
}
```

### Existing Endpoints (No Changes)

- `/api/settings` - for Main tab security settings
- `/api/tunnel/*` - for Cloud tab tunnel management
- `/api/usage` - for request counts (used in Go Proxy tab)

---

## Data Flow

### Go Proxy Lifecycle

```
App Launch
    ↓
Load Settings (port, timeout)
    ↓
Start Go Proxy Process
    ↓
Connect to NineRouter
    ↓
[Running State]
    ↓
On Error → Retry 3x → Stop (show error)
    ↓
User clicks Start → Restart cycle
```

### Config Update Flow

```
User changes port/timeout
    ↓
Click "Save Config"
    ↓
Show confirmation modal
    ↓
User confirms
    ↓
Save to settings
    ↓
Stop Go Proxy
    ↓
Start Go Proxy with new config
    ↓
Update UI status
```

### Tab Switching Flow

```
User clicks tab
    ↓
Update activeTab state
    ↓
Unmount current tab component
    ↓
Mount new tab component
    ↓
New tab loads its data
```

---

## Error Handling

### Go Proxy Errors

#### Scenario 1: Port Already in Use

- **Error message:** "Port 20138 is already in use"
- **Action:** Retry 3x with backoff, then stop
- **UI shows:** "Stopped due to error: Port 20138 is already in use"
- **User action:** Change port in config and save

#### Scenario 2: Cannot Connect to NineRouter

- **Error message:** "Cannot connect to NineRouter at http://localhost:20128"
- **Action:** Retry 3x with backoff, then stop
- **UI shows:** "Stopped due to error: Cannot connect to NineRouter"
- **User action:** Ensure NineRouter is running, then click Start

#### Scenario 3: Binary Not Found

- **Error message:** "Go Proxy binary not found at ~/.9router/bin/9router-go-proxy"
- **Action:** No retry, stop immediately
- **UI shows:** "Stopped due to error: Binary not found"
- **User action:** Reinstall 9router or check binary path

### Cloud Service Errors

- Existing error handling for Cloudflare Tunnel and Tailscale Funnel remains unchanged
- Errors displayed in respective sections of Cloud tab

---

## Testing Strategy

### Unit Tests

- Tab navigation state management
- Component rendering per tab
- API call mocking
- Error state handling
- Shared component behavior

### Integration Tests

- Go Proxy start/stop/restart flow
- Config save and auto-restart
- Error retry mechanism
- Log viewer updates
- Tab switching with data persistence

### E2E Tests

- Full user flow: navigate tabs → configure → save
- Go Proxy lifecycle: start → error → retry → stop
- Cloud Worker settings save and sync
- Remote access enable/disable flow

---

## Migration Plan

### Phase 1: Component Extraction (Day 1)

1. Extract existing sections from `EndpointPageClient.js` into separate components
2. Create shared components (GlassCard, StatusBadge, ToggleRow, SectionHeader)
3. Test existing functionality still works
4. No visual changes yet

**Deliverable:** Refactored code with same UI

### Phase 2: Tab Navigation (Day 1-2)

1. Add tab navigation UI to `EndpointPageClient.js`
2. Wrap existing content in MainTab component
3. Test tab switching
4. Ensure state persists correctly

**Deliverable:** Tab UI with Main tab functional

### Phase 3: Cloud Tab (Day 2)

1. Move Cloudflare Tunnel details to CloudTab
2. Move Tailscale Funnel details to CloudTab
3. Move Worker settings to CloudTab
4. Test all Cloud functionality
5. Ensure no regressions

**Deliverable:** Cloud tab functional with all existing features

### Phase 4: Go Proxy Backend (Day 3)

1. Implement Go Proxy API endpoints in `/api/runtime/go-proxy/*`
2. Add runtime management logic (start/stop/restart)
3. Implement error retry mechanism
4. Add logging infrastructure
5. Test API endpoints

**Deliverable:** Go Proxy backend ready

### Phase 5: Go Proxy Tab (Day 3-4)

1. Build GoProxyTab component
2. Implement status display
3. Implement controls (start/stop/restart)
4. Implement configuration section
5. Implement logs viewer
6. Test Go Proxy lifecycle

**Deliverable:** Go Proxy tab functional

### Phase 6: Polish & Testing (Day 4-5)

1. Responsive design testing (mobile, tablet, desktop)
2. Error handling testing (all scenarios)
3. Performance optimization (lazy loading, memoization)
4. Accessibility testing (keyboard navigation, screen readers)
5. Documentation updates

**Deliverable:** Production-ready feature

---

## Design Decisions

### Why Tab-Based UI?

- **Organization:** Separates concerns logically (local, cloud, runtime)
- **Scalability:** Easy to add new tabs in future
- **User Experience:** Reduces cognitive load by grouping related settings
- **Performance:** Only active tab content is rendered

### Why Single Card for Go Proxy?

- **Simplicity:** Go Proxy is a single runtime, not multiple services
- **Compactness:** All info visible without scrolling
- **Consistency:** Matches glassmorphism design of other sections

### Why Auto-Start Go Proxy?

- **User Experience:** Users expect proxy to be running when app starts
- **Reliability:** Reduces manual steps for users
- **Performance:** Go Proxy provides faster request forwarding than Node.js

### Why Auto-Restart on Config Change?

- **Convenience:** Users don't need to manually restart
- **Safety:** Confirmation modal prevents accidental restarts
- **Consistency:** Matches behavior of other runtime services

### Why Fixed Binary Path?

- **Simplicity:** Reduces configuration complexity
- **Reliability:** Standard location ensures consistent behavior
- **Security:** Prevents users from pointing to arbitrary binaries

---

## Future Enhancements

### Potential Additions

1. **Go Proxy Metrics Dashboard:**
   - Request latency histogram
   - Throughput graph
   - Error rate chart

2. **Advanced Logging:**
   - Log level filtering (debug, info, warn, error)
   - Search/filter logs
   - Export logs to file

3. **Multiple Go Proxy Instances:**
   - Run multiple proxies on different ports
   - Load balancing between instances

4. **Health Check Alerts:**
   - Desktop notifications on Go Proxy errors
   - Email alerts for critical failures

5. **Performance Tuning:**
   - Connection pool size configuration
   - Request timeout per provider
   - Retry policy customization

---

## Success Criteria

### Functional Requirements

- ✅ Tab navigation works smoothly
- ✅ All existing features work in new tab structure
- ✅ Go Proxy can be started/stopped/restarted
- ✅ Go Proxy auto-starts on app launch
- ✅ Config changes trigger auto-restart
- ✅ Error retry mechanism works (3x with backoff)
- ✅ Logs display correctly and auto-scroll
- ✅ Request count displays in Go Proxy tab

### Non-Functional Requirements

- ✅ Responsive design (mobile, tablet, desktop)
- ✅ Consistent glassmorphism styling
- ✅ No performance regressions
- ✅ Accessible (keyboard navigation, screen readers)
- ✅ Error messages are clear and actionable

### User Experience

- ✅ Users can easily find settings in appropriate tabs
- ✅ Go Proxy management is intuitive
- ✅ Error states are clearly communicated
- ✅ Loading states provide feedback

---

## Conclusion

This design refactors the Endpoint page into a well-organized tab-based interface while adding comprehensive Go Proxy runtime management. The approach maintains consistency with existing design patterns, improves maintainability through component extraction, and provides users with clear visibility and control over all endpoint-related settings.

The phased migration plan ensures a smooth transition with minimal risk, and the comprehensive error handling ensures a robust user experience even when things go wrong.
