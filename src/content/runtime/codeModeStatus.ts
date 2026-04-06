import {
  CODE_MODE_STATUS_BAR_ID,
  CODE_MODE_STATUS_BAR_POSITION_STORAGE_KEY,
  type ContentRuntimeState,
} from "./contentRuntimeState";

type CreateCodeModeStatusControllerOptions = {
  state: ContentRuntimeState;
  isPluginRuntimeEnabled: () => boolean;
  postSandboxWindowMessage: (payload: Record<string, unknown>) => boolean;
  completeAutoContinueCycle: (clearPendingToolResult?: boolean) => void;
};

export function createCodeModeStatusController({
  state,
  isPluginRuntimeEnabled,
  postSandboxWindowMessage,
  completeAutoContinueCycle,
}: CreateCodeModeStatusControllerOptions) {
  function clearCodeModeNoticeTimer() {
    if (!state.codeMode.noticeTimerId) return;
    window.clearTimeout(state.codeMode.noticeTimerId);
    state.codeMode.noticeTimerId = 0;
  }

  function clearCodeModeElapsedTimer() {
    if (!state.codeMode.elapsedTimerId) return;
    window.clearInterval(state.codeMode.elapsedTimerId);
    state.codeMode.elapsedTimerId = 0;
  }

  function isCodeModeRunCancelled(runId: number) {
    return Boolean(runId) && state.codeMode.cancelledRunIds.has(runId);
  }

  function scheduleCancelledCodeModeCleanup(runId: number, delayMs = 30000) {
    if (!runId) return;
    window.setTimeout(() => {
      state.codeMode.cancelledRunIds.delete(runId);
    }, delayMs);
  }

  function hideCodeModeStatusBar() {
    clearCodeModeElapsedTimer();
    clearCodeModeNoticeTimer();
    state.codeMode.statusText = "";
    state.codeMode.detailText = "";
    state.codeMode.statusTone = "idle";
    state.codeMode.activeToolLabel = "";
    state.codeMode.activeToolPendingCount = 0;
    state.codeMode.runStartedAt = 0;
    if (!state.codeMode.running) {
      state.codeMode.activeRunId = 0;
    }
    renderCodeModeStatusBar();
  }

  function scheduleCodeModeStatusHide(delayMs = 1800) {
    clearCodeModeNoticeTimer();
    state.codeMode.noticeTimerId = window.setTimeout(() => {
      if (state.codeMode.running) return;
      hideCodeModeStatusBar();
    }, delayMs);
  }

  function showCodeModeStatusNotice(
    statusText: string,
    detailText = "",
    tone: "running" | "success" | "error" | "cancelled" = "error",
    delayMs = 2200,
  ) {
    state.codeMode.statusTone = tone;
    state.codeMode.statusText = String(statusText || "").trim();
    state.codeMode.detailText = String(detailText || "").trim();
    renderCodeModeStatusBar();
    if (delayMs > 0) {
      scheduleCodeModeStatusHide(delayMs);
    }
  }

  function formatCodeModeElapsed(ms: number) {
    const totalSeconds = Math.max(0, Math.floor(Math.max(0, ms) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function ensureCodeModeElapsedTimer() {
    if (!state.codeMode.running || !state.codeMode.runStartedAt) {
      clearCodeModeElapsedTimer();
      return;
    }
    if (state.codeMode.elapsedTimerId) return;
    state.codeMode.elapsedTimerId = window.setInterval(() => {
      if (!state.codeMode.running || !state.codeMode.runStartedAt) {
        clearCodeModeElapsedTimer();
        return;
      }
      renderCodeModeStatusBar();
    }, 1000);
  }

  function getCodeModeStatusPalette() {
    const isLight = state.uiTheme === "light";
    const tone = state.codeMode.statusTone;

    const toneMap = {
      running: isLight
        ? {
            badgeRing: "rgba(154, 117, 48, 0.20)",
            badgeFill: "rgba(154, 117, 48, 0.12)",
            badgeDot: "#9a7530",
            buttonBg: "rgba(74, 102, 112, 0.08)",
            buttonBorder: "rgba(92, 107, 115, 0.22)",
            buttonText: "#3a3530",
          }
        : {
            badgeRing: "rgba(196, 163, 90, 0.22)",
            badgeFill: "rgba(196, 163, 90, 0.12)",
            badgeDot: "#c4a35a",
            buttonBg: "rgba(221, 216, 209, 0.08)",
            buttonBorder: "rgba(180, 170, 158, 0.18)",
            buttonText: "#ddd8d1",
          },
      success: isLight
        ? {
            badgeRing: "rgba(78, 125, 82, 0.20)",
            badgeFill: "rgba(78, 125, 82, 0.10)",
            badgeDot: "#4e7d52",
            buttonBg: "rgba(74, 102, 112, 0.08)",
            buttonBorder: "rgba(92, 107, 115, 0.22)",
            buttonText: "#3a3530",
          }
        : {
            badgeRing: "rgba(127, 168, 130, 0.22)",
            badgeFill: "rgba(127, 168, 130, 0.12)",
            badgeDot: "#7fa882",
            buttonBg: "rgba(221, 216, 209, 0.08)",
            buttonBorder: "rgba(180, 170, 158, 0.18)",
            buttonText: "#ddd8d1",
          },
      error: isLight
        ? {
            badgeRing: "rgba(158, 78, 72, 0.20)",
            badgeFill: "rgba(158, 78, 72, 0.10)",
            badgeDot: "#9e4e48",
            buttonBg: "rgba(158, 78, 72, 0.10)",
            buttonBorder: "rgba(158, 78, 72, 0.20)",
            buttonText: "#7c302b",
          }
        : {
            badgeRing: "rgba(196, 122, 114, 0.22)",
            badgeFill: "rgba(196, 122, 114, 0.12)",
            badgeDot: "#c47a72",
            buttonBg: "rgba(196, 122, 114, 0.14)",
            buttonBorder: "rgba(196, 122, 114, 0.20)",
            buttonText: "#f4d9d5",
          },
      cancelled: isLight
        ? {
            badgeRing: "rgba(92, 107, 115, 0.16)",
            badgeFill: "rgba(92, 107, 115, 0.08)",
            badgeDot: "#4a6670",
            buttonBg: "rgba(74, 102, 112, 0.08)",
            buttonBorder: "rgba(92, 107, 115, 0.22)",
            buttonText: "#3a3530",
          }
        : {
            badgeRing: "rgba(143, 163, 173, 0.18)",
            badgeFill: "rgba(143, 163, 173, 0.10)",
            badgeDot: "#8fa3ad",
            buttonBg: "rgba(221, 216, 209, 0.08)",
            buttonBorder: "rgba(180, 170, 158, 0.18)",
            buttonText: "#ddd8d1",
          },
      idle: isLight
        ? {
            badgeRing: "rgba(92, 107, 115, 0.16)",
            badgeFill: "rgba(92, 107, 115, 0.08)",
            badgeDot: "#4a6670",
            buttonBg: "rgba(74, 102, 112, 0.08)",
            buttonBorder: "rgba(92, 107, 115, 0.22)",
            buttonText: "#3a3530",
          }
        : {
            badgeRing: "rgba(143, 163, 173, 0.18)",
            badgeFill: "rgba(143, 163, 173, 0.10)",
            badgeDot: "#8fa3ad",
            buttonBg: "rgba(221, 216, 209, 0.08)",
            buttonBorder: "rgba(180, 170, 158, 0.18)",
            buttonText: "#ddd8d1",
          },
    } satisfies Record<
      string,
      {
        badgeRing: string;
        badgeFill: string;
        badgeDot: string;
        buttonBg: string;
        buttonBorder: string;
        buttonText: string;
      }
    >;

    const tonePalette = toneMap[tone] || toneMap.idle;

    if (isLight) {
      return {
        rootBg: "linear-gradient(180deg, rgba(255,252,248,0.98), rgba(244,239,233,0.98))",
        rootBorder: "rgba(92, 107, 115, 0.18)",
        rootShadow: "0 14px 34px rgba(40, 35, 30, 0.12)",
        text: "#252220",
        detail: "#5a534a",
        stopHoverBg: "rgba(74, 102, 112, 0.14)",
        ...tonePalette,
      };
    }

    return {
      rootBg: "linear-gradient(180deg, rgba(46,44,41,0.96), rgba(36,34,32,0.97))",
      rootBorder: "rgba(180, 170, 158, 0.16)",
      rootShadow: "0 18px 42px rgba(0, 0, 0, 0.30)",
      text: "#eae6e0",
      detail: "#bbb4aa",
      stopHoverBg: "rgba(221, 216, 209, 0.12)",
      ...tonePalette,
    };
  }

  function readCodeModeStatusBarPosition() {
    try {
      const raw = window.sessionStorage.getItem(CODE_MODE_STATUS_BAR_POSITION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const left = Number(parsed.left);
      const top = Number(parsed.top);
      if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
      return { left, top };
    } catch {
      return null;
    }
  }

  function saveCodeModeStatusBarPosition(left: number, top: number) {
    try {
      window.sessionStorage.setItem(
        CODE_MODE_STATUS_BAR_POSITION_STORAGE_KEY,
        JSON.stringify({ left, top }),
      );
    } catch {
      // Ignore storage failures.
    }
  }

  function clampCodeModeStatusBarPosition(left: number, top: number, width: number, height: number) {
    const margin = 16;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);
    return {
      left: Math.min(Math.max(margin, left), maxLeft),
      top: Math.min(Math.max(margin, top), maxTop),
    };
  }

  function applyCodeModeStatusBarPosition(root: HTMLDivElement, left: number, top: number) {
    const rect = root.getBoundingClientRect();
    const width = rect.width || root.offsetWidth || 320;
    const height = rect.height || root.offsetHeight || 74;
    const nextPosition = clampCodeModeStatusBarPosition(left, top, width, height);
    root.style.left = `${nextPosition.left}px`;
    root.style.top = `${nextPosition.top}px`;
    root.style.right = "auto";
    root.style.bottom = "auto";
    root.dataset.positionMode = "custom";
  }

  function attachCodeModeStatusBarDrag(root: HTMLDivElement) {
    if (root.dataset.dragBound === "1") return;
    root.dataset.dragBound = "1";

    let activePointerId = 0;
    let originLeft = 0;
    let originTop = 0;
    let pointerStartX = 0;
    let pointerStartY = 0;

    const handlePointerMove = (event: PointerEvent) => {
      if (!activePointerId || event.pointerId !== activePointerId) return;
      event.preventDefault();
      applyCodeModeStatusBarPosition(
        root,
        originLeft + (event.clientX - pointerStartX),
        originTop + (event.clientY - pointerStartY),
      );
    };

    const finishPointerDrag = (event: PointerEvent) => {
      if (!activePointerId || event.pointerId !== activePointerId) return;
      activePointerId = 0;
      root.style.cursor = "grab";
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", finishPointerDrag, true);
      window.removeEventListener("pointercancel", finishPointerDrag, true);
      const rect = root.getBoundingClientRect();
      saveCodeModeStatusBarPosition(rect.left, rect.top);
    };

    root.onpointerdown = (event) => {
      const target = event.target as Element | null;
      if (target?.closest("[data-role='stop']")) return;
      if (event.button !== 0) return;
      const rect = root.getBoundingClientRect();
      activePointerId = event.pointerId;
      originLeft = rect.left;
      originTop = rect.top;
      pointerStartX = event.clientX;
      pointerStartY = event.clientY;
      root.style.cursor = "grabbing";
      window.addEventListener("pointermove", handlePointerMove, true);
      window.addEventListener("pointerup", finishPointerDrag, true);
      window.addEventListener("pointercancel", finishPointerDrag, true);
    };

    window.addEventListener(
      "resize",
      () => {
        if (root.dataset.positionMode !== "custom") return;
        const left = Number.parseFloat(root.style.left);
        const top = Number.parseFloat(root.style.top);
        if (!Number.isFinite(left) || !Number.isFinite(top)) return;
        applyCodeModeStatusBarPosition(root, left, top);
      },
      { passive: true },
    );
  }

  function ensureCodeModeStatusBar() {
    const cachedRoot = state.codeMode.statusBar.root;
    if (cachedRoot?.isConnected) {
      return cachedRoot;
    }

    const existingRoot = document.getElementById(CODE_MODE_STATUS_BAR_ID) as HTMLDivElement | null;
    if (existingRoot?.isConnected) {
      state.codeMode.statusBar.root = existingRoot;
      state.codeMode.statusBar.badge = existingRoot.querySelector(
        "[data-role='badge']",
      ) as HTMLDivElement | null;
      state.codeMode.statusBar.badgeDot = existingRoot.querySelector(
        "[data-role='badge-dot']",
      ) as HTMLDivElement | null;
      state.codeMode.statusBar.title = existingRoot.querySelector(
        "[data-role='title']",
      ) as HTMLDivElement | null;
      state.codeMode.statusBar.detail = existingRoot.querySelector(
        "[data-role='detail']",
      ) as HTMLDivElement | null;
      state.codeMode.statusBar.stopButton = existingRoot.querySelector(
        "[data-role='stop']",
      ) as HTMLButtonElement | null;
      if (state.codeMode.statusBar.stopButton) {
        state.codeMode.statusBar.stopButton.textContent = "暂停";
        state.codeMode.statusBar.stopButton.onclick = () => {
          cancelActiveCodeModeRun();
        };
      }
      attachCodeModeStatusBarDrag(existingRoot);
      return existingRoot;
    }

    const root = document.createElement("div");
    root.id = CODE_MODE_STATUS_BAR_ID;
    root.style.position = "fixed";
    root.style.right = "20px";
    root.style.bottom = "20px";
    root.style.zIndex = "2147483647";
    root.style.display = "none";
    root.style.alignItems = "center";
    root.style.gap = "12px";
    root.style.minWidth = "300px";
    root.style.maxWidth = "460px";
    root.style.padding = "10px 12px";
    root.style.borderRadius = "18px";
    root.style.backdropFilter = "blur(12px)";
    root.style.fontFamily =
      "'Plus Jakarta Sans', 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";
    root.style.pointerEvents = "auto";
    root.style.userSelect = "none";
    root.style.cursor = "grab";
    root.style.transition =
      "background 180ms ease, border-color 180ms ease, box-shadow 180ms ease, color 180ms ease";

    const badge = document.createElement("div");
    badge.setAttribute("data-role", "badge");
    badge.style.width = "34px";
    badge.style.height = "34px";
    badge.style.flex = "0 0 34px";
    badge.style.display = "inline-flex";
    badge.style.alignItems = "center";
    badge.style.justifyContent = "center";
    badge.style.borderRadius = "999px";
    badge.style.transition = "background 180ms ease, border-color 180ms ease";

    const badgeDot = document.createElement("div");
    badgeDot.setAttribute("data-role", "badge-dot");
    badgeDot.style.width = "10px";
    badgeDot.style.height = "10px";
    badgeDot.style.borderRadius = "999px";
    badgeDot.style.transition = "background 180ms ease, transform 180ms ease";
    badge.appendChild(badgeDot);

    const textWrap = document.createElement("div");
    textWrap.style.flex = "1 1 auto";
    textWrap.style.minWidth = "0";

    const title = document.createElement("div");
    title.setAttribute("data-role", "title");
    title.style.fontSize = "14px";
    title.style.fontWeight = "600";
    title.style.lineHeight = "1.25";
    title.style.letterSpacing = "0.01em";

    const detail = document.createElement("div");
    detail.setAttribute("data-role", "detail");
    detail.style.marginTop = "2px";
    detail.style.fontSize = "12px";
    detail.style.lineHeight = "1.45";
    detail.style.wordBreak = "break-word";
    detail.style.whiteSpace = "pre-wrap";

    const stopButton = document.createElement("button");
    stopButton.type = "button";
    stopButton.setAttribute("data-role", "stop");
    stopButton.textContent = "暂停";
    stopButton.style.flex = "0 0 auto";
    stopButton.setAttribute("aria-label", "暂停当前工具执行");
    stopButton.style.minWidth = "56px";
    stopButton.style.height = "36px";
    stopButton.style.padding = "0 14px";
    stopButton.style.borderRadius = "12px";
    stopButton.style.fontSize = "12px";
    stopButton.style.fontWeight = "600";
    stopButton.style.transition =
      "background 180ms ease, border-color 180ms ease, color 180ms ease, opacity 180ms ease";
    stopButton.onclick = () => {
      cancelActiveCodeModeRun();
    };

    root.appendChild(badge);
    textWrap.appendChild(title);
    textWrap.appendChild(detail);
    root.appendChild(textWrap);
    root.appendChild(stopButton);

    const mountTarget = document.body || document.documentElement;
    mountTarget?.appendChild(root);

    const savedPosition = readCodeModeStatusBarPosition();
    if (savedPosition) {
      applyCodeModeStatusBarPosition(root, savedPosition.left, savedPosition.top);
    }

    attachCodeModeStatusBarDrag(root);

    state.codeMode.statusBar.root = root;
    state.codeMode.statusBar.badge = badge;
    state.codeMode.statusBar.badgeDot = badgeDot;
    state.codeMode.statusBar.title = title;
    state.codeMode.statusBar.detail = detail;
    state.codeMode.statusBar.stopButton = stopButton;
    return root;
  }

  function renderCodeModeStatusBar() {
    const cachedRoot =
      state.codeMode.statusBar.root ||
      (document.getElementById(CODE_MODE_STATUS_BAR_ID) as HTMLDivElement | null);
    if (!isPluginRuntimeEnabled()) {
      if (cachedRoot?.isConnected) {
        cachedRoot.style.display = "none";
      }
      return;
    }

    const root = ensureCodeModeStatusBar();
    const badge = state.codeMode.statusBar.badge;
    const badgeDot = state.codeMode.statusBar.badgeDot;
    const title = state.codeMode.statusBar.title;
    const detail = state.codeMode.statusBar.detail;
    const stopButton = state.codeMode.statusBar.stopButton;
    const isVisible = Boolean(
      state.codeMode.statusText || state.codeMode.detailText || state.codeMode.running,
    );

    if (!isVisible) {
      root.style.display = "none";
      return;
    }

    const palette = getCodeModeStatusPalette();
    const elapsedText =
      state.codeMode.running && state.codeMode.runStartedAt
        ? ` · 已用时 ${formatCodeModeElapsed(Date.now() - state.codeMode.runStartedAt)}`
        : "";
    const runningDetail = state.codeMode.detailText
      ? `${state.codeMode.detailText}${elapsedText}`
      : elapsedText.replace(/^ · /, "");

    root.dataset.theme = state.uiTheme;
    root.dataset.tone = state.codeMode.statusTone;
    root.style.background = palette.rootBg;
    root.style.border = `1px solid ${palette.rootBorder}`;
    root.style.boxShadow = palette.rootShadow;
    root.style.color = palette.text;

    if (badge) {
      badge.style.background = palette.badgeFill;
      badge.style.border = `1px solid ${palette.badgeRing}`;
    }
    if (badgeDot) {
      badgeDot.style.background = palette.badgeDot;
      badgeDot.style.transform =
        state.codeMode.running && state.codeMode.activeToolPendingCount > 0
          ? "scale(1)"
          : "scale(0.9)";
      badgeDot.style.boxShadow =
        state.codeMode.running && state.codeMode.activeToolPendingCount > 0
          ? `0 0 0 4px ${palette.badgeRing}`
          : "none";
    }

    if (title) {
      title.textContent = state.codeMode.statusText || "工具运行中";
      title.style.color = palette.text;
    }
    if (detail) {
      detail.textContent = state.codeMode.running ? runningDetail : state.codeMode.detailText || "";
      detail.style.display = detail.textContent ? "block" : "none";
      detail.style.color = palette.detail;
    }
    if (stopButton) {
      const canPause = state.codeMode.running || state.codeMode.autoContinueInFlight;
      stopButton.style.display = canPause ? "inline-flex" : "none";
      stopButton.disabled = !canPause;
      stopButton.style.cursor = canPause ? "pointer" : "default";
      stopButton.style.opacity = canPause ? "1" : "0.6";
      stopButton.style.alignItems = "center";
      stopButton.style.justifyContent = "center";
      stopButton.style.border = `1px solid ${palette.buttonBorder}`;
      stopButton.style.background = palette.buttonBg;
      stopButton.style.color = palette.buttonText;
    }
    root.style.display = "flex";
    if (root.dataset.positionMode === "custom") {
      const left = Number.parseFloat(root.style.left);
      const top = Number.parseFloat(root.style.top);
      if (Number.isFinite(left) && Number.isFinite(top)) {
        applyCodeModeStatusBarPosition(root, left, top);
      }
    }
  }

  function beginCodeModeRun(runId: number) {
    clearCodeModeNoticeTimer();
    clearCodeModeElapsedTimer();
    state.codeMode.running = true;
    state.codeMode.activeRunId = runId;
    state.codeMode.activeToolLabel = "";
    state.codeMode.activeToolPendingCount = 0;
    state.codeMode.statusTone = "running";
    state.codeMode.runStartedAt = Date.now();
    state.codeMode.statusText = "工具运行中";
    state.codeMode.detailText = "等待工具调用";
    ensureCodeModeElapsedTimer();
    renderCodeModeStatusBar();
  }

  function updateCodeModeToolProgress(runId: number, toolLabel: string, delta: number) {
    if (!runId || state.codeMode.activeRunId !== runId || isCodeModeRunCancelled(runId)) {
      return;
    }

    state.codeMode.activeToolPendingCount = Math.max(
      0,
      state.codeMode.activeToolPendingCount + delta,
    );
    if (delta > 0 && toolLabel) {
      state.codeMode.activeToolLabel = toolLabel;
    }

    if (state.codeMode.activeToolPendingCount > 0) {
      state.codeMode.statusText = "工具运行中";
      state.codeMode.detailText =
        state.codeMode.activeToolPendingCount > 1
          ? `正在调用 ${state.codeMode.activeToolLabel} 等 ${state.codeMode.activeToolPendingCount} 个工具`
          : `正在调用 ${state.codeMode.activeToolLabel}`;
    } else {
      state.codeMode.detailText = "等待代码返回结果";
    }

    renderCodeModeStatusBar();
  }

  function finishCodeModeRun(
    runId: number,
    outcome: "success" | "error" | "cancelled",
    detailText = "",
  ) {
    if (!runId || state.codeMode.activeRunId !== runId) return;

    clearCodeModeNoticeTimer();
    clearCodeModeElapsedTimer();
    state.codeMode.running = false;
    state.codeMode.activeToolLabel = "";
    state.codeMode.activeToolPendingCount = 0;

    if (outcome === "cancelled") {
      state.codeMode.statusTone = "cancelled";
      state.codeMode.statusText = "工具已停止";
      state.codeMode.detailText = detailText || "后续工具结果将被忽略";
      renderCodeModeStatusBar();
      scheduleCodeModeStatusHide(2200);
      return;
    }

    if (outcome === "success") {
      state.codeMode.statusTone = "success";
      state.codeMode.statusText = "工具执行完成";
      state.codeMode.detailText = detailText || "工具结果已自动发送";
      renderCodeModeStatusBar();
      scheduleCodeModeStatusHide(1800);
      return;
    }

    state.codeMode.statusTone = "error";
    state.codeMode.statusText = "工具执行失败";
    state.codeMode.detailText = detailText || "工具执行失败，请检查自动续发配置";
    renderCodeModeStatusBar();
    scheduleCodeModeStatusHide(2400);
  }

  function enterAutoContinueWaitingState(statusText: string) {
    clearCodeModeElapsedTimer();
    clearCodeModeNoticeTimer();
    state.codeMode.running = false;
    state.codeMode.statusTone = "running";
    state.codeMode.statusText = statusText;
    state.codeMode.detailText = "等待模型继续响应";
    renderCodeModeStatusBar();
  }

  function cancelActiveCodeModeRun() {
    const runId = Number(state.codeMode.activeRunId || 0);
    if (state.codeMode.autoContinueInFlight && !state.codeMode.running) {
      completeAutoContinueCycle(true);
      state.codeMode.statusTone = "cancelled";
      state.codeMode.statusText = "已暂停等待响应";
      state.codeMode.detailText = "本轮不会继续自动续发";
      renderCodeModeStatusBar();
      scheduleCodeModeStatusHide(2200);
      return;
    }

    if (!runId || !state.codeMode.running) return;

    state.codeMode.cancelledRunIds.add(runId);
    scheduleCancelledCodeModeCleanup(runId);
    finishCodeModeRun(runId, "cancelled");
    postSandboxWindowMessage({
      type: "cancel-code-mode",
      runId,
    });
  }

  return {
    clearCodeModeNoticeTimer,
    clearCodeModeElapsedTimer,
    isCodeModeRunCancelled,
    scheduleCancelledCodeModeCleanup,
    scheduleCodeModeStatusHide,
    showCodeModeStatusNotice,
    renderCodeModeStatusBar,
    beginCodeModeRun,
    updateCodeModeToolProgress,
    finishCodeModeRun,
    enterAutoContinueWaitingState,
    cancelActiveCodeModeRun,
  };
}
