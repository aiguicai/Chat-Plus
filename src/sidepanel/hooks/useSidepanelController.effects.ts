import { useEffect } from "react";

import {
  SITE_CONFIG_MAP_STORAGE_KEY,
  compactExportConfigMap,
  normalizeConfigMap,
} from "../lib/siteConfig";

type PageContext = Record<string, any>;

export function useSidepanelControllerEffects(ctx: any) {
  const {
    hosts,
    pendingDeleteHost,
    tip,
    activePane,
    orchestrationStateReady,
    screen,
    currentHost,
    currentTab,
    siteConfigMap,
    setOrchestrationStateReady,
    setPendingDeleteHost,
    setTip,
    setSettings,
    setSiteConfigMap,
    setScreen,
    siteConfigMapRef,
    refreshTimerRef,
    activePaneRef,
    draftRef,
    editorHostRef,
    editorFrameIdRef,
    currentFrameIdRef,
    frameContextsRef,
    loadSettings,
    loadSiteConfigMap,
    refreshActiveTabContext,
    refreshOrchestrationTabs,
    scheduleRefresh,
    resetEditor,
    showTip,
    storeFrameContext,
    chooseBestFrameContext,
    applyContext,
  } = ctx;

  useEffect(() => {
    void (async () => {
      await Promise.all([
        loadSettings(),
        loadSiteConfigMap(),
        refreshActiveTabContext(),
      ]);
      setOrchestrationStateReady(true);
    })();

    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (pendingDeleteHost && !hosts.includes(pendingDeleteHost)) {
      setPendingDeleteHost("");
    }
  }, [hosts, pendingDeleteHost]);

  useEffect(() => {
    if (!tip.tone) return undefined;
    const timerId = window.setTimeout(() => setTip({ message: "", tone: "" }), 3600);
    return () => window.clearTimeout(timerId);
  }, [tip]);

  useEffect(() => {
    activePaneRef.current = activePane;
  }, [activePane]);

  useEffect(() => {
    if (!orchestrationStateReady || activePane !== "orchestration") return;
    void refreshOrchestrationTabs({ syncGroups: true });
  }, [activePane, siteConfigMap, orchestrationStateReady]);

  useEffect(() => {
    function handleStorageChange(changes: any, namespace: string) {
      if (namespace === "sync") {
        setSettings((prev) => ({
          enabled: changes.enabled ? changes.enabled.newValue !== false : prev.enabled,
          theme: changes.theme
            ? changes.theme.newValue === "light"
              ? "light"
              : "dark"
            : prev.theme,
        }));
        return;
      }

      if (namespace === "local") {
        const rawSiteConfigMap = changes[SITE_CONFIG_MAP_STORAGE_KEY]?.newValue;

        if (rawSiteConfigMap !== undefined) {
          const normalized = compactExportConfigMap(
            normalizeConfigMap(rawSiteConfigMap || {}),
          );
          siteConfigMapRef.current = normalized;
          setSiteConfigMap(normalized);
          return;
        }
      }

    }

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  useEffect(() => {
    draftRef.current = ctx.draft;
  }, [ctx.draft]);

  useEffect(() => {
    editorHostRef.current = ctx.editorHost;
  }, [ctx.editorHost]);

  useEffect(() => {
    siteConfigMapRef.current = siteConfigMap;
  }, [siteConfigMap]);

  useEffect(() => {
    if (screen !== "editor") return;

    if (!currentTab.pageSupported || !currentHost) {
      setScreen("library");
      resetEditor();
      return;
    }

    if (!ctx.editorHost || ctx.editorHost === currentHost) return;

    resetEditor(currentHost, siteConfigMap[currentHost] || {});
    showTip(`已切换到 ${currentHost}`, "");
  }, [screen, currentHost, currentTab.pageSupported, ctx.editorHost]);

  useEffect(() => {
    function handleRuntimeMessage(
      message: any,
      sender: chrome.runtime.MessageSender,
    ) {
      const senderTabId = sender.tab?.id;
      const senderFrameId =
        typeof sender.frameId === "number" && sender.frameId >= 0 ? sender.frameId : 0;
      const isCurrentTabMessage = Boolean(senderTabId && currentTab.id && senderTabId === currentTab.id);

      if (message.type === "CHATPLUS_CONTENT_READY" && message.context) {
        if (!isCurrentTabMessage) {
          if (activePaneRef.current === "orchestration") {
            void refreshOrchestrationTabs({ syncGroups: true });
          }
          return;
        }
        const nextContext: PageContext = {
          ...message.context,
          frameId: senderFrameId,
          isTopFrame:
            message.context?.isTopFrame !== undefined
              ? Boolean(message.context.isTopFrame)
              : senderFrameId === 0,
        };
        storeFrameContext(senderFrameId, nextContext);
        const bestContext =
          chooseBestFrameContext(
            String(currentTab.host || ""),
            editorHostRef.current || currentHost || "",
          ) || nextContext;
        applyContext(bestContext, senderTabId);
        if (activePaneRef.current === "orchestration") {
          void refreshOrchestrationTabs({ syncGroups: true });
        }
        return;
      }

      if (message.type === "CHATPLUS_MONITOR_READY") {
        if (!isCurrentTabMessage) {
          if (activePaneRef.current === "orchestration") {
            void refreshOrchestrationTabs({ syncGroups: true });
          }
          return;
        }
        ctx.setMonitor((prev: any) => ({ ...prev, ready: true }));
        if (activePaneRef.current === "orchestration") {
          void refreshOrchestrationTabs({ syncGroups: true });
        }
        return;
      }

      if (message.type === "CHATPLUS_MONITOR_STATE") {
        if (!isCurrentTabMessage) {
          if (activePaneRef.current === "orchestration") {
            void refreshOrchestrationTabs({ syncGroups: true });
          }
          return;
        }
        if (message.active) {
          currentFrameIdRef.current = senderFrameId;
          editorFrameIdRef.current = senderFrameId;
        }
        ctx.setMonitor((prev: any) => ({
          ...prev,
          ready: true,
          active: Boolean(message.active),
        }));
        if (activePaneRef.current === "orchestration") {
          void refreshOrchestrationTabs({ syncGroups: true });
        }
      }
    }

    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    return () => chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
  }, [currentHost, currentTab.id, currentTab.host]);

  useEffect(() => {
    function handleActivated() {
      scheduleRefresh();
    }
    function handleCreated() {
      scheduleRefresh();
    }
    function handleRemoved() {
      scheduleRefresh();
    }
    function handleMoved() {
      scheduleRefresh();
    }
    function handleAttached() {
      scheduleRefresh();
    }
    function handleDetached() {
      scheduleRefresh();
    }
    function handleUpdated(tabId: number, changeInfo: any) {
      const affectsCurrentTab = tabId === currentTab.id;
      const affectsOrchestration =
        activePaneRef.current === "orchestration" &&
        Boolean(changeInfo.status || changeInfo.url || changeInfo.title);
      if (!affectsCurrentTab && !affectsOrchestration) return;
      scheduleRefresh();
    }
    function handleWindowFocusChanged(windowId: number) {
      if (windowId === chrome.windows.WINDOW_ID_NONE) return;
      scheduleRefresh();
    }

    chrome.tabs.onActivated.addListener(handleActivated);
    chrome.tabs.onCreated.addListener(handleCreated);
    chrome.tabs.onRemoved.addListener(handleRemoved);
    chrome.tabs.onMoved.addListener(handleMoved);
    chrome.tabs.onAttached.addListener(handleAttached);
    chrome.tabs.onDetached.addListener(handleDetached);
    chrome.tabs.onUpdated.addListener(handleUpdated);
    if (chrome.windows?.onFocusChanged) {
      chrome.windows.onFocusChanged.addListener(handleWindowFocusChanged);
    }

    return () => {
      chrome.tabs.onActivated.removeListener(handleActivated);
      chrome.tabs.onCreated.removeListener(handleCreated);
      chrome.tabs.onRemoved.removeListener(handleRemoved);
      chrome.tabs.onMoved.removeListener(handleMoved);
      chrome.tabs.onAttached.removeListener(handleAttached);
      chrome.tabs.onDetached.removeListener(handleDetached);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      if (chrome.windows?.onFocusChanged) {
        chrome.windows.onFocusChanged.removeListener(handleWindowFocusChanged);
      }
    };
  }, [currentTab.id]);
}
