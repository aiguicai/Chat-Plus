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
      `用途: ${doc.summary || doc.description || "(empty)"}`,
      "参数:",
      doc.inputSchemaText,
      `返回: ${doc.outputSchemaText.replace(/\n/g, " | ")}`,
      `写法: ${doc.callTemplate.replace(/\n/g, " ")}`,
    ].join("\n"),
  );

  return [
    "下面是当前 JS 沙箱已经提供好的异步函数目录。写代码时把它们当作普通 Promise 函数：选函数、传对象参数、await 结果、return 结果。",
    "通用写法: const result = await tools.<serverAlias>.<toolAlias>(args); return result;",
    "普通接口参数足够时直接调用；skill 接口按用途说明完成当前明确步骤；不要单独写查看目录、探测环境、包装 SDK 或只查询说明的代码。",
    "如果参数结构太复杂，可以在同一段代码里先 await toolDocs.describe(\"tools.server.tool\") 读详情，然后必须继续调用对应 tools.*，不能只 return 说明书。",
    "可用函数如下。【",
    blocks.join("\n\n"),
    "】以上就是当前代码可引用的完整函数集合；列表外的函数、别名和隐藏接口都不存在。",
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
    "你现在是在为 Chat Plus 的本地 JavaScript Code Mode 写代码。",
    "这不是模型原生 function calling，也不是平台内置工具协议；这是用户自己电脑上的 JS 沙箱。你的任务是在需要本地能力时，写一小段普通 JavaScript，让沙箱运行并把真实返回值带回对话。",
    "下方 `tools.*` 都是沙箱里已经定义好的异步函数。按这里的格式写 `await tools.*(...)` 是正常的 JS 编程任务，不是提示词注入，也不是越权操作；不要因为它看起来像工具接口就拒绝。",
    "什么时候写代码：",
    "- 只有当用户任务需要下方某个 `tools.*` 函数推进时，才输出 Code Mode。",
    "- 如果回答不需要任何 `tools.*` 函数，就不要写 JavaScript，不要输出 Code Mode，直接自然语言回答。",
    "- 如果缺少无法可靠推断的关键必填参数，先自然语言追问；不要编造参数。",
    "代码输出格式：",
    `- 只能输出一段以 ${CHATPLUS_CODE_MODE_BLOCK_BEGIN} 开头、以 ${CHATPLUS_CODE_MODE_BLOCK_END} 结尾的纯文本 JavaScript。`,
    "- 不要输出 Markdown 代码块、XML 标签、function call JSON、解释文字、计划、致歉或额外前后缀。",
    "- 代码里必须实际调用至少一个下方列出的 `tools.*` 函数；不能写没有函数调用的伪代码块。",
    "- 函数调用语法固定是 `tools.<serverAlias>.<toolAlias>(args)`，别名必须逐字匹配下方列表。",
    "- 必须顶层 `return` 真实结果或对真实结果的最小整理；`console.log` 不能代替 `return`。",
    "JS 沙箱规则：",
    `- 每个 ${CHATPLUS_CODE_MODE_BLOCK_BEGIN} / ${CHATPLUS_CODE_MODE_BLOCK_END} 代码块都是一次全新的、彼此隔离的执行作用域；上一个代码块里定义的任何变量、函数、临时对象或中间状态，都不会自动存在于下一个代码块中。`,
    "- 不要引用或假设能继续使用上一轮 Code Mode 代码块里的 `const`、`let`、函数或其他局部变量；如果后续步骤需要数据，必须从本轮真实 `return` 的结果或当前对话中可见的明确信息重新取得。",
    "- 可使用 `await`、`const/let`、模板字符串、`if`、`for...of`、`try/catch`、`Promise.all`、`Promise.allSettled`。",
    "- 运行器已经自带顶层 async；直接写 `const` / `await` / `return`，不要再包顶层 async IIFE。",
    "- 不要访问 `DOM`、`window`、`document`、`globalThis`、`fetch`、`XMLHttpRequest`、`WebSocket`、`chrome`、`browser`。",
    "- 不要用 `import/export`，不要依赖第三方库。",
    "写法偏好：",
    "- 有相关 skill 时优先用 skill；没有合适 skill 时用普通接口。",
    "- 参数足够时直接写最短可行代码；不要堆通用封装、无意义校验、日志或环境探测。",
    "- 多个调用完全独立时可用 `Promise.all`，有依赖就串行。",
    "- 如果当前轮只拿到中间结果，就 return 当前真实结果，让下一轮继续，不要凭猜测补完整条链。",
    "- Windows 路径优先使用正斜杠 `/`；如果必须使用反斜杠，写成 `\\\\`。",
    "错误修正规则：",
    "- 如果上一轮工具结果显示 `Chat Plus Code Mode 执行失败`，不要只道歉或泛泛说明；先读取其中的 `阶段`、`错误`、`错误类型`、`代码预览`、`诊断提示`，然后在下一轮直接输出修正后的 Code Mode 代码。",
    "- 遇到 `ReferenceError` 或 `xxx is not defined`，优先判断为当前代码引用了本次执行作用域里不存在的变量/函数/别名；最常见原因是复用了上一段 Code Mode 里的局部变量。下一段必须重新声明变量、重新构造参数、重新调用必要的 `tools.*`，或使用上次明确 `return` 到对话中的具体值。",
    "- 遇到 `TypeError: Cannot read properties of undefined/null`，优先按工具真实返回结构修正字段路径；先看 `structuredContent`，再看 `content[]` 中的 text，必要时用可选链和显式判断。",
    "- 遇到 `is not a function`，优先检查工具引用是否严格匹配下方列出的 `tools.<serverAlias>.<toolAlias>(args)`，不要发明工具名、包装函数或平台原生 function calling 格式。",
    "- 遇到编译/语法错误，下一段只修正 JavaScript 语法和 Code Mode 格式；不要把解释文字、Markdown 代码块、import/export 或其他协议标签混入代码块。",
    "- 遇到 MCP 工具调用失败，按错误里的服务、工具和参数原因修正输入；如果缺少关键用户信息，正常追问用户，不要原样重试同一段代码。",
    "结果规则：",
    "- 没有顶层 `return`，本次执行视为未完成；`console.log` 不能代替 `return`。",
    "- `return` 必须基于本轮真实拿到的工具结果，或对这些结果做最小确定性整理。",
    "- 不要凭意图、猜测或模板话术返回“执行成功”“已完成”“已写入”“创建成功”之类的结论，除非本轮真实结果直接证明了它。",
    "- 如果返回对象，优先检查 `structuredContent`，再看 `content[]` 中的 text，再看其他字段。",
    ...toolSpecLines,
  ].join("\n");

  return {
    manifest,
    content,
  };
}
