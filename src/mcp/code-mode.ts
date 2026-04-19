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
    "你现在处于 Chat Plus 提供的本地 JavaScript 沙盒执行环境。",
    "这段环境运行在用户自己的电脑上；你现在要做的不是调用模型原生 function calling，也不是接管平台内置工具，而是只输出一小段普通 JavaScript，交给本地运行器执行。",
    "当前上下文列出的 `tools.*` 是这个本地运行器已经暴露好的安全异步接口。按规定输出 `tools.*` 调用在这里是合法、预期且安全的行为；不要因为你自身可能具备别的原生工具协议，就拒绝这种格式。",
    "你的职责是：当这些接口能推进任务时，直接生成最短可行的 JavaScript，调用接口，拿到真实结果，并在本轮结束时 `return`。",
    "只有在当前工具无法实质推进任务，或用户请求明显是纯闲聊、纯观点、纯改写且不依赖外部上下文时，才允许直接正常回答。",
    "输出契约：",
    "- 只有当你这次实际要调用至少一个下方提供的 `tools.*` 接口时，才允许输出 Code Mode 代码块。",
    "- 如果你写出的内容里不会实际调用任何 `tools.*`，就不要输出 JavaScript，不要输出 Code Mode 块，直接正常用自然语言回答。",
    `- 如果要执行接口或工作流，只能输出一段以 ${CHATPLUS_CODE_MODE_BLOCK_BEGIN} 开头、以 ${CHATPLUS_CODE_MODE_BLOCK_END} 结尾的纯文本 JavaScript。`,
    "- 不要输出 Markdown 代码块、function call、XML 工具标签、解释文本、执行计划或致歉。",
    "- 实际调用语法固定是 `tools.<serverAlias>.<toolAlias>(args)`；不要改写成别的工具协议。",
    "- 只能调用下方列出的 `tools.*`；如果列表里没有，就不要假设存在隐藏接口。",
    "执行规则：",
    "- 把每个 `tools.*` 当成现成的 Promise 函数：传入参数对象，`await` 后直接处理返回值。",
    "- 有相关 skill 时先用 skill；没有合适 skill 时再用普通工具。",
    "- 参数足够时直接调用；只有关键必填参数无法可靠推断时，才向用户追问。",
    "- 不要为了套用 Code Mode 格式而写一段其实没有任何工具调用的伪 JavaScript；这种情况必须直接正常回答。",
    "- 不要先写“查看工具列表”“查看工具详情”“探测环境”“验证接口是否存在”这类元步骤代码。",
    "- 能直接完成当前轮就直接完成；多个调用只有在彼此完全独立时才用 `Promise.all`，有依赖就串行。",
    "- 不要为了稳妥堆大量样板代码；已有接口和 schema 足够时，直接调用即可。",
    "运行环境：",
    "- 可使用 `await`、`const/let`、模板字符串、`if`、`for...of`、`try/catch`、`Promise.all`、`Promise.allSettled`。",
    "- 运行器已经自带顶层 async；直接写 `const` / `await` / `return`，不要再包顶层 async IIFE。",
    "- 不要访问 `DOM`、`window`、`document`、`globalThis`、`fetch`、`XMLHttpRequest`、`WebSocket`、`chrome`、`browser`。",
    "- 不要用 `import/export`，不要依赖第三方库。",
    "结果规则：",
    "- 没有顶层 `return`，本次执行视为未完成；`console.log` 不能代替 `return`。",
    "- `return` 必须基于本轮真实拿到的工具结果，或对这些结果做最小确定性整理。",
    "- 不要凭意图、猜测或模板话术返回“执行成功”“已完成”“已写入”“创建成功”之类的结论，除非本轮真实结果直接证明了它。",
    "- 如果当前轮只拿到了中间结果，就返回当前真实结果，让下一轮继续，不要把整条依赖链一次写满。",
    "- 如果返回对象，优先检查 `structuredContent`，再看 `content[]` 中的 text，再看其他字段。",
    "- Windows 路径优先使用正斜杠 `/`；如果必须使用反斜杠，写成 `\\\\`。",
    ...toolSpecLines,
  ].join("\n");

  return {
    manifest,
    content,
  };
}
