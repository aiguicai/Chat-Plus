export function getExtensionManifest() {
  try {
    return chrome.runtime.getManifest();
  } catch {
    return null;
  }
}

export function getExtensionVersion() {
  return getExtensionManifest()?.version || "0.0.0";
}

export function getExtensionName() {
  return getExtensionManifest()?.name || "Chat Plus";
}

export function getExtensionTargetLabel() {
  const manifest = getExtensionManifest() as
    | (chrome.runtime.Manifest & {
        browser_specific_settings?: { gecko?: unknown };
      })
    | null;

  return manifest?.browser_specific_settings?.gecko ? "Firefox build" : "Chromium build";
}
