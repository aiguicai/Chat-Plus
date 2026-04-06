const toText = (value) => String(value ?? "").trim();

function looksLikeArenaUrl(url) {
  const text = toText(url).toLowerCase();
  if (!text) return false;
  return (
    text.includes("arena.ai") ||
    text.includes("/nextjs-api/stream/") ||
    text.includes("/stream/create-evaluation") ||
    text.includes("/create-evaluation")
  );
}

function looksLikeArenaRequestPayload(bodyText) {
  const text = toText(bodyText);
  if (!text || text[0] !== "{") return false;

  try {
    const payload = JSON.parse(text);
    return Boolean(payload && payload.userMessage && typeof payload.userMessage.content === "string");
  } catch {
    return false;
  }
}

function looksLikeArenaRscStream(responseText) {
  const raw = String(responseText ?? "").replace(/\r\n?/g, "\n");
  if (!raw) return false;
  return /(^|\n)\s*a0:/.test(raw) || /(^|\n)\s*ad:/.test(raw);
}

function parseArenaRscStream(responseText, protocol, protocolHelpers) {
  const raw = String(responseText ?? "").replace(/\r\n?/g, "\n");
  if (!raw) return { fullText: "", protocolAwareText: "", done: false };

  const lines = raw.split("\n");
  let fullText = "";
  let protocolAwareText = "";
  let done = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("a0:")) {
      try {
        const text = JSON.parse(trimmed.slice(3));
        if (typeof text === "string") {
          fullText += text;
          if (protocolHelpers.containsProtocolBlock(fullText, protocol)) {
            protocolAwareText = fullText;
          }
        }
      } catch {
        // ignore malformed delta
      }
      continue;
    }

    if (trimmed.startsWith("ad:")) {
      try {
        const meta = JSON.parse(trimmed.slice(3));
        if (meta && meta.finishReason) done = true;
      } catch {
        // ignore malformed finish marker
      }
    }
  }

  return { fullText, protocolAwareText, done };
}

return {
  meta: {
    contractVersion: 2,
    adapterName: "OpenRouter Arena",
    adapterVersion: "2026.04",
    capabilities: {
      requestInjection: "json-body",
      responseExtraction: "rsc-stream",
      protocolCards: "helper",
      autoContinuation: "dom-plan",
    },
  },

  transformRequest(ctx) {
    const bodyText = ctx.helpers.text.toText(ctx.bodyText);
    if (!looksLikeArenaUrl(ctx.url) && !looksLikeArenaRequestPayload(bodyText)) return null;
    if (!ctx.injectionText || !bodyText) return null;

    const payload = ctx.helpers.json.parse(bodyText);
    if (!payload || typeof payload !== "object") return null;

    const original = payload?.userMessage?.content;
    if (typeof original !== "string") return null;

    const nextText = ctx.helpers.buildInjectedText(ctx.injectionText, original, ctx.injectionMode);
    if (nextText === original) return null;

    payload.userMessage.content = nextText;

    return {
      applied: true,
      bodyText: JSON.stringify(payload),
      requestMessagePath: "body-json:userMessage.content",
      requestMessagePreview: original,
    };
  },

  extractResponse(ctx) {
    const responseText = ctx.helpers.text.toText(ctx.responseText);
    if (!looksLikeArenaUrl(ctx.url) && !looksLikeArenaRscStream(responseText)) return null;
    if (!looksLikeArenaRscStream(responseText)) return null;

    const parsed = parseArenaRscStream(responseText, ctx.protocol, ctx.helpers.protocol);
    const fullText = parsed.fullText;
    const protocolText = parsed.protocolAwareText || fullText;
    if (!fullText && !parsed.done) return null;

    const blocks = ctx.helpers.protocol.readBlocks(protocolText, ctx.protocol);

    return {
      matched: true,
      matchScore: 100,
      responseContentPath: "rsc-stream:a0",
      responseContentPreview: protocolText || fullText,
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
      userSelectors: ["div[class*='prose prose-sm']"],
      assistantSelectors: ["div.prose"],
    });
  },

  continueConversation(ctx) {
    return ctx.helpers.plans.dom({
      root: ctx.root,
      composerText: ctx.continuationText,
      input: {
        selectors: ['textarea[name="message"]'],
        kind: "textarea",
        dispatchEvents: ["input", "change"],
      },
      send: {
        mode: "click",
        selectors: ['form button[type="submit"]'],
        waitForEnabled: true,
        maxWaitMs: 2000,
      },
    });
  },
};
