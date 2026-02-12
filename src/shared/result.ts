import {
  ToolCode,
  type ToolStatus,
  codeToDefaultMessage,
  isErrorStatus,
  statusToDefaultCode
} from "./errorCodes.js";

export interface ToolResult<TData = Record<string, never>> {
  ok: boolean;
  traceId: string;
  status: ToolStatus;
  code: ToolCode;
  message: string;
  data: TData;
}

interface ResultOptions<TData> {
  traceId: string;
  status: ToolStatus;
  code?: ToolCode;
  message?: string;
  data?: TData;
}

export function createToolResult<TData = Record<string, never>>(
  options: ResultOptions<TData>
): ToolResult<TData> {
  const code = options.code ?? statusToDefaultCode(options.status);
  return {
    ok: !isErrorStatus(options.status),
    traceId: options.traceId,
    status: options.status,
    code,
    message: options.message ?? codeToDefaultMessage(code),
    data: (options.data ?? ({} as TData))
  };
}

export function createSuccessResult<TData = Record<string, never>>(
  traceId: string,
  data?: TData,
  message?: string
): ToolResult<TData> {
  return createToolResult({
    traceId,
    status: "success",
    code: ToolCode.OK,
    message,
    data
  });
}
