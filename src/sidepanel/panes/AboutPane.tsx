import {
  getExtensionManifest,
  getExtensionName,
  getExtensionTargetLabel,
  getExtensionVersion,
} from "../../shared/extensionMeta";

const featureCards = [
  {
    title: "Adapter-first",
    description:
      "站点差异收敛在适配脚本里，扩展核心只负责注入、协议渲染、工具执行和续聊。",
  },
  {
    title: "MCP-native",
    description:
      "工具通过 MCP 发现与调用，支持按标签页启用、组合和继续同一段会话。",
  },
  {
    title: "Sandboxed",
    description:
      "协议处理和 Code Mode 在隔离环境运行，避免把不稳定页面逻辑直接绑死到核心运行时。",
  },
];

const projectNotes = [
  "项目本身不依赖官方托管后端；MCP 请求会直接连接到你配置的端点。",
  "每个标签页都可以独立启用或暂停编排，避免把一套工具暴露给所有站点。",
  "发布包会提供可直接解压加载的浏览器扩展目录，而不是源码仓库快照。",
];

export function AboutPane({ active }: { active: boolean }) {
  const manifest = getExtensionManifest();
  const extensionName = getExtensionName();
  const version = getExtensionVersion();
  const targetLabel = getExtensionTargetLabel();
  const permissions = Array.from(
    new Set([
      ...(Array.isArray(manifest?.permissions) ? manifest.permissions : []),
      ...(Array.isArray(manifest?.host_permissions) ? manifest.host_permissions : []),
    ]),
  );

  return (
    <div className={`cp-pane${active ? " active" : ""}`}>
      <div className="cp-about-shell">
        <section className="cp-card cp-about-hero">
          <div className="cp-about-kicker">Open-source Browser Extension</div>
          <div className="cp-about-name">{extensionName}</div>
          <div className="cp-about-desc">
            面向 AI 聊天网站的 MCP 编排侧边栏。它通过站点适配脚本接管注入、协议渲染、
            工具执行与续聊，把复杂工作流放进受控扩展运行时，而不是散落在页面脚本里。
          </div>
          <div className="cp-about-badges">
            <span className="cp-about-badge">{`v${version}`}</span>
            <span className="cp-about-badge">GPL-3.0-or-later</span>
            <span className="cp-about-badge">{targetLabel}</span>
          </div>
        </section>

        <section className="cp-about-grid">
          {featureCards.map((card) => (
            <article key={card.title} className="cp-card cp-about-feature">
              <div className="cp-about-feature-title">{card.title}</div>
              <div className="cp-about-feature-desc">{card.description}</div>
            </article>
          ))}
        </section>

        <section className="cp-card cp-about-section">
          <div className="cp-about-section-title">Open-source posture</div>
          <div className="cp-about-list">
            {projectNotes.map((item) => (
              <div key={item} className="cp-about-list-item">
                {item}
              </div>
            ))}
          </div>
        </section>

        <section className="cp-card cp-about-section">
          <div className="cp-about-section-title">Release package</div>
          <div className="cp-about-section-desc">
            GitHub Release 里的 ZIP 只包含一个顶层文件夹。先解压 ZIP，再把里面那个文件夹
            作为“已解压的扩展程序”加载到浏览器。
          </div>
        </section>

        <section className="cp-card cp-about-section">
          <div className="cp-about-section-title">Permissions</div>
          <div className="cp-about-permissions">
            {permissions.map((permission) => (
              <span key={permission} className="cp-about-permission">
                {permission}
              </span>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
