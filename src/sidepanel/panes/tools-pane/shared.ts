import { getErrorMessage } from "../../lib/format";
import {
  MCP_TRANSPORT_SSE,
  MCP_TRANSPORT_STREAMABLE_HTTP,
  type McpConfigStore,
  type McpEnabledToolsMap,
  type McpServerConfig,
  buildMcpServerId,
  getServerConfigError,
  normalizeConfigStore,
  normalizeHeaders,
  normalizeTransport,
  toSafeString,
} from "../../../mcp/shared";

export type PaneView = "config" | "tools";
export type ConfigMode = "visual" | "json";
export type StatusTone = "neutral" | "success" | "danger";
export type ToolSelectionState = "checked" | "indeterminate" | "unchecked";

export type McpServerDraft = {
  localId: string;
  id: string;
  name: string;
  enabled: boolean;
  type: typeof MCP_TRANSPORT_STREAMABLE_HTTP | typeof MCP_TRANSPORT_SSE;
  url: string;
  headersText: string;
  mode: ConfigMode;
  jsonText: string;
};

export type McpToolsUiState = {
  collapsedByServerId: Record<string, boolean>;
};

export type McpToolsSelectionState = {
  enabledToolsByServerId: McpEnabledToolsMap;
};

export const SINGLE_SERVER_JSON_DEFAULT_TEXT = "{}";
export const REQUEST_HEADERS_PLACEHOLDER_TEXT = `{
  "headers": {
    "Authorization": "Bearer xxxxxxx"
  }
}`;
export const MCP_TOOLS_UI_STORAGE_KEY = "chatplus_mcp_tools_ui_v1";

export const DEFAULT_MCP_TOOLS_UI_STATE: McpToolsUiState = {
  collapsedByServerId: {},
};

export const DEFAULT_MCP_TOOLS_SELECTION_STATE: McpToolsSelectionState = {
  enabledToolsByServerId: {},
};

function createDraftId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `draft-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function stringifySingleServerJson(
  server?: Partial<McpServerConfig> | null,
  index = 0,
) {
  if (!server) return SINGLE_SERVER_JSON_DEFAULT_TEXT;

  const name = toSafeString(server.name);
  const url = toSafeString(server.url);
  const id =
    toSafeString(server.id) ||
    buildMcpServerId(name || url || `mcp-${index + 1}`, index);

  if (!id || !url) {
    return SINGLE_SERVER_JSON_DEFAULT_TEXT;
  }

  const payload: Record<string, Record<string, unknown>> = {
    [id]: {
      type: normalizeTransport(server.type, url),
      url,
    },
  };

  const headers = normalizeHeaders(server.headers);
  if (Object.keys(headers).length) {
    payload[id].headers = headers;
  }

  return JSON.stringify(payload, null, 2);
}

export function createEmptyDraft(index = 0, mode: ConfigMode = "visual"): McpServerDraft {
  return {
    localId: createDraftId(),
    id: "",
    name: `MCP ${index + 1}`,
    enabled: true,
    type: MCP_TRANSPORT_STREAMABLE_HTTP,
    url: "",
    headersText: "",
    mode,
    jsonText: SINGLE_SERVER_JSON_DEFAULT_TEXT,
  };
}

export function createDraftFromServer(server: McpServerConfig, index = 0): McpServerDraft {
  return {
    localId: createDraftId(),
    id: server.id || "",
    name: server.name || server.id || `MCP ${index + 1}`,
    enabled: server.enabled !== false,
    type: normalizeTransport(server.type, server.url),
    url: server.url || "",
    headersText: Object.keys(server.headers || {}).length
      ? JSON.stringify(server.headers, null, 2)
      : "",
    mode: "visual",
    jsonText: stringifySingleServerJson(server, index),
  };
}

export function normalizeCollapsedMap(rawValue: unknown) {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    return {};
  }

  const nextMap: Record<string, boolean> = {};
  Object.entries(rawValue).forEach(([rawKey, value]) => {
    const key = toSafeString(rawKey);
    if (!key) return;
    nextMap[key] = value === true;
  });

  return nextMap;
}

function parseHeadersText(headersText: string) {
  const source = headersText.trim();
  if (!source) {
    return {
      ok: true as const,
      headers: {},
    };
  }

  try {
    const parsed = JSON.parse(source);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false as const,
        error: "请求头必须是 JSON 对象",
      };
    }

    const parsedRecord = parsed as Record<string, unknown>;
    const headerCandidate =
      parsedRecord.headers &&
      typeof parsedRecord.headers === "object" &&
      !Array.isArray(parsedRecord.headers)
        ? parsedRecord.headers
        : parsed;

    return {
      ok: true as const,
      headers: normalizeHeaders(headerCandidate),
    };
  } catch (error) {
    return {
      ok: false as const,
      error: `请求头 JSON 解析失败：${getErrorMessage(error)}`,
    };
  }
}

function isVisualDraftBlank(draft: McpServerDraft, index: number) {
  const defaultName = `MCP ${index + 1}`;
  const name = toSafeString(draft.name);
  const id = toSafeString(draft.id);
  const url = toSafeString(draft.url);
  const headersText = toSafeString(draft.headersText);

  return !id && !url && !headersText && (!name || name === defaultName);
}

export function getVisualDraftMissingFields(draft: McpServerDraft, index: number) {
  if (isVisualDraftBlank(draft, index)) {
    return ["远程地址"];
  }

  const missingFields: string[] = [];
  if (!toSafeString(draft.name)) {
    missingFields.push("服务名称");
  }

  const type = normalizeTransport(draft.type, draft.url);
  if (type !== MCP_TRANSPORT_STREAMABLE_HTTP && type !== MCP_TRANSPORT_SSE) {
    missingFields.push("连接方式");
  }

  if (!toSafeString(draft.url)) {
    missingFields.push("远程地址");
  }

  return missingFields;
}

export function buildServerFromVisualDraft(draft: McpServerDraft, index: number) {
  const isBlank = isVisualDraftBlank(draft, index);
  if (isBlank) {
    return {
      ok: true as const,
      blank: true as const,
      server: null,
    };
  }

  const headersResult = parseHeadersText(draft.headersText);
  if (!headersResult.ok) {
    return {
      ok: false as const,
      error: headersResult.error,
    };
  }

  const name = toSafeString(draft.name);
  if (!name) {
    return {
      ok: false as const,
      error: "请填写服务名称",
    };
  }

  const url = toSafeString(draft.url);
  if (!url) {
    return {
      ok: false as const,
      error: "请填写远程地址",
    };
  }

  const server: McpServerConfig = {
    id: toSafeString(draft.id) || buildMcpServerId(name || url, index),
    name,
    enabled: draft.enabled !== false,
    type: normalizeTransport(draft.type, url),
    url,
    headers: headersResult.headers,
    tools: [],
  };

  const error = getServerConfigError(server);
  if (error) {
    return {
      ok: false as const,
      error,
    };
  }

  return {
    ok: true as const,
    blank: false as const,
    server,
  };
}

export function parseSingleServerJsonText(text: string) {
  const source = text.trim();
  if (!source || source === SINGLE_SERVER_JSON_DEFAULT_TEXT) {
    return {
      ok: true as const,
      blank: true as const,
      server: null,
      normalizedText: SINGLE_SERVER_JSON_DEFAULT_TEXT,
    };
  }

  try {
    const parsed = JSON.parse(source);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false as const,
        error: "JSON 必须是对象",
      };
    }

    let normalized = normalizeConfigStore(parsed);
    if (normalized.servers.length === 0) {
      normalized = normalizeConfigStore({ mcpServers: parsed });
    }

    if (normalized.servers.length === 0) {
      return {
        ok: true as const,
        blank: true as const,
        server: null,
        normalizedText: SINGLE_SERVER_JSON_DEFAULT_TEXT,
      };
    }

    if (normalized.servers.length > 1) {
      return {
        ok: false as const,
        error: "单个服务卡片只支持一个服务配置",
      };
    }

    const server = normalized.servers[0];
    const error = getServerConfigError(server);
    if (error) {
      return {
        ok: false as const,
        error,
      };
    }

    return {
      ok: true as const,
      blank: false as const,
      server,
      normalizedText: stringifySingleServerJson(server),
    };
  } catch (error) {
    return {
      ok: false as const,
      error: `JSON 解析失败：${getErrorMessage(error)}`,
    };
  }
}

export function parseDraftsToConfig(drafts: McpServerDraft[]) {
  const servers: McpServerConfig[] = [];
  const seenIds = new Set<string>();

  for (let index = 0; index < drafts.length; index += 1) {
    const draft = drafts[index];
    const parsed =
      draft.mode === "json"
        ? parseSingleServerJsonText(draft.jsonText)
        : buildServerFromVisualDraft(draft, index);

    if (!parsed.ok) {
      return {
        ok: false as const,
        error: `服务 ${index + 1}：${parsed.error}`,
      };
    }

    if (parsed.blank || !parsed.server) continue;

    const server =
      draft.mode === "json"
        ? {
            ...parsed.server,
            enabled: draft.enabled !== false,
          }
        : parsed.server;

    if (seenIds.has(server.id)) {
      return {
        ok: false as const,
        error: `服务 ID 重复：${server.id}`,
      };
    }

    seenIds.add(server.id);
    servers.push(server);
  }

  return {
    ok: true as const,
    config: {
      servers,
      updatedAt: Date.now(),
    } satisfies McpConfigStore,
  };
}

export function resolveDraftServerId(draft: McpServerDraft, index: number) {
  if (draft.mode === "json") {
    const parsed = parseSingleServerJsonText(draft.jsonText);
    if (parsed.ok && !parsed.blank && parsed.server) {
      return parsed.server.id;
    }
  } else {
    const parsed = buildServerFromVisualDraft(draft, index);
    if (parsed.ok && !parsed.blank && parsed.server) {
      return parsed.server.id;
    }
  }

  return toSafeString(draft.id);
}

export function describeTransport(type: McpServerConfig["type"] | McpServerDraft["type"]) {
  return type === MCP_TRANSPORT_SSE ? "SSE" : "HTTP Stream";
}

export function buildToolSelectionLabel(enabledCount: number, totalCount: number) {
  return `${enabledCount}/${totalCount}`;
}

export function getToolSelectionState(
  enabledCount: number,
  totalCount: number,
): ToolSelectionState {
  if (totalCount > 0 && enabledCount === totalCount) {
    return "checked";
  }

  if (enabledCount > 0) {
    return "indeterminate";
  }

  return "unchecked";
}
