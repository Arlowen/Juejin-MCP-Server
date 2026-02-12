# Juejin MCP Server

基于 TypeScript + Playwright 的掘金 MCP Server，提供状态机化登录、两阶段发布、会话持久化和可观测调试能力。

## 技术栈

- Node.js `>=20`
- TypeScript
- MCP SDK (`Streamable HTTP`)
- Playwright
- Zod
- Pino
- ESLint + Prettier + Vitest

## 快速开始

```bash
npm install
npm run dev
```

默认地址：

- MCP Endpoint：`http://127.0.0.1:3000/mcp`
- Health Check：`http://127.0.0.1:3000/health`

## 脚本

```bash
npm run dev        # 本地开发运行（tsx）
npm run build      # 打包到 dist
npm run start      # 运行打包产物
npm run lint       # ESLint
npm run format     # Prettier
npm run typecheck  # TS 类型检查
npm test           # Vitest
```

## 环境变量

### HTTP 服务

- `MCP_HTTP_HOST`：监听地址，默认 `127.0.0.1`
- `MCP_HTTP_PORT`：监听端口，默认 `3000`
- `MCP_HTTP_PATH`：MCP 路径，默认 `/mcp`

### 掘金自动化

- `JUEJIN_BASE_URL`：默认 `https://juejin.cn`
- `JUEJIN_TIMEOUT_MS`：默认 `45000`
- `JUEJIN_RETRY_COUNT`：默认 `2`

## 统一返回结构

所有工具均返回统一 `ToolResult`（JSON 字符串在 MCP `content.text`）：

```json
{
  "ok": true,
  "traceId": "string",
  "status": "success | need_user_action | retryable_error | fatal_error",
  "code": "OK | NOT_LOGGED_IN | CAPTCHA_REQUIRED | SMS_RATE_LIMIT | SELECTOR_CHANGED | NAVIGATION_TIMEOUT | PUBLISH_FAILED | IMAGE_UPLOAD_FAILED | VALIDATION_ERROR | INTERNAL_ERROR | UNKNOWN",
  "message": "human readable message",
  "data": {}
}
```

说明：

- `ok=false` 时 MCP 响应会设置 `isError=true`
- 所有工具都产出 `traceId`
- 关键异常会自动采集截图与 HTML dump（会话已初始化时）

## 工具清单（首期）

### 会话与调试

- `session_init`
- `session_close`
- `session_status`
- `ensure_login`
- `debug_screenshot`
- `debug_get_trace`
- `debug_dump_html`

### 登录

- `login_send_sms_code`
- `login_verify_sms_code`

### 内容

- `image_upload`
- `draft_create`
- `draft_publish`
- `article_get`
- `article_list_mine`

### 个人信息

- `profile_get_self`

### 兼容工具

- `tool.ping`

## 典型调用链路

### 登录链路

1. `session_init`
2. `ensure_login`
3. `login_send_sms_code`
4. `login_verify_sms_code`
5. `session_status`

### 发布链路（两阶段）

1. `session_init`
2. `ensure_login`
3. `draft_create`
4. `draft_publish`
5. `article_get`（发布不确定时用于校验）

### 图片上传

1. `session_init`
2. `ensure_login`
3. `image_upload`

## 状态机约定

- `success`：完成
- `need_user_action`：需要人工介入（验证码/滑块/频率限制）
- `retryable_error`：可重试错误（网络抖动、发布未确认等）
- `fatal_error`：不可恢复错误（严重选择器变更、参数不合法等）

## 会话与产物目录

`session_init.userDataDir` 下自动创建：

- `traces/`：每次调用的 trace JSON
- `artifacts/<traceId>/`：截图和 HTML dump
- `idempotency/drafts.json`：`draft_create` 幂等索引
- `tmp/`：临时文件（如图片上传素材）

## 传输说明

- `POST /mcp`：发送 MCP JSON-RPC 请求（初始化与普通请求）
- `GET /mcp`：SSE 流式通道（需 `mcp-session-id`）
- `DELETE /mcp`：关闭会话（需 `mcp-session-id`）

## 说明

- 本期仅支持 `draft_create.format=markdown`
- `ensure_login.preferred=qr/auto` 统一降级短信流程
- `draft_publish.scheduleTime` 已支持（ISO8601）
