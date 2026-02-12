import { z } from "zod";

import type { ToolDefinition } from "../types.js";

const loginSendSmsCodeSchema = {
  phone: z.string().trim().min(1)
};

type LoginSendSmsInput = z.infer<z.ZodObject<typeof loginSendSmsCodeSchema>>;

const loginVerifySmsCodeSchema = {
  phone: z.string().trim().min(1),
  code: z.string().trim().min(1)
};

type LoginVerifySmsInput = z.infer<z.ZodObject<typeof loginVerifySmsCodeSchema>>;

export const loginSendSmsCodeToolDefinition: ToolDefinition<
  typeof loginSendSmsCodeSchema,
  LoginSendSmsInput,
  {
    sent: boolean;
    cooldownSeconds: number;
  }
> = {
  name: "login_send_sms_code",
  description: "发送短信验证码。",
  schema: loginSendSmsCodeSchema,
  handler: async (input, context) => {
    const result = await context.runtime.loginFlow.sendSmsCode(input.phone, context.trace);
    return {
      data: result
    };
  }
};

export const loginVerifySmsCodeToolDefinition: ToolDefinition<
  typeof loginVerifySmsCodeSchema,
  LoginVerifySmsInput,
  {
    loggedIn: boolean;
    user: {
      nickname: string;
      uid: string;
    };
  }
> = {
  name: "login_verify_sms_code",
  description: "提交短信验证码完成登录。",
  schema: loginVerifySmsCodeSchema,
  handler: async (input, context) => {
    const result = await context.runtime.loginFlow.verifySmsCode(
      input.phone,
      input.code,
      context.trace
    );

    return {
      data: result
    };
  }
};
