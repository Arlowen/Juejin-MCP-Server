import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { toAppError, toErrorPayload } from "../shared/errors.js";
import { appLogger } from "../shared/logger.js";
import { executePingTool, pingToolArgsSchema } from "../tools/pingTool.js";

const SERVER_NAME = "juejin-mcp-server";
const SERVER_VERSION = "0.1.0";

export function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION
  });

  server.tool(
    "tool.ping",
    "健康检查工具：返回回显信息和服务端时间戳。",
    pingToolArgsSchema,
    (args) => {
      try {
        const result = executePingTool(args);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result)
            }
          ]
        };
      } catch (error: unknown) {
        // 在 tool 层做统一兜底，确保客户端拿到稳定错误结构而不是原始异常堆栈。
        const appError = toAppError(error);
        appLogger.warn(
          {
            err: error,
            code: appError.code,
            details: appError.details
          },
          "tool.ping 调用失败"
        );

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(toErrorPayload(appError))
            }
          ]
        };
      }
    }
  );

  return server;
}
