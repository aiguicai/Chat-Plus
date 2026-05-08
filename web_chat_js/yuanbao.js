const toText = (value) => String(value ?? "").trim();

function parseSseEvents(responseText) {
  const raw = String(responseText ?? "").replace(/\r\n?/g, "\n");
  if (!raw) return [];

  const lines = raw.split("\n");
  const events = [];

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (!payload || payload === "[DONE]") continue;
    if (payload.startsWith("[") && payload.endsWith("]")) continue;

    try {
      events.push(JSON.parse(payload));
    } catch {
      // ignore malformed data lines
    }
  }

  return events;
}

return {
  meta: {
    contractVersion: 2,
    adapterName: "yuanbao",
    adapterVersion: "2026.05",
    capabilities: {
      requestInjection: "json-body",
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

    const events = parseSseEvents(responseText);
    let fullText = "";

    for (const event of events) {
      if (event.type === "text" && typeof event.msg === "string") {
        fullText += event.msg;
      }
    }

    if (!fullText) return null;

    const previewText = fullText;
    const blocks = ctx.helpers.protocol.readBlocks(previewText, ctx.protocol);

    return {
      matched: true,
      matchScore: 100,
      responseContentPath: "sse:data[type=text].msg",
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
      userSelectors: [
        ".agent-chat__list__item--human .hyc-content-text",
      ],
      assistantSelectors: [
        ".agent-chat__list__item--ai .hyc-common-markdown",
      ],
      normalizeAssistantText(text, node) {
        if (node.classList.contains("hyc-common-markdown-style-cot")) {
          return "";
        }
        return text;
      },
    });
  },

  continueConversation(ctx) {
    return ctx.helpers.plans.dom({
      root: ctx.root,
      composerText: ctx.continuationText,
      input: {
        selectors: ["#search-bar .ql-editor"],
        kind: "contenteditable",
        dispatchEvents: ["input", "change"],
      },
      send: {
        mode: "click",
        selectors: ["#yuanbao-send-btn"],
        waitForEnabled: true,
        maxWaitMs: 3000,
      },
    });
  },
};
