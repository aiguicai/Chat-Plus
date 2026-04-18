import type { RefObject } from "react";

import { Btn, ToolbarIconButton } from "./common";
import {
  BackupTransferIcon,
  CancelIcon,
  ExportAllIcon,
  ImportIcon,
} from "./icons";

type BackupTransferDialogProps = {
  open: boolean;
  savedSiteCount: number;
  disabledSiteCount: number;
  importInputRef: RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onExport: () => void | Promise<void>;
  onImportClick: () => void;
  onImportConfig: (file?: File | null) => void;
};

export function BackupTransferDialog({
  open,
  savedSiteCount,
  disabledSiteCount,
  importInputRef,
  onClose,
  onExport,
  onImportClick,
  onImportConfig,
}: BackupTransferDialogProps) {
  if (!open) return null;

  return (
    <div className="cp-backup-dialog-wrap">
      <button
        type="button"
        className="cp-backup-backdrop"
        aria-label="关闭完整备份弹窗"
        onClick={onClose}
      ></button>
      <div
        className="cp-backup-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cp-backup-dialog-title"
      >
        <div className="cp-backup-dialog-head">
          <div className="cp-backup-dialog-title-wrap">
            <div className="cp-backup-dialog-kicker">配置迁移</div>
            <div className="cp-backup-dialog-title" id="cp-backup-dialog-title">
              完整备份与恢复
            </div>
            <div className="cp-backup-dialog-desc">
              导出当前浏览器里 Chat Plus 的持久化配置，或在另一浏览器一键恢复。
            </div>
          </div>
          <ToolbarIconButton
            label="关闭完整备份弹窗"
            className="cp-toolbar-icon-sm cp-backup-close"
            onClick={onClose}
          >
            <CancelIcon />
          </ToolbarIconButton>
        </div>

        <div className="cp-backup-stats">
          <span className="cp-library-stat">
            <span>已保存站点</span>
            <strong>{savedSiteCount}</strong>
          </span>
          <span className="cp-library-stat">
            <span>已停用站点</span>
            <strong>{disabledSiteCount}</strong>
          </span>
        </div>

        <div className="cp-backup-grid">
          <div className="cp-backup-card">
            <div className="cp-backup-card-icon">
              <ExportAllIcon />
            </div>
            <div className="cp-backup-card-title">导出完整配置包</div>
            <div className="cp-backup-card-desc">
              包含站点适配器、站点开关、MCP 服务与工具选择、系统提示词、主题和自动续发设置。
            </div>
            <Btn
              tone="primary"
              className="cp-backup-card-btn"
              onClick={() => {
                void onExport();
              }}
            >
              <span className="cp-backup-btn-content">
                <ExportAllIcon />
                导出完整配置
              </span>
            </Btn>
          </div>

          <div className="cp-backup-card is-import">
            <div className="cp-backup-card-icon">
              <ImportIcon />
            </div>
            <div className="cp-backup-card-title">导入完整配置包</div>
            <div className="cp-backup-card-desc">
              导入后会覆盖当前已保存的完整配置，适合迁移到另一个浏览器或无痕环境。
            </div>
            <Btn
              tone="secondary"
              className="cp-backup-card-btn"
              onClick={onImportClick}
            >
              <span className="cp-backup-btn-content">
                <ImportIcon />
                选择备份文件
              </span>
            </Btn>
          </div>
        </div>

        <div className="cp-backup-note">
          <BackupTransferIcon />
          <span>单站点导入导出仍保留在“站点”页，这里处理的是整插件配置包。</span>
        </div>

        <input
          ref={importInputRef}
          type="file"
          accept=".json"
          hidden
          onChange={(event) => onImportConfig(event.target.files?.[0])}
        />
      </div>
    </div>
  );
}
