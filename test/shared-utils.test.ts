import test from "node:test";
import assert from "node:assert/strict";

import {
  hasIncompleteProtocolBlock,
  inferToolResultTone,
  readPatchOperations,
  readSseEvents,
  readWrappedBlock,
  stripProtocolArtifacts,
  stripWrappedBlock,
} from "../src/site-adapter-runtime/shared.ts";

const protocol = {
  injection: { begin: "[CHAT_PLUS_INJECTION_BEGIN]", end: "[CHAT_PLUS_INJECTION_END]" },
  toolCall: { begin: "[CHAT_PLUS_TOOL_CALL_BEGIN]", end: "[CHAT_PLUS_TOOL_CALL_END]" },
  toolResult: { begin: "[CHAT_PLUS_TOOL_RESULT_BEGIN]", end: "[CHAT_PLUS_TOOL_RESULT_END]" },
  codeMode: { begin: "[CHAT_PLUS_CODE_MODE_BEGIN]", end: "[CHAT_PLUS_CODE_MODE_END]" },
};

test("readWrappedBlock extracts protocol payload", () => {
  const text = `hello\n${protocol.toolCall.begin}\n{"name":"search"}\n${protocol.toolCall.end}\nworld`;
  assert.equal(readWrappedBlock(text, protocol.toolCall.begin, protocol.toolCall.end), '{"name":"search"}');
});

test("stripWrappedBlock removes wrapped payload and keeps visible text", () => {
  const text = `hello\n${protocol.toolResult.begin}\nOK\n${protocol.toolResult.end}\nworld`;
  assert.equal(stripWrappedBlock(text, protocol.toolResult.begin, protocol.toolResult.end), "hello\n\nworld");
});

test("readSseEvents rebuilds multiline SSE data payloads", () => {
  const events = readSseEvents([
    "event: delta",
    "data: {\"v\":",
    "data: [{\"p\":\"/message/content\",\"o\":\"append\"}]}",
    "",
    "data: [DONE]",
    "",
  ].join("\n"));
  assert.equal(events.length, 2);
  assert.equal(events[0]?.event, "delta");
  assert.deepEqual(events[0]?.json, { v: [{ p: "/message/content", o: "append" }] });
  assert.equal(events[1]?.json, null);
});

test("readPatchOperations supports direct v arrays", () => {
  const payload = { v: [{ p: "/a", o: "append" }] };
  assert.deepEqual(readPatchOperations(payload), [{ p: "/a", o: "append" }]);
});

test("readPatchOperations supports nested ops arrays", () => {
  const payload = { v: { ops: [{ p: "/b", o: "replace" }] } };
  assert.deepEqual(readPatchOperations(payload), [{ p: "/b", o: "replace" }]);
});

test("inferToolResultTone marks failure on known failure markers", () => {
  assert.equal(inferToolResultTone("执行失败: timeout"), "error");
  assert.equal(inferToolResultTone("执行完成"), "success");
});

test("hasIncompleteProtocolBlock detects missing end token", () => {
  const text = `hello\n${protocol.codeMode.begin}\nconst x = 1;`;
  assert.equal(hasIncompleteProtocolBlock(text, protocol), true);
});

test("stripProtocolArtifacts removes multiple protocol blocks from visible text", () => {
  const text = [
    "question",
    protocol.injection.begin,
    "hidden",
    protocol.injection.end,
    protocol.toolResult.begin,
    "ok",
    protocol.toolResult.end,
    "answer",
  ].join("\n");
  assert.equal(stripProtocolArtifacts(text, protocol), "question\n\nanswer");
});
