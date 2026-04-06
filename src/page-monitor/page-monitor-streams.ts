(function () {
  'use strict';

  const monitor = window.ChatPlusPageMonitor;
  const STREAM_REPORT_THROTTLE_MS = 140;
  const STREAM_REPORT_MIN_DELTA = 18;

  function inheritNativeConstructor(WrappedCtor, NativeCtor, staticPropertyNames) {
    WrappedCtor.prototype = NativeCtor.prototype;
    Object.setPrototypeOf(WrappedCtor, NativeCtor);

    for (const propertyName of staticPropertyNames) {
      const descriptor = Object.getOwnPropertyDescriptor(NativeCtor, propertyName);
      if (!descriptor) continue;
      Object.defineProperty(WrappedCtor, propertyName, descriptor);
    }
  }

  function appendStreamBuffer(previousText, chunk) {
    const nextChunk = String(chunk || '');
    if (!nextChunk) return String(previousText || '');
    return `${String(previousText || '')}${nextChunk}`;
  }

  function buildPreviewText(rawText) {
    return String(rawText || '');
  }

  function buildAdapterText(rawText) {
    return String(rawText || '');
  }

  function shouldEmitProgress(lastPreview, nextPreview, lastReportedAt) {
    const previous = String(lastPreview || '');
    const next = String(nextPreview || '');
    if (!next || next === previous) return false;

    const lengthDelta = next.length - previous.length;
    if (lengthDelta >= STREAM_REPORT_MIN_DELTA) return true;
    return Date.now() - Number(lastReportedAt || 0) >= STREAM_REPORT_THROTTLE_MS;
  }

  function serializeStreamPreviewData(data) {
    if (typeof data === 'string') {
      return Promise.resolve(String(data));
    }

    if (data instanceof Blob) {
      return data
        .text()
        .then((text) => String(text || ''))
        .catch(() => `[blob:${data.type || 'unknown'} size=${data.size}]`);
    }

    if (data instanceof ArrayBuffer) {
      try {
        return Promise.resolve(new TextDecoder().decode(data));
      } catch (error) {
        return Promise.resolve('[binary message]');
      }
    }

    if (ArrayBuffer.isView(data)) {
      try {
        return Promise.resolve(
          new TextDecoder().decode(
            data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
          ),
        );
      } catch (error) {
        return Promise.resolve('[binary message]');
      }
    }

    if (data == null) {
      return Promise.resolve('');
    }

    try {
      return Promise.resolve(JSON.stringify(data));
    } catch (error) {
      return Promise.resolve(String(data));
    }
  }

  function serializeStreamRawData(data) {
    if (typeof data === 'string') {
      return Promise.resolve(String(data));
    }

    if (data instanceof Blob) {
      return data
        .text()
        .then((text) => String(text || ''))
        .catch(() => `[blob:${data.type || 'unknown'} size=${data.size}]`);
    }

    if (data instanceof ArrayBuffer) {
      try {
        return Promise.resolve(new TextDecoder().decode(data));
      } catch (error) {
        return Promise.resolve('[binary message]');
      }
    }

    if (ArrayBuffer.isView(data)) {
      try {
        return Promise.resolve(
          new TextDecoder().decode(
            data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
          ),
        );
      } catch (error) {
        return Promise.resolve('[binary message]');
      }
    }

    if (data == null) {
      return Promise.resolve('');
    }

    try {
      return Promise.resolve(JSON.stringify(data));
    } catch (error) {
      return Promise.resolve(String(data));
    }
  }

  function formatSseChunk(data) {
    const text = String(data || '');
    if (!text) return '';

    const body = text
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => `data: ${line}`)
      .join('\n');

    return `${body}\n\n`;
  }

  function shouldObserveStreamResponses() {
    return (
      monitor.state.isActive ||
      Boolean(monitor.normalizeInjectionText(monitor.state.requestInjectionText)) ||
      Boolean(String(monitor.state.adapterScript || '').trim())
    );
  }

  function shouldEmitStreamCandidate(endpoint, responseContentType, requestPreview, responsePreview, source) {
    const streamReasons = monitor.detectStreamReasons({
      endpoint,
      requestHeaders: {},
      requestPreview,
      responseContentType,
      responsePreview,
      source,
    });

    if (streamReasons.length) return true;
    if (monitor.isRelevantEndpoint(endpoint)) return true;
    if (requestPreview) return true;
    if (responsePreview && /application\/json|text\/|websocket/i.test(responseContentType)) return true;
    return Boolean(endpoint);
  }

  async function applyAdapterResponseTransform(payload, candidate) {
    const result = await monitor.runAdapterHook?.('extractResponse', payload);
    if (!result || typeof result !== 'object') return candidate;

    return {
      ...candidate,
      matched:
        result.matched !== undefined ? Boolean(result.matched) : candidate.matched,
      matchScore:
        typeof result.matchScore === 'number' ? result.matchScore : candidate.matchScore,
      responseContentPath:
        String(result.responseContentPath || '').trim() || candidate.responseContentPath,
      responseContentPreview:
        typeof result.responseContentPreview === 'string'
          ? result.responseContentPreview
          : String(result.responseContentPreview ?? '') || candidate.responseContentPreview,
      requestMessagePath:
        String(result.requestMessagePath || '').trim() || candidate.requestMessagePath,
      requestMessagePreview:
        typeof result.requestMessagePreview === 'string'
          ? result.requestMessagePreview
          : String(result.requestMessagePreview ?? '') || candidate.requestMessagePreview,
    };
  }

  monitor.patchEventSource = function patchEventSource() {
    if (typeof window.EventSource !== 'function') return;

    const NativeEventSource = window.EventSource;

    function WrappedEventSource(url, configuration) {
      const endpoint = monitor.toAbsoluteUrl(url);
      const eventSource = configuration === undefined
        ? new NativeEventSource(url)
        : new NativeEventSource(url, configuration);
      let responseBuffer = '';
      let adapterResponseBuffer = '';
      let responsePreview = '';
      let adapterResponseText = '';
      let lastReportedPreview = '';
      let lastReportedAt = 0;

      async function emitSnapshot(status, responseFinal = status === 'ERROR') {
        const streamReasons = monitor.detectStreamReasons({
          endpoint,
          requestHeaders: {},
          requestPreview: '',
          responseContentType: 'text/event-stream',
          responsePreview,
          source: 'eventsource'
        });

        if (!shouldObserveStreamResponses() && status === 'STREAM') return;
        if (!shouldEmitStreamCandidate(endpoint, 'text/event-stream', '', responsePreview, 'eventsource')) {
          return;
        }

        const nextCandidate = await applyAdapterResponseTransform({
          source: 'eventsource',
          method: 'GET',
          url: endpoint,
          status,
          headers: {},
          requestText: '',
          responseText: adapterResponseText || responsePreview,
          responseContentType: 'text/event-stream',
        }, {
          source: 'eventsource',
          method: 'GET',
          endpoint,
          status,
          responseContentType: 'text/event-stream',
          requestPreview: '',
          responsePreview,
          previewText: responsePreview,
          streamReasons,
          responseFinal,
        });
        monitor.emitResult(nextCandidate);
      }

      if (shouldObserveStreamResponses()) {
        void emitSnapshot('OPEN');
      }

      eventSource.addEventListener('message', (event) => {
        Promise.all([
          serializeStreamPreviewData(event?.data),
          serializeStreamRawData(event?.data),
        ]).then(([previewChunk, rawChunk]) => {
          responseBuffer = appendStreamBuffer(responseBuffer, formatSseChunk(previewChunk));
          adapterResponseBuffer = appendStreamBuffer(
            adapterResponseBuffer,
            formatSseChunk(rawChunk),
          );
          const nextPreview = buildPreviewText(responseBuffer);
          const nextAdapterText = buildAdapterText(adapterResponseBuffer);
          if (!shouldEmitProgress(lastReportedPreview, nextPreview, lastReportedAt)) return;

          responsePreview = nextPreview;
          adapterResponseText = nextAdapterText;
          lastReportedPreview = nextPreview;
          lastReportedAt = Date.now();
          void emitSnapshot('STREAM', false);
        });
      });

      eventSource.addEventListener('error', () => {
        if (!shouldObserveStreamResponses()) return;
        void emitSnapshot('ERROR', true);
      });

      return eventSource;
    }

    inheritNativeConstructor(WrappedEventSource, NativeEventSource, ['CONNECTING', 'OPEN', 'CLOSED']);

    window.EventSource = WrappedEventSource as unknown as typeof EventSource;
  };

  monitor.patchWebSocket = function patchWebSocket() {
    if (typeof window.WebSocket !== 'function') return;

    const NativeWebSocket = window.WebSocket;

    function WrappedWebSocket(url, protocols) {
      const endpoint = monitor.toAbsoluteUrl(url);
      const socket = protocols === undefined
        ? new NativeWebSocket(url)
        : new NativeWebSocket(url, protocols);
      let requestPreview = '';
      let responseBuffer = '';
      let adapterResponseBuffer = '';
      let responsePreview = '';
      let adapterResponseText = '';
      let lastReportedPreview = '';
      let lastReportedAt = 0;
      const nativeSend = socket.send;

      async function emitSnapshot(status, previewText, responseFinal = status === 'CLOSED' || status === 'ERROR') {
        const streamReasons = monitor.detectStreamReasons({
          endpoint,
          requestHeaders: {},
          requestPreview,
          responseContentType: 'websocket',
          responsePreview,
          source: 'websocket'
        });

        if (!shouldObserveStreamResponses()) return;
        if (!shouldEmitStreamCandidate(endpoint, 'websocket', requestPreview, responsePreview, 'websocket')) {
          return;
        }

        const nextCandidate = await applyAdapterResponseTransform({
          source: 'websocket',
          method: 'CONNECT',
          url: endpoint,
          status,
          headers: {},
          requestText: requestPreview,
          responseText: adapterResponseText || responsePreview,
          responseContentType: 'websocket',
        }, {
          source: 'websocket',
          method: 'CONNECT',
          endpoint,
          status,
          responseContentType: 'websocket',
          requestPreview,
          responsePreview,
          previewText: previewText || responsePreview || requestPreview,
          streamReasons,
          responseFinal,
        });
        monitor.emitResult(nextCandidate);
      }

      if (shouldObserveStreamResponses()) {
        void emitSnapshot('OPENING', '');
      }

      socket.send = function (data) {
        serializeStreamPreviewData(data).then((chunk) => {
          if (!chunk) return;
          requestPreview = buildPreviewText(appendStreamBuffer(requestPreview, chunk));
          if (shouldObserveStreamResponses()) {
            void emitSnapshot(
              socket.readyState === NativeWebSocket.OPEN ? 'SEND' : 'OPENING',
              chunk,
            );
          }
        });

        return nativeSend.call(this, data);
      };

      socket.addEventListener('open', () => {
        if (!shouldObserveStreamResponses()) return;
        void emitSnapshot('OPEN', '');
      });

      socket.addEventListener('message', (event) => {
        Promise.all([
          serializeStreamPreviewData(event?.data),
          serializeStreamRawData(event?.data),
        ]).then(([previewChunk, rawChunk]) => {
          responseBuffer = appendStreamBuffer(responseBuffer, previewChunk);
          adapterResponseBuffer = appendStreamBuffer(adapterResponseBuffer, rawChunk);
          const nextPreview = buildPreviewText(responseBuffer);
          const nextAdapterText = buildAdapterText(adapterResponseBuffer);
          if (!shouldEmitProgress(lastReportedPreview, nextPreview, lastReportedAt)) return;

          responsePreview = nextPreview;
          adapterResponseText = nextAdapterText;
          lastReportedPreview = nextPreview;
          lastReportedAt = Date.now();
          void emitSnapshot('STREAM', previewChunk, false);
        });
      });

      socket.addEventListener('close', () => {
        if (!shouldObserveStreamResponses()) return;
        void emitSnapshot('CLOSED', '', true);
      });

      socket.addEventListener('error', () => {
        if (!shouldObserveStreamResponses()) return;
        void emitSnapshot('ERROR', '', true);
      });

      return socket;
    }

    inheritNativeConstructor(WrappedWebSocket, NativeWebSocket, ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']);

    window.WebSocket = WrappedWebSocket as unknown as typeof WebSocket;
  };
})();
