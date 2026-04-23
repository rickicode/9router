import { getConsistentMachineId } from "@/shared/utils/machineId";
import { getAllConnections, getAllModelAliases, getAllCombos, getSettings, getApiKeys } from "./localDb.js";

/**
 * Get cloud URL from settings
 */
async function getCloudUrl() {
  const envUrl = process.env.NEXT_PUBLIC_CLOUD_URL;
  if (envUrl) return envUrl.replace(/\/$/, "");

  const settings = await getSettings();
  const firstUrl = settings.cloudUrls?.[0]?.url;
  return (firstUrl || "http://localhost:8787").replace(/\/$/, "");
}

/**
 * Format connection for cloud sync
 */
function formatConnection(conn) {
  return {
    id: conn.id,
    provider: conn.provider,
    accountId: conn.accountId || conn.email,
    accessToken: conn.accessToken,
    refreshToken: conn.refreshToken,
    expiresAt: conn.expiresAt,
    isActive: conn.isActive !== false,
  };
}

/**
 * Sync config to cloud worker
 */
export async function syncToCloud() {
  const machineId = await getConsistentMachineId();
  const cloudUrl = await getCloudUrl();

  const connections = await getAllConnections();
  const modelAliases = await getAllModelAliases();
  const combos = await getAllCombos();
  const apiKeys = await getApiKeys();
  const settings = await getSettings();

  const payload = {
    providers: connections.map(formatConnection),
    modelAliases,
    combos,
    apiKeys,
    settings: {
      roundRobin: settings.roundRobin || false,
      sticky: settings.sticky || false,
      stickyDuration: settings.stickyDuration || 300,
      comboStrategy: settings.comboStrategy || "fallback",
      comboStrategies: settings.comboStrategies || {},
      providerStrategies: settings.providerStrategies || {},
    },
  };

  const response = await fetch(`${cloudUrl}/sync/${machineId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Sync failed: ${response.statusText}`);
  }

  return await response.json();
}
