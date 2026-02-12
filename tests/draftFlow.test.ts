import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { DraftFlow } from "../src/flows/DraftFlow.js";
import { TraceStore } from "../src/observability/TraceStore.js";

class FakeLocator {
  public constructor(
    private readonly page: FakePage,
    private readonly kind: "title" | "content" | "save" | "generic"
  ) { }

  public first(): FakeLocator {
    return this;
  }

  public async waitFor(): Promise<void> {
    return;
  }

  public async fill(value: string): Promise<void> {
    if (this.kind === "title") {
      this.page.title = value;
      return;
    }
    if (this.kind === "content") {
      this.page.content = value;
    }
  }

  public async click(): Promise<void> {
    if (this.kind === "save") {
      this.page.currentUrl = "https://juejin.cn/editor/drafts/123456";
    }
  }

  public async isVisible(): Promise<boolean> {
    return true;
  }

  public async inputValue(): Promise<string> {
    return this.page.content;
  }

  public async getAttribute(): Promise<string | null> {
    return null;
  }

  public async innerText(): Promise<string> {
    return "";
  }
}

class FakePage {
  public currentUrl = "https://juejin.cn/editor/drafts/new";
  public gotoCount = 0;
  public title = "";
  public content = "";

  public readonly keyboard = {
    insertText: async (): Promise<void> => undefined
  };

  public async goto(url: string): Promise<void> {
    this.currentUrl = url;
    this.gotoCount += 1;
  }

  public getByPlaceholder(value: string | RegExp): FakeLocator {
    const text = String(value);
    if (text.includes("标题")) {
      return new FakeLocator(this, "title");
    }
    return new FakeLocator(this, "content");
  }

  public getByLabel(value: string | RegExp): FakeLocator {
    const text = String(value);
    if (text.includes("标题")) {
      return new FakeLocator(this, "title");
    }
    return new FakeLocator(this, "content");
  }

  public getByRole(_role: string, options?: { name?: string | RegExp }): FakeLocator {
    const name = options?.name;
    if (String(name).includes("保存")) {
      return new FakeLocator(this, "save");
    }
    if (String(name).includes("标题")) {
      return new FakeLocator(this, "title");
    }
    return new FakeLocator(this, "content");
  }

  public getByText(value: string | RegExp): FakeLocator {
    if (String(value).includes("保存")) {
      return new FakeLocator(this, "save");
    }
    return new FakeLocator(this, "generic");
  }

  public locator(value: string): FakeLocator {
    if (value.includes("textarea")) {
      return new FakeLocator(this, "content");
    }
    if (value.includes("保存") || value.includes("button")) {
      return new FakeLocator(this, "save");
    }
    return new FakeLocator(this, "generic");
  }

  public async waitForTimeout(): Promise<void> {
    return;
  }

  public url(): string {
    return this.currentUrl;
  }
}

function createTrace() {
  const traceStore = new TraceStore();
  return traceStore.createTrace("trace-test", "draft_create");
}

describe("DraftFlow idempotency", () => {
  it("miss 时创建并写入索引，hit 时复用 draftId", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "juejin-draft-flow-"));
    const idempotencyDir = join(baseDir, "idempotency");
    await mkdir(idempotencyDir, { recursive: true });

    const page = new FakePage();

    const sessionManagerStub = {
      getIdempotencyDir: () => idempotencyDir,
      getPage: async () => page
    };

    const loginFlowStub = {
      requireLoggedIn: async () => ({
        nickname: "tester",
        uid: "100",
        avatarUrl: ""
      })
    };

    const flow = new DraftFlow(
      sessionManagerStub as any,
      loginFlowStub as any,
      {
        baseUrl: "https://juejin.cn",
        timeoutMs: 5_000,
        retryCount: 1,
        defaultUserDataDir: "./juejin-data",
        defaultHeadless: false,
        defaultProxy: undefined,
        defaultLocale: "zh-CN"
      }
    );

    const first = await flow.createDraft(
      {
        title: "A",
        content: "B",
        format: "markdown"
      },
      createTrace()
    );

    expect(first.reused).toBe(false);
    expect(first.draftId).toBe("123456");
    expect(page.gotoCount).toBe(1);

    const second = await flow.createDraft(
      {
        title: "A",
        content: "B",
        format: "markdown"
      },
      createTrace()
    );

    expect(second.reused).toBe(true);
    expect(second.draftId).toBe("123456");
    expect(page.gotoCount).toBe(1);

    const indexRaw = await readFile(join(idempotencyDir, "drafts.json"), "utf8");
    const index = JSON.parse(indexRaw) as Record<string, { draftId: string }>;
    const values = Object.values(index);

    expect(values.length).toBe(1);
    expect(values[0]?.draftId).toBe("123456");
  });
});
