const toText = (value) => String(value ?? "").trim();

function looksLikeChatGptConversationUrl(url) {
  const text = toText(url).toLowerCase();
  return /(chatgpt\.com|chat\.openai\.com)\/backend-api\/(?:f\/)?conversation\b/.test(text);
}

function looksLikeChatGptConversationRequest(url, bodyText) {
  if (!looksLikeChatGptConversationUrl(url)) return false;

  try {
    const payload = JSON.parse(String(bodyText || ""));
    return Boolean(payload && Array.isArray(payload.messages));
  } catch {
    return false;
  }
}

function findLastUserTextPartSlot(messages) {
  if (!Array.isArray(messages)) return null;

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    const role = toText(message?.author?.role).toLowerCase();
    if (role !== "user") continue;

    const parts = message?.content?.parts;
    if (!Array.isArray(parts)) continue;

    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      if (typeof parts[partIndex] !== "string") continue;
      return { messageIndex, partIndex, text: parts[partIndex] };
    }
  }

  return null;
}

function readTextParts(value) {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];

  if (Array.isArray(value)) {
    return value.flatMap((item) => readTextParts(item));
  }

  const directKeys = ["text", "content", "value"];
  const nestedKeys = ["parts", "items", "content", "value"];
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

function readAssistantTextFromMessage(message) {
  const role = toText(message?.author?.role).toLowerCase();
  if (role !== "assistant") return "";
  return readTextParts(message?.content?.parts).join("") || readTextParts(message?.content).join("");
}

function parsePartPath(path) {
  const match = String(path || "").match(/^\/(?:v\/)?message\/content\/parts\/(\d+)(?:\/.*)?$/);
  if (!match) return null;
  return Number(match[1]);
}

function readAssistantMessageFromPayload(payload) {
  const candidates = [payload?.message, payload?.output?.message, payload?.v?.message, payload?.data?.message];
  return candidates.find((message) => toText(message?.author?.role).toLowerCase() === "assistant") || null;
}

function buildAssistantTextFromEvents(events, streamHelpers) {
  const parts = [];
  let matched = false;
  let fallbackText = "";

  events.forEach((entry) => {
    const payload = entry?.json;
    if (!payload || typeof payload !== "object") return;

    let eventMatched = false;
    const assistantMessage = readAssistantMessageFromPayload(payload);
    const assistantSnapshotText = readAssistantTextFromMessage(assistantMessage);
    if (assistantSnapshotText) {
      parts[0] = assistantSnapshotText;
      fallbackText = mergeStreamingText(fallbackText, assistantSnapshotText);
      matched = true;
      eventMatched = true;
    }

    const patchOps = streamHelpers.readPatchOperations(payload);
    if (patchOps.length) {
      patchOps.forEach((op) => {
        const partIndex = parsePartPath(op?.p);
        const patchText = readTextParts(op?.v).join("");

        if (partIndex != null) {
          if (op?.o === "append") {
            parts[partIndex] = `${String(parts[partIndex] || "")}${patchText}`;
            matched = true;
            eventMatched = true;
          } else if (op?.o === "replace" || op?.o === "add") {
            parts[partIndex] = patchText;
            matched = true;
            eventMatched = true;
          }
        }

        if (patchText) {
          fallbackText = mergeStreamingText(fallbackText, patchText);
        }
      });
    }

    if (eventMatched) return;

    const fallbackMessage =
      payload?.message && typeof payload.message === "object"
        ? payload.message
        : payload?.output?.message && typeof payload.output.message === "object"
          ? payload.output.message
          : null;
    const fallbackMessageText = readAssistantTextFromMessage(fallbackMessage);
    if (fallbackMessageText) {
      fallbackText = mergeStreamingText(fallbackText, fallbackMessageText);
      matched = true;
    }
  });

  const structuredText = parts.filter((part) => typeof part === "string").join("");
  return {
    matched: matched || Boolean(structuredText || fallbackText),
    text: structuredText || fallbackText,
  };
}

function buildSuppressedChatGptResult(protocolHelpers, protocol, previewText = "", responseContentPath = "") {
  const safePreview = protocolHelpers.stripProtocolArtifacts(previewText, protocol) || "(chatgpt-pending)";
  return {
    matched: false,
    matchScore: 0,
    responseContentPath: String(responseContentPath || "").trim(),
    responseContentPreview: safePreview,
  };
}

return {
  meta: {
    contractVersion: 2,
    adapterName: "ChatGPT",
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
    if (!ctx.injectionText || !looksLikeChatGptConversationRequest(ctx.url, bodyText)) return null;

    const payload = ctx.helpers.json.parse(bodyText);
    if (!payload) return null;

    const slot = findLastUserTextPartSlot(payload?.messages);
    if (!slot) return null;

    const nextText = ctx.helpers.buildInjectedText(ctx.injectionText, slot.text, ctx.injectionMode);
    if (nextText === slot.text) return null;

    payload.messages[slot.messageIndex].content.parts[slot.partIndex] = nextText;

    return {
      applied: true,
      bodyText: JSON.stringify(payload),
      requestMessagePath: `body-json:messages[${slot.messageIndex}].content.parts[${slot.partIndex}]`,
      requestMessagePreview: slot.text,
    };
  },

  extractResponse(ctx) {
    const responseText = String(ctx.responseText ?? "");
    if (!looksLikeChatGptConversationUrl(ctx.url) || !responseText.includes("data:")) return null;

    const events = ctx.helpers.stream.readSseEvents(responseText);
    if (!events.length) return null;

    const parsed = buildAssistantTextFromEvents(events, ctx.helpers.stream);
    const responseContentPath = "sse:assistant.message.content.parts[*]";
    const fullText = String(parsed.text || "");
    if (!parsed.matched) {
      return buildSuppressedChatGptResult(ctx.helpers.protocol, ctx.protocol, fullText, responseContentPath);
    }
    if (!fullText) return null;
    if (ctx.helpers.protocol.hasIncompleteProtocolBlock(fullText, ctx.protocol)) {
      return buildSuppressedChatGptResult(ctx.helpers.protocol, ctx.protocol, fullText, responseContentPath);
    }

    const blocks = ctx.helpers.protocol.readBlocks(fullText, ctx.protocol);
    const hasCodeModeBlock = ctx.helpers.protocol.hasCompleteWrappedBlock(
      fullText,
      ctx.protocol?.codeMode?.begin || "",
      ctx.protocol?.codeMode?.end || "",
    );
    const hasToolCallBlock = Boolean(blocks.toolCallRaw);
    const hasToolResultBlock = Boolean(blocks.toolResultRaw);

    if (ctx.helpers.protocol.containsProtocolBlock(fullText, ctx.protocol) && !hasCodeModeBlock && !hasToolCallBlock && !hasToolResultBlock) {
      return buildSuppressedChatGptResult(ctx.helpers.protocol, ctx.protocol, fullText, responseContentPath);
    }

    return {
      matched: true,
      matchScore: hasCodeModeBlock ? 120 : hasToolCallBlock || hasToolResultBlock ? 110 : 100,
      responseContentPath,
      responseContentPreview: fullText,
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
      userSelectors: [
        '[data-message-author-role="user"] [data-message-content="true"]',
        '[data-message-author-role="user"]',
      ],
      assistantSelectors: [
        '[data-message-author-role="assistant"] [data-message-content="true"]',
        '[data-message-author-role="assistant"]',
      ],
    });
  },

  continueConversation(ctx) {
    return ctx.helpers.plans.dom({
      root: ctx.root,
      composerText: ctx.continuationText,
      input: {
        selectors: [
          "#prompt-textarea.ProseMirror",
          'div#prompt-textarea[contenteditable="true"]',
          'textarea[name="prompt-textarea"]',
        ],
        kind: "contenteditable",
        dispatchEvents: ["input", "change"],
      },
      send: {
        mode: "click",
        selectors: ['button[data-testid="send-button"]', "#composer-submit-button"],
        waitForEnabled: true,
        maxWaitMs: 2500,
        beforeSendDelayMs: 240,
      },
    });
  },
};
