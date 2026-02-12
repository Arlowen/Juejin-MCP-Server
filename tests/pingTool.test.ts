import { describe, expect, it } from "vitest";

import { AppError, ErrorCode } from "../src/shared/errors.js";
import { executePingTool } from "../src/tools/pingTool.js";

describe("executePingTool", () => {
  it("应返回成功结果", () => {
    const result = executePingTool({ message: "hello" });

    expect(result.ok).toBe(true);
    expect(result.echo).toBe("hello");
    expect(new Date(result.timestamp).toString()).not.toBe("Invalid Date");
  });

  it("未传 message 时应返回默认值", () => {
    const result = executePingTool({});
    expect(result.echo).toBe("pong");
  });

  it("message 为非法类型时应抛出 VALIDATION_ERROR", () => {
    try {
      executePingTool({ message: 123 });
      throw new Error("预期应抛出参数校验错误，但未抛出");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AppError);
      if (!(error instanceof AppError)) {
        return;
      }
      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
    }
  });
});
