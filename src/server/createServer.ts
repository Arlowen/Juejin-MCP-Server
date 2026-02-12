import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerTools } from "../tools/registerTools.js";

const SERVER_NAME = "juejin-mcp-server";
const SERVER_VERSION = "0.1.0";

export function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION
  });

  registerTools(server);

  return server;
}
