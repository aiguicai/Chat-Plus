(function () {
  'use strict';

  if (location.protocol === 'chrome-extension:' || location.protocol === 'moz-extension:') {
    return;
  }

  if (window.__chatPlusPageMonitorInstalled) return;
  window.__chatPlusPageMonitorInstalled = true;

  const monitor = window.ChatPlusPageMonitor;

  document.addEventListener(monitor.CONTROL_EVENT, (event) => {
    const customEvent = event as CustomEvent<string>;
    const detail = monitor.parseJsonDetail(customEvent.detail);
    if (!detail) return;

    monitor.state.isEnabled = detail.enabled !== false;
    monitor.state.isActive = monitor.state.isEnabled && Boolean(detail.active);
    monitor.state.requestInjectionText = monitor.normalizeInjectionText(detail.requestInjectionText);
    monitor.state.requestInjectionMode =
      String(detail.requestInjectionMode || '').toLowerCase() === 'raw' ? 'raw' : 'system';
    monitor.state.protocol =
      detail.protocol && typeof detail.protocol === 'object'
        ? detail.protocol
        : monitor.state.protocol;
    monitor.state.adapterScript = String(detail.adapterScript || '').trim();

    monitor.emit({
      type: 'state',
      active: monitor.state.isActive
    });
  });

  monitor.patchFetch();
  monitor.patchXHR();
  monitor.patchEventSource();
  monitor.patchWebSocket();

  monitor.emit({
    type: 'ready'
  });
})();
