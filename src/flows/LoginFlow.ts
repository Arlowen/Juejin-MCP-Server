import { ToolCode } from "../shared/errorCodes.js";
import { ToolError } from "../shared/toolError.js";
import type { SessionManager } from "../session/SessionManager.js";
import type { AppConfig } from "../shared/config.js";
import type { TraceRecorder } from "../observability/TraceStore.js";
import type { Locator, Page } from "playwright";
import {
  clickWithFallback,
  containsRiskText,
  gotoWithRetry,
  type SelectorCandidate
} from "./browserUtils.js";

interface UserSnapshot {
  nickname: string;
  uid: string;
  avatarUrl: string;
}

interface SessionStatusData {
  loggedIn: boolean;
  user: UserSnapshot | null;
  expiresHint: string;
}

interface EnsureLoginData {
  loggedIn: boolean;
  user?: UserSnapshot;
  next?: {
    method: "qr";
    actionHints: string[];
  };
}

interface LoginQrCodeCapture {
  pngBuffer: Buffer;
  mimeType: "image/png";
  width: number;
  height: number;
}

interface QrCaptureCandidate {
  buffer: Buffer;
  width: number;
  height: number;
}

const RISK_TEXTS = ["滑块", "验证码", "安全验证", "请完成验证", "行为验证"];

const LOGIN_ENTRY_SELECTORS: SelectorCandidate[] = [
  { type: "role", role: "button", name: /登录|注册/ },
  { type: "text", text: /登录/ },
  { type: "css", css: "a[href*='login']" }
];

const QR_TAB_SELECTORS: SelectorCandidate[] = [
  { type: "role", role: "tab", name: /二维码|扫码/ },
  { type: "text", text: /扫码登录|二维码登录|扫码/ },
  { type: "css", css: "button:has-text('扫码'), button:has-text('二维码')" }
];

const QR_LOCATOR_SELECTORS = [
  "[class*='qrcode'] canvas",
  "[class*='qr-code'] canvas",
  "[class*='qr'] canvas",
  "canvas[class*='qr']",
  "canvas[id*='qr']",
  "img[src*='qrcode']",
  "img[alt*='二维码']",
  "[class*='qrcode'] img",
  "[class*='qr-code'] img",
  "[class*='qr'] img"
];

const MIN_QR_DIMENSION = 90;
const MAX_QR_SCAN_NODE_COUNT = 20;

export class LoginFlow {
  public constructor(
    private readonly sessionManager: SessionManager,
    private readonly config: AppConfig
  ) {}

  public async getSessionStatus(trace: TraceRecorder): Promise<SessionStatusData> {
    if (!this.sessionManager.isInitialized()) {
      return {
        loggedIn: false,
        user: null,
        expiresHint: "unknown"
      };
    }

    const page = await this.sessionManager.getPage();
    await gotoWithRetry(
      page,
      this.config.baseUrl,
      trace,
      this.config.retryCount,
      this.config.timeoutMs
    ).catch(() => undefined);
    const loggedIn = await this.isLoggedIn(page, trace);

    if (!loggedIn) {
      return {
        loggedIn,
        user: null,
        expiresHint: "unknown"
      };
    }

    const user = await this.readCurrentUser(page, trace);
    const persisted = await this.sessionManager.persistCookies().catch(() => undefined);
    if (persisted) {
      trace.record(
        "login.cookie.persist",
        persisted.path,
        `cookieCount=${String(persisted.cookieCount)}`
      );
    }

    return {
      loggedIn: true,
      user,
      expiresHint: "persistent"
    };
  }

  public async ensureLogin(
    preferred: "qr" | "auto",
    trace: TraceRecorder
  ): Promise<EnsureLoginData> {
    const status = await this.getSessionStatus(trace);

    if (status.loggedIn && status.user) {
      return {
        loggedIn: true,
        user: status.user
      };
    }

    trace.record("login.ensure", preferred, "qr login required");

    return {
      loggedIn: false,
      next: {
        method: "qr",
        actionHints: [
          "call login_get_qr_code",
          "scan qr with juejin app in visible browser",
          "then call session_status or ensure_login to confirm"
        ]
      }
    };
  }

  public async getLoginQrCode(trace: TraceRecorder): Promise<LoginQrCodeCapture> {
    const page = await this.sessionManager.getPage();
    await gotoWithRetry(
      page,
      this.config.baseUrl,
      trace,
      this.config.retryCount,
      this.config.timeoutMs
    );

    await this.ensureQrLoginPanelVisible(page, trace);
    const qrCapture = await this.captureQrCode(page, trace);

    return {
      pngBuffer: qrCapture.buffer,
      mimeType: "image/png",
      width: qrCapture.width,
      height: qrCapture.height
    };
  }

  public async requireLoggedIn(trace: TraceRecorder): Promise<UserSnapshot> {
    if (!this.sessionManager.isInitialized()) {
      throw ToolError.fatal(ToolCode.NOT_LOGGED_IN, "会话未初始化，请先调用 session_init");
    }

    const page = await this.sessionManager.getPage();
    const loggedIn = await this.isLoggedIn(page, trace);

    if (!loggedIn) {
      throw ToolError.fatal(ToolCode.NOT_LOGGED_IN, "当前未登录，请先完成登录");
    }

    return this.readCurrentUser(page, trace);
  }

  private async ensureLoginPanelVisible(page: Page, trace: TraceRecorder): Promise<void> {
    try {
      await clickWithFallback(page, trace, LOGIN_ENTRY_SELECTORS, 3_000);
    } catch {
      // 登录弹层可能已经打开，忽略入口点击错误。
    }
  }

  private async ensureQrLoginPanelVisible(page: Page, trace: TraceRecorder): Promise<void> {
    await this.ensureLoginPanelVisible(page, trace);
    try {
      await clickWithFallback(page, trace, QR_TAB_SELECTORS, 2_000);
    } catch {
      // 已处于二维码登录时不需要切 tab。
    }
  }

  private async screenshotLocatorIfQrLike(
    locator: Locator,
    trace: TraceRecorder,
    label: string
  ): Promise<QrCaptureCandidate | undefined> {
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) {
      return undefined;
    }

    const box = await locator.boundingBox().catch(() => null);
    if (!box || box.width < MIN_QR_DIMENSION || box.height < MIN_QR_DIMENSION) {
      return undefined;
    }

    const buffer = await locator.screenshot({ type: "png" }).catch(() => undefined);
    if (!buffer || buffer.length === 0) {
      return undefined;
    }

    trace.record("login.qr.capture", label, `${Math.round(box.width)}x${Math.round(box.height)}`);
    return {
      buffer,
      width: Math.round(box.width),
      height: Math.round(box.height)
    };
  }

  private async captureQrCode(page: Page, trace: TraceRecorder): Promise<QrCaptureCandidate> {
    for (const selector of QR_LOCATOR_SELECTORS) {
      const candidate = await this.screenshotLocatorIfQrLike(
        page.locator(selector).first(),
        trace,
        `selector=${selector}`
      );
      if (candidate) {
        return candidate;
      }
    }

    const genericLocators = [
      { locator: page.locator("canvas"), label: "canvas" },
      { locator: page.locator("img"), label: "img" }
    ];

    for (const { locator, label } of genericLocators) {
      const count = await locator.count();
      const scanCount = Math.min(count, MAX_QR_SCAN_NODE_COUNT);
      for (let index = 0; index < scanCount; index += 1) {
        const candidate = await this.screenshotLocatorIfQrLike(
          locator.nth(index),
          trace,
          `${label}[${String(index)}]`
        );
        if (candidate) {
          return candidate;
        }
      }
    }

    if (await containsRiskText(page, RISK_TEXTS)) {
      throw ToolError.needUserAction(
        ToolCode.CAPTCHA_REQUIRED,
        "检测到验证码/滑块，请先人工完成再重新获取二维码"
      );
    }

    throw ToolError.fatal(
      ToolCode.SELECTOR_CHANGED,
      "未找到可识别的登录二维码，请确认掘金登录弹层已打开"
    );
  }

  private async isLoggedIn(page: Page, trace: TraceRecorder): Promise<boolean> {
    const loggedInSelectors: SelectorCandidate[] = [
      { type: "role", role: "button", name: /写文章|创作中心|创作者中心/ },
      { type: "css", css: "img[src*='avatar'], img[alt*='头像']" },
      { type: "css", css: "a[href*='user']" }
    ];

    for (const selector of loggedInSelectors) {
      try {
        const locator = (() => {
          switch (selector.type) {
            case "role":
              return page.getByRole(selector.role, { name: selector.name }).first();
            case "text":
              return page.getByText(selector.text).first();
            case "css":
              return page.locator(selector.css).first();
            case "placeholder":
              return page.getByPlaceholder(selector.placeholder).first();
            case "label":
              return page.getByLabel(selector.label).first();
          }
        })();
        trace.record("login.check", this.selectorLabel(selector), "checking visibility");
        const visible = await locator.isVisible().catch(() => false);
        if (visible) {
          trace.record("login.state", this.selectorLabel(selector), "login state confirmed");
          return true;
        }
      } catch {
        // continue fallback loop
      }
    }

    return false;
  }

  private selectorLabel(selector: SelectorCandidate): string {
    switch (selector.type) {
      case "role":
        return `role=${selector.role};name=${String(selector.name)}`;
      case "text":
        return `text=${String(selector.text)}`;
      case "css":
        return `css=${selector.css}`;
      case "placeholder":
        return `placeholder=${String(selector.placeholder)}`;
      case "label":
        return `label=${String(selector.label)}`;
    }
  }

  private async readCurrentUser(
    page: Page,
    trace: TraceRecorder
  ): Promise<UserSnapshot> {
    const rawUser = await page
      .evaluate(() => {
        const avatarElement = document.querySelector<HTMLImageElement>(
          "img[src*='avatar'], img[alt*='头像'], img[class*='avatar']"
        );

        const profileAnchor = document.querySelector<HTMLAnchorElement>(
          "a[href*='/user/'], a[href*='user/']"
        );

        const nicknameSource =
          document
            .querySelector<HTMLElement>("[class*='name'], [class*='nickname']")
            ?.innerText ?? "";

        const profileHref = profileAnchor?.href ?? "";
        const uidMatch = profileHref.match(/user\/(\d+)/);

        return {
          nickname: nicknameSource.trim(),
          uid: uidMatch?.[1] ?? "",
          avatarUrl: avatarElement?.src ?? ""
        };
      })
      .catch(() => ({ nickname: "", uid: "", avatarUrl: "" }));

    const nickname = rawUser.nickname || "unknown";
    const uid = rawUser.uid || "unknown";

    trace.record("login.user", uid, `nickname=${nickname}`);

    return {
      nickname,
      uid,
      avatarUrl: rawUser.avatarUrl
    };
  }
}

export type {
  EnsureLoginData,
  LoginQrCodeCapture,
  SessionStatusData,
  UserSnapshot
};
