import type { Env } from "../env";

export interface RemoteConfig {
  freeStockLimit: number;
  freeDailyChatLimit: number;
  proDailyChatLimit: number;
  adsEnabled: boolean;
  chatEnabled: boolean;
  maintenanceMode: boolean;
  extractorVersion: string;
  promptVersion: string;
}

export const DEFAULT_REMOTE_CONFIG: RemoteConfig = {
  freeStockLimit: 3,
  freeDailyChatLimit: 3,
  proDailyChatLimit: 50,
  adsEnabled: true,
  chatEnabled: true,
  maintenanceMode: false,
  extractorVersion: "v1",
  promptVersion: "v1"
};

export async function loadRemoteConfig(env: Env): Promise<RemoteConfig> {
  const raw = await env.KABUYOMI_CACHE.get("remote_config", "json");
  if (!raw || typeof raw !== "object") {
    return DEFAULT_REMOTE_CONFIG;
  }

  return {
    ...DEFAULT_REMOTE_CONFIG,
    ...(raw as Partial<RemoteConfig>)
  };
}

