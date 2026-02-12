export type ToolStatus =
  | "success"
  | "need_user_action"
  | "retryable_error"
  | "fatal_error";

export enum ToolCode {
  OK = "OK",
  VALIDATION_ERROR = "VALIDATION_ERROR",
  INTERNAL_ERROR = "INTERNAL_ERROR",
  UNKNOWN = "UNKNOWN",
  NOT_LOGGED_IN = "NOT_LOGGED_IN",
  CAPTCHA_REQUIRED = "CAPTCHA_REQUIRED",
  SMS_RATE_LIMIT = "SMS_RATE_LIMIT",
  SELECTOR_CHANGED = "SELECTOR_CHANGED",
  NAVIGATION_TIMEOUT = "NAVIGATION_TIMEOUT",
  PUBLISH_FAILED = "PUBLISH_FAILED",
  IMAGE_UPLOAD_FAILED = "IMAGE_UPLOAD_FAILED",
  UNSUPPORTED_IN_PHASE1 = "UNSUPPORTED_IN_PHASE1"
}

export function statusToDefaultCode(status: ToolStatus): ToolCode {
  switch (status) {
    case "success":
      return ToolCode.OK;
    case "need_user_action":
      return ToolCode.NOT_LOGGED_IN;
    case "retryable_error":
      return ToolCode.UNKNOWN;
    case "fatal_error":
      return ToolCode.UNKNOWN;
  }
}

export function codeToDefaultMessage(code: ToolCode): string {
  switch (code) {
    case ToolCode.OK:
      return "ok";
    case ToolCode.VALIDATION_ERROR:
      return "请求参数校验失败";
    case ToolCode.INTERNAL_ERROR:
      return "内部错误";
    case ToolCode.NOT_LOGGED_IN:
      return "当前未登录";
    case ToolCode.CAPTCHA_REQUIRED:
      return "需要完成人机验证";
    case ToolCode.SMS_RATE_LIMIT:
      return "短信发送过于频繁";
    case ToolCode.SELECTOR_CHANGED:
      return "页面结构或选择器已变化";
    case ToolCode.NAVIGATION_TIMEOUT:
      return "页面导航超时";
    case ToolCode.PUBLISH_FAILED:
      return "发布流程未确认成功";
    case ToolCode.IMAGE_UPLOAD_FAILED:
      return "图片上传失败";
    case ToolCode.UNSUPPORTED_IN_PHASE1:
      return "当前功能不在首期支持范围";
    case ToolCode.UNKNOWN:
      return "未知错误";
  }
}

export function isErrorStatus(status: ToolStatus): boolean {
  return status !== "success";
}
