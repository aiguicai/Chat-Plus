import { hasValidConfigData, siteMeta } from "../lib/siteConfig";
import type { SiteConfig } from "../types";
import { StatusPill, ToolbarIconButton } from "./common";
import {
  CancelIcon,
  ConfirmIcon,
  DeleteIcon,
  EditIcon,
  ExportAllIcon,
} from "./icons";

export const SiteRow = ({
  host,
  currentHost,
  config,
  pendingDelete,
  canEdit,
  onOpen,
  onEdit,
  onExport,
  onArmDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  host: string;
  currentHost: string;
  config: SiteConfig;
  pendingDelete: boolean;
  canEdit?: boolean;
  onOpen?: () => void;
  onEdit?: () => void;
  onExport?: () => void;
  onArmDelete?: () => void;
  onConfirmDelete?: () => void;
  onCancelDelete?: () => void;
}) => {
  const meta = siteMeta(host, currentHost, config);
  const isCurrent = host === currentHost;
  const canExport = hasValidConfigData(config);
  const showActions = pendingDelete || canEdit || canExport;
  const clickable = !pendingDelete && Boolean(onOpen);

  return (
    <div
      className={`cp-site-row${isCurrent ? " is-current" : ""}${pendingDelete ? " is-danger" : ""}${clickable ? " is-clickable" : ""}`}
      title={host}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onOpen : undefined}
      onKeyDown={
        clickable
          ? (event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onOpen?.();
            }
          : undefined
      }
    >
      <div className="cp-site-row-main">
        <div className="cp-site-row-head">
          <span className="cp-site-row-title">{host}</span>
          <div className="cp-site-row-badges">
            <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
          </div>
        </div>
        {showActions ? (
          <div className="cp-site-row-foot">
            <div className="cp-site-row-actions">
              {pendingDelete ? (
                <>
                  <ToolbarIconButton
                    label={`确认删除 ${host}`}
                    className="cp-toolbar-icon-sm cp-toolbar-icon-danger"
                    onClick={(event) => {
                      event.stopPropagation();
                      onConfirmDelete?.();
                    }}
                  >
                    <ConfirmIcon />
                  </ToolbarIconButton>
                  <ToolbarIconButton
                    label={`取消删除 ${host}`}
                    className="cp-toolbar-icon-sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      onCancelDelete?.();
                    }}
                  >
                    <CancelIcon />
                  </ToolbarIconButton>
                </>
              ) : (
                <>
                  {canEdit ? (
                    <ToolbarIconButton
                      label={`编辑 ${host}`}
                      className="cp-toolbar-icon-sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        onEdit?.();
                      }}
                    >
                      <EditIcon />
                    </ToolbarIconButton>
                  ) : null}
                  {canExport ? (
                    <ToolbarIconButton
                      label={`导出 ${host}`}
                      className="cp-toolbar-icon-sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        onExport?.();
                      }}
                    >
                      <ExportAllIcon />
                    </ToolbarIconButton>
                  ) : null}
                  {canExport ? (
                    <ToolbarIconButton
                      label={`删除 ${host}`}
                      className="cp-toolbar-icon-sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        onArmDelete?.();
                      }}
                    >
                      <DeleteIcon />
                    </ToolbarIconButton>
                  ) : null}
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
