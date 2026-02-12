import { randomUUID } from "node:crypto";
import {
  createServer as createHttpServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { toAppError } from "../shared/errors.js";
import { appLogger } from "../shared/logger.js";
import { createServer } from "./createServer.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;
const DEFAULT_MCP_PATH = "/mcp";
const HEALTH_PATH = "/health";
const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

interface HttpServerConfig {
  host: string;
  port: number;
  mcpPath: string;
}

interface SessionContext {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

function loadHttpServerConfig(): HttpServerConfig {
  const host = process.env.MCP_HTTP_HOST?.trim() || DEFAULT_HOST;
  const rawPort = process.env.MCP_HTTP_PORT?.trim() || String(DEFAULT_PORT);
  const mcpPath = process.env.MCP_HTTP_PATH?.trim() || DEFAULT_MCP_PATH;
  const port = Number.parseInt(rawPort, 10);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`MCP_HTTP_PORT 非法：${rawPort}`);
  }

  if (!mcpPath.startsWith("/")) {
    throw new Error(`MCP_HTTP_PATH 必须以 / 开头，当前值：${mcpPath}`);
  }

  return {
    host,
    port,
    mcpPath
  };
}

function getHeaderValueAsString(
  headers: IncomingHttpHeaders,
  headerName: string
): string | undefined {
  const headerValue = headers[headerName];
  if (typeof headerValue === "string") {
    return headerValue.trim() || undefined;
  }
  if (Array.isArray(headerValue)) {
    const first = headerValue[0];
    return first?.trim() || undefined;
  }
  return undefined;
}

function writeJsonResponse(res: ServerResponse, statusCode: number, payload: unknown): void {
  if (res.headersSent || res.writableEnded) {
    return;
  }

  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function writePlainTextResponse(res: ServerResponse, statusCode: number, message: string): void {
  if (res.headersSent || res.writableEnded) {
    return;
  }

  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(message);
}

function writeJsonRpcError(
  res: ServerResponse,
  statusCode: number,
  code: number,
  message: string
): void {
  writeJsonResponse(res, statusCode, {
    jsonrpc: "2.0",
    error: {
      code,
      message
    },
    id: null
  });
}

function buildRequestUrl(req: IncomingMessage): URL | undefined {
  if (!req.url) {
    return undefined;
  }

  const host = getHeaderValueAsString(req.headers, "host") || `${DEFAULT_HOST}:${DEFAULT_PORT}`;
  try {
    return new URL(req.url, `http://${host}`);
  } catch {
    return undefined;
  }
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    let totalBytes = 0;

    req.on("data", (chunk: unknown) => {
      const normalizedChunk =
        typeof chunk === "string"
          ? chunk
          : Buffer.isBuffer(chunk)
            ? chunk.toString("utf8")
            : undefined;

      if (normalizedChunk === undefined) {
        reject(new Error("请求体 chunk 类型不支持"));
        return;
      }

      totalBytes += Buffer.byteLength(normalizedChunk);
      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        reject(new Error(`请求体超过限制：${MAX_REQUEST_BODY_BYTES} bytes`));
        return;
      }

      chunks.push(normalizedChunk);
    });

    req.on("end", () => {
      resolve(chunks.join(""));
    });

    req.on("error", (error: Error) => {
      reject(error);
    });
  });
}

async function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  const rawBody = await readRequestBody(req);
  if (!rawBody.trim()) {
    return {};
  }
  return JSON.parse(rawBody) as unknown;
}

async function closeConnectedServer(sessionId: string, mcpServer: McpServer): Promise<void> {
  try {
    await mcpServer.close();
  } catch (error: unknown) {
    const appError = toAppError(error);
    appLogger.warn(
      {
        err: error,
        sessionId,
        code: appError.code,
        details: appError.details
      },
      "关闭 MCP 会话 server 失败"
    );
  }
}

async function closeSession(sessionId: string, session: SessionContext): Promise<void> {
  session.transport.onclose = undefined;

  try {
    await session.transport.close();
  } catch (error: unknown) {
    const appError = toAppError(error);
    appLogger.warn(
      {
        err: error,
        sessionId,
        code: appError.code,
        details: appError.details
      },
      "关闭 MCP 会话 transport 失败"
    );
  }

  await closeConnectedServer(sessionId, session.server);
}

function waitForServerListening(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };

    server.once("listening", onListening);
    server.once("error", onError);
  });
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export async function startHttpServer(): Promise<void> {
  const config = loadHttpServerConfig();
  const sessions = new Map<string, SessionContext>();

  const handleMcpPost = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let requestBody: unknown;
    try {
      requestBody = await parseJsonBody(req);
    } catch (error: unknown) {
      const appError = toAppError(error);
      appLogger.warn(
        {
          err: error,
          code: appError.code,
          details: appError.details
        },
        "解析 MCP POST 请求体失败"
      );
      writeJsonRpcError(res, 400, -32700, "Parse error: Invalid JSON body");
      return;
    }

    const sessionId = getHeaderValueAsString(req.headers, "mcp-session-id");
    try {
      if (sessionId) {
        const existingSession = sessions.get(sessionId);
        if (!existingSession) {
          writeJsonRpcError(res, 404, -32001, "Session Not Found");
          return;
        }

        await existingSession.transport.handleRequest(req, res, requestBody);
        return;
      }

      if (!isInitializeRequest(requestBody)) {
        writeJsonRpcError(res, 400, -32000, "Bad Request: No valid session ID provided");
        return;
      }

      const mcpServer = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (initializedSessionId) => {
          sessions.set(initializedSessionId, {
            server: mcpServer,
            transport
          });
          appLogger.info({ sessionId: initializedSessionId }, "MCP 会话初始化完成");
        }
      });

      transport.onclose = () => {
        const activeSessionId = transport.sessionId;
        if (!activeSessionId) {
          return;
        }

        const activeSession = sessions.get(activeSessionId);
        if (!activeSession) {
          return;
        }

        sessions.delete(activeSessionId);
        void closeConnectedServer(activeSessionId, activeSession.server);
      };

      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, requestBody);
    } catch (error: unknown) {
      const appError = toAppError(error);
      appLogger.error(
        {
          err: error,
          sessionId,
          code: appError.code,
          details: appError.details
        },
        "处理 MCP POST 请求失败"
      );
      writeJsonRpcError(res, 500, -32603, "Internal server error");
    }
  };

  const handleMcpGetOrDelete = async (
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> => {
    const sessionId = getHeaderValueAsString(req.headers, "mcp-session-id");
    if (!sessionId) {
      writePlainTextResponse(res, 400, "Invalid or missing session ID");
      return;
    }

    const existingSession = sessions.get(sessionId);
    if (!existingSession) {
      writePlainTextResponse(res, 404, "Session Not Found");
      return;
    }

    try {
      await existingSession.transport.handleRequest(req, res);
    } catch (error: unknown) {
      const appError = toAppError(error);
      appLogger.error(
        {
          err: error,
          method: req.method ?? "UNKNOWN",
          sessionId,
          code: appError.code,
          details: appError.details
        },
        "处理 MCP 会话请求失败"
      );
      writePlainTextResponse(res, 500, "Internal server error");
    }
  };

  const httpServer = createHttpServer((req, res) => {
    void (async () => {
      const requestUrl = buildRequestUrl(req);
      if (!requestUrl) {
        writePlainTextResponse(res, 400, "Bad Request: Invalid URL");
        return;
      }

      const path = requestUrl.pathname;
      const method = req.method ?? "GET";

      if (method === "GET" && path === HEALTH_PATH) {
        writeJsonResponse(res, 200, {
          ok: true,
          service: "juejin-mcp-server",
          transport: "streamable-http",
          mcpPath: config.mcpPath,
          timestamp: new Date().toISOString()
        });
        return;
      }

      if (path !== config.mcpPath) {
        writePlainTextResponse(res, 404, "Not Found");
        return;
      }

      if (method === "POST") {
        await handleMcpPost(req, res);
        return;
      }

      if (method === "GET" || method === "DELETE") {
        await handleMcpGetOrDelete(req, res);
        return;
      }

      writePlainTextResponse(res, 405, "Method Not Allowed");
    })().catch((error: unknown) => {
      const appError = toAppError(error);
      appLogger.error(
        {
          err: error,
          code: appError.code,
          details: appError.details
        },
        "处理 HTTP 请求时发生未捕获异常"
      );
      writePlainTextResponse(res, 500, "Internal server error");
    });
  });

  httpServer.listen(config.port, config.host);
  await waitForServerListening(httpServer);

  appLogger.info(
    {
      host: config.host,
      port: config.port,
      mcpPath: config.mcpPath,
      healthPath: HEALTH_PATH
    },
    "Juejin MCP Server 已通过 Streamable HTTP 启动"
  );

  let isShuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;

    appLogger.info({ signal }, "收到退出信号，开始关闭 MCP HTTP 服务");
    for (const [sessionId, session] of sessions.entries()) {
      sessions.delete(sessionId);
      await closeSession(sessionId, session);
    }

    try {
      await closeHttpServer(httpServer);
      appLogger.info("MCP HTTP 服务已关闭");
    } catch (error: unknown) {
      const appError = toAppError(error);
      appLogger.error(
        {
          err: error,
          code: appError.code,
          details: appError.details
        },
        "关闭 MCP HTTP 服务失败"
      );
      process.exitCode = 1;
    }
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}
