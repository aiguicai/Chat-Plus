import test from "node:test";
import assert from "node:assert/strict";

import {
  clearExpectedAssistantTurn,
  markExpectedAssistantTurn,
  shouldAutoExecuteAssistantCodeMode,
} from "../src/content/runtime/assistantTurn.ts";

function createState() {
  return {
    bubbleDecorationFallback: {
      responseContentPreview: "",
      responseUpdatedAt: 0,
    },
    pageContext: {
      expectedAssistantTurn: false,
      expectedAssistantTurnAt: 0,
      expectedAssistantTurnSource: "",
    },
  } as any;
}

test("assistant turn auto execution requires a fresh expected assistant reply", () => {
  const state = createState();
  const detail = {
    matched: true,
    responseFinal: true,
    responseContentPreview: "[CHAT_PLUS_CODE_MODE_BEGIN]\nreturn 1;\n[CHAT_PLUS_CODE_MODE_END]",
  };

  assert.equal(shouldAutoExecuteAssistantCodeMode(state, detail, 1000), false);

  markExpectedAssistantTurn(state, "user", 1000);
  assert.equal(shouldAutoExecuteAssistantCodeMode(state, detail, 1500), true);

  clearExpectedAssistantTurn(state);
  assert.equal(shouldAutoExecuteAssistantCodeMode(state, detail, 1600), false);
});

test("assistant turn expectation expires after ttl", () => {
  const state = createState();
  markExpectedAssistantTurn(state, "auto", 1000);

  const detail = {
    matched: true,
    responseFinal: true,
    responseContentPreview: "hello",
  };

  assert.equal(shouldAutoExecuteAssistantCodeMode(state, detail, 1000 + 3 * 60 * 1000 + 1), false);
  assert.equal(state.pageContext.expectedAssistantTurn, false);
});

test("markExpectedAssistantTurn clears stale response preview used for bubble decoration", () => {
  const state = createState();
  state.bubbleDecorationFallback.responseContentPreview =
    "[CHAT_PLUS_CODE_MODE_BEGIN]\nreturn 1;\n[CHAT_PLUS_CODE_MODE_END]";
  state.bubbleDecorationFallback.responseUpdatedAt = 1234;

  markExpectedAssistantTurn(state, "user", 2000);

  assert.equal(state.bubbleDecorationFallback.responseContentPreview, "");
  assert.equal(state.bubbleDecorationFallback.responseUpdatedAt, 0);
});
