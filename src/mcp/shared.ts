export const MCP_TRANSPORT_STREAMABLE_HTTP = "streamable-http";
export const MCP_TRANSPORT_SSE = "sse";

export const MCP_CONFIG_STORAGE_KEY = "chatplus_mcp_config_v1";
export const MCP_DISCOVERED_TOOLS_STORAGE_KEY = "chatplus_mcp_discovered_tools_v1";
export const MCP_DISCOVERY_META_STORAGE_KEY = "chatplus_mcp_discovery_meta_v1";
export const MCP_ENABLED_TOOLS_STORAGE_KEY = "chatplus_mcp_tools_selection_v1";
export const MCP_TAB_ENABLED_TOOLS_STORAGE_KEY = "chatplus_mcp_tab_tools_selection_v1";
export const MCP_SITE_ENABLED_TOOLS_STORAGE_KEY = "chatplus_mcp_site_tools_selection_v1";

export type McpTransportType =
  | typeof MCP_TRANSPORT_STREAMABLE_HTTP
  | typeof MCP_TRANSPORT_SSE;

export type McpToolDescriptor = {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  raw?: Record<string, unknown>;
};

export type McpServerConfig = {
  id: string;
  name: string;
  enabled: boolean;
  type: McpTransportType;
  url: string;
  headers: Record<string, string>;
  tools?: McpToolDescriptor[];
};

export type McpConfigStore = {
  servers: McpServerConfig[];
  updatedAt: number;
};

export type McpDiscoveryState = {
  ok: boolean;
  error: string;
  fetchedAt: number;
  toolCount: number;
};

export type McpDiscoveryMap = Record<string, McpDiscoveryState>;

export type McpEnabledToolsMap = Record<string, string[]>;
export type McpTabEnabledToolsMap = Record<string, McpEnabledToolsMap>;
export type McpSiteEnabledToolsMap = Record<string, McpEnabledToolsMap>;

export const DEFAULT_MCP_CONFIG_STORE: McpConfigStore = {
  servers: [],
  updatedAt: 0,
};

export function toSafeString(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function getObjectValueByAliasesCaseInsensitive(
  source: unknown,
  aliases: string[],
) {
  if (!source || typeof source !== "object" || aliases.length === 0) {
    return undefined;
  }

  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(source, alias)) {
      return (source as Record<string, unknown>)[alias];
    }
  }

  const normalizedAliases = new Set(
    aliases.map((alias) => toSafeString(alias).toLowerCase()).filter(Boolean),
  );
  if (normalizedAliases.size === 0) return undefined;

  for (const [rawKey, rawValue] of Object.entries(source)) {
    const key = toSafeString(rawKey).toLowerCase();
    if (key && normalizedAliases.has(key)) {
      return rawValue;
    }
  }

  return undefined;
}

export function normalizeHeaders(rawHeaders: unknown) {
  if (!rawHeaders || typeof rawHeaders !== "object" || Array.isArray(rawHeaders)) {
    return {};
  }

  const normalized: Record<string, string> = {};
  Object.entries(rawHeaders).forEach(([rawKey, rawValue]) => {
    const key = toSafeString(rawKey);
    const value = toSafeString(rawValue);
    if (!key || !value) return;
    normalized[key] = value;
  });
  return normalized;
}

export function normalizeTransport(rawTransport: unknown, fallbackUrl = ""): McpTransportType {
  const source = toSafeString(rawTransport).toLowerCase();
  if (
    source === MCP_TRANSPORT_STREAMABLE_HTTP ||
    source === "streamable_http" ||
    source === "http-stream" ||
    source === "http_stream" ||
    source === "http"
  ) {
    return MCP_TRANSPORT_STREAMABLE_HTTP;
  }

  if (source === MCP_TRANSPORT_SSE) {
    return MCP_TRANSPORT_SSE;
  }

  const hintUrl = toSafeString(fallbackUrl).toLowerCase();
  if (hintUrl && /\/sse(?:$|[/?#])/i.test(hintUrl)) {
    return MCP_TRANSPORT_SSE;
  }

  return MCP_TRANSPORT_STREAMABLE_HTTP;
}

function normalizeBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;

  const source = toSafeString(value).toLowerCase();
  if (!source) return null;
  if (["true", "1", "yes", "on", "enabled"].includes(source)) return true;
  if (["false", "0", "no", "off", "disabled"].includes(source)) return false;
  return null;
}

export function normalizeUrl(rawUrl: unknown) {
  const url = toSafeString(rawUrl);
  if (!url) return "";

  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.href;
    }
  } catch {
    return "";
  }

  return "";
}

export function normalizeToolDescriptor(rawTool: unknown): McpToolDescriptor | null {
  if (!rawTool || typeof rawTool !== "object") return null;

  const source = rawTool as Record<string, unknown>;
  const name = toSafeString(source.name);
  if (!name) return null;

  const description = toSafeString(source.description);
  const title = toSafeString(source.title);
  const inputSchema =
    source.inputSchema &&
    typeof source.inputSchema === "object" &&
    !Array.isArray(source.inputSchema)
      ? (source.inputSchema as Record<string, unknown>)
      : {};
  const outputSchema =
    source.outputSchema &&
    typeof source.outputSchema === "object" &&
    !Array.isArray(source.outputSchema)
      ? (source.outputSchema as Record<string, unknown>)
      : undefined;
  const annotations =
    source.annotations &&
    typeof source.annotations === "object" &&
    !Array.isArray(source.annotations)
      ? (source.annotations as Record<string, unknown>)
      : undefined;

  return {
    name,
    title: title || undefined,
    description,
    inputSchema,
    outputSchema,
    annotations,
    raw: { ...source },
  };
}

export function normalizeDiscoveredToolsByServer(rawMap: unknown) {
  if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) {
    return {};
  }

  const result: Record<string, McpToolDescriptor[]> = {};
  Object.entries(rawMap).forEach(([rawServerId, rawTools]) => {
    const serverId = toSafeString(rawServerId);
    if (!serverId || !Array.isArray(rawTools)) return;

    result[serverId] = rawTools
      .map((item) => normalizeToolDescriptor(item))
      .filter((item): item is McpToolDescriptor => Boolean(item));
  });

  return result;
}

export function normalizeDiscoveryMap(rawMap: unknown) {
  if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) {
    return {};
  }

  const result: McpDiscoveryMap = {};
  Object.entries(rawMap).forEach(([rawServerId, rawMeta]) => {
    const serverId = toSafeString(rawServerId);
    if (!serverId || !rawMeta || typeof rawMeta !== "object") return;

    const source = rawMeta as Record<string, unknown>;
    result[serverId] = {
      ok: source.ok !== false,
      error: toSafeString(source.error),
      fetchedAt: Number.isFinite(source.fetchedAt) ? Number(source.fetchedAt) : 0,
      toolCount: Number.isFinite(source.toolCount) ? Number(source.toolCount) : 0,
    };
  });

  return result;
}

export function normalizeEnabledToolsMap(rawValue: unknown) {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    return {};
  }

  const nextMap: McpEnabledToolsMap = {};
  Object.entries(rawValue).forEach(([rawServerId, rawTools]) => {
    const serverId = toSafeString(rawServerId);
    if (!serverId || !Array.isArray(rawTools)) return;

    const nextTools = Array.from(
      new Set(rawTools.map((item) => toSafeString(item)).filter(Boolean)),
    );
    if (nextTools.length) {
      nextMap[serverId] = nextTools;
    }
  });

  return nextMap;
}

export function normalizeTabId(value: unknown) {
  const numericValue =
    typeof value === "string" && value.trim()
      ? Number(value)
      : typeof value === "number"
        ? value
        : Number.NaN;

  if (!Number.isInteger(numericValue) || numericValue <= 0) {
    return "";
  }

  return String(numericValue);
}

export function normalizeSiteToolScopeKey(value: unknown) {
  const source = toSafeString(value).toLowerCase();
  return source;
}

export function normalizeTabEnabledToolsMap(rawValue: unknown) {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    return {};
  }

  const nextMap: McpTabEnabledToolsMap = {};
  Object.entries(rawValue).forEach(([rawTabId, rawEnabledTools]) => {
    const tabId = normalizeTabId(rawTabId);
    if (!tabId) return;

    const enabledToolsByServer = normalizeEnabledToolsMap(rawEnabledTools);
    if (Object.keys(enabledToolsByServer).length > 0) {
      nextMap[tabId] = enabledToolsByServer;
    }
  });

  return nextMap;
}

export function normalizeSiteEnabledToolsMap(rawValue: unknown) {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    return {};
  }

  const nextMap: McpSiteEnabledToolsMap = {};
  Object.entries(rawValue).forEach(([rawScopeKey, rawEnabledTools]) => {
    const scopeKey = normalizeSiteToolScopeKey(rawScopeKey);
    if (!scopeKey) return;

    const normalizedEnabledTools = normalizeEnabledToolsMap(rawEnabledTools);
    if (Object.keys(normalizedEnabledTools).length > 0) {
      nextMap[scopeKey] = normalizedEnabledTools;
    }
  });

  return nextMap;
}

export function buildMcpServerId(seed: unknown, index = 0) {
  const normalized = toSafeString(seed)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || `mcp-${index + 1}`;
}

function normalizeServersMap(rawMap: unknown) {
  if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) {
    return [];
  }

  return Object.entries(rawMap).map(([serverId, serverConfig]) => ({
    ...(serverConfig && typeof serverConfig === "object" ? serverConfig : {}),
    id:
      toSafeString((serverConfig as Record<string, unknown> | undefined)?.id) ||
      toSafeString(serverId) ||
      undefined,
    name:
      toSafeString((serverConfig as Record<string, unknown> | undefined)?.name) ||
      toSafeString(serverId) ||
      undefined,
  }));
}

function normalizeServersInput(rawStore: unknown) {
  const rawServers = getObjectValueByAliasesCaseInsensitive(rawStore, ["servers"]);
  if (Array.isArray(rawServers)) {
    return rawServers;
  }

  const mappedServers = normalizeServersMap(rawServers);
  if (mappedServers.length) {
    return mappedServers;
  }

  const rawMcpServers = getObjectValueByAliasesCaseInsensitive(rawStore, [
    "mcpServers",
    "mcp_servers",
    "mcpservers",
  ]);
  if (Array.isArray(rawMcpServers)) {
    return rawMcpServers;
  }

  const mappedMcpServers = normalizeServersMap(rawMcpServers);
  if (mappedMcpServers.length) {
    return mappedMcpServers;
  }

  return [];
}

export function normalizeServerConfig(rawServer: unknown, index = 0): McpServerConfig {
  const source =
    rawServer && typeof rawServer === "object"
      ? (rawServer as Record<string, unknown>)
      : {};
  const rawUrl = getObjectValueByAliasesCaseInsensitive(source, ["url", "baseUrl"]);
  const url = normalizeUrl(rawUrl);
  const name = toSafeString(source.name) || `MCP ${index + 1}`;
  const id =
    toSafeString(source.id) || buildMcpServerId(name || rawUrl || `mcp-${index + 1}`, index);
  const enabledValue = normalizeBoolean(
    getObjectValueByAliasesCaseInsensitive(source, ["enabled", "isEnabled"]),
  );
  const disabledValue = normalizeBoolean(
    getObjectValueByAliasesCaseInsensitive(source, ["disabled", "isDisabled"]),
  );
  const enabled = disabledValue === null ? enabledValue !== false : !disabledValue;

  return {
    id,
    name,
    enabled,
    type: normalizeTransport(
      getObjectValueByAliasesCaseInsensitive(source, ["type", "transport"]),
      url || toSafeString(rawUrl),
    ),
    url,
    headers: normalizeHeaders(source.headers),
    tools: Array.isArray(source.tools)
      ? source.tools
          .map((item) => normalizeToolDescriptor(item))
          .filter((item): item is McpToolDescriptor => Boolean(item))
      : [],
  };
}

export function normalizeConfigStore(rawStore: unknown): McpConfigStore {
  const servers = normalizeServersInput(rawStore).map((server, index) =>
    normalizeServerConfig(server, index),
  );

  const deduped: McpServerConfig[] = [];
  const seenIds = new Set<string>();
  servers.forEach((server) => {
    if (!server.id || seenIds.has(server.id)) return;
    seenIds.add(server.id);
    deduped.push(server);
  });

  return {
    servers: deduped,
    updatedAt:
      rawStore && typeof rawStore === "object" && Number.isFinite((rawStore as any).updatedAt)
        ? Number((rawStore as any).updatedAt)
        : Date.now(),
  };
}

export function toStoredServerConfig(server: McpServerConfig) {
  const normalized = normalizeServerConfig(server);
  return {
    id: normalized.id,
    name: normalized.name,
    enabled: normalized.enabled,
    type: normalized.type,
    url: normalized.url,
    headers: normalized.headers,
  };
}

export function mergeDiscoveredTools(
  config: McpConfigStore,
  discoveredToolsByServer: Record<string, McpToolDescriptor[]>,
) {
  return {
    servers: config.servers.map((server) => ({
      ...server,
      tools: Array.isArray(discoveredToolsByServer[server.id])
        ? discoveredToolsByServer[server.id]
        : [],
    })),
    updatedAt: config.updatedAt || Date.now(),
  };
}

export function sanitizeEnabledToolsMap(
  config: McpConfigStore,
  rawValue: unknown,
) {
  const normalized = normalizeEnabledToolsMap(rawValue);
  const nextMap: McpEnabledToolsMap = {};

  config.servers.forEach((server) => {
    const availableNames = new Set(
      (Array.isArray(server.tools) ? server.tools : []).map((tool) => tool.name),
    );
    if (!availableNames.size) return;

    const enabledNames = (normalized[server.id] || []).filter((name) =>
      availableNames.has(name),
    );
    if (enabledNames.length) {
      nextMap[server.id] = enabledNames;
    }
  });

  return nextMap;
}

export function sanitizeTabEnabledToolsMap(
  config: McpConfigStore,
  rawValue: unknown,
  allowedTabIds?: Array<number | string>,
) {
  const normalized = normalizeTabEnabledToolsMap(rawValue);
  const allowedTabIdSet = Array.isArray(allowedTabIds)
    ? new Set(allowedTabIds.map((tabId) => normalizeTabId(tabId)).filter(Boolean))
    : null;
  const nextMap: McpTabEnabledToolsMap = {};

  Object.entries(normalized).forEach(([tabId, enabledToolsByServer]) => {
    if (allowedTabIdSet && !allowedTabIdSet.has(tabId)) return;

    const sanitizedByServer = sanitizeEnabledToolsMap(config, enabledToolsByServer);
    if (Object.keys(sanitizedByServer).length > 0) {
      nextMap[tabId] = sanitizedByServer;
    }
  });

  return nextMap;
}

export function sanitizeSiteEnabledToolsMap(
  config: McpConfigStore,
  rawValue: unknown,
  allowedScopeKeys?: string[],
) {
  const normalized = normalizeSiteEnabledToolsMap(rawValue);
  const allowedScopeKeySet = Array.isArray(allowedScopeKeys)
    ? new Set(allowedScopeKeys.map((scopeKey) => normalizeSiteToolScopeKey(scopeKey)).filter(Boolean))
    : null;
  const nextMap: McpSiteEnabledToolsMap = {};

  Object.entries(normalized).forEach(([scopeKey, enabledToolsByServer]) => {
    if (allowedScopeKeySet && !allowedScopeKeySet.has(scopeKey)) return;

    const sanitizedByServer = sanitizeEnabledToolsMap(config, enabledToolsByServer);
    if (Object.keys(sanitizedByServer).length > 0) {
      nextMap[scopeKey] = sanitizedByServer;
    }
  });

  return nextMap;
}

export function filterConfigToEnabledTools(
  config: McpConfigStore,
  enabledToolsByServer: McpEnabledToolsMap,
) {
  const normalizedEnabled = sanitizeEnabledToolsMap(config, enabledToolsByServer);

  return {
    servers: config.servers.map((server) => {
      const enabledNames = new Set(normalizedEnabled[server.id] || []);
      return {
        ...server,
        tools: (Array.isArray(server.tools) ? server.tools : []).filter((tool) =>
          enabledNames.has(tool.name),
        ),
      };
    }),
    updatedAt: config.updatedAt,
  } satisfies McpConfigStore;
}

export function getServerConnectionSignature(server: Partial<McpServerConfig>) {
  return [
    normalizeTransport(server.type, server.url),
    normalizeUrl(server.url),
    JSON.stringify(normalizeHeaders(server.headers)),
  ].join("|");
}

export function getServerConfigError(server: Partial<McpServerConfig>) {
  const id = toSafeString(server.id) || "unknown";
  const type = normalizeTransport(server.type, server.url);
  if (type !== MCP_TRANSPORT_STREAMABLE_HTTP && type !== MCP_TRANSPORT_SSE) {
    return `不支持的传输协议：${type}`;
  }

  if (!normalizeUrl(server.url)) {
    return `服务 ${id} 的 URL 无效`;
  }

  return "";
}

export function countDiscoveredTools(config: McpConfigStore) {
  return config.servers.reduce(
    (count, server) => count + (Array.isArray(server.tools) ? server.tools.length : 0),
    0,
  );
}
