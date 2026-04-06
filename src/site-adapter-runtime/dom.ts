import {
  hasOnlyWrappedBlock,
  inferToolResultTone,
  normalizeMultilineText,
  readWrappedBlock,
  stripWrappedBlock,
  toTrimmedText,
} from "./shared";

type ProtocolConfig = Record<string, { begin?: string; end?: string }>;

type DecorateProtocolBubblesOptions = {
  root: Document | HTMLElement;
  protocol?: ProtocolConfig;
  userSelectors?: string[];
  assistantSelectors?: string[];
  injectedUserFallbackText?: unknown;
  normalizeUserText?: (text: string, node: HTMLElement) => string;
  normalizeAssistantText?: (text: string, node: HTMLElement) => string;
  beforeRenderUserNode?: (params: {
    node: HTMLElement;
    rawText: string;
    cleanedText: string;
    documentRef: Document;
    protocol?: ProtocolConfig;
  }) => void;
  beforeRenderAssistantNode?: (params: {
    node: HTMLElement;
    rawText: string;
    documentRef: Document;
    protocol?: ProtocolConfig;
  }) => void;
};

type BuildDomContinuationPlanOptions = {
  root?: Document | HTMLElement | null;
  composerText?: unknown;
  input: Record<string, unknown>;
  send: Record<string, unknown>;
};

const INJECTED_USER_MARKER = "【⚙】";
const INJECTED_USER_SPLIT_LABEL = "下面是用户的提问：";
const RENDERED_PROTOCOL_CARD_ATTR = "data-chat-plus-rendered-protocol-card";

export function normalizeSelectorArray(value: unknown) {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? [normalized] : [];
  }
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function isElementNode(value: unknown): value is HTMLElement {
  return Boolean(value) && typeof value === "object" && (value as Node).nodeType === 1;
}

function resolveDocument(root: Document | HTMLElement) {
  return (root as Node).nodeType === 9
    ? (root as Document)
    : ((root as HTMLElement).ownerDocument as Document | null);
}

function queryFirst(root: Document | HTMLElement | null | undefined, selectors: string[]) {
  if (!root || !selectors.length) return null;
  for (const selector of selectors) {
    try {
      const match = root.querySelector(selector);
      if (isElementNode(match)) {
        return match;
      }
    } catch {
      // ignore invalid selector
    }
  }
  return null;
}

function queryUniqueElements(root: Document | HTMLElement, selectors: string[]) {
  const seen = new Set<HTMLElement>();
  const nodes: HTMLElement[] = [];
  selectors.forEach((selector) => {
    try {
      root.querySelectorAll(selector).forEach((node) => {
        if (!isElementNode(node) || seen.has(node)) return;
        seen.add(node as HTMLElement);
        nodes.push(node as HTMLElement);
      });
    } catch {
      // ignore invalid selector
    }
  });
  return nodes;
}

export function readNodeText(node: Node | null | undefined) {
  if (!node) return "";

  const skipTags = new Set([
    "BUTTON",
    "FORM",
    "INPUT",
    "LABEL",
    "NAV",
    "NOSCRIPT",
    "OPTION",
    "SCRIPT",
    "SELECT",
    "STYLE",
    "SVG",
    "TEXTAREA",
  ]);
  const blockTags = new Set([
    "ARTICLE",
    "BLOCKQUOTE",
    "DIV",
    "LI",
    "OL",
    "P",
    "PRE",
    "SECTION",
    "TABLE",
    "TR",
    "UL",
  ]);
  const parts: string[] = [];

  function pushBreak() {
    if (parts[parts.length - 1] !== "\n") {
      parts.push("\n");
    }
  }

  function walk(current: Node | null) {
    if (!current) return;
    if (current.nodeType === 3) {
      parts.push(String(current.nodeValue ?? ""));
      return;
    }
    if (!isElementNode(current)) return;

    const tag = String(current.tagName || "").toUpperCase();
    if (skipTags.has(tag)) return;
    if (
      current.getAttribute("aria-hidden") === "true" ||
      current.closest(`[${RENDERED_PROTOCOL_CARD_ATTR}="1"]`) ||
      current.getAttribute("data-testid") === "message-actions" ||
      current.closest("button")
    ) {
      return;
    }
    if (tag === "BR") {
      pushBreak();
      return;
    }

    const isBlock = blockTags.has(tag);
    if (isBlock) pushBreak();
    current.childNodes.forEach((child) => walk(child));
    if (isBlock) pushBreak();
  }

  walk(node);
  return normalizeMultilineText(parts.join("")).replace(/\n{3,}/g, "\n\n").trim();
}

function formatCodeModeDisplayText(text: unknown) {
  const source = normalizeMultilineText(text).trim();
  if (!source || source.includes("\n")) return source;

  return source
    .replace(/;\s*(?=(const|let|var|return|if|for|while|try|\}))/g, ";\n")
    .replace(/\{\s*(?=(const|let|var|return|if|for|while|try))/g, "{\n")
    .replace(/\}\s*(?=(else|catch|finally))/g, "}\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function formatInjectedUserDisplayText(text: string) {
  const cleaned = normalizeMultilineText(text).trim();
  if (!cleaned) return INJECTED_USER_MARKER;
  if (cleaned.startsWith(INJECTED_USER_MARKER)) return cleaned;
  return `${INJECTED_USER_MARKER} ${cleaned}`;
}

function extractUserTextAfterSplitLabel(text: string) {
  const normalized = normalizeMultilineText(text).trim();
  if (!normalized) return "";

  const labelIndex = normalized.lastIndexOf(INJECTED_USER_SPLIT_LABEL);
  if (labelIndex < 0) return "";

  return normalized
    .slice(labelIndex + INJECTED_USER_SPLIT_LABEL.length)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseInjectedUserBubbleText(
  text: string,
  injectionBegin: string,
  injectionEnd: string,
) {
  const normalized = normalizeMultilineText(text).trim();
  if (!normalized) {
    return {
      hasInjection: false,
      visibleText: "",
    };
  }

  const beginIndex = injectionBegin ? normalized.indexOf(injectionBegin) : -1;
  if (injectionBegin && injectionEnd && beginIndex >= 0) {
    const endIndex =
      normalized.indexOf(injectionEnd, beginIndex + injectionBegin.length);

    if (endIndex > beginIndex) {
      const before = normalized.slice(0, beginIndex).trim();
      const wrapped = normalized.slice(beginIndex + injectionBegin.length, endIndex).trim();
      const after = normalized.slice(endIndex + injectionEnd.length).trim();
      const inlineUserText = extractUserTextAfterSplitLabel(wrapped);
      const visibleText = [before, after || inlineUserText]
        .filter(Boolean)
        .join("\n\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      return {
        hasInjection: true,
        visibleText,
      };
    }

    const fallbackVisibleText = extractUserTextAfterSplitLabel(
      normalized.replace(injectionBegin, "").replace(injectionEnd, ""),
    );
    return {
      hasInjection: true,
      visibleText: fallbackVisibleText,
    };
  }

  return {
    hasInjection: false,
    visibleText: normalized,
  };
}

function getProtocolCardTheme(kind: string, rawBlock: string) {
  const fallbackTheme = {
    accent: "rgba(59,130,246,0.35)",
    background: "rgba(59,130,246,0.08)",
    bodyBackground: "rgba(255,255,255,0.70)",
    bodyBorder: "rgba(148,163,184,0.18)",
    titleColor: "#3a332b",
    hintColor: "#8f8577",
    statusText: "",
    statusColor: "#8f8577",
    statusBackground: "rgba(148,163,184,0.10)",
  };

  if (kind === "toolCall") {
    return {
      ...fallbackTheme,
      accent: "rgba(214,158,46,0.34)",
      background: "rgba(214,158,46,0.10)",
      bodyBackground: "rgba(255,248,230,0.82)",
      bodyBorder: "rgba(214,158,46,0.20)",
      titleColor: "#6f5415",
      hintColor: "#927849",
    };
  }

  if (kind === "codeMode") {
    return {
      ...fallbackTheme,
      accent: "rgba(148,104,212,0.30)",
      background: "rgba(148,104,212,0.10)",
      bodyBackground: "rgba(247,242,255,0.82)",
      bodyBorder: "rgba(148,104,212,0.18)",
      titleColor: "#69418e",
      hintColor: "#8f74a8",
    };
  }

  if (kind === "toolResult") {
    const tone = inferToolResultTone(rawBlock);
    if (tone === "error") {
      return {
        ...fallbackTheme,
        accent: "rgba(196,102,89,0.34)",
        background: "rgba(196,102,89,0.11)",
        bodyBackground: "rgba(255,242,239,0.86)",
        bodyBorder: "rgba(196,102,89,0.22)",
        titleColor: "#8b3d35",
        hintColor: "#aa6f68",
        statusText: "失败",
        statusColor: "#9b4036",
        statusBackground: "rgba(196,102,89,0.14)",
      };
    }

    return {
      ...fallbackTheme,
      accent: "rgba(106,153,96,0.34)",
      background: "rgba(106,153,96,0.10)",
      bodyBackground: "rgba(241,249,236,0.86)",
      bodyBorder: "rgba(106,153,96,0.20)",
      titleColor: "#416a3d",
      hintColor: "#6b8d67",
      statusText: "成功",
      statusColor: "#486f44",
      statusBackground: "rgba(106,153,96,0.14)",
    };
  }

  return fallbackTheme;
}

export function renderProtocolCard(
  documentRef: Document,
  node: HTMLElement,
  rawText: string,
  begin: string,
  end: string,
  options: {
    kind: "toolCall" | "toolResult" | "codeMode";
    summaryText: string;
  },
) {
  if (!begin || !end || rawText.indexOf(begin) === -1) return false;

  const rawBlock = readWrappedBlock(rawText, begin, end);
  if (!rawBlock) return false;

  const cleaned = stripWrappedBlock(rawText, begin, end);
  const kind = String(options.kind || "toolCall");
  const summaryText = String(options.summaryText || "协议块");
  const theme = getProtocolCardTheme(kind, rawBlock);

  node.innerHTML = "";
  if (cleaned) {
    const textNode = documentRef.createElement("div");
    textNode.textContent = cleaned;
    textNode.style.cssText = "white-space:pre-wrap;margin-bottom:10px;line-height:1.7;";
    node.appendChild(textNode);
  }

  const card = documentRef.createElement("details");
  card.setAttribute(RENDERED_PROTOCOL_CARD_ATTR, "1");
  if (kind === "codeMode") {
    card.setAttribute("data-chat-plus-code-mode-card", "1");
  }
  card.style.cssText = [
    "border:1px solid " + theme.accent,
    "border-radius:14px",
    "padding:10px 12px",
    "background:" + theme.background,
    "box-shadow:0 4px 16px rgba(31,41,55,0.05)",
  ].join(";");

  const summary = documentRef.createElement("summary");
  summary.style.cssText = [
    "cursor:pointer",
    "font-weight:600",
    "display:flex",
    "align-items:center",
    "justify-content:space-between",
    "gap:12px",
    "list-style:none",
    "outline:none",
  ].join(";");

  const titleGroup = documentRef.createElement("span");
  titleGroup.style.cssText = [
    "display:inline-flex",
    "align-items:center",
    "gap:10px",
    "min-width:0",
  ].join(";");

  const title = documentRef.createElement("span");
  title.textContent = summaryText;
  title.style.cssText = ["font-size:14px", "line-height:1.3", "color:" + theme.titleColor].join(";");
  titleGroup.appendChild(title);

  if (kind === "codeMode") {
    const runButton = documentRef.createElement("button");
    runButton.type = "button";
    runButton.textContent = "手动运行";
    runButton.setAttribute("data-chat-plus-code-mode-run", "1");
    runButton.style.cssText = [
      "appearance:none",
      "border:1px solid " + theme.accent,
      "border-radius:999px",
      "padding:5px 11px",
      "background:rgba(255,255,255,0.96)",
      "color:" + theme.titleColor,
      "display:inline-flex",
      "align-items:center",
      "font-size:12px",
      "font-weight:600",
      "line-height:1",
      "cursor:pointer",
    ].join(";");
    titleGroup.appendChild(runButton);
  }

  const meta = documentRef.createElement("span");
  meta.style.cssText = [
    "display:inline-flex",
    "align-items:center",
    "gap:6px",
    "font-size:12px",
    "line-height:1",
    "white-space:nowrap",
    "color:" + theme.hintColor,
  ].join(";");
  const hint = documentRef.createElement("span");
  hint.textContent = "点击展开";
  const arrow = documentRef.createElement("span");
  arrow.textContent = "›";
  arrow.style.cssText = "font-size:14px;font-weight:700;opacity:0.78;";
  meta.append(hint, arrow);

  if (theme.statusText) {
    const status = documentRef.createElement("span");
    status.textContent = `· ${theme.statusText}`;
    status.style.cssText = [
      "padding:4px 8px",
      "border-radius:999px",
      "background:" + theme.statusBackground,
      "color:" + theme.statusColor,
      "font-weight:600",
    ].join(";");
    meta.appendChild(status);
  }

  summary.append(titleGroup, meta);
  card.appendChild(summary);

  const bodyWrap = documentRef.createElement("div");
  bodyWrap.style.cssText = [
    "margin-top:10px",
    "padding-top:10px",
    "border-top:1px solid " + theme.accent,
  ].join(";");
  const body = documentRef.createElement("pre");
  body.textContent = kind === "codeMode" ? formatCodeModeDisplayText(rawBlock) : rawBlock;
  if (kind === "codeMode") {
    body.setAttribute("data-chat-plus-code-mode-source", "1");
  }
  body.style.cssText = [
    "white-space:pre-wrap",
    "word-break:break-word",
    "margin:0",
    "padding:12px 14px",
    "height:180px",
    "overflow:auto",
    "font-size:12px",
    "line-height:1.6",
    "border-radius:12px",
    "background:" + theme.bodyBackground,
    "border:1px solid " + theme.bodyBorder,
    "box-sizing:border-box",
  ].join(";");
  bodyWrap.appendChild(body);
  card.appendChild(bodyWrap);
  node.appendChild(card);
  return true;
}

function renderProtocolCardsInOrder(
  documentRef: Document,
  node: HTMLElement,
  text: string,
  tokens: {
    codeModeBegin: string;
    codeModeEnd: string;
    toolCallBegin: string;
    toolCallEnd: string;
    toolResultBegin: string;
    toolResultEnd: string;
  },
) {
  if (
    renderProtocolCard(documentRef, node, text, tokens.codeModeBegin, tokens.codeModeEnd, {
      kind: "codeMode",
      summaryText: "Code Mode",
    })
  ) {
    return true;
  }
  if (
    renderProtocolCard(documentRef, node, text, tokens.toolCallBegin, tokens.toolCallEnd, {
      kind: "toolCall",
      summaryText: "工具调用",
    })
  ) {
    return true;
  }
  return renderProtocolCard(documentRef, node, text, tokens.toolResultBegin, tokens.toolResultEnd, {
    kind: "toolResult",
    summaryText: "工具返回结果",
  });
}

export function decorateProtocolBubbles(options: DecorateProtocolBubblesOptions) {
  const root = options.root;
  const protocol = options.protocol || {};
  const documentRef = resolveDocument(root);
  if (!documentRef) {
    throw new Error("decorateProtocolBubbles requires a document-backed root");
  }
  const userSelectors = normalizeSelectorArray(options.userSelectors);
  const assistantSelectors = normalizeSelectorArray(options.assistantSelectors);
  const userNodes = queryUniqueElements(root, userSelectors);
  const assistantNodes = queryUniqueElements(root, assistantSelectors);

  const injectionBegin = protocol?.injection?.begin || "";
  const injectionEnd = protocol?.injection?.end || "";
  const toolCallBegin = protocol?.toolCall?.begin || "";
  const toolCallEnd = protocol?.toolCall?.end || "";
  const toolResultBegin = protocol?.toolResult?.begin || "";
  const toolResultEnd = protocol?.toolResult?.end || "";
  const codeModeBegin = protocol?.codeMode?.begin || "";
  const codeModeEnd = protocol?.codeMode?.end || "";
  const normalizedInjectedUserFallbackText = normalizeMultilineText(
    options.injectedUserFallbackText,
  ).trim();
  const parsedUserEntries = userNodes.map((node) => {
    const raw = options.normalizeUserText
      ? options.normalizeUserText(readNodeText(node), node)
      : readNodeText(node);
    const parsed = raw ? parseInjectedUserBubbleText(raw, injectionBegin, injectionEnd) : null;
    return {
      node,
      raw,
      parsed,
      cleanedText: parsed?.visibleText || "",
    };
  });
  let injectedFallbackIndex = -1;
  if (normalizedInjectedUserFallbackText) {
    for (let index = parsedUserEntries.length - 1; index >= 0; index -= 1) {
      const entry = parsedUserEntries[index];
      if (entry.parsed?.hasInjection && !entry.cleanedText) {
        injectedFallbackIndex = index;
        break;
      }
    }
  }

  parsedUserEntries.forEach((entry, index) => {
    const { node, raw } = entry;
    if (!raw) return;

    const parsed = entry.parsed || parseInjectedUserBubbleText(raw, injectionBegin, injectionEnd);
    const cleaned = entry.cleanedText || parsed.visibleText;
    const effectiveCleanedText =
      parsed.hasInjection && !cleaned && index === injectedFallbackIndex
        ? normalizedInjectedUserFallbackText
        : cleaned;
    const protocolSourceText = parsed.hasInjection ? effectiveCleanedText : raw;
    const displayText = parsed.hasInjection
      ? formatInjectedUserDisplayText(protocolSourceText)
      : protocolSourceText;
    options.beforeRenderUserNode?.({
      node,
      rawText: raw,
      cleanedText: effectiveCleanedText,
      documentRef,
      protocol,
    });

    if (
      renderProtocolCardsInOrder(documentRef, node, displayText, {
        codeModeBegin,
        codeModeEnd,
        toolCallBegin,
        toolCallEnd,
        toolResultBegin,
        toolResultEnd,
      })
    ) {
      return;
    }

    if (displayText !== raw) {
      node.textContent = displayText;
    }
  });

  assistantNodes.forEach((node) => {
    const raw = options.normalizeAssistantText
      ? options.normalizeAssistantText(readNodeText(node), node)
      : readNodeText(node);
    if (!raw) return;

    options.beforeRenderAssistantNode?.({
      node,
      rawText: raw,
      documentRef,
      protocol,
    });

    renderProtocolCardsInOrder(documentRef, node, raw, {
      codeModeBegin,
      codeModeEnd,
      toolCallBegin,
      toolCallEnd,
      toolResultBegin,
      toolResultEnd,
    });
  });

  return {
    userBubbleSelector: userSelectors.join(", "),
    assistantBubbleSelector: assistantSelectors.join(", "),
    stats: {
      userNodeCount: userNodes.length,
      assistantNodeCount: assistantNodes.length,
    },
  };
}

export function validateDomContinuationPlan(plan: unknown) {
  const candidate =
    plan && typeof plan === "object" && !Array.isArray(plan)
      ? (plan as Record<string, unknown>)
      : {};
  const input =
    candidate.input && typeof candidate.input === "object" && !Array.isArray(candidate.input)
      ? (candidate.input as Record<string, unknown>)
      : {};
  const send =
    candidate.send && typeof candidate.send === "object" && !Array.isArray(candidate.send)
      ? (candidate.send as Record<string, unknown>)
      : {};
  const mode = toTrimmedText(candidate.mode || "dom").toLowerCase() || "dom";
  const inputSelectors = normalizeSelectorArray(input.selector || input.selectors);
  const sendMode = toTrimmedText(send.mode || "click").toLowerCase() || "click";
  const sendSelectors = normalizeSelectorArray(send.selector || send.selectors);
  const sendTargetSelectors = normalizeSelectorArray(send.targetSelector || send.targetSelectors);
  const errors: string[] = [];

  if (mode !== "dom") {
    errors.push(`mode must be "dom", received "${mode || "(empty)"}"`);
  }
  if (!toTrimmedText(candidate.composerText)) {
    errors.push("composerText is required");
  }
  if (!inputSelectors.length) {
    errors.push("input selector/selectors is required");
  }
  if (sendMode === "click" && !sendSelectors.length) {
    errors.push("send selector/selectors is required for click mode");
  }
  if (sendMode === "enter" && !sendTargetSelectors.length && !inputSelectors.length) {
    errors.push("enter mode requires targetSelectors or input selectors");
  }

  return {
    ok: errors.length === 0,
    errors,
    normalized: {
      ...candidate,
      mode,
      input: {
        ...input,
        selectors: inputSelectors,
      },
      send: {
        ...send,
        mode: sendMode,
        selectors: sendSelectors,
        targetSelectors: sendTargetSelectors,
      },
    },
  };
}

export function buildDomContinuationPlan(options: BuildDomContinuationPlanOptions) {
  const root = options.root || null;
  const inputSelectors = normalizeSelectorArray(options.input?.selector || options.input?.selectors);
  const sendMode = toTrimmedText(options.send?.mode || "click").toLowerCase() || "click";
  const sendSelectors = normalizeSelectorArray(options.send?.selector || options.send?.selectors);
  const sendTargetSelectors = normalizeSelectorArray(
    options.send?.targetSelector || options.send?.targetSelectors,
  );

  if (root && !queryFirst(root, inputSelectors)) {
    return null;
  }
  if (root && sendMode === "click" && !queryFirst(root, sendSelectors)) {
    return null;
  }
  if (root && sendMode === "enter") {
    const keyboardTarget = queryFirst(root, sendTargetSelectors.length ? sendTargetSelectors : inputSelectors);
    if (!keyboardTarget) return null;
  }

  const plan = {
    mode: "dom",
    composerText: String(options.composerText ?? ""),
    input: {
      ...options.input,
      selectors: inputSelectors,
    },
    send: {
      ...options.send,
      mode: sendMode,
      selectors: sendSelectors,
      targetSelectors: sendTargetSelectors,
    },
  } as Record<string, unknown>;

  const validation = validateDomContinuationPlan(plan);
  return validation.ok ? validation.normalized : null;
}

export function isPureToolResultMessage(
  text: unknown,
  protocol?: ProtocolConfig,
) {
  return hasOnlyWrappedBlock(text, protocol?.toolResult?.begin || "", protocol?.toolResult?.end || "");
}
