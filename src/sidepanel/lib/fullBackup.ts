import {
  DEFAULT_MCP_CONFIG_STORE,
  MCP_CONFIG_STORAGE_KEY,
  MCP_DISCOVERED_TOOLS_STORAGE_KEY,
  MCP_DISCOVERY_META_STORAGE_KEY,
  MCP_ENABLED_TOOLS_STORAGE_KEY,
  MCP_SITE_ENABLED_TOOLS_STORAGE_KEY,
  mergeDiscoveredTools,
  normalizeConfigStore,
  normalizeDiscoveryMap,
  normalizeDiscoveredToolsByServer,
  sanitizeEnabledToolsMap,
  sanitizeSiteEnabledToolsMap,
} from "../../mcp/shared";
import {
  CODE_MODE_AUTO_CONTINUE_STORAGE_KEY,
} from "../../content/runtime/contentRuntimeState";
import {
  DEFAULT_SYSTEM_INSTRUCTION_PRESET_STORE,
  DEFAULT_SYSTEM_INSTRUCTION_SITE_SELECTION_STATE,
  SYSTEM_INSTRUCTION_PRESETS_STORAGE_KEY,
  SYSTEM_INSTRUCTION_SITE_SELECTION_STORAGE_KEY,
  normalizeSystemInstructionPresetStore,
  sanitizeSystemInstructionPresetIdBySiteKey,
} from "../../system-instructions/shared";
import { MCP_TOOLS_UI_STORAGE_KEY, DEFAULT_MCP_TOOLS_UI_STATE, normalizeCollapsedMap } from "../panes/tools-pane/shared";
import {
  SITE_CONFIG_MAP_STORAGE_KEY,
  isSiteConfigEnabled,
  readStoredSiteConfigMap,
} from "./siteConfig";

export const CHAT_PLUS_FULL_BACKUP_KIND = "chatplus-full-backup";
export const CHAT_PLUS_FULL_BACKUP_VERSION = "2026.04";

export type ChatPlusFullBackupSummary = {
  siteCount: number;
  disabledSiteCount: number;
  serverCount: number;
  systemPresetCount: number;
};

export type ChatPlusFullBackupStoragePayload = {
  local: Record<string, unknown>;
  sync: Record<string, unknown>;
  summary: ChatPlusFullBackupSummary;
};

function normalizeTheme(value: unknown) {
  return value === "light" ? "light" : "dark";
}

function normalizeEnabledFlag(value: unknown, fallback = true) {
  return value === undefined ? fallback : value !== false;
}

function buildSummary(localState: Record<string, unknown>): ChatPlusFullBackupSummary {
  const siteConfigMap = readStoredSiteConfigMap(localState);
  const mcpConfig = normalizeConfigStore(localState[MCP_CONFIG_STORAGE_KEY] || DEFAULT_MCP_CONFIG_STORE);
  const presetStore = normalizeSystemInstructionPresetStore(
    localState[SYSTEM_INSTRUCTION_PRESETS_STORAGE_KEY] || DEFAULT_SYSTEM_INSTRUCTION_PRESET_STORE,
  );
  const siteEntries = Object.values(siteConfigMap);

  return {
    siteCount: siteEntries.length,
    disabledSiteCount: siteEntries.filter((config) => !isSiteConfigEnabled(config)).length,
    serverCount: mcpConfig.servers.length,
    systemPresetCount: presetStore.presets.length,
  };
}

export function normalizeFullBackupStoragePayload(
  rawLocalState: Record<string, unknown> = {},
  rawSyncState: Record<string, unknown> = {},
): ChatPlusFullBackupStoragePayload {
  const siteConfigMap = readStoredSiteConfigMap(rawLocalState);
  const mcpConfig = normalizeConfigStore(rawLocalState[MCP_CONFIG_STORAGE_KEY] || DEFAULT_MCP_CONFIG_STORE);
  const discoveredToolsByServer = normalizeDiscoveredToolsByServer(
    rawLocalState[MCP_DISCOVERED_TOOLS_STORAGE_KEY],
  );
  const discoveryByServer = normalizeDiscoveryMap(rawLocalState[MCP_DISCOVERY_META_STORAGE_KEY]);
  const mergedMcpConfig = mergeDiscoveredTools(mcpConfig, discoveredToolsByServer);
  const enabledToolsByServerId = sanitizeEnabledToolsMap(
    mergedMcpConfig,
    (rawLocalState[MCP_ENABLED_TOOLS_STORAGE_KEY] as any)?.enabledToolsByServerId,
  );
  const enabledToolsBySiteKey = sanitizeSiteEnabledToolsMap(
    mergedMcpConfig,
    (rawLocalState[MCP_SITE_ENABLED_TOOLS_STORAGE_KEY] as any)?.enabledToolsBySiteKey,
  );
  const presetStore = normalizeSystemInstructionPresetStore(
    rawLocalState[SYSTEM_INSTRUCTION_PRESETS_STORAGE_KEY] || DEFAULT_SYSTEM_INSTRUCTION_PRESET_STORE,
  );
  const presetIdBySiteKey = sanitizeSystemInstructionPresetIdBySiteKey(
    presetStore.presets,
    (rawLocalState[SYSTEM_INSTRUCTION_SITE_SELECTION_STORAGE_KEY] as any)?.presetIdBySiteKey,
  );
  const collapsedByServerId = normalizeCollapsedMap(
    (rawLocalState[MCP_TOOLS_UI_STORAGE_KEY] as any)?.collapsedByServerId,
  );

  const local = {
    [SITE_CONFIG_MAP_STORAGE_KEY]: siteConfigMap,
    [MCP_CONFIG_STORAGE_KEY]: mcpConfig,
    [MCP_DISCOVERED_TOOLS_STORAGE_KEY]: discoveredToolsByServer,
    [MCP_DISCOVERY_META_STORAGE_KEY]: discoveryByServer,
    [MCP_ENABLED_TOOLS_STORAGE_KEY]: {
      enabledToolsByServerId,
    },
    [MCP_SITE_ENABLED_TOOLS_STORAGE_KEY]: {
      enabledToolsBySiteKey,
    },
    [SYSTEM_INSTRUCTION_PRESETS_STORAGE_KEY]: presetStore,
    [SYSTEM_INSTRUCTION_SITE_SELECTION_STORAGE_KEY]: {
      presetIdBySiteKey,
    },
    [MCP_TOOLS_UI_STORAGE_KEY]: {
      collapsedByServerId,
    },
  } satisfies Record<string, unknown>;

  const sync = {
    enabled: normalizeEnabledFlag(rawSyncState.enabled, true),
    theme: normalizeTheme(rawSyncState.theme),
    [CODE_MODE_AUTO_CONTINUE_STORAGE_KEY]: normalizeEnabledFlag(
      rawSyncState[CODE_MODE_AUTO_CONTINUE_STORAGE_KEY],
      true,
    ),
  } satisfies Record<string, unknown>;

  return {
    local,
    sync,
    summary: buildSummary(local),
  };
}

export function buildFullBackupPayload(
  rawLocalState: Record<string, unknown> = {},
  rawSyncState: Record<string, unknown> = {},
) {
  const normalized = normalizeFullBackupStoragePayload(rawLocalState, rawSyncState);

  return {
    kind: CHAT_PLUS_FULL_BACKUP_KIND,
    version: CHAT_PLUS_FULL_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: normalized,
  };
}

export function parseFullBackupPayload(rawValue: unknown) {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    throw new Error("备份文件格式错误");
  }

  const source = rawValue as Record<string, unknown>;
  const kind = String(source.kind || "").trim();
  if (kind && kind !== CHAT_PLUS_FULL_BACKUP_KIND) {
    throw new Error("这不是 Chat Plus 的完整配置备份文件");
  }

  const rawData =
    source.data && typeof source.data === "object" && !Array.isArray(source.data)
      ? (source.data as Record<string, unknown>)
      : source;
  const rawLocal =
    rawData.local && typeof rawData.local === "object" && !Array.isArray(rawData.local)
      ? (rawData.local as Record<string, unknown>)
      : {};
  const rawSync =
    rawData.sync && typeof rawData.sync === "object" && !Array.isArray(rawData.sync)
      ? (rawData.sync as Record<string, unknown>)
      : {};

  return normalizeFullBackupStoragePayload(rawLocal, rawSync);
}

export function getFullBackupFileName(date = new Date()) {
  return `chatplus-backup-${date.toISOString().slice(0, 10)}.json`;
}

export const DEFAULT_FULL_BACKUP_SUMMARY: ChatPlusFullBackupSummary = {
  siteCount: 0,
  disabledSiteCount: 0,
  serverCount: 0,
  systemPresetCount: 0,
};

export const DEFAULT_FULL_BACKUP_SYNC_STATE = {
  enabled: true,
  theme: "dark",
  [CODE_MODE_AUTO_CONTINUE_STORAGE_KEY]: true,
};

export const DEFAULT_FULL_BACKUP_LOCAL_STATE = {
  [SITE_CONFIG_MAP_STORAGE_KEY]: {},
  [MCP_CONFIG_STORAGE_KEY]: DEFAULT_MCP_CONFIG_STORE,
  [MCP_DISCOVERED_TOOLS_STORAGE_KEY]: {},
  [MCP_DISCOVERY_META_STORAGE_KEY]: {},
  [MCP_ENABLED_TOOLS_STORAGE_KEY]: { enabledToolsByServerId: {} },
  [MCP_SITE_ENABLED_TOOLS_STORAGE_KEY]: { enabledToolsBySiteKey: {} },
  [SYSTEM_INSTRUCTION_PRESETS_STORAGE_KEY]: DEFAULT_SYSTEM_INSTRUCTION_PRESET_STORE,
  [SYSTEM_INSTRUCTION_SITE_SELECTION_STORAGE_KEY]: DEFAULT_SYSTEM_INSTRUCTION_SITE_SELECTION_STATE,
  [MCP_TOOLS_UI_STORAGE_KEY]: DEFAULT_MCP_TOOLS_UI_STATE,
};
