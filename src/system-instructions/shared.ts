import {
  normalizeSiteToolScopeKey,
  normalizeTabId,
  toSafeString,
} from "../mcp/shared";

export const SYSTEM_INSTRUCTION_PRESETS_STORAGE_KEY =
  "chatplus_system_instruction_presets_v1";
export const SYSTEM_INSTRUCTION_TAB_SELECTION_STORAGE_KEY =
  "chatplus_system_instruction_tab_selection_v1";
export const SYSTEM_INSTRUCTION_SITE_SELECTION_STORAGE_KEY =
  "chatplus_system_instruction_site_selection_v1";

export type SystemInstructionPreset = {
  id: string;
  name: string;
  content: string;
  createdAt: number;
  updatedAt: number;
};

export type SystemInstructionPresetStore = {
  presets: SystemInstructionPreset[];
  updatedAt: number;
};

export type SystemInstructionTabSelectionMap = Record<string, string>;
export type SystemInstructionSiteSelectionMap = Record<string, string>;

export type SystemInstructionTabSelectionState = {
  presetIdByTabId: SystemInstructionTabSelectionMap;
};

export type SystemInstructionSiteSelectionState = {
  presetIdBySiteKey: SystemInstructionSiteSelectionMap;
};

export type SystemInstructionResolutionSource = "tab" | "site" | "none";

export const DEFAULT_SYSTEM_INSTRUCTION_PRESET_STORE: SystemInstructionPresetStore = {
  presets: [],
  updatedAt: 0,
};

export const DEFAULT_SYSTEM_INSTRUCTION_TAB_SELECTION_STATE: SystemInstructionTabSelectionState = {
  presetIdByTabId: {},
};

export const DEFAULT_SYSTEM_INSTRUCTION_SITE_SELECTION_STATE: SystemInstructionSiteSelectionState = {
  presetIdBySiteKey: {},
};

const createPresetId = (prefix = "sys") =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const normalizeSystemInstructionName = (value: unknown) =>
  toSafeString(value).replace(/\s+/g, " ").slice(0, 80);

export const normalizeSystemInstructionContent = (value: unknown) =>
  String(value || "").replace(/\r\n?/g, "\n").trim();

export function createSystemInstructionPreset(name: unknown, content: unknown): SystemInstructionPreset {
  const normalizedName = normalizeSystemInstructionName(name);
  const normalizedContent = normalizeSystemInstructionContent(content);
  const now = Date.now();

  return {
    id: createPresetId(),
    name: normalizedName,
    content: normalizedContent,
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeSystemInstructionPreset(rawPreset: unknown): SystemInstructionPreset | null {
  if (!rawPreset || typeof rawPreset !== "object" || Array.isArray(rawPreset)) {
    return null;
  }

  const source = rawPreset as Record<string, unknown>;
  const name = normalizeSystemInstructionName(source.name);
  const content = normalizeSystemInstructionContent(source.content);
  if (!name || !content) return null;

  const createdAt = Number.isFinite(source.createdAt) ? Number(source.createdAt) : Date.now();
  const updatedAt = Number.isFinite(source.updatedAt) ? Number(source.updatedAt) : createdAt;

  return {
    id: toSafeString(source.id) || createPresetId(),
    name,
    content,
    createdAt,
    updatedAt,
  };
}

export function normalizeSystemInstructionPresetStore(
  rawStore: unknown,
): SystemInstructionPresetStore {
  const source =
    rawStore && typeof rawStore === "object" && !Array.isArray(rawStore)
      ? (rawStore as Record<string, unknown>)
      : {};
  const presets: SystemInstructionPreset[] = [];
  const seenPresetIds = new Set<string>();

  (Array.isArray(source.presets) ? source.presets : []).forEach((rawPreset) => {
    const preset = normalizeSystemInstructionPreset(rawPreset);
    if (!preset || seenPresetIds.has(preset.id)) return;
    seenPresetIds.add(preset.id);
    presets.push(preset);
  });

  presets.sort((left, right) => {
    if ((right.updatedAt || 0) !== (left.updatedAt || 0)) {
      return (right.updatedAt || 0) - (left.updatedAt || 0);
    }
    return (right.createdAt || 0) - (left.createdAt || 0);
  });

  return {
    presets,
    updatedAt: Number.isFinite(source.updatedAt) ? Number(source.updatedAt) : Date.now(),
  };
}

function createAvailablePresetIdSet(presets: SystemInstructionPreset[]) {
  return new Set(
    (Array.isArray(presets) ? presets : [])
      .map((preset) => toSafeString(preset?.id))
      .filter(Boolean),
  );
}

export function sanitizeSystemInstructionPresetIdByTabId(
  presets: SystemInstructionPreset[],
  rawValue: unknown,
  allowedTabIds?: Array<number | string>,
) {
  const rawMap =
    rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
      ? (rawValue as Record<string, unknown>)
      : {};
  const availablePresetIds = createAvailablePresetIdSet(presets);
  const allowedTabIdSet = Array.isArray(allowedTabIds)
    ? new Set(allowedTabIds.map((tabId) => normalizeTabId(tabId)).filter(Boolean))
    : null;
  const nextMap: SystemInstructionTabSelectionMap = {};

  Object.entries(rawMap).forEach(([rawTabId, rawPresetId]) => {
    const tabId = normalizeTabId(rawTabId);
    const presetId = toSafeString(rawPresetId);
    if (!tabId || !presetId || !availablePresetIds.has(presetId)) return;
    if (allowedTabIdSet && !allowedTabIdSet.has(tabId)) return;
    nextMap[tabId] = presetId;
  });

  return nextMap;
}

export function sanitizeSystemInstructionPresetIdBySiteKey(
  presets: SystemInstructionPreset[],
  rawValue: unknown,
  allowedScopeKeys?: string[],
) {
  const rawMap =
    rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
      ? (rawValue as Record<string, unknown>)
      : {};
  const availablePresetIds = createAvailablePresetIdSet(presets);
  const allowedScopeKeySet = Array.isArray(allowedScopeKeys)
    ? new Set(
        allowedScopeKeys
          .map((scopeKey) => normalizeSiteToolScopeKey(scopeKey))
          .filter(Boolean),
      )
    : null;
  const nextMap: SystemInstructionSiteSelectionMap = {};

  Object.entries(rawMap).forEach(([rawScopeKey, rawPresetId]) => {
    const scopeKey = normalizeSiteToolScopeKey(rawScopeKey);
    const presetId = toSafeString(rawPresetId);
    if (!scopeKey || !presetId || !availablePresetIds.has(presetId)) return;
    if (allowedScopeKeySet && !allowedScopeKeySet.has(scopeKey)) return;
    nextMap[scopeKey] = presetId;
  });

  return nextMap;
}

export function resolveSystemInstructionPreset({
  presets,
  tabId,
  siteKey,
  presetIdByTabId,
  presetIdBySiteKey,
}: {
  presets: SystemInstructionPreset[];
  tabId?: number | string | null;
  siteKey?: string | null;
  presetIdByTabId?: SystemInstructionTabSelectionMap;
  presetIdBySiteKey?: SystemInstructionSiteSelectionMap;
}) {
  const presetById = new Map(
    (Array.isArray(presets) ? presets : []).map((preset) => [preset.id, preset] as const),
  );
  const normalizedTabId = normalizeTabId(tabId);
  const normalizedSiteKey = normalizeSiteToolScopeKey(siteKey);
  const tabPresetId = normalizedTabId
    ? toSafeString((presetIdByTabId || {})[normalizedTabId])
    : "";
  const sitePresetId = normalizedSiteKey
    ? toSafeString((presetIdBySiteKey || {})[normalizedSiteKey])
    : "";

  if (tabPresetId && presetById.has(tabPresetId)) {
    return {
      presetId: tabPresetId,
      preset: presetById.get(tabPresetId) || null,
      source: "tab" as SystemInstructionResolutionSource,
    };
  }

  if (sitePresetId && presetById.has(sitePresetId)) {
    return {
      presetId: sitePresetId,
      preset: presetById.get(sitePresetId) || null,
      source: "site" as SystemInstructionResolutionSource,
    };
  }

  return {
    presetId: "",
    preset: null,
    source: "none" as SystemInstructionResolutionSource,
  };
}
