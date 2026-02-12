import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Page } from "playwright";

import { ToolCode } from "../shared/errorCodes.js";
import { ToolError } from "../shared/toolError.js";
import type { AppConfig } from "../shared/config.js";
import type { SessionManager } from "../session/SessionManager.js";
import type { TraceRecorder } from "../observability/TraceStore.js";
import { gotoWithRetry } from "./browserUtils.js";
import type { LoginFlow } from "./LoginFlow.js";

export interface UploadImageInput {
  name: string;
  url?: string | null;
  base64?: string | null;
  mime?: string;
}

export interface UploadAsset {
  name: string;
  url: string;
  assetId: string;
  width: number;
  height: number;
}

export class ImageFlow {
  public constructor(
    private readonly sessionManager: SessionManager,
    private readonly loginFlow: LoginFlow,
    private readonly config: AppConfig
  ) {}

  public async uploadImages(images: UploadImageInput[], trace: TraceRecorder): Promise<UploadAsset[]> {
    await this.loginFlow.requireLoggedIn(trace);

    const tmpDir = this.sessionManager.getTmpDir();
    if (!tmpDir) {
      throw ToolError.fatal(ToolCode.NOT_LOGGED_IN, "会话未初始化，请先调用 session_init");
    }

    const page = await this.sessionManager.getPage();
    await gotoWithRetry(
      page,
      `${this.config.baseUrl}/editor/drafts/new`,
      trace,
      this.config.retryCount,
      this.config.timeoutMs
    );

    const uploadedAssets: UploadAsset[] = [];

    for (const image of images) {
      const filePath = await this.materializeImage(tmpDir, image, trace);
      trace.record("image.prepare", image.name, filePath);

      const inputLocator = page
        .locator("input[type='file'][accept*='image'], input[type='file']")
        .first();

      const inputReady = await inputLocator.isVisible().catch(() => false);
      if (!inputReady) {
        throw ToolError.fatal(ToolCode.SELECTOR_CHANGED, "未找到图片上传 input 元素");
      }

      await inputLocator.setInputFiles(filePath, { timeout: this.config.timeoutMs });
      trace.record("image.upload", image.name, "setInputFiles done");

      await page.waitForTimeout(1200);
      const uploadedUrl = await this.resolveUploadedImageUrl(page);
      if (!uploadedUrl) {
        throw ToolError.retryable(
          ToolCode.IMAGE_UPLOAD_FAILED,
          `未能解析上传结果 URL: ${image.name}`
        );
      }

      const assetId = createHash("sha256").update(uploadedUrl).digest("hex").slice(0, 16);

      uploadedAssets.push({
        name: image.name,
        url: uploadedUrl,
        assetId,
        width: 0,
        height: 0
      });
    }

    return uploadedAssets;
  }

  private async materializeImage(
    tmpDir: string,
    image: UploadImageInput,
    trace: TraceRecorder
  ): Promise<string> {
    if (!image.url && !image.base64) {
      throw ToolError.fatal(
        ToolCode.VALIDATION_ERROR,
        `图片 ${image.name} 缺少 url/base64 任一输入`
      );
    }

    const normalizedName = image.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const outputPath = join(tmpDir, normalizedName || `image_${Date.now()}.png`);

    let buffer: Buffer;
    if (image.url) {
      trace.record("image.fetch", image.url, image.name);
      const response = await fetch(image.url);
      if (!response.ok) {
        throw ToolError.retryable(
          ToolCode.IMAGE_UPLOAD_FAILED,
          `下载图片失败: ${image.url} status=${response.status}`
        );
      }

      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } else {
      const raw = image.base64 as string;
      const content = raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : raw;
      buffer = Buffer.from(content, "base64");
    }

    await writeFile(outputPath, buffer);
    return outputPath;
  }

  private async resolveUploadedImageUrl(page: Page): Promise<string | null> {
    const markdownValue = await page
      .locator("textarea")
      .first()
      .inputValue()
      .catch(() => "");

    const markdownMatch = markdownValue.match(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/g);
    if (markdownMatch && markdownMatch.length > 0) {
      const latest = markdownMatch[markdownMatch.length - 1];
      if (!latest) {
        return null;
      }
      const urlMatch = latest.match(/\((https?:\/\/[^)]+)\)/);
      return urlMatch?.[1] ?? null;
    }

    const previewSrc = await page
      .locator("img[src^='http']")
      .first()
      .getAttribute("src")
      .catch(() => null);

    return previewSrc;
  }
}
