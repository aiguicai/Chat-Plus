import test from "node:test";
import assert from "node:assert/strict";

import {
  SITE_CONFIG_MAP_STORAGE_KEY,
  isSiteConfigEnabled,
  normalizeSiteConfig,
  readStoredSiteConfigMap,
} from "../src/sidepanel/lib/siteConfig.ts";

const VALID_ADAPTER_SCRIPT = `
  return {
    meta: {
      contractVersion: 2,
      adapterName: "Good Adapter",
      capabilities: {
        requestInjection: "json-body",
        responseExtraction: "json",
        protocolCards: "helper",
        autoContinuation: "dom-plan",
      },
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
`;

test("normalizeSiteConfig defaults site enabled state to true", () => {
  const normalized = normalizeSiteConfig({ adapterScript: VALID_ADAPTER_SCRIPT });
  assert.equal(normalized.enabled, true);
  assert.equal(isSiteConfigEnabled(normalized), true);
});

test("readStoredSiteConfigMap keeps persisted disabled site state", () => {
  const stored = readStoredSiteConfigMap({
    [SITE_CONFIG_MAP_STORAGE_KEY]: {
      "chat.deepseek.com": {
        enabled: false,
        adapterScript: VALID_ADAPTER_SCRIPT,
      },
    },
  });

  assert.equal(stored["chat.deepseek.com"]?.enabled, false);
  assert.equal(isSiteConfigEnabled(stored["chat.deepseek.com"]), false);
});
