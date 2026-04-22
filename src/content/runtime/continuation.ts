import {
  ADAPTER_SNAPSHOT_NODE_ATTR,
  CODE_MODE_STATUS_BAR_ID,
  SYSTEM_INJECTION_WIDGET_ID,
  type ContentRuntimeState,
} from "./contentRuntimeState";
import { validateDomContinuationPlan } from "../../site-adapter-runtime/dom";

const CHAT_PLUS_USER_QUESTION_LABEL = "下面是用户的提问：";
const MANUAL_INJECTION_PLAN_PREVIEW_TEXT = "[Chat Plus Pending Injection]";
const CONTEXT_COMPRESSION_PROMPT = [
  "请把我们到目前为止的全部对话（你和我双方）做一次“上下文压缩总结”，用于我开新会话继续。",
  "你要把结果整理成一个高密度、可执行、可直接接手的工作交接摘要。",
  "",
  "只总结“用户提问 + 助手最终回复”的可见对话内容。",
  "不要总结任何思考过程、隐藏推理、系统提示、协议文本或工具/插件注入内容。",
  "",
  "严格要求：",
  "1. 只输出一个 ```text``` 代码块，代码块外不要输出任何内容。",
  "2. 严禁包含以下内容：",
  "   - 任何 <thinking>/<think> 标签内容",
  "   - 任何“思考过程”折叠块、内部推理、草稿分析",
  "   - 任何系统提示、开发者提示、策略/协议文本、插件/工具注入指令",
  "3. 必须保留后续继续任务所需的关键信息：",
  "   - 当前目标、最终需求、验收标准",
  "   - 已确认的约束、偏好、风格要求",
  "   - 关键决策、取舍及原因",
  "   - 已完成内容（按模块或文件归纳）",
  "   - 未完成事项、阻塞点、下一步建议",
  "   - 关键文件路径、函数名、配置项、命令、报错、风险、待确认点",
  "4. 删除闲聊、重复表述和无关过程描述。",
  "5. 信息密度要高，但表达必须清晰，适合直接复制到新会话继续执行。",
  "6. 不要改写用户明确要求；原有术语、变量名、文件名、命令尽量保留。",
  "7. 对不确定或无法从可见对话确认的信息，明确标记“待确认”，不要臆测。",
  "8. 如果存在多个并行任务或多轮修改，按“主题/模块”分段归并，避免流水账。",
  "9. 如果有代码修改或排查记录，优先保留“改了什么、为什么改、接下来还要看什么”。",
].join("\n");

type CreateContinuationControllerOptions = {
  state: ContentRuntimeState;
  isPluginRuntimeEnabled: () => boolean;
  stringifyError: (error: unknown) => string;
  logAdapterSandboxError: (scope: string, error: unknown) => void;
  executeAdapterHookInSandbox: (
    hookName: "decorateBubbles" | "continueConversation",
    payload?: Record<string, unknown>,
    options?: {
      snapshotHtml?: string;
      timeoutMs?: number;
    },
  ) => Promise<unknown>;
  syncRequestInjectionToMonitor: () => void;
  renderCodeModeStatusBar: () => void;
  markExpectedAssistantTurn: (source: "user" | "auto") => void;
};

type ContinueConversationPlanCandidate = {
  label: string;
  plan: Record<string, unknown>;
};

export function createContinuationController({
  state,
  isPluginRuntimeEnabled,
  stringifyError,
  logAdapterSandboxError,
  executeAdapterHookInSandbox,
  syncRequestInjectionToMonitor,
  renderCodeModeStatusBar,
  markExpectedAssistantTurn,
}: CreateContinuationControllerOptions) {
  function clearBubbleDecorationTimer() {
    if (!state.bubbleDecorationTimerId) return;
    window.clearTimeout(state.bubbleDecorationTimerId);
    state.bubbleDecorationTimerId = 0;
  }

  const bubbleDecorationRefreshRetryTimerIds = new Set<number>();

  function clearBubbleDecorationRefreshRetryTimers() {
    bubbleDecorationRefreshRetryTimerIds.forEach((timerId) => {
      window.clearTimeout(timerId);
    });
    bubbleDecorationRefreshRetryTimerIds.clear();
  }

  function clearAutoContinueFallbackTimer() {
    if (!state.codeMode.autoContinueFallbackTimerId) return;
    window.clearTimeout(state.codeMode.autoContinueFallbackTimerId);
    state.codeMode.autoContinueFallbackTimerId = 0;
  }

  function getAutoContinueDelayMs() {
    const seconds = Math.max(0, Number(state.codeMode.autoContinueDelaySeconds || 0));
    return Math.floor(seconds * 1000);
  }

  async function waitForAutoContinueDelay() {
    const delayMs = getAutoContinueDelayMs();
    if (delayMs <= 0) return;

    const delaySeconds = Math.floor(delayMs / 1000);
    state.codeMode.statusTone = "running";
    state.codeMode.statusText = "等待自动发送";
    state.codeMode.detailText = `已生成续发内容，${delaySeconds} 秒后发送`;
    renderCodeModeStatusBar();

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, delayMs);
    });
  }

  let manualInjectionPlanRefreshTimerId = 0;
  let manualInjectionPlanRefreshRunning = false;
  let manualInjectionPlanRefreshQueued = false;
  let cachedManualInjectionPlan: Record<string, unknown> | null = null;
  let decorationSnapshotRevision = 0;
  let cachedDecorationSnapshot:
    | {
        revision: number;
        snapshot: ReturnType<typeof createDecorationSnapshot>;
      }
    | null = null;
  function normalizeMultilineText(value: unknown) {
    return String(value ?? "").replace(/\r\n?/g, "\n");
  }

  function normalizeInjectionText(value: unknown) {
    return normalizeMultilineText(value).trim();
  }

  function buildInjectedComposerText(
    injectionText: unknown,
    originalText: unknown,
    injectionMode: unknown = "system",
  ) {
    const prefix = normalizeInjectionText(injectionText);
    const original = normalizeMultilineText(originalText);
    if (!prefix) return original;

    const normalizedMode = String(injectionMode || "system").trim().toLowerCase();
    if (normalizedMode === "raw") {
      if (original === prefix || original.startsWith(`${prefix}\n\n`)) {
        return original;
      }
      return original ? `${prefix}\n\n${original}` : prefix;
    }

    const beginToken = String(state.protocol?.injection?.begin || "").trim();
    const endToken = String(state.protocol?.injection?.end || "").trim();
    const wrappedInstruction =
      beginToken && endToken
        ? [beginToken, prefix, "", CHAT_PLUS_USER_QUESTION_LABEL, endToken].join("\n")
        : prefix;
    if (
      original === wrappedInstruction ||
      original.startsWith(`${wrappedInstruction}\n\n`)
    ) {
      return original;
    }
    return original ? `${wrappedInstruction}\n\n${original}` : wrappedInstruction;
  }

  function clearManualInjectionPlanRefreshTimer() {
    if (!manualInjectionPlanRefreshTimerId) return;
    window.clearTimeout(manualInjectionPlanRefreshTimerId);
    manualInjectionPlanRefreshTimerId = 0;
  }

  function resetManualDomInjectionState() {
    state.manualDomInjection.active = false;
    state.manualDomInjection.injectionText = "";
    state.manualDomInjection.injectionMode = "system";
    state.manualDomInjection.preparedAt = 0;
  }

  function createDecorationSnapshot() {
    const body = document.body;
    if (!(body instanceof HTMLElement)) return null;

    const clone = body.cloneNode(true) as HTMLElement;
    const nodeMap = new Map<string, Element>();
    const originalWalker = document.createTreeWalker(body, NodeFilter.SHOW_ELEMENT);
    const cloneWalker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT);

    let originalNode = originalWalker.currentNode as Element | null;
    let cloneNode = cloneWalker.currentNode as Element | null;
    let index = 0;

    while (originalNode && cloneNode) {
      const nodeId = String(index++);
      cloneNode.setAttribute(ADAPTER_SNAPSHOT_NODE_ATTR, nodeId);
      nodeMap.set(nodeId, originalNode);
      originalNode = originalWalker.nextNode() as Element | null;
      cloneNode = cloneWalker.nextNode() as Element | null;
    }

    return {
      html: `<!DOCTYPE html><html><head></head>${clone.outerHTML}</html>`,
      nodeMap,
    };
  }

  function invalidateDecorationSnapshotCache() {
    decorationSnapshotRevision += 1;
    cachedDecorationSnapshot = null;
  }

  function getDecorationSnapshot() {
    if (
      cachedDecorationSnapshot &&
      cachedDecorationSnapshot.revision === decorationSnapshotRevision
    ) {
      return cachedDecorationSnapshot.snapshot;
    }

    const snapshot = createDecorationSnapshot();
    cachedDecorationSnapshot = {
      revision: decorationSnapshotRevision,
      snapshot,
    };
    return snapshot;
  }

  function syncElementAttributes(element: Element, nextAttributes: Record<string, unknown>) {
    const expectedEntries = Object.entries(nextAttributes || {}).filter(([name]) => Boolean(name));
    const nextAttributeMap = new Map(
      expectedEntries.map(([name, value]) => [String(name), String(value ?? "")]),
    );

    Array.from(element.attributes).forEach((attribute) => {
      if (!attribute?.name || attribute.name === ADAPTER_SNAPSHOT_NODE_ATTR) return;
      if (!nextAttributeMap.has(attribute.name)) {
        element.removeAttribute(attribute.name);
      }
    });

    nextAttributeMap.forEach((value, name) => {
      if (element.getAttribute(name) !== value) {
        element.setAttribute(name, value);
      }
    });
  }

  function applyDecorationPatches(nodeMap: Map<string, Element>, patches: unknown) {
    if (!Array.isArray(patches) || !patches.length) return;

    let changed = false;

    patches.forEach((patch) => {
      const nodeId = String((patch as Record<string, unknown>)?.id || "").trim();
      if (!nodeId) return;

      const target = nodeMap.get(nodeId);
      if (!(target instanceof Element) || !target.isConnected) return;

      const attributes = (patch as Record<string, unknown>)?.attributes;
      if (attributes && typeof attributes === "object" && !Array.isArray(attributes)) {
        syncElementAttributes(target, attributes as Record<string, unknown>);
        changed = true;
      }

      if (typeof (patch as Record<string, unknown>)?.innerHTML === "string") {
        const nextHtml = String((patch as Record<string, unknown>).innerHTML || "");
        if ((target as HTMLElement).innerHTML !== nextHtml) {
          (target as HTMLElement).innerHTML = nextHtml;
          changed = true;
        }
      }
    });

    if (changed) {
      invalidateDecorationSnapshotCache();
    }
  }

  function normalizeSelectorList(value: unknown) {
    if (typeof value === "string") {
      const normalized = value.trim();
      return normalized ? [normalized] : [];
    }
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }

  function isElementActuallyEnabled(element: Element | null) {
    if (!(element instanceof HTMLElement)) return false;
    if ((element as HTMLButtonElement).disabled) return false;
    const ariaDisabled = String(element.getAttribute("aria-disabled") || "").trim().toLowerCase();
    if (ariaDisabled === "true") return false;
    return true;
  }

  function resolveContinuationElement(selectorConfig: unknown, fallbackSelector = "") {
    const selectors = [
      ...normalizeSelectorList(selectorConfig),
      ...normalizeSelectorList(fallbackSelector),
    ];
    for (const selector of selectors) {
      try {
        const element = document.querySelector(selector);
        if (element instanceof HTMLElement) {
          return element;
        }
      } catch {
        // ignore invalid selector
      }
    }
    return null;
  }

  function focusContinuationElement(element: HTMLElement) {
    try {
      element.focus();
    } catch {
      // noop
    }
  }

  function dispatchContinuationEvent(
    element: HTMLElement,
    eventType: string,
    detail: Record<string, unknown> = {},
  ) {
    const normalizedType = String(eventType || "").trim().toLowerCase();
    if (!normalizedType) return;

    if (normalizedType === "input") {
      try {
        element.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            cancelable: true,
            data: typeof detail.data === "string" ? detail.data : undefined,
            inputType: typeof detail.inputType === "string" ? detail.inputType : "insertText",
          }),
        );
        return;
      } catch {
        element.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
        return;
      }
    }

    if (normalizedType === "change") {
      element.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
      return;
    }

    if (normalizedType === "keydown" || normalizedType === "keypress" || normalizedType === "keyup") {
      const key = typeof detail.key === "string" ? detail.key : "Enter";
      const code = typeof detail.code === "string" ? detail.code : undefined;
      const legacyCode =
        typeof detail.keyCode === "number"
          ? Number(detail.keyCode)
          : key === "Enter"
            ? 13
            : key === "Tab"
              ? 9
              : key === "Escape"
                ? 27
                : 0;
      const keyboardEvent = new KeyboardEvent(normalizedType, {
        bubbles: true,
        cancelable: true,
        key,
        code,
        shiftKey: detail.shiftKey === true,
        ctrlKey: detail.ctrlKey === true,
        metaKey: detail.metaKey === true,
        altKey: detail.altKey === true,
      });

      try {
        Object.defineProperty(keyboardEvent, "keyCode", {
          configurable: true,
          get: () => legacyCode,
        });
      } catch {
        // noop
      }
      try {
        Object.defineProperty(keyboardEvent, "which", {
          configurable: true,
          get: () => legacyCode,
        });
      } catch {
        // noop
      }
      try {
        Object.defineProperty(keyboardEvent, "charCode", {
          configurable: true,
          get: () => legacyCode,
        });
      } catch {
        // noop
      }

      element.dispatchEvent(keyboardEvent);
      return;
    }

    if (normalizedType === "focus" || normalizedType === "blur") {
      element.dispatchEvent(new Event(normalizedType, { bubbles: true, cancelable: true }));
      return;
    }

    element.dispatchEvent(new Event(normalizedType, { bubbles: true, cancelable: true }));
  }

  function setInputElementValue(element: HTMLElement, nextText: string, kind = "") {
    const normalizedKind = String(kind || "").trim().toLowerCase();

    if (
      normalizedKind === "contenteditable" ||
      element.isContentEditable ||
      element.getAttribute("contenteditable") === "true"
    ) {
      element.textContent = nextText;
      return { ok: true as const };
    }

    if (element instanceof HTMLTextAreaElement) {
      const descriptor = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      );
      descriptor?.set?.call(element, nextText);
      return { ok: true as const };
    }

    if (element instanceof HTMLInputElement) {
      const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
      descriptor?.set?.call(element, nextText);
      return { ok: true as const };
    }

    return {
      ok: false as const,
      error: `不支持的输入框类型：${element.tagName.toLowerCase()}`,
    };
  }

  function readContinuationElementText(element: HTMLElement | null, trim = true) {
    if (!element) return "";

    if (
      element.isContentEditable ||
      element.getAttribute("contenteditable") === "true" ||
      element.getAttribute("contenteditable") === "plaintext-only"
    ) {
      const text = String(element.textContent || "");
      return trim ? text.trim() : text;
    }

    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      const text = String(element.value || "");
      return trim ? text.trim() : text;
    }

    const text = String(element.textContent || "");
    return trim ? text.trim() : text;
  }

  async function waitForContinuationDelivery(
    inputElement: HTMLElement,
    expectedText: string,
    maxWaitMs = 1200,
  ) {
    const normalizedExpectedText = String(expectedText || "").trim();
    const deadline = Date.now() + Math.max(0, Number(maxWaitMs) || 0);

    do {
      if (!inputElement.isConnected) return true;
      const currentText = readContinuationElementText(inputElement);
      if (currentText !== normalizedExpectedText) {
        return true;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 60));
    } while (Date.now() < deadline);

    return !inputElement.isConnected || readContinuationElementText(inputElement) !== normalizedExpectedText;
  }

  async function tryRequestSubmitFromContinuationTargets(
    inputElement: HTMLElement,
    sendElement: HTMLElement | null,
  ) {
    const formCandidate =
      (sendElement?.closest("form") as HTMLFormElement | null) ||
      (inputElement.closest("form") as HTMLFormElement | null);
    if (!(formCandidate instanceof HTMLFormElement)) {
      return false;
    }

    try {
      if (
        sendElement instanceof HTMLButtonElement ||
        (sendElement instanceof HTMLInputElement && sendElement.type === "submit")
      ) {
        formCandidate.requestSubmit(sendElement);
      } else {
        formCandidate.requestSubmit();
      }
      return true;
    } catch {
      try {
        return formCandidate.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      } catch {
        return false;
      }
    }
  }

  async function waitForContinuationSendElement(
    selectorConfig: unknown,
    waitForEnabled = true,
    maxWaitMs = 1500,
  ) {
    const deadline = Date.now() + Math.max(0, Number(maxWaitMs) || 0);
    do {
      const element = resolveContinuationElement(selectorConfig);
      if (element && (!waitForEnabled || isElementActuallyEnabled(element))) {
        return element;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 60));
    } while (Date.now() < deadline);
    return resolveContinuationElement(selectorConfig);
  }

  function matchesSelectorConfig(target: Element | null, selectorConfig: unknown) {
    if (!(target instanceof Element)) return false;
    const selectors = normalizeSelectorList(selectorConfig);
    for (const selector of selectors) {
      try {
        if (target.matches(selector) || target.closest(selector)) {
          return true;
        }
      } catch {
        // ignore invalid selector
      }
    }
    return false;
  }

  async function refreshManualInjectionPlanCache() {
    if (!isPluginRuntimeEnabled() || !String(state.adapterScript || "").trim()) {
      cachedManualInjectionPlan = null;
      return;
    }

    if (manualInjectionPlanRefreshRunning) {
      manualInjectionPlanRefreshQueued = true;
      return;
    }

    manualInjectionPlanRefreshRunning = true;
    try {
      const snapshot = getDecorationSnapshot();
      if (!snapshot?.html) {
        cachedManualInjectionPlan = null;
        return;
      }

      const plan = await executeAdapterHookInSandbox(
        "continueConversation",
        {
          url: location.href,
          host: location.hostname,
          continuationText: MANUAL_INJECTION_PLAN_PREVIEW_TEXT,
          toolResultText: MANUAL_INJECTION_PLAN_PREVIEW_TEXT,
        },
        {
          snapshotHtml: snapshot.html,
          timeoutMs: 10000,
        },
      );

      cachedManualInjectionPlan =
        plan && typeof plan === "object" && !Array.isArray(plan)
          ? (() => {
              const validation = validateDomContinuationPlan(plan);
              return validation.ok
                ? ({ ...(validation.normalized as Record<string, unknown>) } as Record<string, unknown>)
                : null;
            })()
          : null;
    } catch (error) {
      cachedManualInjectionPlan = null;
      logAdapterSandboxError("continueConversation cache", error);
    } finally {
      manualInjectionPlanRefreshRunning = false;
      if (manualInjectionPlanRefreshQueued) {
        manualInjectionPlanRefreshQueued = false;
        scheduleManualInjectionPlanRefresh();
      }
    }
  }

  function scheduleManualInjectionPlanRefresh() {
    clearManualInjectionPlanRefreshTimer();
    if (!isPluginRuntimeEnabled() || !String(state.adapterScript || "").trim()) {
      cachedManualInjectionPlan = null;
      return;
    }

    manualInjectionPlanRefreshTimerId = window.setTimeout(() => {
      manualInjectionPlanRefreshTimerId = 0;
      void refreshManualInjectionPlanCache();
    }, 180);
  }

  function doesPlanMatchManualSendTrigger(
    plan: Record<string, unknown>,
    triggerType: "click" | "keydown" | "submit",
    target: Element | null,
    keyboardEvent?: KeyboardEvent | null,
  ) {
    const inputPlan =
      plan?.input && typeof plan.input === "object" && !Array.isArray(plan.input)
        ? (plan.input as Record<string, unknown>)
        : {};
    const sendPlan =
      plan?.send && typeof plan.send === "object" && !Array.isArray(plan.send)
        ? (plan.send as Record<string, unknown>)
        : {};
    const sendMode = String(sendPlan?.mode || "").trim().toLowerCase() || "click";
    const inputSelectorConfig = inputPlan?.selector || inputPlan?.selectors;
    const sendSelectorConfig = sendPlan?.selector || sendPlan?.selectors;
    const sendTargetConfig =
      sendPlan?.targetSelector || sendPlan?.targetSelectors || inputSelectorConfig;

    if (triggerType === "click") {
      if (sendMode !== "click") return false;
      return matchesSelectorConfig(target, sendSelectorConfig);
    }

    if (triggerType === "keydown") {
      if (sendMode !== "enter") return false;
      const eventKey = String(keyboardEvent?.key || "").trim() || "Enter";
      const expectedKey = String(sendPlan?.key || "Enter").trim() || "Enter";
      if (eventKey !== expectedKey) return false;
      if (Boolean(keyboardEvent?.shiftKey) !== Boolean(sendPlan?.shiftKey === true)) return false;
      if (Boolean(keyboardEvent?.ctrlKey) !== Boolean(sendPlan?.ctrlKey === true)) return false;
      if (Boolean(keyboardEvent?.metaKey) !== Boolean(sendPlan?.metaKey === true)) return false;
      if (Boolean(keyboardEvent?.altKey) !== Boolean(sendPlan?.altKey === true)) return false;
      return matchesSelectorConfig(target, sendTargetConfig);
    }

    if (!(target instanceof HTMLFormElement)) return false;
    const inputElement = resolveContinuationElement(
      inputSelectorConfig,
      "textarea, input[type='text'], [contenteditable='true']",
    );
    return Boolean(inputElement && inputElement.closest("form") === target);
  }

  function prepareManualInjectionWithPlan(
    plan: Record<string, unknown>,
    injectionText: string,
    injectionMode: "system" | "raw",
  ): { ok: true; changed: boolean } | { ok: false; error: string } {
    const inputPlan =
      plan?.input && typeof plan.input === "object" && !Array.isArray(plan.input)
        ? (plan.input as Record<string, unknown>)
        : {};
    const inputElement = resolveContinuationElement(
      inputPlan?.selector || inputPlan?.selectors,
      "textarea, input[type='text'], [contenteditable='true']",
    );
    if (!inputElement) {
      return { ok: false as const, error: "未找到待拼接的输入框" };
    }

    const currentText = readContinuationElementText(inputElement, false);
    const normalizedCurrentText = normalizeInjectionText(currentText);
    if (normalizedCurrentText) {
      state.bubbleDecorationFallback.requestMessagePreview = normalizedCurrentText;
      state.bubbleDecorationFallback.updatedAt = Date.now();
    }
    const nextText = buildInjectedComposerText(injectionText, currentText, injectionMode);
    const changed = normalizeMultilineText(nextText) !== normalizeMultilineText(currentText);

    if (changed) {
      focusContinuationElement(inputElement);
      const setResult = setInputElementValue(inputElement, nextText, String(inputPlan?.kind || ""));
      if (!setResult.ok) {
        return {
          ok: false as const,
          error: String(setResult.error || "输入框赋值失败"),
        };
      }

      const dispatchEvents = normalizeSelectorList(inputPlan?.dispatchEvents);
      const nextEvents = dispatchEvents.length
        ? dispatchEvents
        : inputElement.isContentEditable || inputElement.getAttribute("contenteditable") === "true"
          ? ["input"]
          : ["input", "change"];
      nextEvents.forEach((eventName) => {
        dispatchContinuationEvent(inputElement, eventName, {
          data: nextText,
          inputType: "insertText",
        });
      });
      invalidateDecorationSnapshotCache();
    }

    state.manualDomInjection.active = true;
    state.manualDomInjection.injectionText = String(injectionText || "").trim();
    state.manualDomInjection.injectionMode = injectionMode;
    state.manualDomInjection.preparedAt = Date.now();
    return {
      ok: true as const,
      changed,
    };
  }

  function maybePreparePendingManualInjectionFromTrigger(params: {
    triggerType: "click" | "keydown" | "submit";
    target: EventTarget | null;
    keyboardEvent?: KeyboardEvent | null;
  }) {
    if (!isPluginRuntimeEnabled()) return { ok: false as const, reason: "disabled" };
    if (!String(state.adapterScript || "").trim()) return { ok: false as const, reason: "no-adapter" };

    const injectionText = normalizeInjectionText(state.requestInjectionText);
    const injectionMode = String(state.requestInjectionMode || "system").trim().toLowerCase() === "raw"
      ? "raw"
      : "system";
    if (!injectionText) return { ok: false as const, reason: "no-injection" };

    const target = params.target instanceof Element ? params.target : null;
    if (target?.closest(`#${SYSTEM_INJECTION_WIDGET_ID}`)) {
      return { ok: false as const, reason: "widget" };
    }
    // 发送触发前优先尝试把注入内容同步进输入框。
    // 仅依赖 transformRequest 的静态存在性会漏掉“当前这次请求并未实际改写”的场景。
    const planCandidates = buildSendTriggerPlanCandidates(injectionText);

    const errors: string[] = [];
    while (planCandidates.length) {
      const candidate = findMatchingSendTriggerPlan(params, planCandidates);
      if (!candidate) break;
      planCandidates.splice(planCandidates.indexOf(candidate), 1);

      const prepared = prepareManualInjectionWithPlan(candidate.plan, injectionText, injectionMode);
      if ("error" in prepared) {
        errors.push(`${candidate.label}：${String(prepared.error || "输入框拼接失败")}`);
        continue;
      }
      scheduleManualInjectionPlanRefresh();
      return {
        ok: true as const,
        changed: prepared.changed,
        source: candidate.label,
      };
    }

    return {
      ok: false as const,
      reason: errors.join("；") || "no-match",
    };
  }

  function maybeRecordSendIntentFromTrigger(params: {
    triggerType: "click" | "keydown" | "submit";
    target: EventTarget | null;
    keyboardEvent?: KeyboardEvent | null;
  }) {
    if (!isPluginRuntimeEnabled()) return { ok: false as const, reason: "disabled" };
    if (!String(state.adapterScript || "").trim()) return { ok: false as const, reason: "no-adapter" };

    const target = params.target instanceof Element ? params.target : null;
    if (target?.closest(`#${SYSTEM_INJECTION_WIDGET_ID}`)) {
      return { ok: false as const, reason: "widget" };
    }

    const matched = findMatchingSendTriggerPlan(
      params,
      buildSendTriggerPlanCandidates("[Chat Plus Pending Send]"),
    );
    if (!matched) {
      return { ok: false as const, reason: "no-match" };
    }

    markExpectedAssistantTurn("user");
    return {
      ok: true as const,
      source: matched.label,
    };
  }

  function buildGenericContinueConversationPlans(continuationText: string): ContinueConversationPlanCandidate[] {
    const normalizedText = String(continuationText || "").trim();
    if (!normalizedText) return [];

    const inputSelectors = [
      "textarea",
      "[contenteditable='true']",
      "[contenteditable='plaintext-only']",
      "input[type='text']",
      "input:not([type])",
    ];
    const sendSelectors = [
      "button[type='submit']",
      "[data-testid*='send' i]",
      "[aria-label*='send' i]",
      "[aria-label*='发送' i]",
      "[title*='send' i]",
      "[title*='发送' i]",
      "button.send-button",
      ".send-button",
      "[class*='send-button']",
      "[class*='send'] button",
    ];

    return [
      {
        label: "通用点击发送",
        plan: {
          mode: "dom",
          composerText: normalizedText,
          input: {
            selectors: inputSelectors,
            dispatchEvents: ["input", "change"],
          },
          send: {
            mode: "click",
            selectors: sendSelectors,
            waitForEnabled: true,
            maxWaitMs: 3000,
          },
        } as Record<string, unknown>,
      },
      {
        label: "通用回车发送",
        plan: {
          mode: "dom",
          composerText: normalizedText,
          input: {
            selectors: inputSelectors,
            dispatchEvents: ["input", "change"],
          },
          send: {
            mode: "enter",
            targetSelectors: inputSelectors,
            key: "Enter",
            code: "Enter",
          },
        } as Record<string, unknown>,
      },
    ];
  }

  function buildGenericFillOnlyContinueConversationPlans(
    continuationText: string,
  ): ContinueConversationPlanCandidate[] {
    const normalizedText = String(continuationText || "").trim();
    if (!normalizedText) return [];

    return [
      {
        label: "通用填充输入框",
        plan: {
          mode: "dom",
          composerText: normalizedText,
          input: {
            selectors: [
              "textarea",
              "[contenteditable='true']",
              "[contenteditable='plaintext-only']",
              "input[type='text']",
              "input:not([type])",
            ],
            dispatchEvents: ["input", "change"],
          },
          send: {
            mode: "none",
          },
        } as Record<string, unknown>,
      },
    ];
  }

  function buildSendTriggerPlanCandidates(continuationText: string) {
    const planCandidates: ContinueConversationPlanCandidate[] = [];
    if (cachedManualInjectionPlan) {
      planCandidates.push({
        label: "站点适配器",
        plan: cachedManualInjectionPlan,
      });
    }
    planCandidates.push(...buildGenericContinueConversationPlans(continuationText));
    return planCandidates;
  }

  function findMatchingSendTriggerPlan(
    params: {
      triggerType: "click" | "keydown" | "submit";
      target: EventTarget | null;
      keyboardEvent?: KeyboardEvent | null;
    },
    planCandidates: ContinueConversationPlanCandidate[],
  ) {
    const target = params.target instanceof Element ? params.target : null;
    for (const candidate of planCandidates) {
      if (!candidate?.plan || typeof candidate.plan !== "object") continue;
      if (
        doesPlanMatchManualSendTrigger(
          candidate.plan,
          params.triggerType,
          target,
          params.keyboardEvent || null,
        )
      ) {
        return candidate;
      }
    }
    return null;
  }

  async function tryContinueConversationPlans(
    planCandidates: ContinueConversationPlanCandidate[],
    continuationText: string,
  ) {
    const errors: string[] = [];

    for (const candidate of planCandidates) {
      if (!candidate?.plan || typeof candidate.plan !== "object") continue;
      const execution = await executeContinueConversationPlan(candidate.plan, continuationText);
      if (execution.ok) {
        return {
          ok: true as const,
          source: candidate.label,
        };
      }

      errors.push(`${candidate.label}：${String(execution.error || "自动续发失败")}`);
    }

    return {
      ok: false as const,
      error: errors.join("；") || "自动续发失败",
    };
  }

  function setPendingToolResultState(
    nextText: string,
    options?: {
      autoContinueInFlight?: boolean;
    },
  ) {
    state.codeMode.pendingToolResultText = String(nextText || "").trim();
    state.codeMode.manualPreparedToolResultText = "";
    state.codeMode.autoContinueInFlight = options?.autoContinueInFlight === true;
    syncRequestInjectionToMonitor();
  }

  function setManualPreparedToolResultState(nextText: string) {
    state.codeMode.pendingToolResultText = "";
    state.codeMode.manualPreparedToolResultText = String(nextText || "").trim();
    state.codeMode.autoContinueInFlight = false;
    syncRequestInjectionToMonitor();
  }

  function scheduleAutoContinueFallbackRetry(
    continuationText: string,
    planCandidates: ContinueConversationPlanCandidate[],
  ) {
    clearAutoContinueFallbackTimer();
    const normalizedText = String(continuationText || "").trim();
    if (!normalizedText || !planCandidates.length) return;

    state.codeMode.autoContinueFallbackTimerId = window.setTimeout(() => {
      state.codeMode.autoContinueFallbackTimerId = 0;
      if (!isPluginRuntimeEnabled()) return;
      if (String(state.codeMode.pendingToolResultText || "").trim() !== normalizedText) return;

      void (async () => {
        setPendingToolResultState(normalizedText, {
          autoContinueInFlight: true,
        });

        const retryResult = await tryContinueConversationPlans(planCandidates, normalizedText);
        if (retryResult.ok) {
          state.codeMode.statusTone = "running";
          state.codeMode.statusText = "工具结果已发送";
          state.codeMode.detailText = `自动重试成功，来源：${retryResult.source}`;
          renderCodeModeStatusBar();
          return;
        }

        setPendingToolResultState(normalizedText);
        state.codeMode.statusTone = "error";
        state.codeMode.statusText = "自动续发失败";
        state.codeMode.detailText = "已保留工具结果，下次发送会自动带上";
        renderCodeModeStatusBar();
      })();
    }, 1500);
  }

  async function executeContinueConversationPlan(
    plan: Record<string, unknown>,
    continuationText: string,
  ) {
    const validation = validateDomContinuationPlan({
      ...plan,
      composerText: String(plan?.composerText || continuationText || ""),
    });
    if (!validation.ok) {
      return {
        ok: false as const,
        error: `continueConversation plan 非法：${validation.errors.join("；")}`,
      };
    }

    const normalizedPlan = validation.normalized as Record<string, unknown>;
    const mode = String(normalizedPlan?.mode || "dom").trim().toLowerCase();
    if (mode && mode !== "dom") {
      return { ok: false as const, error: `continueConversation 仅支持 DOM 模式，当前为 ${mode}` };
    }

    const nextText = String(normalizedPlan?.composerText || continuationText || "").trim();
    if (!nextText) {
      return { ok: false as const, error: "自动续发文本为空" };
    }

    const inputPlan =
      normalizedPlan?.input &&
      typeof normalizedPlan.input === "object" &&
      !Array.isArray(normalizedPlan.input)
        ? (normalizedPlan.input as Record<string, unknown>)
        : {};
    const sendPlan =
      normalizedPlan?.send &&
      typeof normalizedPlan.send === "object" &&
      !Array.isArray(normalizedPlan.send)
        ? (normalizedPlan.send as Record<string, unknown>)
        : {};
    const inputElement = resolveContinuationElement(
      inputPlan?.selector || inputPlan?.selectors,
      "textarea, input[type='text'], [contenteditable='true']",
    );
    if (!inputElement) {
      return { ok: false as const, error: "未找到 continueConversation 输入框" };
    }

    focusContinuationElement(inputElement);
    const setResult = setInputElementValue(inputElement, nextText, String(inputPlan?.kind || ""));
    if (!setResult.ok) {
      return setResult;
    }
    invalidateDecorationSnapshotCache();

    const dispatchEvents = normalizeSelectorList(inputPlan?.dispatchEvents);
    const nextEvents = dispatchEvents.length
      ? dispatchEvents
      : inputElement.isContentEditable || inputElement.getAttribute("contenteditable") === "true"
        ? ["input"]
        : ["input", "change"];
    nextEvents.forEach((eventName) => {
      dispatchContinuationEvent(inputElement, eventName, {
        data: nextText,
        inputType: "insertText",
      });
    });

    const beforeSendDelayMs = Math.max(0, Number(sendPlan?.beforeSendDelayMs ?? 120) || 0);
    if (beforeSendDelayMs > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, beforeSendDelayMs));
    }
    const successWaitMs = Math.max(0, Number(sendPlan?.successWaitMs ?? 1200) || 0);

    const sendMode = String(sendPlan?.mode || "").trim().toLowerCase() || "click";
    if (sendMode === "none" || sendMode === "fill") {
      return { ok: true as const };
    }
    if (sendMode === "enter") {
      const keyboardTarget =
        resolveContinuationElement(sendPlan?.targetSelector || sendPlan?.targetSelectors) ||
        inputElement;
      focusContinuationElement(keyboardTarget);
      ["keydown", "keypress", "keyup"].forEach((eventName) => {
        dispatchContinuationEvent(keyboardTarget, eventName, {
          key: String(sendPlan?.key || "Enter"),
          code: String(sendPlan?.code || "Enter"),
          shiftKey: sendPlan?.shiftKey === true,
          ctrlKey: sendPlan?.ctrlKey === true,
          metaKey: sendPlan?.metaKey === true,
          altKey: sendPlan?.altKey === true,
        });
      });
      const delivered = await waitForContinuationDelivery(inputElement, nextText, successWaitMs);
      if (delivered) {
        markExpectedAssistantTurn("auto");
        return { ok: true as const };
      }
      const submitted = await tryRequestSubmitFromContinuationTargets(inputElement, keyboardTarget);
      if (submitted && (await waitForContinuationDelivery(inputElement, nextText, successWaitMs))) {
        markExpectedAssistantTurn("auto");
        return { ok: true as const };
      }
      return {
        ok: false as const,
        error: "回车事件已触发，但输入框内容未提交，站点可能未接受 synthetic Enter",
      };
    }

    const sendElement = await waitForContinuationSendElement(
      sendPlan?.selector || sendPlan?.selectors,
      sendPlan?.waitForEnabled !== false,
      Number(sendPlan?.maxWaitMs || 1500),
    );
    if (!sendElement) {
      return { ok: false as const, error: "未找到 continueConversation 发送按钮" };
    }
    if (!isElementActuallyEnabled(sendElement)) {
      return { ok: false as const, error: "continueConversation 发送按钮当前不可点击" };
    }

    focusContinuationElement(sendElement);
    sendElement.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    sendElement.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    sendElement.click();
    const delivered = await waitForContinuationDelivery(inputElement, nextText, successWaitMs);
    if (delivered) {
      markExpectedAssistantTurn("auto");
      return { ok: true as const };
    }
    const submitted = await tryRequestSubmitFromContinuationTargets(inputElement, sendElement);
    if (submitted && (await waitForContinuationDelivery(inputElement, nextText, successWaitMs))) {
      markExpectedAssistantTurn("auto");
      return { ok: true as const };
    }
    return {
      ok: false as const,
      error: "点击发送已触发，但输入框内容未提交，站点可能未接受 synthetic click",
    };
  }

  function completeAutoContinueCycle(clearPendingToolResult = true) {
    clearAutoContinueFallbackTimer();
    state.codeMode.autoContinueInFlight = false;
    state.codeMode.manualPreparedToolResultText = "";
    if (clearPendingToolResult) {
      state.codeMode.pendingToolResultText = "";
    }
    syncRequestInjectionToMonitor();
  }

  function cloneContinueConversationPlanWithSendMode(
    plan: Record<string, unknown>,
    sendMode: "click" | "enter" | "none",
  ) {
    const nextPlan = { ...plan };
    const nextSend =
      plan?.send && typeof plan.send === "object" && !Array.isArray(plan.send)
        ? { ...(plan.send as Record<string, unknown>) }
        : {};
    nextSend.mode = sendMode;
    nextPlan.send = nextSend;
    return nextPlan;
  }

  async function continueConversationWithToolResult(toolResultText: string) {
    const nextText = String(toolResultText || "").trim();
    if (!nextText) {
      return { ok: false as const, error: "缺少工具结果文本" };
    }
    if (!isPluginRuntimeEnabled()) {
      return { ok: false as const, error: "当前页面已关闭 Chat Plus" };
    }
    if (!String(state.adapterScript || "").trim()) {
      return { ok: false as const, error: "当前站点没有有效适配脚本" };
    }

    try {
      const autoSendEnabled = state.codeMode.autoContinueEnabled;
      const planCandidates: ContinueConversationPlanCandidate[] = [];
      const snapshot = getDecorationSnapshot();
      if (snapshot?.html) {
        const plan = await executeAdapterHookInSandbox(
          "continueConversation",
          {
            url: location.href,
            host: location.hostname,
            continuationText: nextText,
            toolResultText: nextText,
          },
          {
            snapshotHtml: snapshot.html,
            timeoutMs: 10000,
          },
        );
        if (plan && typeof plan === "object") {
          planCandidates.push({
            label: "站点适配器",
            plan: autoSendEnabled
              ? (plan as Record<string, unknown>)
              : cloneContinueConversationPlanWithSendMode(
                  plan as Record<string, unknown>,
                  "none",
                ),
          });
        }
      }

      planCandidates.push(
        ...(autoSendEnabled
          ? buildGenericContinueConversationPlans(nextText)
          : buildGenericFillOnlyContinueConversationPlans(nextText)),
      );

      if (!planCandidates.length) {
        setPendingToolResultState(nextText);
        return {
          ok: false as const,
          queuedForNextRequest: true,
          error: "没有可用的自动续发方案，已保留到下一次发送",
        };
      }

      if (!autoSendEnabled) {
        const execution = await tryContinueConversationPlans(planCandidates, nextText);
        if (execution.ok) {
          setManualPreparedToolResultState(nextText);
          return {
            ok: true as const,
            source: execution.source,
            delivery: "filled" as const,
          };
        }

        setPendingToolResultState(nextText);
        return {
          ok: false as const,
          queuedForNextRequest: true,
          error: `${execution.error}；未能填入输入框，已保留到下一次发送`,
        };
      }

      setPendingToolResultState(nextText, {
        autoContinueInFlight: true,
      });
      await waitForAutoContinueDelay();
      if (!isPluginRuntimeEnabled()) {
        setPendingToolResultState(nextText);
        return {
          ok: false as const,
          queuedForNextRequest: true,
          error: "当前页面已关闭 Chat Plus；已保留到下一次发送",
        };
      }

      const execution = await tryContinueConversationPlans(planCandidates, nextText);
      if (execution.ok) {
        return {
          ok: true as const,
          source: execution.source,
          delivery: "sent" as const,
        };
      }

      setPendingToolResultState(nextText);
      scheduleAutoContinueFallbackRetry(nextText, planCandidates);
      return {
        ok: false as const,
        queuedForNextRequest: true,
        retryScheduled: true,
        error: `${execution.error}；已安排一次自动重试，若仍失败，下次发送会自动带上工具结果`,
      };
    } catch (error) {
      setPendingToolResultState(nextText);
      return {
        ok: false as const,
        queuedForNextRequest: true,
        error: `${stringifyError(error)}；已保留到下一次发送`,
      };
    }
  }

  async function sendStandalonePrompt(
    promptText: string,
    options?: { allowFillFallback?: boolean },
  ) {
    const nextText = String(promptText || "").trim();
    if (!nextText) {
      return { ok: false as const, error: "缺少要发送的内容" };
    }
    if (!isPluginRuntimeEnabled()) {
      return { ok: false as const, error: "当前页面已关闭 Chat Plus" };
    }
    if (!String(state.adapterScript || "").trim()) {
      return { ok: false as const, error: "当前站点没有有效适配脚本" };
    }

    try {
      const allowFillFallback = options?.allowFillFallback !== false;
      const planCandidates: ContinueConversationPlanCandidate[] = [];
      const snapshot = getDecorationSnapshot();
      if (snapshot?.html) {
        const plan = await executeAdapterHookInSandbox(
          "continueConversation",
          {
            url: location.href,
            host: location.hostname,
            continuationText: nextText,
            toolResultText: nextText,
          },
          {
            snapshotHtml: snapshot.html,
            timeoutMs: 10000,
          },
        );
        if (plan && typeof plan === "object") {
          planCandidates.push({
            label: "站点适配器",
            plan: plan as Record<string, unknown>,
          });
        }
      }

      planCandidates.push(...buildGenericContinueConversationPlans(nextText));
      const execution = await tryContinueConversationPlans(planCandidates, nextText);
      if (execution.ok) {
        return {
          ok: true as const,
          source: execution.source,
          delivery: "sent" as const,
        };
      }

      if (!allowFillFallback) {
        return {
          ok: false as const,
          error: execution.error,
        };
      }

      const fillOnlyExecution = await tryContinueConversationPlans(
        buildGenericFillOnlyContinueConversationPlans(nextText),
        nextText,
      );
      if (fillOnlyExecution.ok) {
        return {
          ok: true as const,
          source: fillOnlyExecution.source,
          delivery: "filled" as const,
        };
      }

      return {
        ok: false as const,
        error: `${execution.error}；补救填充也失败`,
      };
    } catch (error) {
      return { ok: false as const, error: stringifyError(error) };
    }
  }

  async function requestContextCompression() {
    return sendStandalonePrompt(CONTEXT_COMPRESSION_PROMPT);
  }

  async function executeBubbleDecoration() {
    if (!isPluginRuntimeEnabled()) return;
    if (!String(state.adapterScript || "").trim()) return;

    if (state.bubbleDecorationRunning) {
      state.bubbleDecorationQueued = true;
      return;
    }

    state.bubbleDecorationRunning = true;
    try {
      const snapshot = getDecorationSnapshot();
      if (!snapshot) return;

      const result = await executeAdapterHookInSandbox(
        "decorateBubbles",
        {
          url: location.href,
          host: location.hostname,
          requestMessagePreview:
            Date.now() - Number(state.bubbleDecorationFallback.updatedAt || 0) < 45000
              ? state.bubbleDecorationFallback.requestMessagePreview
              : "",
          responseContentPreview:
            Date.now() - Number(state.bubbleDecorationFallback.responseUpdatedAt || 0) < 45000
              ? state.bubbleDecorationFallback.responseContentPreview
              : "",
        },
        {
          snapshotHtml: snapshot.html,
          timeoutMs: 10000,
        },
      );

      applyDecorationPatches(snapshot.nodeMap, (result as Record<string, unknown>)?.patches);
    } catch (error) {
      logAdapterSandboxError("decorateBubbles", error);
    } finally {
      state.bubbleDecorationRunning = false;
      if (state.bubbleDecorationQueued) {
        state.bubbleDecorationQueued = false;
        scheduleBubbleDecoration();
      }
    }
  }

  function scheduleBubbleDecoration() {
    if (!isPluginRuntimeEnabled() || !String(state.adapterScript || "").trim()) {
      clearBubbleDecorationTimer();
      return;
    }

    if (state.bubbleDecorationTimerId) {
      window.clearTimeout(state.bubbleDecorationTimerId);
    }

    state.bubbleDecorationTimerId = window.setTimeout(() => {
      state.bubbleDecorationTimerId = 0;
      void executeBubbleDecoration();
    }, 160);
  }

  function isChatPlusRuntimeNode(node: Node | null) {
    if (!node) return false;
    if (state.adapterSandbox.frame && node === state.adapterSandbox.frame) {
      return true;
    }

    const element =
      node instanceof Element ? node : node.parentElement instanceof Element ? node.parentElement : null;
    if (!element) return false;
    if (
      element.id === SYSTEM_INJECTION_WIDGET_ID ||
      element.id === CODE_MODE_STATUS_BAR_ID ||
      (state.adapterSandbox.frame && element === state.adapterSandbox.frame)
    ) {
      return true;
    }
    return Boolean(
      element.closest(`#${SYSTEM_INJECTION_WIDGET_ID}`) || element.closest(`#${CODE_MODE_STATUS_BAR_ID}`),
    );
  }

  function shouldIgnoreBubbleObserverRecord(record: MutationRecord) {
    if (record.type === "characterData") {
      return isChatPlusRuntimeNode(record.target);
    }

    const changedNodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
    if (changedNodes.length > 0 && changedNodes.every((node) => isChatPlusRuntimeNode(node))) {
      return true;
    }

    return isChatPlusRuntimeNode(record.target);
  }

  function syncBubbleDecorationObserver() {
    if (state.bubbleDecorationObserver) {
      state.bubbleDecorationObserver.disconnect();
      state.bubbleDecorationObserver = null;
    }

    clearBubbleDecorationTimer();
    clearBubbleDecorationRefreshRetryTimers();
    clearManualInjectionPlanRefreshTimer();
    cachedManualInjectionPlan = null;
    invalidateDecorationSnapshotCache();
    if (!isPluginRuntimeEnabled() || !String(state.adapterScript || "").trim()) {
      return;
    }

    scheduleBubbleDecoration();
    scheduleManualInjectionPlanRefresh();
    state.bubbleDecorationObserver = new MutationObserver((records) => {
      let sawRelevantRecord = false;
      let shouldRefreshDecoration = false;
      let shouldRefreshManualPlan = false;

      for (const record of records) {
        if (shouldIgnoreBubbleObserverRecord(record)) {
          continue;
        }
        sawRelevantRecord = true;
        shouldRefreshDecoration = true;
        if (record.type === "childList") {
          shouldRefreshManualPlan = true;
        }
        if (shouldRefreshDecoration && shouldRefreshManualPlan) {
          break;
        }
      }

      if (sawRelevantRecord) {
        invalidateDecorationSnapshotCache();
      }
      if (shouldRefreshDecoration) {
        scheduleBubbleDecoration();
      }
      if (shouldRefreshManualPlan) {
        scheduleManualInjectionPlanRefresh();
      }
    });

    const observeTarget = document.body || document.documentElement;
    if (!(observeTarget instanceof HTMLElement)) {
      return;
    }

    state.bubbleDecorationObserver.observe(observeTarget, {
      subtree: true,
      childList: true,
      attributes: false,
      characterData: true,
    });
  }

  function requestBubbleDecorationRefresh() {
    invalidateDecorationSnapshotCache();
    scheduleBubbleDecoration();
    clearBubbleDecorationRefreshRetryTimers();
    [360, 1100].forEach((delayMs) => {
      const timerId = window.setTimeout(() => {
        bubbleDecorationRefreshRetryTimerIds.delete(timerId);
        invalidateDecorationSnapshotCache();
        scheduleBubbleDecoration();
      }, delayMs);
      bubbleDecorationRefreshRetryTimerIds.add(timerId);
    });
  }

  return {
    clearBubbleDecorationTimer,
    clearAutoContinueFallbackTimer,
    continueConversationWithToolResult,
    sendStandalonePrompt,
    requestContextCompression,
    completeAutoContinueCycle,
    maybePreparePendingManualInjectionFromTrigger,
    maybeRecordSendIntentFromTrigger,
    resetManualDomInjectionState,
    requestBubbleDecorationRefresh,
    syncBubbleDecorationObserver,
  };
}
