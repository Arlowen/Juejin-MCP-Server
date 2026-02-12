const DEFAULT_BASE_URL = "https://juejin.cn";
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_RETRY_COUNT = 2;

function parseNumberEnv(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export interface AppConfig {
  baseUrl: string;
  timeoutMs: number;
  retryCount: number;
}

export function loadAppConfig(): AppConfig {
  return {
    baseUrl: process.env.JUEJIN_BASE_URL?.trim() || DEFAULT_BASE_URL,
    timeoutMs: parseNumberEnv(process.env.JUEJIN_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    retryCount: parseNumberEnv(process.env.JUEJIN_RETRY_COUNT, DEFAULT_RETRY_COUNT)
  };
}
