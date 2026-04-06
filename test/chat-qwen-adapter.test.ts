import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const adapterSource = readFileSync(
  new URL("../web_chat_js/chat-qwen.js", import.meta.url),
  "utf8",
);

function loadAdapter() {
  return new vm.Script(`(function(){\n${adapterSource}\n})()`).runInNewContext({});
}

function createHelpers() {
  return {
    text: {
      toText(value: unknown) {
        return String(value ?? "").trim();
      },
    },
    json: {
      parse(value: string) {
        return JSON.parse(value);
      },
    },
    buildInjectedText(injectionText: string, originalText: string, injectionMode = "system") {
      const prefix = String(injectionText || "").trim();
      if (!prefix) return originalText;
      if (String(injectionMode || "").toLowerCase() === "raw") {
        return `${prefix}\n\n${originalText}`;
      }
      return [
        "[CHAT_PLUS_INJECTION_BEGIN]",
        prefix,
        "",
        "下面是用户的提问：",
        "[CHAT_PLUS_INJECTION_END]",
        "",
        originalText,
      ].join("\n");
    },
  };
}

test("chat-qwen transformRequest injects into nested text parts", () => {
  const adapter = loadAdapter();
  const result = adapter.transformRequest({
    bodyText: JSON.stringify({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "请总结一下",
            },
          ],
        },
      ],
    }),
    injectionText: "你可以调用工具",
    injectionMode: "system",
    helpers: createHelpers(),
  });

  assert.equal(result?.applied, true);
  assert.equal(result?.requestMessagePath, "body-json:messages[0].content[0].text");

  const payload = JSON.parse(String(result?.bodyText || "{}"));
  assert.match(payload.messages[0].content[0].text, /\[CHAT_PLUS_INJECTION_BEGIN\]/);
  assert.match(payload.messages[0].content[0].text, /请总结一下/);
});

test("chat-qwen transformRequest finds nested prompt slot in follow-up shapes", () => {
  const adapter = loadAdapter();
  const result = adapter.transformRequest({
    bodyText: JSON.stringify({
      messages: [
        {
          role: "assistant",
          content: "上一次回复",
        },
        {
          role: "user",
          payload: {
            segments: [
              {
                meta: { kind: "input" },
                prompt: "继续往下说",
              },
            ],
          },
        },
      ],
    }),
    injectionText: "你可以调用工具",
    injectionMode: "system",
    helpers: createHelpers(),
  });

  assert.equal(result?.applied, true);
  assert.equal(result?.requestMessagePath, "body-json:messages[1].payload.segments[0].prompt");

  const payload = JSON.parse(String(result?.bodyText || "{}"));
  assert.match(payload.messages[1].payload.segments[0].prompt, /继续往下说/);
  assert.match(payload.messages[1].payload.segments[0].prompt, /\[CHAT_PLUS_INJECTION_BEGIN\]/);
});
