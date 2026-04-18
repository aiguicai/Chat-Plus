import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  buildSiteAdapterChecklist,
  lintSiteAdapterScript,
} from "../src/site-adapter-runtime/contract.ts";
import {
  analyzeSiteAdapterScript,
  validateSiteAdapterScript,
} from "../src/sidepanel/lib/siteAdapter.ts";

test("lint warns when meta is missing", () => {
  const result = lintSiteAdapterScript(`
    return {
      transformRequest() { return null; },
      extractResponse() { return null; },
      decorateBubbles() { return null; },
      continueConversation() { return { mode: "dom", composerText: "x", input: { selectors: ["textarea"] }, send: { mode: "none" } }; },
    };
  `);
  assert.equal(result.hasMeta, false);
  assert.equal(result.warnings.some((warning) => warning.code === "meta.missing"), true);
});

test("lint warns when continueConversation performs DOM side effects", () => {
  const result = lintSiteAdapterScript(`
    return {
      meta: { contractVersion: 2 },
      transformRequest() { return null; },
      extractResponse() { return null; },
      decorateBubbles() { return null; },
      continueConversation() {
        document.querySelector("button")?.click();
        return { ok: true };
      },
    };
  `);
  assert.equal(
    result.warnings.some((warning) => warning.code === "continueConversation.sideEffects"),
    true,
  );
});

test("lint warns when extractResponse truncates responseContentPreview", () => {
  const result = lintSiteAdapterScript(`
    return {
      meta: { contractVersion: 2 },
      transformRequest() { return null; },
      extractResponse(ctx) {
        const text = String(ctx.responseText || "");
        return { matched: true, responseContentPreview: text.slice(0, 200) };
      },
      decorateBubbles() { return null; },
      continueConversation() { return { mode: "dom", composerText: "x", input: { selectors: ["textarea"] }, send: { mode: "none" } }; },
    };
  `);
  assert.equal(
    result.warnings.some((warning) => warning.code === "extractResponse.truncatedPreview"),
    true,
  );
});

test("validateSiteAdapterScript rejects adapters that do not follow the new helper-based contract", () => {
  const result = validateSiteAdapterScript(`
    return {
      meta: { contractVersion: 2, adapterName: "Bad Adapter" },
      transformRequest() { return null; },
      extractResponse() { return null; },
      decorateBubbles() {
        return { userBubbleSelector: ".user", assistantBubbleSelector: ".assistant" };
      },
      continueConversation() {
        return {
          mode: "dom",
          composerText: "x",
          input: { selectors: ["textarea"] },
          send: { mode: "none" },
        };
      },
    };
  `);
  assert.equal(result.ok, false);
  assert.match(result.error, /decorateBubbles 必须使用 ctx\.helpers\.ui\.decorateProtocolBubbles/);
});

test("buildSiteAdapterChecklist marks continuationText as required", () => {
  const checklist = buildSiteAdapterChecklist(`
    return {
      meta: { contractVersion: 2, adapterName: "Bad Adapter" },
      transformRequest() { return null; },
      extractResponse() { return { matched: true, responseContentPreview: "x" }; },
      decorateBubbles(ctx) {
        return ctx.helpers.ui.decorateProtocolBubbles({
          root: ctx.root || document,
          protocol: ctx.protocol,
          userSelectors: [".user"],
          assistantSelectors: [".assistant"],
        });
      },
      continueConversation() {
        return {
          mode: "dom",
          composerText: "x",
          input: { selectors: ["textarea"] },
          send: { mode: "none" },
        };
      },
    };
  `);
  assert.equal(checklist.find((item) => item.id === "continuation.text")?.status, "fail");
});

test("analyzeSiteAdapterScript reports helper-based adapter as pass-heavy", () => {
  const result = analyzeSiteAdapterScript(`
    return {
      meta: {
        contractVersion: 2,
        adapterName: "Good Adapter",
        capabilities: { requestInjection: "json-body", responseExtraction: "json", protocolCards: "helper", autoContinuation: "dom-plan" },
      },
      transformRequest(ctx) {
        return {
          applied: true,
          bodyText: ctx.helpers.buildInjectedText(ctx.injectionText, "hi", ctx.injectionMode),
        };
      },
      extractResponse() {
        return { matched: true, responseContentPreview: "hello" };
      },
      decorateBubbles(ctx) {
        return ctx.helpers.ui.decorateProtocolBubbles({
          root: ctx.root || document,
          protocol: ctx.protocol,
          userSelectors: [".user"],
          assistantSelectors: [".assistant"],
        });
      },
      continueConversation(ctx) {
        return ctx.helpers.plans.dom({
          root: ctx.root,
          composerText: ctx.continuationText,
          input: { selectors: ["textarea"], kind: "textarea", dispatchEvents: ["input"] },
          send: { mode: "click", selectors: ["button"] },
        });
      },
    };
  `);
  assert.equal(result.ok, true);
  assert.equal(result.implementation.usesProtocolBubbleHelper, true);
  assert.equal(result.implementation.usesDomPlanHelper, true);
  assert.equal(result.summary.passCount >= 8, true);
});

test("migrated bundled adapters include meta and continuation helper usage", () => {
  const root = path.resolve(process.cwd(), "web_chat_js");
  const files = [
    "arena.js",
    "chat-qwen.js",
    "chatgpt.js",
    "deepseek.js",
    "doubao.js",
    "gemini.js",
    "google-ai-studio.js",
    "xiaomi-mimo.js",
    "zai.js",
  ];

  files.forEach((fileName) => {
    const source = readFileSync(path.join(root, fileName), "utf8");
    assert.match(source, /meta:\s*\{/);
    assert.match(source, /contractVersion:\s*2/);
    assert.match(source, /ctx\.helpers\.plans\.dom/);
  });
});

test("most migrated bundled adapters reuse the centralized protocol bubble helper", () => {
  const root = path.resolve(process.cwd(), "web_chat_js");
  const files = [
    "arena.js",
    "chat-qwen.js",
    "chatgpt.js",
    "deepseek.js",
    "doubao.js",
    "gemini.js",
    "google-ai-studio.js",
    "xiaomi-mimo.js",
    "zai.js",
  ];
  files.forEach((fileName) => {
    const source = readFileSync(path.join(root, fileName), "utf8");
    assert.match(source, /ctx\.helpers\.ui\.decorateProtocolBubbles/);
  });
});

test("bundled chat-qwen adapter passes response preview validation", () => {
  const source = readFileSync(path.resolve(process.cwd(), "web_chat_js", "chat-qwen.js"), "utf8");
  const result = validateSiteAdapterScript(source);
  assert.equal(result.ok, true);
});

test("bundled adapters no longer carry custom protocol card renderers", () => {
  const root = path.resolve(process.cwd(), "web_chat_js");
  const files = [
    "arena.js",
    "chat-qwen.js",
    "chatgpt.js",
    "deepseek.js",
    "doubao.js",
    "gemini.js",
    "google-ai-studio.js",
    "xiaomi-mimo.js",
    "zai.js",
  ];

  files.forEach((fileName) => {
    const source = readFileSync(path.join(root, fileName), "utf8");
    assert.doesNotMatch(source, /\bfunction\s+renderProtocolCard\s*\(/);
    assert.doesNotMatch(source, /\bfunction\s+getProtocolCardTheme\s*\(/);
    assert.doesNotMatch(source, /\bfunction\s+detectToolResultTone\s*\(/);
    assert.doesNotMatch(source, /\bfunction\s+formatCodeModeDisplayText\s*\(/);
  });
});
