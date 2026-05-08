// Doubao v3 — rewritten 2026-05-08 against live CDP capture
// SSE endpoint: POST https://www.doubao.com/chat/completion (text/event-stream)
// DOM refreshed: data-testid selectors removed; replaced with semantic CSS class selectors

return {
  meta: {
    contractVersion: 2,
    adapterName: "Doubao",
    adapterVersion: "2026.05",
    capabilities: {
      requestInjection: "json-body",
      responseExtraction: "sse",
      protocolCards: "helper",
      autoContinuation: "dom-plan",
    },
  },

  // ── transformRequest ────────────────────────────────────────────────
  // JSON request body to /chat/completion, block_type 10000 unchanged.
  transformRequest(ctx) {
    const bodyText = ctx.helpers.text.toText(ctx.bodyText);
    if (!ctx.injectionText || !bodyText) return null;

    const payload = ctx.helpers.json.parse(bodyText);
    const messages = payload?.messages;
    if (!Array.isArray(messages) || messages.length === 0) return null;

    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const role = String(messages[i]?.role || "").trim().toLowerCase();
      if (!role || role === "user") { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return null;

    const lastMsg = messages[lastUserIdx];
    if (!Array.isArray(lastMsg?.content_block)) return null;

    const textBlockIdx = lastMsg.content_block.findIndex(
      (item) => item?.block_type === 10000 && typeof item?.content?.text_block?.text === "string",
    );
    if (textBlockIdx === -1) return null;

    const original = lastMsg.content_block[textBlockIdx].content.text_block.text;
    const nextText = ctx.helpers.buildInjectedText(ctx.injectionText, original, ctx.injectionMode);
    if (nextText === original) return null;

    payload.messages[lastUserIdx].content_block[textBlockIdx].content.text_block.text = nextText;

    return {
      applied: true,
      bodyText: JSON.stringify(payload),
      requestMessagePath: `body-json:messages[${lastUserIdx}].content_block[${textBlockIdx}].content.text_block.text`,
      requestMessagePreview: original,
    };
  },

  // ── extractResponse ─────────────────────────────────────────────────
  // SSE events: CHUNK_DELTA, STREAM_MSG_NOTIFY, STREAM_CHUNK, SSE_REPLY_END.
  extractResponse(ctx) {
    const responseText = ctx.helpers.text.toText(ctx.responseText);
    if (!responseText) return null;

    const events = ctx.helpers.stream.readSseEvents(responseText);
    let bestText = "";
    let protocolAwareText = "";

    for (const entry of events) {
      const data = entry?.json;
      if (!data || typeof data !== "object") continue;

      if (entry.event === "CHUNK_DELTA" && typeof data?.text === "string") {
        bestText = _merge(bestText, data.text);
        if (ctx.helpers.protocol.containsProtocolBlock(bestText, ctx.protocol)) {
          protocolAwareText = _longer(protocolAwareText, bestText);
        }
        continue;
      }

      if (entry.event === "STREAM_MSG_NOTIFY") {
        const blocks = data?.content?.content_block;
        if (Array.isArray(blocks)) {
          const parts = [];
          for (const b of blocks) {
            if (b?.block_type === 10000 && typeof b?.content?.text_block?.text === "string") {
              parts.push(b.content.text_block.text);
            }
          }
          const joined = parts.filter(Boolean).join("\n");
          if (joined) {
            bestText = _longer(bestText, joined);
            if (ctx.helpers.protocol.containsProtocolBlock(joined, ctx.protocol)) {
              protocolAwareText = _longer(protocolAwareText, joined);
            }
          }
        }
        continue;
      }

      if (entry.event === "STREAM_CHUNK") {
        const ops = Array.isArray(data?.patch_op) ? data.patch_op : [];
        for (const op of ops) {
          const blocks = op?.patch_value?.content_block;
          if (Array.isArray(blocks)) {
            for (const b of blocks) {
              if (b?.block_type === 10000 && typeof b?.content?.text_block?.text === "string") {
                bestText = _merge(bestText, b.content.text_block.text);
                if (ctx.helpers.protocol.containsProtocolBlock(bestText, ctx.protocol)) {
                  protocolAwareText = _longer(protocolAwareText, bestText);
                }
              }
            }
          }
        }
        continue;
      }

      if (entry.event === "SSE_REPLY_END" && data?.end_type === 1) {
        const brief = String(data?.msg_finish_attr?.brief ?? "").trim();
        if (brief) {
          bestText = _longer(bestText, brief);
          if (ctx.helpers.protocol.containsProtocolBlock(brief, ctx.protocol)) {
            protocolAwareText = _longer(protocolAwareText, brief);
          }
        }
      }
    }

    const previewText = protocolAwareText || bestText;
    if (!previewText) return null;
    const blocks = ctx.helpers.protocol.readBlocks(previewText, ctx.protocol);

    return {
      matched: true,
      matchScore: 100,
      responseContentPath: "sse:CHUNK_DELTA.text",
      responseContentPreview: previewText,
      toolCall: blocks.toolCallRaw ? { detected: true, rawBlock: blocks.toolCallRaw } : { detected: false },
      toolResult: blocks.toolResultRaw ? { detected: true, rawBlock: blocks.toolResultRaw } : { detected: false },
      codeMode: blocks.codeModeRaw ? { detected: true, rawBlock: blocks.codeModeRaw } : { detected: false },
    };
  },

  // ── decorateBubbles ─────────────────────────────────────────────────
  // 2026-05-08: data-testid attributes no longer exist.
  // User bubble: .bg-g-send-msg-bubble-bg (atomic class on message text div)
  // Assistant bubble: .container-P2rR72.flow-markdown-body (markdown body)
  decorateBubbles(ctx) {
    return ctx.helpers.ui.decorateProtocolBubbles({
      root: ctx.root || document,
      protocol: ctx.protocol,
      userSelectors: [
        ".bg-g-send-msg-bubble-bg",
      ],
      assistantSelectors: [
        ".container-P2rR72.flow-markdown-body",
      ],
    });
  },

  // ── continueConversation ────────────────────────────────────────────
  // textarea: .semi-input-textarea (unchanged)
  // send button: button with only SVG child in input row
  continueConversation(ctx) {
    return ctx.helpers.plans.dom({
      root: ctx.root,
      composerText: ctx.continuationText,
      input: {
        selectors: [
          "textarea.semi-input-textarea",
          'textarea[placeholder="发消息..."]',
        ],
        kind: "textarea",
        dispatchEvents: ["input", "change"],
      },
      send: {
        mode: "click",
        selectors: [
          "#flow-end-msg-send[data-dbx-name='button'][aria-disabled='false']",
          ".send-btn-wrapper > button#flow-end-msg-send",
          ".send-btn-wrapper > button[data-dbx-name='button'][data-disabled='false']",
          "button#flow-end-msg-send",
          "button[data-dbx-name='button'][data-disabled='false'][data-loading='false']:has(svg)",
          "button[class*='rounded-dbx-lg'][class*='size-36']:has(svg)",
        ],
        waitForEnabled: true,
        maxWaitMs: 3000,
        replayClickAfterManualInjection: true,
        replayClickDelayMs: 220,
      },
    });
  },
};

// inline helpers
function _merge(base, next) {
  const a = String(base ?? ""), b = String(next ?? "");
  if (!b) return a; if (!a) return b;
  if (a.endsWith(b)) return a; if (b.startsWith(a)) return b;
  const max = Math.min(a.length, b.length);
  for (let s = max; s > 0; s -= 1) {
    if (a.slice(-s) === b.slice(0, s)) return a + b.slice(s);
  }
  return a + b;
}
function _longer(a, b) {
  const sa = String(a ?? ""), sb = String(b ?? "");
  return sb.length > sa.length ? sb : sa || sb;
}
