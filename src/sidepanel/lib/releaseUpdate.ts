const CHAT_PLUS_RELEASES_API_URL =
  "https://api.github.com/repos/aiguicai/Chat-Plus/releases/latest";

export const CHAT_PLUS_RELEASES_PAGE_URL =
  "https://github.com/aiguicai/Chat-Plus/releases";

export type ReleaseUpdateInfo = {
  version: string;
  name: string;
  pageUrl: string;
  publishedAt: string;
  isNewer: boolean;
};

type GitHubLatestRelease = {
  tag_name?: string;
  name?: string | null;
  html_url?: string;
  published_at?: string;
};

function normalizeVersion(version: string) {
  return String(version || "")
    .trim()
    .replace(/^v/i, "")
    .split(/[+-]/)[0];
}

function compareVersions(a: string, b: string) {
  const left = normalizeVersion(a).split(".").map((part) => Number(part) || 0);
  const right = normalizeVersion(b).split(".").map((part) => Number(part) || 0);
  const length = Math.max(left.length, right.length, 3);

  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index] || 0;
    const rightPart = right[index] || 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }

  return 0;
}

export async function fetchLatestReleaseUpdate(
  currentVersion: string,
): Promise<ReleaseUpdateInfo> {
  const response = await fetch(CHAT_PLUS_RELEASES_API_URL, {
    headers: {
      Accept: "application/vnd.github+json",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub Releases 请求失败：${response.status}`);
  }

  const release = (await response.json()) as GitHubLatestRelease;
  const latestVersion = normalizeVersion(release.tag_name || "");

  if (!latestVersion) {
    throw new Error("GitHub Releases 未返回有效版本号");
  }

  return {
    version: latestVersion,
    name: release.name || `v${latestVersion}`,
    pageUrl: release.html_url || CHAT_PLUS_RELEASES_PAGE_URL,
    publishedAt: release.published_at || "",
    isNewer: compareVersions(latestVersion, currentVersion) > 0,
  };
}

export function openReleasePage(url = CHAT_PLUS_RELEASES_PAGE_URL) {
  if (typeof chrome !== "undefined" && chrome.tabs?.create) {
    void chrome.tabs.create({ url });
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}
