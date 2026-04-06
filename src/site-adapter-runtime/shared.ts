export const SITE_ADAPTER_REQUIRED_HOOKS = [
  "transformRequest",
  "extractResponse",
  "decorateBubbles",
  "continueConversation",
] as const;

export const SITE_ADAPTER_META_KEY = "meta";

export function toTrimmedText(value?: unknown) {
  return String(value ?? "").trim();
}

export function normalizeMultilineText(value?: unknown) {
  return String(value ?? "").replace(/\r\n?/g, "\n");
}

export function parseJsonSafely<T = Record<string, unknown>>(value?: unknown): T | null {
  try {
    return JSON.parse(String(value || "")) as T;
  } catch {
    return null;
  }
}

export function escapeRegExp(value?: unknown) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function readWrappedBlock(text: unknown, begin: unknown, end: unknown) {
  const source = String(text ?? "");
  const beginToken = String(begin || "");
  const endToken = String(end || "");
  if (!source || !beginToken || !endToken) return "";

  const start = source.indexOf(beginToken);
  if (start < 0) return "";
  const endIndex = source.indexOf(endToken, start + beginToken.length);
  if (endIndex < 0) return "";
  return source.slice(start + beginToken.length, endIndex).trim();
}

export function hasCompleteWrappedBlock(text: unknown, begin: unknown, end: unknown) {
  return Boolean(readWrappedBlock(text, begin, end));
}

export function stripWrappedBlock(text: unknown, begin: unknown, end: unknown) {
  const source = String(text ?? "");
  const beginToken = String(begin || "");
  const endToken = String(end || "");
  if (!source || !beginToken || !endToken) return source;
  return source.replace(
    new RegExp(`${escapeRegExp(beginToken)}[\\s\\S]*?${escapeRegExp(endToken)}`, "g"),
    "",
  ).trim();
}

export function hasOnlyWrappedBlock(text: unknown, begin: unknown, end: unknown) {
  const source = normalizeMultilineText(text).trim();
  const beginToken = String(begin || "");
  const endToken = String(end || "");
  if (!source || !beginToken || !endToken) return false;
  const block = readWrappedBlock(source, beginToken, endToken);
  if (!block) return false;
  return stripWrappedBlock(source, beginToken, endToken) === "";
}

export function hasBeginWithoutEnd(text: unknown, begin: unknown, end: unknown) {
  const source = String(text ?? "");
  const beginToken = String(begin || "");
  const endToken = String(end || "");
  return Boolean(source && beginToken && endToken && source.includes(beginToken) && !source.includes(endToken));
}

export function containsProtocolBlock(
  text: unknown,
  protocol?: Record<string, { begin?: string; end?: string }>,
) {
  const source = String(text ?? "");
  if (!source) return false;

  const beginTokens = [
    protocol?.codeMode?.begin,
    protocol?.toolCall?.begin,
    protocol?.toolResult?.begin,
    protocol?.injection?.begin,
  ]
    .map((token) => toTrimmedText(token))
    .filter(Boolean);

  return beginTokens.some((token) => source.includes(token));
}

export function hasIncompleteProtocolBlock(
  text: unknown,
  protocol?: Record<string, { begin?: string; end?: string }>,
) {
  const pairs = [
    [protocol?.codeMode?.begin, protocol?.codeMode?.end],
    [protocol?.toolCall?.begin, protocol?.toolCall?.end],
    [protocol?.toolResult?.begin, protocol?.toolResult?.end],
    [protocol?.injection?.begin, protocol?.injection?.end],
  ];
  return pairs.some(([begin, end]) => hasBeginWithoutEnd(text, begin, end));
}

export function stripProtocolArtifacts(
  text: unknown,
  protocol?: Record<string, { begin?: string; end?: string }>,
) {
  let source = normalizeMultilineText(text);
  if (!source) return "";

  const pairs = [
    [protocol?.injection?.begin, protocol?.injection?.end],
    [protocol?.codeMode?.begin, protocol?.codeMode?.end],
    [protocol?.toolCall?.begin, protocol?.toolCall?.end],
    [protocol?.toolResult?.begin, protocol?.toolResult?.end],
  ];

  for (const [begin, end] of pairs) {
    source = stripWrappedBlock(source, begin, end);
  }

  for (const [begin] of pairs) {
    const token = String(begin || "");
    if (!token || !source.includes(token)) continue;
    source = source.split(token)[0];
  }

  return source.replace(/\n{3,}/g, "\n\n").trim();
}

export function inferToolResultTone(text: unknown) {
  const source = String(text ?? "");
  if (!source) return "success" as const;
  return (
    source.includes("执行失败") ||
    source.includes("错误:") ||
    source.toLowerCase().includes("error:") ||
    source.includes("工具调用失败") ||
    source.includes("自动续发失败")
  )
    ? ("error" as const)
    : ("success" as const);
}

export function readSseEvents(text: unknown) {
  const raw = normalizeMultilineText(text);
  if (!raw) return [];

  const blocks = raw.split(/\n{2,}/);
  const events: Array<{
    event: string;
    dataText: string;
    json: Record<string, unknown> | Array<unknown> | null;
  }> = [];

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean);
    if (!lines.length) continue;

    let eventName = "message";
    const dataLines: string[] = [];
    lines.forEach((line) => {
      if (line.startsWith("event:")) {
        eventName = toTrimmedText(line.slice(6)) || "message";
        return;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    });

    if (!dataLines.length) continue;
    const dataText = dataLines.join("\n").trim();
    if (!dataText) continue;

    events.push({
      event: eventName,
      dataText,
      json: dataText === "[DONE]" ? null : parseJsonSafely(dataText),
    });
  }

  return events;
}

export function readPatchOperations(payload: unknown) {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.v)) {
    return record.v as Array<Record<string, unknown>>;
  }
  if (record.o === "patch" && Array.isArray(record.v)) {
    return record.v as Array<Record<string, unknown>>;
  }
  if (Array.isArray(record.ops)) {
    return record.ops as Array<Record<string, unknown>>;
  }
  const nestedV = record.v as Record<string, unknown> | undefined;
  if (nestedV && typeof nestedV === "object" && Array.isArray(nestedV.ops)) {
    return nestedV.ops as Array<Record<string, unknown>>;
  }
  return [];
}

export function readProtocolBlocks(
  text: unknown,
  protocol?: Record<string, { begin?: string; end?: string }>,
) {
  const source = String(text ?? "");
  return {
    source,
    toolCallRaw: readWrappedBlock(
      source,
      protocol?.toolCall?.begin || "",
      protocol?.toolCall?.end || "",
    ),
    toolResultRaw: readWrappedBlock(
      source,
      protocol?.toolResult?.begin || "",
      protocol?.toolResult?.end || "",
    ),
    codeModeRaw: readWrappedBlock(
      source,
      protocol?.codeMode?.begin || "",
      protocol?.codeMode?.end || "",
    ),
  };
}

export function createHookFailure(reason: unknown, detail?: unknown) {
  const normalizedReason = toTrimmedText(reason) || "unknown";
  const normalizedDetail = toTrimmedText(detail);
  return {
    ok: false,
    reason: normalizedReason,
    detail: normalizedDetail,
  };
}
