import {
  DragDropContext,
  Draggable,
  Droppable,
  type DraggableProvided,
  type DropResult,
} from "@hello-pangea/dnd";

import { Btn, ToolbarIconButton } from "../../components/common";
import { CancelIcon, ChevronRightIcon, ConfirmIcon, DeleteIcon } from "../../components/icons";
import { resolveSortableMove } from "./useSortableCards";
import {
  MCP_TRANSPORT_SSE,
  MCP_TRANSPORT_STREAMABLE_HTTP,
  normalizeTransport,
  toSafeString,
} from "../../../mcp/shared";
import {
  type ConfigMode,
  type McpServerDraft,
  REQUEST_HEADERS_PLACEHOLDER_TEXT,
  SINGLE_SERVER_JSON_DEFAULT_TEXT,
  getVisualDraftMissingFields,
  resolveDraftServerId,
} from "./shared";

type ToolsConfigViewProps = {
  drafts: McpServerDraft[];
  saving: boolean;
  discoveringAll: boolean;
  pendingDeleteLocalId: string;
  collapsedByServerId: Record<string, boolean>;
  collapsedDraftsByLocalId: Record<string, boolean>;
  addServerDraft: () => void;
  updateDraft: (
    localId: string,
    patch: Partial<Omit<McpServerDraft, "localId">>,
  ) => void;
  switchDraftMode: (localId: string, nextMode: ConfigMode) => void;
  toggleDraftCollapsed: (draft: McpServerDraft, index: number) => void;
  removeServerDraft: (localId: string) => void;
  setPendingDeleteLocalId: (localId: string) => void;
  moveDraftToIndex: (localId: string, targetIndex: number) => void;
};

type SortableDraftCardProps = {
  draft: McpServerDraft;
  index: number;
  saving: boolean;
  discoveringAll: boolean;
  pendingDeleteLocalId: string;
  collapsedByServerId: Record<string, boolean>;
  collapsedDraftsByLocalId: Record<string, boolean>;
  updateDraft: (
    localId: string,
    patch: Partial<Omit<McpServerDraft, "localId">>,
  ) => void;
  switchDraftMode: (localId: string, nextMode: ConfigMode) => void;
  toggleDraftCollapsed: (draft: McpServerDraft, index: number) => void;
  removeServerDraft: (localId: string) => void;
  setPendingDeleteLocalId: (localId: string) => void;
  draggableProvided: DraggableProvided;
  isDragging: boolean;
};

function SortableDraftCard({
  draft,
  index,
  saving,
  discoveringAll,
  pendingDeleteLocalId,
  collapsedByServerId,
  collapsedDraftsByLocalId,
  updateDraft,
  switchDraftMode,
  toggleDraftCollapsed,
  removeServerDraft,
  setPendingDeleteLocalId,
  draggableProvided,
  isDragging,
}: SortableDraftCardProps) {
  const serverId = resolveDraftServerId(draft, index);
  const isCollapsed = serverId
    ? collapsedByServerId[serverId] === true
    : collapsedDraftsByLocalId[draft.localId] === true;
  const isDeleteConfirming = pendingDeleteLocalId === draft.localId;
  const missingVisualFields =
    draft.mode === "visual" ? getVisualDraftMissingFields(draft, index) : [];
  const isNameMissing = draft.mode === "visual" && missingVisualFields.includes("服务名称");
  const isTypeMissing = draft.mode === "visual" && missingVisualFields.includes("连接方式");
  const isUrlMissing = draft.mode === "visual" && missingVisualFields.includes("远程地址");

  return (
    <div
      ref={draggableProvided.innerRef}
      style={draggableProvided.draggableProps.style}
      className={`cp-card cp-tools-server-form cp-tools-draggable-card${isCollapsed ? " is-collapsed" : ""}${isDragging ? " is-dragging" : ""}`}
      {...draggableProvided.draggableProps}
      {...draggableProvided.dragHandleProps}
    >
      <div className="cp-tools-server-head cp-tools-server-head-config">
        <div className="cp-tools-server-head-top">
          <div className="cp-tools-server-meta">
            <div className="cp-section-label">Server {index + 1}</div>
            <label
              className="cp-tools-enable-toggle"
              title={draft.enabled ? "已启用服务" : "已停用服务"}
              data-no-drag="true"
            >
              <span className="cp-toggle">
                <input
                  type="checkbox"
                  aria-label={`${draft.name || `服务 ${index + 1}`}${draft.enabled ? "已启用" : "已停用"}`}
                  checked={draft.enabled}
                  onChange={(event) =>
                    updateDraft(draft.localId, {
                      enabled: event.target.checked,
                    })
                  }
                />
                <span className="cp-toggle-slider"></span>
              </span>
            </label>
          </div>
          <div className="cp-tools-server-head-actions cp-tools-server-head-actions-config">
            <div className="cp-tools-delete-wrap" data-no-drag="true">
              {isDeleteConfirming ? (
                <div
                  className="cp-tools-delete-popover"
                  role="alertdialog"
                  aria-label="确认删除服务"
                >
                  <span className="cp-tools-delete-popover-text">确认删除？</span>
                  <ToolbarIconButton
                    label={`确认删除服务 ${index + 1}`}
                    className="cp-toolbar-icon-sm cp-toolbar-icon-danger"
                    disabled={saving || discoveringAll}
                    onClick={() => removeServerDraft(draft.localId)}
                  >
                    <ConfirmIcon />
                  </ToolbarIconButton>
                  <ToolbarIconButton
                    label={`取消删除服务 ${index + 1}`}
                    className="cp-toolbar-icon-sm"
                    disabled={saving || discoveringAll}
                    onClick={() => setPendingDeleteLocalId("")}
                  >
                    <CancelIcon />
                  </ToolbarIconButton>
                </div>
              ) : null}

              <ToolbarIconButton
                label={`删除服务 ${index + 1}`}
                className="cp-toolbar-icon-sm cp-toolbar-icon-danger"
                disabled={saving || discoveringAll}
                onClick={() =>
                  setPendingDeleteLocalId(
                    pendingDeleteLocalId === draft.localId ? "" : draft.localId,
                  )
                }
              >
                <DeleteIcon />
              </ToolbarIconButton>
            </div>
          </div>
        </div>
        <div className="cp-tools-server-title-row">
          <div className="cp-tools-server-title-main">
            <button
              type="button"
              className={`cp-tools-collapse-btn${isCollapsed ? "" : " is-expanded"}`}
              aria-label={`${isCollapsed ? "展开" : "收起"} ${draft.name || `服务 ${index + 1}`}`}
              aria-expanded={!isCollapsed}
              data-no-drag="true"
              onClick={() => toggleDraftCollapsed(draft, index)}
            >
              <ChevronRightIcon />
            </button>
            <div className="cp-tools-server-title-badge-row">
              <div className="cp-library-summary-title">
                {toSafeString(draft.name) || toSafeString(draft.id) || `MCP ${index + 1}`}
              </div>
            </div>
          </div>
          <div className="cp-tools-server-title-actions" data-no-drag="true">
            <div className="cp-tools-segmented is-compact" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={draft.mode === "visual"}
                className={`cp-tools-segment${draft.mode === "visual" ? " is-active" : ""}`}
                onClick={() => switchDraftMode(draft.localId, "visual")}
              >
                可视化
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={draft.mode === "json"}
                className={`cp-tools-segment${draft.mode === "json" ? " is-active" : ""}`}
                onClick={() => switchDraftMode(draft.localId, "json")}
              >
                JSON
              </button>
            </div>
          </div>
        </div>
      </div>

      {!isCollapsed && draft.mode === "visual" ? (
        <div className="cp-tools-form-grid" data-no-drag="true">
          <label className={`cp-tools-field${isNameMissing ? " is-invalid" : ""}`}>
            <span className="cp-inline-label cp-tools-required-label">
              服务名称
              <span className="cp-tools-required-mark">*</span>
            </span>
            <input
              className={`cp-tools-input${isNameMissing ? " is-invalid" : ""}`}
              type="text"
              value={draft.name}
              placeholder="filesystem"
              onChange={(event) =>
                updateDraft(draft.localId, { name: event.target.value })
              }
            />
          </label>

          <label className={`cp-tools-field${isTypeMissing ? " is-invalid" : ""}`}>
            <span className="cp-inline-label cp-tools-required-label">
              连接方式
              <span className="cp-tools-required-mark">*</span>
            </span>
            <select
              className={`cp-tools-select${isTypeMissing ? " is-invalid" : ""}`}
              value={draft.type}
              onChange={(event) =>
                updateDraft(draft.localId, {
                  type: normalizeTransport(event.target.value, draft.url),
                })
              }
            >
              <option value={MCP_TRANSPORT_STREAMABLE_HTTP}>HTTP Stream</option>
              <option value={MCP_TRANSPORT_SSE}>SSE</option>
            </select>
          </label>

          <label
            className={`cp-tools-field cp-tools-field-wide${
              isUrlMissing ? " is-invalid" : ""
            }`}
          >
            <span className="cp-inline-label cp-tools-required-label">
              远程地址
              <span className="cp-tools-required-mark">*</span>
            </span>
            <input
              className={`cp-tools-input${isUrlMissing ? " is-invalid" : ""}`}
              type="url"
              value={draft.url}
              placeholder={
                draft.type === MCP_TRANSPORT_SSE
                  ? "https://example.com/sse"
                  : "https://example.com/mcp"
              }
              onChange={(event) =>
                updateDraft(draft.localId, { url: event.target.value })
              }
            />
          </label>

          <label className="cp-tools-field cp-tools-field-wide">
            <span className="cp-inline-label">请求头 JSON</span>
            <textarea
              className="cp-tools-textarea"
              value={draft.headersText}
              placeholder={REQUEST_HEADERS_PLACEHOLDER_TEXT}
              rows={5}
              spellCheck={false}
              onChange={(event) =>
                updateDraft(draft.localId, {
                  headersText: event.target.value,
                })
              }
            />
          </label>

          {missingVisualFields.length ? (
            <div className="cp-tools-required-note">
              未填写必填项：{missingVisualFields.join("、")}，暂不自动保存。
            </div>
          ) : null}
        </div>
      ) : null}

      {!isCollapsed && draft.mode === "json" ? (
        <textarea
          className="cp-tools-json-textarea"
          value={draft.jsonText}
          placeholder={SINGLE_SERVER_JSON_DEFAULT_TEXT}
          rows={6}
          spellCheck={false}
          data-no-drag="true"
          onChange={(event) =>
            updateDraft(draft.localId, {
              jsonText: event.target.value,
            })
          }
        />
      ) : null}
    </div>
  );
}

export function ToolsConfigView({
  drafts,
  saving,
  discoveringAll,
  pendingDeleteLocalId,
  collapsedByServerId,
  collapsedDraftsByLocalId,
  addServerDraft,
  updateDraft,
  switchDraftMode,
  toggleDraftCollapsed,
  removeServerDraft,
  setPendingDeleteLocalId,
  moveDraftToIndex,
}: ToolsConfigViewProps) {
  if (!drafts.length) {
    return (
      <div className="cp-tools-view">
        <div className="cp-card cp-empty-state cp-tools-empty-card">
          <div className="cp-tools-empty-copy">
            <div className="cp-library-summary-title">还没有服务</div>
            <div className="cp-library-detail-desc">
              新增一个远程 MCP 服务，配置会自动保存。
            </div>
          </div>
          <Btn tone="secondary" onClick={addServerDraft}>
            新增服务
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
          moveDraftToIndex(move.activeId, move.targetIndex);
        }
      }}
    >
      <Droppable droppableId="cp-tools-config-list">
        {(droppableProvided) => (
          <div
            ref={droppableProvided.innerRef}
            className="cp-tools-view"
            {...droppableProvided.droppableProps}
          >
            {drafts.map((draft, index) => (
              <Draggable key={draft.localId} draggableId={draft.localId} index={index}>
                {(draggableProvided, snapshot) => (
                  <SortableDraftCard
                    draft={draft}
                    index={index}
                    saving={saving}
                    discoveringAll={discoveringAll}
                    pendingDeleteLocalId={pendingDeleteLocalId}
                    collapsedByServerId={collapsedByServerId}
                    collapsedDraftsByLocalId={collapsedDraftsByLocalId}
                    updateDraft={updateDraft}
                    switchDraftMode={switchDraftMode}
                    toggleDraftCollapsed={toggleDraftCollapsed}
                    removeServerDraft={removeServerDraft}
                    setPendingDeleteLocalId={setPendingDeleteLocalId}
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
