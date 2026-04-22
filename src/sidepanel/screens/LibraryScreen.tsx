import { useEffect, useMemo, useState, type RefObject } from "react";

import { LibraryStat, ToolbarIconButton } from "../components/common";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ExportAllIcon,
  ImportIcon,
} from "../components/icons";
import { SiteRow } from "../components/SiteRow";
import type { ConfigMap } from "../types";

const PAGE_SIZE = 9;

export function LibraryScreen({
  currentHost,
  hasSavedSites,
  hosts,
  siteConfigMap,
  pendingDeleteHost,
  canEditCurrentHost,
  importInputRef,
  onEditCurrentHost,
  onOpenHost,
  onExportAll,
  onExportHost,
  onImportClick,
  onImportConfig,
  onArmDelete,
  onDeleteHost,
  onCancelDelete,
}: {
  currentHost: string;
  hasSavedSites: boolean;
  hosts: string[];
  siteConfigMap: ConfigMap;
  pendingDeleteHost: string;
  canEditCurrentHost: boolean;
  importInputRef: RefObject<HTMLInputElement | null>;
  onEditCurrentHost: () => void;
  onOpenHost: (host: string) => void;
  onExportAll: () => void;
  onExportHost: (host: string) => void;
  onImportClick: () => void;
  onImportConfig: (file?: File | null) => void;
  onArmDelete: (host: string) => void;
  onDeleteHost: (host: string) => void;
  onCancelDelete: () => void;
}) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(hosts.length / PAGE_SIZE));

  useEffect(() => {
    setPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  useEffect(() => {
    setPage(1);
  }, [currentHost]);

  const pageHosts = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return hosts.slice(start, start + PAGE_SIZE);
  }, [hosts, page]);

  return (
    <div className="cp-library-shell">
      <div className="cp-library-topbar">
        <div className="cp-library-topbar-main">
          <LibraryStat label="站点数：" value={hosts.length} />
        </div>
        <div className="cp-toolbar-actions cp-library-toolbar">
          <ToolbarIconButton
            label="全部导出"
            disabled={!hasSavedSites}
            className="cp-toolbar-icon-sm cp-library-action-btn"
            onClick={onExportAll}
          >
            <>
              <ExportAllIcon />
              <span className="cp-library-action-text">全部导出</span>
            </>
          </ToolbarIconButton>
          <ToolbarIconButton
            label="全部导入"
            className="cp-toolbar-icon-sm cp-library-action-btn"
            onClick={onImportClick}
          >
            <>
              <ImportIcon />
              <span className="cp-library-action-text">全部导入</span>
            </>
          </ToolbarIconButton>
        </div>
      </div>
      <input
        ref={importInputRef}
        type="file"
        accept=".json"
        hidden
        onChange={(event) => onImportConfig(event.target.files?.[0])}
      />
      {hosts.length ? (
        <div className="cp-card cp-library-list-card">
          <div className="cp-library-list">
            {pageHosts.map((host) => (
              <SiteRow
                key={host}
                host={host}
                currentHost={currentHost}
                config={siteConfigMap[host] || {}}
                pendingDelete={pendingDeleteHost === host}
                canEdit={canEditCurrentHost && host === currentHost}
                onOpen={() => onOpenHost(host)}
                onEdit={onEditCurrentHost}
                onExport={() => onExportHost(host)}
                onArmDelete={() => onArmDelete(host)}
                onConfirmDelete={() => onDeleteHost(host)}
                onCancelDelete={onCancelDelete}
              />
            ))}
          </div>
          {totalPages > 1 ? (
            <div className="cp-library-pager">
              <div className="cp-library-pagination">
                <ToolbarIconButton
                  label="上一页"
                  disabled={page === 1}
                  className="cp-toolbar-icon-sm"
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                >
                  <ChevronLeftIcon />
                </ToolbarIconButton>
                <span className="cp-library-page-indicator">
                  {page} / {totalPages}
                </span>
                <ToolbarIconButton
                  label="下一页"
                  disabled={page === totalPages}
                  className="cp-toolbar-icon-sm"
                  onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                >
                  <ChevronRightIcon />
                </ToolbarIconButton>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="cp-card cp-empty-state">
          当前没有可用站点。先打开一个支持的聊天网页，再回来建立配置。
        </div>
      )}
    </div>
  );
}
