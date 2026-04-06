import type { MutableRefObject } from "react";

import {
  DragDropContext,
  Draggable,
  Droppable,
  type DraggableProvided,
  type DropResult,
} from "@hello-pangea/dnd";

import { Btn, StatusPill, ToolbarIconButton } from "../../components/common";
import { ChevronRightIcon, RefreshIcon } from "../../components/icons";
import { formatRelative } from "../../lib/format";
import { resolveSortableMove } from "./useSortableCards";
import type { McpConfigStore, McpDiscoveryMap } from "../../../mcp/shared";
import { describeTransport } from "./shared";

type ToolsCatalogViewProps = {
  config: McpConfigStore;
  discoveryByServer: McpDiscoveryMap;
  collapsedByServerId: Record<string, boolean>;
  loading: boolean;
  saving: boolean;
  discoveringAll: boolean;
  discoveringServerId: string;
  expandableToolKeys: Record<string, boolean>;
  expandedToolKeys: Record<string, boolean>;
  toolDescRefs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  refreshServerTools: (serverId: string) => void;
  toggleServerCollapsed: (serverId: string) => void;
  toggleToolDescriptionExpanded: (toolKey: string) => void;
  goToConfig: () => void;
  moveServerToIndex: (serverId: string, targetIndex: number) => void;
};

type SortableServerCardProps = {
  server: McpConfigStore["servers"][number];
  index: number;
  meta: McpDiscoveryMap[string] | undefined;
  collapsedByServerId: Record<string, boolean>;
  loading: boolean;
  saving: boolean;
  discoveringAll: boolean;
  discoveringServerId: string;
  expandableToolKeys: Record<string, boolean>;
  expandedToolKeys: Record<string, boolean>;
  toolDescRefs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  refreshServerTools: (serverId: string) => void;
  toggleServerCollapsed: (serverId: string) => void;
  toggleToolDescriptionExpanded: (toolKey: string) => void;
  draggableProvided: DraggableProvided;
  isDragging: boolean;
};

function SortableServerCard({
  server,
  meta,
  collapsedByServerId,
  loading,
  saving,
  discoveringAll,
  discoveringServerId,
  expandableToolKeys,
  expandedToolKeys,
  toolDescRefs,
  refreshServerTools,
  toggleServerCollapsed,
  toggleToolDescriptionExpanded,
  draggableProvided,
  isDragging,
}: SortableServerCardProps) {
  const tools = Array.isArray(server.tools) ? server.tools : [];
  const totalToolCount = tools.length;
  const statusTone =
    server.enabled === false
      ? "neutral"
      : meta?.ok === false
        ? "danger"
        : totalToolCount > 0
          ? "success"
          : "neutral";
  const isRefreshing = discoveringServerId === server.id;
  const isCollapsed = collapsedByServerId[server.id] === true;
  const statusLabel =
    server.enabled === false
      ? "停用"
      : meta?.ok === false
        ? "拉取失败"
        : meta?.fetchedAt && totalToolCount === 0
          ? "暂无工具"
          : !meta?.fetchedAt
            ? "未拉取"
            : "";

  return (
    <div
      ref={draggableProvided.innerRef}
      style={draggableProvided.draggableProps.style}
      className={`cp-card cp-tools-server-card cp-tools-draggable-card${isCollapsed ? " is-collapsed" : ""}${isDragging ? " is-dragging" : ""}`}
      {...draggableProvided.draggableProps}
      {...draggableProvided.dragHandleProps}
    >
      <div className="cp-tools-server-head cp-tools-server-head-config">
        <div className="cp-tools-server-head-top">
          <div className="cp-tools-server-meta">
            <div className="cp-section-label">{describeTransport(server.type)}</div>
          </div>
          <div className="cp-tools-server-head-actions" data-no-drag="true">
            {statusLabel ? <StatusPill tone={statusTone}>{statusLabel}</StatusPill> : null}
            <ToolbarIconButton
              label={`刷新 ${server.name}`}
              className="cp-toolbar-icon-sm"
              disabled={
                loading ||
                saving ||
                discoveringAll ||
                isRefreshing ||
                server.enabled === false
              }
              onClick={() => refreshServerTools(server.id)}
            >
              <RefreshIcon />
            </ToolbarIconButton>
          </div>
        </div>
        <div className="cp-tools-server-title-row">
          <div className="cp-tools-server-title-main">
            <button
              type="button"
              className={`cp-tools-collapse-btn${isCollapsed ? "" : " is-expanded"}`}
              aria-label={`${isCollapsed ? "展开" : "收起"} ${server.name}`}
              aria-expanded={!isCollapsed}
              data-no-drag="true"
              onClick={() => toggleServerCollapsed(server.id)}
            >
              <ChevronRightIcon />
            </button>
            <div className="cp-home-copy">
              <div className="cp-tools-server-title-badge-row">
                <div className="cp-library-summary-title">{server.name}</div>
                <span className="cp-tools-server-tool-count" aria-label={`${totalToolCount} 个工具`}>
                  {totalToolCount}
                </span>
              </div>
              <div className="cp-meta-text">{server.url}</div>
            </div>
          </div>
        </div>
      </div>

      {!isCollapsed && tools.length ? (
        <div className="cp-tools-tool-list">
          {tools.map((tool) => {
            const toolKey = `${server.id}/${tool.name}`;
            const isExpanded = expandedToolKeys[toolKey] === true;
            const isExpandable = expandableToolKeys[toolKey] === true;

            return (
              <div key={toolKey} className="cp-tools-tool-row cp-tools-tool-row-readonly">
                <div className="cp-tools-tool-copy">
                  <div className="cp-tools-tool-name">{tool.name}</div>
                  <div
                    ref={(element) => {
                      toolDescRefs.current[toolKey] = element;
                    }}
                    className={`cp-tools-tool-desc${isExpanded ? " is-expanded" : ""}`}
                  >
                    {tool.description || "无描述"}
                  </div>
                  {isExpandable ? (
                    <button
                      type="button"
                      className="cp-tools-tool-expand"
                      data-no-drag="true"
                      onClick={() => toggleToolDescriptionExpanded(toolKey)}
                    >
                      {isExpanded ? "△ 收起" : "▽ 展开"}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : !isCollapsed ? (
        <div
          className={`cp-selector-empty cp-tools-tool-empty${meta?.ok === false ? " is-danger" : ""}`}
        >
          {server.enabled === false
            ? "该服务当前已停用，不参与工具拉取。"
            : meta?.ok === false
              ? meta.error || "拉取失败"
              : meta?.fetchedAt
                ? "该服务当前没有返回工具。"
                : "点击上方刷新以拉取工具目录。"}
        </div>
      ) : null}

      {meta?.fetchedAt ? (
        <div className="cp-meta-text">最近同步：{formatRelative(meta.fetchedAt)}</div>
      ) : null}
    </div>
  );
}

export function ToolsCatalogView({
  config,
  discoveryByServer,
  collapsedByServerId,
  loading,
  saving,
  discoveringAll,
  discoveringServerId,
  expandableToolKeys,
  expandedToolKeys,
  toolDescRefs,
  refreshServerTools,
  toggleServerCollapsed,
  toggleToolDescriptionExpanded,
  goToConfig,
  moveServerToIndex,
}: ToolsCatalogViewProps) {
  if (!config.servers.length) {
    return (
      <div className="cp-tools-view">
        <div className="cp-card cp-empty-state cp-tools-empty-card">
          <div className="cp-tools-empty-copy">
            <div className="cp-library-summary-title">没有工具</div>
            <div className="cp-library-detail-desc">
              先去配置远程 MCP 服务，再回到这里刷新工具目录。具体启用已经移到编排页。
            </div>
          </div>
          <Btn tone="secondary" onClick={goToConfig}>
            去配置
          </Btn>
        </div>
      </div>
    );
  }

  return (
    <DragDropContext
      onDragEnd={(result: DropResult) => {
        const move = resolveSortableMove(result);
        if (move) {
          moveServerToIndex(move.activeId, move.targetIndex);
        }
      }}
    >
      <Droppable droppableId="cp-tools-catalog-list">
        {(droppableProvided) => (
          <div
            ref={droppableProvided.innerRef}
            className="cp-tools-view"
            {...droppableProvided.droppableProps}
          >
            {config.servers.map((server, index) => (
              <Draggable key={server.id} draggableId={server.id} index={index}>
                {(draggableProvided, snapshot) => (
                  <SortableServerCard
                    server={server}
                    index={index}
                    meta={discoveryByServer[server.id]}
                    collapsedByServerId={collapsedByServerId}
                    loading={loading}
                    saving={saving}
                    discoveringAll={discoveringAll}
                    discoveringServerId={discoveringServerId}
                    expandableToolKeys={expandableToolKeys}
                    expandedToolKeys={expandedToolKeys}
                    toolDescRefs={toolDescRefs}
                    refreshServerTools={refreshServerTools}
                    toggleServerCollapsed={toggleServerCollapsed}
                    toggleToolDescriptionExpanded={toggleToolDescriptionExpanded}
                    draggableProvided={draggableProvided}
                    isDragging={snapshot.isDragging}
                  />
                )}
              </Draggable>
            ))}
            {droppableProvided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}
