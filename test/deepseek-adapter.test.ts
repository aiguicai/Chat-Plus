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
  readSseEvents,
  readWrappedBlock,
  stripProtocolArtifacts,
  stripWrappedBlock,
  toTrimmedText,
} from "../src/site-adapter-runtime/shared.ts";

const adapterSource = readFileSync(new URL("../web_chat_js/deepseek.js", import.meta.url), "utf8");

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
    stream: {
      readSseEvents,
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

const deepSeekSseSample = [
  "event: ready",
  'data: {"message":"ok"}',
  "",
  "event: delta",
  'data: {"path":"/message/fragments/0","op":"SET","value":{"type":"RESPONSE","content":"你好"}}',
  "",
  "event: delta",
  'data: {"path":"/message/fragments/0/content","op":"APPEND","value":"呀"}',
  "",
  "event: finish",
  'data: {"value":{"response":{"fragments":[{"type":"RESPONSE","content":"你好呀"}]}}}',
  "",
].join("\n");

const deepSeekThinkingSseSample = [
  "event: ready",
  'data: {"request_message_id":5,"response_message_id":6,"model_type":"default"}',
  "",
  'data: {"v":{"response":{"message_id":6,"parent_id":5,"role":"ASSISTANT","thinking_enabled":true,"fragments":[{"id":2,"type":"THINK","content":"我们","stage_id":1}]}}}',
  "",
  'data: {"p":"response/fragments/-1/content","o":"APPEND","v":"注意到"}',
  "",
  'data: {"v":"用户"}',
  "",
  'data: {"v":"连续"}',
  "",
  'data: {"v":"说了"}',
  "",
  'data: {"v":"三次"}',
  "",
  'data: {"v":"“你好”，可能是测试回应一致性。"}',
  "",
  'data: {"p":"response/fragments","o":"APPEND","v":[{"id":3,"type":"RESPONSE","content":"你好","references":[],"stage_id":1}]}',
  "",
  'data: {"p":"response/fragments/-1/content","v":"呀"}',
  "",
  'data: {"v":"！看来我们很有默契～😊"}',
  "",
  'data: {"v":" 有什么我可以帮你解答的吗？"}',
  "",
  'data: {"p":"response/status","o":"SET","v":"FINISHED"}',
  "",
].join("\n");

const deepSeekThinkingWithProtocolSseSample = [
  "event: ready",
  'data: {"request_message_id":7,"response_message_id":8,"model_type":"default"}',
  "",
  `data: {"v":{"response":{"message_id":8,"parent_id":7,"role":"ASSISTANT","thinking_enabled":true,"fragments":[{"id":4,"type":"THINK","content":"[CHAT_PLUS_TOOL_CALL_BEGIN]\\n{\\\"tool\\\":\\\"danger\\\"}\\n[CHAT_PLUS_TOOL_CALL_END]","stage_id":1}]}}}`,
  "",
  'data: {"p":"response/fragments","o":"APPEND","v":[{"id":5,"type":"RESPONSE","content":"最终只输出普通正文","references":[],"stage_id":1}]}',
  "",
  'data: {"p":"response/status","o":"SET","v":"FINISHED"}',
  "",
].join("\n");

test("deepseek transformRequest injects into prompt", () => {
  const adapter = loadAdapter();
  const result = adapter.transformRequest({
    url: "https://chat.deepseek.com/api/v0/chat/completion",
    bodyText: JSON.stringify({
      chat_session_id: "session-1",
      prompt: "帮我总结一下",
      parent_message_id: 1001,
      model_type: "default",
      search_enabled: false,
      thinking_enabled: false,
    }),
    injectionText: "你可以调用工具",
    injectionMode: "system",
    helpers: createHelpers(),
  });

  assert.equal(result?.applied, true);
  assert.equal(result?.requestMessagePath, "body-json:prompt");
  assert.match(String(result?.bodyText || ""), /\[CHAT_PLUS_INJECTION_BEGIN\]/);
  assert.match(String(result?.bodyText || ""), /帮我总结一下/);
});

test("deepseek extractResponse rebuilds assistant text from fragment deltas", () => {
  const adapter = loadAdapter();
  const result = adapter.extractResponse({
    url: "https://chat.deepseek.com/api/v0/chat/completion",
    responseText: deepSeekSseSample,
    helpers: createHelpers(),
    protocol,
  });

  assert.equal(result?.matched, true);
  assert.equal(result?.responseContentPreview, "你好呀");
  assert.equal(result?.responseContentPath, "sse:data[*].v.response.fragments[*].content");
});

test("deepseek extractResponse ignores THINK fragments in real SSE stream", () => {
  const adapter = loadAdapter();
  const result = adapter.extractResponse({
    url: "https://chat.deepseek.com/api/v0/chat/completion",
    responseText: deepSeekThinkingSseSample,
    helpers: createHelpers(),
    protocol,
  });

  assert.equal(result?.matched, true);
  assert.equal(
    result?.responseContentPreview,
    "你好呀！看来我们很有默契～😊 有什么我可以帮你解答的吗？",
  );
  assert.doesNotMatch(String(result?.responseContentPreview || ""), /测试回应一致性/);
});

test("deepseek extractResponse does not detect protocol blocks from THINK fragments", () => {
  const adapter = loadAdapter();
  const result = adapter.extractResponse({
    url: "https://chat.deepseek.com/api/v0/chat/completion",
    responseText: deepSeekThinkingWithProtocolSseSample,
    helpers: createHelpers(),
    protocol,
  });

  assert.equal(result?.matched, true);
  assert.equal(result?.responseContentPreview, "最终只输出普通正文");
  assert.equal(result?.toolCall?.detected, false);
  assert.equal(result?.toolResult?.detected, false);
  assert.equal(result?.codeMode?.detected, false);
});

test("deepseek continueConversation returns an enter-based textarea plan", () => {
  const adapter = loadAdapter();
  const dom = new JSDOM(`
    <!doctype html>
    <html>
      <body>
        <textarea name="search" placeholder="给 DeepSeek 发送消息 "></textarea>
      </body>
    </html>
  `);

  const result = adapter.continueConversation({
    root: dom.window.document,
    continuationText: "工具执行完成",
    helpers: createHelpers(),
  });

  assert.equal(result?.mode, "dom");
  assert.equal(result?.send?.mode, "enter");
  assert.deepEqual(Array.from(result?.input?.selectors || []), [
    'textarea[name="search"]',
    'textarea[placeholder="给 DeepSeek 发送消息 "]',
  ]);
});

test("deepseek decorateBubbles targets top-level turns so thinking blocks stay inside one assistant node", () => {
  const adapter = loadAdapter();
  const dom = new JSDOM(`
    <!doctype html>
    <html>
      <body>
        <div class="ds-virtual-list-visible-items">
          <div class="_9663006 _2c189bc">
            <div class="d29f3d7d ds-message _63c77b1">
              <div class="fbb737a4">
                [CHAT_PLUS_INJECTION_BEGIN]
                hidden setup
                [CHAT_PLUS_INJECTION_END]

                你好
              </div>
            </div>
            <div class="_11d6b3a">
              <div role="button">copy</div>
            </div>
          </div>
          <div class="_4f9bf79 d7dc56a8 _43c05b5">
            <div class="ds-message _63c77b1">
              <div class="_74c0879">
                <div class="_245c867">
                  <span class="_5255ff8 _4d41763">已思考（用时 3 秒）</span>
                </div>
                <div>中间思考内容</div>
              </div>
              <div class="ds-markdown">
                <p class="ds-markdown-paragraph">
                  <span>最终回答正文</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  `);

  const result = adapter.decorateBubbles({
    root: dom.window.document,
    protocol,
    helpers: createHelpers(),
  });

  assert.deepEqual(Array.from((result?.stats && [result.stats.userNodeCount, result.stats.assistantNodeCount]) || []), [
    1,
    1,
  ]);
  const assistantTurn = dom.window.document.querySelector("._4f9bf79");
  const finalAnswerNode = dom.window.document.querySelector("._4f9bf79 > .ds-message > .ds-markdown");
  assert.match(assistantTurn?.textContent || "", /已思考（用时 3 秒）/);
  assert.match(finalAnswerNode?.textContent || "", /最终回答正文/);
});

test("deepseek decorateBubbles only renders cards inside final answer node and preserves thinking shell", () => {
  const adapter = loadAdapter();
  const dom = new JSDOM(`
    <!doctype html>
    <html>
      <body>
        <div class="ds-virtual-list-visible-items">
          <div class="_4f9bf79 d7dc56a8 _43c05b5">
            <div class="ds-message _63c77b1">
              <div class="_74c0879">
                <div class="_245c867">
                  <span class="_5255ff8 _4d41763">已思考（用时 3 秒）</span>
                </div>
                <div class="e1675d8b ds-think-content _767406f">
                  <div class="ds-markdown">
                    <p class="ds-markdown-paragraph">
                      <span>思考过程原样保留</span>
                    </p>
                  </div>
                </div>
              </div>
              <div class="ds-markdown">
                <p class="ds-markdown-paragraph">
                  <span>[CHAT_PLUS_TOOL_CALL_BEGIN]</span>
                  <span>{"tool":"demo"}</span>
                  <span>[CHAT_PLUS_TOOL_CALL_END]</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  `);

  adapter.decorateBubbles({
    root: dom.window.document,
    protocol,
    helpers: createHelpers(),
  });

  const thinkingShell = dom.window.document.querySelector("._4f9bf79 ._74c0879");
  const thinkingText = dom.window.document.querySelector("._4f9bf79 .e1675d8b");
  const finalAnswerNode = dom.window.document.querySelector("._4f9bf79 > .ds-message > .ds-markdown");
  const renderedCard = finalAnswerNode?.querySelector('details[data-chat-plus-rendered-protocol-card="1"]');

  assert.match(thinkingShell?.textContent || "", /已思考（用时 3 秒）/);
  assert.match(thinkingText?.textContent || "", /思考过程原样保留/);
  assert.ok(renderedCard);
  assert.doesNotMatch(thinkingShell?.innerHTML || "", /data-chat-plus-rendered-protocol-card/);
});

test("deepseek decorateBubbles prefers protocol response preview for the latest assistant card", () => {
  const adapter = loadAdapter();
  const dom = new JSDOM(`
    <!doctype html>
    <html>
      <body>
        <div class="ds-virtual-list-visible-items">
          <div class="_4f9bf79 d7dc56a8 _43c05b5">
            <div class="ds-message _63c77b1">
              <div class="_74c0879">
                <div class="e1675d8b ds-think-content _767406f">
                  <div class="ds-markdown">
                    <p class="ds-markdown-paragraph">
                      <span>思考过程原样保留</span>
                    </p>
                  </div>
                </div>
              </div>
              <div class="ds-markdown">
                <p class="ds-markdown-paragraph">
                  <span>页面上的最终回答已经被 DeepSeek 自己格式化过</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  `);

  adapter.decorateBubbles({
    root: dom.window.document,
    protocol,
    responseContentPreview: [
      "[CHAT_PLUS_CODE_MODE_BEGIN]",
      "const result = await tools.demo.run({ path: \"C:\\\\work\" });",
      "return result;",
      "[CHAT_PLUS_CODE_MODE_END]",
    ].join("\n"),
    helpers: createHelpers(),
  });

  const thinkingText = dom.window.document.querySelector("._4f9bf79 .e1675d8b");
  const finalAnswerNode = dom.window.document.querySelector("._4f9bf79 > .ds-message > .ds-markdown");
  const renderedCard = finalAnswerNode?.querySelector('details[data-chat-plus-rendered-protocol-card="1"]');
  const rawCodeNode = finalAnswerNode?.querySelector('[data-chat-plus-code-mode-source="1"]');

  assert.match(thinkingText?.textContent || "", /思考过程原样保留/);
  assert.ok(renderedCard);
  assert.equal(
    rawCodeNode?.getAttribute("data-chat-plus-code-mode-raw"),
    'const result = await tools.demo.run({ path: "C:\\\\work" });\nreturn result;',
  );
  assert.doesNotMatch(finalAnswerNode?.textContent || "", /页面上的最终回答已经被 DeepSeek 自己格式化过/);
});
