import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";

import {
  DEFAULT_MCP_CONFIG_STORE,
  MCP_CONFIG_STORAGE_KEY,
  MCP_DISCOVERED_TOOLS_STORAGE_KEY,
  MCP_DISCOVERY_META_STORAGE_KEY,
  MCP_ENABLED_TOOLS_STORAGE_KEY,
  MCP_SITE_ENABLED_TOOLS_STORAGE_KEY,
  MCP_TAB_ENABLED_TOOLS_STORAGE_KEY,
  MCP_TRANSPORT_SSE,
  McpConfigStore,
  McpDiscoveryMap,
  McpEnabledToolsMap,
  McpServerConfig,
  McpSiteEnabledToolsMap,
  McpTabEnabledToolsMap,
  McpToolDescriptor,
  filterConfigToEnabledTools,
  getServerConfigError,
  getServerConnectionSignature,
  mergeDiscoveredTools,
  normalizeConfigStore,
  normalizeDiscoveredToolsByServer,
  normalizeDiscoveryMap,
  normalizeSiteToolScopeKey,
  normalizeTabId,
  sanitizeEnabledToolsMap,
  sanitizeSiteEnabledToolsMap,
  sanitizeTabEnabledToolsMap,
  normalizeHeaders,
  normalizeToolDescriptor,
  toSafeString,
  toStoredServerConfig,
} from "../mcp/shared";
import { getExtensionVersion } from "../shared/extensionMeta";
import {
  SITE_CONFIG_MAP_STORAGE_KEY,
  isSiteConfigEnabled,
  normalizeSiteConfig,
  readStoredSiteConfigMap,
} from "../sidepanel/lib/siteConfig";

const CONNECTION_IDLE_TTL_MS = 5 * 60 * 1000;

type StoredMcpState = {
  config: McpConfigStore;
  discoveredToolsByServer: Record<string, McpToolDescriptor[]>;
  discoveryByServer: McpDiscoveryMap;
  enabledToolsByServer: McpEnabledToolsMap;
  enabledToolsBySiteKey: McpSiteEnabledToolsMap;
  enabledToolsByTabId: McpTabEnabledToolsMap;
  siteConfigMap: Record<string, unknown>;
};

type PooledConnection = {
  signature: string;
  lastUsedAt: number;
  client: Client;
  transport: SSEClientTransport | StreamableHTTPClientTransport;
};

const connectionPool = new Map<string, PooledConnection>();

function getLocalStorage<T>(defaults: T) {
  return new Promise<T>((resolve) => {
    chrome.storage.local.get(defaults as any, (result) => {
      if (chrome.runtime.lastError) {
        resolve(defaults);
        return;
      }
      resolve((result || defaults) as T);
    });
  });
}

function setLocalStorage(payload: Record<string, unknown>) {
  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    chrome.storage.local.set(payload, () => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }

      resolve({ ok: true });
    });
  });
}

function getSessionStorage<T>(defaults: T) {
  return new Promise<T>((resolve) => {
    chrome.storage.session.get(defaults as any, (result) => {
      if (chrome.runtime.lastError) {
        resolve(defaults);
        return;
      }
      resolve((result || defaults) as T);
    });
  });
}

function serializeError(error: unknown) {
  return String((error as any)?.message || error || "Unknown error");
}

function isSiteScopeEnabled(
  siteConfigMap: Record<string, unknown>,
  siteKey?: string | null,
) {
  const normalizedSiteKey = normalizeSiteToolScopeKey(siteKey);
  if (!normalizedSiteKey) return true;
  const siteConfig = normalizeSiteConfig((siteConfigMap[normalizedSiteKey] as any) || {});
  if (!String(siteConfig.adapterScript || "").trim()) return true;
  return isSiteConfigEnabled(siteConfig);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeToolCallResult(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeToolCallResult(item));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const next = Object.fromEntries(
    Object.entries(value).map(([key, childValue]) => [key, sanitizeToolCallResult(childValue)]),
  );

  const contentItems = Array.isArray(next.content) ? next.content : [];
  const textItems = contentItems
    .filter((item) => isPlainObject(item) && item.type === "text" && typeof item.text === "string")
    .map((item) => String(item.text || "").trim())
    .filter(Boolean);
  const structuredContent = isPlainObject(next.structuredContent) ? next.structuredContent : null;
  const structuredText = structuredContent && typeof structuredContent.content === "string"
    ? String(structuredContent.content || "").trim()
    : "";

  if (structuredContent && structuredText) {
    const mergedText = textItems.join("\n").trim();
    const hasDuplicateStructuredText =
      textItems.includes(structuredText) || (mergedText && mergedText === structuredText);

    if (hasDuplicateStructuredText) {
      const { content: _ignoredContent, ...restStructuredContent } = structuredContent;
      if (Object.keys(restStructuredContent).length) {
        next.structuredContent = restStructuredContent;
      } else {
        delete next.structuredContent;
      }
    }
  }

  return next;
}

function createClient() {
  return new Client(
    {
      name: "chat-plus-mcp-client",
      version: getExtensionVersion(),
    },
    {
      capabilities: {},
      jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
    },
  );
}

function buildTransport(server: McpServerConfig) {
  const headers = normalizeHeaders(server.headers);
  const url = new URL(server.url);

  if (server.type === MCP_TRANSPORT_SSE) {
    return new SSEClientTransport(url, {
      requestInit: {
        headers,
      },
      eventSourceInit: {
        headers,
      } as any,
    });
  }

  return new StreamableHTTPClientTransport(url, {
    requestInit: {
      headers,
    },
  });
}

async function closePoolEntry(serverId: string) {
  const entry = connectionPool.get(serverId);
  if (!entry) return;
  connectionPool.delete(serverId);

  try {
    await entry.transport.close();
  } catch {}

  try {
    await entry.client.close();
  } catch {}
}

async function pruneExpiredConnections() {
  const now = Date.now();
  const staleIds = Array.from(connectionPool.entries())
    .filter(([, entry]) => now - entry.lastUsedAt >= CONNECTION_IDLE_TTL_MS)
    .map(([serverId]) => serverId);

  for (const serverId of staleIds) {
    await closePoolEntry(serverId);
  }
}

async function getPooledClient(server: McpServerConfig) {
  await pruneExpiredConnections();

  const signature = getServerConnectionSignature(server);
  const existing = connectionPool.get(server.id);
  const now = Date.now();

  if (existing && existing.signature === signature) {
    existing.lastUsedAt = now;
    return existing;
  }

  if (existing) {
    await closePoolEntry(server.id);
  }

  const transport = buildTransport(server);
  const client = createClient();
  await client.connect(transport);

  const nextEntry: PooledConnection = {
    signature,
    lastUsedAt: now,
    client,
    transport,
  };
  connectionPool.set(server.id, nextEntry);
  return nextEntry;
}

export async function getStoredMcpState(): Promise<StoredMcpState> {
  const [stored, storedSession] = await Promise.all([
    getLocalStorage({
      [SITE_CONFIG_MAP_STORAGE_KEY]: {},
      [MCP_CONFIG_STORAGE_KEY]: DEFAULT_MCP_CONFIG_STORE,
      [MCP_DISCOVERED_TOOLS_STORAGE_KEY]: {},
      [MCP_DISCOVERY_META_STORAGE_KEY]: {},
      [MCP_ENABLED_TOOLS_STORAGE_KEY]: { enabledToolsByServerId: {} },
      [MCP_SITE_ENABLED_TOOLS_STORAGE_KEY]: { enabledToolsBySiteKey: {} },
    }),
    getSessionStorage({
      [MCP_TAB_ENABLED_TOOLS_STORAGE_KEY]: { enabledToolsByTabId: {} },
    }),
  ]);

  const config = normalizeConfigStore(stored[MCP_CONFIG_STORAGE_KEY]);
  const discoveredToolsByServer = normalizeDiscoveredToolsByServer(
    stored[MCP_DISCOVERED_TOOLS_STORAGE_KEY],
  );
  const discoveryByServer = normalizeDiscoveryMap(stored[MCP_DISCOVERY_META_STORAGE_KEY]);
  const activeServerIds = new Set(config.servers.map((server) => server.id));
  const mergedConfig = mergeDiscoveredTools(config, discoveredToolsByServer);
  const enabledToolsByServer = sanitizeEnabledToolsMap(
    mergedConfig,
    (stored[MCP_ENABLED_TOOLS_STORAGE_KEY] as any)?.enabledToolsByServerId,
  );
  const enabledToolsByTabId = sanitizeTabEnabledToolsMap(
    mergedConfig,
    (storedSession[MCP_TAB_ENABLED_TOOLS_STORAGE_KEY] as any)?.enabledToolsByTabId,
  );
  const enabledToolsBySiteKey = sanitizeSiteEnabledToolsMap(
    mergedConfig,
    (stored[MCP_SITE_ENABLED_TOOLS_STORAGE_KEY] as any)?.enabledToolsBySiteKey,
  );
  const siteConfigMap = readStoredSiteConfigMap(stored as Record<string, unknown>);

  const filteredDiscovered: Record<string, McpToolDescriptor[]> = {};
  Object.entries(discoveredToolsByServer).forEach(([serverId, tools]) => {
    if (activeServerIds.has(serverId)) {
      filteredDiscovered[serverId] = tools;
    }
  });

  const filteredDiscovery: McpDiscoveryMap = {};
  Object.entries(discoveryByServer).forEach(([serverId, meta]) => {
    if (activeServerIds.has(serverId)) {
      filteredDiscovery[serverId] = meta;
    }
  });

  return {
    config: mergeDiscoveredTools(config, filteredDiscovered),
    discoveredToolsByServer: filteredDiscovered,
    discoveryByServer: filteredDiscovery,
    enabledToolsByServer,
    enabledToolsBySiteKey,
    enabledToolsByTabId,
    siteConfigMap,
  };
}

async function persistMcpState(
  config: McpConfigStore,
  discoveredToolsByServer: Record<string, McpToolDescriptor[]> = {},
  discoveryByServer: McpDiscoveryMap = {},
) {
  const normalized = normalizeConfigStore(config);
  const activeServerIds = new Set(normalized.servers.map((server) => server.id));

  const nextDiscovered: Record<string, McpToolDescriptor[]> = {};
  Object.entries(discoveredToolsByServer).forEach(([serverId, tools]) => {
    if (!activeServerIds.has(serverId)) return;
    nextDiscovered[serverId] = Array.isArray(tools)
      ? tools.filter(Boolean)
      : [];
  });

  const nextDiscovery: McpDiscoveryMap = {};
  Object.entries(discoveryByServer).forEach(([serverId, meta]) => {
    if (!activeServerIds.has(serverId)) return;
    nextDiscovery[serverId] = {
      ok: meta?.ok !== false,
      error: toSafeString(meta?.error),
      fetchedAt: Number.isFinite(meta?.fetchedAt) ? Number(meta.fetchedAt) : 0,
      toolCount: Number.isFinite(meta?.toolCount) ? Number(meta.toolCount) : 0,
    };
  });

  const result = await setLocalStorage({
    [MCP_CONFIG_STORAGE_KEY]: {
      servers: normalized.servers.map((server) => toStoredServerConfig(server)),
      updatedAt: Date.now(),
    },
    [MCP_DISCOVERED_TOOLS_STORAGE_KEY]: nextDiscovered,
    [MCP_DISCOVERY_META_STORAGE_KEY]: nextDiscovery,
  });

  if (!result.ok) {
    return {
      ok: false as const,
      error: result.error || "保存 MCP 配置失败",
    };
  }

  return {
    ok: true as const,
    config: mergeDiscoveredTools(normalized, nextDiscovered),
    discoveredToolsByServer: nextDiscovered,
    discoveryByServer: nextDiscovery,
  };
}

async function discoverServerTools(server: McpServerConfig) {
  const error = getServerConfigError(server);
  if (error) {
    return {
      ok: false as const,
      serverId: server.id,
      error,
      tools: [] as McpToolDescriptor[],
    };
  }

  try {
    const entry = await getPooledClient(server);
    const toolsResult = await entry.client.listTools();
    entry.lastUsedAt = Date.now();

    const tools = Array.isArray(toolsResult?.tools)
      ? toolsResult.tools
          .map((tool) => normalizeToolDescriptor(tool))
          .filter((tool): tool is McpToolDescriptor => Boolean(tool))
      : [];

    return {
      ok: true as const,
      serverId: server.id,
      tools,
      error: "",
    };
  } catch (error) {
    await closePoolEntry(server.id);

    return {
      ok: false as const,
      serverId: server.id,
      tools: [] as McpToolDescriptor[],
      error: serializeError(error),
    };
  }
}

function isToolEnabled(
  serverId: string,
  toolName: string,
  enabledToolsByServer: McpEnabledToolsMap,
) {
  return (enabledToolsByServer[serverId] || []).includes(toolName);
}

function findServer(config: McpConfigStore, serverId: string) {
  return config.servers.find((server) => server.id === serverId) || null;
}

async function resolveSiteToolScopeKeyFromTabId(tabId: string) {
  if (!tabId) return "";

  try {
    const tab = await chrome.tabs.get(Number(tabId));
    return normalizeSiteToolScopeKey(tab?.url ? new URL(tab.url).hostname : "");
  } catch {
    return "";
  }
}

export async function resolveEffectiveEnabledToolsByServer(state: StoredMcpState, message: any) {
  const tabId = normalizeTabId(message?.tabId);
  const messageSiteKey = normalizeSiteToolScopeKey(message?.siteKey || message?.host);
  const siteKey =
    messageSiteKey || (tabId ? await resolveSiteToolScopeKeyFromTabId(tabId) : "");
  if (!isSiteScopeEnabled(state.siteConfigMap, siteKey)) {
    return {};
  }

  if (!tabId) {
    return state.enabledToolsByServer;
  }

  const tabEnabledTools = state.enabledToolsByTabId[tabId];
  if (tabEnabledTools && Object.keys(tabEnabledTools).length > 0) {
    return tabEnabledTools;
  }

  if (siteKey && state.enabledToolsBySiteKey[siteKey]) {
    return state.enabledToolsBySiteKey[siteKey];
  }

  return {};
}

async function handleConfigGet() {
  const state = await getStoredMcpState();

  return {
    ok: true,
    config: state.config,
    discoveryByServer: state.discoveryByServer,
  };
}

async function handleEnabledToolsGet(message: any) {
  const state = await getStoredMcpState();
  const enabledToolsByServer = await resolveEffectiveEnabledToolsByServer(state, message);
  const enabledConfig = filterConfigToEnabledTools(state.config, enabledToolsByServer);

  return {
    ok: true,
    config: enabledConfig,
    enabledToolsByServer,
    discoveryByServer: state.discoveryByServer,
  };
}

async function handleConfigSave(message: any) {
  const nextConfig = normalizeConfigStore(message?.config);
  for (const server of nextConfig.servers) {
    const error = getServerConfigError(server);
    if (error) {
      return {
        ok: false,
        error,
      };
    }
  }

  const previousState = await getStoredMcpState();
  const previousMap = new Map(
    previousState.config.servers.map((server) => [server.id, server] as const),
  );

  const nextDiscovered = { ...previousState.discoveredToolsByServer };
  const nextDiscovery = { ...previousState.discoveryByServer };

  const nextServerIds = new Set(nextConfig.servers.map((server) => server.id));
  for (const previousServer of previousState.config.servers) {
    if (!nextServerIds.has(previousServer.id)) {
      delete nextDiscovered[previousServer.id];
      delete nextDiscovery[previousServer.id];
      await closePoolEntry(previousServer.id);
    }
  }

  for (const server of nextConfig.servers) {
    const previousServer = previousMap.get(server.id);
    if (server.enabled === false) {
      delete nextDiscovered[server.id];
      delete nextDiscovery[server.id];
      await closePoolEntry(server.id);
      continue;
    }

    if (
      previousServer &&
      previousServer.enabled !== false &&
      getServerConnectionSignature(previousServer) === getServerConnectionSignature(server)
    ) {
      continue;
    }

    delete nextDiscovered[server.id];
    delete nextDiscovery[server.id];
    await closePoolEntry(server.id);
  }

  const persisted = await persistMcpState(nextConfig, nextDiscovered, nextDiscovery);
  if (!persisted.ok) {
    return persisted;
  }

  return {
    ok: true,
    config: persisted.config,
    discoveryByServer: persisted.discoveryByServer,
  };
}

async function handleDiscoverOne(message: any) {
  const serverId = toSafeString(message?.serverId);
  if (!serverId) {
    return {
      ok: false,
      error: "缺少 serverId",
    };
  }

  const state = await getStoredMcpState();
  const server = findServer(state.config, serverId);
  if (!server) {
    return {
      ok: false,
      error: `未找到服务：${serverId}`,
    };
  }

  if (server.enabled === false) {
    const nextDiscovered = { ...state.discoveredToolsByServer };
    const nextDiscovery = { ...state.discoveryByServer };
    delete nextDiscovered[server.id];
    delete nextDiscovery[server.id];

    const persisted = await persistMcpState(state.config, nextDiscovered, nextDiscovery);
    if (!persisted.ok) {
      return persisted;
    }

    return {
      ok: true,
      skipped: true,
      serverId: server.id,
      tools: [] as McpToolDescriptor[],
      error: "",
      config: persisted.config,
      discoveryByServer: persisted.discoveryByServer,
    };
  }

  const result = await discoverServerTools(server);
  const nextDiscovered = { ...state.discoveredToolsByServer, [server.id]: result.tools };
  const nextDiscovery = {
    ...state.discoveryByServer,
    [server.id]: {
      ok: result.ok,
      error: result.error,
      fetchedAt: Date.now(),
      toolCount: result.tools.length,
    },
  };

  const persisted = await persistMcpState(state.config, nextDiscovered, nextDiscovery);
  if (!persisted.ok) {
    return persisted;
  }

  return {
    ok: result.ok,
    serverId: server.id,
    tools: result.tools,
    error: result.error,
    config: persisted.config,
    discoveryByServer: persisted.discoveryByServer,
  };
}

async function handleDiscoverAll() {
  const state = await getStoredMcpState();
  const results: Array<{
    ok: boolean;
    serverId: string;
    tools: McpToolDescriptor[];
    error: string;
  }> = [];

  const nextDiscovered = { ...state.discoveredToolsByServer };
  const nextDiscovery = { ...state.discoveryByServer };

  for (const server of state.config.servers) {
    if (server.enabled === false) {
      delete nextDiscovered[server.id];
      delete nextDiscovery[server.id];
      await closePoolEntry(server.id);
    }
  }

  for (const server of state.config.servers) {
    if (server.enabled === false) {
      continue;
    }

    const result = await discoverServerTools(server);
    results.push(result);
    nextDiscovered[server.id] = result.tools;
    nextDiscovery[server.id] = {
      ok: result.ok,
      error: result.error,
      fetchedAt: Date.now(),
      toolCount: result.tools.length,
    };
  }

  const persisted = await persistMcpState(state.config, nextDiscovered, nextDiscovery);
  if (!persisted.ok) {
    return persisted;
  }

  return {
    ok: true,
    results,
    failedServers: results
      .filter((item) => !item.ok)
      .map((item) => `${item.serverId}: ${item.error || "unknown error"}`),
    config: persisted.config,
    discoveryByServer: persisted.discoveryByServer,
  };
}

async function handleToolCall(message: any) {
  const serverId = toSafeString(message?.serverId);
  const toolName = toSafeString(message?.toolName || message?.name);
  const tabId = normalizeTabId(message?.tabId);
  const args =
    message?.arguments && typeof message.arguments === "object" && !Array.isArray(message.arguments)
      ? message.arguments
      : {};

  if (!serverId) {
    return {
      ok: false,
      error: "缺少 serverId",
    };
  }

  if (!toolName) {
    return {
      ok: false,
      error: "缺少 toolName",
    };
  }

  const state = await getStoredMcpState();
  const server = findServer(state.config, serverId);
  const enabledToolsByServer = await resolveEffectiveEnabledToolsByServer(state, message);
  const siteKey = normalizeSiteToolScopeKey(message?.siteKey || message?.host)
    || (tabId ? await resolveSiteToolScopeKeyFromTabId(tabId) : "");
  if (!server) {
    return {
      ok: false,
      error: `未找到服务：${serverId}`,
    };
  }

  if (!isSiteScopeEnabled(state.siteConfigMap, siteKey)) {
    return {
      ok: false,
      error: "当前站点已关闭 Chat Plus",
    };
  }

  if (server.enabled === false) {
    return {
      ok: false,
      error: `服务已停用：${server.name}`,
    };
  }

  if (!isToolEnabled(server.id, toolName, enabledToolsByServer)) {
    return {
      ok: false,
      error: tabId
        ? `当前标签页未启用工具：${toolName}`
        : `工具未启用：${toolName}`,
    };
  }

  const toolExists = (Array.isArray(server.tools) ? server.tools : []).some(
    (tool) => tool.name === toolName,
  );
  if (!toolExists) {
    return {
      ok: false,
      error: `未找到工具：${toolName}`,
    };
  }

  try {
    const entry = await getPooledClient(server);
    const result = await entry.client.callTool({
      name: toolName,
      arguments: args,
    });
    entry.lastUsedAt = Date.now();

    return {
      ok: true,
      serverId: server.id,
      toolName,
      result: sanitizeToolCallResult(result),
    };
  } catch (error) {
    await closePoolEntry(server.id);
    const serverLabel = toSafeString(server.name) || server.id;
    const endpoint = toSafeString(server.url);
    return {
      ok: false,
      error: [
        `MCP 工具调用失败：${serverLabel}/${toolName}`,
        endpoint ? `服务地址：${endpoint}` : "",
        `错误：${serializeError(error)}`,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }
}

export async function handleMcpBackgroundMessage(message: any) {
  switch (message?.type) {
    case "MCP_CONFIG_GET":
      return handleConfigGet();
    case "MCP_ENABLED_TOOLS_GET":
      return handleEnabledToolsGet(message);
    case "MCP_CONFIG_SAVE":
      return handleConfigSave(message);
    case "MCP_TOOLS_DISCOVER":
      return handleDiscoverOne(message);
    case "MCP_TOOLS_DISCOVER_ALL":
      return handleDiscoverAll();
    case "MCP_TOOL_CALL":
      return handleToolCall(message);
    default:
      return undefined;
  }
}
