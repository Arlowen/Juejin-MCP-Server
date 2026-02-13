import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  chromium,
  type BrowserContext,
  type Page
} from "playwright";

import { ToolCode } from "../shared/errorCodes.js";
import { appLogger } from "../shared/logger.js";
import { ToolError } from "../shared/toolError.js";

export interface SessionInitInput {
  headless?: boolean;
  userDataDir: string;
  proxy?: string | null;
  locale?: string;
  timeoutMs?: number;
}

export interface SessionInfo {
  sessionId: string;
  headless: boolean;
  userDataDir: string;
  locale: string;
  timeoutMs: number;
  proxy?: string;
}

export interface SessionStatusSnapshot {
  initialized: boolean;
  session?: SessionInfo;
}

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_LOCALE = "zh-CN";
const SESSION_ID = "global";
const COOKIE_FILE_NAME = "session-cookies.json";
const COOKIE_FILE_VERSION = 1;

type PersistentLaunchOptions = NonNullable<
  Parameters<typeof chromium.launchPersistentContext>[1]
>;
type BrowserCookie = Awaited<ReturnType<BrowserContext["cookies"]>>[number];

interface PersistedCookieFile {
  version: number;
  savedAt: string;
  cookies: BrowserCookie[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function hasCookieLocation(value: Record<string, unknown>): boolean {
  const url = value["url"];
  if (typeof url === "string" && url.length > 0) {
    return true;
  }

  const domain = value["domain"];
  const path = value["path"];
  return (
    typeof domain === "string" &&
    domain.length > 0 &&
    typeof path === "string" &&
    path.length > 0
  );
}

function isCookieCandidate(value: unknown): value is BrowserCookie {
  if (!isRecord(value)) {
    return false;
  }

  const name = value["name"];
  const cookieValue = value["value"];

  return (
    typeof name === "string" &&
    name.length > 0 &&
    typeof cookieValue === "string" &&
    hasCookieLocation(value)
  );
}

function readCookieArrayFromPayload(payload: unknown): BrowserCookie[] | undefined {
  const maybeCookieArray = (() => {
    if (isUnknownArray(payload)) {
      return payload;
    }
    if (isRecord(payload) && isUnknownArray(payload["cookies"])) {
      return payload["cookies"];
    }
    return undefined;
  })();

  if (!maybeCookieArray) {
    return undefined;
  }

  if (!maybeCookieArray.every((item): item is BrowserCookie => isCookieCandidate(item))) {
    return undefined;
  }

  return maybeCookieArray;
}

function isErrnoCode(error: unknown, code: string): boolean {
  if (!isRecord(error)) {
    return false;
  }

  return error["code"] === code;
}

function parseProxy(proxy: string): PersistentLaunchOptions["proxy"] {
  try {
    const proxyUrl = new URL(proxy);
    const server = `${proxyUrl.protocol}//${proxyUrl.host}`;

    if (proxyUrl.username || proxyUrl.password) {
      return {
        server,
        username: decodeURIComponent(proxyUrl.username),
        password: decodeURIComponent(proxyUrl.password)
      };
    }

    return { server };
  } catch {
    throw ToolError.fatal(ToolCode.VALIDATION_ERROR, "proxy 格式不合法");
  }
}

export class SessionManager {
  private context?: BrowserContext;
  private page?: Page;
  private session?: SessionInfo;

  public getSessionId(): string {
    return SESSION_ID;
  }

  public isInitialized(): boolean {
    return this.context !== undefined && this.session !== undefined;
  }

  public getSessionInfo(): SessionInfo | undefined {
    return this.session;
  }

  public getUserDataDir(): string | undefined {
    return this.session?.userDataDir;
  }

  public getTraceDir(): string | undefined {
    const userDataDir = this.getUserDataDir();
    if (!userDataDir) {
      return undefined;
    }
    return join(userDataDir, "traces");
  }

  public getIdempotencyDir(): string | undefined {
    const userDataDir = this.getUserDataDir();
    if (!userDataDir) {
      return undefined;
    }
    return join(userDataDir, "idempotency");
  }

  public getTmpDir(): string | undefined {
    const userDataDir = this.getUserDataDir();
    if (!userDataDir) {
      return undefined;
    }
    return join(userDataDir, "tmp");
  }

  public getCookieFilePath(): string | undefined {
    const userDataDir = this.getUserDataDir();
    if (!userDataDir) {
      return undefined;
    }
    return join(userDataDir, COOKIE_FILE_NAME);
  }

  public snapshotStatus(): SessionStatusSnapshot {
    if (!this.session || !this.context) {
      return { initialized: false };
    }

    return {
      initialized: true,
      session: { ...this.session }
    };
  }

  private isSameSession(input: Required<Pick<SessionInfo, "headless" | "locale" | "timeoutMs">> & {
    userDataDir: string;
    proxy?: string;
  }): boolean {
    if (!this.session) {
      return false;
    }

    return (
      this.session.userDataDir === input.userDataDir &&
      this.session.headless === input.headless &&
      this.session.locale === input.locale &&
      this.session.timeoutMs === input.timeoutMs &&
      this.session.proxy === input.proxy
    );
  }

  public async restoreCookiesFromFileIfExists(): Promise<void> {
    if (!this.context || !this.session) {
      return;
    }

    const cookieFilePath = this.getCookieFilePath();
    if (!cookieFilePath) {
      return;
    }

    let rawContent: string;
    try {
      rawContent = await readFile(cookieFilePath, "utf8");
    } catch (error: unknown) {
      if (isErrnoCode(error, "ENOENT")) {
        return;
      }

      appLogger.warn(
        {
          err: error,
          cookieFilePath
        },
        "读取 cookie 文件失败，将继续使用未登录态"
      );
      return;
    }

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(rawContent) as unknown;
    } catch (error: unknown) {
      appLogger.warn(
        {
          err: error,
          cookieFilePath
        },
        "cookie 文件 JSON 格式损坏，将继续使用未登录态"
      );
      return;
    }

    const cookies = readCookieArrayFromPayload(parsedPayload);
    if (!cookies) {
      appLogger.warn(
        {
          cookieFilePath
        },
        "cookie 文件结构不合法，将继续使用未登录态"
      );
      return;
    }

    if (cookies.length === 0) {
      return;
    }

    await this.context.addCookies(cookies);
    appLogger.info(
      {
        cookieFilePath,
        cookieCount: cookies.length
      },
      "已从本地 cookie 文件恢复会话"
    );
  }

  public async persistCookies(): Promise<{
    path: string;
    cookieCount: number;
  }> {
    if (!this.context || !this.session) {
      throw ToolError.fatal(
        ToolCode.NOT_LOGGED_IN,
        "会话未初始化，请先调用 session_init"
      );
    }

    const cookieFilePath = this.getCookieFilePath();
    if (!cookieFilePath) {
      throw ToolError.fatal(
        ToolCode.INTERNAL_ERROR,
        "未找到 cookie 文件路径，请先完成 session_init"
      );
    }

    const cookies = await this.context.cookies();
    const payload: PersistedCookieFile = {
      version: COOKIE_FILE_VERSION,
      savedAt: new Date().toISOString(),
      cookies
    };

    await writeFile(cookieFilePath, JSON.stringify(payload, null, 2), "utf8");
    appLogger.info(
      {
        cookieFilePath,
        cookieCount: cookies.length
      },
      "登录 cookie 已写入本地 JSON 文件"
    );

    return {
      path: cookieFilePath,
      cookieCount: cookies.length
    };
  }

  public async init(input: SessionInitInput): Promise<SessionInfo> {
    const normalizedInput = {
      headless: input.headless ?? false,
      userDataDir: input.userDataDir,
      locale: input.locale ?? DEFAULT_LOCALE,
      timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      proxy: input.proxy?.trim() || undefined
    };

    await mkdir(normalizedInput.userDataDir, { recursive: true });

    if (this.context && this.isSameSession(normalizedInput)) {
      return this.session as SessionInfo;
    }

    await this.close();

    const launchOptions: PersistentLaunchOptions = {
      headless: normalizedInput.headless,
      locale: normalizedInput.locale
    };

    if (normalizedInput.proxy) {
      launchOptions.proxy = parseProxy(normalizedInput.proxy);
    }

    this.context = await chromium.launchPersistentContext(
      normalizedInput.userDataDir,
      launchOptions
    );

    this.context.setDefaultTimeout(normalizedInput.timeoutMs);
    this.context.setDefaultNavigationTimeout(normalizedInput.timeoutMs);

    const existingPages = this.context.pages();
    this.page = existingPages[0] ?? (await this.context.newPage());

    this.session = {
      sessionId: SESSION_ID,
      headless: normalizedInput.headless,
      userDataDir: normalizedInput.userDataDir,
      locale: normalizedInput.locale,
      timeoutMs: normalizedInput.timeoutMs,
      proxy: normalizedInput.proxy
    };

    await mkdir(this.getTraceDir() as string, { recursive: true });
    await mkdir(this.getIdempotencyDir() as string, { recursive: true });
    await mkdir(this.getTmpDir() as string, { recursive: true });
    await this.restoreCookiesFromFileIfExists();

    return { ...this.session };
  }

  public async getPage(): Promise<Page> {
    if (!this.context || !this.session) {
      throw ToolError.fatal(
        ToolCode.NOT_LOGGED_IN,
        "会话未初始化，请先调用 session_init"
      );
    }

    if (this.page && !this.page.isClosed()) {
      return this.page;
    }

    const pages = this.context.pages();
    this.page = pages[0] ?? (await this.context.newPage());
    return this.page;
  }

  public async close(): Promise<void> {
    if (this.page && !this.page.isClosed()) {
      await this.page.close({ runBeforeUnload: false }).catch(() => undefined);
    }

    this.page = undefined;

    if (this.context) {
      await this.context.close().catch(() => undefined);
      this.context = undefined;
    }

    this.session = undefined;
  }
}
