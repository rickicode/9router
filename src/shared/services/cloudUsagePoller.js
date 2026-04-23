import { getConsistentMachineId } from "@/shared/utils/machineId";
import { getProviderConnections, updateProviderConnection } from "@/lib/localDb";

/**
 * Get cloud URL from settings
 */
function getCloudUrl() {
  const url = process.env.NEXT_PUBLIC_CLOUD_URL || "http://localhost:8787";
  return url.replace(/\/$/, "");
}

/**
 * Cloud usage poller
 * Polls worker usage endpoint every interval
 */
export class CloudUsagePoller {
  constructor(machineId = null, intervalMs = 1000) {
    this.machineId = machineId;
    this.intervalMs = intervalMs;
    this.intervalId = null;
  }

  /**
   * Initialize machine ID if not provided
   */
  async initializeMachineId() {
    if (!this.machineId) {
      this.machineId = await getConsistentMachineId();
    }
  }

  /**
   * Start polling
   */
  async start() {
    if (this.intervalId) return;

    await this.initializeMachineId();

    this.poll().catch(() => {});

    this.intervalId = setInterval(() => {
      this.poll().catch(() => {});
    }, this.intervalMs);
  }

  /**
   * Stop polling
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Poll usage from worker
   */
  async poll() {
    await this.initializeMachineId();

    const cloudUrl = getCloudUrl();
    const response = await fetch(`${cloudUrl}/worker/usage/${this.machineId}`);

    if (!response.ok) {
      console.error("[USAGE_POLL] Failed:", response.statusText);
      return;
    }

    const data = await response.json();

    // Update local usage DB
    for (const [connId, usage] of Object.entries(data.usage || {})) {
      try {
        // Get existing connection to merge data
        const connections = await getProviderConnections();
        const conn = connections.find(c => c.id === connId);
        
        if (conn) {
          await updateProviderConnection(connId, {
            providerSpecificData: {
              ...(conn.providerSpecificData || {}),
              cloudUsage: usage
            }
          });
        }
      } catch (err) {
        console.error('[USAGE_POLL] Update failed for', connId, err);
      }
    }
  }

  /**
   * Check if poller is running
   */
  isRunning() {
    return this.intervalId !== null;
  }
}

let usagePoller = null;

export async function getCloudUsagePoller(machineId = null, intervalMs = 1000) {
  if (!usagePoller) {
    usagePoller = new CloudUsagePoller(machineId, intervalMs);
  }
  return usagePoller;
}
