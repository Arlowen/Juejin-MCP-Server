import { z } from "zod";

import { ToolCode } from "../../shared/errorCodes.js";
import type { ToolDefinition } from "../types.js";

const sessionInitSchema = {
  headless: z.boolean().optional(),
  userDataDir: z.string().trim().min(1).optional(),
  proxy: z.string().trim().min(1).nullable().optional(),
  locale: z.string().trim().min(1).optional(),
  timeoutMs: z.number().int().positive().optional()
};

type SessionInitInput = z.infer<z.ZodObject<typeof sessionInitSchema>>;

const ensureLoginSchema = {
  preferred: z.enum(["qr", "auto"]).optional().default("auto")
};

type EnsureLoginInput = z.infer<z.ZodObject<typeof ensureLoginSchema>>;

const emptySchema = {};

type EmptyInput = z.infer<z.ZodObject<typeof emptySchema>>;

export const sessionInitToolDefinition: ToolDefinition<
  typeof sessionInitSchema,
  SessionInitInput,
  {
    sessionId: string;
    headless: boolean;
    userDataDir: string;
  }
> = {
  name: "session_init",
  description: "启动或复用浏览器会话，并加载 persistent 登录态。所有参数均可选，未传时使用环境变量默认值。",
  schema: sessionInitSchema,
  handler: async (input, context) => {
    const { config } = context.runtime;
    const mergedInput = {
      headless: input.headless ?? config.defaultHeadless,
      userDataDir: input.userDataDir ?? config.defaultUserDataDir,
      proxy: input.proxy ?? config.defaultProxy ?? null,
      locale: input.locale ?? config.defaultLocale,
      timeoutMs: input.timeoutMs ?? config.timeoutMs
    };

    const session = await context.runtime.sessionManager.init(mergedInput);
    context.trace.record("session.init", session.userDataDir, session.sessionId);

    return {
      data: {
        sessionId: session.sessionId,
        headless: session.headless,
        userDataDir: session.userDataDir
      },
      message: "session initialized"
    };
  }
};

export const sessionCloseToolDefinition: ToolDefinition<
  typeof emptySchema,
  EmptyInput,
  {
    closed: boolean;
  }
> = {
  name: "session_close",
  description: "关闭全局浏览器会话。",
  schema: emptySchema,
  handler: async (_input, context) => {
    await context.runtime.sessionManager.close();
    context.trace.record("session.close", "global", "session closed");
    return {
      data: {
        closed: true
      }
    };
  }
};

export const sessionStatusToolDefinition: ToolDefinition<
  typeof emptySchema,
  EmptyInput,
  {
    loggedIn: boolean;
    user: {
      nickname: string;
      uid: string;
      avatarUrl: string;
    } | null;
    expiresHint: string;
  }
> = {
  name: "session_status",
  description: "检查当前登录态和用户信息。",
  schema: emptySchema,
  handler: async (_input, context) => {
    const status = await context.runtime.loginFlow.getSessionStatus(context.trace);
    return {
      data: status
    };
  }
};

export const ensureLoginToolDefinition: ToolDefinition<
  typeof ensureLoginSchema,
  EnsureLoginInput,
  {
    loggedIn: boolean;
    user?: {
      nickname: string;
      uid: string;
      avatarUrl: string;
    };
    next?: {
      method: "qr";
      actionHints: string[];
    };
  }
> = {
  name: "ensure_login",
  description: "业务动作前检查登录状态，并返回下一步建议。",
  schema: ensureLoginSchema,
  handler: async (input, context) => {
    const result = await context.runtime.loginFlow.ensureLogin(input.preferred ?? "auto", context.trace);
    return {
      data: result,
      ...(result.loggedIn
        ? {}
        : {
          status: "need_user_action" as const,
          code: ToolCode.NOT_LOGGED_IN,
          message: "当前未登录，请先获取二维码并扫码登录"
        })
    };
  }
};
