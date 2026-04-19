import {
  MCP_CONFIG_STORAGE_KEY,
  MCP_DISCOVERED_TOOLS_STORAGE_KEY,
  MCP_ENABLED_TOOLS_STORAGE_KEY,
  MCP_SITE_ENABLED_TOOLS_STORAGE_KEY,
  MCP_TAB_ENABLED_TOOLS_STORAGE_KEY,
} from "../mcp/shared";
import {
  SYSTEM_INSTRUCTION_PRESETS_STORAGE_KEY,
  SYSTEM_INSTRUCTION_SITE_SELECTION_STORAGE_KEY,
  SYSTEM_INSTRUCTION_TAB_SELECTION_STORAGE_KEY,
} from "../system-instructions/shared";
import {
  CHAT_PLUS_PROTOCOL,
  extractWrappedChatPlusBlock,
  wrapChatPlusInjection,
  wrapChatPlusToolResult,
} from "../shared/chatplus-protocol";
import { SITE_CONFIG_MAP_STORAGE_KEY } from "../sidepanel/lib/siteConfig";
import {
  ADAPTER_HOOK_REQUEST_EVENT,
  ADAPTER_HOOK_RESPONSE_EVENT,
  CODE_MODE_AUTO_CONTINUE_STORAGE_KEY,
  CODE_MODE_AUTO_CONTINUE_DELAY_STORAGE_KEY,
  CODE_MODE_MANUAL_RUN_CARD_ATTR,
  CODE_MODE_MANUAL_RUN_SOURCE_ATTR,
  CODE_MODE_MANUAL_RUN_TRIGGER_ATTR,
  CODE_MODE_RECENT_EXECUTION_TTL_MS,
  MONITOR_CONTROL_EVENT,
  MONITOR_RESULT_EVENT,
  createContentRuntimeState,
} from "./runtime/contentRuntimeState";
import { createCodeModeStatusController } from "./runtime/codeModeStatus";
import { createSystemInjectionTrackingController } from "./runtime/systemInjectionTracking";
import { createSystemInjectionWidgetController } from "./runtime/systemInjectionWidget";
import { createAdapterSandboxController } from "./runtime/adapterSandbox";
import { createContinuationController } from "./runtime/continuation";
import {
  clearExpectedAssistantTurn,
  markExpectedAssistantTurn,
  shouldAutoExecuteAssistantCodeMode,
} from "./runtime/assistantTurn";

(() => {
  "use strict";

  if (location.protocol === "chrome-extension:" || location.protocol === "moz-extension:") {
    return;
  }

  if (window.__chatPlusContentBridgeInstalled) return;
  window.__chatPlusContentBridgeInstalled = true;

  const state = createContentRuntimeState();
  let continuationController: ReturnType<typeof createContinuationController>;
  let adapterSandboxController: ReturnType<typeof createAdapterSandboxController>;
  let systemInjectionWidgetController: ReturnType<typeof createSystemInjectionWidgetController>;

  function stringifyError(error: unknown) {
    if (error instanceof Error) {
      return error.stack || error.message || String(error);
    }
    return String(error || "unknown error");
  }

  function logAdapterSandboxError(scope: string, error: unknown) {
    const message = stringifyError(error);
    const key = `${scope}:${state.adapterScript}:${message}`;
    if (state.adapterSandbox.lastLoggedErrorKey === key) return;
    state.adapterSandbox.lastLoggedErrorKey = key;
  }

  function logMonitorResultDebug(detail: Record<string, unknown>) {
    if (!String(state.adapterScript || "").trim()) return;

    const source = String(detail?.source || "").trim() || "unknown";
    const endpoint = String(detail?.endpoint || "").trim();
    const status = String(detail?.status ?? "").trim();
    const responseFinal = detail?.responseFinal === true;
    const matched = detail?.matched === true;
    if (!matched || !responseFinal) return;
    const matchScore =
      typeof detail?.matchScore === "number" ? Number(detail.matchScore) : null;
    const responseContentPath = String(detail?.responseContentPath || "").trim();
    const rawResponseContentPreview = String(detail?.responseContentPreview || "").trim();
    const rawResponsePreview = String(detail?.responsePreview || detail?.previewText || "").trim();
    const effectiveResponseText = rawResponseContentPreview || rawResponsePreview;
    const codeModeBeginToken = String(state.protocol?.codeMode?.begin || "").trim();
    const codeModeEndToken = String(state.protocol?.codeMode?.end || "").trim();
    const responseContentHasCodeModeBegin = codeModeBeginToken
      ? rawResponseContentPreview.includes(codeModeBeginToken)
      : false;
    const responseContentHasCodeModeEnd = codeModeEndToken
      ? rawResponseContentPreview.includes(codeModeEndToken)
      : false;
    const responsePreviewHasCodeModeBegin = codeModeBeginToken
      ? rawResponsePreview.includes(codeModeBeginToken)
      : false;
    const responsePreviewHasCodeModeEnd = codeModeEndToken
      ? rawResponsePreview.includes(codeModeEndToken)
      : false;
    const codeModeBlockDetected = Boolean(extractCodeModeBlock(effectiveResponseText));
    const responseContentPreview = rawResponseContentPreview;
    const responsePreview = rawResponsePreview;

    if (!endpoint && !responseContentPreview && !responsePreview) return;

    const logKey = JSON.stringify({
      source,
      endpoint,
      status,
      responseFinal,
      matched,
      matchScore,
      responseContentPath,
      responseContentLength: rawResponseContentPreview.length,
      responsePreviewLength: rawResponsePreview.length,
      responseContentHasCodeModeBegin,
      responseContentHasCodeModeEnd,
      responsePreviewHasCodeModeBegin,
      responsePreviewHasCodeModeEnd,
      codeModeBlockDetected,
      responseContentPreview,
      responsePreview,
    });
    if (state.lastMonitorDebugLogKey === logKey) return;
    state.lastMonitorDebugLogKey = logKey;
    console.log("[Chat Plus][Monitor]", {
      source,
      endpoint,
      status: status || "(unknown)",
      responseFinal,
      matched,
      matchScore,
      responseContentPath,
      responseContentLength: rawResponseContentPreview.length,
      responsePreviewLength: rawResponsePreview.length,
      responseContentHasCodeModeBegin,
      responseContentHasCodeModeEnd,
      responsePreviewHasCodeModeBegin,
      responsePreviewHasCodeModeEnd,
      codeModeBlockDetected,
      responseContentPreview: responseContentPreview || "(empty)",
      responsePreview,
      payload: detail,
    });
  }

  function isPluginRuntimeEnabled() {
    return state.isEnabled !== false && state.isTabEnabled !== false;
  }

  function shouldShowSystemInjectionWidget() {
    if (window.top !== window) return false;
    if (!isPluginRuntimeEnabled()) return false;
    return Boolean(String(state.adapterScript || "").trim());
  }

  function notifyExtension(message: Record<string, unknown>) {
    if (!chrome?.runtime?.id) return;
    try {
      const result = chrome.runtime.sendMessage(message);
      if (result && typeof (result as Promise<unknown>).then === "function") {
        (result as Promise<unknown>).catch(() => {});
      }
    } catch {
      // Allow silent failure during navigation or extension reload.
    }
  }

  function updateRequestInjection() {
    if (!isPluginRuntimeEnabled()) {
      state.requestInjectionText = "";
      state.requestInjectionMode = "system";
      return;
    }

    const systemInstructionContent = String(state.systemInstructionContent || "").trim();
    const pendingToolResultText = state.codeMode.autoContinueInFlight
      ? ""
      : String(state.codeMode.pendingToolResultText || "").trim();
    const systemInjectionText =
      systemInstructionContent && state.systemInjection.armed
        ? wrapChatPlusInjection(systemInstructionContent)
        : "";

    if (state.codeMode.autoContinueInFlight) {
      state.requestInjectionText = systemInjectionText;
      state.requestInjectionMode = "raw";
      return;
    }

    state.requestInjectionText = [systemInjectionText, pendingToolResultText]
      .filter(Boolean)
      .join("\n\n")
      .trim();
    state.requestInjectionMode = "raw";
  }

  function dispatchMonitorControl(active = state.monitorActive) {
    const runtimeEnabled = isPluginRuntimeEnabled();
    document.dispatchEvent(
      new CustomEvent(MONITOR_CONTROL_EVENT, {
        detail: JSON.stringify({
          active: runtimeEnabled && Boolean(active),
          enabled: runtimeEnabled,
          requestInjectionText: runtimeEnabled ? state.requestInjectionText || "" : "",
          requestInjectionMode: state.requestInjectionMode || "system",
          adapterScript: runtimeEnabled ? state.adapterScript || "" : "",
          protocol: state.protocol,
        }),
      }),
    );
  }

  function getCurrentContext() {
    return {
      host: location.hostname || "",
      title: document.title || "",
      url: location.href,
      frameId: 0,
      isTopFrame: window.top === window,
      monitorReady: state.monitorReady,
      monitorActive: isPluginRuntimeEnabled() && state.monitorActive,
    };
  }
  function renderSystemInjectionWidget() {
    systemInjectionWidgetController.renderSystemInjectionWidget();
  }

  function markExpectedAssistantReply(source: "user" | "auto") {
    markExpectedAssistantTurn(state, source);
  }

  async function sendContextCompressionRequest() {
    if (state.codeMode.running) {
      return {
        ok: false as const,
        error: "当前有 Code Mode 在运行，请等它完成后再压缩",
      };
    }
    if (state.codeMode.autoContinueInFlight) {
      return {
        ok: false as const,
        error: "模型正在继续响应，请稍后再发起压缩",
      };
    }
    return continuationController.requestContextCompression();
  }

  function syncRequestInjectionToMonitor() {
    updateRequestInjection();
    renderSystemInjectionWidget();
    dispatchMonitorControl(state.monitorActive);
  }

  function clearPluginRuntimeEffects() {
    const activeRunId = Number(state.codeMode.activeRunId || 0);
    if (activeRunId) {
      state.codeMode.cancelledRunIds.add(activeRunId);
      codeModeStatusController.scheduleCancelledCodeModeCleanup(activeRunId);
      adapterSandboxController.postSandboxWindowMessage({
        type: "cancel-code-mode",
        runId: activeRunId,
      });
    }

    continuationController.clearBubbleDecorationTimer();
    if (state.bubbleDecorationObserver) {
      state.bubbleDecorationObserver.disconnect();
      state.bubbleDecorationObserver = null;
    }
    continuationController.clearAutoContinueFallbackTimer();
    codeModeStatusController.clearCodeModeElapsedTimer();
    codeModeStatusController.clearCodeModeNoticeTimer();
    adapterSandboxController.rejectPendingSandboxRequests("Chat Plus 已停用");

    state.codeMode.running = false;
    state.codeMode.activeRunId = 0;
    state.codeMode.activeToolLabel = "";
    state.codeMode.activeToolPendingCount = 0;
    state.codeMode.statusText = "";
    state.codeMode.detailText = "";
    state.codeMode.statusTone = "idle";
    state.codeMode.runStartedAt = 0;
    state.codeMode.pendingToolResultText = "";
    state.codeMode.manualPreparedToolResultText = "";
    state.codeMode.autoContinueInFlight = false;
    state.manualDomInjection.active = false;
    state.manualDomInjection.injectionText = "";
    state.manualDomInjection.injectionMode = "system";
    state.manualDomInjection.preparedAt = 0;
    state.bubbleDecorationFallback.requestMessagePreview = "";
    state.bubbleDecorationFallback.responseContentPreview = "";
    state.bubbleDecorationFallback.updatedAt = 0;
    state.bubbleDecorationFallback.responseUpdatedAt = 0;
    if (state.systemInjectionWidget.compressCooldownTimerId) {
      window.clearTimeout(state.systemInjectionWidget.compressCooldownTimerId);
      state.systemInjectionWidget.compressCooldownTimerId = 0;
    }
    state.systemInjectionWidget.compressCooldownUntil = 0;
    state.systemInjectionWidget.compressRequestRunning = false;
    state.systemInjectionWidget.compressRequestStatus = "idle";
    state.systemInjectionWidget.compressRequestMessage = "";
    clearExpectedAssistantTurn(state);

    updateRequestInjection();
    renderSystemInjectionWidget();
    codeModeStatusController.renderCodeModeStatusBar();
  }

  const codeModeStatusController = createCodeModeStatusController({
    state,
    isPluginRuntimeEnabled,
    postSandboxWindowMessage: (payload) => adapterSandboxController.postSandboxWindowMessage(payload),
    completeAutoContinueCycle: (clearPendingToolResult = true) =>
      continuationController.completeAutoContinueCycle(clearPendingToolResult),
  });

  const systemInjectionTrackingController = createSystemInjectionTrackingController({
    state,
    isPluginRuntimeEnabled,
    updateRequestInjection,
    dispatchMonitorControl,
    renderSystemInjectionWidget: () => renderSystemInjectionWidget(),
    renderCodeModeStatusBar: () => codeModeStatusController.renderCodeModeStatusBar(),
    syncBubbleDecorationObserver: () => continuationController.syncBubbleDecorationObserver(),
    clearPluginRuntimeEffects,
  });

  systemInjectionWidgetController = createSystemInjectionWidgetController({
    state,
    shouldShowSystemInjectionWidget,
    setCodeModeAutoContinueEnabled:
      systemInjectionTrackingController.setCodeModeAutoContinueEnabled,
    setCodeModeAutoContinueDelaySeconds:
      systemInjectionTrackingController.setCodeModeAutoContinueDelaySeconds,
    setSystemInjectionArmed: systemInjectionTrackingController.setSystemInjectionArmed,
    getSystemInjectionStatusText: systemInjectionTrackingController.getSystemInjectionStatusText,
    syncRequestInjectionToMonitor,
    sendContextCompressionRequest,
  });

  adapterSandboxController = createAdapterSandboxController({
    state,
    isPluginRuntimeEnabled,
    stringifyError,
    logAdapterSandboxError,
    updateCodeModeToolProgress: codeModeStatusController.updateCodeModeToolProgress,
    isCodeModeRunCancelled: codeModeStatusController.isCodeModeRunCancelled,
  });

  continuationController = createContinuationController({
    state,
    isPluginRuntimeEnabled,
    stringifyError,
    logAdapterSandboxError,
    executeAdapterHookInSandbox:
      adapterSandboxController.executeAdapterHookInSandbox,
    syncRequestInjectionToMonitor,
    renderCodeModeStatusBar: codeModeStatusController.renderCodeModeStatusBar,
    markExpectedAssistantTurn: markExpectedAssistantReply,
  });

  function setAdapterScript(scriptText: string) {
    const normalized = String(scriptText || "").trim();
    state.adapterScript = normalized;
    state.adapterSandbox.lastLoggedErrorKey = "";
    continuationController.syncBubbleDecorationObserver();
    renderSystemInjectionWidget();
    codeModeStatusController.renderCodeModeStatusBar();

    if (normalized && isPluginRuntimeEnabled()) {
      void adapterSandboxController.ensureAdapterSandboxFrame().catch((error) => {
        logAdapterSandboxError("adapter sandbox init", error);
      });
    }
  }

  function applySystemInstructionSource({
    content,
    adapterScript,
    codeModeManifest,
    protocol,
    tabPluginEnabled,
  }: {
    content?: string;
    adapterScript?: string;
    codeModeManifest?: Record<string, unknown>;
    protocol?: Record<string, unknown>;
    tabPluginEnabled?: boolean;
  }) {
    const previousRuntimeEnabled = isPluginRuntimeEnabled();
    const nextContent = String(content || "").trim();
    const nextCodeModeManifest =
      codeModeManifest && typeof codeModeManifest === "object"
        ? {
            ...(codeModeManifest as Record<string, unknown>),
            servers: Array.isArray((codeModeManifest as Record<string, unknown>).servers)
              ? ((codeModeManifest as Record<string, unknown>).servers as Array<Record<string, unknown>>)
              : [],
            docs: Array.isArray((codeModeManifest as Record<string, unknown>).docs)
              ? ((codeModeManifest as Record<string, unknown>).docs as Array<Record<string, unknown>>)
              : [],
          }
        : state.codeModeManifest;
    const nextInjectionSignature = systemInjectionTrackingController.buildSystemInjectionSignature(
      nextContent,
      nextCodeModeManifest,
    );

    state.systemInstructionContent = nextContent;
    state.codeModeManifest = nextCodeModeManifest;
    state.protocol =
      protocol && typeof protocol === "object"
        ? ({ ...CHAT_PLUS_PROTOCOL, ...protocol } as typeof CHAT_PLUS_PROTOCOL)
        : CHAT_PLUS_PROTOCOL;
    state.isTabEnabled = tabPluginEnabled !== false;
    state.systemInjection.currentSignature = nextInjectionSignature;
    systemInjectionTrackingController.syncSystemInjectionArmState();
    setAdapterScript(String(adapterScript || "").trim());
    if (previousRuntimeEnabled && !isPluginRuntimeEnabled()) {
      clearPluginRuntimeEffects();
    }
    syncRequestInjectionToMonitor();
  }

  function createExecutionKey(code: string) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < code.length; index += 1) {
      hash ^= code.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return `code-${(hash >>> 0).toString(16)}`;
  }

  function pruneRecentCodeModeExecutionKeys(now = Date.now()) {
    state.codeMode.recentExecutionKeys.forEach((executedAt, key) => {
      if (now - Number(executedAt || 0) < CODE_MODE_RECENT_EXECUTION_TTL_MS) return;
      state.codeMode.recentExecutionKeys.delete(key);
    });
  }

  function buildCodeModeExecutionKey(code: string, detail: Record<string, unknown>) {
    const source = String(detail?.source || "").trim();
    const endpoint = String(detail?.endpoint || detail?.url || "").trim();
    const requestText =
      String(detail?.requestMessagePreview || "").trim() ||
      String(detail?.requestPreview || "").trim() ||
      String(detail?.requestText || "").trim();
    const scopeSeed = [source, endpoint, requestText].filter(Boolean).join("\n");
    const scopeKey =
      scopeSeed
        ? createExecutionKey(scopeSeed)
        : String(detail?.id || detail?.observedAt || "").trim() || "anonymous";
    return `${createExecutionKey(code)}:${scopeKey}`;
  }
  function wasCodeModeExecutionSeen(executionKey: string, now = Date.now()) {
    if (!executionKey) return false;
    pruneRecentCodeModeExecutionKeys(now);
    const executedAt = state.codeMode.recentExecutionKeys.get(executionKey);
    if (!executedAt) return false;
    return now - executedAt < CODE_MODE_RECENT_EXECUTION_TTL_MS;
  }

  function rememberCodeModeExecution(executionKey: string, now = Date.now()) {
    if (!executionKey) return;
    pruneRecentCodeModeExecutionKeys(now);
    state.codeMode.recentExecutionKeys.set(executionKey, now);
  }

  function extractCodeModeBlock(text: unknown) {
    const source = String(text || "").replace(/\r\n?/g, "\n");
    const beginToken = String(state.protocol?.codeMode?.begin || "").trim();
    const endToken = String(state.protocol?.codeMode?.end || "").trim();
    if (!source || !beginToken || !endToken) return "";

    const escapedBegin = beginToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedEnd = endToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const strictPattern = new RegExp(
      `(?:^|\\n)\\s*${escapedBegin}\\s*\\n([\\s\\S]*?)\\n\\s*${escapedEnd}(?=\\s*(?:\\n|$))`,
    );
    const strictMatch = source.match(strictPattern);
    if (strictMatch?.[1]) {
      return strictMatch[1].trim();
    }

    const fallback = extractWrappedChatPlusBlock(source, beginToken, endToken).trim();
    if (!fallback) return "";

    if (
      !/[\n;=(){}[\].]/.test(fallback) &&
      !/\b(await|const|let|return|if|for|Promise|JSON|Object|Array|Math)\b/.test(fallback)
    ) {
      return "";
    }

    return fallback;
  }

  function hasWrappedSystemInjection(text: unknown) {
    const source = String(text || "");
    const beginToken = String(state.protocol?.injection?.begin || "").trim();
    const endToken = String(state.protocol?.injection?.end || "").trim();
    return Boolean(source && beginToken && endToken && source.includes(beginToken) && source.includes(endToken));
  }

  function readWrappedSystemInjectionSignature(text: unknown) {
    const source = String(text || "");
    const beginToken = String(state.protocol?.injection?.begin || "").trim();
    const endToken = String(state.protocol?.injection?.end || "").trim();
    if (!source || !beginToken || !endToken) return "";

    const beginIndex = source.indexOf(beginToken);
    if (beginIndex < 0) return "";
    const endIndex = source.indexOf(endToken, beginIndex + beginToken.length);
    if (endIndex < 0) return "";
    return source.slice(beginIndex, endIndex + endToken.length).trim();
  }

  function rememberBubbleDecorationRequestPreview(value: unknown) {
    const normalized = String(value ?? "").replace(/\r\n?/g, "\n").trim();
    if (!normalized) return;
    state.bubbleDecorationFallback.requestMessagePreview = normalized;
    state.bubbleDecorationFallback.updatedAt = Date.now();
  }

  function rememberBubbleDecorationResponsePreview(value: unknown) {
    const normalized = String(value ?? "").replace(/\r\n?/g, "\n").trim();
    if (!normalized) return;
    state.bubbleDecorationFallback.responseContentPreview = normalized;
    state.bubbleDecorationFallback.responseUpdatedAt = Date.now();
  }

  function clearBubbleDecorationResponsePreview() {
    state.bubbleDecorationFallback.responseContentPreview = "";
    state.bubbleDecorationFallback.responseUpdatedAt = 0;
  }

  function buildCodeModeFeedbackText(response: Record<string, unknown> | null | undefined) {
    const feedback =
      String(response?.resultText || "").trim() ||
      String(response?.error || "").trim() ||
      "Chat Plus Code Mode 执行失败";
    return feedback.trim();
  }

  function showCodeModeStatusNotice(
    statusText: string,
    detailText = "",
    tone: "running" | "success" | "error" | "cancelled" = "error",
    delayMs = 2200,
  ) {
    codeModeStatusController.showCodeModeStatusNotice(statusText, detailText, tone, delayMs);
  }

  async function executeCodeModeRun(
    code: string,
    options?: {
      executionKey?: string;
    },
  ) {
    const normalizedCode = String(code || "").trim();
    if (!normalizedCode) {
      showCodeModeStatusNotice("无法运行 Code Mode", "没有读到可执行代码");
      return { ok: false as const, error: "没有读到可执行代码" };
    }
    if (!isPluginRuntimeEnabled()) {
      return { ok: false as const, error: "当前页面已关闭 Chat Plus" };
    }
    if (state.codeMode.running) {
      return { ok: false as const, error: "当前已有 Code Mode 在运行" };
    }
    if (state.codeMode.autoContinueInFlight) {
      showCodeModeStatusNotice("模型正在继续响应", "请等当前自动续发完成后再手动运行", "running");
      return { ok: false as const, error: "当前正在等待自动续发完成" };
    }

    const executionKey = String(options?.executionKey || "").trim();
    const runId = ++state.codeMode.runSequence;
    codeModeStatusController.beginCodeModeRun(runId);
    try {
      const response = await adapterSandboxController.executeCodeModeScriptInSandbox(normalizedCode, runId);
      if (codeModeStatusController.isCodeModeRunCancelled(runId)) {
        return { ok: false as const, error: "执行已取消" };
      }

      const isSuccess = response?.ok === true;
      const feedbackText = isSuccess
        ? String(response?.resultText || "").trim()
        : buildCodeModeFeedbackText(response);
      const toolResultText = wrapChatPlusToolResult(feedbackText);
      const autoContinueResult = await continuationController.continueConversationWithToolResult(
        toolResultText,
      );
      const autoContinued = autoContinueResult.ok === true;
      const continuationDelivery = autoContinued
        ? String((autoContinueResult as { delivery?: string }).delivery || "sent")
        : "";
      const autoContinueError = autoContinued
        ? ""
        : String(autoContinueResult.error || "自动续发失败");
      const autoContinueDetailText =
        continuationDelivery === "filled"
          ? isSuccess
            ? "工具结果已填入输入框，等待你手动发送"
            : "错误结果已填入输入框，等待你手动发送"
          : isSuccess
            ? "工具结果已自动发送"
            : "错误结果已自动发送";
      const autoContinueFailureDetailText = isSuccess
        ? `工具执行完成，但自动续发失败：${autoContinueError}`
        : `工具执行失败，且自动续发失败：${autoContinueError}`;

      if (executionKey) {
        state.codeMode.lastExecutionKey = executionKey;
      }
      if (!response?.ok) {
        if (autoContinued && continuationDelivery !== "filled") {
          codeModeStatusController.enterAutoContinueWaitingState("错误结果已发送");
          return { ok: false as const, error: String(response?.error || "工具执行失败") };
        }
        codeModeStatusController.finishCodeModeRun(
          runId,
          "error",
          autoContinued ? autoContinueDetailText : autoContinueFailureDetailText,
        );
        return { ok: false as const, error: String(response?.error || "工具执行失败") };
      }

      if (autoContinued && continuationDelivery !== "filled") {
        codeModeStatusController.enterAutoContinueWaitingState("工具结果已发送");
        return { ok: true as const, delivery: continuationDelivery || "sent" };
      }

      codeModeStatusController.finishCodeModeRun(
        runId,
        autoContinued ? "success" : "error",
        autoContinued ? autoContinueDetailText : autoContinueFailureDetailText,
      );
      if (autoContinued) {
        return {
          ok: true as const,
          delivery: continuationDelivery || "filled",
        };
      }
      return {
        ok: false as const,
        delivery: "pending",
        error: autoContinueError,
      };
    } catch (error) {
      if (codeModeStatusController.isCodeModeRunCancelled(runId)) {
        return { ok: false as const, error: "执行已取消" };
      }
      if (executionKey) {
        state.codeMode.lastExecutionKey = executionKey;
      }
      const toolResultText = wrapChatPlusToolResult(
        [
          "Chat Plus Code Mode 执行失败",
          "阶段: runtime",
          `错误: ${stringifyError(error)}`,
        ].join("\n"),
      );
      const autoContinueResult = await continuationController.continueConversationWithToolResult(
        toolResultText,
      );
      const autoContinued = autoContinueResult.ok === true;
      const continuationDelivery = autoContinued
        ? String((autoContinueResult as { delivery?: string }).delivery || "sent")
        : "";
      const autoContinueError = autoContinued
        ? ""
        : String(autoContinueResult.error || "自动续发失败");

      if (autoContinued && continuationDelivery !== "filled") {
        codeModeStatusController.enterAutoContinueWaitingState("错误结果已发送");
        return { ok: false as const, error: stringifyError(error) };
      }

      codeModeStatusController.finishCodeModeRun(
        runId,
        autoContinued ? "success" : "error",
        autoContinued
          ? "错误结果已填入输入框，等待你手动发送"
          : `工具执行失败，且自动续发失败：${autoContinueError}`,
      );
      return { ok: false as const, error: stringifyError(error) };
    }
  }

  function readManualCodeModeSource(trigger: Element | null) {
    if (!(trigger instanceof Element)) return "";
    const card = trigger.closest(`[${CODE_MODE_MANUAL_RUN_CARD_ATTR}="1"]`);
    if (!(card instanceof Element)) return "";
    const source = card.querySelector(`[${CODE_MODE_MANUAL_RUN_SOURCE_ATTR}="1"]`);
    if (!(source instanceof HTMLElement)) return "";
    return String(
      source.getAttribute("data-chat-plus-code-mode-raw") || source.textContent || "",
    ).trim();
  }
  function isCodeModeRunCancelled(runId: number) {
    return codeModeStatusController.isCodeModeRunCancelled(runId);
  }

  function updateCodeModeToolProgress(runId: number, toolLabel: string, delta: number) {
    codeModeStatusController.updateCodeModeToolProgress(runId, toolLabel, delta);
  }

  function renderCodeModeStatusBar() {
    codeModeStatusController.renderCodeModeStatusBar();
  }

  function postSandboxWindowMessage(payload: Record<string, unknown>) {
    return adapterSandboxController.postSandboxWindowMessage(payload);
  }

  function rejectPendingSandboxRequests(reason: string) {
    adapterSandboxController.rejectPendingSandboxRequests(reason);
  }

  async function executeAdapterHookInSandbox(
    hookName:
      | "transformRequest"
      | "extractResponse"
      | "decorateBubbles"
      | "continueConversation",
    payload?: Record<string, unknown>,
    options?: {
      snapshotHtml?: string;
      timeoutMs?: number;
    },
  ) {
    return adapterSandboxController.executeAdapterHookInSandbox(hookName, payload, options);
  }

  function completeAutoContinueCycle(clearPendingToolResult = true) {
    continuationController.completeAutoContinueCycle(clearPendingToolResult);
  }

  function syncBubbleDecorationObserver() {
    continuationController.syncBubbleDecorationObserver();
  }

  async function handleManualCodeModeRun(trigger: Element) {
    const code = readManualCodeModeSource(trigger);
    if (!code) {
      showCodeModeStatusNotice("无法运行 Code Mode", "卡片里没有可执行代码");
      return;
    }

    if (state.codeMode.running) {
      showCodeModeStatusNotice("工具仍在运行", "请等待当前 Code Mode 执行完成", "running");
      return;
    }

    await executeCodeModeRun(code);
  }

  async function executeAssistantCodeModeIfNeeded(
    detail: Record<string, unknown>,
    options?: { allowAutoExecute?: boolean },
  ) {
    if (!isPluginRuntimeEnabled()) return;
    if (options?.allowAutoExecute === false) return;
    const responseText =
      String(detail?.responseContentPreview || "").trim() ||
      String(detail?.responsePreview || "").trim();
    if (!responseText) return;

    const code = extractCodeModeBlock(responseText);
    if (!code) return;

    const executionKey = buildCodeModeExecutionKey(code, detail);
    if (
      state.codeMode.running ||
      state.codeMode.lastExecutionKey === executionKey ||
      wasCodeModeExecutionSeen(executionKey)
    ) {
      return;
    }
    rememberCodeModeExecution(executionKey);
    await executeCodeModeRun(code, { executionKey });
  }

  function parseMonitorDetail(detail: unknown) {
    if (!detail) return null;

    try {
      return typeof detail === "string" ? JSON.parse(detail) : detail;
    } catch {
      return null;
    }
  }

  function maybeConfirmPendingSystemInjectionFromResult(detail: Record<string, unknown>) {
    if (!isPluginRuntimeEnabled()) return;
    if (!state.systemInjection.armed) return;

    const expectedInstruction = systemInjectionTrackingController.normalizeTrackedText(
      state.systemInstructionContent,
    );
    if (!expectedInstruction) return;

    const requestPreview = systemInjectionTrackingController.normalizeTrackedText(
      detail?.requestMessagePreview || detail?.requestPreview || detail?.requestText,
    );
    if (!requestPreview) return;

    const beginToken = String(state.protocol?.injection?.begin || "").trim();
    const endToken = String(state.protocol?.injection?.end || "").trim();
    const hasWrappedInjection = Boolean(
      beginToken && endToken && requestPreview.includes(beginToken) && requestPreview.includes(endToken),
    );
    const hasExpectedInstruction = requestPreview.includes(expectedInstruction);
    if (!hasWrappedInjection && !hasExpectedInstruction) return;

    systemInjectionTrackingController.markSystemInjectionApplied(
      readWrappedSystemInjectionSignature(requestPreview),
    );
    syncRequestInjectionToMonitor();
    renderSystemInjectionWidget();
  }

  function maybeConfirmPendingManualDomInjectionFromResult(detail: Record<string, unknown>) {
    if (!isPluginRuntimeEnabled()) return;
    if (!state.manualDomInjection.active) return;

    const preparedText = systemInjectionTrackingController.normalizeTrackedText(
      state.manualDomInjection.injectionText,
    );
    if (!preparedText) {
      continuationController.resetManualDomInjectionState();
      return;
    }

    const requestPreview = systemInjectionTrackingController.normalizeTrackedText(
      detail?.requestMessagePreview || detail?.requestPreview || detail?.requestText,
    );
    const previewConfirmed = Boolean(requestPreview && requestPreview.includes(preparedText));
    const matchedResponseConfirmed =
      detail.matched === true &&
      detail.responseFinal === true &&
      Date.now() - Number(state.manualDomInjection.preparedAt || 0) < 45000;
    if (!previewConfirmed && !matchedResponseConfirmed) return;

    const pendingToolResultText = String(state.codeMode.pendingToolResultText || "").trim();
    const manualPreparedToolResultText = String(
      state.codeMode.manualPreparedToolResultText || "",
    ).trim();

    if (pendingToolResultText && pendingToolResultText === preparedText) {
      state.codeMode.pendingToolResultText = "";
    }
    if (manualPreparedToolResultText && manualPreparedToolResultText === preparedText) {
      state.codeMode.manualPreparedToolResultText = "";
    }
    if (hasWrappedSystemInjection(preparedText)) {
      systemInjectionTrackingController.markSystemInjectionApplied(
        readWrappedSystemInjectionSignature(preparedText),
      );
    }

    continuationController.resetManualDomInjectionState();
    syncRequestInjectionToMonitor();
    renderSystemInjectionWidget();
  }

  function dispatchAdapterHookResponse(requestId: number, result: unknown, error = "") {
    document.dispatchEvent(
      new CustomEvent(ADAPTER_HOOK_RESPONSE_EVENT, {
        detail: JSON.stringify({
          requestId,
          ok: !error,
          result: result ?? null,
          error,
        }),
      }),
    );
  }

  function handleMonitorMessage(detail: Record<string, unknown> | null) {
    if (!detail || !detail.type) return;

    if (detail.type === "ready") {
      state.monitorReady = true;
      notifyExtension({ type: "CHATPLUS_MONITOR_READY" });
      return;
    }

    if (detail.type === "state") {
      state.monitorReady = true;
      state.monitorActive = Boolean(detail.active);
      notifyExtension({
        type: "CHATPLUS_MONITOR_STATE",
        active: state.monitorActive,
      });
      return;
    }

    if (detail.type === "injection") {
      if (!isPluginRuntimeEnabled()) return;
      rememberBubbleDecorationRequestPreview(detail?.requestMessagePreview);
      clearBubbleDecorationResponsePreview();
      const pendingToolResultText = String(state.codeMode.pendingToolResultText || "").trim();
      const manualPreparedToolResultText = String(
        state.codeMode.manualPreparedToolResultText || "",
      ).trim();
      const injectedText = String(detail?.requestInjectionText || "").trim();
      if (pendingToolResultText && injectedText.includes(pendingToolResultText)) {
        state.codeMode.pendingToolResultText = "";
        updateRequestInjection();
        dispatchMonitorControl(state.monitorActive);
      }
      if (manualPreparedToolResultText) {
        state.codeMode.manualPreparedToolResultText = "";
        updateRequestInjection();
        dispatchMonitorControl(state.monitorActive);
      }
      if (hasWrappedSystemInjection(injectedText)) {
        systemInjectionTrackingController.markSystemInjectionApplied(
          readWrappedSystemInjectionSignature(injectedText),
        );
        syncRequestInjectionToMonitor();
        renderSystemInjectionWidget();
      }
      continuationController.resetManualDomInjectionState();
      continuationController.requestBubbleDecorationRefresh();
      return;
    }

    if (detail.type === "result") {
      if (!isPluginRuntimeEnabled()) return;
      rememberBubbleDecorationRequestPreview(detail?.requestMessagePreview);
      if (detail.matched === true && detail.responseFinal === true) {
        rememberBubbleDecorationResponsePreview(detail?.responseContentPreview);
      }
      const allowAssistantCodeModeAutoExecution = shouldAutoExecuteAssistantCodeMode(state, detail);
      maybeConfirmPendingSystemInjectionFromResult(detail);
      maybeConfirmPendingManualDomInjectionFromResult(detail);
      if (
        state.codeMode.autoContinueInFlight &&
        detail.matched === true &&
        detail.responseFinal === true
      ) {
        continuationController.completeAutoContinueCycle(true);
        state.codeMode.statusTone = "success";
        state.codeMode.statusText = "模型已继续响应";
        state.codeMode.detailText = "自动续发已完成";
        renderCodeModeStatusBar();
        codeModeStatusController.scheduleCodeModeStatusHide(1400);
      }
      if (detail.matched === true && detail.responseFinal === true) {
        clearExpectedAssistantTurn(state);
      }
      continuationController.requestBubbleDecorationRefresh();
      logMonitorResultDebug(detail);
      void executeAssistantCodeModeIfNeeded(detail, {
        allowAutoExecute: allowAssistantCodeModeAutoExecution,
      });
    }
  }

  async function resolveMonitorConfigFromRuntime() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "SYSTEM_INSTRUCTION_RESOLVE",
      });
      applySystemInstructionSource({
        content: response?.content || "",
        adapterScript: response?.adapterScript || "",
        codeModeManifest:
          response?.codeModeManifest && typeof response.codeModeManifest === "object"
            ? response.codeModeManifest
            : { servers: [], docs: [] },
        protocol: response?.protocol,
        tabPluginEnabled: response?.tabPluginEnabled !== false,
      });
    } catch {
      applySystemInstructionSource({
        content: "",
        adapterScript: "",
        codeModeManifest: { servers: [], docs: [] },
        protocol: CHAT_PLUS_PROTOCOL,
        tabPluginEnabled: state.isTabEnabled,
      });
    }

    dispatchMonitorControl(state.monitorActive);
  }
  adapterSandboxController.installMessageListener();

  document.addEventListener(ADAPTER_HOOK_REQUEST_EVENT, (event) => {
    const customEvent = event as CustomEvent<string>;
    const detail = parseMonitorDetail(customEvent.detail) as Record<string, unknown> | null;
    const requestId = Number(detail?.requestId || 0);
    const hookName = String(detail?.hookName || "").trim();

    if (!requestId || !hookName) return;

    if (!isPluginRuntimeEnabled() || !String(state.adapterScript || "").trim()) {
      dispatchAdapterHookResponse(requestId, null);
      return;
    }

    void adapterSandboxController
      .executeAdapterHookInSandbox(
        hookName as "transformRequest" | "extractResponse" | "continueConversation",
        detail?.payload && typeof detail.payload === "object"
          ? (detail.payload as Record<string, unknown>)
          : {},
      )
      .then((result) => dispatchAdapterHookResponse(requestId, result))
      .catch((error) =>
        dispatchAdapterHookResponse(requestId, null, stringifyError(error)),
      );
  });

  document.addEventListener(MONITOR_RESULT_EVENT, (event) => {
    const customEvent = event as CustomEvent<string>;
    handleMonitorMessage(parseMonitorDetail(customEvent.detail) as Record<string, unknown> | null);
  });

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!isPluginRuntimeEnabled()) return;
      continuationController.maybeRecordSendIntentFromTrigger({
        triggerType: "click",
        target: event.target,
      });
      continuationController.maybePreparePendingManualInjectionFromTrigger({
        triggerType: "click",
        target: event.target,
      });
    },
    true,
  );

  document.addEventListener(
    "click",
    (event) => {
      if (!isPluginRuntimeEnabled()) return;
      continuationController.maybeRecordSendIntentFromTrigger({
        triggerType: "click",
        target: event.target,
      });
      continuationController.maybePreparePendingManualInjectionFromTrigger({
        triggerType: "click",
        target: event.target,
      });
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (!isPluginRuntimeEnabled()) return;
      if (event.key !== "Enter") return;
      continuationController.maybeRecordSendIntentFromTrigger({
        triggerType: "keydown",
        target: event.target,
        keyboardEvent: event,
      });
      continuationController.maybePreparePendingManualInjectionFromTrigger({
        triggerType: "keydown",
        target: event.target,
        keyboardEvent: event,
      });
    },
    true,
  );

  document.addEventListener(
    "submit",
    (event) => {
      if (!isPluginRuntimeEnabled()) return;
      continuationController.maybeRecordSendIntentFromTrigger({
        triggerType: "submit",
        target: event.target,
      });
      continuationController.maybePreparePendingManualInjectionFromTrigger({
        triggerType: "submit",
        target: event.target,
      });
    },
    true,
  );

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const trigger = target.closest(`[${CODE_MODE_MANUAL_RUN_TRIGGER_ATTR}="1"]`);
      if (!(trigger instanceof HTMLElement)) return;
      event.preventDefault();
      event.stopPropagation();
      void handleManualCodeModeRun(trigger);
    },
    true,
  );

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (
      namespace === "sync" &&
      (
        changes.enabled ||
        changes.theme ||
        changes[CODE_MODE_AUTO_CONTINUE_STORAGE_KEY] ||
        changes[CODE_MODE_AUTO_CONTINUE_DELAY_STORAGE_KEY]
      )
    ) {
      if (changes.enabled) {
        const previousRuntimeEnabled = isPluginRuntimeEnabled();
        state.isEnabled = changes.enabled.newValue !== false;
        if (previousRuntimeEnabled && !isPluginRuntimeEnabled()) {
          clearPluginRuntimeEffects();
        }
        continuationController.syncBubbleDecorationObserver();
        renderSystemInjectionWidget();
        renderCodeModeStatusBar();
        dispatchMonitorControl(state.monitorActive);
      }
      if (changes.theme) {
        state.uiTheme = changes.theme.newValue === "light" ? "light" : "dark";
        renderSystemInjectionWidget();
        renderCodeModeStatusBar();
      }
      if (changes[CODE_MODE_AUTO_CONTINUE_STORAGE_KEY]) {
        state.codeMode.autoContinueEnabled =
          systemInjectionTrackingController.normalizeCodeModeAutoContinueEnabled(
            changes[CODE_MODE_AUTO_CONTINUE_STORAGE_KEY].newValue,
          );
        renderSystemInjectionWidget();
      }
      if (changes[CODE_MODE_AUTO_CONTINUE_DELAY_STORAGE_KEY]) {
        systemInjectionTrackingController.setCodeModeAutoContinueDelaySeconds(
          changes[CODE_MODE_AUTO_CONTINUE_DELAY_STORAGE_KEY].newValue,
          false,
        );
      }
      return;
    }

    if (
      (namespace === "local" &&
        (changes[SITE_CONFIG_MAP_STORAGE_KEY] ||
          changes[SYSTEM_INSTRUCTION_PRESETS_STORAGE_KEY] ||
          changes[SYSTEM_INSTRUCTION_SITE_SELECTION_STORAGE_KEY] ||
          changes[MCP_CONFIG_STORAGE_KEY] ||
          changes[MCP_DISCOVERED_TOOLS_STORAGE_KEY] ||
          changes[MCP_ENABLED_TOOLS_STORAGE_KEY] ||
          changes[MCP_SITE_ENABLED_TOOLS_STORAGE_KEY])) ||
      (namespace === "session" &&
        (changes[SYSTEM_INSTRUCTION_TAB_SELECTION_STORAGE_KEY] ||
          changes[MCP_TAB_ENABLED_TOOLS_STORAGE_KEY]))
    ) {
      void resolveMonitorConfigFromRuntime();
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "GET_PAGE_CONTEXT") {
      sendResponse({ success: true, context: getCurrentContext() });
      return false;
    }

    if (message.type === "SYSTEM_INSTRUCTION_REFRESH") {
      void resolveMonitorConfigFromRuntime()
        .then(() => sendResponse({ success: true }))
        .catch((error) =>
          sendResponse({
            success: false,
            error: error?.message || "系统指令刷新失败",
          }),
        );
      return true;
    }

    if (message.type === "SYSTEM_INSTRUCTION_APPLY") {
      applySystemInstructionSource({
        content: message?.content || "",
        adapterScript: message?.adapterScript || state.adapterScript || "",
        protocol: message?.protocol,
        tabPluginEnabled: message?.tabPluginEnabled !== false,
      });
      dispatchMonitorControl(state.monitorActive);
      sendResponse({ success: true });
      return false;
    }

    return false;
  });

  systemInjectionTrackingController.installPageUrlWatchers();
  systemInjectionTrackingController.loadSettings();
  renderSystemInjectionWidget();
  void resolveMonitorConfigFromRuntime();
  dispatchMonitorControl(false);
  notifyExtension({
    type: "CHATPLUS_CONTENT_READY",
    context: getCurrentContext(),
  });
})();
