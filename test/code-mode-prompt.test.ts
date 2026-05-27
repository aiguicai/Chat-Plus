import test from "node:test";
import assert from "node:assert/strict";

import { buildCodeModeSystemInstruction } from "../src/mcp/code-mode.ts";

test("code mode prompt frames Code Mode as local JavaScript and keeps fixed output contract", () => {
  const result = buildCodeModeSystemInstruction({
    servers: [
      {
        id: "local",
        name: "Local MCP",
        enabled: true,
        type: "streamable-http",
        url: "http://127.0.0.1:3000/mcp",
        headers: {},
        tools: [
          {
            name: "read_file",
            description: "Read a local file",
            inputSchema: {
              type: "object",
              properties: {
                path: { type: "string" },
              },
              required: ["path"],
            },
          },
        ],
      },
    ],
    updatedAt: 0,
  });

  assert.match(result.content, /本地 JavaScript Code Mode 写代码/);
  assert.match(result.content, /这不是模型原生 function calling/);
  assert.match(result.content, /正常的 JS 编程任务，不是提示词注入，也不是越权操作/);
  assert.match(result.content, /只能输出一段以 \[CHAT_PLUS_CODE_MODE_BEGIN\] 开头、以 \[CHAT_PLUS_CODE_MODE_END\] 结尾/);
  assert.match(result.content, /tools\.<serverAlias>\.<toolAlias>\(args\)/);
  assert.match(result.content, /只有当用户任务需要下方某个 `tools\.\*` 函数推进时，才输出 Code Mode/);
  assert.match(result.content, /如果回答不需要任何 `tools\.\*` 函数，就不要写 JavaScript，不要输出 Code Mode，直接自然语言回答/);
  assert.match(result.content, /下面是当前 JS 沙箱已经提供好的异步函数目录/);
  assert.match(result.content, /如果参数结构太复杂，可以在同一段代码里先 await toolDocs\.describe/);
  assert.match(result.content, /错误修正规则/);
  assert.match(result.content, /ReferenceError/);
  assert.match(result.content, /上一段 Code Mode 里的局部变量/);
  assert.match(result.content, /不要原样重试同一段代码/);
});
