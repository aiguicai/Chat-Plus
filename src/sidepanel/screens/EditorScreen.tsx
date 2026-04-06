import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";

import { StatusPill, ToolbarIconButton } from "../components/common";
import { RefreshIcon, ReturnIcon } from "../components/icons";
import { analyzeSiteAdapterScript, getSiteAdapterStatus } from "../lib/siteAdapter";
import type { SiteConfig, TipTone } from "../types";

export function EditorScreen({
  editorHost,
  canRefreshPage,
  draft,
  tipMessage,
  tipTone,
  onRefreshPage,
  onReturnToLibrary,
  onUpdateAdapterScript,
}: {
  editorHost: string;
  canRefreshPage: boolean;
  draft: SiteConfig;
  tipMessage: string;
  tipTone: TipTone;
  onRefreshPage: () => void;
  onReturnToLibrary: () => void;
  onUpdateAdapterScript: (script: string) => void;
}) {
  const [scriptDraft, setScriptDraft] = useState(draft.adapterScript || "");
  const statusPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setScriptDraft(draft.adapterScript || "");
  }, [draft.adapterScript]);

  const analysis = useMemo(() => analyzeSiteAdapterScript(scriptDraft), [scriptDraft]);
  const status = useMemo(() => getSiteAdapterStatus(scriptDraft), [scriptDraft]);
  const validation = analysis;

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      const storedScript = draft.adapterScript || "";
      if (scriptDraft === storedScript) return;
      if (!validation.ok) return;
      onUpdateAdapterScript(scriptDraft);
    }, 260);
    return () => window.clearTimeout(timerId);
  }, [draft.adapterScript, onUpdateAdapterScript, scriptDraft, validation.ok]);
  const hasWarnings = validation.warnings.length > 0;
  const hasValidationIssue = status.kind === "invalid";
  const hasStatusPanel = hasValidationIssue || hasWarnings;
  const contractItems = analysis.checklist.filter(
    (item) => item.id.startsWith("contract.") || item.id.startsWith("hook.") || item.id.startsWith("meta."),
  );
  const capabilityItems = analysis.checklist.filter(
    (item) =>
      item.id.startsWith("request.") ||
      item.id.startsWith("response.") ||
      item.id.startsWith("bubble.") ||
      item.id.startsWith("continuation."),
  );
  const implementationItems = analysis.checklist.filter((item) => item.id.startsWith("implementation."));
  const pillTone =
    status.kind === "valid"
      ? hasWarnings
        ? "warning"
        : "success"
      : status.kind === "invalid"
        ? "danger"
        : "neutral";
  const shouldShowInlineTip = !hasStatusPanel;

  function jumpToStatusPanel() {
    const target = statusPanelRef.current;
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function renderChecklist(items: typeof analysis.checklist) {
    return (
      <div className="cp-editor-checklist">
        {items.map((item) => (
          <div
            key={item.id}
            className={`cp-editor-check-item is-${item.status}`}
          >
            <div className="cp-editor-check-item-head">
              <span className="cp-editor-check-item-label">{item.label}</span>
              <span className={`cp-editor-check-item-badge is-${item.status}`}>
                {item.status === "pass" ? "通过" : "缺失"}
              </span>
            </div>
            <div className="cp-editor-check-item-detail">{item.detail}</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="cp-editor-shell cp-script-editor-shell">
      <div className="cp-editor-topbar">
        <ToolbarIconButton
          label="返回站点库"
          className="cp-toolbar-icon-sm cp-editor-topbar-nav"
          onClick={onReturnToLibrary}
        >
          <ReturnIcon />
        </ToolbarIconButton>
        <div
          className="cp-editor-title cp-editor-topbar-title"
          title={editorHost || "未选择站点"}
        >
          {editorHost || "未选择站点"}
        </div>
        <ToolbarIconButton
          label="刷新当前页面"
          className="cp-toolbar-icon-sm cp-editor-topbar-nav"
          disabled={!canRefreshPage}
          onClick={onRefreshPage}
        >
          <RefreshIcon />
        </ToolbarIconButton>
      </div>
      <div className="cp-script-editor-grid">
        <div className="cp-card cp-script-editor-main">
          <div className="cp-script-editor-head">
            <div className="cp-script-editor-title-wrap">
              <div className="cp-script-editor-title">站点适配脚本</div>
            </div>
            <div className="cp-script-editor-head-actions">
              <StatusPill
                tone={pillTone}
                className={`cp-script-editor-status-pill${status.kind === "valid" && hasWarnings ? " is-warning-state" : ""}`}
                onClick={hasStatusPanel ? jumpToStatusPanel : undefined}
                title={
                  hasValidationIssue
                    ? validation.error
                    : hasWarnings
                      ? validation.warnings.map((warning) => warning.message).join("\n")
                      : ""
                }
              >
                {status.kind === "valid" ? (
                  hasWarnings ? (
                    <>
                      <span>脚本可用</span>
                      <span className="cp-status-pill-sep">·</span>
                      <span>{validation.warnings.length} 条告警</span>
                    </>
                  ) : (
                    "脚本可用"
                  )
                ) : status.kind === "invalid" ? (
                  "脚本有误"
                ) : (
                  "未配置"
                )}
              </StatusPill>
            </div>
          </div>

          <div className="cp-script-editor-codewrap">
            <CodeMirror
              value={scriptDraft}
              height="540px"
              theme={oneDark}
              extensions={[javascript({ jsx: false, typescript: false })]}
              basicSetup={{
                foldGutter: false,
                dropCursor: false,
                allowMultipleSelections: false,
              }}
              onChange={(value) => setScriptDraft(value)}
            />
          </div>

          {hasValidationIssue ? (
            <div
              ref={statusPanelRef}
              className="cp-editor-status-panel is-danger"
              role="alert"
            >
              <div className="cp-editor-status-panel-title">脚本校验失败</div>
              <div className="cp-editor-status-panel-copy">当前改动未保存。修复下面的问题后才会自动保存。</div>
              <pre className="cp-editor-error-detail">{validation.error}</pre>
            </div>
          ) : null}
          {!hasValidationIssue && hasWarnings ? (
            <div
              ref={statusPanelRef}
              className="cp-editor-status-panel is-warning"
              role="status"
            >
              <div className="cp-editor-status-panel-title">
                检测到 {validation.warnings.length} 条维护性告警
              </div>
              <div className="cp-editor-status-panel-copy">
                脚本可以保存和运行，但这些写法会增加后续维护和适配风险。
              </div>
              <pre className="cp-editor-warning-detail">
                {validation.warnings.map((warning) => `- ${warning.message}`).join("\n")}
              </pre>
            </div>
          ) : null}
          {shouldShowInlineTip ? (
            <div className={`cp-inline-tip cp-editor-tip${tipTone ? ` ${tipTone}` : ""}`}>
              {status.kind === "empty" ? "脚本为空时不会保存。" : tipMessage}
            </div>
          ) : null}
          {scriptDraft ? (
            <div className="cp-editor-diagnostics-grid">
              <div className="cp-editor-diagnostics-card">
                <div className="cp-editor-diagnostics-card-title">基础契约</div>
                <div className="cp-editor-diagnostics-card-copy">
                  四个 hook、meta 和平台契约是否齐全。
                </div>
                {renderChecklist(contractItems)}
              </div>
              <div className="cp-editor-diagnostics-card">
                <div className="cp-editor-diagnostics-card-title">核心能力</div>
                <div className="cp-editor-diagnostics-card-copy">
                  注入、响应提取、气泡改造和 DOM 续发是否具备最低可用能力。
                </div>
                {renderChecklist(capabilityItems)}
              </div>
              <div className="cp-editor-diagnostics-card">
                <div className="cp-editor-diagnostics-card-title">实现约束</div>
                <div className="cp-editor-diagnostics-card-copy">
                  协议渲染、DOM 续发和协议标记是否按平台要求实现。
                </div>
                {renderChecklist(implementationItems)}
              </div>
              <div className="cp-editor-diagnostics-card">
                <div className="cp-editor-diagnostics-card-title">当前统计</div>
                <div className="cp-editor-metrics">
                  <div className="cp-editor-metric">
                    <span>通过</span>
                    <strong>{analysis.summary.passCount}</strong>
                  </div>
                  <div className="cp-editor-metric">
                    <span>告警</span>
                    <strong>{analysis.summary.warningCount}</strong>
                  </div>
                  <div className="cp-editor-metric">
                    <span>错误</span>
                    <strong>{analysis.summary.errorCount}</strong>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          {!hasValidationIssue && hasWarnings ? (
            <div className="cp-editor-warning-summary">
              <div className="cp-editor-warning-summary-title">维护性提醒</div>
              <div className="cp-editor-warning-summary-list">
                {validation.warnings.map((warning) => (
                  <div key={warning.code} className="cp-editor-warning-summary-item">
                    {warning.message}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
