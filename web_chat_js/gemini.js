const toText = (value) => String(value ?? "").trim();

function looksLikeGeminiStreamUrl(url) {
  const text = toText(url).toLowerCase();
  if (!text) return false;
  return text.includes("gemini.google.com") && text.includes("bardfrontendservice/streamgenerate");
}

function looksLikeGeminiStreamResponse(responseText) {
  const text = String(responseText ?? "").replace(/\r\n?/g, "\n").trimStart();
  if (!text) return false;
  return text.startsWith(")]}'") || /^\d+\n/.test(text) || text.includes('"wrb.fr"');
}

function stripGeminiAntiHijackPrefix(responseText) {
  const text = String(responseText ?? "").replace(/\r\n?/g, "\n");
  return text.startsWith(")]}'") ? text.slice(4) : text;
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

function getCharCountForUtf16Units(source, startIndex, utf16Units) {
  let count = 0;
  let units = 0;

  while (units < utf16Units && startIndex + count < source.length) {
    const codePoint = source.codePointAt(startIndex + count);
    if (codePoint == null) break;

    const unitSize = codePoint > 0xffff ? 2 : 1;
    if (units + unitSize > utf16Units) break;

    units += unitSize;
    count += codePoint > 0xffff ? 2 : 1;
  }

  return { count, units };
}

function parseGeminiFramedEntries(responseText) {
  const content = stripGeminiAntiHijackPrefix(responseText).replace(/^\s+/, "");
  const entries = [];
  let offset = 0;

  while (offset < content.length) {
    while (offset < content.length && /\s/.test(content[offset])) {
      offset += 1;
    }
    if (offset >= content.length) break;

    const match = /^(\d+)\n/.exec(content.slice(offset));
    if (!match) break;

    const frameUnits = Number(match[1] || 0);
    if (!Number.isFinite(frameUnits) || frameUnits <= 0) break;

    const frameStart = offset + match[1].length;
    const frameSize = getCharCountForUtf16Units(content, frameStart, frameUnits);
    if (frameSize.units < frameUnits) break;

    const frameEnd = frameStart + frameSize.count;
    const chunk = content.slice(frameStart, frameEnd).trim();
    offset = frameEnd;

    if (!chunk) continue;

    try {
      const parsed = JSON.parse(chunk);
      if (Array.isArray(parsed)) {
        entries.push(...parsed);
      } else if (parsed && typeof parsed === "object") {
        entries.push(parsed);
      }
    } catch {
      // ignore malformed frame payloads
    }
  }

  return entries;
}

function parseGeminiJsonEntries(responseText) {
  const text = stripGeminiAntiHijackPrefix(responseText).replace(/^\s+/, "");
  const framed = parseGeminiFramedEntries(text);
  if (framed.length) return framed;

  try {
    const parsed = JSON.parse(text.trim());
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return [parsed];
  } catch {
    // fall through to line-based parsing
  }

  const entries = [];
  text.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        entries.push(...parsed);
      } else if (parsed && typeof parsed === "object") {
        entries.push(parsed);
      }
    } catch {
      // ignore malformed lines
    }
  });

  return entries;
}

function readStringParts(value) {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];

  if (Array.isArray(value)) {
    return value.flatMap((item) => readStringParts(item));
  }

  const parts = [];
  ["text", "content", "message", "value"].forEach((key) => {
    if (typeof value[key] === "string") {
      parts.push(value[key]);
    }
  });
  ["parts", "content", "items", "children", "message"].forEach((key) => {
    const candidate = value[key];
    if (Array.isArray(candidate)) {
      parts.push(...readStringParts(candidate));
      return;
    }
    if (candidate && typeof candidate === "object") {
      parts.push(...readStringParts(candidate));
    }
  });

  return parts;
}

function readGeminiCandidateText(candidate) {
  if (!Array.isArray(candidate)) return "";

  const primaryNode = candidate[1];
  if (Array.isArray(primaryNode) && typeof primaryNode[0] === "string") {
    return primaryNode[0];
  }
  if (typeof primaryNode === "string") {
    return primaryNode;
  }

  return readStringParts(primaryNode).join("");
}

function extractGeminiPayloadEntry(entry) {
  if (!Array.isArray(entry) || entry.length < 3) return null;
  if (typeof entry[2] !== "string") return null;

  try {
    const payload = JSON.parse(entry[2]);
    const firstCandidate = payload?.[4]?.[0];
    if (!Array.isArray(firstCandidate)) return null;

    const text = readGeminiCandidateText(firstCandidate);
    if (!text) return null;

    return {
      text,
      conversationId: payload?.[1]?.[0] || "",
      responseId: payload?.[1]?.[1] || "",
      choiceId: firstCandidate[0] || "",
    };
  } catch {
    return null;
  }
}

function buildSuppressedGeminiResult(protocolHelpers, protocol, previewText = "", responseContentPath = "") {
  const safePreview = protocolHelpers.stripProtocolArtifacts(previewText, protocol) || "(gemini-pending)";
  return {
    matched: false,
    matchScore: 0,
    responseContentPath: String(responseContentPath || "").trim(),
    responseContentPreview: safePreview,
  };
}

function stripLeadingSpeakerLabel(text, labels) {
  const source = String(text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!source) return "";

  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const next = source.replace(new RegExp(`^${escaped}\\s*\n+`, "i"), "").trim();
    if (next !== source) return next;
  }

  return source;
}

return {
  meta: {
    contractVersion: 2,
    adapterName: "Google Gemini",
    adapterVersion: "2026.04",
    capabilities: {
      requestInjection: "dom-fallback",
      responseExtraction: "framed-json-stream",
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
    if (!looksLikeGeminiStreamUrl(ctx.url) && !looksLikeGeminiStreamResponse(responseText)) return null;

    const responseContentPath = "framed-json:item[2]->payload[4][0][1][0]";
    const entries = parseGeminiJsonEntries(responseText);
    if (!entries.length) {
      return buildSuppressedGeminiResult(ctx.helpers.protocol, ctx.protocol, responseText, responseContentPath);
    }

    let bestText = "";
    let protocolAwareText = "";

    entries.forEach((entry) => {
      const payload = extractGeminiPayloadEntry(entry);
      if (!payload?.text) return;

      bestText = preferLongerText(bestText, payload.text);
      if (ctx.helpers.protocol.containsProtocolBlock(payload.text, ctx.protocol)) {
        protocolAwareText = preferLongerText(protocolAwareText, payload.text);
      }
    });

    const previewText = protocolAwareText || bestText;
    if (!previewText) {
      return buildSuppressedGeminiResult(ctx.helpers.protocol, ctx.protocol, responseText, responseContentPath);
    }
    if (ctx.helpers.protocol.hasIncompleteProtocolBlock(previewText, ctx.protocol)) {
      return buildSuppressedGeminiResult(ctx.helpers.protocol, ctx.protocol, previewText, responseContentPath);
    }

    const blocks = ctx.helpers.protocol.readBlocks(previewText, ctx.protocol);
    const hasCodeModeBlock = ctx.helpers.protocol.hasCompleteWrappedBlock(
      previewText,
      ctx.protocol?.codeMode?.begin || "",
      ctx.protocol?.codeMode?.end || "",
    );

    return {
      matched: true,
      matchScore: hasCodeModeBlock ? 120 : blocks.toolCallRaw || blocks.toolResultRaw ? 110 : 100,
      responseContentPath,
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
        "user-query .query-text",
        'message-content[owner-role="USER"] .query-text',
      ],
      assistantSelectors: [
        "model-response structured-content-container",
        "model-response .model-response-text",
        'message-content[owner-role="MODEL"] .model-response-text',
        "model-response .markdown.markdown-main-panel",
      ],
      normalizeUserText(text) {
        return stripLeadingSpeakerLabel(text, ["你说", "You said"]);
      },
      normalizeAssistantText(text) {
        return stripLeadingSpeakerLabel(text, ["Gemini 说", "Gemini said", "Gemini says"]);
      },
    });
  },

  continueConversation(ctx) {
    return ctx.helpers.plans.dom({
      root: ctx.root,
      composerText: ctx.continuationText,
      input: {
        selectors: [
          'div.ql-editor[role="textbox"][aria-label="为 Gemini 输入提示"]',
          'div.ql-editor[role="textbox"][aria-label*="Gemini"]',
          "div.ql-editor.textarea.new-input-ui[contenteditable='true']",
          "div.ql-editor[contenteditable='true'][role='textbox']",
        ],
        kind: "contenteditable",
        dispatchEvents: ["input", "change"],
      },
      send: {
        mode: "click",
        selectors: [
          'button.send-button[aria-label="发送"]',
          'button.send-button[aria-label="Send message"]',
          "button.send-button.submit",
          ".send-button-container button.send-button",
        ],
        waitForEnabled: true,
        maxWaitMs: 2500,
        beforeSendDelayMs: 180,
      },
    });
  },
};
