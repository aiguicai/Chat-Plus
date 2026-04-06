import type { Tone } from "../types";
import { StatusPill } from "./common";

export const OverviewCard = ({
  title,
  kicker,
  tone,
  summary,
  description,
  actionLabel,
  onClick,
}: {
  title: string;
  kicker: string;
  tone: Tone;
  summary: string;
  description: string;
  actionLabel: string;
  onClick: () => void;
}) => (
  <button type="button" className="cp-overview-card" onClick={onClick}>
    <span className="cp-overview-card-top">
      <span>
        <span className="cp-overview-card-kicker">{kicker}</span>
        <span className="cp-overview-card-title">{title}</span>
      </span>
      <StatusPill tone={tone}>{summary}</StatusPill>
    </span>
    <span className="cp-overview-card-desc">{description}</span>
    <span className="cp-overview-card-footer">{actionLabel}</span>
  </button>
);
