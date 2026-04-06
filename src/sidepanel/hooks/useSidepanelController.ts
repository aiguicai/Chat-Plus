import { useRef, useState } from "react";

import {
  DEFAULT_MONITOR,
  DEFAULT_SETTINGS,
  DEFAULT_TAB,
  DEFAULT_TIP,
} from "../constants";
import {
  getSelectableHosts,
  hasValidConfigData,
  normalizeSiteConfig,
} from "../lib/siteConfig";
import type {
  ConfigMap,
  MonitorState,
  OrchestrationColor,
  OrchestrationTab,
  Pane,
  Settings,
  SiteConfig,
  TabState,
  TipState,
} from "../types";
import { useSidepanelControllerEffects } from "./useSidepanelController.effects";
import { createSidepanelControllerRuntime } from "./useSidepanelController.runtime";

type PageContext = {
  url?: string;
  title?: string;
  host?: string;
  frameId?: number;
  isTopFrame?: boolean;
  monitorReady?: boolean;
  monitorActive?: boolean;
};

const REFRESHING_TIP_MESSAGE = "正在刷新当前页面...";
const ORCHESTRATION_DISABLED_STORAGE_KEY = "orchestrationDisabledTabIds";
const ORCHESTRATION_GROUP_COLORS: OrchestrationColor[] = [
  "blue",
  "orange",
  "green",
  "pink",
  "cyan",
  "red",
  "purple",
  "yellow",
];

export function useSidepanelController() {
  const [activePane, setActivePane] = useState<Pane>("orchestration");
  const [screen, setScreen] = useState<"library" | "editor">("library");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [siteConfigMap, setSiteConfigMap] = useState<ConfigMap>({});
  const [editorHost, setEditorHost] = useState("");
  const [draftConfig, setDraftConfig] = useState<SiteConfig>({});
  const [currentTab, setCurrentTab] = useState<TabState>(DEFAULT_TAB);
  const [monitor, setMonitor] = useState<MonitorState>(DEFAULT_MONITOR);
  const [tip, setTip] = useState<TipState>(DEFAULT_TIP);
  const [pendingDeleteHost, setPendingDeleteHost] = useState("");
  const [orchestrationTabs, setOrchestrationTabs] = useState<OrchestrationTab[]>([]);
  const [disabledOrchestrationTabIds, setDisabledOrchestrationTabIds] = useState<number[]>([]);
  const [orchestrationStateReady, setOrchestrationStateReady] = useState(false);

  const importInputRef = useRef<HTMLInputElement | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const refreshingTabIdRef = useRef<number | null>(null);
  const siteConfigMapRef = useRef<ConfigMap>({});
  const orchestrationTabColorsRef = useRef<Record<number, OrchestrationColor>>({});
  const orchestrationGroupIdsRef = useRef<Record<string, number>>({});
  const disabledOrchestrationTabIdsRef = useRef<number[]>([]);
  const activePaneRef = useRef<Pane>("orchestration");
  const draftRef = useRef<SiteConfig>({});
  const editorHostRef = useRef("");
  const frameContextsRef = useRef<Record<number, PageContext>>({});
  const currentFrameIdRef = useRef(0);
  const editorFrameIdRef = useRef<number | null>(null);
  const extensionIconUrl = chrome.runtime.getURL("icons/icon48.png");

  const currentHost = currentTab.host;
  const hosts = getSelectableHosts(siteConfigMap, currentHost);
  const hasSavedSites = Object.keys(siteConfigMap).some((host) =>
    hasValidConfigData(siteConfigMap[host]),
  );

  const draft = normalizeSiteConfig(draftConfig || {});
  const editingCurrentHost = Boolean(editorHost && editorHost === currentHost);

  const showTip = (message: string, tone: TipState["tone"] = "") =>
    setTip({ message, tone });

  const ctx = {
    REFRESHING_TIP_MESSAGE,
    ORCHESTRATION_DISABLED_STORAGE_KEY,
    ORCHESTRATION_GROUP_COLORS,
    activePane,
    screen,
    settings,
    siteConfigMap,
    editorHost,
    draftConfig,
    currentTab,
    monitor,
    tip,
    pendingDeleteHost,
    orchestrationTabs,
    disabledOrchestrationTabIds,
    orchestrationStateReady,
    importInputRef,
    refreshTimerRef,
    refreshingTabIdRef,
    siteConfigMapRef,
    orchestrationTabColorsRef,
    orchestrationGroupIdsRef,
    disabledOrchestrationTabIdsRef,
    activePaneRef,
    draftRef,
    editorHostRef,
    frameContextsRef,
    currentFrameIdRef,
    editorFrameIdRef,
    extensionIconUrl,
    currentHost,
    hosts,
    draft,
    hasSavedSites,
    editingCurrentHost,
    showTip,
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
    setDisabledOrchestrationTabIds,
    setOrchestrationStateReady,
  };

  const runtime = createSidepanelControllerRuntime(ctx);
  useSidepanelControllerEffects({
    ...ctx,
    ...runtime,
  });

  const settingsTip = tip.message || "编辑当前站点的 JS 协议脚本。";

  return {
    activePane,
    screen,
    settings,
    tip,
    currentTab,
    currentHost,
    siteConfigMap,
    orchestrationTabs,
    hosts,
    pendingDeleteHost,
    editorHost,
    draft,
    monitor,
    extensionIconUrl,
    settingsTip,
    hasSavedSites,
    importInputRef,
    setActivePane,
    setPendingDeleteHost,
    toggleTheme: runtime.toggleTheme,
    toggleOrchestrationTab: runtime.toggleOrchestrationTab,
    jumpToOrchestrationTab: runtime.jumpToOrchestrationTab,
    openCurrentEditor: runtime.openCurrentEditor,
    openHostTab: runtime.openHostTab,
    refreshCurrentPage: runtime.refreshCurrentPage,
    returnToLibrary: runtime.returnToLibrary,
    updateAdapterScript: runtime.updateAdapterScript,
    exportAll: runtime.exportAll,
    exportHost: runtime.exportHost,
    deleteHost: runtime.deleteHost,
    importConfig: runtime.importConfig,
  };
}
