import {
  getStoredMcpState,
  handleMcpBackgroundMessage,
  resolveEffectiveEnabledToolsByServer,
} from "./mcp";
import {
  SITE_CONFIG_MAP_STORAGE_KEY,
  readStoredSiteConfigMap,
  isSiteConfigEnabled,
  normalizeSiteConfig,
} from "../sidepanel/lib/siteConfig";
import {
  DEFAULT_SYSTEM_INSTRUCTION_PRESET_STORE,
  DEFAULT_SYSTEM_INSTRUCTION_SITE_SELECTION_STATE,
  DEFAULT_SYSTEM_INSTRUCTION_TAB_SELECTION_STATE,
  SYSTEM_INSTRUCTION_PRESETS_STORAGE_KEY,
  SYSTEM_INSTRUCTION_SITE_SELECTION_STORAGE_KEY,
  SYSTEM_INSTRUCTION_TAB_SELECTION_STORAGE_KEY,
  normalizeSystemInstructionPresetStore,
  resolveSystemInstructionPreset,
  sanitizeSystemInstructionPresetIdBySiteKey,
  sanitizeSystemInstructionPresetIdByTabId,
} from "../system-instructions/shared";
import { filterConfigToEnabledTools, normalizeSiteToolScopeKey } from "../mcp/shared";
import { buildCodeModeSystemInstruction } from "../mcp/code-mode";
import { CHAT_PLUS_PROTOCOL } from "../shared/chatplus-protocol";

// ===== Chat Plus - Background Service Worker =====

const DEFAULT_SYNC_SETTINGS = {
  theme: 'dark',
  enabled: true
};
const CHROME_SIDE_PANEL_KEY = 'side' + 'Panel';
const OPEN_METHOD_KEY = 'open';
const SET_PANEL_BEHAVIOR_METHOD_KEY = 'setPanelBehavior';

const browserRuntime = globalThis as typeof globalThis & {
  browser?: {
    sidebarAction?: {
      open?: () => Promise<void> | void;
    };
  };
};
const chromeWithSidebarAction = chrome as typeof chrome & {
  sidebarAction?: {
    open?: () => Promise<void> | void;
  };
};
const chromeWithDynamicApis = chrome as typeof chrome & {
  [CHROME_SIDE_PANEL_KEY]?: {
    [OPEN_METHOD_KEY]?: (options: { tabId?: number; windowId?: number }) => Promise<void> | void;
    [SET_PANEL_BEHAVIOR_METHOD_KEY]?: (options: { openPanelOnActionClick: boolean }) => Promise<void> | void;
  };
};

function handlePromise(promise, onSuccess, onError) {
  if (!promise || typeof promise.then !== 'function') {
    if (typeof onSuccess === 'function') onSuccess();
    return;
  }
  promise.then(
    (value) => { if (typeof onSuccess === 'function') onSuccess(value); },
    (error) => { if (typeof onError === 'function') onError(error); }
  );
}

function ensureDefaultSettings() {
  chrome.storage.sync.get(Object.keys(DEFAULT_SYNC_SETTINGS), (stored) => {
    const nextSettings = {};
    Object.entries(DEFAULT_SYNC_SETTINGS).forEach(([key, value]) => {
      if (stored[key] === undefined) nextSettings[key] = value;
    });
    if (Object.keys(nextSettings).length) chrome.storage.sync.set(nextSettings);
  });
}

function configureSidePanelBehavior() {
  const sidePanel = chromeWithDynamicApis[CHROME_SIDE_PANEL_KEY];
  const setPanelBehavior = sidePanel?.[SET_PANEL_BEHAVIOR_METHOD_KEY];
  if (!setPanelBehavior) return;
  handlePromise(
    setPanelBehavior({ openPanelOnActionClick: true }),
    null,
    () => {}
  );
}

function getFirefoxSidebarAction() {
  return browserRuntime.browser?.sidebarAction || chromeWithSidebarAction.sidebarAction || null;
}

function openExtensionSidebar(tabId, windowId, sendResponse) {
  const sidePanel = chromeWithDynamicApis[CHROME_SIDE_PANEL_KEY];
  const openChromeSidePanel = sidePanel?.[OPEN_METHOD_KEY];

  if (openChromeSidePanel) {
    if (!tabId && !windowId) {
      sendResponse({ success: false, error: '缺少可用的标签页上下文' });
      return false;
    }
    try {
      handlePromise(
        openChromeSidePanel(tabId ? { tabId } : { windowId }),
        () => sendResponse({ success: true }),
        (error) => sendResponse({ success: false, error: error?.message || '打开侧边栏失败' })
      );
    } catch (error) {
      sendResponse({ success: false, error: error?.message || '打开侧边栏失败' });
    }
    return true;
  }

  const sidebarAction = getFirefoxSidebarAction();
  if (!sidebarAction?.open) {
    sendResponse({ success: false, error: '当前浏览器不支持主动打开侧边栏' });
    return false;
  }
  try {
    handlePromise(
      sidebarAction.open(),
      () => sendResponse({ success: true }),
      (error) => sendResponse({ success: false, error: error?.message || '打开侧边栏失败' })
    );
  } catch (error) {
    sendResponse({ success: false, error: error?.message || '打开侧边栏失败' });
  }
  return true;
}

function registerActionClickHandler() {
  if (chromeWithDynamicApis[CHROME_SIDE_PANEL_KEY]?.[SET_PANEL_BEHAVIOR_METHOD_KEY]) return;
  const sidebarAction = getFirefoxSidebarAction();
  if (!sidebarAction?.open || !chrome.action?.onClicked) return;
  chrome.action.onClicked.addListener(() => {
    handlePromise(
      sidebarAction.open(),
      null,
      () => {}
    );
  });
}

function getSiteScopeKeyFromSender(sender) {
  const candidateUrl =
    String(sender?.tab?.url || "").trim() ||
    String(sender?.url || "").trim() ||
    String(sender?.documentUrl || "").trim();
  if (!candidateUrl) return "";
  try {
    return normalizeSiteToolScopeKey(new URL(candidateUrl).hostname);
  } catch {
    return "";
  }
}

function joinInstructionSections(sections: Array<string | undefined | null>) {
  return sections
    .map((section) => String(section || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

async function resolveSystemInstructionContext(sender) {
  const tabId = sender?.tab?.id;
  const siteKey = getSiteScopeKeyFromSender(sender);

  const [localState, sessionState] = await Promise.all([
    new Promise<Record<string, unknown>>((resolve) => {
      chrome.storage.local.get(
        [
          SITE_CONFIG_MAP_STORAGE_KEY,
          SYSTEM_INSTRUCTION_PRESETS_STORAGE_KEY,
          SYSTEM_INSTRUCTION_SITE_SELECTION_STORAGE_KEY,
        ],
        (result) => resolve(result as Record<string, unknown>),
      );
    }),
    new Promise<Record<string, unknown>>((resolve) => {
      chrome.storage.session.get(
        [SYSTEM_INSTRUCTION_TAB_SELECTION_STORAGE_KEY],
        (result) => resolve(result as Record<string, unknown>),
      );
    }),
  ]);

  const presetStore = normalizeSystemInstructionPresetStore(
    localState[SYSTEM_INSTRUCTION_PRESETS_STORAGE_KEY] || DEFAULT_SYSTEM_INSTRUCTION_PRESET_STORE,
  );
  const presetIdByTabId = sanitizeSystemInstructionPresetIdByTabId(
    presetStore.presets,
    ((sessionState[SYSTEM_INSTRUCTION_TAB_SELECTION_STORAGE_KEY] || DEFAULT_SYSTEM_INSTRUCTION_TAB_SELECTION_STATE) as Record<string, unknown>).presetIdByTabId,
    typeof tabId === "number" ? [tabId] : undefined,
  );
  const presetIdBySiteKey = sanitizeSystemInstructionPresetIdBySiteKey(
    presetStore.presets,
    ((localState[SYSTEM_INSTRUCTION_SITE_SELECTION_STORAGE_KEY] || DEFAULT_SYSTEM_INSTRUCTION_SITE_SELECTION_STATE) as Record<string, unknown>).presetIdBySiteKey,
    siteKey ? [siteKey] : undefined,
  );
  const resolvedPreset = resolveSystemInstructionPreset({
    presets: presetStore.presets,
    tabId, siteKey, presetIdByTabId, presetIdBySiteKey,
  });

  const normalizedSiteConfigMap = readStoredSiteConfigMap(localState);
  const siteConfig = siteKey
    ? normalizeSiteConfig((normalizedSiteConfigMap[siteKey] as any) || {})
    : normalizeSiteConfig({});
  const tabPluginEnabled = !siteKey || isSiteConfigEnabled(siteConfig);
  const adapterScript = String(siteConfig?.adapterScript || "").trim();

  const mcpState = await getStoredMcpState();
  const enabledToolsByServer = await resolveEffectiveEnabledToolsByServer(mcpState, { tabId, siteKey, host: siteKey });
  const enabledToolConfig = filterConfigToEnabledTools(mcpState.config, enabledToolsByServer);
  const codeMode = buildCodeModeSystemInstruction(enabledToolConfig);
  const resolvedContent = joinInstructionSections([
    resolvedPreset.preset?.content || "",
    codeMode.content,
  ]);

  return {
    ok: true,
    tabPluginEnabled,
    presetId: resolvedPreset.presetId,
    presetName: resolvedPreset.preset?.name || "",
    content: tabPluginEnabled ? resolvedContent : "",
    source: resolvedPreset.source,
    adapterScript: tabPluginEnabled ? adapterScript : "",
    protocol: CHAT_PLUS_PROTOCOL,
    codeModeManifest: tabPluginEnabled ? codeMode.manifest : { servers: [], docs: [] },
  };
}

chrome.runtime.onInstalled.addListener(() => {
  ensureDefaultSettings();
  configureSidePanelBehavior();
});

if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    configureSidePanelBehavior();
  });
}

configureSidePanelBehavior();
registerActionClickHandler();

async function handleRuntimeMessage(message, sender) {
  const senderSiteKey = getSiteScopeKeyFromSender(sender);
  const enrichedMcpMessage =
    message?.type === "MCP_TOOL_CALL"
      ? {
          ...message,
          tabId: message?.tabId || sender?.tab?.id,
          siteKey: message?.siteKey || senderSiteKey,
          host: message?.host || senderSiteKey,
        }
      : message;
  const mcpResponse = await handleMcpBackgroundMessage(enrichedMcpMessage);
  if (mcpResponse !== undefined) return mcpResponse;

  if (message.type === 'GET_SETTINGS') {
    const settings = await new Promise((resolve) => {
      chrome.storage.sync.get(null, (result) => resolve(result));
    });
    return { settings };
  }

  if (message.type === 'SAVE_SETTINGS') {
    await new Promise((resolve) => {
      chrome.storage.sync.set(message.settings, () => resolve(null));
    });
    return { success: true };
  }

  if (message.type === 'GET_TAB_FRAMES') {
    if (!message.tabId || !chrome.webNavigation?.getAllFrames) return { frames: [] };
    return new Promise((resolve) => {
      chrome.webNavigation.getAllFrames({ tabId: message.tabId }, (frames) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message, frames: [] });
          return;
        }
        resolve({ success: true, frames: Array.isArray(frames) ? frames : [] });
      });
    });
  }

  if (message.type === "SYSTEM_INSTRUCTION_RESOLVE") {
    return resolveSystemInstructionContext(sender);
  }

  return false;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleRuntimeMessage(message, sender)
    .then((response) => { sendResponse(response); })
    .catch((error) => {
      sendResponse({ ok: false, error: error?.message || 'Unknown background error' });
    });
  return true;
});
