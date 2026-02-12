import type { ZodRawShape } from "zod";

import type { ToolCode, ToolStatus } from "../shared/errorCodes.js";
import type { TraceRecorder } from "../observability/TraceStore.js";
import type { ToolRuntime } from "../runtime/toolRuntime.js";

export interface ToolHandlerContext {
  traceId: string;
  trace: TraceRecorder;
  runtime: ToolRuntime;
}

export interface ToolHandlerOutput<TData = Record<string, never>> {
  status?: ToolStatus;
  code?: ToolCode;
  message?: string;
  data?: TData;
}

export interface ToolDefinition<TSchema extends ZodRawShape, TInput, TData> {
  name: string;
  description: string;
  schema: TSchema;
  handler: (
    input: TInput,
    context: ToolHandlerContext
  ) => Promise<ToolHandlerOutput<TData>> | ToolHandlerOutput<TData>;
}

export type AnyToolDefinition = ToolDefinition<ZodRawShape, unknown, unknown>;
