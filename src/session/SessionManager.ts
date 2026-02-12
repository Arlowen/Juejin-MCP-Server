import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  chromium,
  type BrowserContext,
  type Page
} from "playwright";

import { ToolCode } from "../shared/errorCodes.js";
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

type PersistentLaunchOptions = NonNullable<
  Parameters<typeof chromium.launchPersistentContext>[1]
>;

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
