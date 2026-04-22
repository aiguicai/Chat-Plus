import { normalizeTabId, toSafeString } from "../mcp/shared";

export const SCHEDULED_SEND_TAB_CONFIG_STORAGE_KEY = "chatplus_scheduled_send_tab_config_v1";
export const DEFAULT_SCHEDULED_SEND_START_TIME = "09:00";
export const DEFAULT_SCHEDULED_SEND_END_TIME = "18:00";
export const DEFAULT_SCHEDULED_SEND_INTERVAL_SECONDS = 60;

export type ScheduledSendConfig = {
  enabled: boolean;
  content: string;
  startTime: string;
  endTime: string;
  intervalSeconds: number;
  createdAt: number;
  updatedAt: number;
};

export type ScheduledSendTabConfigMap = Record<string, ScheduledSendConfig>;

export type ScheduledSendTabConfigState = {
  configByTabId: ScheduledSendTabConfigMap;
};

export const DEFAULT_SCHEDULED_SEND_TAB_CONFIG_STATE: ScheduledSendTabConfigState = {
  configByTabId: {},
};

export function normalizeScheduledSendContent(value: unknown) {
  return String(value || "").replace(/\r\n?/g, "\n").trim();
}

export function normalizeScheduledSendTime(value: unknown, fallback = DEFAULT_SCHEDULED_SEND_START_TIME) {
  const normalized = String(value || "").trim();
  if (!normalized) return fallback;
  const match = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return fallback;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return fallback;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function normalizeScheduledSendIntervalSeconds(
  value: unknown,
  fallback = DEFAULT_SCHEDULED_SEND_INTERVAL_SECONDS,
) {
  if (value == null || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(24 * 60 * 60, Math.floor(parsed)));
}

export function parseScheduledSendTimeToMinutes(value: unknown) {
  const normalized = normalizeScheduledSendTime(value, "");
  if (!normalized) return null;
  const [hoursText, minutesText] = normalized.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  return hours * 60 + minutes;
}

export function normalizeScheduledSendConfig(rawValue: unknown): ScheduledSendConfig | null {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    return null;
  }

  const source = rawValue as Record<string, unknown>;
  const content = normalizeScheduledSendContent(source.content);
  const createdAt = Number.isFinite(source.createdAt) ? Number(source.createdAt) : Date.now();
  const updatedAt = Number.isFinite(source.updatedAt) ? Number(source.updatedAt) : createdAt;

  return {
    enabled: source.enabled !== false,
    content,
    startTime: normalizeScheduledSendTime(
      source.startTime,
      DEFAULT_SCHEDULED_SEND_START_TIME,
    ),
    endTime: normalizeScheduledSendTime(source.endTime, DEFAULT_SCHEDULED_SEND_END_TIME),
    intervalSeconds: normalizeScheduledSendIntervalSeconds(
      source.intervalSeconds,
      DEFAULT_SCHEDULED_SEND_INTERVAL_SECONDS,
    ),
    createdAt,
    updatedAt,
  };
}

export function normalizeScheduledSendTabConfigMap(
  rawValue: unknown,
  allowedTabIds?: Array<number | string>,
) {
  const rawMap =
    rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
      ? (rawValue as Record<string, unknown>)
      : {};
  const allowedTabIdSet = Array.isArray(allowedTabIds)
    ? new Set(allowedTabIds.map((tabId) => normalizeTabId(tabId)).filter(Boolean))
    : null;
  const nextMap: ScheduledSendTabConfigMap = {};

  Object.entries(rawMap).forEach(([rawTabId, rawConfig]) => {
    const tabId = normalizeTabId(rawTabId);
    if (!tabId || (allowedTabIdSet && !allowedTabIdSet.has(tabId))) return;
    const config = normalizeScheduledSendConfig(rawConfig);
    if (!config) return;
    nextMap[tabId] = config;
  });

  return nextMap;
}

export function isScheduledSendConfigEnabled(config: ScheduledSendConfig | null | undefined) {
  return Boolean(config?.enabled && normalizeScheduledSendContent(config?.content));
}

export function buildScheduledSendSummary(config: ScheduledSendConfig | null | undefined) {
  if (!config) return "";
  const intervalSeconds = normalizeScheduledSendIntervalSeconds(config.intervalSeconds);
  return `${config.startTime} - ${config.endTime} / 每 ${intervalSeconds} 秒`;
}

export function normalizeScheduledSendTabId(value: unknown) {
  return toSafeString(normalizeTabId(value));
}
