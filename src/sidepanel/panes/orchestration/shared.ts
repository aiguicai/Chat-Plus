import {
  normalizeSiteToolScopeKey,
  normalizeTabId,
  sanitizeSiteEnabledToolsMap,
  sanitizeTabEnabledToolsMap,
  toSafeString,
  type McpConfigStore,
  type McpEnabledToolsMap,
  type McpSiteEnabledToolsMap,
  type McpTabEnabledToolsMap,
} from "../../../mcp/shared";
import type {
  SystemInstructionSiteSelectionState,
  SystemInstructionTabSelectionState,
} from "../../../system-instructions/shared";
import type { OrchestrationTab } from "../../types";

export type TabAddedServerIdsMap = Record<string, string[]>;
export type SiteAddedServerIdsMap = Record<string, string[]>;

export type TabToolsState = {
  enabledToolsByTabId: McpTabEnabledToolsMap;
  addedServerIdsByTabId: TabAddedServerIdsMap;
};

export type SiteToolsState = {
  enabledToolsBySiteKey: McpSiteEnabledToolsMap;
  addedServerIdsBySiteKey: SiteAddedServerIdsMap;
};

export type TabSystemInstructionState = SystemInstructionTabSelectionState;
export type SiteSystemInstructionState = SystemInstructionSiteSelectionState;

export const DEFAULT_TAB_TOOLS_STATE: TabToolsState = {
  enabledToolsByTabId: {},
  addedServerIdsByTabId: {},
};

export const DEFAULT_SITE_TOOLS_STATE: SiteToolsState = {
  enabledToolsBySiteKey: {},
  addedServerIdsBySiteKey: {},
};

export const countEnabledTools = (enabledToolsByServerId: McpEnabledToolsMap) =>
  Object.values(enabledToolsByServerId).reduce(
    (count, toolNames) => count + (Array.isArray(toolNames) ? toolNames.length : 0),
    0,
  );

export const previewSystemInstructionContent = (value = "", maxLength = 120) => {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
};

export const buildTabServerKey = (tabId: number | string, serverId: string) =>
  `${normalizeTabId(tabId)}/${toSafeString(serverId)}`;

export const buildSiteToolScopeKey = (tab: Pick<OrchestrationTab, "host" | "url"> | string) => {
  if (typeof tab === "string") return normalizeSiteToolScopeKey(tab);
  const host = normalizeSiteToolScopeKey(tab.host);
  if (host) return host;
  try {
    return normalizeSiteToolScopeKey(new URL(tab.url).host);
  } catch {
    return "";
  }
};

export const mergeServerIdLists = (...lists: Array<string[] | undefined>) =>
  Array.from(
    new Set(
      lists.flatMap((list) =>
        Array.isArray(list) ? list.map((serverId) => toSafeString(serverId)).filter(Boolean) : [],
      ),
    ),
  );

export const mergeEnabledToolsByServerMaps = (
  ...maps: Array<McpEnabledToolsMap | undefined>
): McpEnabledToolsMap => {
  const nextMap: McpEnabledToolsMap = {};

  maps.forEach((map) => {
    if (!map || typeof map !== "object") return;
    Object.entries(map).forEach(([rawServerId, rawToolNames]) => {
      const serverId = toSafeString(rawServerId);
      if (!serverId || !Array.isArray(rawToolNames)) return;
      const nextToolNames = mergeServerIdLists(nextMap[serverId], rawToolNames);
      if (nextToolNames.length) nextMap[serverId] = nextToolNames;
    });
  });

  return nextMap;
};

export function sanitizeAddedServerIdsByTabId(
  config: McpConfigStore,
  rawValue: unknown,
  allowedTabIds?: Array<number | string>,
  enabledToolsByTabId: McpTabEnabledToolsMap = {},
) {
  const rawMap =
    rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
      ? (rawValue as Record<string, unknown>)
      : {};
  const allowedTabIdSet = Array.isArray(allowedTabIds)
    ? new Set(allowedTabIds.map((tabId) => normalizeTabId(tabId)).filter(Boolean))
    : null;
  const availableServerIds = new Set(config.servers.map((server) => server.id));
  const nextMap: TabAddedServerIdsMap = {};

  Object.entries(rawMap).forEach(([rawTabId, rawServerIds]) => {
    const tabId = normalizeTabId(rawTabId);
    if (!tabId || (allowedTabIdSet && !allowedTabIdSet.has(tabId)) || !Array.isArray(rawServerIds)) return;

    const serverIds = Array.from(
      new Set(
        rawServerIds
          .map((serverId) => toSafeString(serverId))
          .filter((serverId) => serverId && availableServerIds.has(serverId)),
      ),
    );
    if (serverIds.length) nextMap[tabId] = serverIds;
  });

  Object.entries(enabledToolsByTabId).forEach(([rawTabId, enabledToolsByServer]) => {
    const tabId = normalizeTabId(rawTabId);
    if (!tabId || (allowedTabIdSet && !allowedTabIdSet.has(tabId))) return;
    const serverIds = new Set(nextMap[tabId] || []);
    Object.keys(enabledToolsByServer).forEach((serverId) => {
      if (availableServerIds.has(serverId)) serverIds.add(serverId);
    });
    if (serverIds.size) nextMap[tabId] = Array.from(serverIds);
  });

  return nextMap;
}

export function sanitizeAddedServerIdsBySiteKey(
  config: McpConfigStore,
  rawValue: unknown,
  allowedScopeKeys?: string[],
  enabledToolsBySiteKey: McpSiteEnabledToolsMap = {},
) {
  const rawMap =
    rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
      ? (rawValue as Record<string, unknown>)
      : {};
  const allowedScopeKeySet = Array.isArray(allowedScopeKeys)
    ? new Set(allowedScopeKeys.map((scopeKey) => normalizeSiteToolScopeKey(scopeKey)).filter(Boolean))
    : null;
  const availableServerIds = new Set(config.servers.map((server) => server.id));
  const nextMap: SiteAddedServerIdsMap = {};

  Object.entries(rawMap).forEach(([rawScopeKey, rawServerIds]) => {
    const scopeKey = normalizeSiteToolScopeKey(rawScopeKey);
    if (
      !scopeKey ||
      (allowedScopeKeySet && !allowedScopeKeySet.has(scopeKey)) ||
      !Array.isArray(rawServerIds)
    ) {
      return;
    }

    const serverIds = Array.from(
      new Set(
        rawServerIds
          .map((serverId) => toSafeString(serverId))
          .filter((serverId) => serverId && availableServerIds.has(serverId)),
      ),
    );
    if (serverIds.length) nextMap[scopeKey] = serverIds;
  });

  Object.entries(enabledToolsBySiteKey).forEach(([rawScopeKey, enabledToolsByServer]) => {
    const scopeKey = normalizeSiteToolScopeKey(rawScopeKey);
    if (!scopeKey || (allowedScopeKeySet && !allowedScopeKeySet.has(scopeKey))) return;
    const serverIds = new Set(nextMap[scopeKey] || []);
    Object.keys(enabledToolsByServer).forEach((serverId) => {
      if (availableServerIds.has(serverId)) serverIds.add(serverId);
    });
    if (serverIds.size) nextMap[scopeKey] = Array.from(serverIds);
  });

  return nextMap;
}

export function sanitizeToolStateForTabs(
  nextConfig: McpConfigStore,
  nextEnabled: McpTabEnabledToolsMap,
  nextAdded: TabAddedServerIdsMap,
  nextSiteEnabled: McpSiteEnabledToolsMap,
  nextSiteAdded: SiteAddedServerIdsMap,
  currentTabIds: Array<number | string>,
) {
  const sanitizedEnabled = sanitizeTabEnabledToolsMap(nextConfig, nextEnabled, currentTabIds);
  const sanitizedAdded = sanitizeAddedServerIdsByTabId(
    nextConfig,
    nextAdded,
    currentTabIds,
    sanitizedEnabled,
  );
  const sanitizedSiteEnabled = sanitizeSiteEnabledToolsMap(nextConfig, nextSiteEnabled);
  const sanitizedSiteAdded = sanitizeAddedServerIdsBySiteKey(
    nextConfig,
    nextSiteAdded,
    undefined,
    sanitizedSiteEnabled,
  );

  return {
    sanitizedEnabled,
    sanitizedAdded,
    sanitizedSiteEnabled,
    sanitizedSiteAdded,
  };
}
