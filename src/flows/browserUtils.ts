import type { Locator, Page } from "playwright";

import { ToolCode } from "../shared/errorCodes.js";
import { ToolError } from "../shared/toolError.js";
import type { TraceRecorder } from "../observability/TraceStore.js";

export type SelectorCandidate =
  | {
      type: "role";
      role: Parameters<Page["getByRole"]>[0];
      name: string | RegExp;
    }
  | { type: "text"; text: string | RegExp }
  | { type: "css"; css: string }
  | { type: "placeholder"; placeholder: string | RegExp }
  | { type: "label"; label: string | RegExp };

function candidateLabel(candidate: SelectorCandidate): string {
  switch (candidate.type) {
    case "role":
      return `role=${candidate.role};name=${String(candidate.name)}`;
    case "text":
      return `text=${String(candidate.text)}`;
    case "css":
      return `css=${candidate.css}`;
    case "placeholder":
      return `placeholder=${String(candidate.placeholder)}`;
    case "label":
      return `label=${String(candidate.label)}`;
  }
}

function createLocator(page: Page, candidate: SelectorCandidate): Locator {
  switch (candidate.type) {
    case "role":
      return page.getByRole(candidate.role, { name: candidate.name });
    case "text":
      return page.getByText(candidate.text);
    case "css":
      return page.locator(candidate.css);
    case "placeholder":
      return page.getByPlaceholder(candidate.placeholder);
    case "label":
      return page.getByLabel(candidate.label);
  }
}

export async function gotoWithRetry(
  page: Page,
  url: string,
  trace: TraceRecorder,
  retries: number,
  timeoutMs: number
): Promise<void> {
  const maxAttempts = Math.max(1, retries + 1);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    trace.record("goto", url, `attempt ${attempt}/${maxAttempts}`);
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs
      });
      return;
    } catch (error: unknown) {
      lastError = error;
    }
  }

  throw ToolError.retryable(ToolCode.NAVIGATION_TIMEOUT, `页面跳转超时: ${url}`, {
    cause: lastError instanceof Error ? lastError.message : String(lastError)
  });
}

export async function locateWithFallback(
  page: Page,
  trace: TraceRecorder,
  action: string,
  candidates: SelectorCandidate[],
  timeoutMs: number
): Promise<{ locator: Locator; matched: string }> {
  for (const candidate of candidates) {
    const label = candidateLabel(candidate);
    trace.record(action, label, "trying selector candidate");
    const locator = createLocator(page, candidate).first();

    try {
      await locator.waitFor({ state: "visible", timeout: timeoutMs });
      trace.record(action, label, "selector matched");
      return {
        locator,
        matched: label
      };
    } catch {
      trace.record(action, label, "selector not matched");
    }
  }

  throw ToolError.fatal(ToolCode.SELECTOR_CHANGED, "关键元素定位失败");
}

export async function clickWithFallback(
  page: Page,
  trace: TraceRecorder,
  candidates: SelectorCandidate[],
  timeoutMs: number
): Promise<string> {
  const resolved = await locateWithFallback(page, trace, "click", candidates, timeoutMs);
  await resolved.locator.click({ timeout: timeoutMs });
  trace.record("click", resolved.matched, "click done");
  return resolved.matched;
}

export async function fillWithFallback(
  page: Page,
  trace: TraceRecorder,
  candidates: SelectorCandidate[],
  value: string,
  timeoutMs: number
): Promise<string> {
  const resolved = await locateWithFallback(page, trace, "fill", candidates, timeoutMs);
  await resolved.locator.fill(value, { timeout: timeoutMs });
  trace.record("fill", resolved.matched, "fill done");
  return resolved.matched;
}

export async function containsRiskText(page: Page, needles: string[]): Promise<boolean> {
  const text = await page.locator("body").innerText().catch(() => "");
  return needles.some((needle) => text.includes(needle));
}
