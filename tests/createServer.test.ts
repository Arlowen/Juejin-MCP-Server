import { describe, expect, it } from "vitest";

import { createServer } from "../src/server/createServer.js";

describe("createServer", () => {
  it("应成功创建 MCP Server 实例", () => {
    const server = createServer();
    expect(server).toBeDefined();
  });
});
