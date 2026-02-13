import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape, ZodTypeAny } from "zod";

import { createToolRuntime, type ToolRuntime } from "../runtime/toolRuntime.js";
import { runTool } from "../shared/toolRunner.js";
import {
  articleGetToolDefinition,
  articleListMineToolDefinition,
  draftCreateToolDefinition,
  draftPublishToolDefinition,
  imageUploadToolDefinition,
  profileGetSelfToolDefinition
} from "./handlers/contentHandlers.js";
import {
  loginGetQrCodeToolDefinition
} from "./handlers/loginHandlers.js";
import {
  ensureLoginToolDefinition,
  sessionCloseToolDefinition,
  sessionInitToolDefinition,
  sessionStatusToolDefinition
} from "./handlers/sessionHandlers.js";
import type { ToolDefinition } from "./types.js";

function registerTool<TSchema extends ZodRawShape, TInput, TData>(
  server: McpServer,
  runtime: ToolRuntime,
  definition: ToolDefinition<TSchema, TInput, TData>
): void {
  server.tool(
    definition.name,
    definition.description,
    definition.schema as Record<string, ZodTypeAny>,
    async (args) => {
      return runTool({
        definition,
        runtime,
        args
      });
    }
  );
}

export function registerTools(server: McpServer): void {
  const runtime = createToolRuntime();

  registerTool(server, runtime, sessionInitToolDefinition);
  registerTool(server, runtime, sessionCloseToolDefinition);
  registerTool(server, runtime, sessionStatusToolDefinition);
  registerTool(server, runtime, ensureLoginToolDefinition);

  registerTool(server, runtime, loginGetQrCodeToolDefinition);

  registerTool(server, runtime, imageUploadToolDefinition);
  registerTool(server, runtime, draftCreateToolDefinition);
  registerTool(server, runtime, draftPublishToolDefinition);
  registerTool(server, runtime, articleGetToolDefinition);
  registerTool(server, runtime, articleListMineToolDefinition);

  registerTool(server, runtime, profileGetSelfToolDefinition);
}
