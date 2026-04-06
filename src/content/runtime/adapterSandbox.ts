import {
  ADAPTER_SANDBOX_CHANNEL,
  type ContentRuntimeState,
} from "./contentRuntimeState";

type CreateAdapterSandboxControllerOptions = {
  state: ContentRuntimeState;
  isPluginRuntimeEnabled: () => boolean;
  stringifyError: (error: unknown) => string;
  logAdapterSandboxError: (scope: string, error: unknown) => void;
  updateCodeModeToolProgress: (runId: number, toolLabel: string, delta: number) => void;
  isCodeModeRunCancelled: (runId: number) => boolean;
};

export function createAdapterSandboxController({
  state,
  isPluginRuntimeEnabled,
  stringifyError,
  logAdapterSandboxError,
  updateCodeModeToolProgress,
  isCodeModeRunCancelled,
}: CreateAdapterSandboxControllerOptions) {
  function rejectPendingSandboxRequests(reason: string) {
    state.adapterSandbox.pending.forEach(({ reject, timerId }) => {
      window.clearTimeout(timerId);
      reject(new Error(reason));
    });
    state.adapterSandbox.pending.clear();
  }

  function postSandboxWindowMessage(payload: Record<string, unknown>) {
    const frameWindow = state.adapterSandbox.frame?.contentWindow;
    if (!frameWindow) return false;
    frameWindow.postMessage(
      {
        channel: ADAPTER_SANDBOX_CHANNEL,
        ...payload,
      },
      "*",
    );
    return true;
  }

  function isExtensionContextInvalidatedError(error: unknown) {
    const message = stringifyError(error).toLowerCase();
    return (
      message.includes("extension context invalidated") ||
      message.includes("context invalidated")
    );
  }

  function normalizeRuntimeErrorMessage(error: unknown) {
    if (isExtensionContextInvalidatedError(error)) {
      return "Chat Plus 扩展已重载，当前页面里的运行时上下文已经失效。请刷新当前网页后再重试。";
    }
    return stringifyError(error);
  }

  function resolveCodeModeToolAlias(serverAlias: string, toolAlias: string) {
    const manifestServers = Array.isArray(state.codeModeManifest?.servers)
      ? state.codeModeManifest.servers
      : [];

    for (const server of manifestServers) {
      if (String(server?.alias || "").trim() !== serverAlias) continue;
      const tools = Array.isArray(server?.tools) ? server.tools : [];
      for (const tool of tools) {
        if (String(tool?.alias || "").trim() !== toolAlias) continue;
        return {
          serverId: String(server?.id || "").trim(),
          toolName: String(tool?.name || "").trim(),
        };
      }
    }

    return null;
  }

  async function handleSandboxToolCall(detail: Record<string, unknown>) {
    const callId = Number(detail?.callId || 0);
    const runId = Number(detail?.runId || 0);
    const serverAlias = String(detail?.serverAlias || "").trim();
    const toolAlias = String(detail?.toolAlias || "").trim();
    if (!callId || !serverAlias || !toolAlias) return;

    if (!isPluginRuntimeEnabled()) {
      postSandboxWindowMessage({
        type: "tool-response",
        callId,
        ok: false,
        error: "当前页面已关闭 Chat Plus",
      });
      return;
    }

    const toolLabel = `tools.${serverAlias}.${toolAlias}`;
    if (runId && isCodeModeRunCancelled(runId)) {
      postSandboxWindowMessage({
        type: "tool-response",
        callId,
        ok: false,
        error: "用户已停止执行",
      });
      return;
    }

    const resolvedTool = resolveCodeModeToolAlias(serverAlias, toolAlias);
    if (!resolvedTool?.serverId || !resolvedTool.toolName) {
      postSandboxWindowMessage({
        type: "tool-response",
        callId,
        ok: false,
        error: `未找到工具别名：tools.${serverAlias}.${toolAlias}`,
      });
      return;
    }

    updateCodeModeToolProgress(runId, toolLabel, 1);
    try {
      const response = await chrome.runtime.sendMessage({
        type: "MCP_TOOL_CALL",
        serverId: resolvedTool.serverId,
        toolName: resolvedTool.toolName,
        arguments:
          detail?.arguments && typeof detail.arguments === "object" && !Array.isArray(detail.arguments)
            ? detail.arguments
            : {},
        siteKey: location.hostname || "",
        host: location.hostname || "",
      });

      postSandboxWindowMessage({
        type: "tool-response",
        callId,
        ok: response?.ok !== false,
        result: response?.result ?? null,
        error: response?.ok === false ? String(response?.error || "工具调用失败") : "",
      });
    } catch (error) {
      postSandboxWindowMessage({
        type: "tool-response",
        callId,
        ok: false,
        error: normalizeRuntimeErrorMessage(error),
      });
    } finally {
      updateCodeModeToolProgress(runId, toolLabel, -1);
    }
  }

  function ensureAdapterSandboxFrame() {
    if (state.adapterSandbox.ready && state.adapterSandbox.frame?.isConnected) {
      return Promise.resolve();
    }

    if (state.adapterSandbox.readyPromise) {
      return state.adapterSandbox.readyPromise;
    }

    state.adapterSandbox.ready = false;
    state.adapterSandbox.readyPromise = new Promise<void>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        state.adapterSandbox.readyPromise = null;
        state.adapterSandbox.readyResolver = null;
        reject(new Error("adapter sandbox init timeout"));
      }, 5000);

      state.adapterSandbox.readyResolver = () => {
        window.clearTimeout(timeoutId);
        state.adapterSandbox.ready = true;
        state.adapterSandbox.readyPromise = null;
        state.adapterSandbox.readyResolver = null;
        resolve();
      };

      try {
        let frame = state.adapterSandbox.frame;
        if (frame && !frame.isConnected) {
          frame = null;
          state.adapterSandbox.frame = null;
          rejectPendingSandboxRequests("adapter sandbox frame was detached");
        }

        if (!frame) {
          frame = document.createElement("iframe");
          frame.src = chrome.runtime.getURL("sandbox.html");
          frame.tabIndex = -1;
          frame.setAttribute("aria-hidden", "true");
          frame.style.display = "none";
          frame.style.width = "0";
          frame.style.height = "0";
          frame.style.border = "0";
          const mountTarget = document.documentElement || document.body;
          if (!mountTarget) {
            throw new Error("document root unavailable for adapter sandbox");
          }
          mountTarget.appendChild(frame);
          state.adapterSandbox.frame = frame;
        }
      } catch (error) {
        window.clearTimeout(timeoutId);
        state.adapterSandbox.readyPromise = null;
        state.adapterSandbox.readyResolver = null;
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

    return state.adapterSandbox.readyPromise;
  }

  function installMessageListener() {
    window.addEventListener("message", (event) => {
      if (event.source !== state.adapterSandbox.frame?.contentWindow) return;

      const detail = event.data;
      if (!detail || detail.channel !== ADAPTER_SANDBOX_CHANNEL) return;

      if (detail.type === "ready") {
        state.adapterSandbox.ready = true;
        state.adapterSandbox.readyResolver?.();
        return;
      }

      if (detail.type === "tool-call") {
        void handleSandboxToolCall(detail as Record<string, unknown>);
        return;
      }

      if (detail.type !== "response") return;

      const requestId = Number(detail.requestId || 0);
      if (!requestId) return;

      const pending = state.adapterSandbox.pending.get(requestId);
      if (!pending) return;

      window.clearTimeout(pending.timerId);
      state.adapterSandbox.pending.delete(requestId);

      if (detail.ok === false) {
        pending.reject(new Error(String(detail.error || "adapter sandbox request failed")));
        return;
      }

      pending.resolve(detail.result ?? null);
    });
  }

  async function postAdapterSandboxRequest({
    requestKind = "adapter-hook",
    hookName,
    payload,
    snapshotHtml = "",
    code = "",
    manifest = null,
    runId = 0,
    timeoutMs = 5000,
  }: {
    requestKind?: "adapter-hook" | "code-mode";
    hookName: string;
    payload?: Record<string, unknown>;
    snapshotHtml?: string;
    code?: string;
    manifest?: Record<string, unknown> | null;
    runId?: number;
    timeoutMs?: number;
  }) {
    const scriptText = String(state.adapterScript || "").trim();
    if (requestKind === "adapter-hook" && !scriptText) return null;

    await ensureAdapterSandboxFrame();
    const frameWindow = state.adapterSandbox.frame?.contentWindow;
    if (!frameWindow) {
      throw new Error("adapter sandbox window unavailable");
    }

    const requestId = ++state.adapterSandbox.requestSequence;
    return new Promise((resolve, reject) => {
      const timerId =
        Number(timeoutMs) > 0
          ? window.setTimeout(() => {
              state.adapterSandbox.pending.delete(requestId);
              reject(new Error(`adapter sandbox timeout: ${hookName}`));
            }, Number(timeoutMs))
          : 0;

      state.adapterSandbox.pending.set(requestId, {
        resolve,
        reject: (error) => reject(error),
        timerId,
      });

      try {
        postSandboxWindowMessage({
          type: "execute",
          requestId,
          requestKind,
          scriptText,
          hookName,
          payload: payload || {},
          snapshotHtml,
          code,
          manifest,
          runId,
        });
      } catch (error) {
        window.clearTimeout(timerId);
        state.adapterSandbox.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
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
    if (!isPluginRuntimeEnabled()) return null;
    if (!String(state.adapterScript || "").trim()) return null;

    try {
      return await postAdapterSandboxRequest({
        requestKind: "adapter-hook",
        hookName,
        payload: {
          ...(payload || {}),
          protocol: state.protocol,
        },
        snapshotHtml: String(options?.snapshotHtml || ""),
        timeoutMs:
          options?.timeoutMs ||
          ((hookName === "decorateBubbles" || hookName === "continueConversation") ? 10000 : 5000),
      });
    } catch (error) {
      logAdapterSandboxError(`adapter ${hookName}`, error);
      return null;
    }
  }

  async function executeCodeModeScriptInSandbox(code: string, runId = 0) {
    const normalizedCode = String(code || "").trim();
    if (!normalizedCode) {
      return { ok: false, error: "缺少代码" };
    }
    if (!isPluginRuntimeEnabled()) {
      return { ok: false, error: "当前页面已关闭 Chat Plus" };
    }

    const manifest =
      state.codeModeManifest && typeof state.codeModeManifest === "object"
        ? state.codeModeManifest
        : { servers: [] };
    if (!Array.isArray(manifest?.servers) || manifest.servers.length === 0) {
      return { ok: false, error: "当前页面没有可用的 MCP 工具" };
    }

    try {
      const response = await postAdapterSandboxRequest({
        requestKind: "code-mode",
        hookName: "code-mode",
        code: normalizedCode,
        manifest,
        runId,
        timeoutMs: 0,
      });
      return response && typeof response === "object"
        ? (response as Record<string, unknown>)
        : { ok: false, error: "代码模式执行失败" };
    } catch (error) {
      const message = normalizeRuntimeErrorMessage(error);
      return {
        ok: false,
        error: message,
        resultText: [
          "Chat Plus Code Mode 执行失败",
          "阶段: runtime",
          `错误: ${message}`,
        ].join("\n"),
      };
    }
  }

  return {
    rejectPendingSandboxRequests,
    postSandboxWindowMessage,
    ensureAdapterSandboxFrame,
    installMessageListener,
    executeAdapterHookInSandbox,
    executeCodeModeScriptInSandbox,
  };
}
