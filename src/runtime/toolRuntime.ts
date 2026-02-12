import { ArticleFlow } from "../flows/ArticleFlow.js";
import { DraftFlow } from "../flows/DraftFlow.js";
import { ImageFlow } from "../flows/ImageFlow.js";
import { LoginFlow } from "../flows/LoginFlow.js";
import { ProfileFlow } from "../flows/ProfileFlow.js";
import { ArtifactsManager } from "../observability/Artifacts.js";
import { TraceStore } from "../observability/TraceStore.js";
import { SessionManager } from "../session/SessionManager.js";
import { loadAppConfig, type AppConfig } from "../shared/config.js";

export interface ToolRuntime {
  config: AppConfig;
  sessionManager: SessionManager;
  traceStore: TraceStore;
  artifacts: ArtifactsManager;
  loginFlow: LoginFlow;
  imageFlow: ImageFlow;
  draftFlow: DraftFlow;
  articleFlow: ArticleFlow;
  profileFlow: ProfileFlow;
}

export function createToolRuntime(): ToolRuntime {
  const config = loadAppConfig();
  const sessionManager = new SessionManager();
  const traceStore = new TraceStore();
  const artifacts = new ArtifactsManager();
  const loginFlow = new LoginFlow(sessionManager, config);

  return {
    config,
    sessionManager,
    traceStore,
    artifacts,
    loginFlow,
    imageFlow: new ImageFlow(sessionManager, loginFlow, config),
    draftFlow: new DraftFlow(sessionManager, loginFlow, config),
    articleFlow: new ArticleFlow(sessionManager, loginFlow, config),
    profileFlow: new ProfileFlow(sessionManager, loginFlow, config)
  };
}
