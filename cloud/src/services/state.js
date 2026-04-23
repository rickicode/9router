// cloud/src/services/state.js

/**
 * Global in-memory state for worker
 * Reset on cold start
 */
const workerState = {
  // Round-robin indexes per provider
  roundRobinIndexes: new Map(),  // provider → index
  
  // Sticky sessions
  stickyMap: new Map(),          // apiKey → {connectionId, expiresAt}
  
  // Usage tracking per connection
  usage: new Map(),              // connectionId → {requests, tokensInput, tokensOutput, errors, lastUsed}
  
  // Last sync timestamp
  lastSyncAt: null,
  
  // Worker start time
  startedAt: Date.now()
};

/**
 * Get current state
 */
export function getState() {
  return workerState;
}

/**
 * Update last sync timestamp
 */
export function updateLastSync() {
  workerState.lastSyncAt = new Date().toISOString();
}

/**
 * Get worker uptime in seconds
 */
export function getUptime() {
  return Math.floor((Date.now() - workerState.startedAt) / 1000);
}

/**
 * Clear all state (for testing)
 */
export function clearState() {
  workerState.roundRobinIndexes.clear();
  workerState.stickyMap.clear();
  workerState.usage.clear();
  workerState.lastSyncAt = null;
}
