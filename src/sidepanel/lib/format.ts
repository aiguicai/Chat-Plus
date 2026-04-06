export const formatUrlHost = (url: string) => {
  try {
    return new URL(url).hostname || "";
  } catch {
    return "";
  }
};

export const isSupportedUrl = (url: string) => /^https?:/i.test(String(url || ""));

export const formatRelative = (ts?: number | null) =>
  !ts
    ? ""
    : Date.now() - ts < 60000
      ? "刚刚"
      : Date.now() - ts < 3600000
        ? `${Math.max(1, Math.round((Date.now() - ts) / 60000))} 分钟前`
        : `${Math.max(1, Math.round((Date.now() - ts) / 3600000))} 小时前`;

export const getErrorMessage = (error: any) =>
  String(error?.message || error || "操作失败");

export const normalizeMessageError = (error: any) =>
  String(error?.message || error || "").includes("Receiving end does not exist") ||
  String(error?.message || error || "").includes(
    "The message port closed before a response was received",
  )
    ? "当前页面与扩展的连接已断开。刷新页面后再试。"
    : String(error?.message || error || "页面通信失败");
