import { describe, expect, it } from "vitest";

import { LoginFlow } from "../src/flows/LoginFlow.js";
import { TraceStore } from "../src/observability/TraceStore.js";
import { ToolCode } from "../src/shared/errorCodes.js";
import { debugGetTraceToolDefinition } from "../src/tools/handlers/sessionHandlers.js";

describe("LoginFlow ensureLogin", () => {
  it("preferred=qr 时应降级为 sms 指引", async () => {
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
    expect(result.next?.method).toBe("sms");
    expect(result.next?.actionHints.join(" ")).toContain("login_send_sms_code");
  });
});

describe("debug_get_trace", () => {
  it("无 trace 时返回空 steps", async () => {
    const traceStore = new TraceStore();

    const output = await debugGetTraceToolDefinition.handler(
      {},
      {
        traceId: "ctx-trace",
        trace: { record: () => undefined } as any,
        runtime: {
          traceStore
        } as any
      }
    );

    expect(output.data?.steps).toEqual([]);
  });

  it("有 trace 时返回最近 trace steps", async () => {
    const traceStore = new TraceStore();

    const recorder = traceStore.createTrace("latest-trace", "some_tool");
    recorder.record("goto", "https://juejin.cn", "navigated");
    const completed = await recorder.complete({
      status: "success",
      code: ToolCode.OK,
      message: "ok"
    });
    traceStore.save(completed);

    const output = await debugGetTraceToolDefinition.handler(
      {},
      {
        traceId: "ctx-trace-2",
        trace: { record: () => undefined } as any,
        runtime: {
          traceStore
        } as any
      }
    );

    expect(output.data?.steps.length).toBeGreaterThan(0);
    expect(output.data?.steps.some((step) => step.action === "goto")).toBe(true);
  });
});
