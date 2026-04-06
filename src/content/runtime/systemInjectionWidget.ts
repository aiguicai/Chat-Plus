import {
  SYSTEM_INJECTION_WIDGET_ID,
  SYSTEM_INJECTION_WIDGET_POSITION_STORAGE_KEY,
  type ContentRuntimeState,
} from "./contentRuntimeState";

type CreateSystemInjectionWidgetControllerOptions = {
  state: ContentRuntimeState;
  shouldShowSystemInjectionWidget: () => boolean;
  setCodeModeAutoContinueEnabled: (value: unknown, persist?: boolean) => void;
  setSystemInjectionArmed: (armed: boolean, reason?: "" | "config" | "manual" | "url") => void;
  getSystemInjectionStatusText: () => string;
  syncRequestInjectionToMonitor: () => void;
  sendContextCompressionRequest: () => Promise<{
    ok: boolean;
    error?: string;
    delivery?: "sent" | "filled";
  }>;
};

export function createSystemInjectionWidgetController({
  state,
  shouldShowSystemInjectionWidget,
  setCodeModeAutoContinueEnabled,
  setSystemInjectionArmed,
  getSystemInjectionStatusText,
  syncRequestInjectionToMonitor,
  sendContextCompressionRequest,
}: CreateSystemInjectionWidgetControllerOptions) {
  const COLLAPSED_WIDGET_SIZE = 56;
  const EXPANDED_WIDGET_WIDTH = 248;
  const COMPRESS_REQUEST_COOLDOWN_MS = 5000;

  function setCompressRequestState(
    status: "idle" | "error" | "cooldown",
    message = "",
    running = false,
  ) {
    state.systemInjectionWidget.compressRequestRunning = running;
    state.systemInjectionWidget.compressRequestStatus = status;
    state.systemInjectionWidget.compressRequestMessage = message;
  }

  function clearCompressCooldownTimer() {
    if (state.systemInjectionWidget.compressCooldownTimerId) {
      window.clearTimeout(state.systemInjectionWidget.compressCooldownTimerId);
      state.systemInjectionWidget.compressCooldownTimerId = 0;
    }
  }

  function isCompressRequestCoolingDown() {
    return Date.now() < Number(state.systemInjectionWidget.compressCooldownUntil || 0);
  }

  function startCompressRequestCooldown(message: string) {
    clearCompressCooldownTimer();
    state.systemInjectionWidget.compressCooldownUntil = Date.now() + COMPRESS_REQUEST_COOLDOWN_MS;
    setCompressRequestState("cooldown", message, false);
    state.systemInjectionWidget.compressCooldownTimerId = window.setTimeout(() => {
      state.systemInjectionWidget.compressCooldownTimerId = 0;
      state.systemInjectionWidget.compressCooldownUntil = 0;
      if (state.systemInjectionWidget.compressRequestStatus === "cooldown") {
        setCompressRequestState("idle");
      }
      renderSystemInjectionWidget();
    }, COMPRESS_REQUEST_COOLDOWN_MS);
  }

  function readSystemInjectionWidgetPosition(): {
    left: number;
    top: number;
    collapsed: boolean;
    dockSide: "left" | "right";
  } | null {
    try {
      const raw = window.sessionStorage.getItem(SYSTEM_INJECTION_WIDGET_POSITION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const left = Number(parsed.left);
      const top = Number(parsed.top);
      const collapsed = parsed.collapsed === true;
      const dockSide = parsed.dockSide === "left" ? "left" : "right";
      if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
      return { left, top, collapsed, dockSide };
    } catch {
      return null;
    }
  }

  function saveSystemInjectionWidgetPosition(left: number, top: number) {
    try {
      window.sessionStorage.setItem(
        SYSTEM_INJECTION_WIDGET_POSITION_STORAGE_KEY,
        JSON.stringify({
          left,
          top,
          collapsed: state.systemInjectionWidget.collapsed,
          dockSide: state.systemInjectionWidget.dockSide,
        }),
      );
    } catch {
      // Ignore storage failures.
    }
  }

  function clampSystemInjectionWidgetPosition(
    left: number,
    top: number,
    width: number,
    height: number,
  ) {
    const margin = 12;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);
    return {
      left: Math.min(Math.max(margin, left), maxLeft),
      top: Math.min(Math.max(margin, top), maxTop),
    };
  }

  function getSystemInjectionWidgetDockSide(left: number, width: number) {
    const centerX = left + width / 2;
    return centerX <= window.innerWidth / 2 ? "left" : "right";
  }

  function applySystemInjectionWidgetPosition(
    root: HTMLDivElement,
    left: number,
    top: number,
    sizeOverride?: {
      width?: number;
      height?: number;
    },
  ) {
    const rect = root.getBoundingClientRect();
    const width = sizeOverride?.width || rect.width || root.offsetWidth || EXPANDED_WIDGET_WIDTH;
    const height = sizeOverride?.height || rect.height || root.offsetHeight || 64;
    const nextPosition = clampSystemInjectionWidgetPosition(left, top, width, height);
    root.style.left = `${nextPosition.left}px`;
    root.style.top = `${nextPosition.top}px`;
    root.style.right = "auto";
  }

  function getSystemInjectionWidgetTargetWidth(collapsed: boolean) {
    return collapsed ? COLLAPSED_WIDGET_SIZE : EXPANDED_WIDGET_WIDTH;
  }

  function snapSystemInjectionWidgetToEdge(
    root: HTMLDivElement,
    collapsed = state.systemInjectionWidget.collapsed,
  ) {
    const rect = root.getBoundingClientRect();
    const margin = 12;
    const targetWidth = getSystemInjectionWidgetTargetWidth(collapsed);
    const expandedLeft =
      state.systemInjectionWidget.dockSide === "left"
        ? margin
        : Math.max(margin, window.innerWidth - targetWidth - margin);
    applySystemInjectionWidgetPosition(root, expandedLeft, rect.top, {
      width: targetWidth,
    });
  }

  function setSystemInjectionWidgetCollapsed(collapsed: boolean) {
    const root = ensureSystemInjectionWidget();
    if (!root) return;
    state.systemInjectionWidget.collapsed = collapsed;
    if (collapsed) {
      const rect = root.getBoundingClientRect();
      state.systemInjectionWidget.dockSide = getSystemInjectionWidgetDockSide(
        rect.left,
        rect.width || COLLAPSED_WIDGET_SIZE,
      );
      snapSystemInjectionWidgetToEdge(root, true);
    } else {
      const rect = root.getBoundingClientRect();
      const margin = 12;
      const expandedLeft =
        state.systemInjectionWidget.dockSide === "left"
          ? margin
          : Math.max(margin, window.innerWidth - EXPANDED_WIDGET_WIDTH - margin);
      applySystemInjectionWidgetPosition(root, expandedLeft, rect.top, {
        width: EXPANDED_WIDGET_WIDTH,
      });
    }
    saveSystemInjectionWidgetPosition(root.getBoundingClientRect().left, root.getBoundingClientRect().top);
    renderSystemInjectionWidget();
  }

  function ensureSystemInjectionWidget() {
    if (window.top !== window) return null;

    const cachedRoot = state.systemInjectionWidget.root;
    if (cachedRoot?.isConnected) {
      return cachedRoot;
    }

    const savedPosition = readSystemInjectionWidgetPosition();
    if (savedPosition) {
      state.systemInjectionWidget.collapsed = savedPosition.collapsed;
      state.systemInjectionWidget.dockSide = savedPosition.dockSide;
    }

    const existingRoot = document.getElementById(SYSTEM_INJECTION_WIDGET_ID) as HTMLDivElement | null;
    if (existingRoot?.isConnected) {
      const existingPanel = existingRoot.querySelector("[data-role='panel']") as HTMLDivElement | null;
      const existingBall = existingRoot.querySelector("[data-role='ball']") as HTMLDivElement | null;
      const existingDragHandle = existingRoot.querySelector(
        "[data-role='drag-handle']",
      ) as HTMLDivElement | null;
      const existingCollapseButton = existingRoot.querySelector(
        "[data-role='collapse']",
      ) as HTMLButtonElement | null;
      const existingAutoContinueToggle = existingRoot.querySelector(
        "[data-role='auto-continue-toggle']",
      ) as HTMLButtonElement | null;
      const existingAutoContinueThumb = existingRoot.querySelector(
        "[data-role='auto-continue-thumb']",
      ) as HTMLSpanElement | null;
      const existingNextSendToggle = existingRoot.querySelector(
        "[data-role='next-send-toggle']",
      ) as HTMLButtonElement | null;
      const existingNextSendThumb = existingRoot.querySelector(
        "[data-role='next-send-thumb']",
      ) as HTMLSpanElement | null;
      const existingCompressButton = existingRoot.querySelector(
        "[data-role='compress-button']",
      ) as HTMLButtonElement | null;
      const existingCompressButtonLabel = existingRoot.querySelector(
        "[data-role='compress-button-label']",
      ) as HTMLSpanElement | null;
      const existingCompressButtonMeta = existingRoot.querySelector(
        "[data-role='compress-button-meta']",
      ) as HTMLSpanElement | null;
      if (
        !existingPanel ||
        !existingBall ||
        !existingDragHandle ||
        !existingCollapseButton ||
        !existingAutoContinueToggle ||
        !existingAutoContinueThumb ||
        !existingNextSendToggle ||
        !existingNextSendThumb ||
        !existingCompressButton ||
        !existingCompressButtonLabel ||
        !existingCompressButtonMeta
      ) {
        existingRoot.remove();
      } else {
        state.systemInjectionWidget.root = existingRoot;
        state.systemInjectionWidget.panel = existingPanel;
        state.systemInjectionWidget.ball = existingBall;
        state.systemInjectionWidget.dragHandle = existingDragHandle;
        state.systemInjectionWidget.collapseButton = existingCollapseButton;
        state.systemInjectionWidget.autoContinueToggle = existingAutoContinueToggle;
        state.systemInjectionWidget.autoContinueThumb = existingAutoContinueThumb;
        state.systemInjectionWidget.nextSendToggle = existingNextSendToggle;
        state.systemInjectionWidget.nextSendThumb = existingNextSendThumb;
        state.systemInjectionWidget.compressButton = existingCompressButton;
        state.systemInjectionWidget.compressButtonLabel = existingCompressButtonLabel;
        state.systemInjectionWidget.compressButtonMeta = existingCompressButtonMeta;
        return existingRoot;
      }
    }

    const root = document.createElement("div");
    root.id = SYSTEM_INJECTION_WIDGET_ID;
    root.style.position = "fixed";
    root.style.top = "18px";
    root.style.right = "18px";
    root.style.zIndex = "2147483647";
    root.style.width = `${EXPANDED_WIDGET_WIDTH}px`;
    root.style.padding = "8px 10px";
    root.style.borderRadius = "14px";
    root.style.backdropFilter = "blur(14px)";
    root.style.boxSizing = "border-box";
    root.style.fontFamily =
      "'Plus Jakarta Sans', 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";
    root.style.pointerEvents = "auto";
    root.style.userSelect = "none";
    root.style.overflow = "hidden";
    root.style.transformOrigin = "top right";
    root.style.transition =
      "background 180ms ease, border-color 180ms ease, box-shadow 180ms ease, width 180ms ease, border-radius 180ms ease, transform 180ms ease";

    const panel = document.createElement("div");
    panel.setAttribute("data-role", "panel");
    panel.style.width = "100%";
    panel.style.display = "flex";
    panel.style.flexDirection = "column";
    panel.style.gap = "10px";

    const ball = document.createElement("div");
    ball.setAttribute("data-role", "ball");
    ball.setAttribute("role", "button");
    ball.setAttribute("tabindex", "0");
    ball.setAttribute("aria-label", "展开发送设置");
    ball.title = "打开设置";
    ball.style.display = "none";
    ball.style.width = "100%";
    ball.style.height = "100%";
    ball.style.alignItems = "center";
    ball.style.justifyContent = "center";
    ball.style.position = "relative";
    ball.style.cursor = "pointer";

    const ballLabel = document.createElement("div");
    ballLabel.textContent = "CP";
    ballLabel.style.fontSize = "18px";
    ballLabel.style.fontWeight = "800";
    ballLabel.style.letterSpacing = "0.04em";

    const ballDot = document.createElement("div");
    ballDot.setAttribute("data-role", "ball-dot");
    ballDot.style.position = "absolute";
    ballDot.style.right = "9px";
    ballDot.style.top = "9px";
    ballDot.style.width = "9px";
    ballDot.style.height = "9px";
    ballDot.style.borderRadius = "999px";
    ballDot.style.boxShadow = "0 0 0 2px rgba(255,255,255,0.55)";

    ball.appendChild(ballLabel);
    ball.appendChild(ballDot);

    const dragHandle = document.createElement("div");
    dragHandle.setAttribute("data-role", "drag-handle");
    dragHandle.style.display = "flex";
    dragHandle.style.alignItems = "center";
    dragHandle.style.justifyContent = "space-between";
    dragHandle.style.gap = "8px";
    dragHandle.style.cursor = "grab";
    dragHandle.style.marginBottom = "0";

    const title = document.createElement("div");
    title.textContent = "发送";
    title.style.fontSize = "12px";
    title.style.fontWeight = "700";
    title.style.letterSpacing = "0.02em";

    const headerActions = document.createElement("div");
    headerActions.style.display = "flex";
    headerActions.style.alignItems = "center";
    headerActions.style.gap = "6px";

    const collapseButton = document.createElement("button");
    collapseButton.type = "button";
    collapseButton.setAttribute("data-role", "collapse");
    collapseButton.textContent = "✕";
    collapseButton.setAttribute("aria-label", "收起为悬浮球");
    collapseButton.style.height = "22px";
    collapseButton.style.minWidth = "22px";
    collapseButton.style.padding = "0 6px";
    collapseButton.style.borderRadius = "999px";
    collapseButton.style.fontSize = "10px";
    collapseButton.style.fontWeight = "700";
    collapseButton.style.transition = "background 180ms ease, border-color 180ms ease, color 180ms ease";
    collapseButton.onpointerdown = (event) => {
      event.stopPropagation();
    };
    collapseButton.onclick = (event) => {
      event.stopPropagation();
      setSystemInjectionWidgetCollapsed(true);
    };

    const grip = document.createElement("div");
    grip.textContent = "⋮⋮";
    grip.style.fontSize = "10px";
    grip.style.opacity = "0.72";
    grip.style.lineHeight = "1";

    headerActions.appendChild(collapseButton);
    headerActions.appendChild(grip);
    dragHandle.appendChild(title);
    dragHandle.appendChild(headerActions);

    const settingsGroup = document.createElement("div");
    settingsGroup.setAttribute("data-role", "settings-group");
    settingsGroup.style.display = "flex";
    settingsGroup.style.flexDirection = "column";
    settingsGroup.style.gap = "0";
    settingsGroup.style.padding = "6px 10px";
    settingsGroup.style.borderRadius = "12px";

    const autoContinueRow = document.createElement("div");
    autoContinueRow.setAttribute("data-role", "auto-continue-row");
    autoContinueRow.style.display = "flex";
    autoContinueRow.style.alignItems = "center";
    autoContinueRow.style.justifyContent = "space-between";
    autoContinueRow.style.gap = "10px";
    autoContinueRow.style.padding = "10px 0";

    const autoContinueLabel = document.createElement("div");
    autoContinueLabel.style.flex = "1 1 auto";
    autoContinueLabel.style.minWidth = "0";
    autoContinueLabel.style.display = "flex";
    autoContinueLabel.style.flexDirection = "column";
    autoContinueLabel.style.gap = "4px";

    const autoContinueTitle = document.createElement("div");
    autoContinueTitle.textContent = "工具结果续发";
    autoContinueTitle.style.fontSize = "11px";
    autoContinueTitle.style.fontWeight = "700";
    autoContinueTitle.style.lineHeight = "1.25";

    const autoContinueHint = document.createElement("div");
    autoContinueHint.style.display = "inline-flex";
    autoContinueHint.style.alignItems = "center";
    autoContinueHint.style.alignSelf = "flex-start";
    autoContinueHint.style.padding = "2px 8px";
    autoContinueHint.style.borderRadius = "999px";
    autoContinueHint.style.fontSize = "10px";
    autoContinueHint.style.lineHeight = "1.2";
    autoContinueHint.style.fontWeight = "700";

    autoContinueLabel.appendChild(autoContinueTitle);
    autoContinueLabel.appendChild(autoContinueHint);

    const autoContinueToggle = document.createElement("button");
    autoContinueToggle.type = "button";
    autoContinueToggle.setAttribute("data-role", "auto-continue-toggle");
    autoContinueToggle.setAttribute("role", "switch");
    autoContinueToggle.setAttribute("aria-label", "切换工具结果是否自动发送");
    autoContinueToggle.style.position = "relative";
    autoContinueToggle.style.flex = "0 0 auto";
    autoContinueToggle.style.width = "42px";
    autoContinueToggle.style.height = "24px";
    autoContinueToggle.style.padding = "0";
    autoContinueToggle.style.borderRadius = "999px";
    autoContinueToggle.style.transition =
      "background 180ms ease, border-color 180ms ease, box-shadow 180ms ease, opacity 180ms ease";
    autoContinueToggle.onclick = () => {
      setCodeModeAutoContinueEnabled(!state.codeMode.autoContinueEnabled, true);
    };

    const autoContinueThumb = document.createElement("span");
    autoContinueThumb.setAttribute("data-role", "auto-continue-thumb");
    autoContinueThumb.style.position = "absolute";
    autoContinueThumb.style.top = "2px";
    autoContinueThumb.style.left = "2px";
    autoContinueThumb.style.width = "18px";
    autoContinueThumb.style.height = "18px";
    autoContinueThumb.style.borderRadius = "999px";
    autoContinueThumb.style.transition =
      "transform 180ms ease, background 180ms ease, box-shadow 180ms ease";

    autoContinueToggle.appendChild(autoContinueThumb);
    autoContinueRow.appendChild(autoContinueLabel);
    autoContinueRow.appendChild(autoContinueToggle);

    const nextSendRow = document.createElement("div");
    nextSendRow.setAttribute("data-role", "next-send-row");
    nextSendRow.style.display = "flex";
    nextSendRow.style.alignItems = "center";
    nextSendRow.style.justifyContent = "space-between";
    nextSendRow.style.gap = "10px";
    nextSendRow.style.padding = "10px 0 6px";
    nextSendRow.style.borderTop = "1px solid transparent";

    const nextSendLabel = document.createElement("div");
    nextSendLabel.style.flex = "1 1 auto";
    nextSendLabel.style.minWidth = "0";
    nextSendLabel.style.display = "flex";
    nextSendLabel.style.flexDirection = "column";
    nextSendLabel.style.gap = "4px";

    const nextSendTitle = document.createElement("div");
    nextSendTitle.textContent = "下一条注入";
    nextSendTitle.style.fontSize = "11px";
    nextSendTitle.style.fontWeight = "700";
    nextSendTitle.style.lineHeight = "1.25";

    const nextSendHint = document.createElement("div");
    nextSendHint.style.display = "inline-flex";
    nextSendHint.style.alignItems = "center";
    nextSendHint.style.alignSelf = "flex-start";
    nextSendHint.style.padding = "2px 8px";
    nextSendHint.style.borderRadius = "999px";
    nextSendHint.style.fontSize = "10px";
    nextSendHint.style.lineHeight = "1.2";
    nextSendHint.style.fontWeight = "700";

    nextSendLabel.appendChild(nextSendTitle);
    nextSendLabel.appendChild(nextSendHint);

    const nextSendToggle = document.createElement("button");
    nextSendToggle.type = "button";
    nextSendToggle.setAttribute("data-role", "next-send-toggle");
    nextSendToggle.setAttribute("role", "switch");
    nextSendToggle.setAttribute("aria-label", "切换下一条消息是否带上当前设置");
    nextSendToggle.style.position = "relative";
    nextSendToggle.style.flex = "0 0 auto";
    nextSendToggle.style.width = "42px";
    nextSendToggle.style.height = "24px";
    nextSendToggle.style.padding = "0";
    nextSendToggle.style.borderRadius = "999px";
    nextSendToggle.style.transition =
      "background 180ms ease, border-color 180ms ease, box-shadow 180ms ease, opacity 180ms ease";
    nextSendToggle.onclick = () => {
      const nextArmed = !state.systemInjection.armed;
      setSystemInjectionArmed(nextArmed, nextArmed ? "manual" : "");
      syncRequestInjectionToMonitor();
    };

    const nextSendThumb = document.createElement("span");
    nextSendThumb.setAttribute("data-role", "next-send-thumb");
    nextSendThumb.style.position = "absolute";
    nextSendThumb.style.top = "2px";
    nextSendThumb.style.left = "2px";
    nextSendThumb.style.width = "18px";
    nextSendThumb.style.height = "18px";
    nextSendThumb.style.borderRadius = "999px";
    nextSendThumb.style.transition =
      "transform 180ms ease, background 180ms ease, box-shadow 180ms ease";

    nextSendToggle.appendChild(nextSendThumb);
    nextSendRow.appendChild(nextSendLabel);
    nextSendRow.appendChild(nextSendToggle);

    const compressRow = document.createElement("div");
    compressRow.setAttribute("data-role", "compress-row");

    const compressButton = document.createElement("button");
    compressButton.type = "button";
    compressButton.setAttribute("data-role", "compress-button");
    compressButton.setAttribute("aria-label", "生成对话压缩摘要");
    compressButton.style.width = "100%";
    compressButton.style.display = "flex";
    compressButton.style.alignItems = "center";
    compressButton.style.justifyContent = "space-between";
    compressButton.style.gap = "10px";
    compressButton.style.padding = "12px 13px";
    compressButton.style.borderRadius = "14px";
    compressButton.style.textAlign = "left";
    compressButton.style.transition =
      "background 180ms ease, border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease, opacity 180ms ease";
    compressButton.onclick = () => {
      if (state.systemInjectionWidget.compressRequestRunning || isCompressRequestCoolingDown()) return;
      setCompressRequestState("idle", "正在发送压缩请求…", true);
      renderSystemInjectionWidget();
      void sendContextCompressionRequest()
        .then((result) => {
          if (result.ok) {
            startCompressRequestCooldown(
              result.delivery === "filled" ? "已填入输入框，请手动发送" : "压缩请求已发出",
            );
          } else {
            setCompressRequestState("error", String(result.error || "压缩请求发送失败"), false);
          }
          renderSystemInjectionWidget();
        })
        .catch((error) => {
          const message =
            error instanceof Error ? error.message || "压缩请求发送失败" : String(error || "压缩请求发送失败");
          setCompressRequestState("error", message, false);
          renderSystemInjectionWidget();
        });
    };

    const compressButtonLabel = document.createElement("span");
    compressButtonLabel.setAttribute("data-role", "compress-button-label");
    compressButtonLabel.textContent = "压缩总结";
    compressButtonLabel.style.flex = "1 1 auto";
    compressButtonLabel.style.minWidth = "0";
    compressButtonLabel.style.fontSize = "12px";
    compressButtonLabel.style.fontWeight = "800";
    compressButtonLabel.style.lineHeight = "1.2";

    const compressButtonHint = document.createElement("span");
    compressButtonHint.textContent = "填入并发送";
    compressButtonHint.style.fontSize = "10px";
    compressButtonHint.style.lineHeight = "1.25";
    compressButtonHint.style.opacity = "0.72";

    const compressButtonMeta = document.createElement("span");
    compressButtonMeta.setAttribute("data-role", "compress-button-meta");
    compressButtonMeta.textContent = "发送";
    compressButtonMeta.style.flex = "0 0 auto";
    compressButtonMeta.style.display = "inline-flex";
    compressButtonMeta.style.alignItems = "center";
    compressButtonMeta.style.justifyContent = "center";
    compressButtonMeta.style.minWidth = "44px";
    compressButtonMeta.style.padding = "5px 9px";
    compressButtonMeta.style.borderRadius = "999px";
    compressButtonMeta.style.fontSize = "10px";
    compressButtonMeta.style.fontWeight = "800";
    compressButtonMeta.style.letterSpacing = "0.02em";

    const compressButtonBody = document.createElement("div");
    compressButtonBody.style.display = "flex";
    compressButtonBody.style.flexDirection = "column";
    compressButtonBody.style.alignItems = "flex-start";
    compressButtonBody.style.gap = "3px";
    compressButtonBody.style.flex = "1 1 auto";
    compressButtonBody.appendChild(compressButtonLabel);
    compressButtonBody.appendChild(compressButtonHint);

    compressButton.appendChild(compressButtonBody);
    compressButton.appendChild(compressButtonMeta);

    settingsGroup.appendChild(autoContinueRow);
    settingsGroup.appendChild(nextSendRow);
    compressRow.appendChild(compressButton);

    panel.appendChild(dragHandle);
    panel.appendChild(settingsGroup);
    panel.appendChild(compressRow);
    root.appendChild(panel);
    root.appendChild(ball);

    const mountTarget = document.body || document.documentElement;
    mountTarget?.appendChild(root);

    let activePointerId = 0;
    let originLeft = 0;
    let originTop = 0;
    let pointerStartX = 0;
    let pointerStartY = 0;
    let dragMode: "panel" | "ball" | "" = "";
    let didDrag = false;

    const handlePointerMove = (event: PointerEvent) => {
      if (!activePointerId || event.pointerId !== activePointerId) return;
      event.preventDefault();
      if (
        !didDrag &&
        (Math.abs(event.clientX - pointerStartX) > 3 || Math.abs(event.clientY - pointerStartY) > 3)
      ) {
        didDrag = true;
      }
      applySystemInjectionWidgetPosition(
        root,
        originLeft + (event.clientX - pointerStartX),
        originTop + (event.clientY - pointerStartY),
      );
    };

    const finishPointerDrag = (event: PointerEvent) => {
      if (!activePointerId || event.pointerId !== activePointerId) return;
      activePointerId = 0;
      const completedDragMode = dragMode;
      dragMode = "";
      dragHandle.style.cursor = "grab";
      ball.style.cursor = "pointer";
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", finishPointerDrag, true);
      window.removeEventListener("pointercancel", finishPointerDrag, true);
      if (completedDragMode === "ball") {
        if (didDrag) {
          const rect = root.getBoundingClientRect();
          state.systemInjectionWidget.dockSide = getSystemInjectionWidgetDockSide(
            rect.left,
            rect.width || COLLAPSED_WIDGET_SIZE,
          );
          snapSystemInjectionWidgetToEdge(root, true);
        } else {
          setSystemInjectionWidgetCollapsed(false);
        }
      } else if (completedDragMode === "panel") {
        const rect = root.getBoundingClientRect();
        state.systemInjectionWidget.dockSide = getSystemInjectionWidgetDockSide(
          rect.left,
          rect.width || EXPANDED_WIDGET_WIDTH,
        );
        saveSystemInjectionWidgetPosition(rect.left, rect.top);
      }
      didDrag = false;
    };

    const beginPointerDrag = (event: PointerEvent, mode: "panel" | "ball") => {
      if (event.button !== 0) return;
      const rect = root.getBoundingClientRect();
      activePointerId = event.pointerId;
      originLeft = rect.left;
      originTop = rect.top;
      pointerStartX = event.clientX;
      pointerStartY = event.clientY;
      dragMode = mode;
      didDrag = false;
      if (mode === "panel") {
        dragHandle.style.cursor = "grabbing";
      } else {
        ball.style.cursor = "grabbing";
      }
      window.addEventListener("pointermove", handlePointerMove, true);
      window.addEventListener("pointerup", finishPointerDrag, true);
      window.addEventListener("pointercancel", finishPointerDrag, true);
    };

    dragHandle.onpointerdown = (event) => {
      beginPointerDrag(event, "panel");
    };

    ball.onpointerdown = (event) => {
      beginPointerDrag(event, "ball");
    };
    ball.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setSystemInjectionWidgetCollapsed(false);
      }
    };

    if (savedPosition) {
      applySystemInjectionWidgetPosition(root, savedPosition.left, savedPosition.top);
      if (savedPosition.collapsed) {
        snapSystemInjectionWidgetToEdge(root, true);
      }
    }

    window.addEventListener(
      "resize",
      () => {
        const rect = root.getBoundingClientRect();
        if (state.systemInjectionWidget.collapsed) {
          snapSystemInjectionWidgetToEdge(root, true);
        } else {
          applySystemInjectionWidgetPosition(root, rect.left, rect.top);
        }
      },
      { passive: true },
    );

    state.systemInjectionWidget.root = root;
    state.systemInjectionWidget.panel = panel;
    state.systemInjectionWidget.ball = ball;
    state.systemInjectionWidget.dragHandle = dragHandle;
    state.systemInjectionWidget.collapseButton = collapseButton;
    state.systemInjectionWidget.autoContinueToggle = autoContinueToggle;
    state.systemInjectionWidget.autoContinueThumb = autoContinueThumb;
    state.systemInjectionWidget.nextSendToggle = nextSendToggle;
    state.systemInjectionWidget.nextSendThumb = nextSendThumb;
    state.systemInjectionWidget.compressButton = compressButton;
    state.systemInjectionWidget.compressButtonLabel = compressButtonLabel;
    state.systemInjectionWidget.compressButtonMeta = compressButtonMeta;
    return root;
  }

  function applySwitchStyle(
    toggle: HTMLButtonElement,
    thumb: HTMLSpanElement,
    enabled: boolean,
    isLight: boolean,
    disabled = false,
  ) {
    toggle.setAttribute("aria-checked", enabled ? "true" : "false");
    toggle.disabled = disabled;
    toggle.style.opacity = disabled ? "0.45" : "1";
    toggle.style.cursor = disabled ? "not-allowed" : "pointer";
    toggle.style.border = `1px solid ${
      enabled
        ? isLight
          ? "rgba(137, 92, 38, 0.3)"
          : "rgba(218, 175, 97, 0.34)"
        : isLight
          ? "rgba(92, 107, 115, 0.18)"
          : "rgba(180, 170, 158, 0.18)"
    }`;
    toggle.style.background = enabled
      ? isLight
        ? "linear-gradient(180deg, rgba(232,190,125,0.92), rgba(201,150,73,0.96))"
        : "linear-gradient(180deg, rgba(214,174,105,0.96), rgba(154,116,50,0.98))"
      : isLight
        ? "rgba(198, 205, 210, 0.9)"
        : "rgba(102, 96, 90, 0.9)";
    toggle.style.boxShadow = enabled
      ? isLight
        ? "0 4px 10px rgba(182, 132, 55, 0.18)"
        : "0 4px 10px rgba(0, 0, 0, 0.22)"
      : "none";
    thumb.style.background = isLight ? "#ffffff" : "rgba(255,255,255,0.92)";
    thumb.style.boxShadow = isLight
      ? "0 2px 6px rgba(63, 53, 40, 0.18)"
      : "0 2px 6px rgba(0, 0, 0, 0.28)";
    thumb.style.transform = enabled ? "translateX(18px)" : "translateX(0)";
  }

  function renderSystemInjectionWidget() {
    if (!shouldShowSystemInjectionWidget()) {
      const hiddenRoot =
        state.systemInjectionWidget.root ||
        (document.getElementById(SYSTEM_INJECTION_WIDGET_ID) as HTMLDivElement | null);
      if (hiddenRoot?.isConnected) {
        hiddenRoot.style.display = "none";
      }
      return;
    }

    const root = ensureSystemInjectionWidget();
    if (!root) return;
    root.style.display = "block";

    const panel = state.systemInjectionWidget.panel;
    const ball = state.systemInjectionWidget.ball;
    const collapseButton = state.systemInjectionWidget.collapseButton;
    const autoContinueToggle = state.systemInjectionWidget.autoContinueToggle;
    const autoContinueThumb = state.systemInjectionWidget.autoContinueThumb;
    const nextSendToggle = state.systemInjectionWidget.nextSendToggle;
    const nextSendThumb = state.systemInjectionWidget.nextSendThumb;
    const compressButton = state.systemInjectionWidget.compressButton;
    const compressButtonLabel = state.systemInjectionWidget.compressButtonLabel;
    const compressButtonMeta = state.systemInjectionWidget.compressButtonMeta;
    if (
      !panel ||
      !ball ||
      !collapseButton ||
      !autoContinueToggle ||
      !autoContinueThumb ||
      !nextSendToggle ||
      !nextSendThumb ||
      !compressButton ||
      !compressButtonLabel ||
      !compressButtonMeta
    ) {
      return;
    }

    const isLight = state.uiTheme === "light";
    const isCollapsed = state.systemInjectionWidget.collapsed;
    const hasInstructionContent = Boolean(String(state.systemInstructionContent || "").trim());
    const autoContinueEnabled = state.codeMode.autoContinueEnabled;
    const nextSendEnabled = state.systemInjection.armed && hasInstructionContent;
    const statusText = getSystemInjectionStatusText();
    const compressRunning = state.systemInjectionWidget.compressRequestRunning;
    const compressStatus = state.systemInjectionWidget.compressRequestStatus;
    const compressCoolingDown = isCompressRequestCoolingDown();
    const compressMessage =
      String(state.systemInjectionWidget.compressRequestMessage || "").trim() ||
      "把当前对话压成可复制摘要，方便开新窗口继续。";

    root.style.background = isLight
      ? "linear-gradient(180deg, rgba(255,252,248,0.97), rgba(245,240,233,0.98))"
      : "linear-gradient(180deg, rgba(45,43,40,0.96), rgba(34,32,30,0.97))";
    root.style.border = `1px solid ${
      nextSendEnabled
        ? isLight
          ? "rgba(161, 108, 54, 0.24)"
          : "rgba(218, 175, 97, 0.26)"
        : isLight
          ? "rgba(92, 107, 115, 0.18)"
          : "rgba(180, 170, 158, 0.16)"
    }`;
    root.style.boxShadow = isLight
      ? "0 12px 28px rgba(40, 35, 30, 0.12)"
      : "0 18px 42px rgba(0, 0, 0, 0.28)";
    root.style.color = isLight ? "#252220" : "#ece7e1";
    root.style.width = isCollapsed ? `${COLLAPSED_WIDGET_SIZE}px` : `${EXPANDED_WIDGET_WIDTH}px`;
    root.style.height = isCollapsed ? `${COLLAPSED_WIDGET_SIZE}px` : "auto";
    root.style.padding = isCollapsed ? "0" : "8px 10px";
    root.style.borderRadius = isCollapsed ? "999px" : "14px";
    root.style.transform = isCollapsed ? "scale(0.98)" : "scale(1)";
    root.style.transformOrigin =
      state.systemInjectionWidget.dockSide === "left" ? "top left" : "top right";
    root.title = statusText;

    panel.style.display = isCollapsed ? "none" : "flex";
    ball.style.display = isCollapsed ? "flex" : "none";
    ball.style.color = isLight ? "#2c271f" : "#f1ebe2";
    ball.style.background = isLight
      ? "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.95), rgba(240,228,213,0.92) 58%, rgba(219,196,165,0.96))"
      : "radial-gradient(circle at 30% 30%, rgba(113,96,73,0.95), rgba(64,54,44,0.96) 58%, rgba(33,28,24,0.98))";
    (ball.querySelector("[data-role='ball-dot']") as HTMLDivElement | null)?.style.setProperty(
      "background",
      nextSendEnabled ? (isLight ? "#c47b28" : "#efbe6b") : isLight ? "#4a6670" : "#9ab0ba",
    );

    collapseButton.style.border = `1px solid ${isLight ? "rgba(92, 107, 115, 0.18)" : "rgba(180, 170, 158, 0.16)"}`;
    collapseButton.style.background = isLight
      ? "rgba(74, 102, 112, 0.06)"
      : "rgba(221, 216, 209, 0.08)";
    collapseButton.style.color = isLight ? "#4a4a44" : "#dcd4ca";

    const settingsGroup = autoContinueToggle.closest("[data-role='settings-group']") as HTMLDivElement | null;
    if (settingsGroup) {
      settingsGroup.style.background = isLight
        ? "linear-gradient(180deg, rgba(255,255,255,0.72), rgba(249,245,238,0.92))"
        : "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.04))";
      settingsGroup.style.border = `1px solid ${
        isLight ? "rgba(92, 107, 115, 0.12)" : "rgba(180, 170, 158, 0.14)"
      }`;
      settingsGroup.style.boxShadow = isLight
        ? "inset 0 1px 0 rgba(255,255,255,0.7)"
        : "inset 0 1px 0 rgba(255,255,255,0.03)";
    }

    const autoContinueRow = autoContinueToggle.parentElement as HTMLDivElement | null;
    const autoContinueLabel = autoContinueRow?.firstElementChild as HTMLDivElement | null;
    const autoContinueHint = autoContinueLabel?.lastElementChild as HTMLDivElement | null;
    if (autoContinueRow) {
      autoContinueRow.style.background = "transparent";
      autoContinueRow.style.border = "none";
    }
    if (autoContinueLabel) {
      autoContinueLabel.style.color = isLight ? "#2e2924" : "#ece7e1";
    }
    if (autoContinueHint) {
      autoContinueHint.textContent = autoContinueEnabled ? "自动" : "手动";
      autoContinueHint.style.color = autoContinueEnabled
        ? isLight
          ? "#8c5a1c"
          : "#f0c57d"
        : isLight
          ? "#5d6771"
          : "#c3b8ab";
      autoContinueHint.style.background = autoContinueEnabled
        ? isLight
          ? "rgba(201, 150, 73, 0.12)"
          : "rgba(214, 174, 105, 0.16)"
        : isLight
          ? "rgba(92, 107, 115, 0.08)"
          : "rgba(180, 170, 158, 0.12)";
    }
    autoContinueToggle.title = autoContinueEnabled ? "已开启自动发送" : "已关闭自动发送";
    applySwitchStyle(autoContinueToggle, autoContinueThumb, autoContinueEnabled, isLight);

    const nextSendRow = nextSendToggle.parentElement as HTMLDivElement | null;
    const nextSendLabel = nextSendRow?.firstElementChild as HTMLDivElement | null;
    const nextSendHint = nextSendLabel?.lastElementChild as HTMLDivElement | null;
    if (nextSendRow) {
      nextSendRow.style.background = "transparent";
      nextSendRow.style.border = "none";
      nextSendRow.style.borderTop = `1px solid ${
        isLight ? "rgba(92, 107, 115, 0.10)" : "rgba(180, 170, 158, 0.12)"
      }`;
    }
    if (nextSendLabel) {
      nextSendLabel.style.color = isLight ? "#2e2924" : "#ece7e1";
    }
    if (nextSendHint) {
      nextSendHint.textContent = hasInstructionContent
        ? nextSendEnabled
          ? "待发送"
          : "关闭"
        : "无内容";
      nextSendHint.style.color = nextSendEnabled
        ? isLight
          ? "#8c5a1c"
          : "#f0c57d"
        : isLight
          ? "#5d6771"
          : "#c3b8ab";
      nextSendHint.style.background = nextSendEnabled
        ? isLight
          ? "rgba(201, 150, 73, 0.12)"
          : "rgba(214, 174, 105, 0.16)"
        : isLight
          ? "rgba(92, 107, 115, 0.08)"
          : "rgba(180, 170, 158, 0.12)";
    }
    nextSendToggle.title = statusText;
    applySwitchStyle(
      nextSendToggle,
      nextSendThumb,
      nextSendEnabled,
      isLight,
      !hasInstructionContent,
    );

    const compressRow = compressButton.parentElement as HTMLDivElement | null;
    if (compressRow) {
      compressRow.style.background = "transparent";
      compressRow.style.border = "none";
    }

    const compressBlocked = compressRunning || compressCoolingDown;
    compressButton.disabled = compressBlocked;
    compressButton.style.cursor = compressRunning ? "progress" : compressCoolingDown ? "not-allowed" : "pointer";
    compressButton.style.opacity = compressBlocked ? "0.78" : "1";
    compressButton.style.border = `1px solid ${
      compressStatus === "error"
        ? isLight
          ? "rgba(177, 74, 54, 0.28)"
          : "rgba(232, 126, 102, 0.28)"
        : compressCoolingDown
          ? isLight
            ? "rgba(124, 131, 136, 0.24)"
            : "rgba(176, 170, 162, 0.2)"
          : isLight
            ? "rgba(161, 108, 54, 0.28)"
            : "rgba(218, 175, 97, 0.24)"
    }`;
    compressButton.style.background =
      compressStatus === "error"
        ? isLight
          ? "linear-gradient(180deg, rgba(255,245,242,0.96), rgba(250,234,228,0.98))"
          : "linear-gradient(180deg, rgba(89,43,37,0.92), rgba(61,30,27,0.95))"
        : compressCoolingDown
          ? isLight
            ? "linear-gradient(180deg, rgba(240,241,243,0.98), rgba(229,231,234,0.98))"
            : "linear-gradient(180deg, rgba(80,77,73,0.96), rgba(62,59,56,0.97))"
          : isLight
            ? "linear-gradient(180deg, rgba(255,249,242,0.98), rgba(246,234,217,0.98))"
            : "linear-gradient(180deg, rgba(83,68,52,0.96), rgba(61,49,38,0.98))";
    compressButton.style.boxShadow = compressBlocked
      ? "none"
      : isLight
        ? "0 8px 18px rgba(40, 35, 30, 0.08)"
        : "0 10px 20px rgba(0, 0, 0, 0.18)";
    compressButton.style.color = isLight ? "#2e2924" : "#f0e9e0";

    compressButtonLabel.textContent = compressRunning
      ? "发送中"
      : compressCoolingDown
        ? "压缩总结"
        : compressStatus === "error"
          ? "发送失败"
          : "压缩总结";
    compressButtonMeta.textContent = compressRunning ? "..." : compressCoolingDown ? "5s" : compressStatus === "error" ? "重试" : "发送";
    compressButtonMeta.style.color = compressCoolingDown
      ? isLight
        ? "#5f666e"
        : "#d7d0c7"
      : compressStatus === "error"
        ? isLight
          ? "#9a4132"
          : "#ffb4a8"
        : isLight
          ? "#7b4f15"
          : "#f2cb87";
    compressButtonMeta.style.background = compressCoolingDown
      ? isLight
        ? "rgba(115, 122, 128, 0.12)"
        : "rgba(228, 221, 212, 0.12)"
      : compressStatus === "error"
        ? isLight
          ? "rgba(177, 74, 54, 0.12)"
          : "rgba(232, 126, 102, 0.14)"
        : isLight
          ? "rgba(161, 108, 54, 0.12)"
          : "rgba(218, 175, 97, 0.14)";
    compressButton.title = compressMessage;
  }

  return {
    renderSystemInjectionWidget,
  };
}
