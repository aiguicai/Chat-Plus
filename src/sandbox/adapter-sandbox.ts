import { javascriptLanguage } from "@codemirror/lang-javascript";

import { wrapChatPlusInjection } from "../shared/chatplus-protocol";
import {
  buildDomContinuationPlan,
  decorateProtocolBubbles,
  isPureToolResultMessage,
  normalizeSelectorArray,
  readNodeText,
  renderProtocolCard,
  validateDomContinuationPlan,
} from "../site-adapter-runtime/dom";
import {
  SITE_ADAPTER_META_KEY,
  SITE_ADAPTER_REQUIRED_HOOKS,
  containsProtocolBlock,
  createHookFailure,
  escapeRegExp,
  hasCompleteWrappedBlock,
  hasIncompleteProtocolBlock,
  inferToolResultTone,
  parseJsonSafely,
  readPatchOperations,
  readProtocolBlocks,
  readSseEvents,
  readWrappedBlock,
  stripProtocolArtifacts,
  stripWrappedBlock,
  toTrimmedText,
} from "../site-adapter-runtime/shared";

(() => {
  "use strict";

  const CHANNEL_NAME = "chat-plus-adapter-sandbox";
  const SNAPSHOT_NODE_ATTR = "data-chat-plus-sandbox-node-id";
  const CODE_MODE_BLOCK_BEGIN = "[CHAT_PLUS_CODE_MODE_BEGIN]";
  const CODE_MODE_BLOCK_END = "[CHAT_PLUS_CODE_MODE_END]";
  const CODE_MODE_DEBUG_PREVIEW_LIMIT = 200;

  const state = {
    cachedScript: "",
    cachedFactory: null as null | ((helpers: Record<string, unknown>, env: Record<string, unknown>) => any),
    cachedCompileError: "",
    toolCallSequence: 0,
    cancelledRunIds: new Set<number>(),
    pendingToolCalls: new Map<
      number,
      {
        runId: number;
        resolve: (value: unknown) => void;
        reject: (error: Error) => void;
      }
    >(),
  };

  type NormalizedCodeModeDoc = {
    ref: string;
    kind: "skill" | "tool";
    serverId: string;
    serverName: string;
    serverAlias: string;
    toolName: string;
    toolAlias: string;
    title?: string;
    description: string;
    summary: string;
    inputSchema: Record<string, unknown>;
    inputSchemaText: string;
    outputSchema?: Record<string, unknown>;
    outputSchemaText: string;
    annotations?: Record<string, unknown>;
    callTemplate: string;
    usageNotes: string[];
  };

  function createAdapterHelpers(context?: { injectedUserFallbackText?: unknown }) {
    return {
      buildInjectedText(injectionText, originalText, injectionMode = "system") {
        const prefix = String(injectionText || "").replace(/\r\n?/g, "\n").trim();
        const original = String(originalText ?? "").replace(/\r\n?/g, "\n");
        if (!prefix) return original;
        if (String(injectionMode || "").toLowerCase() === "raw") {
          if (original === prefix || original.startsWith(`${prefix}\n\n`)) {
            return original;
          }
          return original ? `${prefix}\n\n${original}` : prefix;
        }

        const wrapped = wrapChatPlusInjection(prefix);
        if (original === wrapped || original.startsWith(`${wrapped}\n\n`)) {
          return original;
        }
        return original ? `${wrapped}\n\n${original}` : wrapped;
      },
      parseJson(value) {
        return parseJsonSafely(value);
      },
      text: Object.freeze({
        toText: toTrimmedText,
      }),
      json: Object.freeze({
        parse: parseJsonSafely,
      }),
      stream: Object.freeze({
        readSseEvents,
        readPatchOperations,
      }),
      protocol: Object.freeze({
        escapeRegExp,
        readWrappedBlock,
        stripWrappedBlock,
        containsProtocolBlock,
        hasCompleteWrappedBlock,
        hasIncompleteProtocolBlock,
        stripProtocolArtifacts,
        readBlocks: readProtocolBlocks,
        inferToolResultTone,
        isPureToolResultMessage,
      }),
      dom: Object.freeze({
        readNodeText,
        renderProtocolCard,
      }),
      ui: Object.freeze({
        decorateProtocolBubbles(options) {
          const normalizedOptions =
            options && typeof options === "object" && !Array.isArray(options)
              ? { ...(options as Record<string, unknown>) }
              : {};
          if (
            normalizedOptions.injectedUserFallbackText == null &&
            context?.injectedUserFallbackText != null
          ) {
            normalizedOptions.injectedUserFallbackText = context.injectedUserFallbackText;
          }
          return decorateProtocolBubbles(normalizedOptions as any);
        },
      }),
      plans: Object.freeze({
        dom: buildDomContinuationPlan,
        validateDom: validateDomContinuationPlan,
        normalizeSelectors: normalizeSelectorArray,
      }),
      contract: Object.freeze({
        requiredHooks: SITE_ADAPTER_REQUIRED_HOOKS,
        metaKey: SITE_ADAPTER_META_KEY,
      }),
      results: Object.freeze({
        skip: createHookFailure,
      }),
    };
  }

  function normalizeScript(scriptText: unknown) {
    return String(scriptText || "").trim();
  }

  function cloneStructuredValue<T>(value: T): T | null {
    if (value == null) return null;
    try {
      return JSON.parse(JSON.stringify(value)) as T;
    } catch {
      return null;
    }
  }

  function serializeError(error: unknown) {
    if (error instanceof Error) {
      return error.stack || error.message || String(error);
    }
    return String(error || "unknown error");
  }

  function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function normalizeRunId(value: unknown) {
    const numeric = Number(value || 0);
    return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
  }

  function isCancelledRun(runId: unknown) {
    const normalizedRunId = normalizeRunId(runId);
    return Boolean(normalizedRunId) && state.cancelledRunIds.has(normalizedRunId);
  }

  function cancelRun(runId: unknown) {
    const normalizedRunId = normalizeRunId(runId);
    if (!normalizedRunId) return;

    state.cancelledRunIds.add(normalizedRunId);
    state.pendingToolCalls.forEach((pending, callId) => {
      if (pending.runId !== normalizedRunId) return;
      state.pendingToolCalls.delete(callId);
      pending.reject(new Error("用户已停止执行"));
    });
  }

  function serializeCodeModeResult(value: unknown) {
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value ?? "");
    }
  }

  function serializeConsoleArg(value: unknown) {
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value ?? "");
    }
  }

  function shouldOmitConsoleEntry(entryText: unknown, normalizedResult: string) {
    const entry = String(entryText || "").trim();
    const result = String(normalizedResult || "").trim();
    if (!entry || !result) return false;
    if (entry === result) return true;
    if (!entry.endsWith(result)) return false;

    const prefix = entry.slice(0, entry.length - result.length).trim();
    if (!prefix || prefix.length > 80) return false;
    return /^[\p{L}\p{N}\p{Script=Han}\s:_\-\[\](){}.,/\\]+$/u.test(prefix);
  }

  function formatCodeModeFeedback({
    ok,
    stage,
    result,
    error,
    consoleEntries,
    debugCodePreview,
    diagnosticNotes,
  }: {
    ok: boolean;
    stage: "compile" | "runtime";
    result?: unknown;
    error?: unknown;
    consoleEntries?: Array<{ level: string; text: string }>;
    debugCodePreview?: string;
    diagnosticNotes?: string[];
  }) {
    const lines = [
      `Chat Plus Code Mode ${ok ? "执行成功" : "执行失败"}`,
      `阶段: ${stage}`,
    ];

    if (error) {
      lines.push(`错误: ${String(error)}`);
    }

    const normalizedResult = serializeCodeModeResult(result);
    if (normalizedResult) {
      lines.push("返回结果:");
      lines.push(normalizedResult);
    }

    if (Array.isArray(consoleEntries) && consoleEntries.length) {
      const filteredConsoleEntries = consoleEntries.filter(
        (entry) => !shouldOmitConsoleEntry(entry?.text, normalizedResult),
      );
      if (filteredConsoleEntries.length) {
        lines.push("控制台输出:");
        filteredConsoleEntries.forEach((entry) => {
          lines.push(`[${entry.level}] ${entry.text}`);
        });
      }
    }

    if (debugCodePreview && !ok) {
      lines.push("代码预览:");
      lines.push(debugCodePreview);
    }

    const normalizedDiagnosticNotes = Array.isArray(diagnosticNotes)
      ? diagnosticNotes.map((entry) => String(entry || "").trim()).filter(Boolean)
      : [];
    if (normalizedDiagnosticNotes.length) {
      lines.push("诊断提示:");
      normalizedDiagnosticNotes.forEach((entry) => {
        lines.push(`- ${entry}`);
      });
    }

    return lines.join("\n").trim();
  }

  function createRestrictedConsole() {
    const entries: Array<{ level: string; text: string }> = [];
    const pushEntry = (level: string, args: unknown[]) => {
      const text = args.map((item) => serializeConsoleArg(item)).join(" ");
      entries.push({
        level,
        text: text || "(empty)",
      });
    };

    return {
      entries,
      api: Object.freeze({
        log: (...args: unknown[]) => {
          pushEntry("log", args);
        },
        warn: (...args: unknown[]) => {
          pushEntry("warn", args);
        },
        error: (...args: unknown[]) => {
          pushEntry("error", args);
        },
      }),
    };
  }

  function normalizeCodeModeSource(code: unknown) {
    let normalized = String(code || "")
      .replace(/\r\n?/g, "\n")
      .replace(/[\u2028\u2029]/g, "\n")
      .replace(/^\uFEFF/, "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069]/g, "")
      .replace(/\u00A0/g, " ")
      .trim();

    if (!normalized) return "";

    if (normalized.includes(CODE_MODE_BLOCK_BEGIN) && normalized.includes(CODE_MODE_BLOCK_END)) {
      const startIndex = normalized.indexOf(CODE_MODE_BLOCK_BEGIN);
      const endIndex = normalized.indexOf(CODE_MODE_BLOCK_END, startIndex + CODE_MODE_BLOCK_BEGIN.length);
      if (startIndex >= 0 && endIndex > startIndex) {
        normalized = normalized
          .slice(startIndex + CODE_MODE_BLOCK_BEGIN.length, endIndex)
          .trim();
      }
    }

    const fencedMatch = normalized.match(/^```(?:javascript|js)?\s*([\s\S]*?)\s*```$/i);
    if (fencedMatch?.[1]) {
      normalized = fencedMatch[1].trim();
    }

    normalized = normalized
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'");

    return normalized.trim();
  }

  function createDebugCodePreview(code: string, maxChars = CODE_MODE_DEBUG_PREVIEW_LIMIT) {
    const normalized = String(code || "");
    if (!normalized) return "";

    const truncated = normalized.length > maxChars;
    const preview = truncated ? normalized.slice(0, maxChars) : normalized;
    const serializedPreview = JSON.stringify(preview) || preview;
    if (!truncated) return serializedPreview;

    return `${serializedPreview} …（已截断，原始长度 ${normalized.length} 字符）`;
  }

  function findUnsupportedCodeModeSyntax(code: string) {
    const unsupportedNodes = new Map<string, string>([
      ["ImportDeclaration", "import"],
      ["ExportDeclaration", "export"],
      ["WhileStatement", "while"],
      ["DoStatement", "do...while"],
    ]);

    try {
      const tree = javascriptLanguage.parser.parse(code);
      const cursor = tree.cursor();

      const scan = (): string => {
        do {
          const matchedSyntax = unsupportedNodes.get(cursor.name);
          if (matchedSyntax) return matchedSyntax;

          if (cursor.firstChild()) {
            const nestedMatch = scan();
            cursor.parent();
            if (nestedMatch) return nestedMatch;
          }
        } while (cursor.nextSibling());

        return "";
      };

      return scan();
    } catch {
      return "";
    }
  }

  function buildCancelledCodeModeResponse() {
    const error = "用户已停止执行";
    return {
      ok: false,
      cancelled: true,
      stage: "runtime",
      error,
      resultText: formatCodeModeFeedback({
        ok: false,
        stage: "runtime",
        error,
      }),
    };
  }

  function isUndefinedResult(value: unknown) {
    return typeof value === "undefined";
  }

  function isTopLevelAsyncIife(code: string) {
    const normalized = String(code || "").trim();
    if (!normalized) return false;

    const patterns = [
      /^\(\s*async\s*\([^)]*\)\s*=>\s*\{[\s\S]*\}\s*\)\s*\(\s*\)\s*;?$/u,
      /^\(\s*async\s+function(?:\s+[A-Za-z_$][\w$]*)?\s*\([^)]*\)\s*\{[\s\S]*\}\s*\)\s*\(\s*\)\s*;?$/u,
    ];
    return patterns.some((pattern) => pattern.test(normalized));
  }

  function buildCodeModeDiagnosticNotes({
    code,
    result,
  }: {
    code: string;
    result: unknown;
  }) {
    if (!isUndefinedResult(result) || !isTopLevelAsyncIife(code)) {
      return [] as string[];
    }

    return [
      "检测到整段代码最外层又包了一层顶层 async IIFE，如 `(async () => { ... })()`。",
      "Code Mode 运行器本身已经自带顶层 async；这种套壳常见现象是内部代码实际执行了，但主返回值变成 `undefined`，最终表现为“执行成功但返回为空”。",
      "下次请直接在顶层写 `const` / `await` / `return`，不要再额外套一层顶层 async IIFE；如果需要辅助异步逻辑，定义普通函数后再 `await` 它。",
    ];
  }

  function getCompiledFactory(scriptText: unknown) {
    const normalized = normalizeScript(scriptText);
    if (!normalized) {
      state.cachedScript = "";
      state.cachedFactory = null;
      state.cachedCompileError = "";
      return { factory: null, error: "" };
    }

    if (normalized === state.cachedScript) {
      return {
        factory: state.cachedFactory,
        error: state.cachedCompileError,
      };
    }

    try {
      const factory = new Function(
        "helpers",
        "env",
        `"use strict";
const window = env.window;
const self = env.self;
const globalThis = env.globalThis;
const document = env.document;
const HTMLElement = env.HTMLElement;
const Element = env.Element;
const Node = env.Node;
const Text = env.Text;
const Comment = env.Comment;
const DocumentFragment = env.DocumentFragment;
const DOMParser = env.DOMParser;
const URL = env.URL;
const console = env.console;
const setTimeout = env.setTimeout;
const clearTimeout = env.clearTimeout;
${normalized}`,
      ) as (helpers: Record<string, unknown>, env: Record<string, unknown>) => any;

      state.cachedScript = normalized;
      state.cachedFactory = factory;
      state.cachedCompileError = "";
      return { factory, error: "" };
    } catch (error) {
      const message = serializeError(error);
      state.cachedScript = normalized;
      state.cachedFactory = null;
      state.cachedCompileError = message;
      return { factory: null, error: message };
    }
  }

  function createExecutionEnv(doc: Document) {
    const sandboxWindow = {
      document: doc,
      console,
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
      HTMLElement: window.HTMLElement,
      Element: window.Element,
      Node: window.Node,
      Text: window.Text,
      Comment: window.Comment,
      DocumentFragment: window.DocumentFragment,
      DOMParser: window.DOMParser,
      URL: window.URL,
      JSON: window.JSON,
      Array: window.Array,
      Object: window.Object,
    };

    return {
      window: sandboxWindow,
      self: sandboxWindow,
      globalThis: sandboxWindow,
      document: doc,
      HTMLElement: window.HTMLElement,
      Element: window.Element,
      Node: window.Node,
      Text: window.Text,
      Comment: window.Comment,
      DocumentFragment: window.DocumentFragment,
      DOMParser: window.DOMParser,
      URL: window.URL,
      console,
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
    };
  }

  function postParentMessage(payload: Record<string, unknown>) {
    window.parent?.postMessage(
      {
        channel: CHANNEL_NAME,
        ...payload,
      },
      "*",
    );
  }

  function requestToolCall({
    serverAlias,
    toolAlias,
    args,
    runId,
  }: {
    serverAlias: string;
    toolAlias: string;
    args: Record<string, unknown>;
    runId: number;
  }) {
    const normalizedRunId = normalizeRunId(runId);
    if (isCancelledRun(normalizedRunId)) {
      return Promise.reject(new Error("用户已停止执行"));
    }

    const callId = ++state.toolCallSequence;
    return new Promise((resolve, reject) => {
      state.pendingToolCalls.set(callId, {
        runId: normalizedRunId,
        resolve,
        reject: (error) => reject(error),
      });

      postParentMessage({
        type: "tool-call",
        callId,
        runId: normalizedRunId,
        serverAlias,
        toolAlias,
        arguments: cloneStructuredValue(args) || {},
      });
    });
  }

  function detectFallbackToolKind(source: Record<string, unknown>) {
    const haystack = [
      source.name,
      source.title,
      source.description,
      source.annotations ? JSON.stringify(source.annotations) : "",
    ]
      .map((item) => String(item || "").toLowerCase())
      .join("\n");
    return /\bskill\b|skill\.md|\bworkflow\b|工作流|读取[^。\n]{0,32}\.md|read[^.\n]{0,32}\.md/u.test(
      haystack,
    )
      ? "skill"
      : "tool";
  }

  function buildFallbackCodeModeDocs(manifest: unknown): NormalizedCodeModeDoc[] {
    const manifestRecord = isPlainObject(manifest) ? manifest : {};
    const servers = Array.isArray(manifestRecord.servers) ? manifestRecord.servers : [];
    const docs: NormalizedCodeModeDoc[] = [];

    servers.forEach((server) => {
      const serverAlias = String(server?.alias || "").trim();
      const serverId = String(server?.id || "").trim();
      const serverName = String(server?.name || "").trim();
      if (!serverAlias) return;

      const tools = Array.isArray(server?.tools) ? server.tools : [];
      tools.forEach((tool) => {
        const toolAlias = String(tool?.alias || "").trim();
        const toolName = String(tool?.name || "").trim();
        const title = String(tool?.title || "").trim();
        const description = String(tool?.description || "").replace(/\s+/g, " ").trim();
        if (!toolAlias) return;

        const ref = `tools.${serverAlias}.${toolAlias}`;
        const inputSchema = isPlainObject(tool?.inputSchema) ? tool.inputSchema : {};
        const outputSchema = isPlainObject(tool?.outputSchema) ? tool.outputSchema : undefined;
        const annotations = isPlainObject(tool?.annotations) ? tool.annotations : undefined;
        const kind = detectFallbackToolKind(
          isPlainObject(tool) ? tool : { name: toolName, title, description },
        );

        docs.push({
          ref,
          kind,
          serverId,
          serverName,
          serverAlias,
          toolName,
          toolAlias,
          title: title || undefined,
          description,
          summary: description || title || toolName || ref,
          inputSchema,
          inputSchemaText: "- input: any",
          outputSchema,
          outputSchemaText: outputSchema ? "- output: object" : "- output: any",
          annotations,
          callTemplate: `const result = await ${ref}({});\nreturn result;`,
          usageNotes: [
            "这是运行时回退文档。请优先依赖 toolDocs.describe(ref) 返回的 schema 和 description。",
          ],
        });
      });
    });

    return docs;
  }

  function normalizeManifestCodeModeDocs(manifest: unknown): NormalizedCodeModeDoc[] {
    const manifestRecord = isPlainObject(manifest) ? manifest : {};
    const manifestDocs = Array.isArray(manifestRecord.docs) ? manifestRecord.docs : [];
    const normalizedDocs: NormalizedCodeModeDoc[] = [];

    manifestDocs.forEach((item) => {
      const doc = isPlainObject(item) ? item : {};
      const ref = String(doc.ref || "").trim();
      const serverAlias = String(doc.serverAlias || "").trim();
      const toolAlias = String(doc.toolAlias || "").trim();
      if (!ref || !serverAlias || !toolAlias) return;

      const inputSchema = isPlainObject(doc.inputSchema) ? doc.inputSchema : {};
      const outputSchema = isPlainObject(doc.outputSchema) ? doc.outputSchema : undefined;
      const annotations = isPlainObject(doc.annotations) ? doc.annotations : undefined;
      const usageNotes = Array.isArray(doc.usageNotes)
        ? doc.usageNotes.map((entry) => String(entry || "").trim()).filter(Boolean)
        : [];

      normalizedDocs.push({
        ref,
        kind: String(doc.kind || "").trim() === "skill" ? "skill" : "tool",
        serverId: String(doc.serverId || "").trim(),
        serverName: String(doc.serverName || "").trim(),
        serverAlias,
        toolName: String(doc.toolName || "").trim(),
        toolAlias,
        title: String(doc.title || "").trim() || undefined,
        description: String(doc.description || "").replace(/\s+/g, " ").trim(),
        summary: String(doc.summary || "").replace(/\s+/g, " ").trim() || ref,
        inputSchema,
        inputSchemaText: String(doc.inputSchemaText || "").trim() || "- input: any",
        outputSchema,
        outputSchemaText: String(doc.outputSchemaText || "").trim() || "- output: any",
        annotations,
        callTemplate:
          String(doc.callTemplate || "").trim() || `const result = await ${ref}({});\nreturn result;`,
        usageNotes,
      });
    });

    return normalizedDocs.length > 0 ? normalizedDocs : buildFallbackCodeModeDocs(manifest);
  }

  function createCodeModeRuntime(manifest: unknown, runId: number) {
    const tools = Object.create(null) as Record<
      string,
      Record<string, (args?: Record<string, unknown>) => Promise<unknown>>
    >;
    const manifestRecord = isPlainObject(manifest) ? manifest : {};
    const servers = Array.isArray(manifestRecord.servers)
      ? (manifestRecord.servers as Array<Record<string, unknown>>)
      : [];
    const docs = normalizeManifestCodeModeDocs(manifest);
    const docsByRef = new Map<string, NormalizedCodeModeDoc>(
      docs.map((doc) => [doc.ref, doc] as const),
    );
    servers.forEach((server) => {
      const serverAlias = String(server?.alias || "").trim();
      if (!serverAlias) return;
      tools[serverAlias] = Object.create(null);

      const serverTools = Array.isArray(server?.tools) ? server.tools : [];
      serverTools.forEach((tool) => {
        const toolAlias = String(tool?.alias || "").trim();
        if (!toolAlias) return;

        tools[serverAlias][toolAlias] = async (args: Record<string, unknown> = {}) =>
          requestToolCall({
            serverAlias,
            toolAlias,
            runId,
            args:
              args && typeof args === "object" && !Array.isArray(args)
                ? args
                : {},
          });
      });

      Object.freeze(tools[serverAlias]);
    });

    const toolDocs = Object.freeze({
      describe: async (ref: unknown) => {
        const normalizedRef = String(ref || "").trim();
        const doc = docsByRef.get(normalizedRef);
        if (!doc) {
          throw new Error(`toolDocs.describe 找不到工具说明书: ${normalizedRef || "(empty)"}`);
        }
        return cloneStructuredValue(doc) || doc;
      },
    });

    return {
      tools: Object.freeze(tools),
      toolDocs,
    };
  }

  async function executeCodeModeRequest({
    code,
    manifest,
    runId,
  }: {
    code: unknown;
    manifest: unknown;
    runId: unknown;
  }) {
    const normalizedRunId = normalizeRunId(runId);
    if (isCancelledRun(normalizedRunId)) {
      return buildCancelledCodeModeResponse();
    }

    const normalizedCode = normalizeCodeModeSource(code);
    if (!normalizedCode) {
      return { ok: false, error: "缺少代码" };
    }

    const unsupportedSyntax = findUnsupportedCodeModeSyntax(normalizedCode);
    if (unsupportedSyntax) {
      return { ok: false, error: `代码模式不支持 ${unsupportedSyntax}` };
    }

    const { tools, toolDocs } = createCodeModeRuntime(manifest, normalizedRunId);
    if (!Object.keys(tools).length) {
      return { ok: false, error: "当前页面没有可用的 MCP 工具" };
    }

    const restrictedConsole = createRestrictedConsole();
    const debugCodePreview = createDebugCodePreview(normalizedCode);
    let runner:
      | ((
          tools: unknown,
          toolDocsValue: unknown,
          consoleApi: unknown,
          JSONValue: JSON,
          ObjectValue: ObjectConstructor,
          ArrayValue: ArrayConstructor,
          MathValue: Math,
          PromiseValue: PromiseConstructor,
          StringValue: StringConstructor,
          NumberValue: NumberConstructor,
          BooleanValue: BooleanConstructor,
          DateValue: DateConstructor,
          RegExpValue: RegExpConstructor,
          URLValue: typeof URL,
        ) => Promise<unknown>)
      | null = null;

    try {
      runner = new Function(
        "tools", "toolDocs", "console", "JSON", "Object", "Array", "Math", "Promise",
        "String", "Number", "Boolean", "Date", "RegExp", "URL",
        `"use strict";\nreturn (async () => {\n${normalizedCode}\n})();`,
      ) as typeof runner;
    } catch (error) {
      return {
        ok: false,
        stage: "compile",
        error: String((error as any)?.message || error || "代码编译失败"),
        debugCodePreview,
        resultText: formatCodeModeFeedback({
          ok: false,
          stage: "compile",
          error: String((error as any)?.message || error || "代码编译失败"),
          consoleEntries: restrictedConsole.entries,
          debugCodePreview,
        }),
      };
    }

    try {
      if (isCancelledRun(normalizedRunId)) {
        return buildCancelledCodeModeResponse();
      }

      const result = await runner(
        tools,
        toolDocs,
        restrictedConsole.api,
        JSON,
        Object,
        Array,
        Math,
        Promise,
        String,
        Number,
        Boolean,
        Date,
        RegExp,
        URL,
      );

      if (isCancelledRun(normalizedRunId)) {
        return buildCancelledCodeModeResponse();
      }

      const diagnosticNotes = buildCodeModeDiagnosticNotes({
        code: normalizedCode,
        result,
      });

      return {
        ok: true,
        result: cloneStructuredValue(result),
        resultText: formatCodeModeFeedback({
          ok: true,
          stage: "runtime",
          result,
          consoleEntries: restrictedConsole.entries,
          diagnosticNotes,
        }),
      };
    } catch (error) {
      return {
        ok: false,
        cancelled: isCancelledRun(normalizedRunId),
        stage: "runtime",
        error: String((error as any)?.message || error || "代码执行失败"),
        debugCodePreview,
        resultText: formatCodeModeFeedback({
          ok: false,
          stage: "runtime",
          error: String((error as any)?.message || error || "代码执行失败"),
          consoleEntries: restrictedConsole.entries,
          debugCodePreview,
        }),
      };
    }
  }

  function parseSnapshotDocument(snapshotHtml: unknown) {
    const html =
      String(snapshotHtml || "").trim() || "<!DOCTYPE html><html><head></head><body></body></html>";
    return new DOMParser().parseFromString(html, "text/html");
  }

  function getSnapshotNodeId(node: Node | null | undefined) {
    if (!(node instanceof Element)) return "";
    return String(node.getAttribute(SNAPSHOT_NODE_ATTR) || "").trim();
  }

  function collectAttributes(element: Element) {
    const result: Record<string, string> = {};
    Array.from(element.attributes).forEach((attribute) => {
      if (!attribute?.name || attribute.name === SNAPSHOT_NODE_ATTR) return;
      result[attribute.name] = attribute.value;
    });
    return result;
  }

  function sameAttributes(left: Record<string, string>, right: Record<string, string>) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => right[key] === left[key]);
  }

  function stripSnapshotNodeIds(html: unknown) {
    return String(html || "").replace(
      new RegExp(`\\s${SNAPSHOT_NODE_ATTR}="[^"]*"`, "g"),
      "",
    );
  }

  function needsInnerHtmlPatch(beforeElement: Element, afterElement: Element) {
    const beforeNodes = Array.from(beforeElement.childNodes);
    const afterNodes = Array.from(afterElement.childNodes);
    if (beforeNodes.length !== afterNodes.length) return true;

    for (let index = 0; index < beforeNodes.length; index += 1) {
      const beforeNode = beforeNodes[index];
      const afterNode = afterNodes[index];

      if (beforeNode.nodeType !== afterNode.nodeType) return true;

      if (
        beforeNode.nodeType === Node.TEXT_NODE ||
        beforeNode.nodeType === Node.CDATA_SECTION_NODE ||
        beforeNode.nodeType === Node.COMMENT_NODE
      ) {
        if (String(beforeNode.textContent || "") !== String(afterNode.textContent || "")) {
          return true;
        }
        continue;
      }

      if (!(beforeNode instanceof Element) || !(afterNode instanceof Element)) {
        return true;
      }

      if (beforeNode.tagName !== afterNode.tagName) return true;
      if (getSnapshotNodeId(beforeNode) !== getSnapshotNodeId(afterNode)) return true;
    }

    return false;
  }

  function diffDecoratedElement(
    beforeElement: Element,
    afterElement: Element,
    patches: Array<Record<string, unknown>>,
  ) {
    if (beforeElement.isEqualNode(afterElement)) {
      return;
    }

    const nodeId = getSnapshotNodeId(afterElement) || getSnapshotNodeId(beforeElement);
    if (!nodeId) return;

    if (needsInnerHtmlPatch(beforeElement, afterElement)) {
      const afterAttributes = collectAttributes(afterElement);
      patches.push({
        id: nodeId,
        attributes: afterAttributes,
        innerHTML: stripSnapshotNodeIds(afterElement.innerHTML),
      });
      return;
    }

    const beforeAttributes = collectAttributes(beforeElement);
    const afterAttributes = collectAttributes(afterElement);
    const attributesChanged = !sameAttributes(beforeAttributes, afterAttributes);

    if (attributesChanged) {
      patches.push({
        id: nodeId,
        attributes: afterAttributes,
      });
    }

    const beforeChildren = Array.from(beforeElement.children);
    const afterChildren = Array.from(afterElement.children);
    for (let index = 0; index < beforeChildren.length; index += 1) {
      diffDecoratedElement(beforeChildren[index], afterChildren[index], patches);
    }
  }

  function createDecorationPatches(beforeDocument: Document, afterDocument: Document) {
    const beforeRoot = beforeDocument.body;
    const afterRoot = afterDocument.body;
    if (!(beforeRoot instanceof Element) || !(afterRoot instanceof Element)) return [];
    if (beforeRoot.isEqualNode(afterRoot)) return [];

    const patches: Array<Record<string, unknown>> = [];
    diffDecoratedElement(beforeRoot, afterRoot, patches);
    return patches;
  }

  function invokeHookFactory({
    scriptText,
    hookName,
    payload,
    snapshotHtml,
  }: {
    scriptText: unknown;
    hookName: unknown;
    payload: unknown;
    snapshotHtml?: unknown;
  }) {
    const { factory, error } = getCompiledFactory(scriptText);
    if (!factory) {
      throw new Error(error || "adapter compile failed");
    }

    const hook = String(hookName || "").trim();
    if (!hook) return null;
    const ctxPayload =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? { ...(payload as Record<string, unknown>) }
        : {};
    const helpers = createAdapterHelpers({
      injectedUserFallbackText: ctxPayload.requestMessagePreview,
    });

    if (hook === "decorateBubbles" || hook === "continueConversation") {
      const beforeDocument = parseSnapshotDocument(snapshotHtml);
      const afterDocument = parseSnapshotDocument(snapshotHtml);
      const env = createExecutionEnv(afterDocument);
      const adapter = factory(helpers, env);
      if (!adapter || typeof adapter !== "object") return null;

      const snapshotHook = adapter[hook];
      if (typeof snapshotHook !== "function") return null;

      const hookResult =
        snapshotHook({
          ...ctxPayload,
          root: afterDocument,
          helpers,
        }) || null;

      if (hook === "continueConversation") {
        if (hookResult && typeof hookResult === "object") {
          const validation = validateDomContinuationPlan(hookResult);
          if (!validation.ok) {
            throw new Error(`continueConversation plan invalid: ${validation.errors.join("; ")}`);
          }
          return cloneStructuredValue(validation.normalized);
        }
        return cloneStructuredValue(hookResult);
      }

      return {
        hookResult: cloneStructuredValue(hookResult),
        patches: createDecorationPatches(beforeDocument, afterDocument),
      };
    }

    const env = createExecutionEnv(document);
    const adapter = factory(helpers, env);
    if (!adapter || typeof adapter !== "object") return null;

    const targetHook = adapter[hook];
    if (typeof targetHook !== "function") return null;

    return cloneStructuredValue(
      targetHook({
        ...ctxPayload,
        helpers,
      }) || null,
    );
  }

  function postResponse(target: WindowProxy | null, response: Record<string, unknown>) {
    target?.postMessage(
      {
        channel: CHANNEL_NAME,
        ...response,
      },
      "*",
    );
  }

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.channel !== CHANNEL_NAME) return;

    if (data.type === "cancel-code-mode") {
      cancelRun(data.runId);
      return;
    }

    if (data.type === "tool-response") {
      const callId = Number(data.callId || 0);
      if (!callId) return;

      const pending = state.pendingToolCalls.get(callId);
      if (!pending) return;
      state.pendingToolCalls.delete(callId);

      if (data.ok === false) {
        pending.reject(new Error(String(data.error || "工具调用失败")));
        return;
      }

      pending.resolve(data.result ?? null);
      return;
    }

    if (data.type !== "execute") return;

    const requestId = Number(data.requestId || 0);
    if (!requestId) return;

    try {
      const result =
        data.requestKind === "code-mode"
          ? executeCodeModeRequest({
              code: data.code,
              manifest: data.manifest,
              runId: data.runId,
            })
          : invokeHookFactory({
              scriptText: data.scriptText,
              hookName: data.hookName,
              payload: data.payload,
              snapshotHtml: data.snapshotHtml,
            });

      Promise.resolve(result)
        .then((resolved) =>
          postResponse(event.source as WindowProxy | null, {
            type: "response",
            requestId,
            ok: true,
            result: resolved,
          }),
        )
        .catch((error) =>
          postResponse(event.source as WindowProxy | null, {
            type: "response",
            requestId,
            ok: false,
            error: serializeError(error),
          }),
        );
    } catch (error) {
      postResponse(event.source as WindowProxy | null, {
        type: "response",
        requestId,
        ok: false,
        error: serializeError(error),
      });
    }
  });

  window.parent?.postMessage(
    {
      channel: CHANNEL_NAME,
      type: "ready",
    },
    "*",
  );
})();
