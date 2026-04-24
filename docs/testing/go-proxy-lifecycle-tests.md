# Go Proxy Lifecycle Testing Guide

## Test Scenarios

### Scenario 1: Start/Stop/Restart Flow

**Test Steps:**
1. Navigate to `http://localhost:20128/dashboard/endpoint`
2. Click "Go Proxy" tab
3. Verify initial status shows "Stopped"
4. Click "Start" button
5. Verify status changes to "Running"
6. Verify uptime counter starts incrementing
7. Verify port shows 20138
8. Click "Stop" button
9. Verify status changes to "Stopped"
10. Click "Start" again
11. Click "Restart" button while running
12. Verify process restarts successfully

**Expected Results:**
- ✓ Status badge updates correctly
- ✓ Buttons enable/disable appropriately
- ✓ Loading states show during operations
- ✓ No errors in console

### Scenario 2: Config Save & Auto-Restart

**Test Steps:**
1. Ensure Go Proxy is running
2. Change port from 20138 to 20139
3. Click "Save Config"
4. Verify confirmation modal appears
5. Click "Confirm"
6. Verify Go Proxy restarts automatically
7. Verify new port is reflected in status

**Expected Results:**
- ✓ Confirmation modal prevents accidental restarts
- ✓ Auto-restart completes successfully
- ✓ New config persists after restart

### Scenario 3: Error Handling & Retry

**Test Steps:**
1. Stop NineRouter main app (port 20128)
2. Try to start Go Proxy
3. Verify error message appears
4. Check logs section for retry attempts
5. Verify stops after 3 retries
6. Verify error message shows: "Cannot connect to NineRouter"
7. Start NineRouter main app
8. Click "Start" again
9. Verify Go Proxy starts successfully

**Expected Results:**
- ✓ Retry logic executes (1s, 2s, 4s delays)
- ✓ Error message is clear and actionable
- ✓ Stops after 3 attempts
- ✓ Manual restart works after fixing issue

### Scenario 4: Logs Viewer

**Test Steps:**
1. Start Go Proxy
2. Click logs section to expand
3. Verify logs display with timestamps
4. Wait 2 seconds
5. Verify logs auto-refresh
6. Verify auto-scroll to bottom
7. Collapse logs section
8. Verify logs stop refreshing when collapsed

**Expected Results:**
- ✓ Logs display in monospace font
- ✓ Timestamps are formatted correctly
- ✓ Auto-refresh works (2s interval)
- ✓ Auto-scroll to bottom works
- ✓ Performance: no lag with 50 log lines

### Scenario 5: Health Check

**Test Steps:**
1. Start Go Proxy
2. Verify health status shows "✓ Connected to NineRouter"
3. Stop NineRouter main app
4. Wait for health check to update
5. Verify health status shows "✗ Not connected"
6. Start NineRouter main app
7. Verify health status returns to connected

**Expected Results:**
- ✓ Health check updates every 2 seconds
- ✓ Status indicator color changes (green/red)
- ✓ Clear messaging

## Manual Testing Checklist

- [ ] Start/Stop/Restart flow works
- [ ] Config save triggers auto-restart
- [ ] Confirmation modal prevents accidents
- [ ] Error retry logic executes (3x)
- [ ] Error messages are clear
- [ ] Logs viewer displays correctly
- [ ] Logs auto-refresh works
- [ ] Health check updates correctly
- [ ] Request count displays
- [ ] Uptime counter increments
- [ ] All buttons have loading states
- [ ] No console errors during operations

## Test Status

**Manual Testing:** ⏳ Pending (requires running app)
**Code Review:** ✅ Implementation verified
