import { parser } from "@lezer/javascript";

import {
  SITE_ADAPTER_META_KEY,
  SITE_ADAPTER_REQUIRED_HOOKS,
  escapeRegExp,
  toTrimmedText,
} from "./shared";

export type SiteAdapterWarning = {
  code: string;
  message: string;
};

export type SiteAdapterLintResult = {
  warnings: SiteAdapterWarning[];
  hasMeta: boolean;
  hasReturnObject: boolean;
  hooks: Record<(typeof SITE_ADAPTER_REQUIRED_HOOKS)[number], boolean>;
};

export type SiteAdapterChecklistStatus = "pass" | "fail";

export type SiteAdapterChecklistItem = {
  id: string;
  label: string;
  status: SiteAdapterChecklistStatus;
  detail: string;
};

const HOOK_BODY_CACHE_LIMIT = 200;
const hookBodyCache = new Map<string, Record<string, string>>();

function trimHookBodyCache() {
  if (hookBodyCache.size <= HOOK_BODY_CACHE_LIMIT) return;
  const oldestKey = hookBodyCache.keys().next().value;
  if (oldestKey) hookBodyCache.delete(oldestKey);
}

function getHookBodyMap(source: string) {
  const normalized = String(source || "").replace(/\r\n?/g, "\n");
  const cached = hookBodyCache.get(normalized);
  if (cached) return cached;

  const hookBodies: Record<string, string> = {};
  const tree = parser.parse(normalized);
  const cursor = tree.cursor();
  const hookNames = new Set<string>([...SITE_ADAPTER_REQUIRED_HOOKS, "meta"]);

  do {
    if (
      cursor.name !== "Property" &&
      cursor.name !== "MethodDeclaration" &&
      cursor.name !== "FunctionDeclaration"
    ) {
      continue;
    }

    const snippet = normalized.slice(cursor.from, cursor.to).trimStart();
    const nameMatch = snippet.match(/^([A-Za-z_$][\w$]*)/);
    const name = nameMatch?.[1] || "";
    if (!hookNames.has(name)) {
      continue;
    }

    const openBraceIndex = snippet.indexOf("{");
    const closeBraceIndex = snippet.lastIndexOf("}");
    if (openBraceIndex < 0 || closeBraceIndex <= openBraceIndex) {
      continue;
    }

    hookBodies[name] = snippet.slice(openBraceIndex + 1, closeBraceIndex);
  } while (cursor.next());

  hookBodyCache.set(normalized, hookBodies);
  trimHookBodyCache();
  return hookBodies;
}

function extractHookBody(source: string, hookName: string) {
  return getHookBodyMap(source)[String(hookName || "")] || "";
}

export function readHookBody(source: string, hookName: string) {
  return extractHookBody(String(source || "").replace(/\r\n?/g, "\n"), hookName);
}

function hookBodyIncludes(source: string, hookName: string, pattern: RegExp | string) {
  const body = extractHookBody(String(source || "").replace(/\r\n?/g, "\n"), hookName);
  if (!body) return false;
  return typeof pattern === "string" ? body.includes(pattern) : pattern.test(body);
}

export function usesProtocolBubbleHelper(source?: string) {
  return hookBodyIncludes(String(source || ""), "decorateBubbles", /ctx\.helpers\.ui\.decorateProtocolBubbles/);
}

export function usesDomPlanHelper(source?: string) {
  return hookBodyIncludes(String(source || ""), "continueConversation", /ctx\.helpers\.plans\.dom/);
}

export function usesBuildInjectedTextHelper(source?: string) {
  return hookBodyIncludes(String(source || ""), "transformRequest", /ctx\.helpers\.buildInjectedText/);
}

export function continueConversationUsesContinuationText(source?: string) {
  return hookBodyIncludes(String(source || ""), "continueConversation", /ctx\.continuationText/);
}

export function extractResponseReturnsPreview(source?: string) {
  return hookBodyIncludes(String(source || ""), "extractResponse", /\bresponseContentPreview\b/);
}

export function hasMetaAdapterName(source?: string) {
  return /\badapterName\s*:\s*["'`].+?["'`]/.test(String(source || ""));
}

export function hasMetaCapabilities(source?: string) {
  return /\bcapabilities\s*:\s*\{/.test(String(source || ""));
}

export function hasCustomProtocolUiHelpers(source?: string) {
  const normalized = String(source || "").replace(/\r\n?/g, "\n");
  return (
    /\bfunction\s+renderProtocolCard\s*\(/.test(normalized) ||
    /\bfunction\s+getProtocolCardTheme\s*\(/.test(normalized) ||
    /\bfunction\s+detectToolResultTone\s*\(/.test(normalized) ||
    /\bfunction\s+formatCodeModeDisplayText\s*\(/.test(normalized)
  );
}

export function buildSiteAdapterChecklist(source?: string): SiteAdapterChecklistItem[] {
  const normalized = String(source || "").replace(/\r\n?/g, "\n").trim();
  const lint = lintSiteAdapterScript(normalized);
  const meta = summarizeAdapterMeta(normalized);
  const hasMetaCapabilitiesValue = hasMetaCapabilities(normalized);
  const hasBubbleHelper = usesProtocolBubbleHelper(normalized);
  const hasDomPlan = usesDomPlanHelper(normalized);
  const hasCustomUiHelpers = hasCustomProtocolUiHelpers(normalized);

  return [
    {
      id: "contract.return",
      label: "最外层返回对象",
      status: lint.hasReturnObject ? "pass" : "fail",
      detail: lint.hasReturnObject ? "已检测到 return { ... }。" : "缺少 return 对象，脚本不会生效。",
    },
    ...SITE_ADAPTER_REQUIRED_HOOKS.map((hookName) => ({
      id: `hook.${hookName}`,
      label: hookName,
      status: lint.hooks[hookName] ? ("pass" as const) : ("fail" as const),
      detail: lint.hooks[hookName] ? `${hookName} 已声明。` : `${hookName} 缺失。`,
    })),
    {
      id: "meta.version",
      label: "meta.contractVersion",
      status: meta.contractVersion > 0 ? "pass" : "fail",
      detail:
        meta.contractVersion > 0
          ? `contractVersion=${meta.contractVersion}。`
          : "必须声明 contractVersion。",
    },
    {
      id: "meta.name",
      label: "meta.adapterName",
      status: hasMetaAdapterName(normalized) ? "pass" : "fail",
      detail: hasMetaAdapterName(normalized) ? "已声明 adapterName。" : "必须声明 adapterName。",
    },
    {
      id: "meta.capabilities",
      label: "meta.capabilities",
      status: hasMetaCapabilitiesValue ? "pass" : "fail",
      detail: hasMetaCapabilitiesValue ? "已声明 capabilities。" : "必须声明 capabilities。",
    },
    {
      id: "request.helper",
      label: "transformRequest 注入 helper",
      status:
        usesBuildInjectedTextHelper(normalized) || /\btransformRequest\b[\s\S]*?\breturn\s+null\b/.test(normalized)
          ? "pass"
          : "fail",
      detail: usesBuildInjectedTextHelper(normalized)
        ? "已使用 ctx.helpers.buildInjectedText(...)。"
        : "transformRequest 要么使用 ctx.helpers.buildInjectedText(...)，要么明确 return null。",
    },
    {
      id: "response.preview",
      label: "extractResponse 输出 preview",
      status: extractResponseReturnsPreview(normalized) ? "pass" : "fail",
      detail: extractResponseReturnsPreview(normalized)
        ? "已检测到 responseContentPreview。"
        : "extractResponse 必须返回 responseContentPreview。",
    },
    {
      id: "bubble.protocol",
      label: "decorateBubbles 协议渲染",
      status: hasBubbleHelper ? "pass" : "fail",
      detail: hasBubbleHelper
        ? "已复用统一协议气泡 helper。"
        : "decorateBubbles 必须使用 ctx.helpers.ui.decorateProtocolBubbles(...)。",
    },
    {
      id: "continuation.plan",
      label: "continueConversation DOM 方案",
      status:
        hasDomPlan &&
        !lint.warnings.some((warning) => warning.code === "continueConversation.sideEffects")
          ? "pass"
          : "fail",
      detail: hasDomPlan
        ? "已复用统一 DOM continuation plan helper。"
        : lint.warnings.some((warning) => warning.code === "continueConversation.sideEffects")
          ? "检测到 click/dispatchEvent/setTimeout，当前写法不合规。"
          : "continueConversation 必须使用 ctx.helpers.plans.dom(...)。",
    },
    {
      id: "continuation.text",
      label: "continueConversation 使用 continuationText",
      status: continueConversationUsesContinuationText(normalized) ? "pass" : "fail",
      detail: continueConversationUsesContinuationText(normalized)
        ? "已检测到 ctx.continuationText。"
        : "未检测到 ctx.continuationText，工具结果续发和注入兜底会失效。",
    },
    {
      id: "implementation.bubbles",
      label: "平台气泡渲染",
      status: hasBubbleHelper ? "pass" : "fail",
      detail: hasBubbleHelper
        ? "decorateBubbles 已走平台 helper。"
        : "必须改为 ctx.helpers.ui.decorateProtocolBubbles(...)。",
    },
    {
      id: "implementation.plan",
      label: "平台续发方案",
      status: hasDomPlan ? "pass" : "fail",
      detail: hasDomPlan
        ? "continueConversation 已走平台 helper。"
        : "必须改为 ctx.helpers.plans.dom(...)。",
    },
    {
      id: "implementation.protocolUi",
      label: "协议卡片实现方式",
      status: hasCustomUiHelpers ? "fail" : "pass",
      detail: hasCustomUiHelpers
        ? "发现自定义协议卡片实现，必须只保留平台 helper。"
        : "已使用平台统一的协议卡片实现。",
    },
    {
      id: "implementation.protocolTokens",
      label: "协议标记未硬编码",
      status: lint.warnings.some((warning) => warning.code === "protocol.hardcoded") ? "fail" : "pass",
      detail: lint.warnings.some((warning) => warning.code === "protocol.hardcoded")
        ? "检测到 CHAT_PLUS 标记被硬编码，必须统一读取 ctx.protocol。"
        : "未检测到协议标记硬编码。",
    },
  ];
}

export function hasHookDefinition(source: string, hookName: string) {
  const escapedName = escapeRegExp(hookName);
  const methodPattern = new RegExp(`(^|[\\s,{])${escapedName}\\s*\\(`);
  const propertyPattern = new RegExp(
    `(^|[\\s,{])${escapedName}\\s*:\\s*(async\\s+)?(function\\b|\\([^)]*\\)\\s*=>|[A-Za-z_$][\\w$]*\\s*=>)`,
  );
  return methodPattern.test(source) || propertyPattern.test(source);
}

export function lintSiteAdapterScript(source?: string): SiteAdapterLintResult {
  const normalized = String(source || "").replace(/\r\n?/g, "\n").trim();
  const warnings: SiteAdapterWarning[] = [];
  const hooks = Object.fromEntries(
    SITE_ADAPTER_REQUIRED_HOOKS.map((hookName) => [hookName, hasHookDefinition(normalized, hookName)]),
  ) as Record<(typeof SITE_ADAPTER_REQUIRED_HOOKS)[number], boolean>;
  const hasReturnObject = /\breturn\s*\{/.test(normalized);
  const hasMeta = new RegExp(`(^|[\\s,{])${SITE_ADAPTER_META_KEY}\\s*:`).test(normalized);

  if (normalized && !hasMeta) {
    warnings.push({
      code: "meta.missing",
      message: "必须声明 meta，包含 contractVersion、adapterName、capabilities。",
    });
  }

  if (hasMeta && !hasMetaAdapterName(normalized)) {
    warnings.push({
      code: "meta.adapterNameMissing",
      message: "meta 必须补充 adapterName。",
    });
  }

  if (hasMeta && !hasMetaCapabilities(normalized)) {
    warnings.push({
      code: "meta.capabilitiesMissing",
      message: "meta 必须补充 capabilities。",
    });
  }

  const hardcodedProtocolTokens = normalized.match(/\[CHAT_PLUS_[A-Z_]+\]/g) || [];
  if (hardcodedProtocolTokens.length > 0) {
    warnings.push({
      code: "protocol.hardcoded",
      message: "不要硬编码 CHAT_PLUS 协议标记，改为统一读取 ctx.protocol。",
    });
  }

  const continueBody = extractHookBody(normalized, "continueConversation");
  if (continueBody) {
    if (/\.(click|dispatchEvent)\s*\(/.test(continueBody) || /\bsetTimeout\s*\(/.test(continueBody)) {
      warnings.push({
        code: "continueConversation.sideEffects",
        message: "continueConversation 不应直接 click/dispatchEvent/setTimeout，而应返回 DOM 方案对象。",
      });
    }
    if (!/\bmode\s*:\s*["']dom["']/.test(continueBody) && !usesDomPlanHelper(normalized)) {
      warnings.push({
        code: "continueConversation.missingDomMode",
        message: "continueConversation 必须显式返回 { mode: \"dom\", ... }。",
      });
    }
    if (!continueConversationUsesContinuationText(normalized)) {
      warnings.push({
        code: "continueConversation.missingContinuationText",
        message: "continueConversation 应显式使用 ctx.continuationText，避免工具结果续发和注入兜底失效。",
      });
    }
  }

  const extractBody = extractHookBody(normalized, "extractResponse");
  if (extractBody && /\.slice\s*\(\s*0\s*,\s*\d+\s*\)/.test(extractBody)) {
    warnings.push({
      code: "extractResponse.truncatedPreview",
      message: "extractResponse 不应随意截断 responseContentPreview，否则尾部协议块可能丢失。",
    });
  }

  if (extractBody && /\bsplit\s*\(\s*["']\\n["']\s*\)/.test(extractBody) && !/event:|data:|SSE|EventSource/i.test(extractBody)) {
    warnings.push({
      code: "extractResponse.naiveStreaming",
      message: "发现按换行直接 split 的流式处理写法，应改用真实 SSE 事件重组 helper。",
    });
  }
  if (extractBody && !extractResponseReturnsPreview(normalized)) {
    warnings.push({
      code: "extractResponse.missingPreview",
      message: "extractResponse 应返回 responseContentPreview，否则插件拿不到完整回答文本。",
    });
  }

  const decorateBody = extractHookBody(normalized, "decorateBubbles");
  if (decorateBody && !/点击展开/.test(decorateBody) && !/decorateProtocolBubbles/.test(decorateBody)) {
    warnings.push({
      code: "decorateBubbles.protocolUi",
      message: "decorateBubbles 必须复用统一协议卡片 helper。",
    });
  }
  if (decorateBody && !usesProtocolBubbleHelper(normalized) && hasCustomProtocolUiHelpers(normalized)) {
    warnings.push({
      code: "decorateBubbles.customUiHelpers",
      message: "发现自定义协议卡片实现，必须改为平台统一 helper。",
    });
  }

  const transformBody = extractHookBody(normalized, "transformRequest");
  if (transformBody && !usesBuildInjectedTextHelper(normalized) && !/\breturn\s+null\b/.test(transformBody)) {
    warnings.push({
      code: "transformRequest.missingBuildHelper",
      message: "transformRequest 若要改写请求，必须统一使用 ctx.helpers.buildInjectedText(...)。",
    });
  }

  if (decorateBody && !usesProtocolBubbleHelper(normalized)) {
    warnings.push({
      code: "decorateBubbles.missingHelper",
      message: "decorateBubbles 必须使用 ctx.helpers.ui.decorateProtocolBubbles(...)。",
    });
  }

  if (continueBody && !usesDomPlanHelper(normalized)) {
    warnings.push({
      code: "continueConversation.missingHelper",
      message: "continueConversation 必须使用 ctx.helpers.plans.dom(...)。",
    });
  }

  if (hasMeta && !/contractVersion\s*:\s*\d+/.test(normalized)) {
    warnings.push({
      code: "meta.contractVersionMissing",
      message: "meta 已存在，但缺少 contractVersion。",
    });
  }

  return {
    warnings,
    hasMeta,
    hasReturnObject,
    hooks,
  };
}

export function summarizeAdapterMeta(source?: string) {
  const normalized = String(source || "").replace(/\r\n?/g, "\n");
  const nameMatch = normalized.match(/\badapterName\s*:\s*["'`](.+?)["'`]/);
  const versionMatch = normalized.match(/\bcontractVersion\s*:\s*(\d+)/);
  return {
    adapterName: toTrimmedText(nameMatch?.[1]),
    contractVersion: Number(versionMatch?.[1] || 0) || 0,
  };
}
