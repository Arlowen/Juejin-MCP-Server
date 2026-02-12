import { z } from "zod";

import { executePingTool } from "../../tools/pingTool.js";
import type { ToolDefinition } from "../types.js";

const MAX_MESSAGE_LENGTH = 200;

interface PingInput {
  message?: string;
}

interface PingOutput {
  ok: true;
  echo: string;
  timestamp: string;
}

export const pingToolDefinition: ToolDefinition<
  {
    message: z.ZodOptional<z.ZodString>;
  },
  PingInput,
  PingOutput
> = {
  name: "tool.ping",
  description: "健康检查工具：返回回显信息和服务端时间戳。",
  schema: {
    message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH).optional()
  },
  handler: (input) => {
    const data = executePingTool(input);
    return {
      data,
      message: "ping success"
    };
  }
};
