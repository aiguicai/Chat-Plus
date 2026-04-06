(function () {
  "use strict";

  if (window.ChatPlusPageMonitor) return;

  const CHAT_PLUS_PROTOCOL = {
    injection: {
      begin: "[CHAT_PLUS_INJECTION_BEGIN]",
      end: "[CHAT_PLUS_INJECTION_END]",
    },
    toolCall: {
      begin: "[CHAT_PLUS_TOOL_CALL_BEGIN]",
      end: "[CHAT_PLUS_TOOL_CALL_END]",
    },
    toolResult: {
      begin: "[CHAT_PLUS_TOOL_RESULT_BEGIN]",
      end: "[CHAT_PLUS_TOOL_RESULT_END]",
    },
    codeMode: {
      begin: "[CHAT_PLUS_CODE_MODE_BEGIN]",
      end: "[CHAT_PLUS_CODE_MODE_END]",
    },
  };
  const CHAT_PLUS_USER_QUESTION_LABEL = "下面是用户的提问：";

  const ChatPlusPageMonitor = {
    CONTROL_EVENT: "chat-plus-monitor-control",
    RESULT_EVENT: "chat-plus-monitor-result",
    ADAPTER_REQUEST_EVENT: "chat-plus-adapter-hook-request",
    ADAPTER_RESPONSE_EVENT: "chat-plus-adapter-hook-response",
    RESPONSE_PREVIEW_TIMEOUT: 1800,
    state: {
      isActive: false,
      isEnabled: true,
      requestInjectionText: "",
      requestInjectionMode: "system" as "system" | "raw",
      adapterScript: "",
      protocol: CHAT_PLUS_PROTOCOL,
      sequence: 0,
      adapterRequestSequence: 0,
    },
    emit(payload) {
      try {
        document.dispatchEvent(
          new CustomEvent(ChatPlusPageMonitor.RESULT_EVENT, {
            detail: JSON.stringify(payload),
          }),
        );
      } catch (error) {}
    },
    emitResult(candidate) {
      ChatPlusPageMonitor.emit({
        type: "result",
        id: ++ChatPlusPageMonitor.state.sequence,
        observedAt: Date.now(),
        ...candidate,
      });
    },
    parseJsonDetail(detail) {
      if (!detail) return null;

      try {
        return typeof detail === "string" ? JSON.parse(detail) : detail;
      } catch {
        return null;
      }
    },
    normalizeInjectionText(value) {
      return String(value || "").replace(/\r\n?/g, "\n").trim();
    },
    buildInjectedText(injectionText, originalText, injectionMode = "system") {
      const prefix = ChatPlusPageMonitor.normalizeInjectionText(injectionText);
      const original = String(originalText ?? "").replace(/\r\n?/g, "\n");

      if (!prefix) return original;
      if (String(injectionMode || "").toLowerCase() === "raw") {
        if (original === prefix || original.startsWith(`${prefix}\n\n`)) {
          return original;
        }
        return original ? `${prefix}\n\n${original}` : prefix;
      }

      const wrappedInstruction = [
        ChatPlusPageMonitor.state.protocol.injection.begin,
        prefix,
        "",
        CHAT_PLUS_USER_QUESTION_LABEL,
        ChatPlusPageMonitor.state.protocol.injection.end,
      ].join("\n");

      if (
        original === wrappedInstruction ||
        original.startsWith(`${wrappedInstruction}\n\n`)
      ) {
        return original;
      }
      return original ? `${wrappedInstruction}\n\n${original}` : wrappedInstruction;
    },
    unique(values) {
      return Array.from(
        new Set(
          (Array.isArray(values) ? values : [])
            .map((value) => String(value || "").trim())
            .filter(Boolean),
        ),
      );
    },
    toAbsoluteUrl(value) {
      const text = String(value || "").trim();
      if (!text) return "";
      try {
        return new URL(text, location.href).toString();
      } catch {
        return text;
      }
    },
    headersToObject(headersLike) {
      const result = Object.create(null);

      if (!headersLike) return result;

      if (headersLike instanceof Headers) {
        headersLike.forEach((value, key) => {
          result[String(key).toLowerCase()] = String(value);
        });
        return result;
      }

      if (Array.isArray(headersLike)) {
        headersLike.forEach((entry) => {
          if (!Array.isArray(entry) || entry.length < 2) return;
          result[String(entry[0]).toLowerCase()] = String(entry[1]);
        });
        return result;
      }

      if (typeof headersLike === "object") {
        Object.entries(headersLike).forEach(([key, value]) => {
          result[String(key).toLowerCase()] = String(value ?? "");
        });
      }

      return result;
    },
    serializeBody(body) {
      if (typeof body === "string") {
        return body;
      }

      if (body instanceof URLSearchParams) {
        return body.toString();
      }

      if (body instanceof FormData) {
        const entries = [];
        body.forEach((value, key) => {
          entries.push(
            `${key}=${typeof value === "string" ? value : `[blob:${value.type || "unknown"}]`}`,
          );
        });
        return entries.join("&");
      }

      if (body == null) return "";

      try {
        return JSON.stringify(body);
      } catch {
        return String(body);
      }
    },
    detectStreamReasons({
      endpoint,
      requestHeaders,
      requestPreview,
      responseContentType,
      responsePreview,
      source,
    }) {
      const reasons = [];
      const accept = String(requestHeaders?.accept || "");
      const bodyText = String(requestPreview || "");
      const contentType = String(responseContentType || "");
      const previewText = String(responsePreview || "");

      if (source === "eventsource") reasons.push("EventSource 长连接");
      if (source === "websocket") reasons.push("WebSocket 长连接");
      if (/text\/event-stream/i.test(accept)) reasons.push("请求头包含 text/event-stream");
      if (
        /text\/event-stream|application\/x-ndjson|application\/stream\+json|application\/json-seq/i.test(
          contentType,
        )
      ) {
        reasons.push(`响应头为 ${contentType}`);
      }
      if (/"stream"\s*:\s*true/i.test(bodyText) || /stream=true/i.test(bodyText)) {
        reasons.push("请求体包含 stream=true");
      }
      if (/"incremental_output"\s*:\s*true/i.test(bodyText)) {
        reasons.push("请求体包含 incremental_output=true");
      }
      if (/^data:/im.test(previewText)) {
        reasons.push("响应片段包含 SSE data");
      }

      return ChatPlusPageMonitor.unique(reasons);
    },
    isRelevantEndpoint(endpoint) {
      return /sse|event-stream|stream|chat|conversation|completion|message|assistant|response|generate|prompt/i.test(
        String(endpoint || ""),
      );
    },
    createAdapterHelpers() {
      return {
        buildInjectedText: ChatPlusPageMonitor.buildInjectedText,
        parseJson(value) {
          try {
            return JSON.parse(String(value || ""));
          } catch {
            return null;
          }
        },
      };
    },
    runAdapterHook(name, payload) {
      const normalizedScript = String(ChatPlusPageMonitor.state.adapterScript || "").trim();
      if (!normalizedScript) return Promise.resolve(null);

      const hookName = String(name || "").trim();
      if (!hookName) return Promise.resolve(null);

      return new Promise((resolve) => {
        const requestId = ++ChatPlusPageMonitor.state.adapterRequestSequence;
        let settled = false;

        const cleanup = () => {
          document.removeEventListener(ChatPlusPageMonitor.ADAPTER_RESPONSE_EVENT, handleResponse);
          window.clearTimeout(timeoutId);
        };

        const finish = (value) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value ?? null);
        };

        const handleResponse = (event) => {
          const customEvent = event as CustomEvent<string>;
          const detail = ChatPlusPageMonitor.parseJsonDetail(customEvent.detail);
          if (!detail || Number(detail.requestId || 0) !== requestId) return;
          finish(detail.ok === false ? null : detail.result || null);
        };

        const timeoutId = window.setTimeout(() => {
          finish(null);
        }, 5000);

        document.addEventListener(ChatPlusPageMonitor.ADAPTER_RESPONSE_EVENT, handleResponse);

        try {
          document.dispatchEvent(
            new CustomEvent(ChatPlusPageMonitor.ADAPTER_REQUEST_EVENT, {
              detail: JSON.stringify({
                requestId,
                hookName,
                payload,
              }),
            }),
          );
        } catch (error) {
          finish(null);
        }
      });
    },
  };

  window.ChatPlusPageMonitor = ChatPlusPageMonitor;
})();
