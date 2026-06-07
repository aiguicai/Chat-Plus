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
export const CODE_MODE_AUTO_CONTINUE_DELAY_STORAGE_KEY =
  "chat-plus-code-mode-auto-continue-delay-seconds";
export const CODE_MODE_RECENT_EXECUTION_TTL_MS = 45000;
export const CODE_MODE_MANUAL_RUN_TRIGGER_ATTR = "data-chat-plus-code-mode-run";
export const CODE_MODE_MANUAL_RUN_CARD_ATTR = "data-chat-plus-code-mode-card";
export const CODE_MODE_MANUAL_RUN_SOURCE_ATTR = "data-chat-plus-code-mode-source";
export const SYSTEM_INJECTION_WIDGET_ID = "chat-plus-system-injection-widget";
export const SYSTEM_INJECTION_WIDGET_POSITION_STORAGE_KEY =
  "chat-plus-system-injection-widget-position";

type CodeModeAutoContinueDelayRangeValue = {
  readonly __chatPlusAutoContinueDelayRange: true;
  readonly configText: string;
  readonly min: number;
  readonly max: number;
  valueOf: () => number;
  toString: () => string;
};

export type CodeModeAutoContinueDelayValue = number | CodeModeAutoContinueDelayRangeValue;

export type ParsedCodeModeAutoContinueDelayConfig =
  | {
      ok: true;
      mode: "fixed";
      text: string;
      seconds: number;
      min: number;
      max: number;
    }
  | {
      ok: true;
      mode: "range";
      text: string;
      seconds: number;
      min: number;
      max: number;
    }
  | {
      ok: false;
      error: string;
    };

const DEFAULT_AUTO_CONTINUE_DELAY_SECONDS = 5;
const DEFAULT_AUTO_CONTINUE_DELAY_TEXT = String(DEFAULT_AUTO_CONTINUE_DELAY_SECONDS);
const AUTO_CONTINUE_DELAY_STATUS_TEXT = "等待自动发送";
let lastValidAutoContinueDelayText = DEFAULT_AUTO_CONTINUE_DELAY_TEXT;
let lastResolvedAutoContinueDelayMs = DEFAULT_AUTO_CONTINUE_DELAY_SECONDS * 1000;
let lastResolvedAutoContinueDelayAt = 0;
let statusCountdownTimerId = 0;
let statusCountdownDeadline = 0;
let statusCountdownStartedAt = 0;
let statusCountdownDelayText = "";
let delayUiEnhancementsInstalled = false;
let activeRuntimeState: { codeMode: { detailText: string } } | null = null;

function formatDelayNumber(value: number) {
  if (!Number.isFinite(value)) return "";
  if (Number.isInteger(value)) return String(value);
  return String(Number.parseFloat(value.toFixed(3)));
}

function formatDelayMs(delayMs: number) {
  return formatDelayNumber(Math.max(0, delayMs) / 1000) || "0";
}

function formatElapsedClock(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function parseDelayNumber(value: unknown) {
  const normalized = String(value ?? "").trim();
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export function parseCodeModeAutoContinueDelayConfig(
  value: unknown,
): ParsedCodeModeAutoContinueDelayConfig {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      return { ok: false, error: "自动发送延迟必须大于等于 0" };
    }
    const seconds = Math.max(0, value);
    const text = formatDelayNumber(seconds) || DEFAULT_AUTO_CONTINUE_DELAY_TEXT;
    return { ok: true, mode: "fixed", text, seconds, min: seconds, max: seconds };
  }

  if (
    value &&
    typeof value === "object" &&
    (value as CodeModeAutoContinueDelayRangeValue).__chatPlusAutoContinueDelayRange
  ) {
    return parseCodeModeAutoContinueDelayConfig(
      (value as CodeModeAutoContinueDelayRangeValue).configText,
    );
  }

  const normalized = String(value ?? "").trim().replace(/，/g, ",");
  if (!normalized) {
    return { ok: false, error: "自动发送延迟不能为空" };
  }

  if (normalized.includes(",")) {
    const parts = normalized.split(",").map((part) => part.trim());
    if (parts.length !== 2) {
      return { ok: false, error: "随机延迟格式应为：最小秒数,最大秒数" };
    }

    const min = parseDelayNumber(parts[0]);
    const max = parseDelayNumber(parts[1]);
    if (min === null || max === null) {
      return { ok: false, error: "随机延迟只能填写数字" };
    }
    if (min >= max) {
      return { ok: false, error: "随机延迟必须满足第一个数小于第二个数" };
    }

    const text = `${formatDelayNumber(min)},${formatDelayNumber(max)}`;
    return { ok: true, mode: "range", text, seconds: min, min, max };
  }

  const seconds = parseDelayNumber(normalized);
  if (seconds === null) {
    return { ok: false, error: "自动发送延迟只能填写数字，或填写 5,9 这样的随机范围" };
  }

  const text = formatDelayNumber(seconds) || DEFAULT_AUTO_CONTINUE_DELAY_TEXT;
  return { ok: true, mode: "fixed", text, seconds, min: seconds, max: seconds };
}

function rememberResolvedAutoContinueDelay(seconds: number) {
  lastResolvedAutoContinueDelayMs = Math.max(0, seconds * 1000);
  lastResolvedAutoContinueDelayAt = Date.now();
  return seconds;
}

function shouldResolveRandomAutoContinueDelayFromStack() {
  try {
    const stack = String(new Error().stack || "");
    return stack.includes("getAutoContinueDelayMs") || stack.includes("waitForAutoContinueDelay");
  } catch {
    return false;
  }
}

function createAutoContinueDelayRangeValue(
  parsed: Extract<ParsedCodeModeAutoContinueDelayConfig, { ok: true; mode: "range" }>,
): CodeModeAutoContinueDelayRangeValue {
  return {
    __chatPlusAutoContinueDelayRange: true,
    configText: parsed.text,
    min: parsed.min,
    max: parsed.max,
    valueOf: () => {
      if (!shouldResolveRandomAutoContinueDelayFromStack()) {
        return parsed.min;
      }
      return rememberResolvedAutoContinueDelay(parsed.min + Math.random() * (parsed.max - parsed.min));
    },
    toString: () => parsed.text,
  };
}

function normalizeLastValidAutoContinueDelayConfig(): CodeModeAutoContinueDelayValue {
  const fallback = parseCodeModeAutoContinueDelayConfig(lastValidAutoContinueDelayText);
  if (!fallback.ok) return DEFAULT_AUTO_CONTINUE_DELAY_SECONDS;
  if (fallback.mode === "range") {
    return createAutoContinueDelayRangeValue(fallback);
  }
  return rememberResolvedAutoContinueDelay(fallback.seconds);
}

export function normalizeCodeModeAutoContinueDelaySeconds(
  value: unknown,
): CodeModeAutoContinueDelayValue {
  const parsed = parseCodeModeAutoContinueDelayConfig(value);
  if (!parsed.ok) {
    return normalizeLastValidAutoContinueDelayConfig();
  }

  lastValidAutoContinueDelayText = parsed.text;
  if (parsed.mode === "range") {
    return createAutoContinueDelayRangeValue(parsed);
  }

  return rememberResolvedAutoContinueDelay(parsed.seconds);
}

export function stringifyCodeModeAutoContinueDelayConfig(value: unknown) {
  const parsed = parseCodeModeAutoContinueDelayConfig(value);
  if (parsed.ok) return parsed.text;
  return lastValidAutoContinueDelayText;
}

function getStatusCountdownNodes() {
  if (typeof document === "undefined") return null;
  const root = document.getElementById(CODE_MODE_STATUS_BAR_ID) as HTMLDivElement | null;
  if (!root?.isConnected || root.style.display === "none") return null;
  const title = root.querySelector("[data-role='title']") as HTMLDivElement | null;
  const detail = root.querySelector("[data-role='detail']") as HTMLDivElement | null;
  if (!title || !detail) return null;
  if (String(title.textContent || "").trim() !== AUTO_CONTINUE_DELAY_STATUS_TEXT) return null;
  return { root, detail };
}

function clearStatusCountdownTimer() {
  if (statusCountdownTimerId) {
    window.clearTimeout(statusCountdownTimerId);
    statusCountdownTimerId = 0;
  }
}

function resetStatusCountdownState() {
  clearStatusCountdownTimer();
  statusCountdownDeadline = 0;
  statusCountdownStartedAt = 0;
  statusCountdownDelayText = "";
}

function getAutoContinueStatusCountdownDetailText(now = Date.now()) {
  if (!statusCountdownStartedAt || !statusCountdownDelayText) return "";
  const elapsedSeconds = Math.floor((now - statusCountdownStartedAt) / 1000);
  return `已生成续发内容，${statusCountdownDelayText} 秒后发送，已用时 ${formatElapsedClock(
    elapsedSeconds,
  )}`;
}

function renderAutoContinueStatusCountdownText(now = Date.now()) {
  const nodes = getStatusCountdownNodes();
  if (!nodes || !statusCountdownDeadline || !statusCountdownStartedAt) return false;
  const detailText = getAutoContinueStatusCountdownDetailText(now);
  if (!detailText) return false;
  if (activeRuntimeState?.codeMode) {
    activeRuntimeState.codeMode.detailText = detailText;
  }
  if (nodes.detail.textContent !== detailText) {
    nodes.detail.textContent = detailText;
  }
  nodes.detail.style.display = "block";
  return true;
}

function updateAutoContinueStatusCountdown() {
  if (!statusCountdownDeadline || !statusCountdownStartedAt) {
    resetStatusCountdownState();
    return;
  }

  const now = Date.now();
  const remainingMs = Math.max(0, statusCountdownDeadline - now);
  if (!renderAutoContinueStatusCountdownText(now)) {
    resetStatusCountdownState();
    return;
  }

  if (remainingMs <= 0) {
    resetStatusCountdownState();
    return;
  }

  clearStatusCountdownTimer();
  statusCountdownTimerId = window.setTimeout(updateAutoContinueStatusCountdown, 1000);
}

function resolveStatusCountdownDelayMs(detailText: string) {
  const hasFreshResolvedDelay = Date.now() - Number(lastResolvedAutoContinueDelayAt || 0) < 2500;
  if (hasFreshResolvedDelay) {
    return Math.max(0, lastResolvedAutoContinueDelayMs);
  }

  const parsed = parseCodeModeAutoContinueDelayConfig(lastValidAutoContinueDelayText);
  if (parsed.ok && parsed.mode === "fixed") {
    return Math.max(0, parsed.seconds * 1000);
  }

  const fallbackMatch = detailText.match(/([0-9]+(?:\.[0-9]+)?)\s*秒后发送/);
  return fallbackMatch ? Math.max(0, Number(fallbackMatch[1]) * 1000) : 0;
}

function maybeStartAutoContinueStatusCountdown() {
  if (statusCountdownTimerId) {
    renderAutoContinueStatusCountdownText();
    return;
  }
  const nodes = getStatusCountdownNodes();
  if (!nodes) return;
  const detailText = String(nodes.detail.textContent || "");
  if (!detailText.includes("已生成续发内容") || !detailText.includes("秒后发送")) return;

  const delayMs = resolveStatusCountdownDelayMs(detailText);
  if (!Number.isFinite(delayMs) || delayMs <= 0) return;

  statusCountdownStartedAt = Date.now();
  statusCountdownDeadline = statusCountdownStartedAt + delayMs;
  statusCountdownDelayText = formatDelayMs(delayMs);
  updateAutoContinueStatusCountdown();
}

function normalizeAutoContinueDelayInputElement(input: HTMLInputElement) {
  const parsed = parseCodeModeAutoContinueDelayConfig(input.value);
  if (parsed.ok) {
    lastValidAutoContinueDelayText = parsed.text;
    input.value = parsed.text;
    input.title = "固定延迟：5；随机延迟：5,9。随机范围必须满足第一个数小于第二个数。";
    return true;
  }

  input.value = lastValidAutoContinueDelayText;
  input.title = `${parsed.error}。已恢复为上一次有效设置：${lastValidAutoContinueDelayText}`;
  return false;
}

function syncAutoContinueDelayInputElement(input: HTMLInputElement) {
  if (input.type !== "text") input.type = "text";
  input.inputMode = "decimal";
  input.removeAttribute("step");
  input.setAttribute("pattern", "[0-9]+([.][0-9]+)?([,，][0-9]+([.][0-9]+)?)?");
  input.setAttribute("aria-label", "自动发送延迟，支持固定秒数或随机范围");
  input.title = "固定延迟：5；随机延迟：5,9。随机范围必须满足第一个数小于第二个数。";

  if (input.dataset.chatPlusDelayConfigBound !== "1") {
    input.dataset.chatPlusDelayConfigBound = "1";
    input.addEventListener(
      "blur",
      () => {
        normalizeAutoContinueDelayInputElement(input);
      },
      true,
    );
    input.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Enter") return;
        normalizeAutoContinueDelayInputElement(input);
      },
      true,
    );
  }

  if (document.activeElement !== input && input.value !== lastValidAutoContinueDelayText) {
    input.value = lastValidAutoContinueDelayText;
  }
}

function syncAutoContinueDelayUi() {
  if (typeof document === "undefined") return;
  document
    .querySelectorAll<HTMLInputElement>(
      `#${SYSTEM_INJECTION_WIDGET_ID} [data-role='auto-continue-delay-input']`,
    )
    .forEach(syncAutoContinueDelayInputElement);
  maybeStartAutoContinueStatusCountdown();
}

function installAutoContinueDelayUiEnhancements() {
  if (delayUiEnhancementsInstalled) return;
  if (typeof window === "undefined" || typeof document === "undefined") return;
  delayUiEnhancementsInstalled = true;

  const start = () => {
    syncAutoContinueDelayUi();
    const observer = new MutationObserver(syncAutoContinueDelayUi);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    window.setInterval(syncAutoContinueDelayUi, 400);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}

installAutoContinueDelayUiEnhancements();

export function createContentRuntimeState() {
  const state = {
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
      responseContentPreview: "",
      updatedAt: 0,
      responseUpdatedAt: 0,
    },
    pageContext: {
      lastUrl: location.href,
      urlWatchTimerId: 0,
      expectedAssistantTurn: false,
      expectedAssistantTurnAt: 0,
      expectedAssistantTurnSource: "" as "" | "user" | "auto",
    },
    scheduledSend: {
      config: null as null | {
        enabled: boolean;
        content: string;
        startTime: string;
        endTime: string;
        intervalSeconds: number;
        createdAt: number;
        updatedAt: number;
      },
      enabledAt: 0,
      lastRunAt: 0,
      nextRunAt: 0,
      timerId: 0,
      running: false,
      lastError: "",
    },
    systemInjectionWidget: {
      root: null as HTMLDivElement | null,
      panel: null as HTMLDivElement | null,
      ball: null as HTMLDivElement | null,
      dragHandle: null as HTMLDivElement | null,
      collapseButton: null as HTMLButtonElement | null,
      autoContinueToggle: null as HTMLButtonElement | null,
      autoContinueThumb: null as HTMLSpanElement | null,
      autoContinueDelayInput: null as HTMLInputElement | null,
      nextSendToggle: null as HTMLButtonElement | null,
      nextSendThumb: null as HTMLSpanElement | null,
      scheduledSendToggle: null as HTMLButtonElement | null,
      scheduledSendThumb: null as HTMLSpanElement | null,
      scheduledSendMeta: null as HTMLSpanElement | null,
      compressButton: null as HTMLButtonElement | null,
      compressButtonLabel: null as HTMLSpanElement | null,
      compressButtonMeta: null as HTMLSpanElement | null,
      scheduledSendTickerTimerId: 0,
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
      autoContinueDelaySeconds: normalizeCodeModeAutoContinueDelaySeconds(5),
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
  activeRuntimeState = state;
  return state;
}

export type ContentRuntimeState = ReturnType<typeof createContentRuntimeState>;
