import { ZodError } from "zod";

export enum ErrorCode {
  VALIDATION_ERROR = "VALIDATION_ERROR",
  INTERNAL_ERROR = "INTERNAL_ERROR"
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  public constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }

  public static validation(message: string, details?: unknown): AppError {
    return new AppError(ErrorCode.VALIDATION_ERROR, message, details);
  }

  public static internal(message = "服务器内部错误", details?: unknown): AppError {
    return new AppError(ErrorCode.INTERNAL_ERROR, message, details);
  }
}

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  // 统一把 Zod 校验异常转换为业务可识别错误码。
  if (error instanceof ZodError) {
    return AppError.validation("请求参数校验失败", error.flatten());
  }

  if (error instanceof Error) {
    return AppError.internal();
  }

  return AppError.internal();
}

export function toErrorPayload(error: AppError): ErrorPayload {
  return {
    code: error.code,
    message: error.message,
    details: error.details
  };
}
