import { ToolCode } from "../shared/errorCodes.js";
import { ToolError } from "../shared/toolError.js";
import type { SessionManager } from "../session/SessionManager.js";
import type { AppConfig } from "../shared/config.js";
import type { TraceRecorder } from "../observability/TraceStore.js";
import type { Page } from "playwright";
import {
  clickWithFallback,
  containsRiskText,
  fillWithFallback,
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
    method: "sms";
    actionHints: string[];
  };
}

interface SmsSendData {
  sent: boolean;
  cooldownSeconds: number;
}

interface VerifyData {
  loggedIn: boolean;
  user: Pick<UserSnapshot, "nickname" | "uid">;
}

const RISK_TEXTS = ["滑块", "验证码", "安全验证", "请完成验证", "行为验证"];
const SMS_RATE_LIMIT_TEXTS = ["发送过于频繁", "稍后再试", "请求太频繁"];

const LOGIN_ENTRY_SELECTORS: SelectorCandidate[] = [
  { type: "role", role: "button", name: /登录|注册/ },
  { type: "text", text: /登录/ },
  { type: "css", css: "a[href*='login']" }
];

const SMS_TAB_SELECTORS: SelectorCandidate[] = [
  { type: "role", role: "tab", name: /短信|验证码|手机号/ },
  { type: "text", text: /手机验证码登录|短信登录|验证码登录/ },
  { type: "css", css: "button:has-text('验证码')" }
];

const PHONE_INPUT_SELECTORS: SelectorCandidate[] = [
  { type: "placeholder", placeholder: /手机号|请输入手机号/ },
  { type: "label", label: /手机号/ },
  { type: "css", css: "input[type='tel'], input[name*='phone'], input[placeholder*='手机']" }
];

const CODE_INPUT_SELECTORS: SelectorCandidate[] = [
  { type: "placeholder", placeholder: /验证码|请输入验证码/ },
  { type: "label", label: /验证码/ },
  { type: "css", css: "input[name*='code'], input[placeholder*='验证码']" }
];

const SEND_CODE_SELECTORS: SelectorCandidate[] = [
  { type: "role", role: "button", name: /获取验证码|发送验证码/ },
  { type: "text", text: /获取验证码|发送验证码/ },
  { type: "css", css: "button:has-text('验证码')" }
];

const LOGIN_SUBMIT_SELECTORS: SelectorCandidate[] = [
  { type: "role", role: "button", name: /登录|确认/ },
  { type: "text", text: /^登录$/ },
  { type: "css", css: "button[type='submit'], button:has-text('登录')" }
];

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
    const loggedIn = await this.isLoggedIn(page, trace);

    if (!loggedIn) {
      return {
        loggedIn,
        user: null,
        expiresHint: "unknown"
      };
    }

    const user = await this.readCurrentUser(page, trace);

    return {
      loggedIn: true,
      user,
      expiresHint: "persistent"
    };
  }

  public async ensureLogin(
    preferred: "sms" | "qr" | "auto",
    trace: TraceRecorder
  ): Promise<EnsureLoginData> {
    const status = await this.getSessionStatus(trace);

    if (status.loggedIn && status.user) {
      return {
        loggedIn: true,
        user: status.user
      };
    }

    const normalizedPreferred = "sms";
    trace.record(
      "login.ensure",
      normalizedPreferred,
      "preferred qr/auto is downgraded to sms in phase1"
    );

    return {
      loggedIn: false,
      next: {
        method: "sms",
        actionHints: [
          "call login_send_sms_code",
          "then login_verify_sms_code",
          "if CAPTCHA appears, complete it in visible browser and retry"
        ]
      }
    };
  }

  public async sendSmsCode(phone: string, trace: TraceRecorder): Promise<SmsSendData> {
    const page = await this.sessionManager.getPage();
    await gotoWithRetry(
      page,
      this.config.baseUrl,
      trace,
      this.config.retryCount,
      this.config.timeoutMs
    );

    await this.ensureLoginPanelVisible(page, trace);
    await fillWithFallback(page, trace, PHONE_INPUT_SELECTORS, phone, this.config.timeoutMs);
    await clickWithFallback(page, trace, SEND_CODE_SELECTORS, this.config.timeoutMs);

    if (await containsRiskText(page, RISK_TEXTS)) {
      throw ToolError.needUserAction(ToolCode.CAPTCHA_REQUIRED, "检测到验证码/滑块，请人工完成");
    }

    if (await containsRiskText(page, SMS_RATE_LIMIT_TEXTS)) {
      throw ToolError.needUserAction(ToolCode.SMS_RATE_LIMIT, "短信发送过于频繁，请稍后重试");
    }

    return {
      sent: true,
      cooldownSeconds: 60
    };
  }

  public async verifySmsCode(
    phone: string,
    code: string,
    trace: TraceRecorder
  ): Promise<VerifyData> {
    const page = await this.sessionManager.getPage();

    await this.ensureLoginPanelVisible(page, trace);
    await fillWithFallback(page, trace, PHONE_INPUT_SELECTORS, phone, this.config.timeoutMs);
    await fillWithFallback(page, trace, CODE_INPUT_SELECTORS, code, this.config.timeoutMs);
    await clickWithFallback(page, trace, LOGIN_SUBMIT_SELECTORS, this.config.timeoutMs);

    if (await containsRiskText(page, RISK_TEXTS)) {
      throw ToolError.needUserAction(ToolCode.CAPTCHA_REQUIRED, "检测到验证码/滑块，请人工完成");
    }

    await page.waitForTimeout(1500);
    const loggedIn = await this.isLoggedIn(page, trace);

    if (!loggedIn) {
      throw ToolError.retryable(
        ToolCode.NOT_LOGGED_IN,
        "登录状态未确认，请检查验证码是否正确后重试"
      );
    }

    const user = await this.readCurrentUser(page, trace);
    return {
      loggedIn: true,
      user: {
        nickname: user.nickname,
        uid: user.uid
      }
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

    try {
      await clickWithFallback(page, trace, SMS_TAB_SELECTORS, 2_000);
    } catch {
      // 已处于短信登录时不需要切 tab。
    }
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
  SessionStatusData,
  SmsSendData,
  UserSnapshot,
  VerifyData
};
