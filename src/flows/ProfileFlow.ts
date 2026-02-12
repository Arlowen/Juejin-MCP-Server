import type { AppConfig } from "../shared/config.js";
import type { SessionManager } from "../session/SessionManager.js";
import type { TraceRecorder } from "../observability/TraceStore.js";
import { gotoWithRetry } from "./browserUtils.js";
import type { LoginFlow } from "./LoginFlow.js";

export interface ProfileSelfData {
  nickname: string;
  uid: string;
  avatarUrl: string;
  bio: string;
  followers: number;
  following: number;
}

export class ProfileFlow {
  public constructor(
    private readonly sessionManager: SessionManager,
    private readonly loginFlow: LoginFlow,
    private readonly config: AppConfig
  ) {}

  public async getSelf(trace: TraceRecorder): Promise<ProfileSelfData> {
    const user = await this.loginFlow.requireLoggedIn(trace);
    const page = await this.sessionManager.getPage();

    await gotoWithRetry(
      page,
      `${this.config.baseUrl}/user/${user.uid}`,
      trace,
      this.config.retryCount,
      this.config.timeoutMs
    );

    await page.waitForTimeout(1_000);

    const profile = await page
      .evaluate(() => {
        const nickname =
          document
            .querySelector<HTMLElement>("h1, [class*='name'], [class*='nickname']")
            ?.innerText?.trim() ?? "";

        const avatarUrl =
          document.querySelector<HTMLImageElement>("img[src*='avatar'], img[class*='avatar']")
            ?.src ?? "";

        const bio =
          document
            .querySelector<HTMLElement>("[class*='bio'], [class*='signature'], .desc")
            ?.innerText?.trim() ?? "";

        const bodyText = document.body.innerText || "";

        const followersMatch = bodyText.match(/粉丝\s*(\d+)/);
        const followingMatch = bodyText.match(/关注\s*(\d+)/);
        const followers = followersMatch?.[1]
          ? Number.parseInt(followersMatch[1], 10)
          : 0;
        const following = followingMatch?.[1]
          ? Number.parseInt(followingMatch[1], 10)
          : 0;

        return {
          nickname,
          avatarUrl,
          bio,
          followers,
          following
        };
      })
      .catch(() => ({
        nickname: "",
        avatarUrl: "",
        bio: "",
        followers: 0,
        following: 0
      }));

    return {
      nickname: profile.nickname || user.nickname,
      uid: user.uid,
      avatarUrl: profile.avatarUrl || user.avatarUrl,
      bio: profile.bio || "",
      followers: Number.isFinite(profile.followers) ? profile.followers : 0,
      following: Number.isFinite(profile.following) ? profile.following : 0
    };
  }
}
