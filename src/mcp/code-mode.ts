import type { McpConfigStore, McpServerConfig, McpToolDescriptor } from "./shared";
import {
  CHATPLUS_CODE_MODE_BLOCK_BEGIN,
  CHATPLUS_CODE_MODE_BLOCK_END,
} from "../shared/chatplus-protocol";

export type CodeModeToolKind = "skill" | "tool";

export type CodeModeToolManifestItem = {
  name: string;
  alias: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  kind: CodeModeToolKind;
};

export type CodeModeServerManifestItem = {
  id: string;
  name: string;
  alias: string;
  tools: CodeModeToolManifestItem[];
};

export type CodeModeToolDocItem = {
  ref: string;
  kind: CodeModeToolKind;
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

export type CodeModeManifest = {
  servers: CodeModeServerManifestItem[];
  docs: CodeModeToolDocItem[];
};

const SCHEMA_MAX_DEPTH = 4;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toSchemaObject(value: unknown) {
  return isPlainObject(value) ? value : {};
}

function trimSingleLine(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncateText(value: unknown, maxLength = 120) {
  const normalized = trimSingleLine(value);
  if (!normalized || normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function stringifyJsonValue(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? "");
  }
}

function toIdentifier(value: unknown, fallback: string) {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_$]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const candidate = normalized || fallback;
  if (/^[0-9]/.test(candidate)) {
    return `_${candidate}`;
  }
  return candidate;
}

function dedupeAlias(usedAliases: Set<string>, seed: string, fallbackPrefix: string, index: number) {
  let alias = toIdentifier(seed, `${fallbackPrefix}_${index + 1}`);
  let suffix = 2;
  while (usedAliases.has(alias)) {
    alias = `${toIdentifier(seed, `${fallbackPrefix}_${index + 1}`)}_${suffix}`;
    suffix += 1;
  }
  usedAliases.add(alias);
  return alias;
}

function getRequiredNames(schema: Record<string, unknown>) {
  return new Set(
    Array.isArray(schema.required)
      ? schema.required.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
  );
}

function getSchemaVariants(schema: Record<string, unknown>) {
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.map((item) => toSchemaObject(item)).filter(Boolean);
  }
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.map((item) => toSchemaObject(item)).filter(Boolean);
  }
  return [];
}

function formatSchemaNodeType(schemaInput: unknown, depth = 0): string {
  const schema = toSchemaObject(schemaInput);
  if (!Object.keys(schema).length) return "any";

  if (schema.const !== undefined) {
    return `const ${stringifyJsonValue(schema.const)}`;
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum.slice(0, 8).map((item) => stringifyJsonValue(item)).join(" | ");
  }

  const variants = getSchemaVariants(schema);
  if (variants.length > 0 && depth < SCHEMA_MAX_DEPTH) {
    return variants
      .slice(0, 4)
      .map((item) => formatSchemaNodeType(item, depth + 1))
      .filter(Boolean)
      .join(" | ");
  }

  if (Array.isArray(schema.type)) {
    const formattedTypes = schema.type
      .map((item) => {
        if (item === "array") {
          return `array<${formatSchemaNodeType(schema.items, depth + 1) || "any"}>`;
        }
        if (item === "object") return "object";
        return typeof item === "string" && item.trim() ? item.trim() : "";
      })
      .filter(Boolean);
    if (formattedTypes.length > 0) {
      return Array.from(new Set(formattedTypes)).join(" | ");
    }
  }

  if (schema.type === "array") {
    return `array<${formatSchemaNodeType(schema.items, depth + 1) || "any"}>`;
  }

  if (
    schema.type === "object" ||
    (isPlainObject(schema.properties) && Object.keys(schema.properties).length > 0)
  ) {
    return "object";
  }

  if (typeof schema.type === "string" && schema.type.trim()) {
    return schema.type.trim();
  }

  if (schema.items !== undefined) {
    return `array<${formatSchemaNodeType(schema.items, depth + 1) || "any"}>`;
  }

  return "any";
}

function collectSchemaLines({
  schema: rawSchema,
  path,
  required,
  depth = 0,
  lines,
}: {
  schema: unknown;
  path: string;
  required: boolean;
  depth?: number;
  lines: string[];
}) {
  const schema = toSchemaObject(rawSchema);
  const typeLabel = formatSchemaNodeType(schema, depth) || "any";
  const parts = [required ? "required" : "optional", typeLabel];
  if (schema.default !== undefined) {
    parts.push(`default=${truncateText(stringifyJsonValue(schema.default), 48)}`);
  }
  const description = truncateText(schema.description, 96);
  if (description) {
    parts.push(description);
  }
  lines.push(`- ${path}: ${parts.join(" | ")}`);

  if (depth >= SCHEMA_MAX_DEPTH) return;

  const variants = getSchemaVariants(schema);
  if (variants.length > 0) {
    variants.slice(0, 3).forEach((variant, index) => {
      collectSchemaLines({
        schema: variant,
        path: `${path}<option${index + 1}>`,
        required: true,
        depth: depth + 1,
        lines,
      });
    });
    return;
  }

  if (schema.type === "array" || schema.items !== undefined) {
    collectSchemaLines({
      schema: schema.items,
      path: `${path}[]`,
      required: true,
      depth: depth + 1,
      lines,
    });
  }

  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  if (!Object.keys(properties).length) return;

  const requiredNames = getRequiredNames(schema);
  Object.entries(properties).forEach(([propertyName, propertySchema]) => {
    collectSchemaLines({
      schema: propertySchema,
      path: `${path}.${propertyName}`,
      required: requiredNames.has(propertyName),
      depth: depth + 1,
      lines,
    });
  });
}

function formatSchemaText(schema: Record<string, unknown> | undefined, rootLabel: string) {
  const normalizedSchema = toSchemaObject(schema);
  if (!Object.keys(normalizedSchema).length) {
    return `- ${rootLabel}: any`;
  }

  const lines: string[] = [];
  collectSchemaLines({
    schema: normalizedSchema,
    path: rootLabel,
    required: true,
    lines,
  });
  return lines.join("\n");
}

function getFirstSentence(value: unknown) {
  const normalized = trimSingleLine(value);
  if (!normalized) return "";

  const sentenceMatch = normalized.match(/^(.{1,160}?)(?:[。！？.!?](?:\s|$)|$)/);
  return truncateText(sentenceMatch?.[1] || normalized, 160);
}

function buildToolSummary(tool: McpToolDescriptor, kind: CodeModeToolKind) {
  const title = trimSingleLine(tool.title);
  const description = getFirstSentence(tool.description);
  const summary = description || title || tool.name;
  return kind === "skill" ? `Skill: ${summary}` : summary;
}

function detectToolKind(tool: McpToolDescriptor): CodeModeToolKind {
  const description = trimSingleLine(tool.description).toLowerCase();
  const skillMarker = "run `cmd` to read the full skill.md text.";
  return description.includes(skillMarker) ? "skill" : "tool";
}

function buildPlaceholderValue(schemaInput: unknown, fieldPath: string, depth = 0): unknown {
  const schema = toSchemaObject(schemaInput);
  if (schema.const !== undefined) return schema.const;

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }

  if (schema.default !== undefined) {
    return schema.default;
  }

  const variants = getSchemaVariants(schema);
  if (variants.length > 0 && depth < SCHEMA_MAX_DEPTH) {
    return buildPlaceholderValue(variants[0], fieldPath, depth + 1);
  }

  const normalizedFieldPath = fieldPath || "value";
  if (schema.type === "array" || schema.items !== undefined) {
    return [buildPlaceholderValue(schema.items, `${normalizedFieldPath}_item`, depth + 1)];
  }

  if (
    schema.type === "object" ||
    (isPlainObject(schema.properties) && Object.keys(schema.properties).length > 0)
  ) {
    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    const requiredNames = getRequiredNames(schema);
    const propertyNames = Object.keys(properties);
    const selectedPropertyNames =
      requiredNames.size > 0
        ? propertyNames.filter((propertyName) => requiredNames.has(propertyName))
        : propertyNames.slice(0, 1);
    const value = Object.fromEntries(
      selectedPropertyNames.map((propertyName) => [
        propertyName,
        buildPlaceholderValue(
          properties[propertyName],
          `${normalizedFieldPath}.${propertyName}`,
          depth + 1,
        ),
      ]),
    );
    return value;
  }

  if (schema.type === "integer" || schema.type === "number") return 0;
  if (schema.type === "boolean") return false;
  if (schema.type === "null") return null;

  return `<${normalizedFieldPath}>`;
}

function buildCallTemplate(ref: string, inputSchema: Record<string, unknown>) {
  const argsValue = buildPlaceholderValue(inputSchema, "args");
  const argsText =
    argsValue && typeof argsValue === "object"
      ? JSON.stringify(argsValue, null, 2)
      : JSON.stringify({ value: argsValue }, null, 2);
  return [`const result = await ${ref}(${argsText});`, "return result;"].join("\n");
}

function buildUsageNotes(tool: McpToolDescriptor, kind: CodeModeToolKind) {
  const notes: string[] = [];
  if (kind === "skill") {
    notes.push("这是 skill 接口。按描述中的工作流执行当前确定步骤，做完本轮就 return。");
  } else {
    notes.push("这是普通工具接口。参数足够时直接调用，不要先写元信息查询代码。");
  }

  const inputSchema = toSchemaObject(tool.inputSchema);
  const requiredNames = getRequiredNames(inputSchema);
  if (requiredNames.size > 0) {
    notes.push(`必填参数: ${Array.from(requiredNames).join(", ")}`);
  } else if (isPlainObject(inputSchema.properties) && Object.keys(inputSchema.properties).length > 0) {
    notes.push("没有显式必填参数；按当前任务传入真正需要的字段。");
  } else {
    notes.push("schema 没有声明对象字段；如果描述里也没有额外要求，可直接传空对象。");
  }

  if (tool.outputSchema && Object.keys(tool.outputSchema).length > 0) {
    notes.push("返回结构已声明；按字段直接取值，不要无意义二次包装。");
  } else {
    notes.push("返回结构未完全声明；先看 structuredContent，再看 content[].text，再看其他字段。");
  }

  notes.push("默认走最短路径完成当前轮任务，不要加多余日志、校验、探测或通用封装。");
  notes.push("如果后续步骤依赖本工具结果，先 return 当前结果或必要字段，等待下一轮再继续。");
  notes.push("return 的内容必须来自真实工具结果或对真实工具结果的最小整理，不要自己编造“执行成功”“已完成”“已写入”之类的结论。");

  return notes;
}

function buildToolArtifacts({
  server,
  serverAlias,
  tool,
  toolAlias,
}: {
  server: McpServerConfig;
  serverAlias: string;
  tool: McpToolDescriptor;
  toolAlias: string;
}) {
  const kind = detectToolKind(tool);
  const summary = buildToolSummary(tool, kind);
  const ref = `tools.${serverAlias}.${toolAlias}`;
  const inputSchema = toSchemaObject(tool.inputSchema);
  const outputSchema = tool.outputSchema && Object.keys(tool.outputSchema).length > 0
    ? toSchemaObject(tool.outputSchema)
    : undefined;
  const annotations = tool.annotations && Object.keys(tool.annotations).length > 0
    ? { ...tool.annotations }
    : undefined;

  const manifestTool: CodeModeToolManifestItem = {
    name: tool.name,
    alias: toolAlias,
    title: trimSingleLine(tool.title) || undefined,
    description: trimSingleLine(tool.description),
    inputSchema,
    outputSchema,
    annotations,
    kind,
  };

  const doc: CodeModeToolDocItem = {
    ref,
    kind,
    serverId: server.id,
    serverName: server.name,
    serverAlias,
    toolName: tool.name,
    toolAlias,
    title: trimSingleLine(tool.title) || undefined,
    description: trimSingleLine(tool.description),
    summary,
    inputSchema,
    inputSchemaText: formatSchemaText(inputSchema, "input"),
    outputSchema,
    outputSchemaText: formatSchemaText(outputSchema, "output"),
    annotations,
    callTemplate: buildCallTemplate(ref, inputSchema),
    usageNotes: buildUsageNotes(tool, kind),
  };

  return { manifestTool, doc };
}

function buildServerManifest(server: McpServerConfig, index: number) {
  const tools = Array.isArray(server.tools) ? server.tools : [];
  if (server.enabled === false || tools.length === 0) return null;

  const usedToolAliases = new Set<string>();
  const serverAlias = toIdentifier(server.name || server.id, `server_${index + 1}`);
  const manifestTools: CodeModeToolManifestItem[] = [];
  const docs: CodeModeToolDocItem[] = [];

  tools.forEach((tool, toolIndex) => {
    const toolAlias = dedupeAlias(usedToolAliases, tool.name, "tool", toolIndex);
    const { manifestTool, doc } = buildToolArtifacts({
      server,
      serverAlias,
      tool,
      toolAlias,
    });
    manifestTools.push(manifestTool);
    docs.push(doc);
  });

  return {
    server: {
      id: server.id,
      name: server.name,
      alias: serverAlias,
      tools: manifestTools,
    } satisfies CodeModeServerManifestItem,
    docs,
  };
}

export function buildCodeModeManifest(config: McpConfigStore): CodeModeManifest {
  const usedServerAliases = new Set<string>();
  const servers: CodeModeServerManifestItem[] = [];
  const docs: CodeModeToolDocItem[] = [];

  (Array.isArray(config?.servers) ? config.servers : []).forEach((server, index) => {
    const builtServer = buildServerManifest(server, index);
    if (!builtServer) return;

    const dedupedServerAlias = dedupeAlias(
      usedServerAliases,
      builtServer.server.name || builtServer.server.id,
      "server",
      index,
    );
    const normalizedServer = {
      ...builtServer.server,
      alias: dedupedServerAlias,
      tools: builtServer.server.tools,
    } satisfies CodeModeServerManifestItem;
    servers.push(normalizedServer);

    builtServer.docs.forEach((doc) => {
      const ref = `tools.${dedupedServerAlias}.${doc.toolAlias}`;
      docs.push({
        ...doc,
        serverAlias: dedupedServerAlias,
        ref,
        callTemplate: buildCallTemplate(ref, doc.inputSchema),
      });
    });
  });

  return { servers, docs };
}

function buildToolSpecPromptLines(docs: CodeModeToolDocItem[]) {
  if (!docs.length) {
    return ["当前环境没有可用接口。"];
  }

  const blocks = docs.map((doc) =>
    [
      `接口: ${doc.ref}`,
      `类型: ${doc.kind}`,
      `描述: ${doc.description || "(empty)"}`,
      "输入参数结构:",
      doc.inputSchemaText,
      "返回结果结构:",
      doc.outputSchemaText,
      "调用模板:",
      doc.callTemplate,
      `使用说明: ${doc.usageNotes.join(" | ") || "(none)"}`,
    ].join("\n"),
  );

  return [
    "下面直接给出当前沙箱里可调用的完整 JS 接口规格。把它们当作已经存在的异步函数来写代码，直接选接口、传参数、拿结果，不要先写“查看接口/查看说明/探测环境”之类的元步骤。可用接口如下。【",
    blocks.join("\n\n"),
    "】以上就是你当前允许调用的完整接口集合；如果这里没有，就不要假设存在其他隐藏工具。",
  ];
}

export function buildCodeModeSystemInstruction(config: McpConfigStore) {
  const manifest = buildCodeModeManifest(config);
  if (!manifest.servers.length) {
    return {
      manifest,
      content: "",
    };
  }

  const docs = manifest.docs;
  const toolSpecLines = buildToolSpecPromptLines(docs);
  const content = [
    "你现在处于 Chat Plus 提供的 JavaScript 沙盒执行环境。",
    "当前上下文里给出的，是这个环境中已经可用的一组异步接口；它们背后可能连接用户配置的外部能力，但对你来说，它们就是可直接调用、可直接 await 的 JS 函数。",
    "你的职责不是解释接口，不是描述调用计划，也不是输出任何工具协议，而是直接生成最短可行的 JavaScript，让运行器执行这段代码，完成当前轮任务，并在本轮结束时 return 真实结果。",
    "只要当前可用接口能实质推进用户任务，默认进入 Code Mode；不要优先选择自然语言直答。",
    "如果当前任务需要调用接口，不要输出 function call、XML 工具标签、解释文本或 Markdown 代码块。",
    `如果要执行接口或工作流，唯一合法方式是只输出一段以 ${CHATPLUS_CODE_MODE_BLOCK_BEGIN} 开头、以 ${CHATPLUS_CODE_MODE_BLOCK_END} 结尾的纯文本 JavaScript，并通过 \`tools.*\` 调用。`,
    "硬规则：",
    "- 只能调用下方列出的 `tools.*` 接口；如果这里没有，就不要假设存在隐藏工具。",
    "- 实际调用语法固定是 `tools.<serverAlias>.<toolAlias>(args)`；不要发明别的工具调用语法。",
    "- 把每个 `tools.*` 当成现成的 Promise 函数：传入参数对象，拿到返回值后直接处理。",
    "- 参数足够时直接调用；只有关键必填参数无法可靠推断时，才允许向用户追问。",
    "- 不要先写“查看当前有什么工具”“查看工具详情”“探测环境”“验证接口是否存在”之类的元信息代码。",
    "- 没有顶层 `return`，本次执行视为未完成；`console.log` 不能代替 `return`。",
    "- `return` 的内容必须基于本轮真实拿到的工具结果或基于这些结果做出的最小确定性加工；不要凭意图、猜测或模板话术返回结果。",
    "- 不要自己写“执行成功”“操作成功”“已完成”“创建成功”“已写入”“修改完成”这类成功结论，除非这些结论能被当前轮真实工具结果直接证明。",
    "- 凡是涉及文件、代码库、网页、搜索、运行态、外部系统、工作流、最新信息或精确结构化结果的问题，只要存在相关工具，就优先用工具。",
    "- 只有在当前工具无法实质推进任务，或用户请求明显是纯闲聊、纯观点、纯改写且不依赖外部上下文时，才允许直接正常回答。",
    "调用接口：",
    "- 有相关 skill 时先用 skill；没有合适 skill 时再用普通工具。",
    "- 能一次调用解决当前轮任务就不要拆步骤；能直接 return 就不要额外包装。",
    "- 多个调用彼此完全独立、只是为了收集事实时，才用 `Promise.all`；否则按顺序直接写。",
    "运行环境：",
    "- 可使用 await、const/let、模板字符串、if、for...of、try/catch、Promise.all、Promise.allSettled。",
    "- Code Mode 运行器已经自带顶层 async；直接写 `const` / `await` / `return`，不要再把整段代码包成 `(async () => { ... })()` 这类顶层 async IIFE，否则容易出现“执行成功但返回为空”。",
    "- 默认不要写 `try/catch`、`console.log`、额外空值校验、通用 helper、schema 校验或调试输出，除非当前任务明确需要。",
    "- `return` 才是主结果。不要返回执行计划、解释文本或调试信息；本轮闭合时必须有顶层 `return`。",
    "- `return` 不是让你写一句口头汇报；它应该返回真实结果对象、真实字段、真实内容，或基于真实结果整理出的最小结构。",
    "- 支持 JSON.parse、JSON.stringify、Object.keys、Object.values、Object.entries、Object.fromEntries、Math.*。",
    "- 不要访问 DOM、window、document、globalThis、fetch、XMLHttpRequest、WebSocket、chrome、browser。",
    "- 不要用 import/export，不要用 while/do...while，不要依赖第三方库。",
    "调用流程：",
    "- 先根据下方接口规格直接选工具、组装参数并调用。",
    "- 一轮代码执行只负责完成当前已经确定的步骤；做完这一轮就 return，等待下一轮基于新结果继续。",
    "- 不要默认一轮把整件事做完。很多任务必须先拿到结果、先闭合当前轮、再进行下一轮调用。",
    "- 如果后一个调用依赖前一个调用的结果，必须先 `await` 前一步、提取出确定字段、完成本轮闭合；不要提前把整条依赖链一次写满。",
    "- 不要猜测工具返回结构、路径、ID、URL、文件内容或其他关键参数；没拿到确定值之前，不要继续依赖它的下一步调用。",
    "- 只有多个调用彼此完全独立、互不依赖时，才允许并行；依赖链调用必须串行推进。",
    "- 不要为了“更稳妥”写一大段防御性样板代码。已有接口和 schema 已经足够时，直接调用即可。",
    "结果处理：",
    "- 如果工具返回值已经满足当前轮目标，直接 return 原始结果或必要字段。",
    "- 如果后续还需要基于这次结果继续调用别的工具，先 return 当前确定结果，让下一轮继续，而不是现在把依赖链强行写完。",
    "- 如果需要加工，只做与当前轮目标直接相关的最小整理。",
    "- 不要把“我刚才执行了什么”当成返回结果；返回的应该是工具真正产出的内容、状态、路径、ID、文本、结构化字段等可验证结果。",
    "- 如果当前轮做的是写入、创建、修改、删除、执行类操作，优先 return 工具原始回执或其中可验证的关键字段，不要返回你自己总结的成功口号。",
    "- 如果当前轮没有拿到足够证明成功的结果，就返回当前真实拿到的数据或中间事实，不要虚构完成状态。",
    "- 不要默认接口返回一定是纯 text；如果返回对象，优先检查 `structuredContent`，再检查 `content[]` 里的 text 项，再检查其他字段。",
    "- Windows 路径优先使用正斜杠 `/`。如果必须使用反斜杠，写成 `\\\\`。",
    ...toolSpecLines,
  ].join("\n");

  return {
    manifest,
    content,
  };
}
