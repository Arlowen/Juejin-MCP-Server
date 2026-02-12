import { describe, expect, it } from "vitest";

import { TraceStore } from "../src/observability/TraceStore.js";
import { ToolCode } from "../src/shared/errorCodes.js";
import { ToolError } from "../src/shared/toolError.js";
import { runTool } from "../src/shared/toolRunner.js";
import { articleGetToolDefinition, draftPublishToolDefinition } from "../src/tools/handlers/contentHandlers.js";
import { loginSendSmsCodeToolDefinition } from "../src/tools/handlers/loginHandlers.js";

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

describe("tool integration with mocked flows", () => {
  it("login_send_sms_code 成功路径", async () => {
    const runtime = createRuntime({
      loginFlow: {
        sendSmsCode: async () => ({
          sent: true,
          cooldownSeconds: 60
        })
      }
    });

    const result = await runTool({
      definition: loginSendSmsCodeToolDefinition,
      runtime,
      args: { phone: "13800000000" }
    });

    const payload = parsePayload(result);
    expect(payload.ok).toBe(true);
    expect(payload.code).toBe(ToolCode.OK);
  });

  it("login_send_sms_code 验证码拦截路径", async () => {
    const runtime = createRuntime({
      loginFlow: {
        sendSmsCode: async () => {
          throw ToolError.needUserAction(ToolCode.CAPTCHA_REQUIRED, "captcha required");
        }
      }
    });

    const result = await runTool({
      definition: loginSendSmsCodeToolDefinition,
      runtime,
      args: { phone: "13800000000" }
    });

    const payload = parsePayload(result);
    expect(payload.ok).toBe(false);
    expect(payload.status).toBe("need_user_action");
    expect(payload.code).toBe(ToolCode.CAPTCHA_REQUIRED);
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
