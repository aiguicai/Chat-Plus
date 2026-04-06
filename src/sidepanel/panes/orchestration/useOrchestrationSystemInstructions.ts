import { useEffect, useMemo, useRef, useState } from "react";

import { ensureChatPlusRuntime, getStorage, sendTabMessage, setStorage } from "../../lib/chrome";
import { getErrorMessage } from "../../lib/format";
import type { OrchestrationTab } from "../../types";
import {
  DEFAULT_SYSTEM_INSTRUCTION_PRESET_STORE,
  DEFAULT_SYSTEM_INSTRUCTION_SITE_SELECTION_STATE,
  DEFAULT_SYSTEM_INSTRUCTION_TAB_SELECTION_STATE,
  SYSTEM_INSTRUCTION_PRESETS_STORAGE_KEY,
  SYSTEM_INSTRUCTION_SITE_SELECTION_STORAGE_KEY,
  SYSTEM_INSTRUCTION_TAB_SELECTION_STORAGE_KEY,
  createSystemInstructionPreset,
  normalizeSystemInstructionContent,
  normalizeSystemInstructionName,
  normalizeSystemInstructionPresetStore,
  resolveSystemInstructionPreset,
  sanitizeSystemInstructionPresetIdBySiteKey,
  sanitizeSystemInstructionPresetIdByTabId,
  type SystemInstructionPresetStore,
  type SystemInstructionSiteSelectionMap,
  type SystemInstructionTabSelectionMap,
} from "../../../system-instructions/shared";
import {
  buildSiteToolScopeKey,
  type SiteSystemInstructionState,
  type TabSystemInstructionState,
} from "./shared";

type UseOrchestrationSystemInstructionsOptions = {
  active: boolean;
  tabs: OrchestrationTab[];
};

function hydrateTabPresetIdsFromSites(
  tabs: OrchestrationTab[],
  nextStore: SystemInstructionPresetStore,
  nextTabPresetIds: SystemInstructionTabSelectionMap,
  nextSitePresetIds: SystemInstructionSiteSelectionMap,
) {
  const hydratedTabPresetIds = { ...nextTabPresetIds };
  let hydrated = false;

  tabs.forEach((tab) => {
    const tabId = String(tab.tabId);
    const siteKey = buildSiteToolScopeKey(tab);
    const sitePresetId = siteKey ? nextSitePresetIds[siteKey] : "";
    if (hydratedTabPresetIds[tabId] || !sitePresetId) return;

    const presetExists = nextStore.presets.some((preset) => preset.id === sitePresetId);
    if (!presetExists) return;

    hydratedTabPresetIds[tabId] = sitePresetId;
    hydrated = true;
  });

  return {
    hydratedTabPresetIds,
    hydrated,
  };
}

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

export function useOrchestrationSystemInstructions({
  active,
  tabs,
}: UseOrchestrationSystemInstructionsOptions) {
  const safeTabs = Array.isArray(tabs) ? tabs : [];
  const [systemPresetStore, setSystemPresetStore] = useState<SystemInstructionPresetStore>(
    DEFAULT_SYSTEM_INSTRUCTION_PRESET_STORE,
  );
  const [presetIdByTabId, setPresetIdByTabId] = useState<SystemInstructionTabSelectionMap>({});
  const [presetIdBySiteKey, setPresetIdBySiteKey] = useState<SystemInstructionSiteSelectionMap>(
    {},
  );
  const [openSystemTabId, setOpenSystemTabId] = useState<number | null>(null);
  const [systemDialogMode, setSystemDialogMode] = useState<"select" | "create" | "edit">(
    "select",
  );
  const [systemInstructionError, setSystemInstructionError] = useState("");
  const [editingPresetId, setEditingPresetId] = useState("");
  const [pendingDeletePresetId, setPendingDeletePresetId] = useState("");
  const [presetNameDraft, setPresetNameDraft] = useState("");
  const [presetContentDraft, setPresetContentDraft] = useState("");
  const [presetFormError, setPresetFormError] = useState("");
  const [savingSystemInstruction, setSavingSystemInstruction] = useState(false);
  const presetStoreRef = useRef<SystemInstructionPresetStore>(DEFAULT_SYSTEM_INSTRUCTION_PRESET_STORE);
  const tabPresetRef = useRef<SystemInstructionTabSelectionMap>({});
  const sitePresetRef = useRef<SystemInstructionSiteSelectionMap>({});
  const currentTabIds = useMemo(() => safeTabs.map((tab) => tab.tabId), [safeTabs]);
  const openSystemTab = useMemo(
    () => safeTabs.find((tab) => tab.tabId === openSystemTabId) || null,
    [openSystemTabId, safeTabs],
  );
  const openSystemResolution = useMemo(
    () =>
      openSystemTab
        ? resolveSystemInstructionPreset({
            presets: systemPresetStore.presets,
            tabId: openSystemTab.tabId,
            siteKey: buildSiteToolScopeKey(openSystemTab),
            presetIdByTabId,
            presetIdBySiteKey,
          })
        : { presetId: "", preset: null, source: "none" as const },
    [openSystemTab, presetIdBySiteKey, presetIdByTabId, systemPresetStore.presets],
  );

  const applySystemInstructionState = (
    nextStore: SystemInstructionPresetStore,
    nextTabPresetIds: SystemInstructionTabSelectionMap,
    nextSitePresetIds: SystemInstructionSiteSelectionMap,
  ) => {
    presetStoreRef.current = nextStore;
    tabPresetRef.current = nextTabPresetIds;
    sitePresetRef.current = nextSitePresetIds;
    setSystemPresetStore(nextStore);
    setPresetIdByTabId(nextTabPresetIds);
    setPresetIdBySiteKey(nextSitePresetIds);
  };

  const resetPresetDrafts = () => {
    setEditingPresetId("");
    setPendingDeletePresetId("");
    setPresetNameDraft("");
    setPresetContentDraft("");
    setPresetFormError("");
  };

  const sanitizeSystemInstructionState = (
    nextStore: SystemInstructionPresetStore,
    nextTabPresetIds: SystemInstructionTabSelectionMap,
    nextSitePresetIds: SystemInstructionSiteSelectionMap,
  ) => {
    const sanitizedStore = normalizeSystemInstructionPresetStore(nextStore);
    const sanitizedTabPresetIds = sanitizeSystemInstructionPresetIdByTabId(
      sanitizedStore.presets,
      nextTabPresetIds,
      currentTabIds,
    );
    const sanitizedSitePresetIds = sanitizeSystemInstructionPresetIdBySiteKey(
      sanitizedStore.presets,
      nextSitePresetIds,
    );

    return {
      sanitizedStore,
      sanitizedTabPresetIds,
      sanitizedSitePresetIds,
    };
  };

  const persistSystemInstructionState = async (
    nextStore: SystemInstructionPresetStore,
    nextTabPresetIds: SystemInstructionTabSelectionMap,
    nextSitePresetIds: SystemInstructionSiteSelectionMap,
  ) => {
    const { sanitizedStore, sanitizedTabPresetIds, sanitizedSitePresetIds } =
      sanitizeSystemInstructionState(nextStore, nextTabPresetIds, nextSitePresetIds);
    const managedTabIds = collectManagedTabIds(
      currentTabIds,
      tabPresetRef.current,
      sanitizedTabPresetIds,
    );
    const storedTabState = await getStorage<{
      [SYSTEM_INSTRUCTION_TAB_SELECTION_STORAGE_KEY]: TabSystemInstructionState;
    }>("session", {
      [SYSTEM_INSTRUCTION_TAB_SELECTION_STORAGE_KEY]:
        DEFAULT_SYSTEM_INSTRUCTION_TAB_SELECTION_STATE,
    });
    const persistedTabPresetIds = sanitizeSystemInstructionPresetIdByTabId(
      sanitizedStore.presets,
      storedTabState?.[SYSTEM_INSTRUCTION_TAB_SELECTION_STORAGE_KEY]?.presetIdByTabId ||
        DEFAULT_SYSTEM_INSTRUCTION_TAB_SELECTION_STATE.presetIdByTabId,
    );
    const nextStoredTabPresetIds = { ...persistedTabPresetIds };
    managedTabIds.forEach((tabId) => {
      delete nextStoredTabPresetIds[tabId];
    });
    Object.entries(sanitizedTabPresetIds).forEach(([tabId, presetId]) => {
      nextStoredTabPresetIds[tabId] = presetId;
    });

    await Promise.all([
      setStorage("local", {
        [SYSTEM_INSTRUCTION_PRESETS_STORAGE_KEY]: sanitizedStore,
        [SYSTEM_INSTRUCTION_SITE_SELECTION_STORAGE_KEY]: {
          presetIdBySiteKey: sanitizedSitePresetIds,
        } satisfies SiteSystemInstructionState,
      }),
      setStorage("session", {
        [SYSTEM_INSTRUCTION_TAB_SELECTION_STORAGE_KEY]: {
          presetIdByTabId: nextStoredTabPresetIds,
        } satisfies TabSystemInstructionState,
      }),
    ]);

    return {
      sanitizedStore,
      sanitizedTabPresetIds: nextStoredTabPresetIds,
      sanitizedSitePresetIds,
    };
  };

  const refreshSystemInstructionRuntime = async (tabId: number) => {
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

  const syncResolvedSystemInstructionToTab = async (
    tab: OrchestrationTab,
    nextStore = presetStoreRef.current,
    nextTabPresetIds = tabPresetRef.current,
    nextSitePresetIds = sitePresetRef.current,
  ) => {
    resolveSystemInstructionPreset({
      presets: nextStore.presets,
      tabId: tab.tabId,
      siteKey: buildSiteToolScopeKey(tab),
      presetIdByTabId: nextTabPresetIds,
      presetIdBySiteKey: nextSitePresetIds,
    });
    await refreshSystemInstructionRuntime(tab.tabId);
  };

  const loadSystemInstructionState = async () => {
    try {
      const [storedPresets, storedTabState, storedSiteState] = await Promise.all([
        getStorage<{ [SYSTEM_INSTRUCTION_PRESETS_STORAGE_KEY]: SystemInstructionPresetStore }>(
          "local",
          {
            [SYSTEM_INSTRUCTION_PRESETS_STORAGE_KEY]:
              DEFAULT_SYSTEM_INSTRUCTION_PRESET_STORE,
          },
        ),
        getStorage<{
          [SYSTEM_INSTRUCTION_TAB_SELECTION_STORAGE_KEY]: TabSystemInstructionState;
        }>("session", {
          [SYSTEM_INSTRUCTION_TAB_SELECTION_STORAGE_KEY]:
            DEFAULT_SYSTEM_INSTRUCTION_TAB_SELECTION_STATE,
        }),
        getStorage<{
          [SYSTEM_INSTRUCTION_SITE_SELECTION_STORAGE_KEY]: SiteSystemInstructionState;
        }>("local", {
          [SYSTEM_INSTRUCTION_SITE_SELECTION_STORAGE_KEY]:
            DEFAULT_SYSTEM_INSTRUCTION_SITE_SELECTION_STATE,
        }),
      ]);

      const { sanitizedStore, sanitizedTabPresetIds, sanitizedSitePresetIds } =
        sanitizeSystemInstructionState(
          storedPresets?.[SYSTEM_INSTRUCTION_PRESETS_STORAGE_KEY] ||
            DEFAULT_SYSTEM_INSTRUCTION_PRESET_STORE,
          storedTabState?.[SYSTEM_INSTRUCTION_TAB_SELECTION_STORAGE_KEY]?.presetIdByTabId ||
            DEFAULT_SYSTEM_INSTRUCTION_TAB_SELECTION_STATE.presetIdByTabId,
          storedSiteState?.[SYSTEM_INSTRUCTION_SITE_SELECTION_STORAGE_KEY]?.presetIdBySiteKey ||
            DEFAULT_SYSTEM_INSTRUCTION_SITE_SELECTION_STATE.presetIdBySiteKey,
        );
      const { hydratedTabPresetIds, hydrated } = hydrateTabPresetIdsFromSites(
        safeTabs,
        sanitizedStore,
        sanitizedTabPresetIds,
        sanitizedSitePresetIds,
      );

      if (hydrated) {
        const {
          sanitizedStore: persistedStore,
          sanitizedTabPresetIds: persistedTabPresetIds,
          sanitizedSitePresetIds: persistedSitePresetIds,
        } = await persistSystemInstructionState(
          sanitizedStore,
          hydratedTabPresetIds,
          sanitizedSitePresetIds,
        );
        applySystemInstructionState(
          persistedStore,
          persistedTabPresetIds,
          persistedSitePresetIds,
        );
      } else {
        applySystemInstructionState(
          sanitizedStore,
          sanitizedTabPresetIds,
          sanitizedSitePresetIds,
        );
      }
      setSystemInstructionError("");
    } catch (error) {
      setSystemInstructionError(getErrorMessage(error));
    }
  };

  const resolveSystemForTab = (tab: OrchestrationTab) => {
    const siteKey = buildSiteToolScopeKey(tab);
    const resolution = resolveSystemInstructionPreset({
      presets: systemPresetStore.presets,
      tabId: tab.tabId,
      siteKey,
      presetIdByTabId,
      presetIdBySiteKey,
    });
    return {
      siteKey,
      resolution,
      selectedSystemPreset: resolution.preset,
      hasSystemInstruction: Boolean(resolution.preset),
      isSystemOpen: openSystemTabId === tab.tabId,
    };
  };

  const openSystemDialog = (tab: OrchestrationTab) => {
    if (openSystemTabId === tab.tabId) {
      if (!savingSystemInstruction) {
        setOpenSystemTabId(null);
        setSystemDialogMode("select");
        setSystemInstructionError("");
        resetPresetDrafts();
      }
      return;
    }

    setOpenSystemTabId(tab.tabId);
    setSystemDialogMode("select");
    setSystemInstructionError("");
    resetPresetDrafts();
  };

  const startCreatePreset = () => {
    setSystemDialogMode("create");
    setEditingPresetId("");
    setPendingDeletePresetId("");
    setSystemInstructionError("");
    setPresetFormError("");
    setPresetNameDraft("");
    setPresetContentDraft("");
  };

  const startEditPreset = (presetId: string) => {
    const preset = presetStoreRef.current.presets.find((item) => item.id === presetId);
    if (!preset) {
      setSystemInstructionError("未找到对应预设，请刷新后重试。");
      return;
    }

    setSystemDialogMode("edit");
    setEditingPresetId(preset.id);
    setPendingDeletePresetId("");
    setSystemInstructionError("");
    setPresetFormError("");
    setPresetNameDraft(preset.name);
    setPresetContentDraft(preset.content);
  };

  const closeSystemDialog = () => {
    if (savingSystemInstruction) return;
    setOpenSystemTabId(null);
    setSystemDialogMode("select");
    setSystemInstructionError("");
    resetPresetDrafts();
  };

  const cancelPresetForm = () => {
    if (savingSystemInstruction) return;
    setSystemDialogMode("select");
    resetPresetDrafts();
  };

  const updatePresetNameDraft = (value: string) => {
    setPresetNameDraft(value);
    if (presetFormError) setPresetFormError("");
  };

  const updatePresetContentDraft = (value: string) => {
    setPresetContentDraft(value);
    if (presetFormError) setPresetFormError("");
  };

  const savePresetDraftForTab = async () => {
    if (!openSystemTab) return;

    const normalizedName = normalizeSystemInstructionName(presetNameDraft);
    const normalizedContent = normalizeSystemInstructionContent(presetContentDraft);
    if (!normalizedName) {
      setPresetFormError("请输入预设名称。");
      return;
    }
    if (!normalizedContent) {
      setPresetFormError("请输入系统指令内容。");
      return;
    }

    const siteKey = buildSiteToolScopeKey(openSystemTab);
    if (!siteKey) {
      setPresetFormError("当前标签页缺少站点标识，暂时无法保存。");
      return;
    }

    const isEditing = systemDialogMode === "edit" && Boolean(editingPresetId);
    const createdPreset = isEditing
      ? null
      : createSystemInstructionPreset(normalizedName, normalizedContent);
    const nextPresetId = isEditing ? editingPresetId : createdPreset?.id || "";
    const nextStore = normalizeSystemInstructionPresetStore({
      presets: isEditing
        ? presetStoreRef.current.presets.map((preset) =>
            preset.id === editingPresetId
              ? {
                  ...preset,
                  name: normalizedName,
                  content: normalizedContent,
                  updatedAt: Date.now(),
                }
              : preset,
          )
        : [createdPreset!, ...presetStoreRef.current.presets],
      updatedAt: Date.now(),
    });
    const nextTabPresetIds = {
      ...tabPresetRef.current,
      [String(openSystemTab.tabId)]: nextPresetId,
    };
    const nextSitePresetIds = {
      ...sitePresetRef.current,
      [siteKey]: nextPresetId,
    };

    setSavingSystemInstruction(true);
    setPresetFormError("");
    setSystemInstructionError("");
    try {
      const { sanitizedStore, sanitizedTabPresetIds, sanitizedSitePresetIds } =
        await persistSystemInstructionState(
          nextStore,
          nextTabPresetIds,
          nextSitePresetIds,
        );
      applySystemInstructionState(
        sanitizedStore,
        sanitizedTabPresetIds,
        sanitizedSitePresetIds,
      );
      await syncResolvedSystemInstructionToTab(
        openSystemTab,
        sanitizedStore,
        sanitizedTabPresetIds,
        sanitizedSitePresetIds,
      );
      setOpenSystemTabId(null);
      setSystemDialogMode("select");
      resetPresetDrafts();
    } catch (error) {
      setPresetFormError(getErrorMessage(error));
    } finally {
      setSavingSystemInstruction(false);
    }
  };

  const togglePresetForTab = async (tab: OrchestrationTab, presetId: string) => {
    const normalizedPresetId = String(presetId || "").trim();
    const siteKey = buildSiteToolScopeKey(tab);
    if (!normalizedPresetId || !siteKey) return;

    const presetExists = presetStoreRef.current.presets.some(
      (preset) => preset.id === normalizedPresetId,
    );
    if (!presetExists) {
      setSystemInstructionError("未找到对应预设，请刷新后重试。");
      return;
    }

    const isSelected =
      resolveSystemInstructionPreset({
        presets: presetStoreRef.current.presets,
        tabId: tab.tabId,
        siteKey,
        presetIdByTabId: tabPresetRef.current,
        presetIdBySiteKey: sitePresetRef.current,
      }).presetId === normalizedPresetId;
    const nextTabPresetIds = { ...tabPresetRef.current };
    const nextSitePresetIds = { ...sitePresetRef.current };
    setPendingDeletePresetId("");

    if (isSelected) {
      delete nextTabPresetIds[String(tab.tabId)];
      delete nextSitePresetIds[siteKey];
    } else {
      nextTabPresetIds[String(tab.tabId)] = normalizedPresetId;
      nextSitePresetIds[siteKey] = normalizedPresetId;
    }

    setSavingSystemInstruction(true);
    setSystemInstructionError("");
    try {
      const { sanitizedStore, sanitizedTabPresetIds, sanitizedSitePresetIds } =
        await persistSystemInstructionState(
          presetStoreRef.current,
          nextTabPresetIds,
          nextSitePresetIds,
        );
      applySystemInstructionState(
        sanitizedStore,
        sanitizedTabPresetIds,
        sanitizedSitePresetIds,
      );
      await syncResolvedSystemInstructionToTab(
        tab,
        sanitizedStore,
        sanitizedTabPresetIds,
        sanitizedSitePresetIds,
      );
    } catch (error) {
      setSystemInstructionError(getErrorMessage(error));
    } finally {
      setSavingSystemInstruction(false);
    }
  };

  const deletePreset = async (presetId: string) => {
    const normalizedPresetId = String(presetId || "").trim();
    if (!normalizedPresetId) return;

    const nextStore = normalizeSystemInstructionPresetStore({
      presets: presetStoreRef.current.presets.filter(
        (preset) => preset.id !== normalizedPresetId,
      ),
      updatedAt: Date.now(),
    });

    setSavingSystemInstruction(true);
    setSystemInstructionError("");
    try {
      const { sanitizedStore, sanitizedTabPresetIds, sanitizedSitePresetIds } =
        await persistSystemInstructionState(
          nextStore,
          tabPresetRef.current,
          sitePresetRef.current,
        );
      applySystemInstructionState(
        sanitizedStore,
        sanitizedTabPresetIds,
        sanitizedSitePresetIds,
      );
      if (openSystemTab) {
        await syncResolvedSystemInstructionToTab(
          openSystemTab,
          sanitizedStore,
          sanitizedTabPresetIds,
          sanitizedSitePresetIds,
        );
      }
      if (editingPresetId === normalizedPresetId) {
        setSystemDialogMode("select");
        resetPresetDrafts();
      }
      setSystemDialogMode("select");
    } catch (error) {
      setSystemInstructionError(getErrorMessage(error));
    } finally {
      setSavingSystemInstruction(false);
    }
  };

  useEffect(() => {
    if (!active) return;
    void loadSystemInstructionState();
  }, [active]);

  useEffect(() => {
    if (openSystemTabId === null) return undefined;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeSystemDialog();
    };

    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [openSystemTabId, savingSystemInstruction]);

  useEffect(() => {
    const { sanitizedStore, sanitizedTabPresetIds, sanitizedSitePresetIds } =
      sanitizeSystemInstructionState(
        presetStoreRef.current,
        tabPresetRef.current,
        sitePresetRef.current,
      );
    const prevSystemSignature = JSON.stringify({
      store: presetStoreRef.current,
      tab: tabPresetRef.current,
      site: sitePresetRef.current,
    });
    const nextSystemSignature = JSON.stringify({
      store: sanitizedStore,
      tab: sanitizedTabPresetIds,
      site: sanitizedSitePresetIds,
    });

    if (prevSystemSignature !== nextSystemSignature) {
      applySystemInstructionState(
        sanitizedStore,
        sanitizedTabPresetIds,
        sanitizedSitePresetIds,
      );
      void persistSystemInstructionState(
        sanitizedStore,
        sanitizedTabPresetIds,
        sanitizedSitePresetIds,
      );
    }
    if (openSystemTabId !== null && !currentTabIds.includes(openSystemTabId)) {
      setOpenSystemTabId(null);
      setSystemDialogMode("select");
      setSystemInstructionError("");
      setPresetFormError("");
      setSavingSystemInstruction(false);
    }
  }, [currentTabIds, openSystemTabId]);

  useEffect(() => {
    if (!active) return undefined;

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      namespace: string,
    ) => {
      if (
        namespace === "local" &&
        (changes[SYSTEM_INSTRUCTION_PRESETS_STORAGE_KEY] ||
          changes[SYSTEM_INSTRUCTION_SITE_SELECTION_STORAGE_KEY])
      ) {
        void loadSystemInstructionState();
        return;
      }
      if (namespace === "session" && changes[SYSTEM_INSTRUCTION_TAB_SELECTION_STORAGE_KEY]) {
        void loadSystemInstructionState();
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, [active, currentTabIds, safeTabs]);

  return {
    systemPresetStore,
    openSystemTab,
    openSystemResolution,
    systemDialogMode,
    systemInstructionError,
    editingPresetId,
    pendingDeletePresetId,
    presetNameDraft,
    presetContentDraft,
    presetFormError,
    savingSystemInstruction,
    resolveSystemForTab,
    syncResolvedSystemInstructionToTab,
    openSystemDialog,
    closeSystemDialog,
    startCreatePreset,
    startEditPreset,
    cancelPresetForm,
    savePresetDraftForTab,
    togglePresetForTab,
    deletePreset,
    setPendingDeletePresetId,
    setPresetNameDraft: updatePresetNameDraft,
    setPresetContentDraft: updatePresetContentDraft,
  };
}
