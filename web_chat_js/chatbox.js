const toText = (value) => String(value ?? "").trim();

function looksLikeChatboxCompletionRequest(url, bodyText) {
  const targetUrl = toText(url).toLowerCase();
  if (!/\/v1\/chat\/completions\b/.test(targetUrl)) return false;

  try {
    const payload = JSON.parse(String(bodyText || ""));
    return Boolean(payload && Array.isArray(payload.messages));
  } catch {
    return false;
  }
}

function findLastUserContentSlot(messages) {
  if (!Array.isArray(messages)) return null;

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (toText(message?.role).toLowerCase() !== "user") continue;

    if (typeof message?.content === "string") {
      return {
        path: `body-json:messages[${messageIndex}].content`,
        text: message.content,
        apply(nextText) {
          messages[messageIndex].content = nextText;
        },
      };
    }

    if (Array.isArray(message?.content)) {
      for (let contentIndex = message.content.length - 1; contentIndex >= 0; contentIndex -= 1) {
        const item = message.content[contentIndex];
        if (typeof item?.text !== "string") continue;
        return {
          path: `body-json:messages[${messageIndex}].content[${contentIndex}].text`,
          text: item.text,
          apply(nextText) {
            messages[messageIndex].content[contentIndex].text = nextText;
          },
        };
      }
    }
  }

  return null;
}

function readSseJsonEvents(text) {
  const raw = String(text ?? "").replace(/\r\n?/g, "\n");
  if (!raw.includes("data:")) return [];

  return raw
    .split(/\n{2,}/)
    .map((block) =>
      block
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter(Boolean)
        .join("\n")
        .trim(),
    )
    .filter((chunk) => chunk && chunk !== "[DONE]")
    .flatMap((chunk) => {
      try {
        return [JSON.parse(chunk)];
      } catch {
        return [];
      }
    });
}

function readAssistantTextFromEvents(events) {
  let text = "";
  let fallback = "";

  events.forEach((event) => {
    const choice = event?.choices?.[0] || {};
    const delta = choice?.delta || {};
    const deltaText = typeof delta?.content === "string" ? delta.content : "";
    const messageText = typeof choice?.message?.content === "string" ? choice.message.content : "";

    if (deltaText) {
      text += deltaText;
      fallback += deltaText;
      return;
    }

    if (messageText) {
      fallback = messageText;
    }
  });

  return text || fallback;
}

return {
  meta: {
    contractVersion: 2,
    adapterName: "Chatbox",
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
    if (!ctx.injectionText || !looksLikeChatboxCompletionRequest(ctx.url, bodyText)) return null;

    const payload = ctx.helpers.json.parse(bodyText);
    if (!payload) return null;

    const slot = findLastUserContentSlot(payload?.messages);
    if (!slot?.text) return null;

    const nextText = ctx.helpers.buildInjectedText(ctx.injectionText, slot.text, ctx.injectionMode);
    if (nextText === slot.text) return null;
    slot.apply(nextText);

    return {
      applied: true,
      bodyText: JSON.stringify(payload),
      requestMessagePath: slot.path,
      requestMessagePreview: slot.text,
    };
  },

  extractResponse(ctx) {
    const responseText = toText(ctx.responseText);
    if (!responseText || !/\/v1\/chat\/completions\b/i.test(toText(ctx.url))) return null;

    const events = readSseJsonEvents(responseText);
    if (!events.length) return null;

    const previewText = readAssistantTextFromEvents(events);
    if (!previewText) return null;

    const blocks = ctx.helpers.protocol.readBlocks(previewText, ctx.protocol);
    return {
      matched: true,
      matchScore: 100,
      responseContentPath: "sse:choices[0].delta.content",
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
      userSelectors: [
        ".user-msg .msg-content",
        ".user-msg .msg-content .break-words",
      ],
      assistantSelectors: [
        ".assistant-msg .msg-content",
        ".assistant-msg .msg-content .break-words",
      ],
    });
  },

  continueConversation(ctx) {
    return ctx.helpers.plans.dom({
      root: ctx.root,
      composerText: ctx.continuationText,
      input: {
        selectors: [
          'textarea[data-testid="message-input"]',
          'textarea[placeholder="Type your question here..."]',
        ],
        kind: "textarea",
        dispatchEvents: ["input", "change"],
      },
      send: {
        mode: "click",
        selectors: [
          "button.shrink-0.mb-1.mantine-ActionIcon-root",
          ".rounded-md.bg-chatbox-background-secondary button.shrink-0.mb-1",
        ],
        waitForEnabled: true,
        maxWaitMs: 2500,
      },
    });
  },
};
