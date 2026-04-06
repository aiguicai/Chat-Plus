export type Pane = "orchestration" | "site" | "tools" | "about";
export type Screen = "library" | "editor";
export type Tone = "neutral" | "success" | "warning" | "danger" | "active";
export type TipTone = "" | "cp-tip-ok" | "cp-tip-warn" | "cp-tip-err";

export type SiteConfig = {
  adapterScript?: string;
};

export type ConfigMap = Record<string, SiteConfig>;

export type Settings = {
  enabled: boolean;
  theme: string;
};

export type TabState = {
  id: number | null;
  url: string;
  title: string;
  host: string;
  pageSupported: boolean;
  pageConnected: boolean;
};

export type MonitorState = {
  ready: boolean;
  active: boolean;
};

export type TipState = {
  message: string;
  tone: TipTone;
};

export type OrchestrationColor =
  | "blue"
  | "orange"
  | "green"
  | "pink"
  | "cyan"
  | "red"
  | "purple"
  | "yellow";

export type OrchestrationTab = {
  tabId: number;
  order: number;
  host: string;
  title: string;
  url: string;
  favIconUrl: string;
  active: boolean;
  connected: boolean;
  desiredEnabled: boolean;
  enabled: boolean;
  groupColor: OrchestrationColor;
};
