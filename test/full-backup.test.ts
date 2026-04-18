import test from "node:test";
import assert from "node:assert/strict";

import {
  MCP_CONFIG_STORAGE_KEY,
  MCP_DISCOVERED_TOOLS_STORAGE_KEY,
  MCP_DISCOVERY_META_STORAGE_KEY,
  MCP_ENABLED_TOOLS_STORAGE_KEY,
  MCP_SITE_ENABLED_TOOLS_STORAGE_KEY,
} from "../src/mcp/shared.ts";
import { CODE_MODE_AUTO_CONTINUE_STORAGE_KEY } from "../src/content/runtime/contentRuntimeState.ts";
import {
  buildFullBackupPayload,
  parseFullBackupPayload,
} from "../src/sidepanel/lib/fullBackup.ts";
import { SITE_CONFIG_MAP_STORAGE_KEY } from "../src/sidepanel/lib/siteConfig.ts";
import {
  SYSTEM_INSTRUCTION_PRESETS_STORAGE_KEY,
  SYSTEM_INSTRUCTION_SITE_SELECTION_STORAGE_KEY,
} from "../src/system-instructions/shared.ts";

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

test("full backup payload preserves site enabled state and portable settings", () => {
  const localState = {
    [SITE_CONFIG_MAP_STORAGE_KEY]: {
      "chat.deepseek.com": {
        enabled: false,
        adapterScript: VALID_ADAPTER_SCRIPT,
      },
    },
    [MCP_CONFIG_STORAGE_KEY]: {
      servers: [
        {
          id: "server-1",
          name: "Server 1",
          enabled: true,
          type: "streamable-http",
          url: "https://example.com/mcp",
          headers: {},
        },
      ],
      updatedAt: 10,
    },
    [MCP_DISCOVERED_TOOLS_STORAGE_KEY]: {
      "server-1": [
        {
          name: "search",
          description: "Search",
          inputSchema: {},
        },
      ],
    },
    [MCP_DISCOVERY_META_STORAGE_KEY]: {
      "server-1": {
        ok: true,
        error: "",
        fetchedAt: 11,
        toolCount: 1,
      },
    },
    [MCP_ENABLED_TOOLS_STORAGE_KEY]: {
      enabledToolsByServerId: {
        "server-1": ["search"],
      },
    },
    [MCP_SITE_ENABLED_TOOLS_STORAGE_KEY]: {
      enabledToolsBySiteKey: {
        "chat.deepseek.com": {
          "server-1": ["search"],
        },
      },
    },
    [SYSTEM_INSTRUCTION_PRESETS_STORAGE_KEY]: {
      presets: [
        {
          id: "preset-1",
          name: "Default",
          content: "You are helpful.",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      updatedAt: 2,
    },
    [SYSTEM_INSTRUCTION_SITE_SELECTION_STORAGE_KEY]: {
      presetIdBySiteKey: {
        "chat.deepseek.com": "preset-1",
      },
    },
  };
  const syncState = {
    enabled: true,
    theme: "light",
    [CODE_MODE_AUTO_CONTINUE_STORAGE_KEY]: false,
  };

  const payload = buildFullBackupPayload(localState, syncState);
  const restored = parseFullBackupPayload(payload);

  assert.equal(
    (restored.local[SITE_CONFIG_MAP_STORAGE_KEY] as Record<string, { enabled?: boolean }>)["chat.deepseek.com"]
      ?.enabled,
    false,
  );
  assert.equal(restored.sync.theme, "light");
  assert.equal(restored.sync.enabled, true);
  assert.equal(restored.sync[CODE_MODE_AUTO_CONTINUE_STORAGE_KEY], false);
  assert.deepEqual(
    (restored.local[MCP_SITE_ENABLED_TOOLS_STORAGE_KEY] as { enabledToolsBySiteKey: Record<string, unknown> })
      .enabledToolsBySiteKey["chat.deepseek.com"],
    {
      "server-1": ["search"],
    },
  );
  assert.equal(restored.summary.siteCount, 1);
  assert.equal(restored.summary.disabledSiteCount, 1);
  assert.equal(restored.summary.serverCount, 1);
  assert.equal(restored.summary.systemPresetCount, 1);
});
