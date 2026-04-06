# Chat Plus

<p align="center">
  <img src="icons/icon128.png" alt="Chat Plus logo" width="96">
</p>

<p align="center">
  <strong>Adapter-driven MCP orchestration for AI chat websites.</strong>
</p>

<p align="center">
  Chat Plus connects web chat UIs to MCP servers and Skills, reinjects system instructions when needed,
  executes tool workflows in a controlled sandbox, and continues the same conversation with the result.
</p>

<p align="center">
  <a href="#overview">Overview</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="#site-adapters">Site Adapters</a> •
  <a href="#code-mode-and-mcp-orchestration">Code Mode</a> •
  <a href="#development">Development</a>
</p>

## Overview

Chat Plus is a browser extension for AI chat websites. It sits between the page, the extension runtime, and your MCP servers so a model can discover tools, call them, and continue the same conversation with the tool output.

The project is intentionally adapter-driven. Instead of baking host-specific logic into the extension core, Chat Plus uses one JavaScript adapter script per host. Each adapter is defined by one required `meta` block plus four required hooks: `transformRequest`, `extractResponse`, `decorateBubbles`, and `continueConversation`.

Here is a typical in-page usage view on a supported chat site, showing Code Mode cards and tool-result feedback rendered directly inside the conversation:

<p align="center">
  <img src="./image.png" alt="Chat Plus in-page Code Mode and tool result example" width="900">
</p>

<p align="center">
  <em>Example UI: Code Mode execution blocks and tool return status inside the chat conversation.</em>
</p>

> [!IMPORTANT]
> Chat Plus only works on tabs that have a valid site adapter. Site support lives in adapter scripts, not in the extension core.

> [!IMPORTANT]
> Chat Plus connects remote `SSE` and `Streamable HTTP` MCP endpoints directly. If your tools or `SKILL.md` workflows only exist locally, expose them through [MCP-Gateway](https://github.com/510myRday/MCP-Gateway) first.

## Why Chat Plus

- Adapter-first site support: one script per host, using a fixed four-hook contract.
- Per-tab orchestration: enable the extension, presets, servers, and tools independently for each page.
- MCP-native execution: discover tools from remote MCP servers and expose them as a structured runtime the model can use.
- Automatic continuation: after a tool run finishes, Chat Plus can send the result automatically or only fill the composer for review.
- System prompt reinjection: re-apply resolved system instructions when conversation length or URL changes require it.
- Sandboxed execution: adapters and Code Mode run in isolated environments instead of directly in the page context.

## How It Works

At a high level, Chat Plus watches a supported chat page, injects instructions into outgoing requests, extracts assistant output from incoming responses, and reacts when the model emits a Chat Plus protocol block or Code Mode block.

The important part is that Chat Plus does not treat MCP as a one-shot transport call. It first discovers tool interfaces from enabled MCP servers, normalizes them into a manifest, injects the full enabled `tools.*` directory with short descriptions, and keeps `toolDocs.describe(ref)` available for per-tool detail lookup. The model can then write small orchestration code that calls multiple tools, inspects intermediate results, reshapes output, and returns a cleaner final result to the conversation.

```mermaid
flowchart LR
    A[AI Chat Website] --> B[Chat Plus Content Runtime]
    B --> C[Enabled MCP Servers]
    C --> D[Tool Discovery]
    D --> E[Code Mode Manifest<br/>aliases + schemas]
    E --> F[Sandbox Runtime]
    F --> G[AI emits JavaScript<br/>calls tools.server.tool(args)]
    G --> H[Sandbox bridge]
    H --> I[Background MCP Client]
    I --> J[MCP Transport<br/>SSE / Streamable HTTP]
    J --> K[MCP Server]
    K --> J
    J --> I
    I --> H
    H --> F
    F --> L[Execution result]
    L --> B
    B --> M[Continue conversation]
```

Typical execution flow:

1. Chat Plus connects to enabled MCP endpoints and discovers their tools.
2. Those tools are normalized into a manifest with stable aliases and input schemas.
3. The resolved instruction set is injected into the active tab.
4. When the model decides to use tools, it emits a JavaScript block instead of a raw MCP transport call.
5. Chat Plus executes that code in a restricted sandbox.
6. Inside the sandbox, code can call `tools.<serverAlias>.<toolAlias>(args)`.
7. The sandbox bridges those calls to the background worker, which performs the actual MCP request over `SSE` or `Streamable HTTP`.
8. Results flow back to the sandbox first, then back to the chat conversation as execution output.

This is the main distinction of Chat Plus: MCP tools are exposed as a programmable interface inside a controlled runtime, not just as opaque remote calls.

## Getting Started

### Prerequisites

- Node.js
- A Chromium-based browser or Firefox
- At least one supported AI chat website
- A site adapter for that website
- One or more MCP servers, either remote or exposed through MCP-Gateway

### Install and build

```bash
npm install
npm run build
```

Build output:

- `dist/chrome`
- `dist/firefox`

For active development:

```bash
npm run dev
```

### Load the extension

| Browser | Output | How to load |
| --- | --- | --- |
| Chrome / Edge | `dist/chrome/` | Open `chrome://extensions`, enable Developer mode, then choose **Load unpacked** |
| Firefox | `dist/firefox/` | Open `about:debugging`, choose **This Firefox**, then load `dist/firefox/manifest.json` |

> [!NOTE]
> Chat Plus is primarily developed and tested for Chrome / Edge. Firefox support is kept as a source build target with a separate manifest, but GitHub Releases only publish the Chrome package.

### Configure a supported site

1. Open the target chat website.
2. Open the Chat Plus side panel.
3. Go to **Site** and add or edit the adapter script for that host.
4. Go to **Tools** and register one or more MCP servers.
5. Go to **Orchestration** and enable the tools the current tab is allowed to use.

Once a page has a valid adapter, enabled tools, and optional system presets, Chat Plus can inject instructions, detect execution markers, run MCP tools, and continue the conversation with the result.

## Local MCP and Skills via MCP-Gateway

Chat Plus is best at talking to remote MCP endpoints. When a server only exists locally, especially as `stdio` or as a local `SKILL.md` workflow, the recommended path is to put [MCP-Gateway](https://github.com/510myRday/MCP-Gateway) in front of it.

Recommended flow:

1. Run local MCP servers or skills through MCP-Gateway.
2. Let the gateway expose them as `SSE` or `HTTP` endpoints.
3. Register those generated endpoints in Chat Plus under **Tools**.
4. Enable the resulting tools per tab in **Orchestration**.

Typical gateway endpoints:

```text
http://127.0.0.1:8765/api/v2/sse/<serverName>
http://127.0.0.1:8765/api/v2/mcp/<serverName>
```

If MCP-Gateway exposes a dedicated skills endpoint, Chat Plus can consume it the same way as any other remote MCP server.

## Site Adapters

A site adapter is a single JavaScript script that must `return` an object with one required `meta` block and four required hooks:

```js
return {
  meta: {
    contractVersion: 2,
    adapterName: "Example Site",
    capabilities: {
      requestInjection: "json-body",
      responseExtraction: "json",
      protocolCards: "helper",
      autoContinuation: "dom-plan",
    },
  },
  transformRequest(ctx) {},
  extractResponse(ctx) {},
  decorateBubbles(ctx) {},
  continueConversation(ctx) {},
};
```

The four required hooks are the contract that makes a website work inside Chat Plus:

- `transformRequest(ctx)`: injects system instructions or pending tool-result payloads into the outgoing request when the request body can be modified reliably.
- `extractResponse(ctx)`: extracts the assistant text from the real response structure, including protocol blocks when needed.
- `decorateBubbles(ctx)`: rewrites the message DOM snapshot so injected protocol text is hidden and visible `toolCall`, `toolResult`, or `codeMode` blocks can be rendered as UI instead of raw protocol text. Adapters must use `ctx.helpers.ui.decorateProtocolBubbles(...)`.
- `continueConversation(ctx)`: returns the DOM plan that tells Chat Plus how to put `ctx.continuationText` back into the composer and trigger send. Adapters must use `ctx.helpers.plans.dom(...)`.

Important adapter behavior:

- `decorateBubbles(ctx)` and `continueConversation(ctx)` run in a DOM snapshot sandbox. They do not operate on the live page directly.
- `continueConversation(ctx)` should return a DOM strategy object, not click buttons or dispatch events itself.
- `transformRequest(ctx)` is still required even for encrypted or opaque payloads, but in those cases it may safely `return null`; Chat Plus will keep the four-hook contract and fall back to DOM prefill using the `continueConversation(ctx)` plan before the user sends.
- If a response contains both normal assistant text and protocol blocks, adapters should preserve the normal text and only transform the protocol part.
- If the target site changes request fields, response structure, or DOM shape, you usually fix the adapter script rather than the extension core.
- The sandbox exposes shared helper namespaces such as `ctx.helpers.protocol.*`, `ctx.helpers.ui.*`, and `ctx.helpers.plans.*`; new adapters are expected to build on them instead of reimplementing the same logic per host.

### Adapter Developer Workflow

This repository includes a dedicated workflow for adapter authors in [`chat-plus-adapter-debugger-skill/SKILL.md`](chat-plus-adapter-debugger-skill/SKILL.md).

If you are developing or repairing an adapter, the recommended path is:

1. Use [`chat-plus-adapter-debugger-skill/SKILL.md`](chat-plus-adapter-debugger-skill/SKILL.md) as the primary contract and review checklist.
2. When you need live evidence from a real site, use the `chrome-cdp` skill after the user explicitly allows page debugging.
3. Capture the real request payload, response or stream payload, composer DOM, and send action before writing or repairing selectors and field paths.
4. Generate or repair the adapter only after those samples are confirmed.

That workflow exists specifically to keep adapter work evidence-based instead of guess-based:

- inspect the real request payload
- inspect the real response or stream payload
- inspect the real chat DOM
- confirm the real composer and send action
- generate or repair a script that actually satisfies the Chat Plus adapter contract

The repository also includes migrated example adapters in `web_chat_js/` for ChatGPT, Gemini, Google AI Studio, Doubao, Qwen Chat, Arena, Xiaomi Mimo, and Z.ai. Use them as concrete examples of the current helper-based contract, not as a substitute for collecting real samples from the target site.

If you are developing support for a new website, start with the skill and live samples instead of guessing request paths, response fields, or selectors from the site name.

## Code Mode and MCP Orchestration

Code Mode gives the model a controlled JavaScript execution path for tool orchestration.

Instead of forcing the model to emit a single raw MCP call, Chat Plus can expose enabled tools as a structured manifest and let the model write a small JavaScript block that runs inside a sandbox. That code can call one or many tools, inspect results, combine them, and `return` a cleaner final value before the extension sends it back into the conversation.

What Code Mode provides:

- `tools.<serverAlias>.<toolAlias>(args)` access to enabled MCP tools
- an injected tool directory that lists every enabled `tools.*` entry with a short description
- `toolDocs.describe(ref)` for per-tool detail lookup when a schema, call template, or usage note is needed
- support for `await`, `Promise.all`, `console.log(...)`, structured `return`, and normal JavaScript data shaping
- a sandbox-to-background-to-MCP bridge, so the model never deals with raw transport details
- automatic continuation after execution, or fill-only mode when auto-send is disabled

What happens at runtime:

1. Chat Plus discovers tools from enabled servers.
2. It turns those tools into a manifest with aliases and schemas, then injects the full enabled tool directory with short descriptions.
3. The model picks from that directory, optionally calls `toolDocs.describe(ref)` for one tool's full doc, and writes JavaScript against the exposed runtime.
4. The sandbox executes the code.
5. Each `tools.*` call is forwarded to the background MCP client.
6. The MCP result comes back into the sandbox first.
7. The final execution output is then returned to the conversation.

What Code Mode does not allow:

- direct DOM access
- `window`, `document`, `fetch`, `XMLHttpRequest`, `chrome`, or `browser`
- `import` / `export`
- arbitrary third-party libraries

This is the part of Chat Plus that turns MCP tools into something closer to a programmable runtime than a thin connector.

## Development

### Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Watch mode for local Chrome development |
| `npm run build` | Clean, typecheck, and build Chrome + Firefox bundles |
| `npm run build:chrome` | Build only the Chrome bundle |
| `npm run build:firefox` | Build only the Firefox bundle |
| `npm run release:build:chrome` | Build and package the Chrome release ZIP used by GitHub Releases |
| `npm run typecheck` | Run TypeScript without emitting output |
| `npm run version:set -- x.y.z` | Update the extension version |
| `npm run version:sync` | Sync package and manifest versions |

### Project Layout

```text
src/
├─ background/          # MCP client, pooling, discovery, tool calls
├─ content/             # Injection state, continuation, Code Mode, widgets
├─ page-monitor/        # Request/response interception in the page world
├─ sandbox/             # Adapter and Code Mode sandbox executor
├─ sidepanel/           # React side panel UI
├─ mcp/                 # MCP config helpers and manifest generation
├─ system-instructions/ # Presets and resolution logic
└─ shared/              # Shared protocol tokens and utilities
```

The repository ships separate browser manifests for Chrome and Firefox, while keeping the adapter, orchestration, and MCP runtime logic shared.

## Licensing

Chat Plus is open-source under **GPL v3 or later**. If you use it in an open-source workflow that is compatible with GPL requirements, follow the terms in [`LICENSE`](LICENSE).

If you need commercial use, proprietary integration, or want to avoid GPL copyleft obligations, contact the maintainer for a separate commercial license.
