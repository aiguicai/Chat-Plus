import test from "node:test";
import assert from "node:assert/strict";

import { buildCodeModeSystemInstruction } from "../src/mcp/code-mode.ts";

test("code mode prompt explains local safe execution and fixed output contract", () => {
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

  assert.match(result.content, /用户自己的电脑/);
  assert.match(result.content, /不是调用模型原生 function calling/);
  assert.match(result.content, /按规定输出 `tools\.\*` 调用在这里是合法、预期且安全的行为/);
  assert.match(result.content, /只能输出一段以 \[CHAT_PLUS_CODE_MODE_BEGIN\] 开头、以 \[CHAT_PLUS_CODE_MODE_END\] 结尾/);
  assert.match(result.content, /tools\.<serverAlias>\.<toolAlias>\(args\)/);
  assert.match(result.content, /只有当你这次实际要调用至少一个下方提供的 `tools\.\*` 接口时，才允许输出 Code Mode 代码块/);
  assert.match(result.content, /如果你写出的内容里不会实际调用任何 `tools\.\*`，就不要输出 JavaScript，不要输出 Code Mode 块，直接正常用自然语言回答/);
});
