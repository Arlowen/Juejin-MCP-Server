import { type ToolCode, type ToolStatus, codeToDefaultMessage } from "./errorCodes.js";

export class ToolError extends Error {
  public readonly status: ToolStatus;
  public readonly code: ToolCode;
  public readonly data?: unknown;

  public constructor(status: ToolStatus, code: ToolCode, message?: string, data?: unknown) {
    super(message ?? codeToDefaultMessage(code));
    this.name = "ToolError";
    this.status = status;
    this.code = code;
    this.data = data;
  }

  public static needUserAction(code: ToolCode, message?: string, data?: unknown): ToolError {
    return new ToolError("need_user_action", code, message, data);
  }

  public static retryable(code: ToolCode, message?: string, data?: unknown): ToolError {
    return new ToolError("retryable_error", code, message, data);
  }

  public static fatal(code: ToolCode, message?: string, data?: unknown): ToolError {
    return new ToolError("fatal_error", code, message, data);
  }
}
