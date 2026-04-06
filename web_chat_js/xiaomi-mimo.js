const toText = (value) => String(value ?? "").trim();

function looksLikeMimoChatUrl(url) {
  const text = toText(url).toLowerCase();
  return text.includes("/open-apis/bot/chat");
}

function looksLikeMimoRequestPayload(bodyText) {
  const text = toText(bodyText);
  if (!text || text[0] !== "{") return false;

  try {
    const payload = JSON.parse(text);
    return Boolean(payload && typeof payload.query === "string");
  } catch {
    return false;
  }
}

function looksLikeMimoSse(responseText) {
  const raw = String(responseText ?? "").replace(/\r\n?/g, "\n");
  if (!raw) return false;
  return /(^|\n)\s*event:\s*message\b/.test(raw) && /"type"\s*:\s*"text"/.test(raw);
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

function stripMimoThinkingText(text) {
  let output = String(text ?? "").replace(/\u0000/g, "");
  if (!output) return "";

  output = output.replace(/<think>[\s\S]*?<\/think>/g, "");

  const openIndex = output.lastIndexOf("<think>");
  const closeIndex = output.lastIndexOf("</think>");
  if (openIndex >= 0 && openIndex > closeIndex) {
    output = output.slice(0, openIndex);
  }

  return output.trim();
}

function normalizeAssistantBubbleText(text) {
  return String(text ?? "")
    .replace(/^\s*已深度思考（用时[^）]+）\s*/u, "")
    .trim();
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

  const activeAttr = "data-chat-plus-tool-result-shell";
  const originalStyleAttr = "data-chat-plus-tool-result-shell-style";

  if (enabled) {
    if (!node.hasAttribute(activeAttr)) {
      node.setAttribute(originalStyleAttr, node.getAttribute("style") || "");
    }

    node.setAttribute(activeAttr, "1");
    node.style.setProperty("background", "transparent", "important");
    node.style.setProperty("background-color", "transparent", "important");
    node.style.setProperty("box-shadow", "none", "important");
    node.style.setProperty("border", "0", "important");
    node.style.setProperty("padding", "0", "important");
    node.style.setProperty("border-radius", "0", "important");
    return;
  }

  if (!node.hasAttribute(activeAttr)) return;

  restoreInlineStyle(node, node.getAttribute(originalStyleAttr) || "");
  node.removeAttribute(activeAttr);
  node.removeAttribute(originalStyleAttr);
}

return {
  meta: {
    contractVersion: 2,
    adapterName: "Xiaomi Mimo",
    adapterVersion: "2026.04",
    capabilities: {
      requestInjection: "json-body",
      responseExtraction: "sse",
      protocolCards: "helper",
      autoContinuation: "dom-plan",
    },
  },

  transformRequest(ctx) {
    const bodyText = ctx.helpers.text.toText(ctx.bodyText);
    if (!ctx.injectionText || !bodyText) return null;
    if (!looksLikeMimoChatUrl(ctx.url) && !looksLikeMimoRequestPayload(bodyText)) return null;

    const payload = ctx.helpers.json.parse(bodyText);
    const original = payload?.query;
    if (typeof original !== "string") return null;

    const nextText = ctx.helpers.buildInjectedText(ctx.injectionText, original, ctx.injectionMode);
    if (nextText === original) return null;

    payload.query = nextText;

    return {
      applied: true,
      bodyText: JSON.stringify(payload),
      requestMessagePath: "body-json:query",
      requestMessagePreview: original,
    };
  },

  extractResponse(ctx) {
    const responseText = toText(ctx.responseText);
    if (!responseText) return null;
    if (!looksLikeMimoChatUrl(ctx.url) && !looksLikeMimoSse(responseText)) return null;

    const events = ctx.helpers.stream.readSseEvents(responseText);
    if (!events.length) return null;

    let fullText = "";
    for (const entry of events) {
      const data = entry?.json;
      if (entry.event !== "message") continue;
      if (!data || typeof data !== "object") continue;
      if (String(data?.type || "").trim() !== "text") continue;
      if (typeof data?.content !== "string") continue;
      fullText = mergeStreamingText(fullText, data.content);
    }

    const previewText = stripMimoThinkingText(fullText);
    if (!previewText) return null;
    const blocks = ctx.helpers.protocol.readBlocks(previewText, ctx.protocol);

    return {
      matched: true,
      matchScore: 100,
      responseContentPath: "sse:event=message.data.content",
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
      userSelectors: ["#message-list .group.flex-row-reverse .whitespace-pre-wrap"],
      assistantSelectors: ["#message-list .group.flex-row .markdown-prose"],
      normalizeAssistantText: (text) => normalizeAssistantBubbleText(text),
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
        selectors: [
          'textarea[placeholder="有问题，尽管问，Shift + Enter 换行"]',
          ".dialogue-container textarea",
          "textarea",
        ],
        kind: "textarea",
        dispatchEvents: ["input", "change"],
      },
      send: {
        mode: "click",
        selectors: [
          ".dialogue-container .flex.flex-shrink-0.items-center.gap-3 > button:last-of-type",
          ".dialogue-container .rounded-full.bg-black\\/90",
          ".dialogue-container button.rounded-full:last-of-type",
        ],
        waitForEnabled: true,
        maxWaitMs: 2500,
      },
    });
  },
};
