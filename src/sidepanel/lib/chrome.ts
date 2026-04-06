const createTraceId = () =>
  `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type TabIdCollection = number | number[];
type GroupTabsOptions = Omit<chrome.tabs.GroupOptions, "tabIds"> & {
  tabIds: TabIdCollection;
};
type StorageAreaName = "sync" | "local" | "session";
type ChromeWithScripting = typeof chrome & {
  scripting?: {
    executeScript?: (
      injection: {
        target: { tabId: number; allFrames?: boolean };
        files: string[];
        world?: "MAIN" | "ISOLATED";
      },
      callback?: () => void,
    ) => void;
  };
};

const normalizeTabIds = (
  tabIds: TabIdCollection,
): number | [number, ...number[]] =>
  Array.isArray(tabIds)
    ? tabIds.length === 1
      ? tabIds[0]
      : (tabIds as [number, ...number[]])
    : tabIds;

const getStorageArea = (area: StorageAreaName) =>
  area === "session" ? chrome.storage.session : chrome.storage[area];

export const getStorage = <T,>(area: StorageAreaName, keys: any) =>
  new Promise<T>((resolve) =>
    getStorageArea(area).get(keys, (result) => resolve(result as T)),
  );

export const setStorage = (area: StorageAreaName, value: any) =>
  new Promise<void>((resolve) =>
    getStorageArea(area).set(value, () => resolve()),
  );

export const queryTabs = (queryInfo: chrome.tabs.QueryInfo) =>
  new Promise<chrome.tabs.Tab[]>((resolve) =>
    chrome.tabs.query(queryInfo, resolve),
  );

export const groupTabs = (options: GroupTabsOptions) =>
  new Promise<number>((resolve, reject) =>
    chrome.tabs.group(
      { ...options, tabIds: normalizeTabIds(options.tabIds) },
      (groupId) =>
        chrome.runtime.lastError
          ? reject(new Error(chrome.runtime.lastError.message))
          : resolve(groupId),
    ),
  );

export const ungroupTabs = (tabIds: TabIdCollection) =>
  new Promise<void>((resolve, reject) =>
    chrome.tabs.ungroup(normalizeTabIds(tabIds), () =>
      chrome.runtime.lastError
        ? reject(new Error(chrome.runtime.lastError.message))
        : resolve(),
    ),
  );

export const getTabGroup = (groupId: number) =>
  new Promise<chrome.tabGroups.TabGroup>((resolve, reject) =>
    chrome.tabGroups.get(groupId, (group) =>
      chrome.runtime.lastError
        ? reject(new Error(chrome.runtime.lastError.message))
        : resolve(group),
    ),
  );

export const updateTabGroup = (
  groupId: number,
  updateProperties: chrome.tabGroups.UpdateProperties,
) =>
  new Promise<chrome.tabGroups.TabGroup>((resolve, reject) =>
    chrome.tabGroups.update(groupId, updateProperties, (group) =>
      chrome.runtime.lastError
        ? reject(new Error(chrome.runtime.lastError.message))
        : resolve(group),
    ),
  );

export const reloadTab = (tabId: number) =>
  new Promise<void>((resolve, reject) =>
    chrome.tabs.reload(tabId, () =>
      chrome.runtime.lastError
        ? reject(new Error(chrome.runtime.lastError.message))
        : resolve(),
    ),
  );

export const activateTab = (tabId: number) =>
  new Promise<chrome.tabs.Tab>((resolve, reject) =>
    chrome.tabs.update(tabId, { active: true }, (tab) =>
      chrome.runtime.lastError
        ? reject(new Error(chrome.runtime.lastError.message))
        : resolve(tab),
    ),
  );

export const createTab = (createProperties: chrome.tabs.CreateProperties) =>
  new Promise<chrome.tabs.Tab>((resolve, reject) =>
    chrome.tabs.create(createProperties, (tab) =>
      chrome.runtime.lastError
        ? reject(new Error(chrome.runtime.lastError.message))
        : resolve(tab),
    ),
  );

export const getTabFrames = (tabId: number) =>
  new Promise<Array<{ frameId: number; parentFrameId: number; url?: string }>>(
    (resolve, reject) =>
      chrome.runtime.sendMessage(
        { type: "GET_TAB_FRAMES", tabId },
        (response) =>
          chrome.runtime.lastError
            ? reject(new Error(chrome.runtime.lastError.message))
            : resolve(Array.isArray(response?.frames) ? response.frames : []),
      ),
  );

export function sendRuntimeMessage<T = any>(message: any) {
  return new Promise<T>((resolve, reject) =>
    chrome.runtime.sendMessage(message, (response) =>
      chrome.runtime.lastError
        ? reject(new Error(chrome.runtime.lastError.message))
        : resolve(response as T),
    ),
  );
}

export function sendTabMessage<T = any>(
  tabId: number,
  message: any,
  options: chrome.tabs.MessageSendOptions = {},
) {
  return new Promise<T>((resolve, reject) =>
    chrome.tabs.sendMessage(
      tabId,
      { ...message, __cpTraceId: message?.__cpTraceId || createTraceId() },
      options,
      (response) =>
        chrome.runtime.lastError
          ? reject(new Error(chrome.runtime.lastError.message))
          : resolve(response as T),
    ),
  );
}

export async function ensureChatPlusRuntime(tabId: number) {
  const chromeWithScripting = chrome as ChromeWithScripting;
  const executeScript = chromeWithScripting.scripting?.executeScript;
  if (!executeScript) {
    throw new Error("当前浏览器不支持脚本重注入");
  }

  const inject = (
    files: string[],
    world: "MAIN" | "ISOLATED",
  ) =>
    new Promise<void>((resolve, reject) =>
      executeScript(
        {
          target: { tabId, allFrames: true },
          files,
          world,
        },
        () =>
          chrome.runtime.lastError
            ? reject(new Error(chrome.runtime.lastError.message))
            : resolve(),
      ),
    );

  await inject(
    [
      "page-monitor/page-monitor-shared.js",
      "page-monitor/page-monitor-http.js",
      "page-monitor/page-monitor-streams.js",
      "page-monitor/page-monitor-main.js",
    ],
    "MAIN",
  );
  await inject(["content/content-main.js"], "ISOLATED");
}
