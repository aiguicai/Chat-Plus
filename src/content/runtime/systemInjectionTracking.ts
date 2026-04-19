import {
  CODE_MODE_AUTO_CONTINUE_STORAGE_KEY,
  CODE_MODE_AUTO_CONTINUE_DELAY_STORAGE_KEY,
  normalizeCodeModeAutoContinueDelaySeconds,
  type ContentRuntimeState,
} from "./contentRuntimeState";
import { wrapChatPlusInjection } from "../../shared/chatplus-protocol";

type CreateSystemInjectionTrackingControllerOptions = {
  state: ContentRuntimeState;
  isPluginRuntimeEnabled: () => boolean;
  updateRequestInjection: () => void;
  dispatchMonitorControl: (active?: boolean) => void;
  renderSystemInjectionWidget: () => void;
  renderCodeModeStatusBar: () => void;
  syncBubbleDecorationObserver: () => void;
  clearPluginRuntimeEffects: () => void;
};

export function createSystemInjectionTrackingController({
  state,
  isPluginRuntimeEnabled,
  updateRequestInjection,
  dispatchMonitorControl,
  renderSystemInjectionWidget,
  renderCodeModeStatusBar,
  syncBubbleDecorationObserver,
  clearPluginRuntimeEffects,
}: CreateSystemInjectionTrackingControllerOptions) {
  function normalizeTrackedText(value: unknown) {
    return String(value ?? "").replace(/\r\n?/g, "\n").trim();
  }

  function buildSystemInjectionSignature(content: unknown, _manifest: unknown) {
    const normalizedContent = normalizeTrackedText(content);
    if (!normalizedContent) return "";
    return wrapChatPlusInjection(normalizedContent);
  }

  function hasSystemInstructionContent() {
    return Boolean(normalizeTrackedText(state.systemInstructionContent));
  }

  function normalizeCodeModeAutoContinueEnabled(value: unknown) {
    return value !== false;
  }

  function persistCodeModeAutoContinueDelaySeconds(seconds: number) {
    chrome.storage.sync.set({
      [CODE_MODE_AUTO_CONTINUE_DELAY_STORAGE_KEY]: normalizeCodeModeAutoContinueDelaySeconds(seconds),
    });
  }

  function persistCodeModeAutoContinueEnabled(enabled: boolean) {
    chrome.storage.sync.set({
      [CODE_MODE_AUTO_CONTINUE_STORAGE_KEY]: enabled !== false,
    });
  }

  function setCodeModeAutoContinueEnabled(value: unknown, persist = false) {
    state.codeMode.autoContinueEnabled = normalizeCodeModeAutoContinueEnabled(value);
    renderSystemInjectionWidget();
    if (persist) {
      persistCodeModeAutoContinueEnabled(state.codeMode.autoContinueEnabled);
    }
  }

  function setCodeModeAutoContinueDelaySeconds(value: unknown, persist = false) {
    state.codeMode.autoContinueDelaySeconds = normalizeCodeModeAutoContinueDelaySeconds(value);
    renderSystemInjectionWidget();
    if (persist) {
      persistCodeModeAutoContinueDelaySeconds(state.codeMode.autoContinueDelaySeconds);
    }
  }

  function setSystemInjectionArmed(
    armed: boolean,
    reason: "" | "config" | "manual" | "url" = "",
  ) {
    state.systemInjection.armed = armed && hasSystemInstructionContent();
    state.systemInjection.armReason = state.systemInjection.armed ? reason : "";
    renderSystemInjectionWidget();
  }

  function syncSystemInjectionArmState() {
    const currentSignature = String(state.systemInjection.currentSignature || "");
    const lastAppliedSignature = String(state.systemInjection.lastAppliedSignature || "");

    if (!currentSignature) {
      setSystemInjectionArmed(false);
      return;
    }

    setSystemInjectionArmed(currentSignature !== lastAppliedSignature, "config");
  }

  function markSystemInjectionApplied(appliedSignature?: unknown) {
    if (!state.systemInjection.armed && !state.systemInjection.armReason) return;
    const normalizedAppliedSignature = normalizeTrackedText(appliedSignature);
    state.systemInjection.lastAppliedSignature =
      normalizedAppliedSignature || String(state.systemInjection.currentSignature || "");
    state.systemInjection.armed = false;
    state.systemInjection.armReason = "";
    renderSystemInjectionWidget();
  }

  function getSystemInjectionStatusText() {
    if (!hasSystemInstructionContent()) {
      return "当前没有可带设置";
    }
    if (state.systemInjection.armReason === "url") {
      return "新会话默认带一次";
    }
    if (state.systemInjection.armReason === "config") {
      return "设置已更新，下条会带上";
    }
    if (state.systemInjection.armReason === "manual") {
      return "下条会带上，发后自动关";
    }
    if (state.systemInjection.armed) {
      return "下条会带上，发后自动关";
    }
    return "当前下条不带设置";
  }

  function handlePageUrlChange(nextUrl = location.href) {
    if (window.top !== window) return;

    const normalizedUrl = String(nextUrl || "").trim() || location.href;
    if (!normalizedUrl || normalizedUrl === state.pageContext.lastUrl) return;

    state.pageContext.lastUrl = normalizedUrl;
    if (!hasSystemInstructionContent()) {
      renderSystemInjectionWidget();
      return;
    }

    setSystemInjectionArmed(true, "url");
    updateRequestInjection();
    dispatchMonitorControl(state.monitorActive);
  }

  function installPageUrlWatchers() {
    if (window.top !== window) return;
    if (state.pageContext.urlWatchTimerId) return;

    const scheduleUrlCheck = () => {
      window.setTimeout(() => {
        handlePageUrlChange(location.href);
      }, 0);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      handlePageUrlChange(location.href);
    };

    const originalPushState = history.pushState.bind(history);
    history.pushState = ((...args: Parameters<History["pushState"]>) => {
      const result = originalPushState(...args);
      scheduleUrlCheck();
      return result;
    }) as History["pushState"];

    const originalReplaceState = history.replaceState.bind(history);
    history.replaceState = ((...args: Parameters<History["replaceState"]>) => {
      const result = originalReplaceState(...args);
      scheduleUrlCheck();
      return result;
    }) as History["replaceState"];

    window.addEventListener("popstate", scheduleUrlCheck, { passive: true });
    document.addEventListener("visibilitychange", handleVisibilityChange, {
      passive: true,
    });
    state.pageContext.urlWatchTimerId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (location.href !== state.pageContext.lastUrl) {
        handlePageUrlChange(location.href);
      }
    }, 600);
  }

  function loadSettings() {
    chrome.storage.sync.get(
      [
        "enabled",
        "theme",
        CODE_MODE_AUTO_CONTINUE_STORAGE_KEY,
        CODE_MODE_AUTO_CONTINUE_DELAY_STORAGE_KEY,
      ],
      (cfg) => {
        const previousRuntimeEnabled = isPluginRuntimeEnabled();
        state.isEnabled = cfg.enabled !== false;
        state.uiTheme = cfg.theme === "light" ? "light" : "dark";
        state.codeMode.autoContinueEnabled = normalizeCodeModeAutoContinueEnabled(
          cfg[CODE_MODE_AUTO_CONTINUE_STORAGE_KEY],
        );
        state.codeMode.autoContinueDelaySeconds = normalizeCodeModeAutoContinueDelaySeconds(
          cfg[CODE_MODE_AUTO_CONTINUE_DELAY_STORAGE_KEY],
        );
        if (previousRuntimeEnabled && !isPluginRuntimeEnabled()) {
          clearPluginRuntimeEffects();
        }
        syncBubbleDecorationObserver();
        renderSystemInjectionWidget();
        renderCodeModeStatusBar();
        dispatchMonitorControl(state.monitorActive);
      },
    );
  }

  return {
    normalizeTrackedText,
    buildSystemInjectionSignature,
    hasSystemInstructionContent,
    normalizeCodeModeAutoContinueEnabled,
    setCodeModeAutoContinueDelaySeconds,
    setCodeModeAutoContinueEnabled,
    setSystemInjectionArmed,
    syncSystemInjectionArmState,
    markSystemInjectionApplied,
    getSystemInjectionStatusText,
    installPageUrlWatchers,
    loadSettings,
  };
}
