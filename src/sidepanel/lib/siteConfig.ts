import type { ConfigMap, SiteConfig, Tone } from "../types";
import { getSiteAdapterStatus } from "./siteAdapter";
import { normalizeSiteAdapterScript } from "./siteAdapterShared";

export const SITE_CONFIG_MAP_STORAGE_KEY = "siteConfigMap";

const asStoredConfigMap = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function normalizeSiteConfig(config?: SiteConfig): SiteConfig {
  const adapterScript = normalizeSiteAdapterScript(config?.adapterScript);
  return adapterScript ? { adapterScript } : {};
}

export function compactSiteConfig(config?: SiteConfig): SiteConfig {
  const normalized = normalizeSiteConfig(config);
  return getSiteAdapterStatus(normalized.adapterScript).kind === "valid" ? normalized : {};
}

export function normalizeConfigMap(configMap?: ConfigMap) {
  const next: ConfigMap = {};
  Object.entries(configMap || {}).forEach(([host, config]) => {
    const normalized = compactSiteConfig(config);
    if (normalized.adapterScript) {
      next[host] = normalized;
    }
  });
  return next;
}

export function compactExportConfigMap(configMap?: ConfigMap) {
  return normalizeConfigMap(configMap);
}

export function readStoredSiteConfigMap(storageState?: Record<string, unknown>) {
  return compactExportConfigMap(
    (asStoredConfigMap(storageState?.[SITE_CONFIG_MAP_STORAGE_KEY]) || {}) as ConfigMap,
  );
}

export function hasConfigData(config?: SiteConfig) {
  return getSiteAdapterStatus(config?.adapterScript).kind === "valid";
}

export const hasValidConfigData = hasConfigData;

export function getSelectableHosts(configMap: ConfigMap, currentHost: string) {
  const hosts = Object.keys(configMap).filter((host) => hasValidConfigData(configMap[host]));
  const ordered = [
    ...hosts.filter((host) => host === currentHost),
    ...hosts.filter((host) => host !== currentHost),
  ];
  return currentHost && !ordered.includes(currentHost) ? [currentHost, ...ordered] : ordered;
}

export function siteMeta(host: string, currentHost: string, config: SiteConfig): {
  label: string;
  tone: Tone;
} {
  if (host === currentHost && !hasValidConfigData(config)) {
    return { label: "未配置", tone: "danger" };
  }

  return { label: "已保存", tone: "success" };
}
