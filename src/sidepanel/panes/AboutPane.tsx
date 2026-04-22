import {
  getExtensionName,
  getExtensionTargetLabel,
  getExtensionVersion,
} from "../../shared/extensionMeta";
import { GithubIcon, PlaneIcon, UsersIcon, VideoIcon } from "../components/icons";

const projectHighlights = [
  "适配器优先：每个站点通过独立脚本接入，扩展核心专注注入、协议渲染、工具执行与续聊。",
  "原生 MCP：从远程 MCP 端点发现工具，并把工具暴露成模型可编排的运行时能力。",
  "按标签页独立编排：每个页面都能分别启用扩展、服务器、工具和系统提示词。",
  "沙箱执行：适配器与 Code Mode 运行在隔离环境，尽量避免页面脚本直接污染核心运行时。",
];

export function AboutPane({ active }: { active: boolean }) {
  const extensionName = getExtensionName();
  const version = getExtensionVersion();
  const targetLabel = getExtensionTargetLabel();

  return (
    <div className={`cp-pane${active ? " active" : ""}`}>
      <div className="cp-about-shell">
        <article className="cp-about-doc" aria-label={`${extensionName} 项目说明`}>
          <header className="cp-about-doc-header">
            <h1 className="cp-about-doc-title">{extensionName}</h1>
            <p className="cp-about-doc-lead">
              这个项目的出发点，是希望让普通的 AI 聊天界面不再停留在单纯的消息收发层面。
              现在 MCP 工具和 Skills 发展很快，但大多数用户日常接触到的网页聊天页面，
              还无法方便地体验和测试这些能力。
            </p>
            <p className="cp-about-doc-meta">
              <code>{`v${version}`}</code>
              <span className="cp-about-doc-meta-sep">/</span>
              <code>GPL-3.0-or-later</code>
              <span className="cp-about-doc-meta-sep">/</span>
              <code>{targetLabel}</code>
            </p>
          </header>

          <section className="cp-about-doc-section">
            <h2>项目简介</h2>
            <p>
              Chat Plus 是一个开源浏览器扩展，主要用于把网页聊天 UI 接入 MCP
              工具和 Skills 生态。它并不依赖官方托管后端，而是直接连接你自己配置的 MCP 端点，
              并在当前会话里完成工具发现、执行和结果续聊。
            </p>
            <p>
              这个项目采用适配器驱动设计。不同站点的差异由单独的适配脚本处理，扩展核心则负责
              协议、运行时、工具桥接和侧边栏控制，因此更容易扩展、调试和维护。
            </p>
          </section>

          <section className="cp-about-doc-section">
            <h2>MCP-Gateway</h2>
            <p>
              MCP-Gateway 也是我开发的配套项目，主要用来和 Chat Plus 一起使用。
              它的作用是把电脑本地以 <code>stdio</code> 方式运行的 MCP，
              转成浏览器可以访问的 <code>HTTP</code> 或 <code>SSE</code> 网络协议。
            </p>
            <p>
              这是因为 Chat Plus 运行在浏览器侧，只能直接连接网络协议端点，
              不能直接访问本机里的本地 MCP 进程。通过 MCP-Gateway，
              原本只在本地启用的 MCP 也能被浏览器里的 Chat Plus 调用，
              从而把本地能力接到网页聊天界面里。
            </p>
          </section>

          <section className="cp-about-doc-section">
            <h2>主要特点</h2>
            <ul className="cp-about-doc-list">
              {projectHighlights.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="cp-about-doc-section">
            <h2>项目地址</h2>
            <div className="cp-about-doc-contact-list">
              <div className="cp-about-doc-contact-item">
                <span className="cp-about-doc-contact-icon" aria-hidden="true">
                  <GithubIcon />
                </span>
                <a
                  className="cp-about-doc-link"
                  href="https://github.com/aiguicai/Chat-Plus"
                  target="_blank"
                  rel="noreferrer"
                >
                  https://github.com/aiguicai/Chat-Plus
                </a>
              </div>
              <div className="cp-about-doc-contact-item">
                <span className="cp-about-doc-contact-icon" aria-hidden="true">
                  <GithubIcon />
                </span>
                <a
                  className="cp-about-doc-link"
                  href="https://github.com/aiguicai/MCP-Gateway"
                  target="_blank"
                  rel="noreferrer"
                >
                  https://github.com/aiguicai/MCP-Gateway
                </a>
              </div>
            </div>
          </section>

          <section className="cp-about-doc-section">
            <h2>交流社区</h2>
            <div className="cp-about-doc-contact-list">
              <div className="cp-about-doc-contact-item">
                <span className="cp-about-doc-contact-icon" aria-hidden="true">
                  <UsersIcon />
                </span>
                <div className="cp-about-doc-contact-content">
                  <span className="cp-about-doc-contact-label">QQ 群：</span>
                  <code>1090461840</code>
                </div>
              </div>
              <div className="cp-about-doc-contact-item">
                <span className="cp-about-doc-contact-icon" aria-hidden="true">
                  <PlaneIcon />
                </span>
                <div className="cp-about-doc-contact-content">
                  <span className="cp-about-doc-contact-label">Telegram：</span>
                  <a
                    className="cp-about-doc-link"
                    href="https://t.me/+vq8WByYtPoQ1MjA1"
                    target="_blank"
                    rel="noreferrer"
                  >
                    https://t.me/+vq8WByYtPoQ1MjA1
                  </a>
                </div>
              </div>
              <div className="cp-about-doc-contact-item">
                <span className="cp-about-doc-contact-icon" aria-hidden="true">
                  <VideoIcon />
                </span>
                <div className="cp-about-doc-contact-content">
                  <span className="cp-about-doc-contact-label">Bilibili：</span>
                  <a
                    className="cp-about-doc-link"
                    href="https://space.bilibili.com/228928896?spm_id_from=333.1007.0.0"
                    target="_blank"
                    rel="noreferrer"
                  >
                    https://space.bilibili.com/228928896?spm_id_from=333.1007.0.0
                  </a>
                </div>
              </div>
            </div>
          </section>
        </article>
      </div>
    </div>
  );
}
