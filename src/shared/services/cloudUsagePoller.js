import { getConsistentMachineId } from "@/shared/utils/machineId";
import { getProviderConnections, updateProviderConnection } from "@/lib/localDb";
import { getCloudUrl } from "@/lib/cloudUrlResolver";

/**
 * Cloud usage poller
 * Polls worker usage endpoint every interval
 */
export class CloudUsagePoller {
  constructor(machineId = null, intervalMs = 1000) {
    this.machineId = machineId;
    this.intervalMs = intervalMs;
    this.intervalId = null;
    this.machineIdPromise = null;
  }

  /**
   * Initialize machine ID if not provided
   */
  async initializeMachineId() {
    if (!this.machineId) {
      this.machineIdPromise ??= getConsistentMachineId();
      this.machineId = await this.machineIdPromise;
    }

    return this.machineId;
  }

  /**
   * Start polling
   */
  async start() {
    if (this.intervalId) return;

    await this.initializeMachineId();

    this.poll().catch((error) => {
      console.error("[CloudUsagePoller] Poll failed:", error);
    });

    this.intervalId = setInterval(() => {
      this.poll().catch((error) => {
        console.error("[CloudUsagePoller] Poll failed:", error);
      });
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

    let cloudUrl = "";
    try {
      cloudUrl = await getCloudUrl();
    } catch (error) {
      console.error("[USAGE_POLL] Cloud URL unavailable:", error);
      return;
    }

    const response = await fetch(`${cloudUrl}/worker/usage/${this.machineId}`, {
      signal: AbortSignal.timeout(5000),
    });

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
          // WARNING: This merge/update sequence is not transactional and may overwrite concurrent providerSpecificData changes.
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
  if (!usagePoller || usagePoller.intervalMs !== intervalMs) {
    usagePoller = new CloudUsagePoller(machineId, intervalMs);
  }
  return usagePoller;
}
