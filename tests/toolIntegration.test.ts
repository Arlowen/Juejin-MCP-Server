import { afterEach, describe, expect, it } from "vitest";

import { TraceStore } from "../src/observability/TraceStore.js";
import { ToolCode } from "../src/shared/errorCodes.js";
import { ToolError } from "../src/shared/toolError.js";
import { runTool } from "../src/shared/toolRunner.js";
import { articleGetToolDefinition, draftPublishToolDefinition } from "../src/tools/handlers/contentHandlers.js";
import { loginGetQrCodeToolDefinition } from "../src/tools/handlers/loginHandlers.js";

function createRuntime(overrides: Partial<Record<string, unknown>> = {}): any {
  return {
    config: {
      baseUrl: "https://juejin.cn",
      timeoutMs: 45_000,
      retryCount: 2
    },
    sessionManager: {
      getTraceDir: () => undefined,
      isInitialized: () => false,
      getUserDataDir: () => undefined
    },
    traceStore: new TraceStore(),
    artifacts: {},
    loginFlow: {},
    imageFlow: {},
    draftFlow: {},
    articleFlow: {},
    profileFlow: {},
    ...overrides
  };
}

function parsePayload(result: Awaited<ReturnType<typeof runTool>>): {
  ok: boolean;
  status: string;
  code: string;
  data: Record<string, unknown>;
} {
  const text = result.content[0]?.text;
  if (!text) {
    throw new Error("missing tool payload");
  }
  return JSON.parse(text) as {
    ok: boolean;
    status: string;
    code: string;
    data: Record<string, unknown>;
  };
}

afterEach(() => {
  delete process.env.MCP_HTTP_HOST;
  delete process.env.MCP_HTTP_PORT;
});

describe("tool integration with mocked flows", () => {
  it("login_get_qr_code 返回二维码并标记 need_user_action", async () => {
    process.env.MCP_HTTP_HOST = "127.0.0.1";
    process.env.MCP_HTTP_PORT = "3000";
    const runtime = createRuntime({
      sessionManager: {
        ...createRuntime().sessionManager,
        isInitialized: () => true,
        getUserDataDir: () => "/tmp/juejin-data"
      },
      loginFlow: {
        getLoginQrCode: async () => ({
          pngBuffer: Buffer.from("qr"),
          mimeType: "image/png",
          width: 256,
          height: 256
        })
      },
      artifacts: {
        saveScreenshotBuffer: async () => ({
          path: "/tmp/juejin-data/artifacts/trace/login-qr.png"
        })
      }
    });

    const result = await runTool({
      definition: loginGetQrCodeToolDefinition,
      runtime,
      args: {}
    });

    const payload = parsePayload(result);
    expect(payload.ok).toBe(false);
    expect(payload.status).toBe("need_user_action");
    expect(payload.code).toBe(ToolCode.NOT_LOGGED_IN);
    expect(String(payload.data.url)).toContain("http://127.0.0.1:3000/qr/");
  });

  it("login_get_qr_code 会透传验证码拦截错误", async () => {
    process.env.MCP_HTTP_HOST = "127.0.0.1";
    process.env.MCP_HTTP_PORT = "3000";
    const runtime = createRuntime({
      sessionManager: {
        ...createRuntime().sessionManager,
        isInitialized: () => true,
        getUserDataDir: () => "/tmp/juejin-data"
      },
      loginFlow: {
        getLoginQrCode: async () => {
          throw ToolError.needUserAction(ToolCode.CAPTCHA_REQUIRED, "captcha required");
        }
      }
    });

    const result = await runTool({
      definition: loginGetQrCodeToolDefinition,
      runtime,
      args: {}
    });

    const payload = parsePayload(result);
    expect(payload.ok).toBe(false);
    expect(payload.status).toBe("need_user_action");
    expect(payload.code).toBe(ToolCode.CAPTCHA_REQUIRED);
  });

  it("login_get_qr_code MCP_HTTP_PORT 非法时返回配置错误", async () => {
    process.env.MCP_HTTP_HOST = "127.0.0.1";
    process.env.MCP_HTTP_PORT = "bad-port";
    const runtime = createRuntime({
      sessionManager: {
        ...createRuntime().sessionManager,
        isInitialized: () => true,
        getUserDataDir: () => "/tmp/juejin-data"
      },
      loginFlow: {
        getLoginQrCode: async () => ({
          pngBuffer: Buffer.from("qr"),
          mimeType: "image/png",
          width: 256,
          height: 256
        })
      },
      artifacts: {
        saveScreenshotBuffer: async () => ({
          path: "/tmp/juejin-data/artifacts/trace/login-qr.png"
        })
      }
    });

    const result = await runTool({
      definition: loginGetQrCodeToolDefinition,
      runtime,
      args: {}
    });

    const payload = parsePayload(result);
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe(ToolCode.VALIDATION_ERROR);
  });

  it("draft_publish 成功路径", async () => {
    const runtime = createRuntime({
      draftFlow: {
        publishDraft: async () => ({
          articleId: "10086",
          articleUrl: "https://juejin.cn/post/10086"
        })
      }
    });

    const result = await runTool({
      definition: draftPublishToolDefinition,
      runtime,
      args: {
        draftId: "d-1"
      }
    });

    const payload = parsePayload(result);
    expect(payload.ok).toBe(true);
    expect(payload.data.articleId).toBe("10086");
  });

  it("draft_publish 不确定后可通过 article_get 校验", async () => {
    const runtime = createRuntime({
      draftFlow: {
        publishDraft: async () => {
          throw ToolError.retryable(ToolCode.PUBLISH_FAILED, "uncertain publish");
        }
      },
      articleFlow: {
        getArticle: async () => ({
          articleId: "10010",
          title: "t",
          url: "https://juejin.cn/post/10010",
          publishedAt: "2026-02-12T00:00:00.000Z"
        })
      }
    });

    const publishResult = await runTool({
      definition: draftPublishToolDefinition,
      runtime,
      args: {
        draftId: "d-2"
      }
    });

    const publishPayload = parsePayload(publishResult);
    expect(publishPayload.ok).toBe(false);
    expect(publishPayload.status).toBe("retryable_error");
    expect(publishPayload.code).toBe(ToolCode.PUBLISH_FAILED);

    const articleResult = await runTool({
      definition: articleGetToolDefinition,
      runtime,
      args: {
        articleId: "10010"
      }
    });

    const articlePayload = parsePayload(articleResult);
    expect(articlePayload.ok).toBe(true);
    expect(articlePayload.data.articleId).toBe("10010");
  });
});
