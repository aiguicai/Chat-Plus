import { useEffect, useMemo, useRef, useState } from "react";

import {
  ensureChatPlusRuntime,
  getStorage,
  sendRuntimeMessage,
  sendTabMessage,
  setStorage,
} from "../../lib/chrome";
import { getErrorMessage } from "../../lib/format";
import type { OrchestrationTab } from "../../types";
import {
  DEFAULT_MCP_CONFIG_STORE,
  MCP_CONFIG_STORAGE_KEY,
  MCP_DISCOVERED_TOOLS_STORAGE_KEY,
  MCP_DISCOVERY_META_STORAGE_KEY,
  MCP_SITE_ENABLED_TOOLS_STORAGE_KEY,
  MCP_TAB_ENABLED_TOOLS_STORAGE_KEY,
  countDiscoveredTools,
  normalizeConfigStore,
  normalizeDiscoveryMap,
  normalizeTabId,
  sanitizeSiteEnabledToolsMap,
  sanitizeTabEnabledToolsMap,
  toSafeString,
  type McpConfigStore,
  type McpDiscoveryMap,
  type McpEnabledToolsMap,
  type McpSiteEnabledToolsMap,
  type McpTabEnabledToolsMap,
} from "../../../mcp/shared";
import {
  DEFAULT_SITE_TOOLS_STATE,
  DEFAULT_TAB_TOOLS_STATE,
  buildSiteToolScopeKey,
  buildTabServerKey,
  countEnabledTools,
  mergeServerIdLists,
  sanitizeAddedServerIdsBySiteKey,
  sanitizeAddedServerIdsByTabId,
  type SiteAddedServerIdsMap,
  type SiteToolsState,
  type TabAddedServerIdsMap,
  type TabToolsState,
} from "./shared";

type UseOrchestrationToolsOptions = {
  active: boolean;
  tabs: OrchestrationTab[];
};

export type OrchestrationToolView = {
  siteKey: string;
  tabSelection: Record<string, string[]>;
  addedServerIds: string[];
  addedServers: McpConfigStore["servers"];
  enabledToolCount: number;
  hasEnabledTools: boolean;
  isToolsOpen: boolean;
  isAddServerOpen: boolean;
};

type SanitizedTabToolState = {
  sanitizedEnabled: McpTabEnabledToolsMap;
  sanitizedAdded: TabAddedServerIdsMap;
};

type SanitizedSiteToolState = {
  sanitizedEnabled: McpSiteEnabledToolsMap;
  sanitizedAdded: SiteAddedServerIdsMap;
};

function cloneEnabledToolsByServer(map: McpEnabledToolsMap | undefined) {
  if (!map || typeof map !== "object") return {};
  return Object.fromEntries(
    Object.entries(map).map(([serverId, toolNames]) => [
      serverId,
      Array.isArray(toolNames) ? [...toolNames] : [],
    ]),
  ) as McpEnabledToolsMap;
}

function normalizeToolNameList(toolNames: unknown) {
  return Array.from(
    new Set(
      (Array.isArray(toolNames) ? toolNames : [])
        .map((toolName) => toSafeString(toolName))
        .filter(Boolean),
    ),
  );
}

function sanitizeTabToolState(
  nextConfig: McpConfigStore,
  nextEnabled: McpTabEnabledToolsMap,
  nextAdded: TabAddedServerIdsMap,
  currentTabIds?: Array<number | string>,
): SanitizedTabToolState {
  const sanitizedEnabled = sanitizeTabEnabledToolsMap(nextConfig, nextEnabled, currentTabIds);
  const sanitizedAdded = sanitizeAddedServerIdsByTabId(
    nextConfig,
    nextAdded,
    currentTabIds,
    sanitizedEnabled,
  );

  return {
    sanitizedEnabled,
    sanitizedAdded,
  };
}

function sanitizeSiteToolState(
  nextConfig: McpConfigStore,
  nextEnabled: McpSiteEnabledToolsMap,
  nextAdded: SiteAddedServerIdsMap,
  currentSiteKeys?: string[],
): SanitizedSiteToolState {
  const sanitizedEnabled = sanitizeSiteEnabledToolsMap(nextConfig, nextEnabled, currentSiteKeys);
  const sanitizedAdded = sanitizeAddedServerIdsBySiteKey(
    nextConfig,
    nextAdded,
    currentSiteKeys,
    sanitizedEnabled,
  );

  return {
    sanitizedEnabled,
    sanitizedAdded,
  };
}

function hydrateTabToolStateFromSites(
  nextConfig: McpConfigStore,
  tabs: OrchestrationTab[],
  nextEnabled: McpTabEnabledToolsMap,
  nextAdded: TabAddedServerIdsMap,
  siteEnabled: McpSiteEnabledToolsMap,
  siteAdded: SiteAddedServerIdsMap,
) {
  const hydratedEnabled: McpTabEnabledToolsMap = { ...nextEnabled };
  const hydratedAdded: TabAddedServerIdsMap = { ...nextAdded };
  let hydrated = false;

  tabs.forEach((tab) => {
    const normalizedTabId = normalizeTabId(tab.tabId);
    if (!normalizedTabId) return;

    const hasExplicitTabSelection = Boolean(
      hydratedEnabled[normalizedTabId] &&
        Object.keys(hydratedEnabled[normalizedTabId]).length > 0,
    );
    const hasExplicitTabServers = Boolean(
      Array.isArray(hydratedAdded[normalizedTabId]) &&
        hydratedAdded[normalizedTabId].length > 0,
    );
    if (hasExplicitTabSelection || hasExplicitTabServers) return;

    const siteKey = buildSiteToolScopeKey(tab);
    if (!siteKey) return;

    const siteEnabledByServer = siteEnabled[siteKey];
    const siteAddedServerIds = siteAdded[siteKey];

    if (siteEnabledByServer && Object.keys(siteEnabledByServer).length > 0) {
      hydratedEnabled[normalizedTabId] = cloneEnabledToolsByServer(siteEnabledByServer);
      hydrated = true;
    }

    if (Array.isArray(siteAddedServerIds) && siteAddedServerIds.length > 0) {
      hydratedAdded[normalizedTabId] = [...siteAddedServerIds];
      hydrated = true;
    }
  });

  const sanitized = sanitizeTabToolState(
    nextConfig,
    hydratedEnabled,
    hydratedAdded,
    tabs.map((tab) => tab.tabId),
  );

  return {
    ...sanitized,
    hydrated,
  };
}

function collectManagedTabIds(
  currentTabIds: Array<number | string>,
  ...maps: Array<Record<string, unknown> | undefined>
) {
  return Array.from(
    new Set(
      [
        ...currentTabIds.map((tabId) => normalizeTabId(tabId)).filter(Boolean),
        ...maps.flatMap((map) =>
          Object.keys(map || {})
            .map((tabId) => normalizeTabId(tabId))
            .filter(Boolean),
        ),
      ],
    ),
  );
}

function collectManagedSiteKeys(
  currentSiteKeys: string[],
  ...maps: Array<Record<string, unknown> | undefined>
) {
  return Array.from(
    new Set(
      [
        ...currentSiteKeys.map((siteKey) => toSafeString(siteKey)).filter(Boolean),
        ...maps.flatMap((map) =>
          Object.keys(map || {})
            .map((siteKey) => toSafeString(siteKey))
            .filter(Boolean),
        ),
      ],
    ),
  );
}

export function useOrchestrationTools({ active, tabs }: UseOrchestrationToolsOptions) {
  const safeTabs = Array.isArray(tabs) ? tabs : [];
  const [mcpConfig, setMcpConfig] = useState<McpConfigStore>(DEFAULT_MCP_CONFIG_STORE);
  const [discoveryByServer, setDiscoveryByServer] = useState<McpDiscoveryMap>({});
  const [enabledToolsByTabId, setEnabledToolsByTabId] = useState<McpTabEnabledToolsMap>({});
  const [addedServerIdsByTabId, setAddedServerIdsByTabId] = useState<TabAddedServerIdsMap>({});
  const [loadingTools, setLoadingTools] = useState(false);
  const [toolsError, setToolsError] = useState("");
  const [openToolTabId, setOpenToolTabId] = useState<number | null>(null);
  const [openAddServerTabId, setOpenAddServerTabId] = useState<number | null>(null);
  const [expandedServerKeys, setExpandedServerKeys] = useState<Record<string, boolean>>({});
  const tabEnabledRef = useRef<McpTabEnabledToolsMap>({});
  const tabAddedRef = useRef<TabAddedServerIdsMap>({});
  const siteEnabledRef = useRef<McpSiteEnabledToolsMap>({});
  const siteAddedRef = useRef<SiteAddedServerIdsMap>({});
  const toolStateMutationSequenceRef = useRef(0);
  const toolStateLoadSequenceRef = useRef(0);
  const toolStatePersistChainRef = useRef<Promise<void>>(Promise.resolve());
  const currentTabIds = useMemo(() => safeTabs.map((tab) => tab.tabId), [safeTabs]);
  const tabSiteKeyById = useMemo(
    () =>
      Object.fromEntries(
        safeTabs.map((tab) => [String(tab.tabId), buildSiteToolScopeKey(tab)] as const),
      ) as Record<string, string>,
    [safeTabs],
  );
  const currentSiteKeys = useMemo(
    () => Array.from(new Set(Object.values(tabSiteKeyById).filter(Boolean))),
    [tabSiteKeyById],
  );
  const totalToolCount = useMemo(() => countDiscoveredTools(mcpConfig), [mcpConfig]);

  const getEffectiveSelectionForTab = (tabId: number | string) => {
    const normalizedTabId = normalizeTabId(tabId);
    const siteKey = normalizedTabId ? tabSiteKeyById[normalizedTabId] : "";
    return {
      ...cloneEnabledToolsByServer(siteKey ? siteEnabledRef.current[siteKey] || {} : {}),
      ...cloneEnabledToolsByServer(tabEnabledRef.current[normalizedTabId] || {}),
    };
  };

  const getEffectiveAddedServerIdsForTab = (tabId: number | string) => {
    const normalizedTabId = normalizeTabId(tabId);
    const siteKey = normalizedTabId ? tabSiteKeyById[normalizedTabId] : "";
    return mergeServerIdLists(
      siteKey ? siteAddedRef.current[siteKey] : [],
      addedServerIdsByTabId[normalizedTabId],
      Object.keys(getEffectiveSelectionForTab(normalizedTabId)),
    );
  };

  const applyState = (
    nextTabEnabled: McpTabEnabledToolsMap,
    nextTabAdded: TabAddedServerIdsMap,
    nextSiteEnabled: McpSiteEnabledToolsMap,
    nextSiteAdded: SiteAddedServerIdsMap,
  ) => {
    tabEnabledRef.current = nextTabEnabled;
    tabAddedRef.current = nextTabAdded;
    siteEnabledRef.current = nextSiteEnabled;
    siteAddedRef.current = nextSiteAdded;
    setEnabledToolsByTabId(nextTabEnabled);
    setAddedServerIdsByTabId(nextTabAdded);
  };

  const refreshSystemInstructionRuntime = async (tabId: number) => {
    const normalizedTabId = Number(normalizeTabId(tabId));
    if (!Number.isInteger(normalizedTabId) || normalizedTabId <= 0) return;

    try {
      await sendTabMessage(normalizedTabId, { type: "SYSTEM_INSTRUCTION_REFRESH" });
    } catch (error) {
      const message = getErrorMessage(error);
      if (
        !/Receiving end does not exist|message port|连接已断开|无法建立连接/i.test(message)
      ) {
        throw error;
      }

      await ensureChatPlusRuntime(normalizedTabId);
      await sendTabMessage(normalizedTabId, { type: "SYSTEM_INSTRUCTION_REFRESH" });
    }
  };

  const refreshSystemInstructionRuntimeForTabs = async (tabIds: Array<number | string>) => {
    const normalizedTabIds = Array.from(
      new Set(
        tabIds
          .map((tabId) => Number(normalizeTabId(tabId)))
          .filter((tabId) => Number.isInteger(tabId) && tabId > 0),
      ),
    );
    if (!normalizedTabIds.length) return;

    await Promise.allSettled(
      normalizedTabIds.map((tabId) => refreshSystemInstructionRuntime(tabId)),
    );
  };

  const persistState = (
    nextTabEnabled: McpTabEnabledToolsMap,
    nextTabAdded: TabAddedServerIdsMap,
    nextSiteEnabled: McpSiteEnabledToolsMap,
    nextSiteAdded: SiteAddedServerIdsMap,
    nextConfig = mcpConfig,
  ) => {
    const { sanitizedEnabled: sanitizedTabEnabled, sanitizedAdded: sanitizedTabAdded } =
      sanitizeTabToolState(nextConfig, nextTabEnabled, nextTabAdded, currentTabIds);
    const { sanitizedEnabled: sanitizedSiteEnabled, sanitizedAdded: sanitizedSiteAdded } =
      sanitizeSiteToolState(nextConfig, nextSiteEnabled, nextSiteAdded);
    const managedTabIds = collectManagedTabIds(
      currentTabIds,
      tabEnabledRef.current,
      tabAddedRef.current,
      sanitizedTabEnabled,
      sanitizedTabAdded,
    );
    const managedSiteKeys = collectManagedSiteKeys(
      currentSiteKeys,
      siteEnabledRef.current,
      siteAddedRef.current,
      sanitizedSiteEnabled,
      sanitizedSiteAdded,
    );

    const nextPersist = toolStatePersistChainRef.current
      .catch(() => {})
      .then(async () => {
        const [storedSiteState, storedTabState] = await Promise.all([
          getStorage<{ [MCP_SITE_ENABLED_TOOLS_STORAGE_KEY]: SiteToolsState }>("local", {
            [MCP_SITE_ENABLED_TOOLS_STORAGE_KEY]: DEFAULT_SITE_TOOLS_STATE,
          }),
          getStorage<{ [MCP_TAB_ENABLED_TOOLS_STORAGE_KEY]: TabToolsState }>("session", {
            [MCP_TAB_ENABLED_TOOLS_STORAGE_KEY]: DEFAULT_TAB_TOOLS_STATE,
          }),
        ]);

        const persistedSiteEnabled = sanitizeSiteEnabledToolsMap(
          nextConfig,
          storedSiteState?.[MCP_SITE_ENABLED_TOOLS_STORAGE_KEY]?.enabledToolsBySiteKey,
        );
        const persistedSiteAdded = sanitizeAddedServerIdsBySiteKey(
          nextConfig,
          storedSiteState?.[MCP_SITE_ENABLED_TOOLS_STORAGE_KEY]?.addedServerIdsBySiteKey,
          undefined,
          persistedSiteEnabled,
        );
        const persistedTabEnabled = sanitizeTabEnabledToolsMap(
          nextConfig,
          storedTabState?.[MCP_TAB_ENABLED_TOOLS_STORAGE_KEY]?.enabledToolsByTabId,
        );
        const persistedTabAdded = sanitizeAddedServerIdsByTabId(
          nextConfig,
          storedTabState?.[MCP_TAB_ENABLED_TOOLS_STORAGE_KEY]?.addedServerIdsByTabId,
          undefined,
          persistedTabEnabled,
        );

        const nextStoredSiteEnabled = { ...persistedSiteEnabled };
        const nextStoredSiteAdded = { ...persistedSiteAdded };
        managedSiteKeys.forEach((siteKey) => {
          delete nextStoredSiteEnabled[siteKey];
          delete nextStoredSiteAdded[siteKey];
        });
        Object.entries(sanitizedSiteEnabled).forEach(([siteKey, enabledToolsByServer]) => {
          nextStoredSiteEnabled[siteKey] = enabledToolsByServer;
        });
        Object.entries(sanitizedSiteAdded).forEach(([siteKey, addedServerIds]) => {
          nextStoredSiteAdded[siteKey] = addedServerIds;
        });

        const nextStoredTabEnabled = { ...persistedTabEnabled };
        const nextStoredTabAdded = { ...persistedTabAdded };
        managedTabIds.forEach((tabId) => {
          delete nextStoredTabEnabled[tabId];
          delete nextStoredTabAdded[tabId];
        });
        Object.entries(sanitizedTabEnabled).forEach(([tabId, enabledToolsByServer]) => {
          nextStoredTabEnabled[tabId] = enabledToolsByServer;
        });
        Object.entries(sanitizedTabAdded).forEach(([tabId, addedServerIds]) => {
          nextStoredTabAdded[tabId] = addedServerIds;
        });

        await Promise.all([
          setStorage("local", {
            [MCP_SITE_ENABLED_TOOLS_STORAGE_KEY]: {
              enabledToolsBySiteKey: nextStoredSiteEnabled,
              addedServerIdsBySiteKey: nextStoredSiteAdded,
            } satisfies SiteToolsState,
          }),
          setStorage("session", {
            [MCP_TAB_ENABLED_TOOLS_STORAGE_KEY]: {
              enabledToolsByTabId: nextStoredTabEnabled,
              addedServerIdsByTabId: nextStoredTabAdded,
            } satisfies TabToolsState,
          }),
        ]);
      });

    toolStatePersistChainRef.current = nextPersist;
    return nextPersist;
  };

  const commitState = (
    nextTabEnabled: McpTabEnabledToolsMap,
    nextTabAdded: TabAddedServerIdsMap,
    nextSiteEnabled: McpSiteEnabledToolsMap,
    nextSiteAdded: SiteAddedServerIdsMap,
    nextConfig = mcpConfig,
    tabIdsToRefresh: Array<number | string> = [],
  ) => {
    toolStateMutationSequenceRef.current += 1;
    const mutationSequence = toolStateMutationSequenceRef.current;
    const { sanitizedEnabled: sanitizedTabEnabled, sanitizedAdded: sanitizedTabAdded } =
      sanitizeTabToolState(nextConfig, nextTabEnabled, nextTabAdded, currentTabIds);
    const { sanitizedEnabled: sanitizedSiteEnabled, sanitizedAdded: sanitizedSiteAdded } =
      sanitizeSiteToolState(nextConfig, nextSiteEnabled, nextSiteAdded);

    applyState(
      sanitizedTabEnabled,
      sanitizedTabAdded,
      sanitizedSiteEnabled,
      sanitizedSiteAdded,
    );
    void persistState(
      sanitizedTabEnabled,
      sanitizedTabAdded,
      sanitizedSiteEnabled,
      sanitizedSiteAdded,
      nextConfig,
    )
      .then(() => {
        if (toolStateMutationSequenceRef.current !== mutationSequence) return;
        if (!tabIdsToRefresh.length) return;
        return refreshSystemInstructionRuntimeForTabs(tabIdsToRefresh);
      })
      .catch((error) => {
        setToolsError(getErrorMessage(error));
      });
  };

  const loadToolState = async () => {
    const loadSequence = ++toolStateLoadSequenceRef.current;
    const mutationSequenceAtStart = toolStateMutationSequenceRef.current;
    setLoadingTools(true);

    try {
      const [response, storedSiteState, storedTabState] = await Promise.all([
        sendRuntimeMessage<any>({ type: "MCP_CONFIG_GET" }),
        getStorage<{ [MCP_SITE_ENABLED_TOOLS_STORAGE_KEY]: SiteToolsState }>("local", {
          [MCP_SITE_ENABLED_TOOLS_STORAGE_KEY]: DEFAULT_SITE_TOOLS_STATE,
        }),
        getStorage<{ [MCP_TAB_ENABLED_TOOLS_STORAGE_KEY]: TabToolsState }>("session", {
          [MCP_TAB_ENABLED_TOOLS_STORAGE_KEY]: DEFAULT_TAB_TOOLS_STATE,
        }),
      ]);
      if (!response?.ok) throw new Error(response?.error || "加载工具配置失败");

      const nextConfig = normalizeConfigStore(response.config);
      const nextDiscovery = normalizeDiscoveryMap(response.discoveryByServer);
      const nextSiteState = sanitizeSiteToolState(
        nextConfig,
        storedSiteState?.[MCP_SITE_ENABLED_TOOLS_STORAGE_KEY]?.enabledToolsBySiteKey || {},
        storedSiteState?.[MCP_SITE_ENABLED_TOOLS_STORAGE_KEY]?.addedServerIdsBySiteKey || {},
      );
      const nextTabState = sanitizeTabToolState(
        nextConfig,
        storedTabState?.[MCP_TAB_ENABLED_TOOLS_STORAGE_KEY]?.enabledToolsByTabId || {},
        storedTabState?.[MCP_TAB_ENABLED_TOOLS_STORAGE_KEY]?.addedServerIdsByTabId || {},
        currentTabIds,
      );
      const hydratedTabState = hydrateTabToolStateFromSites(
        nextConfig,
        safeTabs,
        nextTabState.sanitizedEnabled,
        nextTabState.sanitizedAdded,
        nextSiteState.sanitizedEnabled,
        nextSiteState.sanitizedAdded,
      );

      if (toolStateLoadSequenceRef.current !== loadSequence) return;

      setMcpConfig(nextConfig);
      setDiscoveryByServer(nextDiscovery);

      if (toolStateMutationSequenceRef.current !== mutationSequenceAtStart) return;

      applyState(
        hydratedTabState.sanitizedEnabled,
        hydratedTabState.sanitizedAdded,
        nextSiteState.sanitizedEnabled,
        nextSiteState.sanitizedAdded,
      );
      setToolsError("");

      if (hydratedTabState.hydrated) {
        void persistState(
          hydratedTabState.sanitizedEnabled,
          hydratedTabState.sanitizedAdded,
          nextSiteState.sanitizedEnabled,
          nextSiteState.sanitizedAdded,
          nextConfig,
        ).catch((error) => {
          setToolsError(getErrorMessage(error));
        });
      }
    } catch (error) {
      setToolsError(getErrorMessage(error));
    } finally {
      if (toolStateLoadSequenceRef.current === loadSequence) {
        setLoadingTools(false);
      }
    }
  };

  const setServerToolNames = (tabId: number, serverId: string, toolNames: string[]) => {
    const normalizedTabId = normalizeTabId(tabId);
    const normalizedServerId = toSafeString(serverId);
    const siteKey = normalizedTabId ? tabSiteKeyById[normalizedTabId] : "";
    if (!normalizedTabId || !normalizedServerId || !siteKey) return;
    const normalizedToolNames = normalizeToolNameList(toolNames);

    const nextTabEnabled = { ...tabEnabledRef.current };
    const effectiveTabSelection = getEffectiveSelectionForTab(normalizedTabId);
    const nextTabServerTools = {
      ...effectiveTabSelection,
      [normalizedServerId]: normalizedToolNames,
    };
    if (!nextTabServerTools[normalizedServerId].length) {
      delete nextTabServerTools[normalizedServerId];
    }
    if (Object.keys(nextTabServerTools).length) {
      nextTabEnabled[normalizedTabId] = nextTabServerTools;
    } else {
      delete nextTabEnabled[normalizedTabId];
    }

    const nextTabAdded = { ...tabAddedRef.current };
    const nextTabServerIds = new Set(nextTabAdded[normalizedTabId] || []);
    nextTabServerIds.add(normalizedServerId);
    nextTabAdded[normalizedTabId] = Array.from(nextTabServerIds);

    const nextSiteEnabled = { ...siteEnabledRef.current };
    const nextSiteServerTools = {
      ...(nextSiteEnabled[siteKey] || {}),
      [normalizedServerId]: normalizedToolNames,
    };
    if (!nextSiteServerTools[normalizedServerId].length) {
      delete nextSiteServerTools[normalizedServerId];
    }
    if (Object.keys(nextSiteServerTools).length) {
      nextSiteEnabled[siteKey] = nextSiteServerTools;
    } else {
      delete nextSiteEnabled[siteKey];
    }

    const nextSiteAdded = { ...siteAddedRef.current };
    const nextSiteServerIds = new Set(nextSiteAdded[siteKey] || []);
    nextSiteServerIds.add(normalizedServerId);
    nextSiteAdded[siteKey] = Array.from(nextSiteServerIds);

    commitState(
      nextTabEnabled,
      nextTabAdded,
      nextSiteEnabled,
      nextSiteAdded,
      mcpConfig,
      [tabId],
    );
  };

  const addServerToTab = (tabId: number, serverId: string) => {
    const normalizedTabId = normalizeTabId(tabId);
    const normalizedServerId = toSafeString(serverId);
    const siteKey = normalizedTabId ? tabSiteKeyById[normalizedTabId] : "";
    if (!normalizedTabId || !normalizedServerId || !siteKey) return;

    const nextTabAdded = { ...tabAddedRef.current };
    const nextTabServerIds = new Set(nextTabAdded[normalizedTabId] || []);
    nextTabServerIds.add(normalizedServerId);
    nextTabAdded[normalizedTabId] = Array.from(nextTabServerIds);

    const nextSiteAdded = { ...siteAddedRef.current };
    const nextSiteServerIds = new Set(nextSiteAdded[siteKey] || []);
    nextSiteServerIds.add(normalizedServerId);
    nextSiteAdded[siteKey] = Array.from(nextSiteServerIds);

    commitState(
      tabEnabledRef.current,
      nextTabAdded,
      siteEnabledRef.current,
      nextSiteAdded,
      mcpConfig,
    );
    setExpandedServerKeys((prev) => ({
      ...prev,
      [buildTabServerKey(tabId, normalizedServerId)]: true,
    }));
  };

  const removeServerFromTab = (tabId: number, serverId: string) => {
    const normalizedTabId = normalizeTabId(tabId);
    const normalizedServerId = toSafeString(serverId);
    const siteKey = normalizedTabId ? tabSiteKeyById[normalizedTabId] : "";
    if (!normalizedTabId || !normalizedServerId || !siteKey) return;

    const nextTabEnabled = { ...tabEnabledRef.current };
    if (nextTabEnabled[normalizedTabId]) {
      const nextServerTools = { ...nextTabEnabled[normalizedTabId] };
      delete nextServerTools[normalizedServerId];
      if (Object.keys(nextServerTools).length) {
        nextTabEnabled[normalizedTabId] = nextServerTools;
      } else {
        delete nextTabEnabled[normalizedTabId];
      }
    }

    const nextTabAdded = { ...tabAddedRef.current };
    const remainingTabServerIds = (nextTabAdded[normalizedTabId] || []).filter(
      (id) => id !== normalizedServerId,
    );
    if (remainingTabServerIds.length) {
      nextTabAdded[normalizedTabId] = remainingTabServerIds;
    } else {
      delete nextTabAdded[normalizedTabId];
    }

    const nextSiteEnabled = { ...siteEnabledRef.current };
    if (nextSiteEnabled[siteKey]) {
      const nextServerTools = { ...nextSiteEnabled[siteKey] };
      delete nextServerTools[normalizedServerId];
      if (Object.keys(nextServerTools).length) {
        nextSiteEnabled[siteKey] = nextServerTools;
      } else {
        delete nextSiteEnabled[siteKey];
      }
    }

    const nextSiteAdded = { ...siteAddedRef.current };
    const remainingSiteServerIds = (nextSiteAdded[siteKey] || []).filter(
      (id) => id !== normalizedServerId,
    );
    if (remainingSiteServerIds.length) {
      nextSiteAdded[siteKey] = remainingSiteServerIds;
    } else {
      delete nextSiteAdded[siteKey];
    }

    commitState(
      nextTabEnabled,
      nextTabAdded,
      nextSiteEnabled,
      nextSiteAdded,
      mcpConfig,
    );
    setExpandedServerKeys((prev) => {
      const next = { ...prev };
      delete next[buildTabServerKey(tabId, normalizedServerId)];
      return next;
    });
  };

  const toggleTabToolEnabled = (
    tabId: number,
    serverId: string,
    toolName: string,
    checked: boolean,
  ) => {
    const normalizedTabId = normalizeTabId(tabId);
    const normalizedServerId = toSafeString(serverId);
    const normalizedToolName = toSafeString(toolName);
    if (!normalizedTabId || !normalizedServerId || !normalizedToolName) return;
    const nextNames = new Set(
      Array.isArray(getEffectiveSelectionForTab(normalizedTabId)?.[normalizedServerId])
        ? getEffectiveSelectionForTab(normalizedTabId)?.[normalizedServerId]
        : [],
    );
    if (checked) nextNames.add(normalizedToolName);
    else nextNames.delete(normalizedToolName);
    setServerToolNames(tabId, normalizedServerId, Array.from(nextNames));
  };

  const toggleTabServerToolSelection = (
    tabId: number,
    serverId: string,
    toolNames: string[],
    selectionState: "checked" | "indeterminate" | "unchecked",
  ) => {
    setServerToolNames(
      tabId,
      serverId,
      selectionState === "checked" || selectionState === "indeterminate"
        ? []
        : normalizeToolNameList(toolNames),
    );
  };

  const toggleServerExpanded = (tabId: number, serverId: string) => {
    const serverKey = buildTabServerKey(tabId, serverId);
    setExpandedServerKeys((prev) => ({ ...prev, [serverKey]: !prev[serverKey] }));
  };

  const toggleToolsPanel = (tabId: number) => {
    setOpenToolTabId((currentId) => {
      const nextToolTabId = currentId === tabId ? null : tabId;
      setOpenAddServerTabId((currentAddTabId) =>
        currentAddTabId === tabId && nextToolTabId === tabId ? null : currentAddTabId,
      );
      return nextToolTabId;
    });
  };

  const toggleAddServerPanel = (tabId: number) => {
    setOpenAddServerTabId((currentId) => (currentId === tabId ? null : tabId));
  };

  const closeAddServerPanel = () => {
    setOpenAddServerTabId(null);
  };

  const getTabToolView = (tab: OrchestrationTab): OrchestrationToolView => {
    const tabKey = String(tab.tabId);
    const siteKey = tabSiteKeyById[tabKey];
    const tabSelection = getEffectiveSelectionForTab(tabKey);
    const addedServerIds = getEffectiveAddedServerIdsForTab(tabKey);
    const addedServers = addedServerIds
      .map((serverId) => mcpConfig.servers.find((server) => server.id === serverId) || null)
      .filter((server): server is McpConfigStore["servers"][number] => Boolean(server));
    const enabledToolCount = countEnabledTools(tabSelection);

    return {
      siteKey,
      tabSelection,
      addedServerIds,
      addedServers,
      enabledToolCount,
      hasEnabledTools: enabledToolCount > 0,
      isToolsOpen: openToolTabId === tab.tabId,
      isAddServerOpen: openAddServerTabId === tab.tabId,
    };
  };

  useEffect(() => {
    if (!active) return;
    void loadToolState();
  }, [active]);

  useEffect(() => {
    if (
      openToolTabId === null ||
      openAddServerTabId === null ||
      openToolTabId === openAddServerTabId
    ) {
      return;
    }
    setOpenAddServerTabId(null);
  }, [openAddServerTabId, openToolTabId]);

  useEffect(() => {
    const nextTabState = sanitizeTabToolState(
      mcpConfig,
      tabEnabledRef.current,
      tabAddedRef.current,
      currentTabIds,
    );
    const nextSiteState = sanitizeSiteToolState(
      mcpConfig,
      siteEnabledRef.current,
      siteAddedRef.current,
    );
    const prevSignature = JSON.stringify({
      tabEnabled: tabEnabledRef.current,
      tabAdded: tabAddedRef.current,
      siteEnabled: siteEnabledRef.current,
      siteAdded: siteAddedRef.current,
    });
    const nextSignature = JSON.stringify({
      tabEnabled: nextTabState.sanitizedEnabled,
      tabAdded: nextTabState.sanitizedAdded,
      siteEnabled: nextSiteState.sanitizedEnabled,
      siteAdded: nextSiteState.sanitizedAdded,
    });

    if (prevSignature !== nextSignature) {
      commitState(
        nextTabState.sanitizedEnabled,
        nextTabState.sanitizedAdded,
        nextSiteState.sanitizedEnabled,
        nextSiteState.sanitizedAdded,
      );
    }
    if (openToolTabId !== null && !currentTabIds.includes(openToolTabId)) {
      setOpenToolTabId(null);
    }
    if (openAddServerTabId !== null && !currentTabIds.includes(openAddServerTabId)) {
      setOpenAddServerTabId(null);
    }
  }, [currentTabIds, mcpConfig, openAddServerTabId, openToolTabId]);

  useEffect(() => {
    if (!active) return undefined;

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      namespace: string,
    ) => {
      if (
        namespace === "local" &&
        (changes[MCP_CONFIG_STORAGE_KEY] ||
          changes[MCP_DISCOVERED_TOOLS_STORAGE_KEY] ||
          changes[MCP_DISCOVERY_META_STORAGE_KEY])
      ) {
        void loadToolState();
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, [active, currentTabIds, currentSiteKeys, mcpConfig, safeTabs]);

  return {
    mcpConfig,
    discoveryByServer,
    loadingTools,
    toolsError,
    totalToolCount,
    openToolTabId,
    openAddServerTabId,
    expandedServerKeys,
    toggleToolsPanel,
    toggleAddServerPanel,
    closeAddServerPanel,
    addServerToTab,
    removeServerFromTab,
    toggleTabToolEnabled,
    toggleTabServerToolSelection,
    toggleServerExpanded,
    getTabToolView,
  };
}
