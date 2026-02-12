import { toAppError } from "./shared/errors.js";
import { appLogger } from "./shared/logger.js";
import { startHttpServer } from "./server/startHttpServer.js";

async function bootstrap(): Promise<void> {
  await startHttpServer();
}

void bootstrap().catch((error: unknown) => {
  const appError = toAppError(error);
  appLogger.error(
    {
      err: error,
      code: appError.code,
      details: appError.details
    },
    "Juejin MCP Server 启动失败"
  );
  process.exitCode = 1;
});
