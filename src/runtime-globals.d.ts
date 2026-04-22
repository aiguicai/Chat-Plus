type ChatPlusRuntimeMessage =
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; settings: Record<string, unknown> }
  | { type: "GET_TAB_FRAMES"; tabId: number }
  | { type: "SYSTEM_INSTRUCTION_RESOLVE" }
  | { type: "SYSTEM_INSTRUCTION_REFRESH" }
  | { type: "SCHEDULED_SEND_SET_ENABLED"; enabled: boolean }
  | {
      type: "SYSTEM_INSTRUCTION_APPLY";
      content?: string;
      protocol?: Record<string, unknown>;
      scheduledSendConfig?: Record<string, unknown> | null;
    }
  | { type: "GET_PAGE_CONTEXT" }
  | { type: "CHATPLUS_CONTENT_READY"; context: ChatPlusPageContext }
  | { type: "CHATPLUS_MONITOR_READY" }
  | { type: "CHATPLUS_MONITOR_STATE"; active: boolean };

type ChatPlusMonitorResult = {
  type?: "ready" | "state" | "result" | "injection";
  id?: number;
  observedAt?: number;
  source?: "fetch" | "xhr" | "eventsource" | "websocket";
  method?: string;
  endpoint?: string;
  status?: number | string;
  responseContentType?: string;
  requestHeaders?: Record<string, string>;
  requestPreview?: string;
  responsePreview?: string;
  requestMessagePath?: string;
  requestMessagePreview?: string;
  responseContentPath?: string;
  responseContentPreview?: string;
  previewText?: string;
  streamReasons?: string[];
  matched?: boolean;
  matchScore?: number;
  active?: boolean;
  responseFinal?: boolean;
  requestInjectionText?: string;
  requestInjectionMode?: "system" | "raw";
  protocol?: Record<string, unknown>;
};

type ChatPlusPageContext = {
  host: string;
  title: string;
  url: string;
  frameId?: number;
  isTopFrame?: boolean;
  monitorReady: boolean;
  monitorActive: boolean;
};

type ChatPlusPageMonitorPayload = {
  type?: "ready" | "state" | "result" | "injection";
  active?: boolean;
  id?: number;
  observedAt?: number;
  source?: "fetch" | "xhr" | "eventsource" | "websocket";
  method?: string;
  endpoint?: string;
  status?: number | string;
  responseContentType?: string;
  requestPreview?: string;
  responsePreview?: string;
  previewText?: string;
  requestHeaders?: Record<string, string>;
  requestMessagePath?: string;
  requestMessagePreview?: string;
  responseContentPath?: string;
  responseContentPreview?: string;
  adapterScript?: string;
  streamReasons?: string[];
  responseFinal?: boolean;
  requestInjectionText?: string;
  requestInjectionMode?: "system" | "raw";
  protocol?: Record<string, unknown>;
};

type ChatPlusPageMonitorApi = {
  CONTROL_EVENT: string;
  RESULT_EVENT: string;
  ADAPTER_REQUEST_EVENT: string;
  ADAPTER_RESPONSE_EVENT: string;
  RESPONSE_PREVIEW_TIMEOUT: number;
  state: {
    isActive: boolean;
    isEnabled: boolean;
    requestInjectionText: string;
    requestInjectionMode: "system" | "raw";
    adapterScript?: string;
    protocol?: Record<string, any>;
    sequence: number;
    adapterRequestSequence?: number;
  };
  emit: (payload: ChatPlusPageMonitorPayload) => void;
  emitResult: (candidate: ChatPlusPageMonitorPayload) => void;
  parseJsonDetail: (detail: unknown) => Record<string, any> | null;
  normalizeInjectionText: (value: unknown) => string;
  buildInjectedText: (
    injectionText: unknown,
    originalText: unknown,
    injectionMode?: "system" | "raw",
  ) => string;
  unique: (values: Array<string | undefined | null>) => string[];
  toAbsoluteUrl: (value: unknown) => string;
  headersToObject: (headersLike: unknown) => Record<string, string>;
  serializeBody: (body: unknown) => string;
  detectStreamReasons: (params: {
    endpoint?: string;
    requestHeaders?: Record<string, string>;
    requestPreview?: string;
    responseContentType?: string;
    responsePreview?: string;
    source?: "fetch" | "xhr" | "eventsource" | "websocket";
  }) => string[];
  isRelevantEndpoint: (endpoint?: string) => boolean;
  createAdapterHelpers?: () => Record<string, any>;
  runAdapterHook?: (name: string, payload?: Record<string, any>) => Promise<any | null>;
  patchFetch?: () => void;
  patchXHR?: () => void;
  patchEventSource?: () => void;
  patchWebSocket?: () => void;
};

type ChatPlusXhrTracker = {
  method: string;
  endpoint: string;
  requestHeaders: Record<string, string>;
  requestPreview: string;
  requestMessagePath?: string;
  requestMessagePreview?: string;
  async?: boolean;
  listenersAttached?: boolean;
  injectionApplied?: boolean;
  requestInjectionText?: string;
  requestInjectionMode?: "system" | "raw";
  reported: boolean;
  lastReportedPreview: string;
  lastReportedAt: number;
  lastReportedReadyState: number;
  bufferedMatchedContentPreview?: string;
  bufferedMatchedContentPath?: string;
};

interface Window {
  __chatPlusContentBridgeInstalled?: boolean;
  __chatPlusPageMonitorInstalled?: boolean;
  ChatPlusPageMonitor?: ChatPlusPageMonitorApi;
}

interface XMLHttpRequest {
  __chatPlusMonitor?: ChatPlusXhrTracker;
}
