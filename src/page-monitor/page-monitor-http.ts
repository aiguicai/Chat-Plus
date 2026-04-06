(function () {
  'use strict';

  const monitor = window.ChatPlusPageMonitor;
  const FETCH_REPORT_THROTTLE_MS = 140;
  const FETCH_REPORT_MIN_DELTA = 18;
  const XHR_REPORT_THROTTLE_MS = 180;
  const XHR_REPORT_MIN_DELTA = 24;

  // ─── 请求体读取工具 ───────────────────────────────────────────────────────────

  async function readRawRequestBodyFromRequest(request) {
    if (!(request instanceof Request)) return '';
    try {
      const clone = request.clone();
      return await clone.text();
    } catch (error) {
      return '';
    }
  }

  async function readRequestBodyFromRequest(request) {
    return await readRawRequestBodyFromRequest(request);
  }

  // ─── Adapter Hook 调用 ────────────────────────────────────────────────────────

  /**
   * 调用 transformRequest hook。
   * 如果站点没有配置 adapterScript 或 hook 返回 applied: false，直接放行原始请求。
   * hook 负责注入逻辑，返回修改后的 { applied, url, bodyText, headers }。
   */
  async function applyAdapterRequestTransform(payload) {
    const result = await monitor.runAdapterHook?.('transformRequest', payload);
    if (!result || typeof result !== 'object') {
      return {
        applied: false,
        url: payload.url,
        bodyText: payload.bodyText,
        headers: payload.headers,
      };
    }

    return {
      applied: Boolean(result.applied),
      url: typeof result.url === 'string' ? result.url : payload.url,
      bodyText: typeof result.bodyText === 'string' ? result.bodyText : payload.bodyText,
      headers:
        result.headers && typeof result.headers === 'object'
          ? { ...payload.headers, ...result.headers }
          : payload.headers,
      requestMessagePath: String(result.requestMessagePath || '').trim(),
      requestMessagePreview:
        typeof result.requestMessagePreview === 'string'
          ? result.requestMessagePreview
          : String(result.requestMessagePreview ?? ''),
    };
  }

  /**
   * 调用 extractResponse hook。
   * 让脚本识别并提取响应内容，返回 matched / responseContentPath / responseContentPreview 等。
   */
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

  // ─── 注入入口：Fetch ──────────────────────────────────────────────────────────

  /**
   * 对 fetch 请求应用 transformRequest hook。
   * 没有 adapterScript 或 hook 未应用 → 直接返回原始 input/init，injectionApplied = false。
   */
  async function applyInjectionToFetchArgs(input, init) {
    // 没有 adapter，直接放行
    if (!String(monitor.state.adapterScript || '').trim()) {
      return { input, init, injectionApplied: false };
    }

    const request = input instanceof Request ? input : null;
    const endpointText = typeof input === 'string' ? input : request?.url || '';
    const requestMethod = String(init?.method || request?.method || 'GET').toUpperCase();
    const adapterHeaders = monitor.headersToObject(init?.headers || request?.headers);
    const adapterBodyText = request
      ? await readRawRequestBodyFromRequest(request)
      : typeof init?.body === 'string'
        ? init.body
        : '';

    const adapterResult = await applyAdapterRequestTransform({
      url: monitor.toAbsoluteUrl(endpointText),
      method: requestMethod,
      headers: adapterHeaders,
      bodyText: adapterBodyText,
        injectionText: monitor.normalizeInjectionText(monitor.state.requestInjectionText),
        injectionMode: monitor.state.requestInjectionMode || 'system',
    });

    if (!adapterResult.applied) {
      return { input, init, injectionApplied: false };
    }

    // 应用 hook 返回的结果，重建请求
    if (request) {
      const requestInit = {
        method: init?.method || request.method,
        headers: adapterResult.headers || init?.headers || request.headers,
        body: adapterResult.bodyText,
        cache: init?.cache || request.cache,
        credentials: init?.credentials || request.credentials,
        integrity: init?.integrity || request.integrity,
        keepalive: init?.keepalive || request.keepalive,
        mode: init?.mode || request.mode,
        redirect: init?.redirect || request.redirect,
        referrer: init?.referrer || request.referrer,
        referrerPolicy: init?.referrerPolicy || request.referrerPolicy,
        signal: init?.signal || request.signal,
      };

      const method = String(requestInit.method || request.method || 'GET').toUpperCase();
      if (method === 'GET' || method === 'HEAD') {
        delete requestInit.body;
      }

      return {
        input: new Request(adapterResult.url || request.url, requestInit),
        init: undefined,
        injectionApplied: true,
        injectionConfig: {
          injectionText: monitor.normalizeInjectionText(monitor.state.requestInjectionText),
          injectionMode: monitor.state.requestInjectionMode || 'system',
          requestMessagePath: adapterResult.requestMessagePath || '',
          requestMessagePreview: adapterResult.requestMessagePreview || '',
        },
      };
    }

    return {
      input: adapterResult.url || input,
      init: {
        ...(init || {}),
        headers: adapterResult.headers || init?.headers,
        body: adapterResult.bodyText,
      },
      injectionApplied: true,
      injectionConfig: {
        injectionText: monitor.normalizeInjectionText(monitor.state.requestInjectionText),
        injectionMode: monitor.state.requestInjectionMode || 'system',
        requestMessagePath: adapterResult.requestMessagePath || '',
        requestMessagePreview: adapterResult.requestMessagePreview || '',
      },
    };
  }

  // ─── 注入确认通知 ─────────────────────────────────────────────────────────────

  function emitInjectionApplied(injectionConfig) {
    const injectionText = String(injectionConfig?.injectionText || '').trim();
    if (!injectionText) return;

    monitor.emit({
      type: 'injection',
      requestInjectionText: injectionText,
      requestInjectionMode: injectionConfig?.injectionMode || 'system',
      requestMessagePath: String(injectionConfig?.requestMessagePath || '').trim(),
      requestMessagePreview:
        typeof injectionConfig?.requestMessagePreview === 'string'
          ? injectionConfig.requestMessagePreview
          : String(injectionConfig?.requestMessagePreview ?? ''),
    });
  }

  // ─── 响应观测判断 ─────────────────────────────────────────────────────────────

  function shouldObserveMonitorResponses() {
    return (
      monitor.state.isActive ||
      Boolean(monitor.normalizeInjectionText(monitor.state.requestInjectionText)) ||
      Boolean(String(monitor.state.adapterScript || '').trim())
    );
  }

  // ─── Fetch 快照构建 ───────────────────────────────────────────────────────────

  async function buildFetchSnapshot(input, init) {
    const request = input instanceof Request ? input : null;
    const method = String(init?.method || request?.method || 'GET').toUpperCase();
    const endpoint = monitor.toAbsoluteUrl(typeof input === 'string' ? input : request?.url);
    const headers = monitor.headersToObject(init?.headers || request?.headers);

    let requestPreview = '';
    if (init && Object.prototype.hasOwnProperty.call(init, 'body')) {
      requestPreview = monitor.serializeBody(init.body);
    } else if (request) {
      requestPreview = await readRequestBodyFromRequest(request);
    }

    return { method, endpoint, requestHeaders: headers, requestPreview };
  }

  // ─── 响应进度上报节流 ─────────────────────────────────────────────────────────

  function shouldReportFetchProgress(lastPreview, nextPreview, lastReportedAt, forceFinal = false) {
    const previous = String(lastPreview || '');
    const next = String(nextPreview || '');
    if (forceFinal && next !== previous) return true;
    if (!next || next === previous) return false;

    const lengthDelta = next.length - previous.length;
    if (lengthDelta >= FETCH_REPORT_MIN_DELTA) return true;
    if (Date.now() - Number(lastReportedAt || 0) >= FETCH_REPORT_THROTTLE_MS) return true;
    return /[\r\n]/.test(next.slice(previous.length));
  }

  // ─── 流式响应读取 ─────────────────────────────────────────────────────────────

  async function readResponsePreview(response, options: any = {}) {
    const {
      timeoutMs = monitor.RESPONSE_PREVIEW_TIMEOUT,
      onPreview,
    } = options;

    if (!response) {
      return {
        previewText: '',
        adapterText: '',
      };
    }

    if (!response.body || typeof response.body.getReader !== 'function') {
      try {
        const rawText = await response.text();
        const previewText = String(rawText || "");
        const adapterText = String(rawText || "");
        if (typeof onPreview === 'function') {
          onPreview(previewText, {
            done: true,
            final: true,
            adapterText,
          });
        }
        return {
          previewText,
          adapterText,
        };
      } catch (error) {
        return {
          previewText: '',
          adapterText: '',
        };
      }
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let preview = '';
    let adapterText = '';
    let previewBuffer = '';
    let adapterBuffer = '';
    let lastReportedPreview = '';
    let lastReportedAt = 0;
    let idleDeadline = Date.now() + timeoutMs;

    try {
      while (Date.now() < idleDeadline) {
        if (!shouldObserveMonitorResponses()) break;

        const remaining = Math.max(idleDeadline - Date.now(), 0);
        const result = await Promise.race([
          reader.read(),
          new Promise((resolve) => {
            setTimeout(() => resolve({ timeout: true, done: true }), remaining || 1);
          }),
        ]);

        if (!result || (result as any).timeout || (result as any).done) break;

        const decodedChunk = decoder.decode((result as any).value, { stream: true });
        previewBuffer = `${previewBuffer}${decodedChunk}`;
        adapterBuffer = `${adapterBuffer}${decodedChunk}`;
        preview = previewBuffer;
        adapterText = adapterBuffer;
        idleDeadline = Date.now() + timeoutMs;

        if (
          typeof onPreview === 'function' &&
          shouldReportFetchProgress(lastReportedPreview, preview, lastReportedAt)
        ) {
          lastReportedPreview = preview;
          lastReportedAt = Date.now();
          onPreview(preview, {
            done: false,
            final: false,
            adapterText,
          });
        }
      }
    } catch (error) {
      return {
        previewText: preview,
        adapterText,
      };
    } finally {
      const finalChunk = decoder.decode();
      if (finalChunk) {
        previewBuffer = `${previewBuffer}${finalChunk}`;
        adapterBuffer = `${adapterBuffer}${finalChunk}`;
        preview = previewBuffer;
        adapterText = adapterBuffer;
      }

      if (
        typeof onPreview === 'function' &&
        shouldReportFetchProgress(lastReportedPreview, preview, lastReportedAt, true)
      ) {
        onPreview(preview, {
          done: true,
          final: true,
          adapterText,
        });
      }

      try {
        reader.cancel();
      } catch (error) {
        // noop
      }
    }

    return {
      previewText: preview,
      adapterText,
    };
  }

  // ─── 响应是否值得读取 ─────────────────────────────────────────────────────────

  function shouldReadResponsePreview(snapshot, contentType) {
    if (/text\/event-stream|application\/x-ndjson|application\/stream\+json|application\/json-seq/i.test(contentType)) {
      return true;
    }
    if (/application\/json|text\//i.test(contentType) && shouldObserveMonitorResponses()) {
      return true;
    }
    if (/"stream"\s*:\s*true/i.test(snapshot.requestPreview || '')) return true;
    return false;
  }

  function 
shouldEmitCandidate(snapshot, contentType, responsePreview, streamReasons) {
    if (String(snapshot.method || '').toUpperCase() === 'OPTIONS') return false;
    if (streamReasons.length) return true;
    if (monitor.isRelevantEndpoint(snapshot.endpoint)) return true;
    if (snapshot.method !== 'GET' && snapshot.requestPreview) return true;
    if (responsePreview && /application\/json|text\//i.test(contentType)) return true;
    return Boolean(snapshot.endpoint);
  }

  // ─── Fetch 响应分析 ───────────────────────────────────────────────────────────

  async function analyzeFetch(input, init, responsePromise) {
    const snapshot = await buildFetchSnapshot(input, init);
    const responseBundle = await responsePromise;
    const response = responseBundle?.response || responseBundle;
    const previewResponse = responseBundle?.previewResponse || null;
    const responseContentType = response?.headers?.get('content-type') || '';
    const previewTimeoutMs =
      /text\/event-stream|application\/x-ndjson|application\/stream\+json|application\/json-seq/i.test(responseContentType)
        ? Math.max(Number(monitor.RESPONSE_PREVIEW_TIMEOUT) || 0, 30000)
        : monitor.RESPONSE_PREVIEW_TIMEOUT;
    let latestPreview = '';
    let lastEmittedPreview = '__cp_fetch_init__';
    let lastEmittedWasFinal = false;
    let bufferedMatchedContentPreview = '';
    let bufferedMatchedContentPath = '';

    function shouldPreferBufferedContent(currentText, bufferedText) {
      const current = String(currentText || '').trim();
      const buffered = String(bufferedText || '').trim();
      if (!buffered) return false;
      if (!current) return true;

      const codeModeBegin = String(monitor.state.protocol?.codeMode?.begin || '').trim();
      const currentHasCodeModeBegin = codeModeBegin ? current.includes(codeModeBegin) : false;
      const bufferedHasCodeModeBegin = codeModeBegin ? buffered.includes(codeModeBegin) : false;

      if (bufferedHasCodeModeBegin && !currentHasCodeModeBegin) return true;
      return buffered.length > current.length;
    }

    const emitFetchCandidate = async (
      responsePreview,
      responseFinal = false,
      responseTextOverride = '',
    ) => {
      if (responsePreview === lastEmittedPreview && responseFinal === lastEmittedWasFinal) return;

      const streamReasons = monitor.detectStreamReasons({
        endpoint: snapshot.endpoint,
        requestHeaders: snapshot.requestHeaders,
        requestPreview: snapshot.requestPreview,
        responseContentType,
        responsePreview,
        source: 'fetch',
      });

      if (!shouldObserveMonitorResponses()) return;
      if (!shouldEmitCandidate(snapshot, responseContentType, responsePreview, streamReasons)) return;

      lastEmittedPreview = responsePreview;
      lastEmittedWasFinal = responseFinal;

      const nextCandidate = await applyAdapterResponseTransform({
        source: 'fetch',
        method: snapshot.method,
        url: snapshot.endpoint,
        status: response.status,
        headers: snapshot.requestHeaders,
        requestText: snapshot.requestPreview,
        responseText: String(responseTextOverride || responsePreview || ''),
        responseContentType,
      }, {
        source: 'fetch',
        method: snapshot.method,
        endpoint: snapshot.endpoint,
        status: response.status,
        responseContentType,
        requestHeaders: snapshot.requestHeaders,
        requestPreview: snapshot.requestPreview,
        responsePreview,
        previewText: responsePreview || snapshot.requestPreview,
        streamReasons,
        responseFinal,
      });

      const candidateContentPreview = String(nextCandidate?.responseContentPreview || '').trim();
      if (nextCandidate?.matched === true && candidateContentPreview) {
        if (shouldPreferBufferedContent(bufferedMatchedContentPreview, candidateContentPreview)) {
          bufferedMatchedContentPreview = candidateContentPreview;
          bufferedMatchedContentPath = String(nextCandidate?.responseContentPath || '').trim();
        }
      }

      if (
        responseFinal &&
        shouldPreferBufferedContent(
          String(nextCandidate?.responseContentPreview || ''),
          bufferedMatchedContentPreview,
        )
      ) {
        nextCandidate.responseContentPreview = bufferedMatchedContentPreview;
        if (bufferedMatchedContentPath) {
          nextCandidate.responseContentPath = bufferedMatchedContentPath;
        }
      }

      monitor.emitResult(nextCandidate);
    };

    if (shouldReadResponsePreview(snapshot, responseContentType)) {
      try {
        const readableResponse = previewResponse || response.clone();
        const previewBundle = await readResponsePreview(readableResponse, {
          timeoutMs: previewTimeoutMs,
          onPreview(preview, meta) {
            latestPreview = preview;
        if (meta?.final) return;
        void emitFetchCandidate(
          preview,
          false,
          String(meta?.adapterText || preview || ''),
        );
      },
        });
        latestPreview = String(previewBundle?.previewText || '');
        const latestAdapterText = String(previewBundle?.adapterText || '');
        if (!shouldObserveMonitorResponses()) return;

        const streamReasons = monitor.detectStreamReasons({
          endpoint: snapshot.endpoint,
          requestHeaders: snapshot.requestHeaders,
          requestPreview: snapshot.requestPreview,
          responseContentType,
          responsePreview: latestPreview,
          source: 'fetch',
        });

        if (!shouldEmitCandidate(snapshot, responseContentType, latestPreview, streamReasons)) return;

        await emitFetchCandidate(latestPreview, true, latestAdapterText || latestPreview);
        return;
      } catch (error) {
        latestPreview = '';
      }
    }

    const streamReasons = monitor.detectStreamReasons({
      endpoint: snapshot.endpoint,
      requestHeaders: snapshot.requestHeaders,
      requestPreview: snapshot.requestPreview,
      responseContentType,
      responsePreview: latestPreview,
      source: 'fetch',
    });

    if (!shouldObserveMonitorResponses()) return;
    if (!shouldEmitCandidate(snapshot, responseContentType, latestPreview, streamReasons)) return;

    await emitFetchCandidate(latestPreview, true, latestPreview);
  }

  // ─── Monkey Patch: fetch ──────────────────────────────────────────────────────

  monitor.patchFetch = function patchFetch() {
    if (typeof window.fetch !== 'function') return;

    const nativeFetch = window.fetch;

    window.fetch = function (...args) {
      const fetchContext = this;

      return Promise.resolve()
        .then(() => applyInjectionToFetchArgs(args[0], args[1]))
        .then(({ input, init, injectionApplied, injectionConfig }) => {
          if (injectionApplied) {
            emitInjectionApplied(injectionConfig);
          }

          const responsePromise = nativeFetch.call(fetchContext, input, init);
          const monitorResponsePromise = Promise.resolve(responsePromise).then((response) => {
            let previewResponse = null;
            try {
              if (response && typeof response.clone === 'function' && !response.bodyUsed) {
                previewResponse = response.clone();
              }
            } catch (error) {
              previewResponse = null;
            }
            return { response, previewResponse };
          });

          if (shouldObserveMonitorResponses()) {
            analyzeFetch(input, init, monitorResponsePromise).catch(() => {
              // ignore monitor failures
            });
          }

          return responsePromise;
        });
    };
  };

  // ─── Monkey Patch: XHR ───────────────────────────────────────────────────────

  monitor.patchXHR = function patchXHR() {
    if (typeof window.XMLHttpRequest !== 'function') return;

    const nativeOpen = window.XMLHttpRequest.prototype.open;
    const nativeSend = window.XMLHttpRequest.prototype.send;
    const nativeSetRequestHeader = window.XMLHttpRequest.prototype.setRequestHeader;

    window.XMLHttpRequest.prototype.open = function (method, url, async?, user?, password?) {
      this.__chatPlusMonitor = {
        method: String(method || 'GET').toUpperCase(),
        endpoint: monitor.toAbsoluteUrl(url),
        requestHeaders: {},
        requestPreview: '',
        async: async !== false,
        listenersAttached: false,
        injectionApplied: false,
        requestInjectionText: '',
        requestInjectionMode: 'system',
        requestMessagePath: '',
        requestMessagePreview: '',
        reported: false,
        lastReportedPreview: '',
        lastReportedAt: 0,
        lastReportedReadyState: 0,
        bufferedMatchedContentPreview: '',
        bufferedMatchedContentPath: '',
      };

      return nativeOpen.call(this, method, url, async ?? true, user, password);
    };

    window.XMLHttpRequest.prototype.setRequestHeader = function (key, value) {
      if (this.__chatPlusMonitor) {
        this.__chatPlusMonitor.requestHeaders[String(key).toLowerCase()] = value;
      }
      return nativeSetRequestHeader.call(this, key, value);
    };

    window.XMLHttpRequest.prototype.send = function (body) {
      const tracker = this.__chatPlusMonitor;
      const xhr = this;

      function attachListenersOnce() {
        if (!tracker || tracker.listenersAttached) return;
        tracker.listenersAttached = true;

        xhr.addEventListener('readystatechange', () => {
          if (xhr.readyState >= 2) void maybeReport();
        });
        xhr.addEventListener('progress', () => {
          void maybeReport();
        });
        xhr.addEventListener('loadend', () => {
          void maybeReport();
        });
      }

      function shouldReportProgress(t, responsePreview) {
        if (!t.reported) return true;
        const nextPreview = String(responsePreview || '');
        if (xhr.readyState === 4 && t.lastReportedReadyState !== 4) return true;
        if (!nextPreview || nextPreview === t.lastReportedPreview) return false;
        const lengthDelta = nextPreview.length - String(t.lastReportedPreview || '').length;
        if (lengthDelta >= XHR_REPORT_MIN_DELTA) return true;
        if (Date.now() - Number(t.lastReportedAt || 0) >= XHR_REPORT_THROTTLE_MS) return true;
        return /[\r\n]/.test(nextPreview.slice(String(t.lastReportedPreview || '').length));
      }

      async function maybeReport() {
        const t = xhr.__chatPlusMonitor;
        if (!shouldObserveMonitorResponses() || !t) return;

        const responseContentType = xhr.getResponseHeader('content-type') || '';
        const responsePreview =
          typeof xhr.responseText === 'string'
            ? String(xhr.responseText)
            : '';
        const adapterResponseText =
          typeof xhr.responseText === 'string'
            ? String(xhr.responseText)
            : responsePreview;
        const streamReasons = monitor.detectStreamReasons({
          endpoint: t.endpoint,
          requestHeaders: t.requestHeaders,
          requestPreview: t.requestPreview,
          responseContentType,
          responsePreview,
          source: 'xhr',
        });

        if (!shouldEmitCandidate(t, responseContentType, responsePreview, streamReasons)) return;
        if (!shouldReportProgress(t, responsePreview)) return;

        t.reported = true;
        t.lastReportedPreview = responsePreview;
        t.lastReportedAt = Date.now();
        t.lastReportedReadyState = xhr.readyState;

        const nextCandidate = await applyAdapterResponseTransform({
          source: 'xhr',
          method: t.method,
          url: t.endpoint,
          status: xhr.status,
          headers: t.requestHeaders,
            requestText: t.requestPreview,
            responseText: adapterResponseText,
            responseContentType,
        }, {
          source: 'xhr',
          method: t.method,
          endpoint: t.endpoint,
          status: xhr.status,
          responseContentType,
          requestHeaders: t.requestHeaders,
          requestPreview: t.requestPreview,
          requestMessagePath: t.requestMessagePath || '',
          requestMessagePreview: t.requestMessagePreview || '',
          responsePreview,
          previewText: responsePreview || t.requestPreview,
          streamReasons,
          responseFinal: xhr.readyState === 4,
        });

        const candidateContentPreview = String(nextCandidate?.responseContentPreview || '').trim();
        if (nextCandidate?.matched === true && candidateContentPreview) {
          const currentBuffered = String(t.bufferedMatchedContentPreview || '').trim();
          const codeModeBegin = String(monitor.state.protocol?.codeMode?.begin || '').trim();
          const currentHasCodeModeBegin = codeModeBegin
            ? candidateContentPreview.includes(codeModeBegin)
            : false;
          const bufferedHasCodeModeBegin = codeModeBegin
            ? currentBuffered.includes(codeModeBegin)
            : false;

          if (
            !currentBuffered ||
            (currentHasCodeModeBegin && !bufferedHasCodeModeBegin) ||
            candidateContentPreview.length > currentBuffered.length
          ) {
            t.bufferedMatchedContentPreview = candidateContentPreview;
            t.bufferedMatchedContentPath = String(nextCandidate?.responseContentPath || '').trim();
          }
        }

        if (xhr.readyState === 4) {
          const bufferedContent = String(t.bufferedMatchedContentPreview || '').trim();
          const currentContent = String(nextCandidate?.responseContentPreview || '').trim();
          const codeModeBegin = String(monitor.state.protocol?.codeMode?.begin || '').trim();
          const currentHasCodeModeBegin = codeModeBegin ? currentContent.includes(codeModeBegin) : false;
          const bufferedHasCodeModeBegin = codeModeBegin ? bufferedContent.includes(codeModeBegin) : false;

          if (
            bufferedContent &&
            (
              !currentContent ||
              (bufferedHasCodeModeBegin && !currentHasCodeModeBegin) ||
              bufferedContent.length > currentContent.length
            )
          ) {
            nextCandidate.responseContentPreview = bufferedContent;
            if (t.bufferedMatchedContentPath) {
              nextCandidate.responseContentPath = String(t.bufferedMatchedContentPath || '').trim();
            }
          }
        }

        monitor.emitResult(nextCandidate);
      }

      attachListenersOnce();

      const sendWithBody = (nextBody) => {
        if (tracker) {
          tracker.requestPreview = monitor.serializeBody(nextBody);
        }
        return nativeSend.call(xhr, nextBody);
      };

      const hasAdapterScript = Boolean(String(monitor.state.adapterScript || '').trim());
      if (!tracker || !hasAdapterScript || tracker.async === false) {
        return sendWithBody(body);
      }

      void (async () => {
        let nextBody = body;

        try {
          const adapterResult = await applyAdapterRequestTransform({
            url: tracker.endpoint || '',
            method: tracker.method || 'GET',
            headers: tracker.requestHeaders || {},
            bodyText: typeof body === 'string' ? body : '',
            injectionText: monitor.normalizeInjectionText(monitor.state.requestInjectionText),
            injectionMode: monitor.state.requestInjectionMode || 'system',
          });

          if (adapterResult.applied) {
            if (typeof body === 'string') {
              nextBody = adapterResult.bodyText;
            }

            tracker.injectionApplied = true;
            tracker.requestInjectionText = monitor.normalizeInjectionText(
              monitor.state.requestInjectionText,
            );
            tracker.requestInjectionMode = monitor.state.requestInjectionMode || 'system';
            tracker.requestMessagePath = adapterResult.requestMessagePath || '';
            tracker.requestMessagePreview = adapterResult.requestMessagePreview || '';

            if (adapterResult.headers && typeof adapterResult.headers === 'object') {
              Object.entries(adapterResult.headers).forEach(([key, value]) => {
                if (!key) return;
                try {
                  nativeSetRequestHeader.call(xhr, key, value as any);
                } catch (error) {
                  // ignore
                }
              });
            }
          }

          if (tracker.injectionApplied && tracker.requestInjectionText) {
            emitInjectionApplied({
              injectionText: tracker.requestInjectionText,
              injectionMode: tracker.requestInjectionMode || 'system',
            });
          }
        } catch (error) {
          // Ignore adapter failures and fall back to the original payload.
        }

        sendWithBody(nextBody);
      })();

      return;
    };
  };
})();
