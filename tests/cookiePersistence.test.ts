import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserContext } from "playwright";

import { SessionManager, type SessionInfo } from "../src/session/SessionManager.js";

type BrowserCookie = Awaited<ReturnType<BrowserContext["cookies"]>>[number];

const createdDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    })
  );
});

function createSessionInfo(userDataDir: string): SessionInfo {
  return {
    sessionId: "global",
    headless: true,
    userDataDir,
    locale: "zh-CN",
    timeoutMs: 45_000
  };
}

function createCookieSample(): BrowserCookie[] {
  return [
    {
      name: "sid_tt",
      value: "cookie-value",
      domain: ".juejin.cn",
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: true,
      sameSite: "Lax"
    }
  ];
}

describe("SessionManager cookie persistence", () => {
  it("persistCookies 应写入 session-cookies.json", async () => {
    const userDataDir = await createTempDir("juejin-cookie-save-");
    const sessionManager = new SessionManager();
    const cookieSample = createCookieSample();

    Reflect.set(sessionManager, "session", createSessionInfo(userDataDir));
    Reflect.set(sessionManager, "context", {
      cookies: async () => cookieSample,
      addCookies: async () => undefined
    });

    const persisted = await sessionManager.persistCookies();
    const raw = await readFile(persisted.path, "utf8");
    const payload = JSON.parse(raw) as {
      version: number;
      savedAt: string;
      cookies: BrowserCookie[];
    };

    expect(persisted.cookieCount).toBe(1);
    expect(payload.version).toBe(1);
    expect(payload.savedAt.length).toBeGreaterThan(0);
    expect(payload.cookies).toEqual(cookieSample);
  });

  it("restoreCookiesFromFileIfExists 应自动加载已保存 cookie", async () => {
    const userDataDir = await createTempDir("juejin-cookie-load-");
    const cookieFilePath = join(userDataDir, "session-cookies.json");
    const cookieSample = createCookieSample();

    await writeFile(
      cookieFilePath,
      JSON.stringify(
        {
          version: 1,
          savedAt: new Date().toISOString(),
          cookies: cookieSample
        },
        null,
        2
      ),
      "utf8"
    );

    const addCookiesMock = vi.fn(async (cookies: BrowserCookie[]) => {
      void cookies;
    });
    const sessionManager = new SessionManager();
    Reflect.set(sessionManager, "session", createSessionInfo(userDataDir));
    Reflect.set(sessionManager, "context", {
      cookies: async () => cookieSample,
      addCookies: addCookiesMock
    });

    await sessionManager.restoreCookiesFromFileIfExists();

    expect(addCookiesMock).toHaveBeenCalledTimes(1);
    expect(addCookiesMock).toHaveBeenCalledWith(cookieSample);
  });

  it("cookie 文件损坏时应忽略并继续运行", async () => {
    const userDataDir = await createTempDir("juejin-cookie-corrupt-");
    const cookieFilePath = join(userDataDir, "session-cookies.json");
    await writeFile(cookieFilePath, "{bad json", "utf8");

    const addCookiesMock = vi.fn(async (cookies: BrowserCookie[]) => {
      void cookies;
    });
    const sessionManager = new SessionManager();
    Reflect.set(sessionManager, "session", createSessionInfo(userDataDir));
    Reflect.set(sessionManager, "context", {
      cookies: async () => createCookieSample(),
      addCookies: addCookiesMock
    });

    await expect(sessionManager.restoreCookiesFromFileIfExists()).resolves.toBeUndefined();
    expect(addCookiesMock).not.toHaveBeenCalled();
  });
});
