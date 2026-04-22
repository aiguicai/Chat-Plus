import { useEffect, useMemo, useRef, useState } from "react";

import { ensureChatPlusRuntime, getStorage, sendTabMessage, setStorage } from "../../lib/chrome";
import { getErrorMessage } from "../../lib/format";
import type { OrchestrationTab } from "../../types";
import {
  DEFAULT_SCHEDULED_SEND_END_TIME,
  DEFAULT_SCHEDULED_SEND_INTERVAL_SECONDS,
  DEFAULT_SCHEDULED_SEND_START_TIME,
  DEFAULT_SCHEDULED_SEND_TAB_CONFIG_STATE,
  SCHEDULED_SEND_TAB_CONFIG_STORAGE_KEY,
  buildScheduledSendSummary,
  isScheduledSendConfigEnabled,
  normalizeScheduledSendConfig,
  normalizeScheduledSendContent,
  normalizeScheduledSendIntervalSeconds,
  normalizeScheduledSendTabConfigMap,
  normalizeScheduledSendTime,
  type ScheduledSendConfig,
  type ScheduledSendTabConfigMap,
  type ScheduledSendTabConfigState,
} from "../../../scheduled-send/shared";

type UseOrchestrationScheduledSendOptions = {
  active: boolean;
  tabs: OrchestrationTab[];
};

function collectManagedTabIds(
  currentTabIds: Array<number | string>,
  ...maps: Array<Record<string, unknown> | undefined>
) {
  return Array.from(
    new Set([
      ...currentTabIds.map((tabId) => String(tabId)).filter(Boolean),
      ...maps.flatMap((map) => Object.keys(map || {}).filter(Boolean)),
    ]),
  );
}

export function useOrchestrationScheduledSend({
  active,
  tabs,
}: UseOrchestrationScheduledSendOptions) {
  const AUTO_SAVE_DEBOUNCE_MS = 420;
  const safeTabs = Array.isArray(tabs) ? tabs : [];
  const currentTabIds = useMemo(() => safeTabs.map((tab) => tab.tabId), [safeTabs]);
  const [configByTabId, setConfigByTabId] = useState<ScheduledSendTabConfigMap>({});
  const [openScheduleTabId, setOpenScheduleTabId] = useState<number | null>(null);
  const [scheduleEnabledDraft, setScheduleEnabledDraft] = useState(false);
  const [scheduleStartTimeDraft, setScheduleStartTimeDraft] = useState(
    DEFAULT_SCHEDULED_SEND_START_TIME,
  );
  const [scheduleEndTimeDraft, setScheduleEndTimeDraft] = useState(
    DEFAULT_SCHEDULED_SEND_END_TIME,
  );
  const [scheduleIntervalDraft, setScheduleIntervalDraft] = useState(
    String(DEFAULT_SCHEDULED_SEND_INTERVAL_SECONDS),
  );
  const [scheduleContentDraft, setScheduleContentDraft] = useState("");
  const [scheduleError, setScheduleError] = useState("");
  const configRef = useRef<ScheduledSendTabConfigMap>({});
  const autoSaveTimerRef = useRef<number | null>(null);
  const openScheduleTab = useMemo(
    () => safeTabs.find((tab) => tab.tabId === openScheduleTabId) || null,
    [openScheduleTabId, safeTabs],
  );

  const applyScheduledSendState = (nextConfigByTabId: ScheduledSendTabConfigMap) => {
    configRef.current = nextConfigByTabId;
    setConfigByTabId(nextConfigByTabId);
  };

  const sanitizeScheduledSendState = (nextConfigByTabId: ScheduledSendTabConfigMap) =>
    normalizeScheduledSendTabConfigMap(nextConfigByTabId, currentTabIds);

  const persistScheduledSendState = async (nextConfigByTabId: ScheduledSendTabConfigMap) => {
    const sanitizedConfigByTabId = sanitizeScheduledSendState(nextConfigByTabId);
    const managedTabIds = collectManagedTabIds(
      currentTabIds,
      configRef.current,
      sanitizedConfigByTabId,
    );
    const storedState = await getStorage<{
      [SCHEDULED_SEND_TAB_CONFIG_STORAGE_KEY]: ScheduledSendTabConfigState;
    }>("session", {
      [SCHEDULED_SEND_TAB_CONFIG_STORAGE_KEY]: DEFAULT_SCHEDULED_SEND_TAB_CONFIG_STATE,
    });
    const persistedConfigByTabId = normalizeScheduledSendTabConfigMap(
      storedState?.[SCHEDULED_SEND_TAB_CONFIG_STORAGE_KEY]?.configByTabId ||
        DEFAULT_SCHEDULED_SEND_TAB_CONFIG_STATE.configByTabId,
    );
    const nextStoredConfigByTabId = { ...persistedConfigByTabId };
    managedTabIds.forEach((tabId) => {
      delete nextStoredConfigByTabId[tabId];
    });
    Object.entries(sanitizedConfigByTabId).forEach(([tabId, config]) => {
      nextStoredConfigByTabId[tabId] = config;
    });

    await setStorage("session", {
      [SCHEDULED_SEND_TAB_CONFIG_STORAGE_KEY]: {
        configByTabId: nextStoredConfigByTabId,
      } satisfies ScheduledSendTabConfigState,
    });

    return nextStoredConfigByTabId;
  };

  const refreshScheduledSendRuntime = async (tabId: number) => {
    const siteTabId = Number(tabId);
    if (!Number.isInteger(siteTabId) || siteTabId <= 0) return;

    try {
      await sendTabMessage(siteTabId, { type: "SYSTEM_INSTRUCTION_REFRESH" });
    } catch (error) {
      const message = getErrorMessage(error);
      if (
        !/Receiving end does not exist|message port|连接已断开|无法建立连接/i.test(message)
      ) {
        throw error;
      }

      await ensureChatPlusRuntime(siteTabId);
      await sendTabMessage(siteTabId, { type: "SYSTEM_INSTRUCTION_REFRESH" });
    }
  };

  const clearAutoSaveTimer = () => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  };

  const buildDraftConfig = () =>
    normalizeScheduledSendConfig({
      enabled: scheduleEnabledDraft,
      content: normalizeScheduledSendContent(scheduleContentDraft),
      startTime: normalizeScheduledSendTime(
        scheduleStartTimeDraft,
        DEFAULT_SCHEDULED_SEND_START_TIME,
      ),
      endTime: normalizeScheduledSendTime(scheduleEndTimeDraft, DEFAULT_SCHEDULED_SEND_END_TIME),
      intervalSeconds: normalizeScheduledSendIntervalSeconds(
        scheduleIntervalDraft,
        DEFAULT_SCHEDULED_SEND_INTERVAL_SECONDS,
      ),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

  const resetScheduleDrafts = (config?: ScheduledSendConfig | null) => {
    setScheduleEnabledDraft(config ? config.enabled !== false : false);
    setScheduleStartTimeDraft(
      normalizeScheduledSendTime(config?.startTime, DEFAULT_SCHEDULED_SEND_START_TIME),
    );
    setScheduleEndTimeDraft(
      normalizeScheduledSendTime(config?.endTime, DEFAULT_SCHEDULED_SEND_END_TIME),
    );
    setScheduleIntervalDraft(
      String(
        normalizeScheduledSendIntervalSeconds(
          config?.intervalSeconds,
          DEFAULT_SCHEDULED_SEND_INTERVAL_SECONDS,
        ),
      ),
    );
    setScheduleContentDraft(normalizeScheduledSendContent(config?.content));
    setScheduleError("");
  };

  const loadScheduledSendState = async () => {
    try {
      const storedState = await getStorage<{
        [SCHEDULED_SEND_TAB_CONFIG_STORAGE_KEY]: ScheduledSendTabConfigState;
      }>("session", {
        [SCHEDULED_SEND_TAB_CONFIG_STORAGE_KEY]: DEFAULT_SCHEDULED_SEND_TAB_CONFIG_STATE,
      });
      applyScheduledSendState(
        sanitizeScheduledSendState(
          storedState?.[SCHEDULED_SEND_TAB_CONFIG_STORAGE_KEY]?.configByTabId ||
            DEFAULT_SCHEDULED_SEND_TAB_CONFIG_STATE.configByTabId,
        ),
      );
      setScheduleError("");
    } catch (error) {
      setScheduleError(getErrorMessage(error));
    }
  };

  const resolveScheduledSendForTab = (tab: OrchestrationTab) => {
    const config = configByTabId[String(tab.tabId)] || null;
    return {
      config,
      hasScheduledSend: Boolean(config),
      isScheduledSendEnabled: isScheduledSendConfigEnabled(config),
      isScheduleOpen: openScheduleTabId === tab.tabId,
      summary: buildScheduledSendSummary(config),
    };
  };

  const openScheduleDialog = (tab: OrchestrationTab) => {
    if (openScheduleTabId === tab.tabId) {
      setOpenScheduleTabId(null);
      resetScheduleDrafts();
      return;
    }

    setOpenScheduleTabId(tab.tabId);
    resetScheduleDrafts(configRef.current[String(tab.tabId)] || null);
  };

  const closeScheduleDialog = () => {
    setOpenScheduleTabId(null);
    resetScheduleDrafts();
  };

  const persistScheduleDraft = async (tab: OrchestrationTab) => {
    const tabKey = String(tab.tabId);
    const previousConfig = configRef.current[tabKey] || null;
    const normalizedContent = normalizeScheduledSendContent(scheduleContentDraft);
    const nextConfig = buildDraftConfig();
    if (!nextConfig) return;

    const nextEnabled = Boolean(nextConfig.enabled && normalizedContent);
    const nextPersistedConfig: ScheduledSendConfig = {
      ...nextConfig,
      enabled: nextEnabled,
      createdAt: previousConfig?.createdAt || nextConfig.createdAt,
      updatedAt: Date.now(),
    };
    const isBlankDefaultDraft =
      !previousConfig &&
      !normalizedContent &&
      nextPersistedConfig.enabled === false &&
      nextPersistedConfig.startTime === DEFAULT_SCHEDULED_SEND_START_TIME &&
      nextPersistedConfig.endTime === DEFAULT_SCHEDULED_SEND_END_TIME &&
      nextPersistedConfig.intervalSeconds === DEFAULT_SCHEDULED_SEND_INTERVAL_SECONDS;
    if (isBlankDefaultDraft) return;
    const previousSignature = JSON.stringify(previousConfig || null);
    const nextSignature = JSON.stringify(nextPersistedConfig);
    if (previousSignature === nextSignature) return;

    if (nextConfig.enabled && !normalizedContent) {
      setScheduleError("发送内容为空时不能启用定时发送。");
      setScheduleEnabledDraft(false);
    } else if (scheduleError) {
      setScheduleError("");
    }

    try {
      const nextConfigByTabId = {
        ...configRef.current,
        [tabKey]: nextPersistedConfig,
      };
      const persistedConfigByTabId = await persistScheduledSendState(nextConfigByTabId);
      applyScheduledSendState(persistedConfigByTabId);
      await refreshScheduledSendRuntime(tab.tabId);
    } catch (error) {
      setScheduleError(getErrorMessage(error));
    }
  };

  const updateScheduleEnabledDraft = (value: boolean) => {
    if (value && !normalizeScheduledSendContent(scheduleContentDraft)) {
      setScheduleError("发送内容为空时不能启用定时发送。");
      setScheduleEnabledDraft(false);
      return;
    }
    setScheduleError("");
    setScheduleEnabledDraft(value);
  };

  const updateScheduleStartTimeDraft = (value: string) => {
    setScheduleError("");
    setScheduleStartTimeDraft(value);
  };

  const updateScheduleEndTimeDraft = (value: string) => {
    setScheduleError("");
    setScheduleEndTimeDraft(value);
  };

  const updateScheduleIntervalDraft = (value: string) => {
    setScheduleError("");
    setScheduleIntervalDraft(value);
  };

  const updateScheduleContentDraft = (value: string) => {
    setScheduleError("");
    setScheduleContentDraft(value);
    if (!normalizeScheduledSendContent(value) && scheduleEnabledDraft) {
      setScheduleEnabledDraft(false);
    }
  };

  useEffect(() => {
    if (!active) return;
    void loadScheduledSendState();
  }, [active]);

  useEffect(() => {
    if (openScheduleTabId === null) return undefined;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeScheduleDialog();
    };

    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [openScheduleTabId]);

  useEffect(() => {
    if (!openScheduleTab) return undefined;
    clearAutoSaveTimer();
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      void persistScheduleDraft(openScheduleTab);
    }, AUTO_SAVE_DEBOUNCE_MS);

    return () => clearAutoSaveTimer();
  }, [
    openScheduleTab,
    scheduleEnabledDraft,
    scheduleStartTimeDraft,
    scheduleEndTimeDraft,
    scheduleIntervalDraft,
    scheduleContentDraft,
  ]);

  useEffect(() => {
    const sanitizedConfigByTabId = sanitizeScheduledSendState(configRef.current);
    const prevSignature = JSON.stringify(configRef.current);
    const nextSignature = JSON.stringify(sanitizedConfigByTabId);

    if (prevSignature !== nextSignature) {
      applyScheduledSendState(sanitizedConfigByTabId);
      void persistScheduledSendState(sanitizedConfigByTabId);
    }
    if (openScheduleTabId !== null && !currentTabIds.includes(openScheduleTabId)) {
      setOpenScheduleTabId(null);
      setScheduleError("");
      resetScheduleDrafts();
    }
  }, [currentTabIds, openScheduleTabId]);

  useEffect(() => {
    if (!active) return undefined;

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      namespace: string,
    ) => {
      if (namespace === "session" && changes[SCHEDULED_SEND_TAB_CONFIG_STORAGE_KEY]) {
        void loadScheduledSendState();
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, [active, currentTabIds]);

  useEffect(() => () => clearAutoSaveTimer(), []);

  return {
    openScheduleTab,
    scheduleEnabledDraft,
    scheduleStartTimeDraft,
    scheduleEndTimeDraft,
    scheduleIntervalDraft,
    scheduleContentDraft,
    scheduleError,
    resolveScheduledSendForTab,
    openScheduleDialog,
    closeScheduleDialog,
    setScheduleEnabledDraft: updateScheduleEnabledDraft,
    setScheduleStartTimeDraft: updateScheduleStartTimeDraft,
    setScheduleEndTimeDraft: updateScheduleEndTimeDraft,
    setScheduleIntervalDraft: updateScheduleIntervalDraft,
    setScheduleContentDraft: updateScheduleContentDraft,
  };
}
