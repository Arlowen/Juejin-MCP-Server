import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { ZodError, z } from "zod";

import type { TraceRecorder } from "../observability/TraceStore.js";
import type { ToolRuntime } from "../runtime/toolRuntime.js";
import { appLogger } from "./logger.js";
import { ToolCode } from "./errorCodes.js";
import { createToolResult, type ToolResult } from "./result.js";
import { ToolError } from "./toolError.js";
import type { ToolDefinition, ToolHandlerOutput } from "../tools/types.js";

interface FailureArtifacts {
  screenshotPath?: string;
  htmlPath?: string;
}

function normalizeOutput<TData>(
  traceId: string,
  output: ToolHandlerOutput<TData>
): ToolResult<TData> {
  const status = output.status ?? "success";
  return createToolResult({
    traceId,
    status,
    code: output.code,
    message: output.message,
    data: output.data
  });
}

async function captureFailureArtifacts(
  runtime: ToolRuntime,
  traceId: string,
  trace: TraceRecorder
): Promise<FailureArtifacts> {
  if (!runtime.sessionManager.isInitialized()) {
    return {};
  }

  const userDataDir = runtime.sessionManager.getUserDataDir();
  if (!userDataDir) {
    return {};
  }

  const page = await runtime.sessionManager.getPage().catch(() => undefined);
  if (!page) {
    return {};
  }

  const screenshot = await runtime.artifacts
    .captureScreenshot(page, userDataDir, traceId, true)
    .catch(() => undefined);

  const htmlDump = await runtime.artifacts
    .captureCurrentPageDump(page, userDataDir, traceId, 200_000)
    .catch(() => undefined);

  if (screenshot?.path) {
    trace.record("artifact.screenshot", screenshot.path, "captured on error");
  }
  if (htmlDump?.path) {
    trace.record("artifact.html", htmlDump.path, "captured on error");
  }

  return {
    screenshotPath: screenshot?.path,
    htmlPath: htmlDump?.path
  };
}

async function toFailureResult(
  traceId: string,
  runtime: ToolRuntime,
  trace: TraceRecorder,
  error: unknown
): Promise<ToolResult<Record<string, unknown>>> {
  if (error instanceof ToolError) {
    const shouldCaptureArtifacts =
      error.code === ToolCode.SELECTOR_CHANGED || error.code === ToolCode.NAVIGATION_TIMEOUT;

    const artifacts = shouldCaptureArtifacts
      ? await captureFailureArtifacts(runtime, traceId, trace)
      : {};

    return createToolResult({
      traceId,
      status: error.status,
      code: error.code,
      message: error.message,
      data: {
        ...(typeof error.data === "object" && error.data ? (error.data as Record<string, unknown>) : {}),
        ...artifacts
      }
    });
  }

  if (error instanceof ZodError) {
    return createToolResult({
      traceId,
      status: "fatal_error",
      code: ToolCode.VALIDATION_ERROR,
      message: "请求参数校验失败",
      data: {
        details: error.flatten()
      }
    });
  }

  return createToolResult({
    traceId,
    status: "fatal_error",
    code: ToolCode.UNKNOWN,
    message: error instanceof Error ? error.message : "未知错误",
    data: {
      cause: error instanceof Error ? error.stack : String(error)
    }
  });
}

interface RunToolOptions<TSchema extends z.ZodRawShape, TInput, TData> {
  definition: ToolDefinition<TSchema, TInput, TData>;
  runtime: ToolRuntime;
  args: unknown;
}

export async function runTool<TSchema extends z.ZodRawShape, TInput, TData>(
  options: RunToolOptions<TSchema, TInput, TData>
): Promise<{
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
}> {
  const traceId = randomUUID();
  const tracesRoot = options.runtime.sessionManager.getTraceDir();
  const trace = options.runtime.traceStore.createTrace(traceId, options.definition.name, tracesRoot);

  let result: ToolResult<TData | Record<string, unknown>>;

  try {
    const schema = z.object(options.definition.schema).strict();
    const parsedInput = schema.parse((options.args ?? {}) as unknown) as TInput;

    if (
      options.definition.name === "session_init" &&
      parsedInput &&
      typeof parsedInput === "object" &&
      "userDataDir" in parsedInput
    ) {
      const userDataDir = Reflect.get(parsedInput, "userDataDir");
      if (typeof userDataDir === "string" && userDataDir.trim()) {
        trace.setTracesRoot(join(userDataDir, "traces"));
      }
    }

    const output = await options.definition.handler(parsedInput, {
      traceId,
      trace,
      runtime: options.runtime
    });

    result = normalizeOutput(traceId, output);
  } catch (error: unknown) {
    result = await toFailureResult(traceId, options.runtime, trace, error);
    const logPayload = {
      err: error,
      traceId,
      toolName: options.definition.name,
      code: result.code,
      status: result.status
    };

    if (result.status === "fatal_error") {
      appLogger.error(logPayload, "tool execution failed");
    } else {
      appLogger.warn(logPayload, "tool execution non-success state");
    }
  }

  trace.record("tool.end", options.definition.name, `${result.status}:${result.code}`);
  const saved = await trace.complete({
    status: result.status,
    code: result.code,
    message: result.message
  });
  options.runtime.traceStore.save(saved);

  return {
    ...(result.ok ? {} : { isError: true }),
    content: [
      {
        type: "text",
        text: JSON.stringify(result)
      }
    ]
  };
}
