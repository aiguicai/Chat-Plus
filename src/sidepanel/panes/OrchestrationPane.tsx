import { LibraryStat } from "../components/common";
import { ClockIcon, PromptIcon, WrenchIcon } from "../components/icons";
import type { OrchestrationTab } from "../types";
import { OrchestrationScheduledSendDialog } from "./orchestration/OrchestrationScheduledSendDialog";
import { OrchestrationSystemDialog } from "./orchestration/OrchestrationSystemDialog";
import { useOrchestrationScheduledSend } from "./orchestration/useOrchestrationScheduledSend";
import { OrchestrationToolsPanel } from "./orchestration/OrchestrationToolsPanel";
import { useOrchestrationSystemInstructions } from "./orchestration/useOrchestrationSystemInstructions";
import { useOrchestrationTools } from "./orchestration/useOrchestrationTools";

export function OrchestrationPane({
  active,
  tabs,
  onToggleTab,
  onSelectTab,
  onOpenToolsPane,
}: {
  active: boolean;
  tabs: OrchestrationTab[];
  onToggleTab: (tab: OrchestrationTab, enabled: boolean) => void;
  onSelectTab: (tabId: number) => void;
  onOpenToolsPane: () => void;
}) {
  const safeTabs = Array.isArray(tabs) ? tabs : [];
  const tools = useOrchestrationTools({ active, tabs: safeTabs });
  const systemInstructions = useOrchestrationSystemInstructions({ active, tabs: safeTabs });
  const scheduledSend = useOrchestrationScheduledSend({ active, tabs: safeTabs });

  const handleSelectOrchestrationTab = (tab: OrchestrationTab) => {
    void systemInstructions.syncResolvedSystemInstructionToTab(tab);
    onSelectTab(tab.tabId);
  };

  const handleOpenSystemDialog = (tab: OrchestrationTab) => {
    tools.closeAddServerPanel();
    scheduledSend.closeScheduleDialog();
    systemInstructions.openSystemDialog(tab);
  };

  const handleOpenScheduleDialog = (tab: OrchestrationTab) => {
    tools.closeAddServerPanel();
    systemInstructions.closeSystemDialog();
    scheduledSend.openScheduleDialog(tab);
  };

  return (
    <div className={`cp-pane${active ? " active" : ""}`}>
      <div className="cp-orch-shell">
        <div className="cp-orch-topbar">
          <LibraryStat label="页面数：" value={safeTabs.length} />
          <LibraryStat label="可用工具：" value={tools.totalToolCount} />
        </div>
        {safeTabs.length ? (
          <div className="cp-card cp-orch-list-card">
            <div className="cp-orch-list">
              {safeTabs.map((tab) => {
                const toolView = tools.getTabToolView(tab);
                const systemView = systemInstructions.resolveSystemForTab(tab);
                const scheduleView = scheduledSend.resolveScheduledSendForTab(tab);
                const selectedSystemPreset = systemView.selectedSystemPreset;
                const desiredEnabled = Boolean(tab.desiredEnabled);
                const statusText = desiredEnabled
                  ? tab.connected
                    ? "此页插件已启用"
                    : "此页插件待连接"
                  : "此页插件已停用";
                const toggleTitle = desiredEnabled
                  ? tab.connected
                    ? "关闭此页插件"
                    : "当前设为启用，等待页面重新连接"
                  : tab.connected
                    ? "启用此页插件"
                    : "启用此页插件并自动刷新页面";
                const titleText = tab.title || tab.url || "未命名标签页";
                const titleWithStatus =
                  desiredEnabled && tab.connected ? titleText : `${titleText} · ${statusText}`;

                return (
                  <div
                    key={tab.tabId}
                    className={`cp-orch-row-shell${toolView.isToolsOpen ? " is-tools-open" : ""}`}
                  >
                    <div
                      className={`cp-orch-row${tab.active ? " is-active" : ""}${desiredEnabled ? " is-enabled" : ""}${tab.connected ? " is-connected" : " is-awaiting-connection"}`}
                      data-group-color={tab.groupColor}
                      role="button"
                      tabIndex={0}
                      aria-current={tab.active ? "page" : undefined}
                      aria-label={`${tab.host}，${statusText}${tab.active ? "，当前页" : ""}`}
                      onClick={() => handleSelectOrchestrationTab(tab)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        handleSelectOrchestrationTab(tab);
                      }}
                    >
                      <div className="cp-orch-row-index">
                        {tab.favIconUrl ? (
                          <img
                            className="cp-orch-row-index-icon"
                            src={tab.favIconUrl}
                            alt=""
                            aria-hidden="true"
                            draggable={false}
                            onError={(event) => {
                              event.currentTarget.style.display = "none";
                            }}
                          />
                        ) : null}
                        <span className="cp-orch-row-index-text">{tab.order}</span>
                      </div>
                      <div className="cp-orch-row-main">
                        <div className="cp-orch-row-host" title={tab.host}>
                          {tab.host}
                        </div>
                        <div className="cp-orch-row-title" title={titleWithStatus}>
                          {titleWithStatus}
                        </div>
                      </div>
                      <div
                        className="cp-orch-row-actions"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          className={`cp-orch-system-trigger${systemView.hasSystemInstruction ? " is-active" : ""}${systemView.isSystemOpen ? " is-open" : ""}`}
                          aria-expanded={systemView.isSystemOpen}
                          aria-controls={`cp-orch-system-dialog-${tab.tabId}`}
                          aria-haspopup="dialog"
                          aria-label={
                            systemView.hasSystemInstruction
                              ? `${tab.host} 已关联系统指令：${selectedSystemPreset?.name || ""}`
                              : `${tab.host} 选择系统指令`
                          }
                          onClick={() => handleOpenSystemDialog(tab)}
                        >
                          <PromptIcon />
                          {systemView.hasSystemInstruction ? (
                            <span className="cp-orch-system-trigger-dot" aria-hidden="true"></span>
                          ) : null}
                        </button>
                        <button
                          type="button"
                          className={`cp-orch-schedule-trigger${scheduleView.isScheduledSendEnabled ? " is-active" : ""}${scheduleView.isScheduleOpen ? " is-open" : ""}${scheduleView.isScheduledSendEnabled ? " is-enabled" : ""}`}
                          aria-expanded={scheduleView.isScheduleOpen}
                          aria-haspopup="dialog"
                          aria-label={
                            scheduleView.isScheduledSendEnabled
                              ? `${tab.host} 定时发送已启用，${scheduleView.summary}`
                              : scheduleView.hasScheduledSend
                                ? `${tab.host} 已保存定时发送配置，当前未启用`
                                : `${tab.host} 配置定时发送`
                          }
                          onClick={() => handleOpenScheduleDialog(tab)}
                        >
                          <ClockIcon />
                          {scheduleView.isScheduledSendEnabled ? (
                            <span className="cp-orch-schedule-trigger-dot" aria-hidden="true"></span>
                          ) : null}
                        </button>
                        <button
                          type="button"
                          className={`cp-orch-tools-trigger${toolView.hasEnabledTools ? " is-active" : ""}${toolView.isToolsOpen ? " is-open" : ""}`}
                          aria-expanded={toolView.isToolsOpen}
                          aria-controls={`cp-orch-tools-panel-${tab.tabId}`}
                          aria-label={
                            toolView.hasEnabledTools
                              ? `${tab.host} 工具，已启用 ${toolView.enabledToolCount} 个`
                              : `${tab.host} 配置工具`
                          }
                          onClick={() => tools.toggleToolsPanel(tab.tabId)}
                        >
                          <WrenchIcon />
                          {toolView.hasEnabledTools ? (
                            <span className="cp-orch-tools-trigger-dot" aria-hidden="true"></span>
                          ) : null}
                        </button>
                        <div className="cp-orch-row-toggle">
                          <label
                            className="cp-orch-row-toggle-wrap"
                            title={toggleTitle}
                          >
                            <span className="cp-toggle">
                              <input
                                type="checkbox"
                                aria-label={`${tab.host}${statusText}`}
                                checked={desiredEnabled}
                                onChange={(event) => onToggleTab(tab, event.target.checked)}
                              />
                              <span className="cp-toggle-slider"></span>
                            </span>
                          </label>
                        </div>
                      </div>
                    </div>
                    {toolView.isToolsOpen ? (
                      <OrchestrationToolsPanel
                        tab={tab}
                        toolView={toolView}
                        mcpConfig={tools.mcpConfig}
                        discoveryByServer={tools.discoveryByServer}
                        totalToolCount={tools.totalToolCount}
                        loadingTools={tools.loadingTools}
                        toolsError={tools.toolsError}
                        expandedServerKeys={tools.expandedServerKeys}
                        onOpenToolsPane={onOpenToolsPane}
                        onToggleAddServerPanel={tools.toggleAddServerPanel}
                        onAddServerToTab={tools.addServerToTab}
                        onRemoveServerFromTab={tools.removeServerFromTab}
                        onToggleServerExpanded={tools.toggleServerExpanded}
                        onToggleTabServerToolSelection={tools.toggleTabServerToolSelection}
                        onToggleTabToolEnabled={tools.toggleTabToolEnabled}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="cp-card cp-empty-state">当前窗口没有命中完整站点配置的标签页。</div>
        )}
        <OrchestrationSystemDialog
          openSystemTab={systemInstructions.openSystemTab}
          openSystemResolution={systemInstructions.openSystemResolution}
          systemDialogMode={systemInstructions.systemDialogMode}
          systemPresetStore={systemInstructions.systemPresetStore}
          systemInstructionError={systemInstructions.systemInstructionError}
          pendingDeletePresetId={systemInstructions.pendingDeletePresetId}
          presetNameDraft={systemInstructions.presetNameDraft}
          presetContentDraft={systemInstructions.presetContentDraft}
          presetFormError={systemInstructions.presetFormError}
          savingSystemInstruction={systemInstructions.savingSystemInstruction}
          onClose={systemInstructions.closeSystemDialog}
          onStartCreatePreset={systemInstructions.startCreatePreset}
          onStartEditPreset={systemInstructions.startEditPreset}
          onCancelPresetForm={systemInstructions.cancelPresetForm}
          onSavePresetDraft={() => {
            void systemInstructions.savePresetDraftForTab();
          }}
          onTogglePresetForTab={(tab, presetId) => {
            void systemInstructions.togglePresetForTab(tab, presetId);
          }}
          onDeletePreset={(presetId) => {
            void systemInstructions.deletePreset(presetId);
          }}
          onSetPendingDeletePresetId={systemInstructions.setPendingDeletePresetId}
          onSetPresetNameDraft={systemInstructions.setPresetNameDraft}
          onSetPresetContentDraft={systemInstructions.setPresetContentDraft}
        />
        <OrchestrationScheduledSendDialog
          openScheduleTab={scheduledSend.openScheduleTab}
          scheduleEnabledDraft={scheduledSend.scheduleEnabledDraft}
          scheduleStartTimeDraft={scheduledSend.scheduleStartTimeDraft}
          scheduleEndTimeDraft={scheduledSend.scheduleEndTimeDraft}
          scheduleIntervalDraft={scheduledSend.scheduleIntervalDraft}
          scheduleContentDraft={scheduledSend.scheduleContentDraft}
          scheduleError={scheduledSend.scheduleError}
          onClose={scheduledSend.closeScheduleDialog}
          onSetScheduleEnabledDraft={scheduledSend.setScheduleEnabledDraft}
          onSetScheduleStartTimeDraft={scheduledSend.setScheduleStartTimeDraft}
          onSetScheduleEndTimeDraft={scheduledSend.setScheduleEndTimeDraft}
          onSetScheduleIntervalDraft={scheduledSend.setScheduleIntervalDraft}
          onSetScheduleContentDraft={scheduledSend.setScheduleContentDraft}
        />
      </div>
    </div>
  );
}
