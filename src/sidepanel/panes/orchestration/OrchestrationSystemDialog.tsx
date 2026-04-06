import { Btn, ToolbarIconButton } from "../../components/common";
import {
  CancelIcon,
  ConfirmIcon,
  EditIcon,
  PlusIcon,
} from "../../components/icons";
import type { OrchestrationTab } from "../../types";
import type { SystemInstructionPresetStore } from "../../../system-instructions/shared";
import { previewSystemInstructionContent } from "./shared";

type OrchestrationSystemDialogProps = {
  openSystemTab: OrchestrationTab | null;
  openSystemResolution: {
    presetId: string;
    preset: { id: string; name: string; content: string } | null;
  };
  systemDialogMode: "select" | "create" | "edit";
  systemPresetStore: SystemInstructionPresetStore;
  systemInstructionError: string;
  pendingDeletePresetId: string;
  presetNameDraft: string;
  presetContentDraft: string;
  presetFormError: string;
  savingSystemInstruction: boolean;
  onClose: () => void;
  onStartCreatePreset: () => void;
  onStartEditPreset: (presetId: string) => void;
  onCancelPresetForm: () => void;
  onSavePresetDraft: () => void;
  onTogglePresetForTab: (tab: OrchestrationTab, presetId: string) => void;
  onDeletePreset: (presetId: string) => void;
  onSetPendingDeletePresetId: (value: string | ((currentId: string) => string)) => void;
  onSetPresetNameDraft: (value: string) => void;
  onSetPresetContentDraft: (value: string) => void;
};

export function OrchestrationSystemDialog({
  openSystemTab,
  openSystemResolution,
  systemDialogMode,
  systemPresetStore,
  systemInstructionError,
  pendingDeletePresetId,
  presetNameDraft,
  presetContentDraft,
  presetFormError,
  savingSystemInstruction,
  onClose,
  onStartCreatePreset,
  onStartEditPreset,
  onCancelPresetForm,
  onSavePresetDraft,
  onTogglePresetForTab,
  onDeletePreset,
  onSetPendingDeletePresetId,
  onSetPresetNameDraft,
  onSetPresetContentDraft,
}: OrchestrationSystemDialogProps) {
  if (!openSystemTab) return null;
  const presets = Array.isArray(systemPresetStore?.presets) ? systemPresetStore.presets : [];

  return (
    <div className="cp-orch-system-dialog-wrap">
      <div className="cp-orch-system-backdrop" aria-hidden="true" onClick={onClose}></div>
      <div
        className="cp-orch-system-dialog"
        id={`cp-orch-system-dialog-${openSystemTab.tabId}`}
        role="dialog"
        aria-modal="true"
        aria-label={`${openSystemTab.host} 系统指令`}
      >
        <div className="cp-orch-system-dialog-head">
          <div className="cp-orch-system-dialog-title-wrap">
            <div className="cp-orch-system-dialog-title">
              {systemDialogMode === "create"
                ? "新增预设"
                : systemDialogMode === "edit"
                  ? "编辑预设"
                  : "系统指令"}
            </div>
            <div className="cp-orch-system-dialog-host">{openSystemTab.host}</div>
          </div>
          <div className="cp-orch-system-dialog-head-actions">
            {systemDialogMode === "select" ? (
              <button
                type="button"
                className="cp-orch-system-add-btn"
                aria-label="新增系统指令预设"
                onClick={onStartCreatePreset}
                disabled={savingSystemInstruction}
              >
                <PlusIcon />
                <span>新增预设</span>
              </button>
            ) : null}
            <button
              type="button"
              className="cp-orch-system-close"
              aria-label="关闭系统指令设置"
              onClick={onClose}
              disabled={savingSystemInstruction}
            >
              <CancelIcon />
            </button>
          </div>
        </div>
        {systemDialogMode !== "select" ? (
          <>
            <label className="cp-orch-system-field">
              <span className="cp-orch-system-label">预设名称</span>
              <input
                className="cp-orch-system-input"
                type="text"
                value={presetNameDraft}
                placeholder="例如：客服助手"
                onChange={(event) => onSetPresetNameDraft(event.target.value)}
              />
            </label>
            <label className="cp-orch-system-field">
              <span className="cp-orch-system-label">系统指令</span>
              <textarea
                className="cp-orch-system-textarea"
                rows={9}
                value={presetContentDraft}
                placeholder="输入这条预设的系统指令内容"
                onChange={(event) => onSetPresetContentDraft(event.target.value)}
              />
            </label>
            {presetFormError ? (
              <div className="cp-selector-empty cp-orch-system-error is-danger">
                {presetFormError}
              </div>
            ) : null}
            <div className="cp-orch-system-actions">
              <Btn tone="secondary" disabled={savingSystemInstruction} onClick={onCancelPresetForm}>
                取消
              </Btn>
              <Btn tone="primary" disabled={savingSystemInstruction} onClick={onSavePresetDraft}>
                {savingSystemInstruction ? "保存中..." : "保存"}
              </Btn>
            </div>
          </>
        ) : (
          <>
            {systemInstructionError ? (
              <div className="cp-selector-empty cp-orch-system-error is-danger">
                {systemInstructionError}
              </div>
            ) : null}
            {presets.length ? (
              <>
                <div className="cp-orch-system-selection-note">
                  单选模式：当前页面一次只能启用一个系统预设
                </div>
                <div className="cp-orch-system-list">
                  {presets.map((preset) => {
                    const isSelected = openSystemResolution.presetId === preset.id;
                    const isDeleteConfirming = pendingDeletePresetId === preset.id;
                    return (
                      <div
                        key={preset.id}
                        className={`cp-orch-system-option${isSelected ? " is-selected" : ""}`}
                      >
                        <div className="cp-orch-system-option-actions">
                          <button
                            type="button"
                            className="cp-orch-system-option-icon"
                            aria-label={`编辑 ${preset.name}`}
                            disabled={savingSystemInstruction}
                            onClick={() => onStartEditPreset(preset.id)}
                          >
                            <EditIcon />
                          </button>
                          <div className="cp-orch-system-delete-wrap">
                            {isDeleteConfirming ? (
                              <div
                                className="cp-orch-system-delete-popover"
                                role="alertdialog"
                                aria-label={`确认删除 ${preset.name}`}
                              >
                                <span className="cp-orch-system-delete-popover-text">
                                  确认删除？
                                </span>
                                <ToolbarIconButton
                                  label={`确认删除 ${preset.name}`}
                                  className="cp-toolbar-icon-sm cp-toolbar-icon-danger"
                                  disabled={savingSystemInstruction}
                                  onClick={() => onDeletePreset(preset.id)}
                                >
                                  <ConfirmIcon />
                                </ToolbarIconButton>
                                <ToolbarIconButton
                                  label={`取消删除 ${preset.name}`}
                                  className="cp-toolbar-icon-sm"
                                  disabled={savingSystemInstruction}
                                  onClick={() => onSetPendingDeletePresetId("")}
                                >
                                  <CancelIcon />
                                </ToolbarIconButton>
                              </div>
                            ) : null}
                            <button
                              type="button"
                              className="cp-orch-system-option-icon is-danger is-close"
                              aria-label={`删除 ${preset.name}`}
                              aria-pressed={isDeleteConfirming}
                              disabled={savingSystemInstruction}
                              onClick={() =>
                                onSetPendingDeletePresetId((currentId) =>
                                  currentId === preset.id ? "" : preset.id,
                                )
                              }
                            >
                              <CancelIcon />
                            </button>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="cp-orch-system-option-trigger"
                          aria-label={isSelected ? `取消 ${preset.name}` : `选择 ${preset.name}`}
                          aria-pressed={isSelected}
                          disabled={savingSystemInstruction}
                          onClick={() => onTogglePresetForTab(openSystemTab, preset.id)}
                        >
                          <span
                            className={`cp-orch-system-option-mark${isSelected ? " is-selected" : ""}`}
                            aria-hidden="true"
                          >
                            <span className="cp-orch-system-option-mark-dot"></span>
                          </span>
                          <span className="cp-orch-system-option-main">
                            <span className="cp-orch-system-option-head">
                              <span className="cp-orch-system-option-name">{preset.name}</span>
                              {isSelected ? (
                                <span className="cp-orch-system-option-badge">当前使用</span>
                              ) : null}
                            </span>
                            <span className="cp-orch-system-option-preview">
                              {previewSystemInstructionContent(preset.content, 140)}
                            </span>
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="cp-orch-system-empty-card">
                <div className="cp-selector-empty cp-orch-system-empty">
                  还没有系统指令预设。
                </div>
                <Btn
                  tone="primary"
                  disabled={savingSystemInstruction}
                  onClick={onStartCreatePreset}
                >
                  新增预设
                </Btn>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
