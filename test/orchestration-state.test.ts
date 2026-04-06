import test from "node:test";
import assert from "node:assert/strict";

import {
  getEffectiveOrchestrationTabEnabled,
  shouldRefreshOrchestrationTabOnEnable,
} from "../src/sidepanel/lib/orchestrationState.ts";

test("orchestration tab is effectively enabled only when connected and desired enabled", () => {
  assert.equal(
    getEffectiveOrchestrationTabEnabled({ connected: true, desiredEnabled: true }),
    true,
  );
  assert.equal(
    getEffectiveOrchestrationTabEnabled({ connected: false, desiredEnabled: true }),
    false,
  );
  assert.equal(
    getEffectiveOrchestrationTabEnabled({ connected: true, desiredEnabled: false }),
    false,
  );
});

test("orchestration toggle triggers refresh only when enabling a disconnected tab", () => {
  assert.equal(
    shouldRefreshOrchestrationTabOnEnable({ connected: false }, true),
    true,
  );
  assert.equal(
    shouldRefreshOrchestrationTabOnEnable({ connected: true }, true),
    false,
  );
  assert.equal(
    shouldRefreshOrchestrationTabOnEnable({ connected: false }, false),
    false,
  );
});
