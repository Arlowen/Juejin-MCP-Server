const DEFAULT_BASE_URL = "https://juejin.cn";
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_USER_DATA_DIR = "./juejin-data";
const DEFAULT_LOCALE = "zh-CN";

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

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  const lower = value.trim().toLowerCase();
  if (lower === "true" || lower === "1" || lower === "yes") {
    return true;
  }
  if (lower === "false" || lower === "0" || lower === "no") {
    return false;
  }
  return fallback;
}

export interface AppConfig {
  baseUrl: string;
  timeoutMs: number;
  retryCount: number;
  defaultUserDataDir: string;
  defaultHeadless: boolean;
  defaultProxy: string | undefined;
  defaultLocale: string;
}

export function loadAppConfig(): AppConfig {
  return {
    baseUrl: process.env.JUEJIN_BASE_URL?.trim() || DEFAULT_BASE_URL,
    timeoutMs: parseNumberEnv(process.env.JUEJIN_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    retryCount: parseNumberEnv(process.env.JUEJIN_RETRY_COUNT, DEFAULT_RETRY_COUNT),
    defaultUserDataDir: process.env.JUEJIN_USER_DATA_DIR?.trim() || DEFAULT_USER_DATA_DIR,
    defaultHeadless: parseBooleanEnv(process.env.JUEJIN_HEADLESS, false),
    defaultProxy: process.env.JUEJIN_PROXY?.trim() || undefined,
    defaultLocale: process.env.JUEJIN_LOCALE?.trim() || DEFAULT_LOCALE
  };
}
