import type { ContentRuntimeState } from "./contentRuntimeState";

export const EXPECTED_ASSISTANT_TURN_TTL_MS = 3 * 60 * 1000;

function readExpectedAssistantResponseText(detail: Record<string, unknown>) {
  return String(detail?.responseContentPreview || "").trim() || String(detail?.responsePreview || "").trim();
}

export function markExpectedAssistantTurn(
  state: ContentRuntimeState,
  source: "" | "user" | "auto",
  now = Date.now(),
) {
  state.pageContext.expectedAssistantTurn = true;
  state.pageContext.expectedAssistantTurnAt = now;
  state.pageContext.expectedAssistantTurnSource = source;
  if (state.bubbleDecorationFallback) {
    state.bubbleDecorationFallback.responseContentPreview = "";
    state.bubbleDecorationFallback.responseUpdatedAt = 0;
  }
}

export function clearExpectedAssistantTurn(state: ContentRuntimeState) {
  state.pageContext.expectedAssistantTurn = false;
  state.pageContext.expectedAssistantTurnAt = 0;
  state.pageContext.expectedAssistantTurnSource = "";
}

export function hasFreshExpectedAssistantTurn(
  state: ContentRuntimeState,
  now = Date.now(),
) {
  if (!state.pageContext.expectedAssistantTurn) return false;
  const expectedAt = Number(state.pageContext.expectedAssistantTurnAt || 0);
  if (!expectedAt || now - expectedAt > EXPECTED_ASSISTANT_TURN_TTL_MS) {
    clearExpectedAssistantTurn(state);
    return false;
  }
  return true;
}

export function shouldAutoExecuteAssistantCodeMode(
  state: ContentRuntimeState,
  detail: Record<string, unknown>,
  now = Date.now(),
) {
  if (detail?.matched !== true || detail?.responseFinal !== true) return false;
  if (!readExpectedAssistantResponseText(detail)) return false;
  return hasFreshExpectedAssistantTurn(state, now);
}
