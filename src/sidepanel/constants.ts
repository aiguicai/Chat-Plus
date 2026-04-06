import type {
  MonitorState,
  Settings,
  TabState,
  TipState,
} from "./types";

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  theme: "dark",
};

export const DEFAULT_TAB: TabState = {
  id: null,
  url: "",
  title: "",
  host: "",
  pageSupported: false,
  pageConnected: false,
};

export const DEFAULT_MONITOR: MonitorState = {
  ready: false,
  active: false,
};

export const DEFAULT_TIP: TipState = {
  message: "",
  tone: "",
};
