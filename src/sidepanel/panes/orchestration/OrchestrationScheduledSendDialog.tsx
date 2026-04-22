import { CancelIcon } from "../../components/icons";
import type { OrchestrationTab } from "../../types";

type OrchestrationScheduledSendDialogProps = {
  openScheduleTab: OrchestrationTab | null;
  scheduleEnabledDraft: boolean;
  scheduleStartTimeDraft: string;
  scheduleEndTimeDraft: string;
  scheduleIntervalDraft: string;
  scheduleContentDraft: string;
  scheduleError: string;
  onClose: () => void;
  onSetScheduleEnabledDraft: (value: boolean) => void;
  onSetScheduleStartTimeDraft: (value: string) => void;
  onSetScheduleEndTimeDraft: (value: string) => void;
  onSetScheduleIntervalDraft: (value: string) => void;
  onSetScheduleContentDraft: (value: string) => void;
};

export function OrchestrationScheduledSendDialog({
  openScheduleTab,
  scheduleEnabledDraft,
  scheduleStartTimeDraft,
  scheduleEndTimeDraft,
  scheduleIntervalDraft,
  scheduleContentDraft,
  scheduleError,
  onClose,
  onSetScheduleEnabledDraft,
  onSetScheduleStartTimeDraft,
  onSetScheduleEndTimeDraft,
  onSetScheduleIntervalDraft,
  onSetScheduleContentDraft,
}: OrchestrationScheduledSendDialogProps) {
  if (!openScheduleTab) return null;

  return (
    <div className="cp-orch-system-dialog-wrap">
      <div className="cp-orch-system-backdrop" aria-hidden="true" onClick={onClose}></div>
      <div
        className="cp-orch-system-dialog cp-orch-schedule-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${openScheduleTab.host} 定时发送`}
      >
        <div className="cp-orch-system-dialog-head">
          <div className="cp-orch-system-dialog-title-wrap">
            <div className="cp-orch-system-dialog-title">定时发送</div>
            <div className="cp-orch-system-dialog-host">{openScheduleTab.host}</div>
          </div>
          <button
            type="button"
            className="cp-orch-system-close"
            aria-label="关闭定时发送设置"
            onClick={onClose}
          >
            <CancelIcon />
          </button>
        </div>
        <div className="cp-orch-system-selection-note">
          在设定时间段内按秒循环向AI聊天界面发送这段内容。
        </div>
        <div className="cp-orch-schedule-grid">
          <label className="cp-orch-system-field">
            <span className="cp-orch-system-label">启用定时发送</span>
            <span className="cp-orch-schedule-toggle-row">
              <span className="cp-orch-schedule-toggle-copy">
                {scheduleEnabledDraft ? "当前已启用" : "当前未启用"}
              </span>
              <span className="cp-toggle">
                <input
                  type="checkbox"
                  checked={scheduleEnabledDraft}
                  onChange={(event) => onSetScheduleEnabledDraft(event.target.checked)}
                />
                <span className="cp-toggle-slider"></span>
              </span>
            </span>
          </label>
          <label className="cp-orch-system-field">
            <span className="cp-orch-system-label">开始时间</span>
            <input
              className="cp-orch-system-input"
              type="time"
              step={60}
              value={scheduleStartTimeDraft}
              onChange={(event) => onSetScheduleStartTimeDraft(event.target.value)}
            />
          </label>
          <label className="cp-orch-system-field">
            <span className="cp-orch-system-label">结束时间</span>
            <input
              className="cp-orch-system-input"
              type="time"
              step={60}
              value={scheduleEndTimeDraft}
              onChange={(event) => onSetScheduleEndTimeDraft(event.target.value)}
            />
          </label>
          <label className="cp-orch-system-field">
            <span className="cp-orch-system-label">间隔秒数</span>
            <input
              className="cp-orch-system-input"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={scheduleIntervalDraft}
              placeholder="默认 60"
              onChange={(event) => onSetScheduleIntervalDraft(event.target.value)}
            />
          </label>
        </div>
        <div className="cp-orch-system-selection-note">
          开始和结束时间相同会按全天处理。间隔默认按秒计算，例如 `60` 表示每分钟一次。
        </div>
        <label className="cp-orch-system-field">
          <span className="cp-orch-system-label">发送内容</span>
          <textarea
            className="cp-orch-system-textarea cp-orch-schedule-textarea"
            rows={9}
            value={scheduleContentDraft}
            placeholder="输入定时自动发送的内容"
            onChange={(event) => onSetScheduleContentDraft(event.target.value)}
          />
        </label>
        {scheduleError ? (
          <div className="cp-selector-empty cp-orch-system-error is-danger">{scheduleError}</div>
        ) : null}
      </div>
    </div>
  );
}
