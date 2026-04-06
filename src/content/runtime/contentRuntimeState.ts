import { CHAT_PLUS_PROTOCOL } from "../../shared/chatplus-protocol";

export const MONITOR_CONTROL_EVENT = "chat-plus-monitor-control";
export const MONITOR_RESULT_EVENT = "chat-plus-monitor-result";
export const ADAPTER_HOOK_REQUEST_EVENT = "chat-plus-adapter-hook-request";
export const ADAPTER_HOOK_RESPONSE_EVENT = "chat-plus-adapter-hook-response";
export const ADAPTER_SANDBOX_CHANNEL = "chat-plus-adapter-sandbox";
export const ADAPTER_SNAPSHOT_NODE_ATTR = "data-chat-plus-sandbox-node-id";
export const CODE_MODE_STATUS_BAR_ID = "chat-plus-code-mode-status-bar";
export const CODE_MODE_STATUS_BAR_POSITION_STORAGE_KEY = "chat-plus-code-mode-status-bar-position";
export const CODE_MODE_AUTO_CONTINUE_STORAGE_KEY = "chat-plus-code-mode-auto-continue-enabled";
export const CODE_MODE_RECENT_EXECUTION_TTL_MS = 45000;
export const CODE_MODE_MANUAL_RUN_TRIGGER_ATTR = "data-chat-plus-code-mode-run";
export const CODE_MODE_MANUAL_RUN_CARD_ATTR = "data-chat-plus-code-mode-card";
export const CODE_MODE_MANUAL_RUN_SOURCE_ATTR = "data-chat-plus-code-mode-source";
export const SYSTEM_INJECTION_WIDGET_ID = "chat-plus-system-injection-widget";
export const SYSTEM_INJECTION_WIDGET_POSITION_STORAGE_KEY =
  "chat-plus-system-injection-widget-position";
export const ORCHESTRATION_DISABLED_STORAGE_KEY = "orchestrationDisabledTabIds";

export function createContentRuntimeState() {
  return {
    isEnabled: true,
    isTabEnabled: true,
    uiTheme: "dark" as "dark" | "light",
    monitorReady: false,
    monitorActive: false,
    lastMonitorDebugLogKey: "",
    systemInstructionContent: "",
    requestInjectionText: "",
    requestInjectionMode: "system" as "system" | "raw",
    adapterScript: "",
    codeModeManifest: {
      servers: [] as Array<Record<string, unknown>>,
      docs: [] as Array<Record<string, unknown>>,
    },
    systemInjection: {
      armed: false,
      armReason: "" as "" | "config" | "manual" | "url",
      currentSignature: "",
      lastAppliedSignature: "",
    },
    manualDomInjection: {
      active: false,
      injectionText: "",
      injectionMode: "system" as "system" | "raw",
      preparedAt: 0,
    },
    bubbleDecorationFallback: {
      requestMessagePreview: "",
      updatedAt: 0,
    },
    pageContext: {
      lastUrl: location.href,
      urlWatchTimerId: 0,
      expectedAssistantTurn: false,
      expectedAssistantTurnAt: 0,
      expectedAssistantTurnSource: "" as "" | "user" | "auto",
    },
    systemInjectionWidget: {
      root: null as HTMLDivElement | null,
      panel: null as HTMLDivElement | null,
      ball: null as HTMLDivElement | null,
      dragHandle: null as HTMLDivElement | null,
      collapseButton: null as HTMLButtonElement | null,
      autoContinueToggle: null as HTMLButtonElement | null,
      autoContinueThumb: null as HTMLSpanElement | null,
      nextSendToggle: null as HTMLButtonElement | null,
      nextSendThumb: null as HTMLSpanElement | null,
      compressButton: null as HTMLButtonElement | null,
      compressButtonLabel: null as HTMLSpanElement | null,
      compressButtonMeta: null as HTMLSpanElement | null,
      compressRequestRunning: false,
      compressRequestStatus: "idle" as "idle" | "error" | "cooldown",
      compressRequestMessage: "",
      compressCooldownUntil: 0,
      compressCooldownTimerId: 0,
      collapsed: true,
      dockSide: "right" as "left" | "right",
    },
    protocol: CHAT_PLUS_PROTOCOL,
    bubbleDecorationObserver: null as MutationObserver | null,
    bubbleDecorationTimerId: 0,
    bubbleDecorationRunning: false,
    bubbleDecorationQueued: false,
    adapterSandbox: {
      frame: null as HTMLIFrameElement | null,
      ready: false,
      readyPromise: null as Promise<void> | null,
      readyResolver: null as null | (() => void),
      requestSequence: 0,
      pending: new Map<
        number,
        {
          resolve: (value: unknown) => void;
          reject: (error: Error) => void;
          timerId: number;
        }
      >(),
      lastLoggedErrorKey: "",
    },
    codeMode: {
      lastExecutionKey: "",
      recentExecutionKeys: new Map<string, number>(),
      pendingToolResultText: "",
      manualPreparedToolResultText: "",
      autoContinueEnabled: true,
      autoContinueInFlight: false,
      autoContinueFallbackTimerId: 0,
      running: false,
      runSequence: 0,
      activeRunId: 0,
      activeToolLabel: "",
      activeToolPendingCount: 0,
      statusText: "",
      detailText: "",
      statusTone: "idle" as "idle" | "running" | "success" | "error" | "cancelled",
      runStartedAt: 0,
      cancelledRunIds: new Set<number>(),
      elapsedTimerId: 0,
      noticeTimerId: 0,
      statusBar: {
        root: null as HTMLDivElement | null,
        badge: null as HTMLDivElement | null,
        badgeDot: null as HTMLDivElement | null,
        title: null as HTMLDivElement | null,
        detail: null as HTMLDivElement | null,
        stopButton: null as HTMLButtonElement | null,
      },
    },
  };
}

export type ContentRuntimeState = ReturnType<typeof createContentRuntimeState>;
