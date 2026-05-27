import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

import {
  buildDomContinuationPlan,
  decorateProtocolBubbles,
} from "../src/site-adapter-runtime/dom.ts";
import {
  containsProtocolBlock,
  hasCompleteWrappedBlock,
  hasIncompleteProtocolBlock,
  parseJsonSafely,
  readProtocolBlocks,
  readWrappedBlock,
  stripProtocolArtifacts,
  stripWrappedBlock,
  toTrimmedText,
} from "../src/site-adapter-runtime/shared.ts";

const adapterSource = readFileSync(new URL("../web_chat_js/gemini.js", import.meta.url), "utf8");

const protocol = {
  injection: { begin: "[CHAT_PLUS_INJECTION_BEGIN]", end: "[CHAT_PLUS_INJECTION_END]" },
  toolCall: { begin: "[CHAT_PLUS_TOOL_CALL_BEGIN]", end: "[CHAT_PLUS_TOOL_CALL_END]" },
  toolResult: { begin: "[CHAT_PLUS_TOOL_RESULT_BEGIN]", end: "[CHAT_PLUS_TOOL_RESULT_END]" },
  codeMode: { begin: "[CHAT_PLUS_CODE_MODE_BEGIN]", end: "[CHAT_PLUS_CODE_MODE_END]" },
};

function loadAdapter() {
  return new vm.Script(`(function(){\n${adapterSource}\n})()`).runInNewContext({});
}

function createHelpers() {
  return {
    buildInjectedText(injectionText: string, originalText: string, injectionMode = "system") {
      const prefix = String(injectionText || "").trim();
      if (!prefix) return originalText;
      if (String(injectionMode || "").toLowerCase() === "raw") {
        return `${prefix}\n\n${originalText}`;
      }
      return [
        "[CHAT_PLUS_INJECTION_BEGIN]",
        prefix,
        "[CHAT_PLUS_INJECTION_END]",
        "",
        originalText,
      ].join("\n");
    },
    text: {
      toText: toTrimmedText,
    },
    json: {
      parse: parseJsonSafely,
    },
    protocol: {
      containsProtocolBlock,
      hasCompleteWrappedBlock,
      hasIncompleteProtocolBlock,
      stripProtocolArtifacts,
      readBlocks: readProtocolBlocks,
      readWrappedBlock,
      stripWrappedBlock,
    },
    ui: {
      decorateProtocolBubbles,
    },
    plans: {
      dom: buildDomContinuationPlan,
    },
  };
}

function buildGeminiFrame(entry: unknown) {
  const frame = JSON.stringify([entry], null, 2);
  return `)]}'\n${frame.length}\n${frame}\n`;
}

test("gemini extractResponse reads assistant text from framed wrb.fr payload", () => {
  const adapter = loadAdapter();
  const payload = [
    null,
    ["conversation-1", "response-1"],
    null,
    null,
    [["choice-1", ["你好，Gemini 已回复完整内容。"]]],
  ];
  const responseText = buildGeminiFrame(["wrb.fr", "di", JSON.stringify(payload)]);

  const result = adapter.extractResponse({
    url: "https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=BardFrontendService/StreamGenerate",
    responseText,
    helpers: createHelpers(),
    protocol,
  });

  assert.equal(result?.matched, true);
  assert.equal(result?.responseContentPreview, "你好，Gemini 已回复完整内容。");
});

test("gemini extractResponse keeps complete toolCall blocks matched", () => {
  const adapter = loadAdapter();
  const toolCallText = [
    "需要调用工具。",
    "[CHAT_PLUS_TOOL_CALL_BEGIN]",
    '{"name":"demo.lookup","arguments":{"query":"gemini"}}',
    "[CHAT_PLUS_TOOL_CALL_END]",
  ].join("\n");
  const payload = [
    null,
    ["conversation-1", "response-2"],
    null,
    null,
    [["choice-1", [toolCallText]]],
  ];
  const responseText = buildGeminiFrame(["wrb.fr", "di", JSON.stringify(payload)]);

  const result = adapter.extractResponse({
    url: "https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=BardFrontendService/StreamGenerate",
    responseText,
    helpers: createHelpers(),
    protocol,
  });

  assert.equal(result?.matched, true);
  assert.equal(result?.toolCall?.detected, true);
  assert.equal(result?.responseContentPreview, toolCallText);
});

test("gemini extractResponse ignores non-StreamGenerate Google RPC frames", () => {
  const adapter = loadAdapter();
  const responseText = buildGeminiFrame(["wrb.fr", "ESY5D", "[[null,null,null,null,true]]"]);

  const result = adapter.extractResponse({
    url: "https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=ESY5D",
    responseText,
    helpers: createHelpers(),
    protocol,
  });

  assert.equal(result, null);
});

test("gemini extractResponse finds protocol text from alternate payload slots", () => {
  const adapter = loadAdapter();
  const codeModeText = [
    "[CHAT_PLUS_CODE_MODE_BEGIN]",
    "const result = await tools.demo.run({ query: \"gemini\" });",
    "return result;",
    "[CHAT_PLUS_CODE_MODE_END]",
  ].join("\n");
  const payload = [
    null,
    ["conversation-1", "response-3"],
    null,
    null,
    [],
    { candidates: [{ text: codeModeText }] },
  ];
  const responseText = buildGeminiFrame(["wrb.fr", "di", JSON.stringify(payload)]);

  const result = adapter.extractResponse({
    url: "https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=BardFrontendService/StreamGenerate",
    responseText,
    helpers: createHelpers(),
    protocol,
  });

  assert.equal(result?.matched, true);
  assert.equal(result?.codeMode?.detected, true);
  assert.equal(result?.responseContentPreview, codeModeText);
});

test("gemini continueConversation returns a contenteditable click plan", () => {
  const adapter = loadAdapter();
  const dom = new JSDOM(`
    <!doctype html>
    <html>
      <body>
        <div class="ql-editor" role="textbox" aria-label="为 Gemini 输入提示" contenteditable="true"></div>
        <button class="send-button" aria-label="发送"></button>
      </body>
    </html>
  `);

  const result = adapter.continueConversation({
    root: dom.window.document,
    continuationText: "工具执行完成",
    helpers: createHelpers(),
  });

  assert.equal(result?.mode, "dom");
  assert.equal(result?.input?.kind, "contenteditable");
  assert.equal(result?.send?.mode, "click");
});

test("gemini decorateBubbles does not render protocol cards while Gemini is actively generating", () => {
  const adapter = loadAdapter();
  const dom = new JSDOM(`
    <!doctype html>
    <html>
      <body>
        <model-response>
          <structured-content-container class="model-response-text processing-state-visible">
            [CHAT_PLUS_TOOL_CALL_BEGIN]
            {"name":"demo.echo","arguments":{"text":"ok"}}
            [CHAT_PLUS_TOOL_CALL_END]
          </structured-content-container>
        </model-response>
        <button class="send-button stop"></button>
      </body>
    </html>
  `);

  adapter.decorateBubbles({
    root: dom.window.document,
    protocol,
    helpers: createHelpers(),
  });

  assert.equal(
    dom.window.document.querySelectorAll('[data-chat-plus-rendered-protocol-card="1"]').length,
    0,
  );
});

test("gemini decorateBubbles renders historical processing-marked protocol messages", () => {
  const adapter = loadAdapter();
  const dom = new JSDOM(`
    <!doctype html>
    <html>
      <body>
        <model-response>
          <structured-content-container class="model-response-text processing-state-visible">
            [CHAT_PLUS_CODE_MODE_BEGIN]
            const result = await tools.demo.run({ text: "ok" });
            return result;
            [CHAT_PLUS_CODE_MODE_END]
          </structured-content-container>
        </model-response>
      </body>
    </html>
  `);

  adapter.decorateBubbles({
    root: dom.window.document,
    protocol,
    helpers: createHelpers(),
  });

  const card = dom.window.document.querySelector('[data-chat-plus-rendered-protocol-card="1"]');
  assert.ok(card);
  assert.match(card?.textContent || "", /Code Mode|运行|工具调用/);
});

test("gemini decorateBubbles renders latest assistant card from final response preview", () => {
  const adapter = loadAdapter();
  const dom = new JSDOM(`
    <!doctype html>
    <html>
      <body>
        <model-response>
          <structured-content-container class="model-response-text processing-state-visible">
            partial raw text
          </structured-content-container>
        </model-response>
      </body>
    </html>
  `);
  const responseContentPreview = [
    "[CHAT_PLUS_TOOL_CALL_BEGIN]",
    '{"name":"demo.echo","arguments":{"text":"ok"}}',
    "[CHAT_PLUS_TOOL_CALL_END]",
  ].join("\n");

  adapter.decorateBubbles({
    root: dom.window.document,
    protocol,
    responseContentPreview,
    helpers: createHelpers(),
  });

  const card = dom.window.document.querySelector('[data-chat-plus-rendered-protocol-card="1"]');
  assert.ok(card);
  assert.match(card?.textContent || "", /demo\.echo/);
});
