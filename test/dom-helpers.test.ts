import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import {
  buildDomContinuationPlan,
  decorateProtocolBubbles,
  validateDomContinuationPlan,
} from "../src/site-adapter-runtime/dom.ts";

const protocol = {
  injection: { begin: "[CHAT_PLUS_INJECTION_BEGIN]", end: "[CHAT_PLUS_INJECTION_END]" },
  toolCall: { begin: "[CHAT_PLUS_TOOL_CALL_BEGIN]", end: "[CHAT_PLUS_TOOL_CALL_END]" },
  toolResult: { begin: "[CHAT_PLUS_TOOL_RESULT_BEGIN]", end: "[CHAT_PLUS_TOOL_RESULT_END]" },
  codeMode: { begin: "[CHAT_PLUS_CODE_MODE_BEGIN]", end: "[CHAT_PLUS_CODE_MODE_END]" },
};

function createDom(html: string) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
  return dom.window.document;
}

test("validateDomContinuationPlan rejects missing input selectors", () => {
  const result = validateDomContinuationPlan({
    mode: "dom",
    composerText: "hello",
    input: {},
    send: { mode: "click", selectors: ["button"] },
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /input selector/);
});

test("buildDomContinuationPlan normalizes selectors against a real root", () => {
  const document = createDom(`<textarea class="composer"></textarea><button class="send"></button>`);
  const plan = buildDomContinuationPlan({
    root: document,
    composerText: "tool result",
    input: {
      selectors: [".composer"],
      kind: "textarea",
      dispatchEvents: ["input", "change"],
    },
    send: {
      mode: "click",
      selectors: [".send"],
    },
  });
  assert.ok(plan);
  assert.deepEqual((plan as any).input.selectors, [".composer"]);
  assert.deepEqual((plan as any).send.selectors, [".send"]);
});

test("decorateProtocolBubbles hides injected user block and marks injected user text", () => {
  const document = createDom(`
    <div class="user">hello
      ${protocol.injection.begin}
      hidden
      ${protocol.injection.end}
    </div>
    <div class="assistant">plain answer</div>
  `);
  const result = decorateProtocolBubbles({
    root: document,
    protocol,
    userSelectors: [".user"],
    assistantSelectors: [".assistant"],
  });
  assert.match(document.querySelector(".user")?.textContent || "", /【⚙】/);
  assert.match(document.querySelector(".user")?.textContent || "", /hello/);
  assert.doesNotMatch(document.querySelector(".user")?.textContent || "", /hidden/);
  assert.equal(result.userBubbleSelector, ".user");
});

test("decorateProtocolBubbles keeps visible user text when injection split label leaks", () => {
  const document = createDom(`
    <div class="user">
      ${protocol.injection.begin}
      hidden setup
      ${protocol.injection.end}
      下面是用户的提问：
      hello world
    </div>
  `);
  decorateProtocolBubbles({
    root: document,
    protocol,
    userSelectors: [".user"],
    assistantSelectors: [],
  });
  const text = document.querySelector(".user")?.textContent || "";
  assert.match(text, /【⚙】/);
  assert.match(text, /hello world/);
  assert.doesNotMatch(text, /hidden setup/);
});

test("decorateProtocolBubbles falls back to request preview when injected bubble loses user text", () => {
  const document = createDom(`
    <div class="user">
      ${protocol.injection.begin}
      hidden setup
      下面是用户的提问：
      ${protocol.injection.end}
    </div>
  `);
  decorateProtocolBubbles({
    root: document,
    protocol,
    userSelectors: [".user"],
    assistantSelectors: [],
    injectedUserFallbackText: "hello fallback",
  });
  const text = document.querySelector(".user")?.textContent || "";
  assert.match(text, /【⚙】/);
  assert.match(text, /hello fallback/);
  assert.doesNotMatch(text, /hidden setup/);
});

test("decorateProtocolBubbles renders tool call card inside injected user bubble", () => {
  const document = createDom(`
    <div class="user">
      ${protocol.injection.begin}
      hidden setup
      ${protocol.injection.end}
      ${protocol.toolCall.begin}
      {"name":"search"}
      ${protocol.toolCall.end}
    </div>
  `);
  decorateProtocolBubbles({
    root: document,
    protocol,
    userSelectors: [".user"],
    assistantSelectors: [],
  });
  const summaryText = document.querySelector(".user summary")?.textContent || "";
  const userText = document.querySelector(".user")?.textContent || "";
  assert.match(summaryText, /工具调用/);
  assert.match(userText, /【⚙】/);
  assert.doesNotMatch(userText, /hidden setup/);
});

test("decorateProtocolBubbles does not leak rendered card text on repeated decoration", () => {
  const document = createDom(`
    <div class="user">
      ${protocol.injection.begin}
      hidden setup
      ${protocol.injection.end}
      ${protocol.toolResult.begin}
      执行成功
      ${protocol.toolResult.end}
    </div>
  `);
  decorateProtocolBubbles({
    root: document,
    protocol,
    userSelectors: [".user"],
    assistantSelectors: [],
  });
  decorateProtocolBubbles({
    root: document,
    protocol,
    userSelectors: [".user"],
    assistantSelectors: [],
  });
  const summaryNodes = document.querySelectorAll(".user summary");
  const firstChildText = document.querySelector(".user")?.firstElementChild?.textContent || "";
  assert.equal(summaryNodes.length, 1);
  assert.equal(firstChildText, "【⚙】");
});

test("decorateProtocolBubbles renders a tool call card with fixed title and hint", () => {
  const document = createDom(`
    <div class="user">hello</div>
    <div class="assistant">
      before
      ${protocol.toolCall.begin}
      {"name":"search"}
      ${protocol.toolCall.end}
      after
    </div>
  `);
  decorateProtocolBubbles({
    root: document,
    protocol,
    userSelectors: [".user"],
    assistantSelectors: [".assistant"],
  });
  const summaryText = document.querySelector(".assistant summary")?.textContent || "";
  assert.match(summaryText, /工具调用/);
  assert.match(summaryText, /点击展开/);
  assert.match(document.querySelector(".assistant")?.textContent || "", /before/);
});

test("decorateProtocolBubbles renders a code mode card with manual run wiring", () => {
  const document = createDom(`
    <div class="user">hello</div>
    <div class="assistant">
      ${protocol.codeMode.begin}
      return 1;
      ${protocol.codeMode.end}
    </div>
  `);
  decorateProtocolBubbles({
    root: document,
    protocol,
    userSelectors: [".user"],
    assistantSelectors: [".assistant"],
  });
  assert.ok(document.querySelector('[data-chat-plus-code-mode-card="1"]'));
  assert.ok(document.querySelector('[data-chat-plus-code-mode-run="1"]'));
  assert.ok(document.querySelector('[data-chat-plus-code-mode-source="1"]'));
});

test("decorateProtocolBubbles gives failed tool results a failure badge", () => {
  const document = createDom(`
    <div class="user">hello</div>
    <div class="assistant">
      ${protocol.toolResult.begin}
      执行失败: timeout
      ${protocol.toolResult.end}
    </div>
  `);
  decorateProtocolBubbles({
    root: document,
    protocol,
    userSelectors: [".user"],
    assistantSelectors: [".assistant"],
  });
  assert.match(document.querySelector(".assistant summary")?.textContent || "", /失败/);
});
