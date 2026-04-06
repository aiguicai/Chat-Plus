export const CHAT_PLUS_INJECTION_BEGIN = "[CHAT_PLUS_INJECTION_BEGIN]";
export const CHAT_PLUS_INJECTION_END = "[CHAT_PLUS_INJECTION_END]";
export const CHAT_PLUS_USER_QUESTION_LABEL = "下面是用户的提问：";
export const CHAT_PLUS_TOOL_CALL_BEGIN = "[CHAT_PLUS_TOOL_CALL_BEGIN]";
export const CHAT_PLUS_TOOL_CALL_END = "[CHAT_PLUS_TOOL_CALL_END]";
export const CHAT_PLUS_TOOL_RESULT_BEGIN = "[CHAT_PLUS_TOOL_RESULT_BEGIN]";
export const CHAT_PLUS_TOOL_RESULT_END = "[CHAT_PLUS_TOOL_RESULT_END]";
export const CHATPLUS_CODE_MODE_BLOCK_BEGIN = "[CHAT_PLUS_CODE_MODE_BEGIN]";
export const CHATPLUS_CODE_MODE_BLOCK_END = "[CHAT_PLUS_CODE_MODE_END]";

export const CHAT_PLUS_PROTOCOL = {
  injection: {
    begin: CHAT_PLUS_INJECTION_BEGIN,
    end: CHAT_PLUS_INJECTION_END,
  },
  toolCall: {
    begin: CHAT_PLUS_TOOL_CALL_BEGIN,
    end: CHAT_PLUS_TOOL_CALL_END,
  },
  toolResult: {
    begin: CHAT_PLUS_TOOL_RESULT_BEGIN,
    end: CHAT_PLUS_TOOL_RESULT_END,
  },
  codeMode: {
    begin: CHATPLUS_CODE_MODE_BLOCK_BEGIN,
    end: CHATPLUS_CODE_MODE_BLOCK_END,
  },
} as const;

export type ChatPlusProtocol = typeof CHAT_PLUS_PROTOCOL;

function normalizeProtocolText(value: unknown) {
  return String(value || "").replace(/\r\n?/g, "\n");
}

function normalizeTrimmedProtocolText(value: unknown) {
  return normalizeProtocolText(value).trim();
}

export function wrapChatPlusInjection(text: unknown) {
  const content = normalizeTrimmedProtocolText(text);
  if (!content) return "";
  return [
    CHAT_PLUS_INJECTION_BEGIN,
    content,
    "",
    CHAT_PLUS_USER_QUESTION_LABEL,
    CHAT_PLUS_INJECTION_END,
  ].join("\n");
}

export function wrapChatPlusToolResult(text: unknown) {
  const content = normalizeTrimmedProtocolText(text);
  if (!content) return "";
  return [
    CHAT_PLUS_TOOL_RESULT_BEGIN,
    content,
    CHAT_PLUS_TOOL_RESULT_END,
  ].join("\n");
}

export function extractWrappedChatPlusBlock(
  text: unknown,
  begin: unknown,
  end: unknown,
) {
  const source = normalizeProtocolText(text);
  const startToken = normalizeTrimmedProtocolText(begin);
  const endToken = normalizeTrimmedProtocolText(end);
  if (!source || !startToken || !endToken) return "";

  const startIndex = source.indexOf(startToken);
  if (startIndex < 0) return "";
  const endIndex = source.indexOf(endToken, startIndex + startToken.length);
  if (endIndex < 0) return "";
  return source.slice(startIndex + startToken.length, endIndex).trim();
}
