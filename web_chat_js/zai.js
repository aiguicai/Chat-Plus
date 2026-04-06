const toText = (value) => String(value ?? "").trim();

function looksLikeZaiUrl(url) {
  const text = toText(url).toLowerCase();
  return Boolean(text) && text.includes("chat.z.ai") && text.includes("/api/v2/chat/completions");
}

function looksLikeZaiSse(responseText) {
  const raw = String(responseText ?? "").replace(/\r\n?/g, "\n");
  if (!raw) return false;
  return /(^|\n)\s*data:\s*\{/.test(raw) && /"type"\s*:\s*"chat:|chat:message|chat:completion|replace|message"/.test(raw);
}

function readTextParts(value) {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];

  if (Array.isArray(value)) {
    return value.flatMap((item) => readTextParts(item));
  }

  const directKeys = [
    "text",
    "content",
    "message",
    "delta_content",
    "edit_content",
    "delta_name",
    "delta_arguments",
    "name",
    "arguments",
  ];
  const nestedKeys = ["parts", "content", "content_blocks", "blocks", "items", "message", "result"];
  const parts = [];

  directKeys.forEach((key) => {
    if (typeof value[key] === "string") {
      parts.push(value[key]);
    }
  });

  nestedKeys.forEach((key) => {
    const candidate = value[key];
    if (Array.isArray(candidate)) {
      parts.push(...readTextParts(candidate));
      return;
    }
    if (candidate && typeof candidate === "object") {
      parts.push(...readTextParts(candidate));
    }
  });

  return parts;
}

function joinTextSegmentsWithBreaks(segments) {
  const parts = Array.isArray(segments)
    ? segments
        .map((segment) => String(segment ?? "").replace(/\r\n?/g, "\n"))
        .filter(Boolean)
    : [];
  if (!parts.length) return "";

  let text = "";
  for (const part of parts) {
    if (!text) {
      text = part;
      continue;
    }
    if (text.endsWith("\n") || part.startsWith("\n")) {
      text += part;
      continue;
    }
    text += `\n${part}`;
  }

  return text;
}

function pushUniqueText(list, text) {
  const normalized = String(text ?? "").replace(/\r\n?/g, "\n");
  if (!normalized) return;
  if (!list.includes(normalized)) list.push(normalized);
}

function preferLongerText(current, candidate) {
  const left = String(current ?? "");
  const right = String(candidate ?? "");
  if (!left) return right;
  if (!right) return left;
  if (right.length !== left.length) return right.length > left.length ? right : left;

  const leftProtocolCount = (left.match(/\[CHAT_PLUS_/g) || []).length;
  const rightProtocolCount = (right.match(/\[CHAT_PLUS_/g) || []).length;
  if (rightProtocolCount !== leftProtocolCount) {
    return rightProtocolCount > leftProtocolCount ? right : left;
  }

  const leftNewlineCount = (left.match(/\n/g) || []).length;
  const rightNewlineCount = (right.match(/\n/g) || []).length;
  return rightNewlineCount > leftNewlineCount ? right : left;
}

function mergeStreamingText(current, incoming) {
  const base = String(current ?? "");
  const next = String(incoming ?? "");
  if (!next) return base;
  if (!base) return next;
  if (base.endsWith(next)) return base;
  if (next.startsWith(base)) return next;

  const maxOverlap = Math.min(base.length, next.length);
  for (let size = maxOverlap; size > 0; size -= 1) {
    if (base.slice(-size) === next.slice(0, size)) {
      return base + next.slice(size);
    }
  }

  return base + next;
}

function mergeSequencedText(current, incoming) {
  const base = String(current ?? "");
  const next = String(incoming ?? "");
  if (!next) return base;
  if (!base) return next;
  if (base.includes(next)) return base;
  if (next.includes(base)) return next;

  const merged = mergeStreamingText(base, next);
  if (merged !== base + next) return merged;

  return base + (base.endsWith("\n") || next.startsWith("\n") ? "" : "\n") + next;
}

function readContentBlocksText(blocks, options = {}) {
  if (!Array.isArray(blocks)) return "";

  const texts = [];
  blocks.forEach((block) => {
    if (!block || typeof block !== "object") return;

    const phase = String(block.phase || block.type || block.role || "").trim().toLowerCase();
    if (!options.includeThinking && phase === "thinking") return;

    const source =
      block.content !== undefined
        ? block.content
        : block.text !== undefined
          ? block.text
          : block.message !== undefined
            ? block.message
            : block.delta_content !== undefined
              ? block.delta_content
              : block;

    const text = joinTextSegmentsWithBreaks(readTextParts(source));
    pushUniqueText(texts, text);
  });

  return joinTextSegmentsWithBreaks(texts);
}

function readEventCandidates(event) {
  const payload = event && typeof event === "object" ? event : {};
  const type = String(payload.type || payload.event || "").trim();
  const data =
    payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
      ? payload.data
      : {};

  const phase = String(data.phase || "").trim().toLowerCase();
  const visible = phase !== "thinking";
  const incremental = [];
  const snapshot = [];
  const fallback = [];

  function addIncremental(text, isVisible = visible) {
    const value = String(text ?? "").replace(/\r\n?/g, "\n");
    if (!value) return;
    if (isVisible) pushUniqueText(incremental, value);
    pushUniqueText(fallback, value);
  }

  function addSnapshot(text, isVisible = visible) {
    const value = String(text ?? "").replace(/\r\n?/g, "\n");
    if (!value) return;
    if (isVisible) pushUniqueText(snapshot, value);
    pushUniqueText(fallback, value);
  }

  const contentText = joinTextSegmentsWithBreaks(readTextParts(data.content));
  const messageText = joinTextSegmentsWithBreaks(readTextParts(data.message));
  const deltaText = joinTextSegmentsWithBreaks(readTextParts(data.delta_content));
  const editText = joinTextSegmentsWithBreaks(readTextParts(data.edit_content));
  const blocksVisibleText = readContentBlocksText(data.content_blocks, { includeThinking: false });
  const blocksAllText = readContentBlocksText(data.content_blocks, { includeThinking: true });

  if (type === "chat:message:delta" || type === "message") {
    addIncremental(contentText);
  } else if (type === "chat:message" || type === "replace") {
    addSnapshot(contentText);
    addSnapshot(messageText);
  } else if (type === "chat:completion") {
    addIncremental(deltaText);
    addSnapshot(contentText);
    addSnapshot(editText);
    addSnapshot(messageText);
    addSnapshot(blocksVisibleText, true);
    if (blocksAllText) pushUniqueText(fallback, blocksAllText);
  } else {
    addIncremental(deltaText);
    addSnapshot(contentText);
    addSnapshot(messageText);
    addSnapshot(editText);
    addSnapshot(blocksVisibleText, true);
    if (blocksAllText) pushUniqueText(fallback, blocksAllText);
  }

  return {
    incrementalText: joinTextSegmentsWithBreaks(incremental),
    snapshotText: joinTextSegmentsWithBreaks(snapshot),
    fallbackText: joinTextSegmentsWithBreaks(fallback),
  };
}

function restoreInlineStyle(element, styleText) {
  if (!(element instanceof HTMLElement)) return;
  const nextStyle = String(styleText ?? "");
  if (nextStyle) {
    element.setAttribute("style", nextStyle);
    return;
  }
  element.removeAttribute("style");
}

function syncUserToolResultShell(node, enabled) {
  if (!(node instanceof HTMLElement)) return;

  const bubble = node.closest(".chat-user");
  if (!(bubble instanceof HTMLElement)) return;

  const activeAttr = "data-chat-plus-tool-result-shell";
  const originalStyleAttr = "data-chat-plus-tool-result-shell-style";

  if (enabled) {
    if (!bubble.hasAttribute(activeAttr)) {
      bubble.setAttribute(originalStyleAttr, bubble.getAttribute("style") || "");
    }

    bubble.setAttribute(activeAttr, "1");
    bubble.style.setProperty("background", "transparent", "important");
    bubble.style.setProperty("background-color", "transparent", "important");
    bubble.style.setProperty("box-shadow", "none", "important");
    bubble.style.setProperty("border", "0", "important");
    bubble.style.setProperty("padding", "0", "important");
    bubble.style.setProperty("backdrop-filter", "none", "important");
    return;
  }

  if (!bubble.hasAttribute(activeAttr)) return;

  restoreInlineStyle(bubble, bubble.getAttribute(originalStyleAttr) || "");
  bubble.removeAttribute(activeAttr);
  bubble.removeAttribute(originalStyleAttr);
}

return {
  meta: {
    contractVersion: 2,
    adapterName: "Z.ai",
    adapterVersion: "2026.04",
    capabilities: {
      requestInjection: "dom-fallback",
      responseExtraction: "sse",
      protocolCards: "helper",
      autoContinuation: "dom-plan",
    },
  },

  transformRequest() {
    return null;
  },

  extractResponse(ctx) {
    const responseText = toText(ctx.responseText);
    if (!responseText) return null;
    if (!looksLikeZaiUrl(ctx.url) && !looksLikeZaiSse(responseText)) return null;

    const events = ctx.helpers.stream.readSseEvents(responseText);
    if (!events.length) return null;

    let streamingText = "";
    let snapshotText = "";
    let sequencedText = "";
    let protocolAwareText = "";
    let fallbackText = "";

    for (const entry of events) {
      const payload = entry?.json;
      if (!payload || typeof payload !== "object") continue;

      const candidate = readEventCandidates(payload);
      if (candidate.incrementalText) {
        streamingText = mergeStreamingText(streamingText, candidate.incrementalText);
        sequencedText = mergeSequencedText(sequencedText, candidate.incrementalText);
      }
      if (candidate.snapshotText) {
        snapshotText = preferLongerText(snapshotText, candidate.snapshotText);
        sequencedText = mergeSequencedText(sequencedText, candidate.snapshotText);
      }
      if (candidate.fallbackText) {
        fallbackText = preferLongerText(fallbackText, candidate.fallbackText);
      }

      const protocolCandidate =
        ctx.helpers.protocol.containsProtocolBlock(candidate.snapshotText, ctx.protocol)
          ? candidate.snapshotText
          : ctx.helpers.protocol.containsProtocolBlock(candidate.incrementalText, ctx.protocol)
            ? candidate.incrementalText
            : ctx.helpers.protocol.containsProtocolBlock(candidate.fallbackText, ctx.protocol)
              ? candidate.fallbackText
              : "";

      if (protocolCandidate) {
        protocolAwareText = mergeSequencedText(protocolAwareText, protocolCandidate);
      }
    }

    const fullText =
      sequencedText ||
      preferLongerText(snapshotText, streamingText) ||
      protocolAwareText ||
      fallbackText;
    if (!fullText) return null;

    const previewText =
      ctx.helpers.protocol.containsProtocolBlock(sequencedText, ctx.protocol)
        ? sequencedText
        : ctx.helpers.protocol.containsProtocolBlock(snapshotText, ctx.protocol)
          ? snapshotText
          : ctx.helpers.protocol.containsProtocolBlock(streamingText, ctx.protocol)
            ? streamingText
            : protocolAwareText || fullText;
    const blocks = ctx.helpers.protocol.readBlocks(previewText, ctx.protocol);

    return {
      matched: true,
      matchScore: 100,
      responseContentPath: "sse:data.type",
      responseContentPreview: previewText,
      toolCall: blocks.toolCallRaw
        ? { detected: true, rawBlock: blocks.toolCallRaw }
        : { detected: false },
      toolResult: blocks.toolResultRaw
        ? { detected: true, rawBlock: blocks.toolResultRaw }
        : { detected: false },
      codeMode: blocks.codeModeRaw
        ? { detected: true, rawBlock: blocks.codeModeRaw }
        : { detected: false },
    };
  },

  decorateBubbles(ctx) {
    return ctx.helpers.ui.decorateProtocolBubbles({
      root: ctx.root || document,
      protocol: ctx.protocol,
      userSelectors: [".user-message .chat-user .whitespace-pre-wrap"],
      assistantSelectors: [".chat-assistant #response-content-container > .markdown-prose"],
      beforeRenderUserNode: ({ node, cleanedText, protocol }) => {
        syncUserToolResultShell(node, ctx.helpers.protocol.isPureToolResultMessage(cleanedText, protocol));
      },
    });
  },

  continueConversation(ctx) {
    return ctx.helpers.plans.dom({
      root: ctx.root,
      composerText: ctx.continuationText,
      input: {
        selectors: ["textarea#chat-input", 'textarea[placeholder="输入消息"]', "textarea"],
        kind: "textarea",
        dispatchEvents: ["input", "change"],
      },
      send: {
        mode: "click",
        selectors: ["button.sendMessageButton", ".sendMessageButton"],
        waitForEnabled: true,
        maxWaitMs: 2500,
      },
    });
  },
};
