const toText = (value) => String(value ?? "").trim();

function readSseJsonEvents(text) {
  const raw = String(text ?? "").replace(/\r\n?/g, "\n");
  if (!raw) return [];

  const blocks = raw.split(/\n{2,}/);
  const events = [];

  for (const block of blocks) {
    const dataLines = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);

    if (!dataLines.length) continue;
    const payloadText = dataLines.join("\n").trim();
    if (!payloadText || payloadText === "[DONE]") continue;

    try {
      events.push(JSON.parse(payloadText));
    } catch {
      // ignore malformed event chunks
    }
  }

  return events;
}

function readTextParts(value) {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => readTextParts(item));
  }

  const direct = [];
  if (typeof value.text === "string") direct.push(value.text);
  if (typeof value.content === "string") direct.push(value.content);
  if (typeof value.message === "string") direct.push(value.message);
  if (Array.isArray(value.parts)) direct.push(...readTextParts(value.parts));
  if (Array.isArray(value.content)) direct.push(...readTextParts(value.content));
  return direct;
}

return {
  meta: {
    contractVersion: 2,
    adapterName: "Chat Qwen",
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

    const payload = ctx.helpers.json.parse(bodyText);
    const messages = payload?.messages;
    if (!Array.isArray(messages)) return null;

    const lastUserIdx = messages.map((item) => item?.role).lastIndexOf("user");
    if (lastUserIdx === -1) return null;

    const original = messages[lastUserIdx]?.content;
    if (typeof original !== "string") return null;

    const nextText = ctx.helpers.buildInjectedText(ctx.injectionText, original, ctx.injectionMode);
    if (nextText === original) return null;

    payload.messages[lastUserIdx].content = nextText;

    return {
      applied: true,
      bodyText: JSON.stringify(payload),
      requestMessagePath: `body-json:messages[${lastUserIdx}].content`,
      requestMessagePreview: original,
    };
  },

  extractResponse(ctx) {
    const responseText = toText(ctx.responseText);
    if (!responseText) return null;

    const events = readSseJsonEvents(responseText);
    let answerText = "";
    let protocolAwareText = "";
    let fallbackText = "";

    for (const event of events) {
      const choice = event?.choices?.[0] || {};
      const delta = choice?.delta || {};
      const answerParts = typeof delta.content === "string" ? [delta.content] : readTextParts(delta.content);
      const choiceParts = readTextParts(choice?.message?.content || choice?.message || event?.message || event);
      const allParts = [...answerParts, ...choiceParts].filter(Boolean);
      if (!allParts.length) continue;

      if (delta.phase === "answer" || !delta.phase) {
        answerText += answerParts.join("");
      }

      const joinedAllParts = allParts.join("");
      fallbackText += joinedAllParts;

      if (ctx.helpers.protocol.containsProtocolBlock(joinedAllParts, ctx.protocol)) {
        protocolAwareText += joinedAllParts;
      }
    }

    const fullText = answerText || protocolAwareText || fallbackText;
    if (!fullText) return null;

    const previewText = ctx.helpers.protocol.containsProtocolBlock(answerText, ctx.protocol)
      ? answerText
      : protocolAwareText || fullText;
    const blocks = ctx.helpers.protocol.readBlocks(previewText, ctx.protocol);

    return {
      matched: true,
      matchScore: 100,
      responseContentPath: "sse:data[*]",
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
      userSelectors: [".chat-user-message"],
      assistantSelectors: [".response-message-content"],
    });
  },

  continueConversation(ctx) {
    return ctx.helpers.plans.dom({
      root: ctx.root,
      composerText: ctx.continuationText,
      input: {
        selectors: ["textarea.message-input-textarea"],
        kind: "textarea",
        dispatchEvents: ["input", "change"],
      },
      send: {
        mode: "click",
        selectors: [
          ".chat-prompt-send-button .send-button",
          ".chat-prompt-send-button button.send-button",
          ".chat-prompt-send-button button",
        ],
        waitForEnabled: true,
        maxWaitMs: 2500,
      },
    });
  },
};
