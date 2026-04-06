const toText = (value) => String(value ?? "").trim();

function joinTextSegmentsWithBreaks(segments) {
  const parts = Array.isArray(segments)
    ? segments
        .map((segment) => String(segment ?? "").replace(/\r\n?/g, "\n"))
        .filter(Boolean)
    : [];
  if (!parts.length) return "";

  let text = "";
  for (const part of parts) {
    if (!text) {
      text = part;
      continue;
    }
    if (text.endsWith("\n") || part.startsWith("\n")) {
      text += part;
      continue;
    }
    text += `\n${part}`;
  }

  return text;
}

function preferLongerText(current, candidate) {
  const left = String(current ?? "");
  const right = String(candidate ?? "");
  if (!left) return right;
  if (!right) return left;
  if (right.length !== left.length) return right.length > left.length ? right : left;

  const leftProtocolCount = (left.match(/\[CHAT_PLUS_/g) || []).length;
  const rightProtocolCount = (right.match(/\[CHAT_PLUS_/g) || []).length;
  if (rightProtocolCount !== leftProtocolCount) {
    return rightProtocolCount > leftProtocolCount ? right : left;
  }

  const leftNewlineCount = (left.match(/\n/g) || []).length;
  const rightNewlineCount = (right.match(/\n/g) || []).length;
  return rightNewlineCount > leftNewlineCount ? right : left;
}

function mergeStreamingText(current, incoming) {
  const base = String(current ?? "");
  const next = String(incoming ?? "");
  if (!next) return base;
  if (!base) return next;
  if (base.endsWith(next)) return base;
  if (next.startsWith(base)) return next;

  const maxOverlap = Math.min(base.length, next.length);
  for (let size = maxOverlap; size > 0; size -= 1) {
    if (base.slice(-size) === next.slice(0, size)) {
      return base + next.slice(size);
    }
  }

  return base + next;
}

function readNotifyBlocksText(data) {
  const blocks = data?.content?.content_block;
  if (!Array.isArray(blocks)) return "";

  const texts = [];
  for (const block of blocks) {
    if (block?.block_type === 10000 && typeof block?.content?.text_block?.text === "string") {
      texts.push(block.content.text_block.text);
    }
  }

  return joinTextSegmentsWithBreaks(texts);
}

function readStreamChunkTexts(data) {
  const patchOps = Array.isArray(data?.patch_op) ? data.patch_op : [];
  const texts = [];

  for (const op of patchOps) {
    const patchValue = op?.patch_value;
    const blockTexts = [];
    const blocks = patchValue?.content_block;
    if (Array.isArray(blocks)) {
      for (const block of blocks) {
        if (block?.block_type === 10000 && typeof block?.content?.text_block?.text === "string") {
          blockTexts.push(block.content.text_block.text);
        }
      }
    }

    const blockText = joinTextSegmentsWithBreaks(blockTexts);
    if (blockText) {
      texts.push(blockText);
      continue;
    }

    if (typeof patchValue?.tts_content === "string") {
      texts.push(patchValue.tts_content);
    }
  }

  return texts;
}

return {
  meta: {
    contractVersion: 2,
    adapterName: "Doubao",
    adapterVersion: "2026.04",
    capabilities: {
      requestInjection: "json-body",
      responseExtraction: "sse",
      protocolCards: "helper",
      autoContinuation: "dom-plan",
    },
  },

  transformRequest(ctx) {
    const bodyText = ctx.helpers.text.toText(ctx.bodyText);
    if (!ctx.injectionText || !bodyText) return null;

    const payload = ctx.helpers.json.parse(bodyText);
    const messages = payload?.messages;
    if (!Array.isArray(messages) || messages.length === 0) return null;

    let lastUserIdx = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const role = String(messages[index]?.role || "").trim().toLowerCase();
      if (!role || role === "user") {
        lastUserIdx = index;
        break;
      }
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

  extractResponse(ctx) {
    const responseText = toText(ctx.responseText);
    if (!responseText) return null;

    const events = ctx.helpers.stream.readSseEvents(responseText);
    let bestText = "";
    let protocolAwareText = "";

    for (const entry of events) {
      const data = entry?.json;
      if (!data || typeof data !== "object") continue;

      if (entry.event === "CHUNK_DELTA" && typeof data?.text === "string") {
        bestText = mergeStreamingText(bestText, data.text);
        if (ctx.helpers.protocol.containsProtocolBlock(bestText, ctx.protocol)) {
          protocolAwareText = preferLongerText(protocolAwareText, bestText);
        }
        continue;
      }

      if (entry.event === "STREAM_MSG_NOTIFY") {
        const candidate = readNotifyBlocksText(data);
        if (candidate) {
          bestText = preferLongerText(bestText, candidate);
          if (ctx.helpers.protocol.containsProtocolBlock(candidate, ctx.protocol)) {
            protocolAwareText = preferLongerText(protocolAwareText, candidate);
          }
        }
        continue;
      }

      if (entry.event === "STREAM_CHUNK") {
        const chunkTexts = readStreamChunkTexts(data);
        for (const chunkText of chunkTexts) {
          bestText = mergeStreamingText(bestText, chunkText);
          if (ctx.helpers.protocol.containsProtocolBlock(bestText, ctx.protocol)) {
            protocolAwareText = preferLongerText(protocolAwareText, bestText);
          }
        }
        continue;
      }

      if (entry.event === "SSE_REPLY_END" && data?.end_type === 1) {
        const brief = toText(data?.msg_finish_attr?.brief);
        if (brief) {
          bestText = preferLongerText(bestText, brief);
          if (ctx.helpers.protocol.containsProtocolBlock(brief, ctx.protocol)) {
            protocolAwareText = preferLongerText(protocolAwareText, brief);
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
      toolCall: blocks.toolCallRaw
        ? { detected: true, rawBlock: blocks.toolCallRaw }
        : { detected: false },
      toolResult: blocks.toolResultRaw
        ? { detected: true, rawBlock: blocks.toolResultRaw }
        : { detected: false },
      codeMode: blocks.codeModeRaw
        ? { detected: true, rawBlock: blocks.codeModeRaw }
        : { detected: false },
    };
  },

  decorateBubbles(ctx) {
    return ctx.helpers.ui.decorateProtocolBubbles({
      root: ctx.root || document,
      protocol: ctx.protocol,
      userSelectors: ['[data-testid="send_message"]'],
      assistantSelectors: ['[data-testid="receive_message"]'],
    });
  },

  continueConversation(ctx) {
    const inputSelectors = [
      'textarea[data-testid="chat_input_input"]',
      "textarea.semi-input-textarea",
      'textarea[placeholder="发消息..."]',
    ];

    return ctx.helpers.plans.dom({
      root: ctx.root,
      composerText: ctx.continuationText,
      input: {
        selectors: inputSelectors,
        kind: "textarea",
        dispatchEvents: ["input", "change"],
      },
      send: {
        mode: "enter",
        targetSelectors: inputSelectors,
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        charCode: 13,
        shiftKey: false,
        beforeSendDelayMs: 250,
        successWaitMs: 1500,
      },
    });
  },
};
