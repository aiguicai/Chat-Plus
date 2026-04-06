import { Btn, ToolbarIconButton } from "../../components/common";
import {
  CancelIcon,
  ChevronRightIcon,
  DeleteIcon,
  PlusIcon,
} from "../../components/icons";
import type { OrchestrationTab } from "../../types";
import {
  buildToolSelectionLabel,
  getToolSelectionState,
  type ToolSelectionState,
} from "../tools-pane/shared";
import type { McpConfigStore, McpDiscoveryMap } from "../../../mcp/shared";
import type { OrchestrationToolView } from "./useOrchestrationTools";
import { buildTabServerKey } from "./shared";

type OrchestrationToolsPanelProps = {
  tab: OrchestrationTab;
  toolView: OrchestrationToolView;
  mcpConfig: McpConfigStore;
  discoveryByServer: McpDiscoveryMap;
  totalToolCount: number;
  loadingTools: boolean;
  toolsError: string;
  expandedServerKeys: Record<string, boolean>;
  onOpenToolsPane: () => void;
  onToggleAddServerPanel: (tabId: number) => void;
  onAddServerToTab: (tabId: number, serverId: string) => void;
  onRemoveServerFromTab: (tabId: number, serverId: string) => void;
  onToggleServerExpanded: (tabId: number, serverId: string) => void;
  onToggleTabServerToolSelection: (
    tabId: number,
    serverId: string,
    toolNames: string[],
    selectionState: ToolSelectionState,
  ) => void;
  onToggleTabToolEnabled: (
    tabId: number,
    serverId: string,
    toolName: string,
    checked: boolean,
  ) => void;
};

export function OrchestrationToolsPanel({
  tab,
  toolView,
  mcpConfig,
  discoveryByServer,
  totalToolCount,
  loadingTools,
  toolsError,
  expandedServerKeys,
  onOpenToolsPane,
  onToggleAddServerPanel,
  onAddServerToTab,
  onRemoveServerFromTab,
  onToggleServerExpanded,
  onToggleTabServerToolSelection,
  onToggleTabToolEnabled,
}: OrchestrationToolsPanelProps) {
  return (
    <div
      className="cp-orch-tools-panel"
      id={`cp-orch-tools-panel-${tab.tabId}`}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {toolsError ? (
        <div className="cp-selector-empty cp-orch-tools-empty is-danger">{toolsError}</div>
      ) : loadingTools && !mcpConfig.servers.length ? (
        <div className="cp-selector-empty cp-orch-tools-empty">正在加载工具...</div>
      ) : !mcpConfig.servers.length ? (
        <div className="cp-orch-tools-empty-card">
          <div className="cp-selector-empty cp-orch-tools-empty">
            先去工具页配置 MCP 服务，标签页工具才能单独添加。
          </div>
          <Btn tone="secondary" onClick={onOpenToolsPane}>
            去工具页
          </Btn>
        </div>
      ) : totalToolCount === 0 ? (
        <div className="cp-orch-tools-empty-card">
          <div className="cp-selector-empty cp-orch-tools-empty">
            还没有拉取到可选工具。先去工具页刷新，再回来给标签页添加。
          </div>
          <Btn tone="secondary" onClick={onOpenToolsPane}>
            去刷新
          </Btn>
        </div>
      ) : (
        <>
          <div className="cp-orch-tools-toolbar">
            <button
              type="button"
              className={`cp-orch-tools-add-trigger${toolView.isAddServerOpen ? " is-open" : ""}`}
              aria-expanded={toolView.isAddServerOpen}
              aria-controls={`cp-orch-tools-add-dialog-${tab.tabId}`}
              aria-label="添加工具源"
              onClick={() => onToggleAddServerPanel(tab.tabId)}
            >
              <PlusIcon />
            </button>
            <div className="cp-orch-tools-toolbar-hint">
              {toolView.addedServers.length
                ? `已添加 ${toolView.addedServers.length} 个工具源，展开后勾选具体工具。`
                : "先添加工具源，再勾选这个标签页真正要用的工具。"}
            </div>
          </div>
          {toolView.isAddServerOpen ? (
            <div className="cp-orch-tools-add-dialog-wrap">
              <div
                className="cp-orch-tools-add-backdrop"
                aria-hidden="true"
                onClick={() => onToggleAddServerPanel(tab.tabId)}
              ></div>
              <div
                className="cp-orch-tools-add-dialog"
                id={`cp-orch-tools-add-dialog-${tab.tabId}`}
                role="dialog"
                aria-modal="false"
                aria-label="选择工具源"
              >
                <div className="cp-orch-tools-add-dialog-head">
                  <div className="cp-orch-tools-add-dialog-title">选择工具源</div>
                  <button
                    type="button"
                    className="cp-orch-tools-add-close"
                    aria-label="关闭工具源选择"
                    onClick={() => onToggleAddServerPanel(tab.tabId)}
                  >
                    <CancelIcon />
                  </button>
                </div>
                <div className="cp-orch-tools-add-list">
                  {mcpConfig.servers.length ? (
                    mcpConfig.servers.map((server) => {
                      const tools = Array.isArray(server.tools) ? server.tools : [];
                      const isAdded = toolView.addedServerIds.includes(server.id);
                      const canUse = server.enabled !== false && tools.length > 0;
                      return (
                        <div
                          key={`${tab.tabId}/add/${server.id}`}
                          className={`cp-orch-tools-add-item${canUse ? "" : " is-disabled"}${isAdded ? " is-selected" : ""}`}
                        >
                          <div className="cp-orch-tools-add-item-copy">
                            <div className="cp-orch-tools-add-item-name" title={server.name}>
                              {server.name}
                            </div>
                            <div className="cp-orch-tools-add-item-count">
                              {server.enabled === false ? "停用" : `${tools.length} 个工具`}
                            </div>
                          </div>
                          <div className="cp-orch-tools-add-item-actions">
                            <button
                              type="button"
                              className={`cp-orch-tools-add-toggle${isAdded ? " is-checked" : ""}`}
                              disabled={!canUse}
                              aria-label={isAdded ? `取消选择 ${server.name}` : `选择 ${server.name}`}
                              aria-pressed={isAdded}
                              onClick={() =>
                                isAdded
                                  ? onRemoveServerFromTab(tab.tabId, server.id)
                                  : onAddServerToTab(tab.tabId, server.id)
                              }
                            >
                              <span className="cp-orch-tools-add-toggle-box" aria-hidden="true">
                                {isAdded ? "✓" : ""}
                              </span>
                            </button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="cp-selector-empty cp-orch-tools-empty">没有可选工具源。</div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
          {toolView.addedServers.length ? (
            <div className="cp-orch-tools-server-list">
              {toolView.addedServers.map((server) => {
                const meta = discoveryByServer[server.id];
                const tools = Array.isArray(server.tools) ? server.tools : [];
                const enabledToolNames = Array.isArray(toolView.tabSelection[server.id])
                  ? toolView.tabSelection[server.id]
                  : [];
                const enabledServerToolCount = enabledToolNames.length;
                const selectionState = getToolSelectionState(enabledServerToolCount, tools.length);
                const serverKey = buildTabServerKey(tab.tabId, server.id);
                const isServerExpanded = expandedServerKeys[serverKey] === true;

                return (
                  <div
                    key={`${tab.tabId}/${server.id}`}
                    className={`cp-orch-tools-server${isServerExpanded ? " is-expanded" : ""}`}
                  >
                    <div className="cp-orch-tools-server-head">
                      <div className="cp-orch-tools-server-main">
                        <button
                          type="button"
                          className={`cp-tools-collapse-btn${isServerExpanded ? " is-expanded" : ""}`}
                          aria-label={`${isServerExpanded ? "收起" : "展开"} ${server.name}`}
                          aria-expanded={isServerExpanded}
                          onClick={() => onToggleServerExpanded(tab.tabId, server.id)}
                        >
                          <ChevronRightIcon />
                        </button>
                        <label
                          className={`cp-orch-tools-server-check${server.enabled === false || tools.length === 0 ? " is-disabled" : ""}`}
                        >
                          <input
                            className="cp-orch-tools-server-check-input"
                            type="checkbox"
                            checked={selectionState === "checked"}
                            disabled={server.enabled === false || tools.length === 0}
                            ref={(element) => {
                              if (element) {
                                element.indeterminate = selectionState === "indeterminate";
                              }
                            }}
                            aria-label={
                              selectionState === "checked"
                                ? `取消全选 ${server.name}`
                                : selectionState === "indeterminate"
                                  ? `清空已选 ${server.name}`
                                  : `全选 ${server.name}`
                            }
                            onChange={() =>
                              onToggleTabServerToolSelection(
                                tab.tabId,
                                server.id,
                                tools.map((tool) => tool.name),
                                selectionState,
                              )
                            }
                          />
                          <span
                            className="cp-orch-tools-server-check-box"
                            aria-hidden="true"
                          ></span>
                        </label>
                        <div className="cp-orch-tools-server-title">{server.name}</div>
                        <span className="cp-orch-tools-server-badge">
                          {buildToolSelectionLabel(enabledServerToolCount, tools.length)}
                        </span>
                      </div>
                      <div className="cp-orch-tools-server-actions">
                        <ToolbarIconButton
                          label={`移除 ${server.name}`}
                          className="cp-toolbar-icon-sm cp-orch-tools-remove-btn"
                          onClick={() => onRemoveServerFromTab(tab.tabId, server.id)}
                        >
                          <DeleteIcon />
                        </ToolbarIconButton>
                      </div>
                    </div>
                    {isServerExpanded ? (
                      tools.length ? (
                        <div className="cp-orch-tools-tool-list">
                          {tools.map((tool) => {
                            const isToolEnabled = enabledToolNames.includes(tool.name);
                            return (
                              <div
                                key={`${tab.tabId}/${server.id}/${tool.name}`}
                                className={`cp-orch-tools-tool-row${isToolEnabled ? " is-enabled" : ""}`}
                              >
                                <label className="cp-tools-tool-checkbox-wrap">
                                  <input
                                    className="cp-tools-tool-checkbox-input"
                                    type="checkbox"
                                    checked={isToolEnabled}
                                    disabled={server.enabled === false}
                                    onChange={(event) =>
                                      onToggleTabToolEnabled(
                                        tab.tabId,
                                        server.id,
                                        tool.name,
                                        event.target.checked,
                                      )
                                    }
                                  />
                                  <span className="cp-tools-tool-checkbox" aria-hidden="true"></span>
                                </label>
                                <div className="cp-orch-tools-tool-copy">
                                  <div className="cp-orch-tools-tool-name">{tool.name}</div>
                                  <div className="cp-orch-tools-tool-desc">
                                    {tool.description || "无描述"}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div
                          className={`cp-selector-empty cp-tools-tool-empty${meta?.ok === false ? " is-danger" : ""}`}
                        >
                          {server.enabled === false
                            ? "该服务当前已停用，不参与工具选择。"
                            : meta?.ok === false
                              ? meta.error || "拉取失败"
                              : meta?.fetchedAt
                                ? "该服务当前没有返回工具。"
                                : "该服务尚未拉取工具，请先到工具页刷新。"}
                        </div>
                      )
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="cp-orch-tools-empty-card">
              <div className="cp-selector-empty cp-orch-tools-empty">
                先点上面的“添加工具”，把当前标签页真正要用的工具源加进来。
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
