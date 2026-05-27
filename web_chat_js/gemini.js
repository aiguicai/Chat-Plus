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

    const frameStart = offset + match[0].length;
    const frameSize = getCharCountForUtf16Units(content, frameStart, frameUnits);
    if (frameSize.units < frameUnits) break;

    const frameEnd = frameStart + frameSize.count;
    const chunk = content.slice(frameStart, frameEnd).trim();
    offset = frameEnd;

    if (!chunk) continue;

    try {
      const parsed = JSON.parse(chunk);
      appendGeminiParsedEntries(entries, parsed);
    } catch {
      // ignore malformed frame payloads
    }
  }

  return entries;
}

function looksLikeGeminiRpcEntry(value) {
  return (
    Array.isArray(value) &&
    typeof value[0] === "string" &&
    (value[0] === "wrb.fr" || typeof value[2] === "string")
  );
}

function appendGeminiParsedEntries(entries, parsed) {
  if (!parsed) return;
  if (looksLikeGeminiRpcEntry(parsed)) {
    entries.push(parsed);
    return;
  }
  if (Array.isArray(parsed)) {
    parsed.forEach((item) => appendGeminiParsedEntries(entries, item));
    return;
  }
  if (typeof parsed === "object") {
    entries.push(parsed);
  }
}

function parseGeminiJsonEntries(responseText) {
  const text = stripGeminiAntiHijackPrefix(responseText).replace(/^\s+/, "");
  const framed = parseGeminiFramedEntries(text);
  if (framed.length) return framed;

  try {
    const parsed = JSON.parse(text.trim());
    const entries = [];
    appendGeminiParsedEntries(entries, parsed);
    if (entries.length) return entries;
  } catch {
    // fall through to line-based parsing
  }

  const entries = [];
  text.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const parsed = JSON.parse(trimmed);
      appendGeminiParsedEntries(entries, parsed);
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

function readGeminiCandidateListText(candidates) {
  if (!Array.isArray(candidates)) return "";

  return candidates.reduce((best, candidate) => {
    const text = readGeminiCandidateText(candidate);
    return preferLongerText(best, text);
  }, "");
}

function readProtocolAwareFallbackText(value, protocolHelpers, protocol) {
  let best = "";

  function visit(node) {
    if (typeof node === "string") {
      if (protocolHelpers.containsProtocolBlock(node, protocol)) {
        best = preferLongerText(best, node);
      }
      return;
    }
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    Object.values(node).forEach(visit);
  }

  visit(value);
  return best;
}

function readGeminiPayloadText(payload, protocolHelpers, protocol) {
  const primaryText = readGeminiCandidateListText(payload?.[4]);
  if (primaryText) return primaryText;

  const protocolText = readProtocolAwareFallbackText(payload, protocolHelpers, protocol);
  if (protocolText) return protocolText;

  return "";
}

function readGeminiPayloadEntry(entry, protocolHelpers, protocol) {
  if (!Array.isArray(entry) || entry.length < 3) return null;

  try {
    const payloadText = entry.find((item) => {
      if (typeof item !== "string") return false;
      const trimmed = item.trim();
      return trimmed.startsWith("[") || trimmed.startsWith("{");
    });
    if (typeof payloadText !== "string") return null;

    const payload = JSON.parse(payloadText);
    const text = readGeminiPayloadText(payload, protocolHelpers, protocol);
    if (!text) return null;

    return {
      text,
      conversationId: payload?.[1]?.[0] || "",
      responseId: payload?.[1]?.[1] || "",
      choiceId: Array.isArray(payload?.[4]?.[0]) ? payload[4][0][0] || "" : "",
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

function queryUniqueNodes(root, selectors) {
  const nodes = [];
  const seen = new Set();

  selectors.forEach((selector) => {
    try {
      root.querySelectorAll(selector).forEach((node) => {
        if (seen.has(node)) return;
        seen.add(node);
        nodes.push(node);
      });
    } catch {
      // ignore selector errors from site DOM changes
    }
  });

  return nodes;
}

function isGeminiProcessingAssistantNode(node) {
  if (!node || node.nodeType !== 1) return false;
  if (node.classList.contains("processing-state-visible")) return true;
  return typeof node.closest === "function" && Boolean(node.closest(".processing-state-visible"));
}

function isGeminiActivelyGenerating(root) {
  const selectors = [
    "button.send-button.stop",
    "gem-icon-button.send-button.stop",
    ".send-button.stop",
    'button[aria-label*="Stop"]',
    'button[aria-label*="停止"]',
  ];

  return selectors.some((selector) => {
    try {
      return Boolean(root.querySelector(selector));
    } catch {
      return false;
    }
  });
}

return {
  meta: {
    contractVersion: 2,
    adapterName: "Google Gemini",
    capabilities: {
      requestInjection: "none",
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
    const urlText = toText(ctx.url);
    if (urlText ? !looksLikeGeminiStreamUrl(urlText) : !looksLikeGeminiStreamResponse(responseText)) return null;

    const responseContentPath = "framed-json:item[2]->payload[4][0][1][0]";
    const entries = parseGeminiJsonEntries(responseText);
    if (!entries.length) {
      return buildSuppressedGeminiResult(ctx.helpers.protocol, ctx.protocol, responseText, responseContentPath);
    }

    let bestText = "";
    let protocolAwareText = "";

    entries.forEach((entry) => {
      const payload = readGeminiPayloadEntry(entry, ctx.helpers.protocol, ctx.protocol);
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
    const root = ctx.root || document;
    const assistantSelectors = [
      "model-response structured-content-container",
      "model-response .model-response-text",
      'message-content[owner-role="MODEL"] .model-response-text',
      "model-response .markdown.markdown-main-panel",
    ];
    const latestAssistantNode = queryUniqueNodes(root, assistantSelectors).slice(-1)[0] || null;
    const responseContentPreview = String(ctx.responseContentPreview || "").trim();
    const activelyGenerating = isGeminiActivelyGenerating(root);

    return ctx.helpers.ui.decorateProtocolBubbles({
      root,
      protocol: ctx.protocol,
      userSelectors: [
        "user-query .query-text",
        'message-content[owner-role="USER"] .query-text',
      ],
      assistantSelectors,
      normalizeUserText(text) {
        return stripLeadingSpeakerLabel(text, ["你说", "You said"]);
      },
      normalizeAssistantText(text, node) {
        if (responseContentPreview && latestAssistantNode && node === latestAssistantNode) {
          return responseContentPreview;
        }

        const normalized = stripLeadingSpeakerLabel(text, ["Gemini 说", "Gemini said", "Gemini says"]);
        if (activelyGenerating && isGeminiProcessingAssistantNode(node)) {
          return ctx.helpers.protocol.stripProtocolArtifacts(normalized, ctx.protocol);
        }
        return normalized;
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
