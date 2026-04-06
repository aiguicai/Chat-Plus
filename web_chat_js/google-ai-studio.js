const toText = (value) => String(value ?? "").trim();

function looksLikeGoogleAiStudioRpcUrl(url) {
  const text = toText(url).toLowerCase();
  return text.includes("alkalimakersuite-pa.clients6.google.com") && text.includes("makersuiteservice");
}

function isGenerateContentUrl(url) {
  return toText(url).toLowerCase().includes("/makersuiteservice/generatecontent");
}

function isCreatePromptUrl(url) {
  return toText(url).toLowerCase().includes("/makersuiteservice/createprompt");
}

function isUpdatePromptUrl(url) {
  return toText(url).toLowerCase().includes("/makersuiteservice/updateprompt");
}

function isCountTokensUrl(url) {
  return toText(url).toLowerCase().includes("/makersuiteservice/counttokens");
}

const GOOGLE_AI_STUDIO_ROLE_INDEX = 8;

function formatArrayPath(path) {
  return path.reduce((result, segment) => `${result}[${segment}]`, "");
}

function isHumanTextCandidate(text, role) {
  const source = toText(text);
  if (!source) return false;
  if (source === role) return false;
  if (/^prompts\//i.test(source)) return false;
  if (/^(models\/|https?:\/\/)/i.test(source)) return false;
  if (/^[\d\s:./_-]+$/.test(source)) return false;
  return /[\u4e00-\u9fffA-Za-z]/.test(source);
}

function collectTextSlots(node, path, slots, role) {
  if (!Array.isArray(node)) return;

  if (typeof node[0] === "string" && isHumanTextCandidate(node[0], role)) {
    slots.push({ parent: node, index: 0, path: path.concat(0), text: node[0] });
  }

  if (node.length >= 2 && node[0] == null && typeof node[1] === "string" && isHumanTextCandidate(node[1], role)) {
    slots.push({ parent: node, index: 1, path: path.concat(1), text: node[1] });
  }

  node.forEach((child, index) => {
    collectTextSlots(child, path.concat(index), slots, role);
  });
}

function findLastRoleTextSlot(payload, role) {
  let best = null;

  function visit(node, path) {
    if (!Array.isArray(node)) return;

    if (node.includes(role)) {
      const slots = [];
      collectTextSlots(node, path, slots, role);
      if (slots.length) {
        best = slots[slots.length - 1];
      }
    }

    node.forEach((child, index) => {
      visit(child, path.concat(index));
    });
  }

  visit(payload, []);
  return best;
}

function looksLikeStrictMessageLeaf(node, role) {
  return Array.isArray(node) && typeof node[0] === "string" && node.length > GOOGLE_AI_STUDIO_ROLE_INDEX && node[GOOGLE_AI_STUDIO_ROLE_INDEX] === role;
}

function findStrictConversationMessageTextSlot(payload, role) {
  let best = null;

  function visit(node, path) {
    if (!Array.isArray(node)) return;

    if (looksLikeStrictMessageLeaf(node, role) && isHumanTextCandidate(node[0], role)) {
      best = { parent: node, index: 0, path: path.concat(0), text: node[0] };
    }

    node.forEach((child, index) => {
      visit(child, path.concat(index));
    });
  }

  visit(payload, []);
  return best;
}

function findBestModelTextSlot(payload) {
  const strictConversationSlot = findStrictConversationMessageTextSlot(payload, "model");
  if (strictConversationSlot) return strictConversationSlot;
  return findLastRoleTextSlot(payload, "model");
}

function looksLikeRpcTail(text) {
  const source = String(text ?? "").trim();
  if (!source) return false;

  return (
    /^["'\],\s:null\[\]{}]+$/.test(source) ||
    /^\]\],\s*(null|"(?:model|user)")/.test(source) ||
    /^",\s*\]\],\s*"(?:model|user)"/.test(source) ||
    /^(?:,\s*null|\s*\]\]|\s*\}\]|\s*\]\}){2,}/.test(source)
  );
}

function truncateAfterProtocolEnd(text, begin, end) {
  const source = String(text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!source || !begin || !end) return source;

  const beginIndex = source.indexOf(begin);
  if (beginIndex < 0) return source;

  const endIndex = source.indexOf(end, beginIndex + begin.length);
  if (endIndex < 0) return source;

  const afterEnd = source.slice(endIndex + end.length);
  if (!looksLikeRpcTail(afterEnd)) return source;
  return source.slice(0, endIndex + end.length).trim();
}

function normalizeGoogleAiStudioResponseText(text, protocol) {
  let source = String(text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!source) return "";

  const protocolPairs = [
    [protocol?.codeMode?.begin, protocol?.codeMode?.end],
    [protocol?.toolCall?.begin, protocol?.toolCall?.end],
    [protocol?.toolResult?.begin, protocol?.toolResult?.end],
  ];

  for (const [begin, end] of protocolPairs) {
    source = truncateAfterProtocolEnd(source, String(begin || ""), String(end || ""));
  }

  const genericTailMarkers = [
    '"]],"model"',
    '"]],"user"',
    ']],"model"',
    ']],"user"',
    '"model"]]],null,',
    '"user"]]],null,',
  ];

  let cutIndex = -1;
  for (const marker of genericTailMarkers) {
    const index = source.indexOf(marker);
    if (index <= 0) continue;
    cutIndex = cutIndex < 0 ? index : Math.min(cutIndex, index);
  }

  if (cutIndex > 0) {
    source = source.slice(0, cutIndex).trim();
  }

  return source;
}

function looksLikeCorruptedCodeModeSource(text) {
  const source = String(text ?? "").trim();
  if (!source) return true;

  return (
    source.includes('"]],"model"') ||
    source.includes('"]],"user"') ||
    source.includes(']],"model"') ||
    source.includes(']],"user"') ||
    source.includes('"model"]]],null,') ||
    source.includes('"user"]]],null,') ||
    source.includes("null,[") ||
    /^["'`]\s*\\n/.test(source) ||
    (/^["'`].*\\[nrt"\\]/.test(source) && !source.includes("\n")) ||
    /^\s*["'`].*["'`]\s*(?:,\s*null|\]\])/.test(source)
  );
}

function buildSuppressedGoogleAiStudioResult(protocolHelpers, protocol, previewText = "", responseContentPath = "") {
  const safePreview = protocolHelpers.stripProtocolArtifacts(previewText, protocol) || "(google-ai-studio-pending)";
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
    adapterName: "Google AI Studio",
    adapterVersion: "2026.04",
    capabilities: {
      requestInjection: "dom-fallback",
      responseExtraction: "json-rpc",
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
    if (!looksLikeGoogleAiStudioRpcUrl(ctx.url)) return null;
    if (isCountTokensUrl(ctx.url)) {
      return buildSuppressedGoogleAiStudioResult(ctx.helpers.protocol, ctx.protocol, "");
    }

    const payload = ctx.helpers.json.parse(responseText);
    if (!payload) {
      return buildSuppressedGoogleAiStudioResult(ctx.helpers.protocol, ctx.protocol, "");
    }

    const slot = findBestModelTextSlot(payload);
    if (!slot || !slot.parent) {
      return buildSuppressedGoogleAiStudioResult(ctx.helpers.protocol, ctx.protocol, "");
    }

    const responseContentPath = `json${formatArrayPath(slot.path)}`;
    const rawSlotText = String(slot.parent[slot.index] ?? "");
    const previewText = normalizeGoogleAiStudioResponseText(rawSlotText, ctx.protocol);
    if (!previewText) {
      return buildSuppressedGoogleAiStudioResult(ctx.helpers.protocol, ctx.protocol, rawSlotText, responseContentPath);
    }
    if (ctx.helpers.protocol.hasIncompleteProtocolBlock(previewText, ctx.protocol)) {
      return buildSuppressedGoogleAiStudioResult(ctx.helpers.protocol, ctx.protocol, previewText, responseContentPath);
    }

    const blocks = ctx.helpers.protocol.readBlocks(previewText, ctx.protocol);
    const hasCodeModeBlock = ctx.helpers.protocol.hasCompleteWrappedBlock(
      previewText,
      ctx.protocol?.codeMode?.begin || "",
      ctx.protocol?.codeMode?.end || "",
    );
    const hasToolCallBlock = Boolean(blocks.toolCallRaw);
    const hasToolResultBlock = Boolean(blocks.toolResultRaw);
    const matchScore = hasCodeModeBlock
      ? 120
      : isUpdatePromptUrl(ctx.url)
        ? 110
        : isGenerateContentUrl(ctx.url)
          ? 105
          : isCreatePromptUrl(ctx.url)
            ? 100
            : 90;

    if (hasCodeModeBlock && looksLikeCorruptedCodeModeSource(blocks.codeModeRaw)) {
      return buildSuppressedGoogleAiStudioResult(ctx.helpers.protocol, ctx.protocol, previewText, responseContentPath);
    }

    if (!hasCodeModeBlock && !hasToolCallBlock && !hasToolResultBlock && !isHumanTextCandidate(previewText, "model")) {
      return buildSuppressedGoogleAiStudioResult(ctx.helpers.protocol, ctx.protocol, previewText, responseContentPath);
    }

    return {
      matched: true,
      matchScore,
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
      userSelectors: [".chat-turn-container.user .user-prompt-container ms-prompt-chunk"],
      assistantSelectors: [".chat-turn-container.model .model-prompt-container ms-prompt-chunk"],
    });
  },

  continueConversation(ctx) {
    return ctx.helpers.plans.dom({
      root: ctx.root,
      composerText: ctx.continuationText,
      input: {
        selectors: ['textarea[aria-label="Enter a prompt"]', "ms-prompt-box textarea", "footer textarea"],
        kind: "textarea",
        dispatchEvents: ["input", "change"],
      },
      send: {
        mode: "click",
        selectors: [
          "button.ctrl-enter-submits",
          "ms-prompt-box button.ctrl-enter-submits",
          "footer button.ctrl-enter-submits",
        ],
        waitForEnabled: true,
        maxWaitMs: 2500,
      },
    });
  },
};
