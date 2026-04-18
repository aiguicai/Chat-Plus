import {
  activateTab,
  createTab,
  getStorage,
  getTabFrames,
  getTabGroup,
  groupTabs,
  queryTabs,
  reloadTab,
  sendTabMessage,
  setStorage,
  ungroupTabs,
  updateTabGroup,
} from "../lib/chrome";
import {
  formatUrlHost,
  isSupportedUrl,
  getErrorMessage,
  normalizeMessageError,
} from "../lib/format";
import {
  getEffectiveOrchestrationTabEnabled,
} from "../lib/orchestrationState";
import {
  SITE_CONFIG_MAP_STORAGE_KEY,
  readStoredSiteConfigMap,
  compactExportConfigMap,
  compactSiteConfig,
  hasValidConfigData,
  isSiteConfigEnabled,
  normalizeConfigMap,
  normalizeSiteConfig,
} from "../lib/siteConfig";
import {
  buildFullBackupPayload,
  DEFAULT_FULL_BACKUP_LOCAL_STATE,
  DEFAULT_FULL_BACKUP_SYNC_STATE,
  getFullBackupFileName,
  parseFullBackupPayload,
} from "../lib/fullBackup";
import type {
  ConfigMap,
  OrchestrationColor,
  OrchestrationTab,
  SiteConfig,
  TabState,
} from "../types";

type PageContext = Record<string, any>;

export function createSidepanelControllerRuntime(ctx: any) {
  const {
    REFRESHING_TIP_MESSAGE,
    ORCHESTRATION_GROUP_COLORS,
    currentTab,
    settings,
    siteConfigMap,
    currentHost,
    importInputRef,
    backupImportInputRef,
    refreshTimerRef,
    refreshingTabIdRef,
    siteConfigMapRef,
    orchestrationTabColorsRef,
    orchestrationGroupIdsRef,
    activePaneRef,
    draftRef,
    editorHostRef,
    frameContextsRef,
    currentFrameIdRef,
    editorFrameIdRef,
    extensionIconUrl,
    setActivePane,
    setScreen,
    setSettings,
    setSiteConfigMap,
    setEditorHost,
    setDraftConfig,
    setCurrentTab,
    setMonitor,
    setTip,
    setPendingDeleteHost,
    setOrchestrationTabs,
    showTip,
  } = ctx;

  const clearRefreshTip = (tabId?: number | null) => {
    if (refreshingTabIdRef.current === null) return;
    if (tabId !== undefined && tabId !== null && refreshingTabIdRef.current !== tabId) return;

    refreshingTabIdRef.current = null;
    setTip((prev) => (prev.message === REFRESHING_TIP_MESSAGE ? { message: "", tone: "" } : prev));
  };

  const scorePageContext = (context: PageContext, tabHost = "", preferredHost = "") => {
    let score = 0;
    const host = String(context.host || "");
    const url = String(context.url || "");
    const title = String(context.title || "");
    const signals = `${host} ${url} ${title}`.toLowerCase();
    const looksLikeChatSurface =
      /chat|conversation|assistant|copilot|gemini|claude|qwen|kimi|grok|openai/i.test(
        signals,
      );

    if (host) score += 4;
    if (context.monitorReady) score += 4;
    if (context.monitorActive) score += 8;
    if (isSupportedUrl(url)) score += 4;
    if (preferredHost && host === preferredHost) score += 20;
    if (looksLikeChatSurface) score += 4;

    if (host && tabHost) {
      if (host === tabHost) score += 12;
      else if (preferredHost) score -= 6;
    }

    if (context.isTopFrame === false && preferredHost && host === preferredHost) {
      score += 8;
    }

    return score;
  };

  const storeFrameContext = (frameId: number, context: PageContext) => {
    frameContextsRef.current[frameId] = {
      ...(context || {}),
      frameId,
      isTopFrame:
        context.isTopFrame !== undefined ? Boolean(context.isTopFrame) : frameId === 0,
    };
  };

  const chooseBestFrameContext = (tabHost = "", preferredHost = "") => {
    let best: PageContext | null = null;
    let bestScore = -Infinity;

    Object.entries(frameContextsRef.current).forEach(([frameIdText, context]) => {
      const frameId = Number(frameIdText);
      const nextContext = { ...((context as any) || {}), frameId };
      const nextScore = scorePageContext(nextContext, tabHost, preferredHost);
      if (nextScore > bestScore) {
        bestScore = nextScore;
        best = nextContext;
      }
    });

    return best;
  };

  const resolveFrameIdForHost = (host = "") => {
    if (editorFrameIdRef.current !== null) {
      const editorContext = frameContextsRef.current[editorFrameIdRef.current];
      if (!host || editorContext?.host === host) return editorFrameIdRef.current;
    }

    return chooseBestFrameContext(formatUrlHost(currentTab.url || ""), host)?.frameId ?? null;
  };

  const reconcileOrchestrationTabColors = (tabIds: number[]) => {
    const previous = orchestrationTabColorsRef.current;
    const next: Record<number, OrchestrationColor> = {};
    const used = new Set<OrchestrationColor>();

    tabIds.forEach((tabId) => {
      const color = previous[tabId];
      if (!color || used.has(color)) return;
      next[tabId] = color;
      used.add(color);
    });

    let paletteIndex = 0;
    tabIds.forEach((tabId) => {
      if (next[tabId]) return;
      while (
        used.size < ORCHESTRATION_GROUP_COLORS.length &&
        used.has(ORCHESTRATION_GROUP_COLORS[paletteIndex % ORCHESTRATION_GROUP_COLORS.length])
      ) {
        paletteIndex += 1;
      }

      const color =
        ORCHESTRATION_GROUP_COLORS[paletteIndex % ORCHESTRATION_GROUP_COLORS.length];
      next[tabId] = color;
      if (used.size < ORCHESTRATION_GROUP_COLORS.length) used.add(color);
      paletteIndex += 1;
    });

    orchestrationTabColorsRef.current = next;
    return next;
  };

  const buildOrchestrationTabs = (windowTabs: chrome.tabs.Tab[]) => {
    const completedHosts = new Set(
      Object.keys(siteConfigMapRef.current).filter(
        (host) => hasValidConfigData(normalizeSiteConfig(siteConfigMapRef.current[host])),
      ),
    );

    const matchedTabs = windowTabs
      .filter((tab) => completedHosts.has(formatUrlHost(tab.url || "")))
      .sort((left, right) => left.index - right.index);
    const tabColors = reconcileOrchestrationTabColors(
      matchedTabs
        .filter((tab) => isSiteConfigEnabled(siteConfigMapRef.current[formatUrlHost(tab.url || "")]))
        .map((tab) => tab.id)
        .filter((tabId): tabId is number => tabId !== undefined),
    );

    return matchedTabs.map(
      (tab) =>
        ({
          tabId: tab.id || 0,
          order: (tab.index || 0) + 1,
          host: formatUrlHost(tab.url || ""),
          title: tab.title || "",
          url: tab.url || "",
          favIconUrl: tab.favIconUrl || "",
          active: Boolean(tab.active),
          connected: false,
          desiredEnabled: isSiteConfigEnabled(
            siteConfigMapRef.current[formatUrlHost(tab.url || "")],
          ),
          enabled: false,
          groupColor: tabColors[tab.id || 0] || ORCHESTRATION_GROUP_COLORS[0],
        }) satisfies OrchestrationTab,
    );
  };

  async function probeOrchestrationTabConnection(tab: OrchestrationTab) {
    if (!tab.tabId) return false;
    const fallbackFrames = [{ frameId: 0, parentFrameId: -1, url: tab.url || "" }];
    const frames = (await getTabFrames(tab.tabId).catch(() => fallbackFrames)) || fallbackFrames;

    const contexts = await Promise.all(
      (frames.length ? frames : fallbackFrames).map(async (frame) => {
        try {
          const response = await sendTabMessage<any>(
            tab.tabId,
            { type: "GET_PAGE_CONTEXT" },
            { frameId: frame.frameId },
          );
          return response?.success && response.context ? response.context : null;
        } catch (error) {
          const normalized = normalizeMessageError(error);
          if (
            normalized.includes("连接已断开") ||
            normalized.includes("Receiving end") ||
            normalized.includes("message port")
          ) {
            return null;
          }
          return null;
        }
      }),
    );

    return contexts.some(Boolean);
  }

  async function waitForOrchestrationTabConnection(
    tab: OrchestrationTab,
    options: { timeoutMs?: number; intervalMs?: number } = {},
  ) {
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || 8000));
    const intervalMs = Math.max(150, Number(options.intervalMs || 450));
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      if (await probeOrchestrationTabConnection(tab)) {
        return true;
      }
      await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
    }

    return false;
  }

  async function refreshOrchestrationTabRuntimeConfig(tabId: number) {
    if (!tabId) return false;
    try {
      const response = await sendTabMessage<any>(tabId, {
        type: "SYSTEM_INSTRUCTION_REFRESH",
      });
      return response?.success !== false;
    } catch (error) {
      const normalized = normalizeMessageError(error);
      if (
        normalized.includes("连接已断开") ||
        normalized.includes("Receiving end") ||
        normalized.includes("message port")
      ) {
        return false;
      }
      throw error;
    }
  }

  const orchestrationGroupKey = (windowId: number, tabId: number) => `${windowId}:${tabId}`;

  async function syncOrchestrationGroups(
    windowTabs: chrome.tabs.Tab[],
    tabs: OrchestrationTab[],
  ) {
    if (
      typeof chrome.tabs.group !== "function" ||
      typeof chrome.tabs.ungroup !== "function" ||
      !chrome.tabGroups?.get ||
      !chrome.tabGroups?.update
    ) {
      return;
    }

    const windowId = windowTabs[0]?.windowId;
    if (windowId === undefined || windowId === chrome.windows.WINDOW_ID_NONE) return;

    const tabsById = new Map<number, OrchestrationTab>();
    tabs.forEach((tab) => tabsById.set(tab.tabId, tab));

    const managedEntries = Object.entries(orchestrationGroupIdsRef.current).filter(([key]) =>
      key.startsWith(`${windowId}:`),
    );

    for (const [key] of managedEntries) {
      const tabId = Number(key.slice(`${windowId}:`.length));
      if (tabsById.has(tabId)) continue;
      delete orchestrationGroupIdsRef.current[key];
      try {
        await ungroupTabs(tabId);
      } catch {}
    }

    for (const tab of tabs) {
      const key = orchestrationGroupKey(windowId, tab.tabId);
      let groupId = orchestrationGroupIdsRef.current[key];

      if (groupId !== undefined) {
        try {
          const group = await getTabGroup(groupId);
          if (group.windowId !== windowId) {
            delete orchestrationGroupIdsRef.current[key];
            groupId = undefined;
          }
        } catch {
          delete orchestrationGroupIdsRef.current[key];
          groupId = undefined;
        }
      }

      try {
        const nextGroupId = await groupTabs(
          groupId === undefined ? { tabIds: [tab.tabId] } : { tabIds: [tab.tabId], groupId },
        );
        orchestrationGroupIdsRef.current[key] = nextGroupId;
        await updateTabGroup(nextGroupId, {
          title: "",
          color: tab.groupColor,
          collapsed: false,
        });
      } catch {}
    }
  }

  async function refreshOrchestrationTabs(options: { syncGroups?: boolean } = {}) {
    const windowTabs = await queryTabs({ currentWindow: true });
    const nextTabs = await Promise.all(
      buildOrchestrationTabs(windowTabs).map(async (tab) => {
        const connected = await probeOrchestrationTabConnection(tab);
        return {
          ...tab,
          connected,
          enabled: getEffectiveOrchestrationTabEnabled({
            connected,
            desiredEnabled: tab.desiredEnabled,
          }),
        } satisfies OrchestrationTab;
      }),
    );
    setOrchestrationTabs(nextTabs);
    if (options.syncGroups) {
      await syncOrchestrationGroups(
        windowTabs,
        nextTabs.filter((tab) => tab.enabled),
      );
    }
  }

  const persistSiteConfigMap = async (nextConfig: ConfigMap) => {
    const normalized = compactExportConfigMap(normalizeConfigMap(nextConfig));
    siteConfigMapRef.current = normalized;
    setSiteConfigMap(normalized);
    await setStorage("local", { [SITE_CONFIG_MAP_STORAGE_KEY]: normalized });
  };

  const persistHostConfig = async (host: string, config: SiteConfig) => {
    if (!host) return;
    const normalized = compactSiteConfig(config);
    const nextConfig = { ...siteConfigMapRef.current };
    if (hasValidConfigData(normalized)) nextConfig[host] = normalized;
    else delete nextConfig[host];
    await persistSiteConfigMap(nextConfig);
  };

  const setDraftSnapshot = (nextConfig: SiteConfig) => {
    const normalized = normalizeSiteConfig(nextConfig);
    draftRef.current = normalized;
    setDraftConfig(normalized);
    return normalized;
  };

  const resetEditor = (host = "", config: SiteConfig = {}) => {
    setEditorHost(host);
    editorHostRef.current = host;
    editorFrameIdRef.current = resolveFrameIdForHost(host);
    setDraftSnapshot(config);
  };

  const updateDraft = (
    mutator: (config: SiteConfig) => SiteConfig,
    options: { persist?: boolean } = {},
  ) => {
    const previous = normalizeSiteConfig(draftRef.current || {});
    const next = normalizeSiteConfig(mutator(previous));
    setDraftSnapshot(next);
    if (options.persist && editorHostRef.current) {
      void persistHostConfig(editorHostRef.current, next);
    }
    return next;
  };

  const openCurrentEditor = () => {
    if (!currentHost || !currentTab.pageSupported) {
      setActivePane("site");
      setScreen("library");
      showTip("先打开一个支持的聊天网页，再开始配置当前站点。", "cp-tip-err");
      return;
    }

    setActivePane("site");
    setScreen("editor");
    resetEditor(currentHost, siteConfigMap[currentHost] || {});
    setPendingDeleteHost("");
    setTip({ message: "", tone: "" });
  };

  const openHostTab = async (host: string) => {
    const normalizedHost = String(host || "").trim().toLowerCase();
    if (!normalizedHost) {
      showTip("当前站点没有可打开的网址", "cp-tip-err");
      return;
    }

    const isLocalHost =
      normalizedHost === "localhost" ||
      normalizedHost === "127.0.0.1" ||
      normalizedHost === "[::1]";
    const isIpv4Host = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(normalizedHost);
    const looksLikeDomain = normalizedHost.includes(".");
    if (!isLocalHost && !isIpv4Host && !looksLikeDomain) {
      showTip(`站点 ${host} 不是可直接打开的网址`, "cp-tip-err");
      return;
    }

    const url = `${isLocalHost || isIpv4Host ? "http" : "https"}://${normalizedHost}`;
    try {
      await createTab({ url, active: true });
    } catch (error) {
      showTip(getErrorMessage(error), "cp-tip-err");
    }
  };

  const returnToLibrary = async () => {
    setScreen("library");
    resetEditor();
  };

  const prepareCurrentTabReload = async (tabId: number) => {
    refreshingTabIdRef.current = tabId;
    frameContextsRef.current = {};
    currentFrameIdRef.current = 0;
    editorFrameIdRef.current = null;
    setCurrentTab((prev) => (prev.id === tabId ? { ...prev, pageConnected: false } : prev));
    setMonitor({ ready: false, active: false });
    showTip(REFRESHING_TIP_MESSAGE, "");
  };

  const refreshCurrentPage = async () => {
    if (!currentTab.id || !currentTab.pageSupported) {
      showTip("当前没有可刷新的页面", "cp-tip-err");
      return;
    }

    await prepareCurrentTabReload(currentTab.id);
    try {
      await reloadTab(currentTab.id);
    } catch (error) {
      refreshingTabIdRef.current = null;
      showTip(getErrorMessage(error), "cp-tip-err");
    }
  };

  async function loadSettings() {
    const stored = await getStorage<any>("sync", ["enabled", "theme"]);
    setSettings({
      enabled: stored.enabled !== false,
      theme: stored.theme === "light" ? "light" : "dark",
    });
  }

  async function loadSiteConfigMap() {
    const stored = await getStorage<any>("local", [SITE_CONFIG_MAP_STORAGE_KEY]);
    const rawSiteConfigMap = stored[SITE_CONFIG_MAP_STORAGE_KEY] || {};
    const normalizedSiteConfigMap = readStoredSiteConfigMap(stored);

    siteConfigMapRef.current = normalizedSiteConfigMap;
    setSiteConfigMap(normalizedSiteConfigMap);

    if (JSON.stringify(rawSiteConfigMap) !== JSON.stringify(normalizedSiteConfigMap)) {
      await setStorage("local", {
        [SITE_CONFIG_MAP_STORAGE_KEY]: normalizedSiteConfigMap,
      });
    }
  }

  async function requestPageContext(tabId: number, tabHost = "") {
    const fallbackFrames = [{ frameId: 0, parentFrameId: -1, url: "" }];
    const frames = (await getTabFrames(tabId).catch(() => fallbackFrames)) || fallbackFrames;
    frameContextsRef.current = {};

    const contexts = await Promise.all(
      (frames.length ? frames : fallbackFrames).map(async (frame) => {
        try {
          const response = await sendTabMessage<any>(
            tabId,
            { type: "GET_PAGE_CONTEXT" },
            { frameId: frame.frameId },
          );
          if (response?.success && response.context) {
            const context = {
              ...(response.context as PageContext),
              frameId: frame.frameId,
              isTopFrame:
                response.context?.isTopFrame !== undefined
                  ? Boolean(response.context.isTopFrame)
                  : frame.frameId === 0,
            };
            storeFrameContext(frame.frameId, context);
            return context;
          }
        } catch (error) {
          const normalized = normalizeMessageError(error);
          if (
            normalized.includes("连接已断开") ||
            normalized.includes("Receiving end") ||
            normalized.includes("message port")
          ) {
            return null;
          }
          throw error;
        }

        return null;
      }),
    );

    const bestContext =
      chooseBestFrameContext(tabHost, editorHostRef.current || "") || contexts.find(Boolean) || null;

    if (bestContext?.frameId !== undefined) currentFrameIdRef.current = bestContext.frameId;
    return bestContext as PageContext | null;
  }

  const applyContext = (context: PageContext, tabId?: number | null) => {
    const frameId = Number(context?.frameId);
    if (Number.isInteger(frameId) && frameId >= 0) {
      currentFrameIdRef.current = frameId;
      storeFrameContext(frameId, context);
    }

    setCurrentTab((prev) => ({
      ...prev,
      url: context.url || prev.url,
      title: context.title || prev.title,
      host: context.host || prev.host,
      pageSupported: true,
      pageConnected: true,
    }));
    setMonitor({
      ready: Boolean(context.monitorReady),
      active: Boolean(context.monitorActive),
    });
    clearRefreshTip(tabId);
  };

  const getActiveTabSnapshot = async () => {
    const [tab] = await queryTabs({ active: true, lastFocusedWindow: true });
    return {
      id: tab?.id || null,
      url: tab?.url || "",
      title: tab?.title || "",
      host: formatUrlHost(tab?.url || ""),
      pageSupported: Boolean(tab?.id) && isSupportedUrl(tab?.url || ""),
      pageConnected: false,
    } satisfies TabState;
  };

  const refreshActiveTabContext = async () => {
    const nextTab = await getActiveTabSnapshot();
    frameContextsRef.current = {};
    currentFrameIdRef.current = 0;
    editorFrameIdRef.current = null;
    setCurrentTab(nextTab);
    setMonitor({ ready: false, active: false });
    if (!nextTab.pageSupported || !nextTab.id) return;

    try {
      const context = await requestPageContext(nextTab.id, nextTab.host);
      if (context) applyContext(context, nextTab.id);
      else setCurrentTab((prev) => ({ ...prev, pageConnected: false }));
    } catch {
      setCurrentTab((prev) => ({ ...prev, pageConnected: false }));
    }
  };

  const scheduleRefresh = () => {
    if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);

    refreshTimerRef.current = window.setTimeout(() => {
      void refreshActiveTabContext();
      if (activePaneRef.current === "orchestration") {
        void refreshOrchestrationTabs({ syncGroups: true });
      }
    }, 120);
  };

  const updateAdapterScript = (adapterScript: string) =>
    updateDraft(
      (config) => ({
        ...config,
        adapterScript,
      }),
      { persist: true },
    );

  function encodeBase64Utf8(value: string) {
    const bytes = new TextEncoder().encode(String(value || ""));
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  function decodeBase64Utf8(value: string) {
    const normalized = String(value || "").trim();
    if (!normalized) return "";
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function normalizeImportedSiteKey(value: unknown) {
    const raw = String(value || "").trim();
    return formatUrlHost(raw) || raw.toLowerCase();
  }

  function buildSiteExportPayload(host: string, config: SiteConfig) {
    const normalizedHost = normalizeImportedSiteKey(host);
    const normalizedConfig = compactSiteConfig(config);
    const scriptText = String(normalizedConfig.adapterScript || "").trim();
    if (!normalizedHost || !scriptText) return null;

    return {
      version: "3.0",
      exportedAt: new Date().toISOString(),
      site: normalizedHost,
      enabled: normalizedConfig.enabled !== false,
      scriptBase64: encodeBase64Utf8(scriptText),
    };
  }

  function buildAllSitesExportPayload(configMap: ConfigMap) {
    const sites = Object.entries(compactExportConfigMap(configMap))
      .map(([host, config]) => buildSiteExportPayload(host, config))
      .filter(Boolean);

    if (!sites.length) return null;

    return {
      version: "3.0",
      exportedAt: new Date().toISOString(),
      sites,
    };
  }

  function parseImportedSiteEntries(payload: Record<string, unknown>) {
    const entries: Array<{ site: string; enabled: boolean; scriptBase64: string }> = [];

    const pushEntry = (candidate: Record<string, unknown>) => {
      const site = normalizeImportedSiteKey(candidate?.site || candidate?.host);
      const enabled = candidate?.enabled !== false;
      const scriptBase64 = String(
        candidate?.scriptBase64 || candidate?.adapterScriptBase64 || "",
      ).trim();
      if (!site || !scriptBase64) {
        throw new Error("格式错误");
      }
      entries.push({ site, enabled, scriptBase64 });
    };

    if (Array.isArray(payload?.sites)) {
      payload.sites.forEach((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          throw new Error("格式错误");
        }
        pushEntry(item as Record<string, unknown>);
      });
      return entries;
    }

    pushEntry(payload);
    return entries;
  }

  function downloadPayload(filename: string, payloadData: Record<string, unknown>, message: string) {
    if (!payloadData || !Object.keys(payloadData).length) {
      showTip("暂无配置可导出", "cp-tip-err");
      return;
    }

    const payloadText = JSON.stringify(
      payloadData,
      null,
      2,
    );
    const blob = new Blob([payloadText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    showTip(message, "cp-tip-ok");
  }

  const exportAll = () => {
    const payload = buildAllSitesExportPayload(siteConfigMap);
    if (!payload) {
      showTip("暂无配置可导出", "cp-tip-err");
      return;
    }

    downloadPayload(
      `chatplus-config-all-${new Date().toISOString().slice(0, 10)}.json`,
      payload,
      `已导出全部配置，共 ${payload.sites.length} 个站点`,
    );
  };

  const exportHost = (host: string) => {
    if (!host || !hasValidConfigData(siteConfigMap[host])) {
      showTip("当前站点还没有可导出的配置", "cp-tip-err");
      return;
    }

    const payload = buildSiteExportPayload(host, siteConfigMap[host] || {});
    downloadPayload(
      `chatplus-config-${host.replace(/[^\w.-]+/g, "_")}-${new Date().toISOString().slice(0, 10)}.json`,
      payload || {},
      `已导出 ${host} 的配置`,
    );
  };

  async function deleteHost(host: string) {
    if (!host || !siteConfigMap[host]) return;
    const next = { ...siteConfigMap };
    delete next[host];
    await persistSiteConfigMap(next);
    setPendingDeleteHost("");
    showTip(`已删除 ${host} 的配置`, "cp-tip-ok");
  }

  function importConfig(file?: File | null) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed = JSON.parse(String(event.target?.result || ""));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("格式错误");
        }

        const importedEntries = parseImportedSiteEntries(parsed as Record<string, unknown>);
        if (!importedEntries.length) {
          throw new Error("格式错误");
        }

        const { validateSiteAdapterScript } = await import("../lib/siteAdapter");
        const merged = { ...siteConfigMapRef.current };
        importedEntries.forEach(({ site, enabled, scriptBase64 }) => {
          const adapterScript = decodeBase64Utf8(scriptBase64);
          const validation = validateSiteAdapterScript(adapterScript);
          if (!validation.ok) {
            throw new Error(`${site}：${validation.error || "脚本校验失败"}`);
          }
          merged[site] = compactSiteConfig({ enabled, adapterScript });
        });

        await persistSiteConfigMap(merged);
        showTip(
          importedEntries.length === 1
            ? `已导入 ${importedEntries[0].site} 的配置`
            : `已导入 ${importedEntries.length} 个站点的配置`,
          "cp-tip-ok",
        );
      } catch (error) {
        showTip(`导入失败：${getErrorMessage(error)}`, "cp-tip-err");
      } finally {
        if (importInputRef.current) importInputRef.current.value = "";
      }
    };
    reader.readAsText(file);
  }

  const toggleTheme = () => {
    const nextTheme = settings.theme === "light" ? "dark" : "light";
    setSettings((prev) => ({ ...prev, theme: nextTheme }));
    void setStorage("sync", { theme: nextTheme });
  };

  const toggleOrchestrationTab = (tab: OrchestrationTab, enabled: boolean) => {
    void (async () => {
      const host = String(tab.host || "").trim().toLowerCase();
      const currentConfig = normalizeSiteConfig(siteConfigMapRef.current[host] || {});
      if (!host || !hasValidConfigData(currentConfig)) return;

      await persistHostConfig(host, {
        ...currentConfig,
        enabled,
      });

      const affectedTabs = (await queryTabs({})).filter(
        (windowTab) => formatUrlHost(windowTab.url || "") === host && Number(windowTab.id) > 0,
      );

      if (enabled && affectedTabs.length) {
        showTip(`正在恢复 ${host} 的页面连接...`, "");
      }

      for (const affectedTab of affectedTabs) {
        const affectedTabId = Number(affectedTab.id || 0);
        if (!affectedTabId) continue;

        let refreshed = false;
        try {
          refreshed = await refreshOrchestrationTabRuntimeConfig(affectedTabId);
        } catch (error) {
          showTip(getErrorMessage(error), "cp-tip-err");
          continue;
        }

        if (!enabled || refreshed) continue;

        try {
          if (currentTab.id === affectedTabId) {
            await prepareCurrentTabReload(affectedTabId);
          }
          await reloadTab(affectedTabId);
          await waitForOrchestrationTabConnection({
            ...tab,
            tabId: affectedTabId,
            url: affectedTab.url || tab.url,
          });
          await refreshOrchestrationTabRuntimeConfig(affectedTabId);
        } catch (error) {
          showTip(getErrorMessage(error), "cp-tip-err");
        }
      }

      await refreshOrchestrationTabs({ syncGroups: true });
    })();
  };

  const jumpToOrchestrationTab = async (tabId: number) => {
    try {
      await activateTab(tabId);
      scheduleRefresh();
    } catch (error) {
      showTip(getErrorMessage(error), "cp-tip-err");
    }
  };

  const exportFullBackup = async () => {
    const [localState, syncState] = await Promise.all([
      getStorage<Record<string, unknown>>("local", Object.keys(DEFAULT_FULL_BACKUP_LOCAL_STATE)),
      getStorage<Record<string, unknown>>("sync", Object.keys(DEFAULT_FULL_BACKUP_SYNC_STATE)),
    ]);
    const payload = buildFullBackupPayload(localState, syncState);

    downloadPayload(
      getFullBackupFileName(),
      payload,
      `已导出完整配置包，含 ${payload.data.summary.siteCount} 个站点`,
    );
  };

  function importFullBackup(file?: File | null) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed = JSON.parse(String(event.target?.result || ""));
        const restored = parseFullBackupPayload(parsed);

        await Promise.all([
          setStorage("local", {
            ...DEFAULT_FULL_BACKUP_LOCAL_STATE,
            ...restored.local,
          }),
          setStorage("sync", {
            ...DEFAULT_FULL_BACKUP_SYNC_STATE,
            ...restored.sync,
          }),
        ]);

        await Promise.all([
          refreshActiveTabContext(),
          activePaneRef.current === "orchestration"
            ? refreshOrchestrationTabs({ syncGroups: true })
            : Promise.resolve(),
        ]);

        showTip(
          `已恢复完整配置，含 ${restored.summary.siteCount} 个站点 / ${restored.summary.serverCount} 个 MCP 服务`,
          "cp-tip-ok",
        );
      } catch (error) {
        showTip(`导入失败：${getErrorMessage(error)}`, "cp-tip-err");
      } finally {
        if (backupImportInputRef?.current) {
          backupImportInputRef.current.value = "";
        }
      }
    };
    reader.readAsText(file);
  }

  return {
    clearRefreshTip,
    scorePageContext,
    storeFrameContext,
    chooseBestFrameContext,
    resolveFrameIdForHost,
    reconcileOrchestrationTabColors,
    buildOrchestrationTabs,
    syncOrchestrationGroups,
    refreshOrchestrationTabs,
    persistSiteConfigMap,
    persistHostConfig,
    setDraftSnapshot,
    resetEditor,
    updateDraft,
    openCurrentEditor,
    openHostTab,
    returnToLibrary,
    prepareCurrentTabReload,
    refreshCurrentPage,
    loadSettings,
    loadSiteConfigMap,
    requestPageContext,
    applyContext,
    getActiveTabSnapshot,
    refreshActiveTabContext,
    scheduleRefresh,
    updateAdapterScript,
    exportAll,
    exportHost,
    exportFullBackup,
    deleteHost,
    importConfig,
    importFullBackup,
    toggleTheme,
    toggleOrchestrationTab,
    jumpToOrchestrationTab,
  };
}
