import type { MouseEventHandler, ReactNode } from "react";

import type { Tone } from "../types";

export const TabButton = ({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) => (
  <button
    className={`cp-tab${active ? " active" : ""}`}
    type="button"
    role="tab"
    aria-selected={active}
    tabIndex={active ? 0 : -1}
    onClick={onClick}
  >
    {children}
  </button>
);

export const Btn = ({
  tone = "secondary",
  disabled,
  children,
  onClick,
  className = "",
}: {
  tone?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) => (
  <button
    className={`cp-btn cp-btn-${tone}${className ? ` ${className}` : ""}`}
    type="button"
    disabled={disabled}
    onClick={onClick}
  >
    {children}
  </button>
);

export const ToolbarIconButton = ({
  label,
  disabled,
  onClick,
  children,
  className = "",
}: {
  label: string;
  disabled?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  children: ReactNode;
  className?: string;
}) => (
  <button
    className={`cp-icon-btn cp-toolbar-icon${className ? ` ${className}` : ""}`}
    type="button"
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={onClick}
  >
    {children}
  </button>
);

export const MiniActionButton = ({
  label,
  disabled,
  onClick,
  active = false,
  loading = false,
  className = "",
}: {
  label: string;
  disabled?: boolean;
  onClick?: () => void;
  active?: boolean;
  loading?: boolean;
  className?: string;
}) => (
  <button
    className={`cp-mini-action-btn${active ? " is-active" : ""}${loading ? " is-loading" : ""}${className ? ` ${className}` : ""}`}
    type="button"
    disabled={disabled}
    onClick={onClick}
  >
    {label}
  </button>
);

export const StatusPill = ({
  tone = "neutral",
  children,
  title,
  className = "",
  onClick,
}: {
  tone?: Tone;
  children: ReactNode;
  title?: string;
  className?: string;
  onClick?: () => void;
}) => (
  <span
    className={`cp-status-pill is-${tone}${onClick ? " is-clickable" : ""}${className ? ` ${className}` : ""}`}
    title={title}
    role={onClick ? "button" : undefined}
    tabIndex={onClick ? 0 : undefined}
    onClick={onClick}
    onKeyDown={
      onClick
        ? (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            onClick();
          }
        : undefined
    }
  >
    {children}
  </span>
);

export const InfoField = ({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: ReactNode;
  wide?: boolean;
}) => (
  <div className={`cp-info-field${wide ? " is-wide" : ""}`}>
    <div className="cp-info-field-label">{label}</div>
    <div className="cp-info-field-value">{value}</div>
  </div>
);

export const LibraryStat = ({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) => (
  <span className="cp-library-stat">
    <span>{label}</span>
    <strong>{value}</strong>
  </span>
);
