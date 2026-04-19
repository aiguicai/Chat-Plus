import test from "node:test";
import assert from "node:assert/strict";

import { normalizeCodeModeAutoContinueDelaySeconds } from "../src/content/runtime/contentRuntimeState.ts";

test("normalizeCodeModeAutoContinueDelaySeconds defaults to 5 seconds when unset", () => {
  assert.equal(normalizeCodeModeAutoContinueDelaySeconds(undefined), 5);
  assert.equal(normalizeCodeModeAutoContinueDelaySeconds(""), 5);
  assert.equal(normalizeCodeModeAutoContinueDelaySeconds("  "), 5);
});

test("normalizeCodeModeAutoContinueDelaySeconds clamps negatives to zero", () => {
  assert.equal(normalizeCodeModeAutoContinueDelaySeconds(-1), 0);
  assert.equal(normalizeCodeModeAutoContinueDelaySeconds("-9"), 0);
});

test("normalizeCodeModeAutoContinueDelaySeconds floors valid numeric input", () => {
  assert.equal(normalizeCodeModeAutoContinueDelaySeconds(0), 0);
  assert.equal(normalizeCodeModeAutoContinueDelaySeconds("3"), 3);
  assert.equal(normalizeCodeModeAutoContinueDelaySeconds(4.8), 4);
});
