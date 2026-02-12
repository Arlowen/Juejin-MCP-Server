# Juejin MCP Server

一个基于 TypeScript 的 MCP Server 骨架项目，使用 `Streamable HTTP` 传输（兼容 SSE 流式响应），内置 `tool.ping` 工具用于连通性与健康检查。

## 技术栈

- Node.js `>=20`
- TypeScript
- MCP SDK
- Zod
- Pino
- ESLint + Prettier + Vitest

## 快速开始

```bash
npm install
npm run dev
```

服务默认地址：

- MCP Endpoint：`http://127.0.0.1:3000/mcp`
- Health Check：`http://127.0.0.1:3000/health`

## 脚本

```bash
npm run dev        # 本地开发运行（tsx）
npm run build      # 打包输出到 dist（tsup）
npm run start      # 运行打包产物
npm run lint       # 代码检查
npm run format     # 格式化
npm run typecheck  # TypeScript 类型检查
npm test           # 单元测试
```

## 环境变量

- `MCP_HTTP_HOST`：监听地址，默认 `127.0.0.1`
- `MCP_HTTP_PORT`：监听端口，默认 `3000`
- `MCP_HTTP_PATH`：MCP 路径，默认 `/mcp`

## 传输说明

- `POST /mcp`：发送 MCP JSON-RPC 请求（初始化与普通请求）
- `GET /mcp`：SSE 流式通道（需要 `mcp-session-id` 请求头）
- `DELETE /mcp`：关闭会话（需要 `mcp-session-id` 请求头）

## 客户端接入示例

在支持 Streamable HTTP 的 MCP 客户端里，将服务地址配置为：

- `http://127.0.0.1:3000/mcp`

## MCP Tool

### `tool.ping`

- 入参：`{ "message"?: string }`
- 出参：`{ "ok": true, "echo": string, "timestamp": string }`

示例返回：

```json
{
  "ok": true,
  "echo": "pong",
  "timestamp": "2026-02-12T08:00:00.000Z"
}
```
