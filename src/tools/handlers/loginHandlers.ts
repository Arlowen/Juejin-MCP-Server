import { ToolCode } from "../../shared/errorCodes.js";
import { ToolError } from "../../shared/toolError.js";
import { registerQrCodeArtifact } from "../../observability/QrCodeRegistry.js";
import type { ToolDefinition } from "../types.js";

const emptySchema = {};

type LoginGetQrCodeInput = Record<string, never>;

function buildQrUrl(id: string): string {
  const host = process.env.MCP_HTTP_HOST?.trim() || "127.0.0.1";
  const rawPort = process.env.MCP_HTTP_PORT?.trim() || "3000";
  const port = Number.parseInt(rawPort, 10);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw ToolError.fatal(
      ToolCode.VALIDATION_ERROR,
      "MCP_HTTP_PORT 格式不合法，必须是 1-65535 的整数"
    );
  }

  return `http://${host}:${String(port)}/qr/${id}`;
}

export const loginGetQrCodeToolDefinition: ToolDefinition<
  typeof emptySchema,
  LoginGetQrCodeInput,
  {
    mimeType: "image/png";
    width: number;
    height: number;
    url: string;
    expiresAt: string;
  }
> = {
  name: "login_get_qr_code",
  description: "获取掘金扫码登录二维码访问地址。",
  schema: emptySchema,
  handler: async (_input, context) => {
    if (!context.runtime.sessionManager.isInitialized()) {
      throw ToolError.fatal(ToolCode.NOT_LOGGED_IN, "会话未初始化，请先调用 session_init");
    }

    const userDataDir = context.runtime.sessionManager.getUserDataDir();
    if (!userDataDir) {
      throw ToolError.fatal(ToolCode.NOT_LOGGED_IN, "会话未初始化，请先调用 session_init");
    }

    const qr = await context.runtime.loginFlow.getLoginQrCode(context.trace);
    const saved = await context.runtime.artifacts.saveScreenshotBuffer(
      qr.pngBuffer,
      userDataDir,
      context.traceId,
      "login-qr.png"
    );
    const registered = registerQrCodeArtifact(saved.path);
    const qrUrl = buildQrUrl(registered.id);

    context.trace.record("login.qr.saved", saved.path, `${qr.width}x${qr.height}`);

    return {
      data: {
        mimeType: qr.mimeType,
        width: qr.width,
        height: qr.height,
        url: qrUrl,
        expiresAt: registered.expiresAt
      },
      status: "need_user_action",
      code: ToolCode.NOT_LOGGED_IN,
      message: "请使用掘金 App 扫码登录"
    };
  }
};
