import { parser } from "@lezer/javascript";

import {
  buildSiteAdapterChecklist,
  continueConversationUsesContinuationText,
  extractResponseReturnsPreview,
  hasCustomProtocolUiHelpers,
  hasMetaAdapterName,
  hasMetaCapabilities,
  lintSiteAdapterScript,
  readHookBody,
  summarizeAdapterMeta,
  type SiteAdapterWarning,
  usesBuildInjectedTextHelper,
  usesDomPlanHelper,
  usesProtocolBubbleHelper,
  type SiteAdapterChecklistItem,
} from "../../site-adapter-runtime/contract";
import { normalizeSiteAdapterScript } from "./siteAdapterShared";

export type SiteAdapterCheckResult = {
  ok: boolean;
  error: string;
  warnings: SiteAdapterWarning[];
  checklist: SiteAdapterChecklistItem[];
  meta: {
    adapterName: string;
    contractVersion: number;
  };
};

export type SiteAdapterAnalysis = SiteAdapterCheckResult & {
  summary: {
    errorCount: number;
    warningCount: number;
    passCount: number;
  };
  implementation: {
    usesProtocolBubbleHelper: boolean;
    usesDomPlanHelper: boolean;
    usesBuildInjectedTextHelper: boolean;
    returnsResponsePreview: boolean;
    usesContinuationText: boolean;
  };
};

const VALIDATION_CACHE_LIMIT = 200;
const validationCache = new Map<string, SiteAdapterCheckResult>();
const analysisCache = new Map<string, SiteAdapterAnalysis>();

function trimCache(map: Map<string, unknown>) {
  if (map.size <= VALIDATION_CACHE_LIMIT) return;
  const oldestKey = map.keys().next().value;
  if (oldestKey) map.delete(oldestKey);
}

export function validateSiteAdapterScript(script?: string): SiteAdapterCheckResult {
  const normalized = normalizeSiteAdapterScript(script);
  if (!normalized) {
    return {
      ok: false,
      error: "脚本为空",
      warnings: [],
      checklist: buildSiteAdapterChecklist(""),
      meta: { adapterName: "", contractVersion: 0 },
    };
  }

  const cached = validationCache.get(normalized);
  if (cached) return cached;

  const syntaxError = findFirstSyntaxError(normalized);
  if (syntaxError) {
    const { line, column } = offsetToLineColumn(normalized, syntaxError.from);
    const result = {
      ok: false,
      error: `语法错误，位置 ${line}:${column}`,
      warnings: [],
      checklist: buildSiteAdapterChecklist(normalized),
      meta: { adapterName: "", contractVersion: 0 },
    };
    validationCache.set(normalized, result);
    trimCache(validationCache);
    return result;
  }

  const lint = lintSiteAdapterScript(normalized);
  const checklist = buildSiteAdapterChecklist(normalized);
  const transformBody = readHookBody(normalized, "transformRequest");
  const hardFailures: string[] = [];

  if (!/\breturn\s*\{/.test(normalized)) {
    hardFailures.push("脚本最外层必须 return 一个对象。");
  }

  const missingHookNames = Object.entries(lint.hooks)
    .filter(([, exists]) => !exists)
    .map(([name]) => name);
  if (missingHookNames.length) {
    hardFailures.push(`缺少必填 hook：${missingHookNames.join(" / ")}。`);
  }

  if (!lint.hasMeta) {
    hardFailures.push("必须声明 meta。");
  }

  const meta = summarizeAdapterMeta(normalized);
  if (!meta.contractVersion) {
    hardFailures.push("meta 必须包含 contractVersion。");
  }
  if (!hasMetaAdapterName(normalized)) {
    hardFailures.push("meta 必须包含 adapterName。");
  }
  if (!hasMetaCapabilities(normalized)) {
    hardFailures.push("meta 必须包含 capabilities。");
  }
  if (!extractResponseReturnsPreview(normalized)) {
    hardFailures.push("extractResponse 必须返回 responseContentPreview。");
  }
  if (!usesProtocolBubbleHelper(normalized)) {
    hardFailures.push("decorateBubbles 必须使用 ctx.helpers.ui.decorateProtocolBubbles(...)。");
  }
  if (hasCustomProtocolUiHelpers(normalized)) {
    hardFailures.push("发现自定义协议卡片实现，必须只保留平台 helper。");
  }
  if (!usesDomPlanHelper(normalized)) {
    hardFailures.push("continueConversation 必须使用 ctx.helpers.plans.dom(...)。");
  }
  if (!continueConversationUsesContinuationText(normalized)) {
    hardFailures.push("continueConversation 必须使用 ctx.continuationText。");
  }
  if (
    lint.warnings.some((warning) =>
      [
        "protocol.hardcoded",
        "continueConversation.sideEffects",
        "continueConversation.missingDomMode",
        "extractResponse.truncatedPreview",
        "extractResponse.missingPreview",
        "extractResponse.naiveStreaming",
      ].includes(warning.code),
    )
  ) {
    hardFailures.push(
      lint.warnings
        .filter((warning) =>
          [
            "protocol.hardcoded",
            "continueConversation.sideEffects",
            "continueConversation.missingDomMode",
            "extractResponse.truncatedPreview",
            "extractResponse.missingPreview",
            "extractResponse.naiveStreaming",
          ].includes(warning.code),
        )
        .map((warning) => warning.message)
        .join("\n"),
    );
  }
  if (transformBody && !usesBuildInjectedTextHelper(normalized) && !/\breturn\s+null\b/.test(transformBody)) {
    hardFailures.push(
      "transformRequest 要么使用 ctx.helpers.buildInjectedText(...) 改写请求，要么明确 return null。",
    );
  }

  const checklistFailures = checklist
    .filter((item) => item.status === "fail")
    .map((item) => `${item.label}：${item.detail}`);
  checklistFailures.forEach((message) => {
    if (!hardFailures.includes(message)) {
      hardFailures.push(message);
    }
  });

  if (hardFailures.length) {
    const result = {
      ok: false,
      error: hardFailures.join("\n"),
      warnings: lint.warnings,
      checklist,
      meta,
    };
    validationCache.set(normalized, result);
    trimCache(validationCache);
    return result;
  }

  const result = {
    ok: true,
    error: "",
    warnings: lint.warnings,
    checklist,
    meta,
  };
  validationCache.set(normalized, result);
  trimCache(validationCache);
  return result;
}

export function analyzeSiteAdapterScript(script?: string): SiteAdapterAnalysis {
  const normalized = normalizeSiteAdapterScript(script);
  const cached = analysisCache.get(normalized);
  if (cached) return cached;

  const validation = validateSiteAdapterScript(normalized);
  const errorCount = validation.ok ? 0 : 1;
  const warningCount = validation.warnings.length;
  const passCount = validation.checklist.filter((item) => item.status === "pass").length;

  const result = {
    ...validation,
    summary: {
      errorCount,
      warningCount,
      passCount,
    },
    implementation: {
      usesProtocolBubbleHelper: usesProtocolBubbleHelper(normalized),
      usesDomPlanHelper: usesDomPlanHelper(normalized),
      usesBuildInjectedTextHelper: usesBuildInjectedTextHelper(normalized),
      returnsResponsePreview: extractResponseReturnsPreview(normalized),
      usesContinuationText: continueConversationUsesContinuationText(normalized),
    },
  };
  analysisCache.set(normalized, result);
  trimCache(analysisCache);
  return result;
}

function findFirstSyntaxError(source: string) {
  const tree = parser.parse(source);
  const cursor = tree.cursor();

  do {
    if (cursor.type.isError || cursor.name === "⚠") {
      return { from: cursor.from, to: cursor.to };
    }
  } while (cursor.next());

  return null;
}

function offsetToLineColumn(source: string, offset: number) {
  const safeOffset = Math.max(0, Math.min(offset, source.length));
  let line = 1;
  let column = 1;

  for (let index = 0; index < safeOffset; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      column = 1;
      continue;
    }
    column += 1;
  }

  return { line, column };
}

export function getSiteAdapterStatus(script?: string) {
  const normalized = normalizeSiteAdapterScript(script);
  if (!normalized) {
    return {
      kind: "empty" as const,
      ok: false,
      error: "",
      warnings: [],
    };
  }

  const validation = validateSiteAdapterScript(normalized);
  return validation.ok
    ? {
        kind: "valid" as const,
        ok: true,
        error: "",
        warnings: validation.warnings,
      }
    : {
        kind: "invalid" as const,
        ok: false,
        error: validation.error,
        warnings: validation.warnings,
      };
}
