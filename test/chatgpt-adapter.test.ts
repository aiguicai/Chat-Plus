import test from "node:test";
import assert from "node:assert/strict";
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
  readPatchOperations,
  readProtocolBlocks,
  readSseEvents,
  readWrappedBlock,
  stripProtocolArtifacts,
  stripWrappedBlock,
  toTrimmedText,
} from "../src/site-adapter-runtime/shared.ts";

const protocol = {
  injection: { begin: "[CHAT_PLUS_INJECTION_BEGIN]", end: "[CHAT_PLUS_INJECTION_END]" },
  toolCall: { begin: "[CHAT_PLUS_TOOL_CALL_BEGIN]", end: "[CHAT_PLUS_TOOL_CALL_END]" },
  toolResult: { begin: "[CHAT_PLUS_TOOL_RESULT_BEGIN]", end: "[CHAT_PLUS_TOOL_RESULT_END]" },
  codeMode: { begin: "[CHAT_PLUS_CODE_MODE_BEGIN]", end: "[CHAT_PLUS_CODE_MODE_END]" },
};

function loadAdapter() {
  const source = readFileSync(new URL("../web_chat_js/chatgpt.js", import.meta.url), "utf8");
  return new Function(source)() as Record<string, any>;
}

function createHelpers() {
  return {
    buildInjectedText(injectionText: string, originalText: string) {
      const prefix = String(injectionText || "").trim();
      const original = String(originalText || "");
      return prefix ? `${prefix}\n\n${original}` : original;
    },
    text: {
      toText: toTrimmedText,
    },
    json: {
      parse: parseJsonSafely,
    },
    stream: {
      readSseEvents,
      readPatchOperations,
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

const chatGptSseSample = [
  'event: delta_encoding',
  'data: "v1"',
  "",
  'event: delta',
  'data: {"v":{"message":{"id":"31dbbd5f-0c6c-4f9b-888d-465e191407de","author":{"role":"assistant"},"content":{"content_type":"text","parts":[""]},"status":"in_progress","recipient":"all","channel":"final"}},"c":2}',
  "",
  'event: delta',
  'data: {"o":"patch","v":[{"p":"/message/content/parts/0","o":"append","v":"你说"},{"p":"/message/metadata/token_count","o":"replace","v":7}]}',
  "",
  'event: delta',
  'data: {"v":[{"p":"/message/content/parts/0","o":"append","v":"的“"},{"p":"/message/metadata/token_count","o":"replace","v":9}]}',
  "",
  'event: delta',
  'data: {"v":[{"p":"/message/content/parts/0","o":"append","v":"第二条”是指哪一部分呢？可以"},{"p":"/message/metadata/token_count","o":"replace","v":20}]}',
  "",
  'event: delta',
  'data: {"v":[{"p":"/message/content/parts/0","o":"append","v":"再具体一点吗？我好帮你 😊"},{"p":"/message/status","o":"replace","v":"finished_successfully"},{"p":"/message/end_turn","o":"replace","v":true}]}',
  "",
  "data: [DONE]",
  "",
].join("\n");

test("chatgpt adapter extracts assistant text from current SSE patch stream", () => {
  const adapter = loadAdapter();
  const result = adapter.extractResponse({
    url: "https://chatgpt.com/backend-api/f/conversation",
    responseText: chatGptSseSample,
    helpers: createHelpers(),
    protocol,
  });

  assert.equal(result?.matched, true);
  assert.equal(
    result?.responseContentPreview,
    "你说的“第二条”是指哪一部分呢？可以再具体一点吗？我好帮你 😊",
  );
});

test("chatgpt adapter still injects into the last user text part", () => {
  const adapter = loadAdapter();
  const result = adapter.transformRequest({
    url: "https://chatgpt.com/backend-api/f/conversation",
    bodyText: JSON.stringify({
      action: "next",
      messages: [
        {
          id: "1",
          author: { role: "user" },
          content: { content_type: "text", parts: ["原始问题"] },
        },
      ],
    }),
    injectionText: "系统注入",
    injectionMode: "raw",
    helpers: createHelpers(),
  });

  assert.equal(result?.applied, true);
  assert.match(String(result?.bodyText || ""), /系统注入/);
  assert.match(String(result?.bodyText || ""), /原始问题/);
  assert.equal(result?.requestMessagePath, "body-json:messages[0].content.parts[0]");
});

test("chatgpt adapter returns an enter-based continuation plan for the current composer", () => {
  const adapter = loadAdapter();
  const dom = new JSDOM(`
    <!doctype html>
    <html>
      <body>
        <textarea class="wcDTda_fallbackTextarea" aria-label="与 ChatGPT 聊天"></textarea>
        <div id="prompt-textarea" class="ProseMirror" contenteditable="true" role="textbox"></div>
      </body>
    </html>
  `);
  const result = adapter.continueConversation({
    root: dom.window.document,
    continuationText: "工具结果",
    helpers: createHelpers(),
  });

  assert.ok(result);
  assert.equal(result?.mode, "dom");
  assert.equal(result?.send?.mode, "enter");
  assert.deepEqual(result?.input?.selectors, [
    "#prompt-textarea.ProseMirror",
    'div#prompt-textarea[contenteditable="true"]',
    'textarea[name="prompt-textarea"]',
  ]);
});

test("chatgpt adapter decorates injected user text inside the bubble without replacing the turn shell", () => {
  const adapter = loadAdapter();
  const dom = new JSDOM(`
    <!doctype html>
    <html>
      <body>
        <section data-turn="user">
          <div data-message-author-role="user" class="text-message">
            <div class="flex w-full flex-col gap-1 empty:hidden items-end">
              <div class="user-message-bubble-color">
                <div class="whitespace-pre-wrap">
                  [CHAT_PLUS_INJECTION_BEGIN]
                  hidden setup
                  [CHAT_PLUS_INJECTION_END]

                  你好
                </div>
              </div>
            </div>
          </div>
        </section>
      </body>
    </html>
  `);

  adapter.decorateBubbles({
    root: dom.window.document,
    protocol,
    helpers: createHelpers(),
  });

  const bubble = dom.window.document.querySelector('section[data-turn="user"] .user-message-bubble-color');

  assert.ok(bubble);
  assert.match(bubble?.textContent || "", /【⚙】/);
  assert.match(bubble?.textContent || "", /你好/);
  assert.doesNotMatch(bubble?.textContent || "", /hidden setup/);
});

test("chatgpt adapter also decorates user bubbles when ChatGPT omits the inner whitespace wrapper", () => {
  const adapter = loadAdapter();
  const dom = new JSDOM(`
    <!doctype html>
    <html>
      <body>
        <section data-turn="user">
          <div data-message-author-role="user" class="text-message">
            <div class="flex w-full flex-col gap-1 empty:hidden items-end">
              <div class="user-message-bubble-color">
                [CHAT_PLUS_INJECTION_BEGIN]
                hidden setup
                [CHAT_PLUS_INJECTION_END]

                直接挂在 bubble 上的文本
              </div>
            </div>
          </div>
        </section>
      </body>
    </html>
  `);

  adapter.decorateBubbles({
    root: dom.window.document,
    protocol,
    helpers: createHelpers(),
  });

  const bubble = dom.window.document.querySelector('section[data-turn="user"] .user-message-bubble-color');
  assert.ok(bubble);
  assert.match(bubble?.textContent || "", /【⚙】/);
  assert.match(bubble?.textContent || "", /直接挂在 bubble 上的文本/);
  assert.doesNotMatch(bubble?.textContent || "", /hidden setup/);
});
