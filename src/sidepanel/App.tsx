import { Suspense, lazy, useEffect, useRef, useState } from "react";

import { TabButton } from "./components/common";
import {
  BackupTransferIcon,
  ExportAllIcon,
  ImportIcon,
  MoonIcon,
  SunIcon,
} from "./components/icons";
import { useSidepanelController } from "./hooks/useSidepanelController";
import { OrchestrationPane } from "./panes/OrchestrationPane";
import { getExtensionVersion } from "../shared/extensionMeta";

const LazyAboutPane = lazy(async () => {
  const module = await import("./panes/AboutPane");
  return { default: module.AboutPane };
});

const LazyToolsPane = lazy(async () => {
  const module = await import("./panes/ToolsPane");
  return { default: module.ToolsPane };
});

const LazyEditorScreen = lazy(async () => {
  const module = await import("./screens/EditorScreen");
  return { default: module.EditorScreen };
});

const LazyLibraryScreen = lazy(async () => {
  const module = await import("./screens/LibraryScreen");
  return { default: module.LibraryScreen };
});

function PaneFallback({ active }: { active: boolean }) {
  return (
    <div className={`cp-pane${active ? " active" : ""}`}>
      <div className="cp-card cp-empty-state">正在加载...</div>
    </div>
  );
}

export default function App() {
  const controller = useSidepanelController();
  const extensionVersion = getExtensionVersion();
  const safeOrchestrationTabs = Array.isArray(controller.orchestrationTabs)
    ? controller.orchestrationTabs
    : [];
  const safeHosts = Array.isArray(controller.hosts) ? controller.hosts : [];
  const [backupMenuOpen, setBackupMenuOpen] = useState(false);
  const backupMenuRef = useRef<HTMLDivElement | null>(null);
  const [loadedPanes, setLoadedPanes] = useState({
    site: controller.activePane === "site",
    tools: controller.activePane === "tools",
    about: controller.activePane === "about",
  });

  useEffect(() => {
    setLoadedPanes((prev) => ({
      site: prev.site || controller.activePane === "site",
      tools: prev.tools || controller.activePane === "tools",
      about: prev.about || controller.activePane === "about",
    }));
  }, [controller.activePane]);

  useEffect(() => {
    if (!backupMenuOpen) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      if (backupMenuRef.current?.contains(event.target as Node)) return;
      setBackupMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setBackupMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [backupMenuOpen]);

  return (
    <div
      id="chat-plus-root"
      className={controller.settings.theme === "light" ? "light-mode" : ""}
    >
      <div id="cp-panel" className="open">
        <div className="cp-header">
          <div className="cp-brand">
            <div className="cp-logo">
              <img
                src={controller.extensionIconUrl}
                alt="Chat Plus"
                className="cp-logo-img"
              />
            </div>
            <div className="cp-brand-meta">
              <div className="cp-title">Chat Plus</div>
              <div className="cp-version">
                Make your ai chat smarter
              </div>
            </div>
          </div>
          <div className="cp-header-actions">
            <div
              ref={backupMenuRef}
              className={`cp-header-action-menu${backupMenuOpen ? " is-open" : ""}`}
            >
              <button
                className="cp-icon-btn"
                type="button"
                aria-label="展开完整备份与恢复操作"
                title="完整备份与恢复"
                aria-haspopup="menu"
                aria-expanded={backupMenuOpen}
                onClick={() => setBackupMenuOpen((open) => !open)}
              >
                <BackupTransferIcon />
              </button>
              {backupMenuOpen ? (
                <div className="cp-header-action-popover" role="menu" aria-label="完整备份操作">
                  <button
                    className="cp-header-action-item"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setBackupMenuOpen(false);
                      void controller.exportFullBackup();
                    }}
                  >
                    <ExportAllIcon />
                    <span>备份</span>
                  </button>
                  <button
                    className="cp-header-action-item"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setBackupMenuOpen(false);
                      controller.backupImportInputRef.current?.click();
                    }}
                  >
                    <ImportIcon />
                    <span>导入</span>
                  </button>
                </div>
              ) : null}
            </div>
            <button
              className="cp-icon-btn"
              type="button"
              onClick={controller.toggleTheme}
            >
              {controller.settings.theme === "light" ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
        </div>
        <div className="cp-tabs" role="tablist" aria-label="侧边栏主导航">
          <TabButton
            active={controller.activePane === "orchestration"}
            onClick={() => controller.setActivePane("orchestration")}
          >
            编排
          </TabButton>
          <TabButton
            active={controller.activePane === "site"}
            onClick={() => controller.setActivePane("site")}
          >
            站点
          </TabButton>
          <TabButton
            active={controller.activePane === "tools"}
            onClick={() => controller.setActivePane("tools")}
          >
            工具
          </TabButton>
          <TabButton
            active={controller.activePane === "about"}
            onClick={() => controller.setActivePane("about")}
          >
            关于
          </TabButton>
        </div>
        <div className="cp-body">
          <OrchestrationPane
            active={controller.activePane === "orchestration"}
            tabs={safeOrchestrationTabs}
            onToggleTab={controller.toggleOrchestrationTab}
            onSelectTab={(tabId) => {
              void controller.jumpToOrchestrationTab(tabId);
            }}
            onOpenToolsPane={() => controller.setActivePane("tools")}
          />
          <div
            className={`cp-pane${controller.activePane === "site" ? " active" : ""}`}
          >
            {loadedPanes.site ? (
              <Suspense fallback={<PaneFallback active={controller.activePane === "site"} />}>
                {controller.screen === "library" ? (
                  <LazyLibraryScreen
                    currentHost={controller.currentHost}
                    hasSavedSites={controller.hasSavedSites}
                    hosts={safeHosts}
                    siteConfigMap={controller.siteConfigMap}
                    pendingDeleteHost={controller.pendingDeleteHost}
                    canEditCurrentHost={Boolean(
                      controller.currentHost && controller.currentTab.pageSupported,
                    )}
                    importInputRef={controller.importInputRef}
                    onEditCurrentHost={controller.openCurrentEditor}
                    onOpenHost={(host) => {
                      void controller.openHostTab(host);
                    }}
                    onExportAll={controller.exportAll}
                    onExportHost={controller.exportHost}
                    onImportClick={() => controller.importInputRef.current?.click()}
                    onImportConfig={controller.importConfig}
                    onArmDelete={controller.setPendingDeleteHost}
                    onDeleteHost={(host) => {
                      void controller.deleteHost(host);
                    }}
                    onCancelDelete={() => controller.setPendingDeleteHost("")}
                  />
                ) : (
                  <LazyEditorScreen
                    editorHost={controller.editorHost}
                    canRefreshPage={Boolean(
                      controller.currentTab.id && controller.currentTab.pageSupported,
                    )}
                    draft={controller.draft}
                    tipMessage={controller.settingsTip}
                    tipTone={controller.tip.tone}
                    onRefreshPage={() => {
                      void controller.refreshCurrentPage();
                    }}
                    onReturnToLibrary={() => {
                      void controller.returnToLibrary();
                    }}
                    onUpdateAdapterScript={controller.updateAdapterScript}
                  />
                )}
              </Suspense>
            ) : null}
          </div>
          {loadedPanes.tools ? (
            <Suspense fallback={<PaneFallback active={controller.activePane === "tools"} />}>
              <LazyToolsPane active={controller.activePane === "tools"} />
            </Suspense>
          ) : null}
          {loadedPanes.about ? (
            <Suspense fallback={<PaneFallback active={controller.activePane === "about"} />}>
              <LazyAboutPane active={controller.activePane === "about"} />
            </Suspense>
          ) : null}
        </div>
        <div className="cp-footer">
          <span>{`Chat Plus v${extensionVersion}`}</span>
          <span
            className={`cp-status${controller.settings.enabled ? "" : " is-disabled"}`}
          >
            <span className="cp-dot"></span>
            {controller.settings.enabled ? "已启用" : "已暂停"}
          </span>
        </div>
        <input
          ref={controller.backupImportInputRef}
          type="file"
          accept=".json"
          hidden
          onChange={(event) => controller.importFullBackup(event.target.files?.[0])}
        />
      </div>
    </div>
  );
}
