import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Page } from "playwright";

interface SaveArtifactResult {
  path: string;
}

function toBase64(buffer: Buffer): string {
  return buffer.toString("base64");
}

export class ArtifactsManager {
  public getTraceArtifactDir(userDataDir: string, traceId: string): string {
    return join(userDataDir, "artifacts", traceId);
  }

  private async ensureArtifactDir(userDataDir: string, traceId: string): Promise<string> {
    const artifactDir = this.getTraceArtifactDir(userDataDir, traceId);
    await mkdir(artifactDir, { recursive: true });
    return artifactDir;
  }

  public async saveScreenshotBuffer(
    buffer: Buffer,
    userDataDir: string,
    traceId: string,
    filename = "screenshot.png"
  ): Promise<SaveArtifactResult> {
    const artifactDir = await this.ensureArtifactDir(userDataDir, traceId);
    const filePath = join(artifactDir, filename);
    await writeFile(filePath, buffer);
    return { path: filePath };
  }

  public async captureScreenshot(
    page: Page,
    userDataDir: string,
    traceId: string,
    fullPage: boolean
  ): Promise<{ pngBase64: string; path: string }> {
    const screenshot = await page.screenshot({ type: "png", fullPage });
    const saved = await this.saveScreenshotBuffer(screenshot, userDataDir, traceId);
    return {
      pngBase64: toBase64(screenshot),
      path: saved.path
    };
  }

  public async saveHtml(
    html: string,
    userDataDir: string,
    traceId: string,
    filename = "page.html"
  ): Promise<SaveArtifactResult> {
    const artifactDir = await this.ensureArtifactDir(userDataDir, traceId);
    const filePath = join(artifactDir, filename);
    await writeFile(filePath, html, "utf8");
    return { path: filePath };
  }

  public async captureCurrentPageDump(
    page: Page,
    userDataDir: string,
    traceId: string,
    maxLength?: number
  ): Promise<{ html: string; path: string; truncated: boolean }> {
    const html = await page.content();
    const normalizedMaxLength =
      typeof maxLength === "number" && maxLength > 0 ? Math.floor(maxLength) : undefined;

    const truncated =
      normalizedMaxLength !== undefined && html.length > normalizedMaxLength;
    const outputHtml = truncated ? html.slice(0, normalizedMaxLength) : html;

    const saved = await this.saveHtml(outputHtml, userDataDir, traceId);

    return {
      html: outputHtml,
      path: saved.path,
      truncated
    };
  }
}
