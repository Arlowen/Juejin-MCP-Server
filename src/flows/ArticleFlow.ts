import type { AppConfig } from "../shared/config.js";
import { ToolCode } from "../shared/errorCodes.js";
import { ToolError } from "../shared/toolError.js";
import type { SessionManager } from "../session/SessionManager.js";
import type { TraceRecorder } from "../observability/TraceStore.js";
import { gotoWithRetry } from "./browserUtils.js";
import type { LoginFlow } from "./LoginFlow.js";

export interface ArticleGetInput {
  articleId?: string | null;
  articleUrl?: string | null;
}

export interface ArticleSummary {
  articleId: string;
  title: string;
  url: string;
  publishedAt: string;
}

export interface ArticleListInput {
  page?: number;
  pageSize?: number;
}

export interface ArticleListOutput {
  items: ArticleSummary[];
  page: number;
  pageSize: number;
}

export class ArticleFlow {
  public constructor(
    private readonly sessionManager: SessionManager,
    private readonly loginFlow: LoginFlow,
    private readonly config: AppConfig
  ) {}

  public async getArticle(input: ArticleGetInput, trace: TraceRecorder): Promise<ArticleSummary> {
    const normalizedUrl = this.resolveArticleUrl(input);
    const page = await this.sessionManager.getPage();

    await gotoWithRetry(
      page,
      normalizedUrl,
      trace,
      this.config.retryCount,
      this.config.timeoutMs
    );

    const title = await page
      .locator("h1")
      .first()
      .innerText()
      .then((text) => text.trim())
      .catch(() => "");

    const publishedAt = await page
      .locator("time[datetime]")
      .first()
      .getAttribute("datetime")
      .catch(() => null);

    const url = page.url();
    const articleId = this.extractArticleId(url) ?? input.articleId ?? "unknown";

    return {
      articleId,
      title,
      url,
      publishedAt: publishedAt ?? ""
    };
  }

  public async listMine(input: ArticleListInput, trace: TraceRecorder): Promise<ArticleListOutput> {
    await this.loginFlow.requireLoggedIn(trace);

    const pageNumber = Math.max(1, Math.floor(input.page ?? 1));
    const pageSize = Math.max(1, Math.floor(input.pageSize ?? 20));

    const page = await this.sessionManager.getPage();
    await gotoWithRetry(
      page,
      `${this.config.baseUrl}/user/center/content/post`,
      trace,
      this.config.retryCount,
      this.config.timeoutMs
    );

    await page.waitForTimeout(1_000);

    const allItems = await page.evaluate(() => {
      const anchorElements = Array.from(
        document.querySelectorAll<HTMLAnchorElement>("a[href*='/post/'], a[href*='/article/']")
      );

      const normalizedItems = anchorElements
        .map((anchor) => {
          const href = anchor.href;
          const title = (anchor.textContent || "").trim();
          const articleIdMatch = href.match(/\/(post|article)\/(\w+)/);
          const articleId = articleIdMatch?.[2] ?? "";

          return {
            articleId,
            title,
            url: href,
            publishedAt: ""
          };
        })
        .filter((item) => item.articleId);

      const unique = new Map<
        string,
        { articleId: string; title: string; url: string; publishedAt: string }
      >();
      for (const item of normalizedItems) {
        if (!unique.has(item.articleId)) {
          unique.set(item.articleId, item);
        }
      }

      return Array.from(unique.values());
    });

    const start = (pageNumber - 1) * pageSize;
    const pagedItems = allItems.slice(start, start + pageSize);

    return {
      items: pagedItems,
      page: pageNumber,
      pageSize
    };
  }

  private resolveArticleUrl(input: ArticleGetInput): string {
    const articleUrl = input.articleUrl?.trim();
    const articleId = input.articleId?.trim();

    if (articleUrl) {
      return articleUrl;
    }

    if (articleId) {
      return `${this.config.baseUrl}/post/${articleId}`;
    }

    throw ToolError.fatal(
      ToolCode.VALIDATION_ERROR,
      "articleId 与 articleUrl 至少传一个"
    );
  }

  private extractArticleId(url: string): string | undefined {
    const match = url.match(/\/(post|article)\/(\w+)/);
    return match?.[2];
  }
}
