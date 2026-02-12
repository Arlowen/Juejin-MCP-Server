import { z } from "zod";

import { AppError } from "../shared/errors.js";

const MAX_MESSAGE_LENGTH = 200;
const DEFAULT_ECHO_MESSAGE = "pong";

export const pingToolArgsSchema = {
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH).optional()
};

const pingToolInputSchema = z.object(pingToolArgsSchema).strict();

export type PingToolInput = z.infer<typeof pingToolInputSchema>;

export interface PingToolOutput {
  ok: true;
  echo: string;
  timestamp: string;
}

export function executePingTool(input: unknown): PingToolOutput {
  // 所有工具入参在业务执行前统一做 schema 校验，防止脏数据进入后续逻辑。
  const parsedResult = pingToolInputSchema.safeParse(input ?? {});
  if (!parsedResult.success) {
    throw AppError.validation("tool.ping 参数不合法", parsedResult.error.flatten());
  }

  const echoMessage = parsedResult.data.message ?? DEFAULT_ECHO_MESSAGE;
  return {
    ok: true,
    echo: echoMessage,
    timestamp: new Date().toISOString()
  };
}
