const toText = (value) => String(value ?? "").trim();

function looksLikeDeepSeekCompletionRequest(url, bodyText) {
  const targetUrl = toText(url).toLowerCase();
  if (!/chat\.deepseek\.com\/api\/v0\/chat\/completion\b/.test(targetUrl)) return false;

  try {
    const payload = JSON.parse(String(bodyText || ""));
    return Boolean(payload && typeof payload.prompt === "string");
  } catch {
    return false;
  }
}

function looksLikeDeepSeekCompletionResponse(url, responseText) {
  const targetUrl = toText(url).toLowerCase();
  if (!/chat\.deepseek\.com\/api\/v0\/chat\/completion\b/.test(targetUrl)) return false;
  return String(responseText ?? "").includes("data:");
}

function queryUniqueNodes(root, selectors) {
  const host = root || document;
  const seen = new Set();
  const nodes = [];
  (Array.isArray(selectors) ? selectors : []).forEach((selector) => {
    try {
      host.querySelectorAll(selector).forEach((node) => {
        if (!node || node.nodeType !== 1 || seen.has(node)) return;
        seen.add(node);
        nodes.push(node);
      });
    } catch {
      // ignore invalid selector
    }
  });
  return nodes;
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

function readResponseFragments(value) {
  if (!value || typeof value !== "object") return [];

  const candidates = [
    value?.response?.fragments,
    value?.message?.response?.fragments,
    value?.message?.fragments,
    value?.fragments,
    value?.value?.response?.fragments,
    value?.value?.message?.response?.fragments,
    value?.value?.message?.fragments,
    value?.value?.fragments,
    value?.v?.response?.fragments,
    value?.v?.message?.response?.fragments,
    value?.v?.message?.fragments,
    value?.v?.fragments,
    value?.data?.response?.fragments,
    value?.data?.message?.fragments,
  ];

  return candidates.find((candidate) => Array.isArray(candidate)) || [];
}

function normalizeFragment(fragment) {
  if (!fragment || typeof fragment !== "object") {
    return { type: "", content: "" };
  }

  return {
    type: typeof fragment.type === "string" ? fragment.type : "",
    content: typeof fragment.content === "string" ? fragment.content : "",
  };
}

function isVisibleAssistantFragmentType(type) {
  return ["RESPONSE", "TEMPLATE_RESPONSE"].includes(toText(type).toUpperCase());
}

function readResponseTextFromFragments(fragments) {
  if (!Array.isArray(fragments)) return "";

  const textParts = [];
  fragments.forEach((fragment) => {
    if (!isVisibleAssistantFragmentType(fragment?.type)) return;
    if (typeof fragment?.content === "string") {
      textParts.push(fragment.content);
    }
  });

  return joinTextSegmentsWithBreaks(textParts);
}

function readResponseTextFromPayload(payload) {
  return readResponseTextFromFragments(readResponseFragments(payload));
}

function parseFragmentPath(path) {
  const source = String(path || "").trim().replace(/^\/+/, "");
  if (!source) return null;

  if (/(?:^|\/)fragments$/.test(source)) {
    return {
      scope: "collection",
      index: null,
      field: "",
    };
  }

  const match = source.match(/(?:^|\/)fragments\/(-?\d+)(?:\/([^/]+))?$/);
  if (!match) return null;
  return {
    scope: "item",
    index: Number(match[1]),
    field: String(match[2] || ""),
  };
}

function ensureFragmentState(states, index) {
  if (!states[index]) {
    states[index] = { type: "", content: "" };
  }
  return states[index];
}

function resolveFragmentIndex(states, index) {
  if (!Number.isInteger(index)) return -1;
  if (index >= 0) return index;

  for (let cursor = states.length - 1; cursor >= 0; cursor -= 1) {
    if (states[cursor]) return cursor;
  }

  return -1;
}

function readPatchValue(payload) {
  if (!payload || typeof payload !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(payload, "value")) return payload.value;
  if (Object.prototype.hasOwnProperty.call(payload, "v")) return payload.v;
  return undefined;
}

function normalizePatchPayload(payload, patchCursor) {
  if (!payload || typeof payload !== "object") return null;

  const hasPath = typeof payload.path === "string" || typeof payload.p === "string";
  const hasOp = typeof payload.op === "string" || typeof payload.o === "string";
  const path = String(payload.path ?? payload.p ?? "").trim();
  const op = toText(payload.op ?? payload.o).toUpperCase();
  const value = readPatchValue(payload);

  if (!hasPath && !hasOp) {
    if (
      patchCursor?.path &&
      patchCursor?.field === "content" &&
      typeof value === "string"
    ) {
      return {
        path: patchCursor.path,
        op: patchCursor.op || "APPEND",
        value,
      };
    }
    return null;
  }

  return {
    path,
    op,
    value,
  };
}

function replaceFragmentStates(states, fragments) {
  states.length = 0;
  fragments.forEach((fragment, index) => {
    states[index] = normalizeFragment(fragment);
  });
}

function applyPatchPayload(states, payload, patchCursor) {
  const patch = normalizePatchPayload(payload, patchCursor);
  if (!patch) return false;

  const location = parseFragmentPath(patch.path);
  if (!location) return false;

  if (location.scope === "collection") {
    if (!Array.isArray(patch.value)) return false;
    if (patch.op === "SET") {
      replaceFragmentStates(states, patch.value);
      patchCursor.path = patch.path;
      patchCursor.op = patch.op;
      patchCursor.field = "";
      return true;
    }
    if (patch.op === "APPEND") {
      patch.value.forEach((fragment) => {
        states.push(normalizeFragment(fragment));
      });
      patchCursor.path = patch.path;
      patchCursor.op = patch.op;
      patchCursor.field = "";
      return true;
    }
    return false;
  }

  const index = resolveFragmentIndex(states, location.index);
  if (index < 0 && typeof patch.value !== "object") return false;

  const targetIndex = index >= 0 ? index : states.length;
  const state = ensureFragmentState(states, targetIndex);
  const nextOp = patch.op || (location.field === "content" && typeof patch.value === "string" ? "APPEND" : "SET");

  if (!location.field) {
    if (!patch.value || typeof patch.value !== "object") return false;
    if (typeof patch.value.type === "string") state.type = patch.value.type;
    if (typeof patch.value.content === "string") {
      state.content = nextOp === "APPEND" ? `${state.content}${patch.value.content}` : patch.value.content;
    }
    patchCursor.path = patch.path;
    patchCursor.op = nextOp;
    patchCursor.field = "";
    return true;
  }

  if (location.field === "type" && typeof patch.value === "string") {
    state.type = patch.value;
    patchCursor.path = patch.path;
    patchCursor.op = nextOp;
    patchCursor.field = location.field;
    return true;
  }

  if (location.field === "content" && typeof patch.value === "string") {
    state.content = nextOp === "APPEND" ? `${state.content}${patch.value}` : patch.value;
    patchCursor.path = patch.path;
    patchCursor.op = nextOp;
    patchCursor.field = location.field;
    return true;
  }

  patchCursor.path = patch.path;
  patchCursor.op = nextOp;
  patchCursor.field = location.field;
  return false;
}

function readResponseTextFromStates(states) {
  const fragments = states.filter(Boolean).map((item) => ({
    type: item.type,
    content: item.content,
  }));
  return readResponseTextFromFragments(fragments);
}

function buildSuppressedDeepSeekResult(protocolHelpers, protocol, previewText = "", responseContentPath = "") {
  const safePreview = protocolHelpers.stripProtocolArtifacts(previewText, protocol) || "(deepseek-pending)";
  return {
    matched: false,
    matchScore: 0,
    responseContentPath: String(responseContentPath || "").trim(),
    responseContentPreview: safePreview,
  };
}

function buildAssistantTextFromEvents(events, protocolHelpers, protocol) {
  const fragmentStates = [];
  const patchCursor = { path: "", op: "", field: "" };
  let matched = false;
  let bestText = "";
  let protocolAwareText = "";

  for (const entry of events) {
    const payload = entry?.json;
    if (!payload || typeof payload !== "object") continue;

    const snapshotFragments = readResponseFragments(payload);
    if (snapshotFragments.length) {
      replaceFragmentStates(fragmentStates, snapshotFragments);
      const snapshotText = readResponseTextFromFragments(snapshotFragments);
      if (snapshotText) {
        bestText = preferLongerText(bestText, snapshotText);
        if (protocolHelpers.containsProtocolBlock(snapshotText, protocol)) {
          protocolAwareText = preferLongerText(protocolAwareText, snapshotText);
        }
        matched = true;
      }
    }

    if (applyPatchPayload(fragmentStates, payload, patchCursor)) {
      const patchedText = readResponseTextFromStates(fragmentStates);
      if (patchedText) {
        bestText = preferLongerText(bestText, patchedText);
        if (protocolHelpers.containsProtocolBlock(patchedText, protocol)) {
          protocolAwareText = preferLongerText(protocolAwareText, patchedText);
        }
        matched = true;
      }
    }
  }

  return {
    matched: matched || Boolean(bestText),
    text: protocolAwareText || bestText,
  };
}

return {
  meta: {
    contractVersion: 2,
    adapterName: "DeepSeek",
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
    if (!ctx.injectionText || !looksLikeDeepSeekCompletionRequest(ctx.url, bodyText)) return null;

    const payload = ctx.helpers.json.parse(bodyText);
    if (!payload || typeof payload.prompt !== "string") return null;

    const original = payload.prompt;
    const nextText = ctx.helpers.buildInjectedText(ctx.injectionText, original, ctx.injectionMode);
    if (nextText === original) return null;

    payload.prompt = nextText;

    return {
      applied: true,
      bodyText: JSON.stringify(payload),
      requestMessagePath: "body-json:prompt",
      requestMessagePreview: original,
    };
  },

  extractResponse(ctx) {
    const responseText = String(ctx.responseText ?? "");
    if (!looksLikeDeepSeekCompletionResponse(ctx.url, responseText)) return null;

    const events = ctx.helpers.stream.readSseEvents(responseText);
    if (!events.length) return null;

    const responseContentPath = "sse:data[*].v.response.fragments[*].content";
    const parsed = buildAssistantTextFromEvents(events, ctx.helpers.protocol, ctx.protocol);
    const previewText = String(parsed.text || "");
    if (!parsed.matched) {
      return buildSuppressedDeepSeekResult(ctx.helpers.protocol, ctx.protocol, previewText, responseContentPath);
    }
    if (!previewText) return null;
    if (ctx.helpers.protocol.hasIncompleteProtocolBlock(previewText, ctx.protocol)) {
      return buildSuppressedDeepSeekResult(ctx.helpers.protocol, ctx.protocol, previewText, responseContentPath);
    }

    const blocks = ctx.helpers.protocol.readBlocks(previewText, ctx.protocol);
    return {
      matched: true,
      matchScore: blocks.codeModeRaw ? 120 : blocks.toolCallRaw || blocks.toolResultRaw ? 110 : 100,
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
      ".ds-virtual-list-visible-items > ._4f9bf79 > .ds-message > .ds-markdown",
      "._4f9bf79._43c05b5 > .ds-message > .ds-markdown",
      "._4f9bf79.d7dc56a8 > .ds-message > .ds-markdown",
    ];
    const latestAssistantNode =
      queryUniqueNodes(root, assistantSelectors).slice(-1)[0] || null;
    const responseContentPreview = String(ctx.responseContentPreview || "").trim();

    return ctx.helpers.ui.decorateProtocolBubbles({
      root,
      protocol: ctx.protocol,
      userSelectors: [
        ".ds-virtual-list-visible-items > ._9663006",
        "._9663006._2c189bc",
      ],
      assistantSelectors,
      normalizeAssistantText(text, node) {
        if (responseContentPreview && latestAssistantNode && node === latestAssistantNode) {
          return responseContentPreview;
        }
        return text;
      },
    });
  },

  continueConversation(ctx) {
    const inputSelectors = [
      'textarea[name="search"]',
      'textarea[placeholder="给 DeepSeek 发送消息 "]',
    ];

    return ctx.helpers.plans.dom({
      root: ctx.root,
      composerText: ctx.continuationText,
      input: {
        selectors: inputSelectors,
        kind: "textarea",
        dispatchEvents: ["input", "change"],
      },
      send: {
        mode: "enter",
        targetSelectors: inputSelectors,
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        charCode: 13,
        shiftKey: false,
        beforeSendDelayMs: 220,
        successWaitMs: 1500,
      },
    });
  },
};
