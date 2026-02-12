import { describe, expect, it } from "vitest";
import { z } from "zod";

import { TraceStore } from "../src/observability/TraceStore.js";
import { runTool } from "../src/shared/toolRunner.js";
import { ToolCode } from "../src/shared/errorCodes.js";
import type { ToolDefinition } from "../src/tools/types.js";

function createRuntimeStub(): any {
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
    profileFlow: {}
  };
}

function parsePayload(result: Awaited<ReturnType<typeof runTool>>): {
  ok: boolean;
  status: string;
  code: string;
  data: Record<string, unknown>;
  traceId: string;
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
    traceId: string;
  };
}

describe("runTool", () => {
  it("应返回统一 ToolResult 成功结构", async () => {
    const definition: ToolDefinition<any, { value: string }, { echoed: string }> = {
      name: "test_success",
      description: "test",
      schema: {
        value: z.string().min(1)
      },
      handler: async (input) => ({
        data: {
          echoed: input.value
        },
        message: "ok"
      })
    };

    const result = await runTool({
      definition,
      runtime: createRuntimeStub(),
      args: { value: "hello" }
    });

    expect(result.isError).toBeUndefined();
    const payload = parsePayload(result) as {
      ok: boolean;
      status: string;
      code: string;
      data: { echoed: string };
      traceId: string;
    };

    expect(payload.ok).toBe(true);
    expect(payload.status).toBe("success");
    expect(payload.code).toBe(ToolCode.OK);
    expect(payload.data.echoed).toBe("hello");
    expect(payload.traceId).toBeTruthy();
  });

  it("schema 校验失败时应返回 VALIDATION_ERROR", async () => {
    const definition: ToolDefinition<any, { value: string }, { echoed: string }> = {
      name: "test_validation",
      description: "test",
      schema: {
        value: z.string().min(1)
      },
      handler: async (input) => ({
        data: {
          echoed: input.value
        }
      })
    };

    const result = await runTool({
      definition,
      runtime: createRuntimeStub(),
      args: { value: 123 }
    });

    expect(result.isError).toBe(true);
    const payload = parsePayload(result);

    expect(payload.ok).toBe(false);
    expect(payload.status).toBe("fatal_error");
    expect(payload.code).toBe(ToolCode.VALIDATION_ERROR);
  });
});
