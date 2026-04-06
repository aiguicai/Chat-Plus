import { useEffect, useMemo, useRef, useState } from "react";

import { ToolbarIconButton } from "../components/common";
import { PlusIcon, RefreshIcon } from "../components/icons";
import { getStorage, sendRuntimeMessage, setStorage } from "../lib/chrome";
import { getErrorMessage } from "../lib/format";
import { exceedsLineClamp } from "../lib/textClamp";
import {
  DEFAULT_MCP_CONFIG_STORE,
  type McpConfigStore,
  type McpDiscoveryMap,
  countDiscoveredTools,
  normalizeConfigStore,
  normalizeDiscoveryMap,
  normalizeTransport,
} from "../../mcp/shared";
import { ToolsCatalogView } from "./tools-pane/ToolsCatalogView";
import { ToolsConfigView } from "./tools-pane/ToolsConfigView";
import {
  DEFAULT_MCP_TOOLS_UI_STATE,
  MCP_TOOLS_UI_STORAGE_KEY,
  SINGLE_SERVER_JSON_DEFAULT_TEXT,
  type ConfigMode,
  type McpServerDraft,
  type McpToolsUiState,
  type PaneView,
  type StatusTone,
  buildServerFromVisualDraft,
  createDraftFromServer,
  createEmptyDraft,
  normalizeCollapsedMap,
  parseDraftsToConfig,
  parseSingleServerJsonText,
  resolveDraftServerId,
  stringifySingleServerJson,
} from "./tools-pane/shared";

const DEFAULT_STATUS = {
  tone: "neutral" as StatusTone,
  message: "",
};
const STATUS_AUTO_CLEAR_MS = 3600;

function moveItemBeforeTarget<T>(
  items: T[],
  activeId: string,
  targetId: string,
  getId: (item: T, index: number) => string,
) {
  const fromIndex = items.findIndex((item, index) => getId(item, index) === activeId);
  const toIndex = items.findIndex((item, index) => getId(item, index) === targetId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return items;
  }

  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, movedItem);
  return nextItems;
}

function moveItemToIndex<T>(
  items: T[],
  activeId: string,
  targetIndex: number,
  getId: (item: T, index: number) => string,
) {
  const fromIndex = items.findIndex((item, index) => getId(item, index) === activeId);
  if (fromIndex < 0 || targetIndex < 0 || targetIndex >= items.length) {
    return items;
  }

  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  const normalizedTargetIndex = fromIndex < targetIndex ? targetIndex : targetIndex;
  nextItems.splice(normalizedTargetIndex, 0, movedItem);
  return nextItems;
}

function alignDraftsToServerOrder(nextServerIds: string[], drafts: McpServerDraft[]) {
  const savedDraftsByServerId = new Map<string, McpServerDraft>();
  const floatingDrafts: McpServerDraft[] = [];

  drafts.forEach((draft, index) => {
    const serverId = resolveDraftServerId(draft, index);
    if (serverId) {
      savedDraftsByServerId.set(serverId, draft);
      return;
    }
    floatingDrafts.push(draft);
  });

  const orderedDrafts = nextServerIds
    .map((serverId) => savedDraftsByServerId.get(serverId) || null)
    .filter((draft): draft is McpServerDraft => Boolean(draft));

  savedDraftsByServerId.forEach((draft, serverId) => {
    if (!nextServerIds.includes(serverId)) {
      orderedDrafts.push(draft);
    }
  });

  return [...orderedDrafts, ...floatingDrafts];
}

export function ToolsPane({ active }: { active: boolean }) {
  const [view, setView] = useState<PaneView>("config");
  const [config, setConfig] = useState<McpConfigStore>(DEFAULT_MCP_CONFIG_STORE);
  const [drafts, setDrafts] = useState<McpServerDraft[]>([]);
  const [discoveryByServer, setDiscoveryByServer] = useState<McpDiscoveryMap>({});
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [discoveringAll, setDiscoveringAll] = useState(false);
  const [discoveringServerId, setDiscoveringServerId] = useState("");
  const [pendingDeleteLocalId, setPendingDeleteLocalId] = useState("");
  const [collapsedByServerId, setCollapsedByServerId] = useState<Record<string, boolean>>({});
  const [collapsedDraftsByLocalId, setCollapsedDraftsByLocalId] = useState<Record<string, boolean>>(
    {},
  );
  const [status, setStatus] = useState<{
    tone: StatusTone;
    message: string;
  }>(DEFAULT_STATUS);
  const autoSaveSignatureRef = useRef("");
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configRef = useRef(config);
  const draftsRef = useRef(drafts);
  const toolDescRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [expandableToolKeys, setExpandableToolKeys] = useState<Record<string, boolean>>({});
  const [expandedToolKeys, setExpandedToolKeys] = useState<Record<string, boolean>>({});

  const serverCount = config.servers.length;
  const toolCount = useMemo(() => countDiscoveredTools(config), [config]);
  const draftSignature = useMemo(
    () =>
      JSON.stringify(
        drafts.map((draft) => ({
          id: draft.id,
          name: draft.name,
          enabled: draft.enabled,
          type: draft.type,
          url: draft.url,
          headersText: draft.headersText,
          mode: draft.mode,
          jsonText: draft.jsonText,
        })),
      ),
    [drafts],
  );

  const persistCollapsedState = async (nextMap: Record<string, boolean>) => {
    const collapsedEntries = Object.fromEntries(
      Object.entries(nextMap).filter(([, value]) => value === true),
    );

    await setStorage("local", {
      [MCP_TOOLS_UI_STORAGE_KEY]: {
        collapsedByServerId: collapsedEntries,
      } satisfies McpToolsUiState,
    });
  };

  const syncStateFromRemote = (nextConfigRaw: unknown, nextDiscoveryRaw: unknown) => {
    const nextConfig = normalizeConfigStore(nextConfigRaw);
    const nextDiscovery = normalizeDiscoveryMap(nextDiscoveryRaw);

    setConfig(nextConfig);
    setDiscoveryByServer(nextDiscovery);
    setDrafts((prev) => {
      const previousById = new Map<string, McpServerDraft>();
      prev.forEach((draft, index) => {
        const draftId = resolveDraftServerId(draft, index);
        if (draftId && !previousById.has(draftId)) {
          previousById.set(draftId, draft);
        }
      });

      const syncedDrafts = nextConfig.servers.map((server, index) => {
        const previous = previousById.get(server.id) || prev[index];
        const nextDraft = createDraftFromServer(server, index);
        if (!previous) return nextDraft;
        return {
          ...nextDraft,
          mode: previous.mode,
          jsonText: stringifySingleServerJson(server, index),
        };
      });

      const syncedIds = new Set(nextConfig.servers.map((server) => server.id));
      const localUnsavedDrafts = prev.filter((draft, index) => {
        const draftId = resolveDraftServerId(draft, index);
        return !draftId || !syncedIds.has(draftId);
      });

      return [...syncedDrafts, ...localUnsavedDrafts];
    });
  };

  const loadState = async () => {
    setLoading(true);
    try {
      const [response, storedUiState] = await Promise.all([
        sendRuntimeMessage<any>({ type: "MCP_CONFIG_GET" }),
        getStorage<{
          [MCP_TOOLS_UI_STORAGE_KEY]: McpToolsUiState;
        }>("local", {
          [MCP_TOOLS_UI_STORAGE_KEY]: DEFAULT_MCP_TOOLS_UI_STATE,
        }),
      ]);
      if (!response?.ok) {
        throw new Error(response?.error || "加载 MCP 配置失败");
      }

      const nextConfig = normalizeConfigStore(response.config);
      const storedCollapsedMap = normalizeCollapsedMap(
        storedUiState?.[MCP_TOOLS_UI_STORAGE_KEY]?.collapsedByServerId,
      );
      setCollapsedByServerId(storedCollapsedMap);
      syncStateFromRemote(response.config, response.discoveryByServer);
    } catch (error) {
      setStatus({
        tone: "danger",
        message: getErrorMessage(error),
      });
    } finally {
      setLoading(false);
      setInitialized(true);
    }
  };

  const updateDraft = (
    localId: string,
    patch: Partial<Omit<McpServerDraft, "localId">>,
  ) => {
    setDrafts((prev) =>
      prev.map((draft) => (draft.localId === localId ? { ...draft, ...patch } : draft)),
    );
  };

  const switchDraftMode = (localId: string, nextMode: ConfigMode) => {
    setDrafts((prev) =>
      prev.map((draft, index) => {
        if (draft.localId !== localId || draft.mode === nextMode) {
          return draft;
        }

        if (nextMode === "json") {
          const parsed = buildServerFromVisualDraft(draft, index);
          if (!parsed.ok) {
            setStatus({
              tone: "danger",
              message: `服务 ${index + 1}：${parsed.error}`,
            });
            return draft;
          }

          return {
            ...draft,
            mode: "json",
            jsonText:
              parsed.blank || !parsed.server
                ? SINGLE_SERVER_JSON_DEFAULT_TEXT
                : stringifySingleServerJson(parsed.server, index),
          };
        }

        const parsed = parseSingleServerJsonText(draft.jsonText);
        if (!parsed.ok) {
          setStatus({
            tone: "danger",
            message: `服务 ${index + 1}：${parsed.error}`,
          });
          return draft;
        }

        if (parsed.blank || !parsed.server) {
          return {
            ...draft,
            mode: "visual",
            id: "",
            name: `MCP ${index + 1}`,
            enabled: draft.enabled,
            type: normalizeTransport(undefined, ""),
            url: "",
            headersText: "",
            jsonText: SINGLE_SERVER_JSON_DEFAULT_TEXT,
          };
        }

        return {
          ...draft,
          mode: "visual",
          id: parsed.server.id,
          name: parsed.server.name || parsed.server.id,
          enabled: draft.enabled,
          type: normalizeTransport(parsed.server.type, parsed.server.url),
          url: parsed.server.url || "",
          headersText: Object.keys(parsed.server.headers || {}).length
            ? JSON.stringify(parsed.server.headers, null, 2)
            : "",
          jsonText: parsed.normalizedText,
        };
      }),
    );
  };

  const addServerDraft = () => {
    setDrafts((prev) => {
      const nextMode = prev[prev.length - 1]?.mode ?? "visual";
      return [...prev, createEmptyDraft(prev.length, nextMode)];
    });
  };

  const removeServerDraft = (localId: string) => {
    setDrafts((prev) => prev.filter((draft) => draft.localId !== localId));
    setPendingDeleteLocalId((prev) => (prev === localId ? "" : prev));
    setCollapsedDraftsByLocalId((prev) => {
      if (!(localId in prev)) return prev;
      const nextMap = { ...prev };
      delete nextMap[localId];
      return nextMap;
    });
  };

  const toggleServerCollapsed = (serverId: string) => {
    setCollapsedByServerId((prev) => {
      const nextValue = !prev[serverId];
      const nextMap = nextValue
        ? { ...prev, [serverId]: true }
        : Object.fromEntries(Object.entries(prev).filter(([key]) => key !== serverId));
      void persistCollapsedState(nextMap);
      return nextMap;
    });
  };

  const toggleDraftCollapsed = (draft: McpServerDraft, index: number) => {
    const serverId = resolveDraftServerId(draft, index);
    if (serverId) {
      toggleServerCollapsed(serverId);
      return;
    }

    setCollapsedDraftsByLocalId((prev) => ({
      ...prev,
      [draft.localId]: !prev[draft.localId],
    }));
  };

  const toggleToolDescriptionExpanded = (toolKey: string) => {
    setExpandedToolKeys((prev) => ({
      ...prev,
      [toolKey]: !prev[toolKey],
    }));
  };

  const moveDraftToIndex = (localId: string, targetIndex: number) => {
    const nextDrafts = moveItemToIndex(
      draftsRef.current,
      localId,
      targetIndex,
      (draft) => draft.localId,
    );
    if (nextDrafts === draftsRef.current) return;
    draftsRef.current = nextDrafts;
    setDrafts(nextDrafts);
  };

  const moveServerToIndex = (serverId: string, targetIndex: number) => {
    const nextServers = moveItemToIndex(
      configRef.current.servers,
      serverId,
      targetIndex,
      (server) => server.id,
    );
    if (nextServers === configRef.current.servers) return;

    const nextConfig = {
      ...configRef.current,
      servers: nextServers,
    };
    const nextDrafts = alignDraftsToServerOrder(
      nextServers.map((server) => server.id),
      draftsRef.current,
    );
    configRef.current = nextConfig;
    draftsRef.current = nextDrafts;
    setConfig(nextConfig);
    setDrafts(nextDrafts);
  };

  const saveConfigOnly = async (nextDrafts: McpServerDraft[], signature: string) => {
    const parsed = parseDraftsToConfig(nextDrafts);
    if (!parsed.ok) {
      return;
    }

    setSaving(true);

    try {
      const saveResponse: any = await sendRuntimeMessage({
        type: "MCP_CONFIG_SAVE",
        config: parsed.config,
      });
      if (!saveResponse?.ok) {
        throw new Error(saveResponse?.error || "保存失败");
      }

      syncStateFromRemote(saveResponse.config, saveResponse.discoveryByServer);
      autoSaveSignatureRef.current = signature;
    } catch (error) {
      setStatus({
        tone: "danger",
        message: getErrorMessage(error),
      });
    } finally {
      setSaving(false);
      setDiscoveringAll(false);
    }
  };

  const refreshServerTools = async (serverId: string) => {
    setView("tools");
    setDiscoveringServerId(serverId);
    setStatus({
      tone: "neutral",
      message: `正在拉取 ${serverId}...`,
    });

    try {
      const response: any = await sendRuntimeMessage({
        type: "MCP_TOOLS_DISCOVER",
        serverId,
      });
      if (!response?.config) {
        throw new Error(response?.error || "拉取工具失败");
      }

      syncStateFromRemote(response.config, response.discoveryByServer);

      if (!response?.ok) {
        setStatus({
          tone: "danger",
          message: response?.error || `${serverId} 拉取失败`,
        });
        return;
      }

      setStatus({
        tone: "success",
        message: `${serverId} 已刷新。`,
      });
    } catch (error) {
      setStatus({
        tone: "danger",
        message: getErrorMessage(error),
      });
    } finally {
      setDiscoveringServerId("");
    }
  };

  const refreshAllTools = async () => {
    if (!config.servers.length) return;
    setView("tools");
    setDiscoveringAll(true);
    setStatus({
      tone: "neutral",
      message: "正在拉取全部工具...",
    });

    try {
      const response: any = await sendRuntimeMessage({
        type: "MCP_TOOLS_DISCOVER_ALL",
      });
      if (!response?.ok) {
        throw new Error(response?.error || "拉取工具失败");
      }

      syncStateFromRemote(response.config, response.discoveryByServer);

      if (Array.isArray(response.failedServers) && response.failedServers.length) {
        setStatus({
          tone: "danger",
          message: `部分服务拉取失败：${response.failedServers.join(" | ")}`,
        });
        return;
      }

      setStatus({
        tone: "success",
        message: "全部工具已刷新。",
      });
    } catch (error) {
      setStatus({
        tone: "danger",
        message: getErrorMessage(error),
      });
    } finally {
      setDiscoveringAll(false);
    }
  };

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  useEffect(() => {
    if (!active || initialized) return;
    void loadState();
  }, [active, initialized]);

  useEffect(() => {
    if (!status.message || status.tone === "neutral") return undefined;

    const timerId = window.setTimeout(() => setStatus(DEFAULT_STATUS), STATUS_AUTO_CLEAR_MS);
    return () => window.clearTimeout(timerId);
  }, [status.message, status.tone]);

  useEffect(() => {
    if (!initialized) return;
    if (autoSaveSignatureRef.current === "") {
      autoSaveSignatureRef.current = draftSignature;
      return;
    }
    if (saving || draftSignature === autoSaveSignatureRef.current) return;

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(() => {
      void saveConfigOnly(drafts, draftSignature);
    }, 700);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [draftSignature, drafts, initialized, saving]);

  useEffect(() => {
    if (view !== "tools") return;

    const measureExpandable = () => {
      const nextMap: Record<string, boolean> = {};

      Object.entries(toolDescRefs.current).forEach(([toolKey, element]) => {
        if (!element) return;
        nextMap[toolKey] = exceedsLineClamp(element, 3);
      });

      setExpandableToolKeys(nextMap);
      setExpandedToolKeys((prev) => {
        const nextExpanded = { ...prev };
        Object.entries(nextExpanded).forEach(([toolKey]) => {
          if (!nextMap[toolKey]) {
            delete nextExpanded[toolKey];
          }
        });
        return nextExpanded;
      });
    };

    const frameId = requestAnimationFrame(measureExpandable);
    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(measureExpandable) : null;

    Object.values(toolDescRefs.current).forEach((element) => {
      if (element && resizeObserver) {
        resizeObserver.observe(element);
      }
    });

    window.addEventListener("resize", measureExpandable);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", measureExpandable);
      resizeObserver?.disconnect();
    };
  }, [config, view, collapsedByServerId]);

  return (
    <div className={`cp-pane${active ? " active" : ""}`}>
      <div className="cp-tools-shell">
        <div className="cp-tools-controls">
          <div className="cp-tools-control-group">
            <div className="cp-tools-segmented" role="tablist" aria-label="MCP 主视图">
              <button
                type="button"
                role="tab"
                aria-selected={view === "config"}
                className={`cp-tools-segment${view === "config" ? " is-active" : ""}`}
                onClick={() => setView("config")}
              >
                <span className="cp-tools-segment-content">
                  <span>配置</span>
                  <span className="cp-tools-segment-badge">{serverCount}</span>
                </span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "tools"}
                className={`cp-tools-segment${view === "tools" ? " is-active" : ""}`}
                onClick={() => setView("tools")}
              >
                <span className="cp-tools-segment-content">
                  <span>工具</span>
                  <span className="cp-tools-segment-badge">{toolCount}</span>
                </span>
              </button>
            </div>
          </div>

          <div className="cp-toolbar-actions cp-tools-toolbar-actions">
            {view === "config" ? (
              <ToolbarIconButton
                label="新增服务"
                className="cp-toolbar-icon-sm cp-library-action-btn"
                disabled={loading || saving || discoveringAll}
                onClick={addServerDraft}
              >
                <>
                  <PlusIcon />
                  <span className="cp-library-action-text">新增</span>
                </>
              </ToolbarIconButton>
            ) : null}

            {view === "tools" ? (
              <ToolbarIconButton
                label="刷新全部工具"
                className="cp-toolbar-icon-sm cp-library-action-btn"
                disabled={loading || saving || discoveringAll || !config.servers.length}
                onClick={() => {
                  void refreshAllTools();
                }}
              >
                <>
                  <RefreshIcon />
                  <span className="cp-library-action-text">刷新</span>
                </>
              </ToolbarIconButton>
            ) : null}
          </div>
        </div>

        {view === "tools" ? (
          <div className="cp-tools-view-note">
            这里只负责配置服务和刷新工具目录。具体给哪个标签页使用，请到“编排”里单独添加和勾选。
          </div>
        ) : (
          <div className="cp-tools-view-note">
            这里只配置 MCP 服务连接。工具是否启用请到“编排”页按标签页独立管理。
          </div>
        )}

      {view === "config" ? (
        <ToolsConfigView
          drafts={drafts}
          saving={saving}
          discoveringAll={discoveringAll}
          pendingDeleteLocalId={pendingDeleteLocalId}
          collapsedByServerId={collapsedByServerId}
          collapsedDraftsByLocalId={collapsedDraftsByLocalId}
          addServerDraft={addServerDraft}
          updateDraft={updateDraft}
          switchDraftMode={switchDraftMode}
          toggleDraftCollapsed={toggleDraftCollapsed}
          removeServerDraft={removeServerDraft}
          setPendingDeleteLocalId={setPendingDeleteLocalId}
          moveDraftToIndex={moveDraftToIndex}
        />
      ) : (
        <ToolsCatalogView
          config={config}
          discoveryByServer={discoveryByServer}
          collapsedByServerId={collapsedByServerId}
          loading={loading}
          saving={saving}
          discoveringAll={discoveringAll}
          discoveringServerId={discoveringServerId}
          expandableToolKeys={expandableToolKeys}
          expandedToolKeys={expandedToolKeys}
          toolDescRefs={toolDescRefs}
          refreshServerTools={(serverId) => {
            void refreshServerTools(serverId);
          }}
          toggleServerCollapsed={toggleServerCollapsed}
          toggleToolDescriptionExpanded={toggleToolDescriptionExpanded}
          goToConfig={() => setView("config")}
          moveServerToIndex={moveServerToIndex}
        />
        )}

        {status.message ? (
          <div className={`cp-tools-inline-status is-${status.tone}`}>{status.message}</div>
        ) : null}
      </div>
    </div>
  );
}
