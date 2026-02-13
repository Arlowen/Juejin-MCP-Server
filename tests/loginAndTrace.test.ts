import { describe, expect, it } from "vitest";

import { LoginFlow } from "../src/flows/LoginFlow.js";
import { TraceStore } from "../src/observability/TraceStore.js";

describe("LoginFlow ensureLogin", () => {
  it("preferred=qr 时应返回二维码登录指引", async () => {
    const loginFlow = new LoginFlow(
      {
        isInitialized: () => false
      } as any,
      {
        baseUrl: "https://juejin.cn",
        timeoutMs: 45_000,
        retryCount: 2,
        defaultUserDataDir: "./juejin-data",
        defaultHeadless: false,
        defaultProxy: undefined,
        defaultLocale: "zh-CN"
      }
    );

    const traceStore = new TraceStore();
    const trace = traceStore.createTrace("ensure-login-trace", "ensure_login");

    const result = await loginFlow.ensureLogin("qr", trace);

    expect(result.loggedIn).toBe(false);
    expect(result.next?.method).toBe("qr");
    expect(result.next?.actionHints.join(" ")).toContain("login_get_qr_code");
  });
});
