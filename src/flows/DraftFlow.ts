import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Page } from "playwright";

import type { AppConfig } from "../shared/config.js";
import { ToolCode } from "../shared/errorCodes.js";
import { ToolError } from "../shared/toolError.js";
import type { SessionManager } from "../session/SessionManager.js";
import type { TraceRecorder } from "../observability/TraceStore.js";
import {
  clickWithFallback,
  fillWithFallback,
  gotoWithRetry,
  type SelectorCandidate
} from "./browserUtils.js";
import type { LoginFlow } from "./LoginFlow.js";

export interface DraftCreateInput {
  title: string;
  content: string;
  format?: "markdown" | "richtext";
  tags?: string[];
  category?: string | null;
  coverUrl?: string | null;
  assets?: Array<Record<string, unknown>>;
  visibility?: "public" | "private";
}

export interface DraftCreateOutput {
  draftId: string;
  editorUrl: string;
  reused: boolean;
}

export interface DraftPublishInput {
  draftId: string;
  confirm?: boolean;
  scheduleTime?: string | null;
}

export interface DraftPublishOutput {
  articleId: string;
  articleUrl: string;
}

interface IdempotencyRecord {
  draftId: string;
  editorUrl: string;
  createdAt: string;
}

type IdempotencyIndex = Record<string, IdempotencyRecord>;

const TITLE_SELECTORS: SelectorCandidate[] = [
  { type: "placeholder", placeholder: /请输入标题|标题/ },
  { type: "css", css: "input[placeholder*='标题'], textarea[placeholder*='标题']" },
  { type: "role", role: "textbox", name: /标题/ }
];

const CONTENT_SELECTORS: SelectorCandidate[] = [
  { type: "css", css: "textarea" },
  { type: "css", css: "[contenteditable='true']" },
  { type: "role", role: "textbox", name: /正文|内容/ }
];

const SAVE_DRAFT_SELECTORS: SelectorCandidate[] = [
  { type: "role", role: "button", name: /保存草稿|保存/ },
  { type: "text", text: /保存草稿|保存/ },
  { type: "css", css: "button:has-text('保存')" }
];

const OPEN_PUBLISH_SELECTORS: SelectorCandidate[] = [
  { type: "role", role: "button", name: /发布/ },
  { type: "text", text: /^发布$/ },
  { type: "css", css: "button:has-text('发布')" }
];

const CONFIRM_PUBLISH_SELECTORS: SelectorCandidate[] = [
  { type: "role", role: "button", name: /确认发布|立即发布|发布文章/ },
  { type: "text", text: /确认发布|立即发布|发布文章/ },
  { type: "css", css: "button:has-text('确认'), button:has-text('发布')" }
];

const OPEN_SCHEDULE_SELECTORS: SelectorCandidate[] = [
  { type: "role", role: "button", name: /定时发布/ },
  { type: "text", text: /定时发布/ },
  { type: "css", css: "label:has-text('定时'), button:has-text('定时')" }
];

const SCHEDULE_TIME_INPUT_SELECTORS: SelectorCandidate[] = [
  { type: "css", css: "input[type='datetime-local']" },
  { type: "placeholder", placeholder: /选择时间|发布时间/ },
  { type: "label", label: /发布时间|定时/ }
];

export class DraftFlow {
  public constructor(
    private readonly sessionManager: SessionManager,
    private readonly loginFlow: LoginFlow,
    private readonly config: AppConfig
  ) {}

  public async createDraft(input: DraftCreateInput, trace: TraceRecorder): Promise<DraftCreateOutput> {
    if (input.format && input.format !== "markdown") {
      throw ToolError.fatal(
        ToolCode.VALIDATION_ERROR,
        "首期仅支持 markdown，richtext 暂不支持"
      );
    }

    await this.loginFlow.requireLoggedIn(trace);

    const hash = this.computeDraftHash(input.title, input.content);
    const existing = await this.loadIdempotencyRecord(hash);
    if (existing) {
      trace.record("draft.idempotency", hash, "reuse existing draft");
      return {
        draftId: existing.draftId,
        editorUrl: existing.editorUrl,
        reused: true
      };
    }

    const page = await this.sessionManager.getPage();
    await gotoWithRetry(
      page,
      `${this.config.baseUrl}/editor/drafts/new`,
      trace,
      this.config.retryCount,
      this.config.timeoutMs
    );

    await fillWithFallback(page, trace, TITLE_SELECTORS, input.title, this.config.timeoutMs);
    await this.fillEditorContent(page, input.content, trace);

    try {
      await clickWithFallback(page, trace, SAVE_DRAFT_SELECTORS, 2_000);
    } catch {
      // 掘金编辑器通常自动保存，按钮不存在时保持容错。
      trace.record("draft.save", "auto-save", "save button not found, relying on auto-save");
    }

    await page.waitForTimeout(1500);

    const editorUrl = page.url();
    const draftId = this.extractDraftId(editorUrl) ?? `draft_${hash.slice(0, 16)}`;

    await this.saveIdempotencyRecord(hash, {
      draftId,
      editorUrl,
      createdAt: new Date().toISOString()
    });

    return {
      draftId,
      editorUrl,
      reused: false
    };
  }

  public async publishDraft(
    input: DraftPublishInput,
    trace: TraceRecorder
  ): Promise<DraftPublishOutput> {
    await this.loginFlow.requireLoggedIn(trace);

    const page = await this.sessionManager.getPage();
    const editorUrlFromIndex = await this.findEditorUrlByDraftId(input.draftId);
    const targetEditorUrl = editorUrlFromIndex ?? `${this.config.baseUrl}/editor/drafts/${input.draftId}`;

    await gotoWithRetry(
      page,
      targetEditorUrl,
      trace,
      this.config.retryCount,
      this.config.timeoutMs
    );

    await clickWithFallback(page, trace, OPEN_PUBLISH_SELECTORS, this.config.timeoutMs);

    if (input.scheduleTime) {
      await this.applyScheduleTime(page, input.scheduleTime, trace);
    }

    if (input.confirm ?? true) {
      await clickWithFallback(page, trace, CONFIRM_PUBLISH_SELECTORS, this.config.timeoutMs);
    }

    await page.waitForTimeout(2500);

    const currentUrl = page.url();
    const articleId = this.extractArticleId(currentUrl);

    if (!articleId) {
      throw ToolError.retryable(
        ToolCode.PUBLISH_FAILED,
        "发布结果未确认，请调用 article_get 校验是否已发布"
      );
    }

    return {
      articleId,
      articleUrl: currentUrl
    };
  }

  private computeDraftHash(title: string, content: string): string {
    return createHash("sha256").update(`${title}\n${content}`).digest("hex");
  }

  private getIdempotencyFilePath(): string {
    const idempotencyDir = this.sessionManager.getIdempotencyDir();
    if (!idempotencyDir) {
      throw ToolError.fatal(ToolCode.NOT_LOGGED_IN, "会话未初始化，请先调用 session_init");
    }
    return join(idempotencyDir, "drafts.json");
  }

  private async readIdempotencyIndex(): Promise<IdempotencyIndex> {
    const filePath = this.getIdempotencyFilePath();
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== "object" || parsed === null) {
        return {};
      }
      return parsed as IdempotencyIndex;
    } catch {
      return {};
    }
  }

  private async writeIdempotencyIndex(index: IdempotencyIndex): Promise<void> {
    const filePath = this.getIdempotencyFilePath();
    await writeFile(filePath, JSON.stringify(index, null, 2), "utf8");
  }

  private async loadIdempotencyRecord(hash: string): Promise<IdempotencyRecord | undefined> {
    const index = await this.readIdempotencyIndex();
    return index[hash];
  }

  private async saveIdempotencyRecord(hash: string, record: IdempotencyRecord): Promise<void> {
    const index = await this.readIdempotencyIndex();
    index[hash] = record;
    await this.writeIdempotencyIndex(index);
  }

  private async findEditorUrlByDraftId(draftId: string): Promise<string | undefined> {
    const index = await this.readIdempotencyIndex();
    const matched = Object.values(index).find((item) => item.draftId === draftId);
    return matched?.editorUrl;
  }

  private async fillEditorContent(page: Page, content: string, trace: TraceRecorder): Promise<void> {
    try {
      await fillWithFallback(page, trace, CONTENT_SELECTORS, content, this.config.timeoutMs);
      return;
    } catch {
      // fallback to keyboard typing on contenteditable
    }

    const editable = page.locator("[contenteditable='true']").first();
    const editableVisible = await editable.isVisible().catch(() => false);
    if (!editableVisible) {
      throw ToolError.fatal(ToolCode.SELECTOR_CHANGED, "未找到编辑器内容输入区域");
    }

    await editable.click({ timeout: this.config.timeoutMs });
    await page.keyboard.insertText(content);
  }

  private extractDraftId(editorUrl: string): string | undefined {
    const patterns = [/drafts\/(\d+)/, /drafts\/(\w+)/, /editor\/(\d+)/];
    for (const pattern of patterns) {
      const match = editorUrl.match(pattern);
      if (match?.[1]) {
        return match[1];
      }
    }
    return undefined;
  }

  private extractArticleId(articleUrl: string): string | undefined {
    const patterns = [/post\/(\d+)/, /post\/(\w+)/, /article\/(\d+)/];
    for (const pattern of patterns) {
      const match = articleUrl.match(pattern);
      if (match?.[1]) {
        return match[1];
      }
    }
    return undefined;
  }

  private async applyScheduleTime(page: Page, scheduleTime: string, trace: TraceRecorder): Promise<void> {
    const parsedDate = new Date(scheduleTime);
    if (Number.isNaN(parsedDate.getTime())) {
      throw ToolError.fatal(ToolCode.VALIDATION_ERROR, "scheduleTime 必须是合法 ISO8601 时间");
    }

    await clickWithFallback(page, trace, OPEN_SCHEDULE_SELECTORS, this.config.timeoutMs);

    const localValue = this.formatDateTimeLocal(parsedDate);
    await fillWithFallback(
      page,
      trace,
      SCHEDULE_TIME_INPUT_SELECTORS,
      localValue,
      this.config.timeoutMs
    );

    trace.record("publish.schedule", "datetime-local", localValue);
  }

  private formatDateTimeLocal(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    const hour = `${date.getHours()}`.padStart(2, "0");
    const minute = `${date.getMinutes()}`.padStart(2, "0");

    return `${year}-${month}-${day}T${hour}:${minute}`;
  }
}
