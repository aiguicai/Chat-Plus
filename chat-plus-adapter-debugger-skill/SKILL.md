---
name: chat-plus-adapter-debugger
description: 为 Chat Plus 新框架编写、修复、审查站点适配脚本。用于这些场景：根据真实请求/响应/DOM 样本生成 adapter；检查现有脚本是否符合新框架硬规则；定位 transformRequest / extractResponse / decorateBubbles / continueConversation 哪一环写错；在用户明确允许调试已打开的 Chrome 页面后，配合 chrome-cdp 观察网络、DOM 和发送链，产出可直接粘贴的 site adapter。
---

# Chat Plus Adapter Debugger

## 目标

产出或修复一段可直接粘贴到 Chat Plus 的站点适配脚本，并满足新框架硬规则：

1. 最外层必须 `return { ... }`
2. 必须包含 `meta`
3. 必须包含四个 hook：
   - `transformRequest`
   - `extractResponse`
   - `decorateBubbles`
   - `continueConversation`
4. `decorateBubbles` 必须使用 `ctx.helpers.ui.decorateProtocolBubbles(...)`
5. `continueConversation` 必须使用 `ctx.helpers.plans.dom(...)`
6. `continueConversation` 必须使用 `ctx.continuationText`
7. `extractResponse` 必须返回 `responseContentPreview`
8. `transformRequest` 要么使用 `ctx.helpers.buildInjectedText(...)` 改写请求，要么明确 `return null`

## 硬规则

### 1. 只接受新框架写法

- 不要接受手写 `renderProtocolCard`、`getProtocolCardTheme`、`detectToolResultTone` 这类旧 UI 辅助函数
- 不要接受旧版“自己拼 details 卡片”的 `decorateBubbles`
- 不要接受 `continueConversation` 自己 `click()` / `dispatchEvent()` / `setTimeout()`
- 不要接受硬编码 `[CHAT_PLUS_...]` 协议标记
- 不要接受缺 `meta`、缺 `adapterName`、缺 `capabilities`

### 2. 四个 hook 的职责不能变

- `transformRequest(ctx)`
  负责请求层注入
  请求可稳定改写时，必须用 `ctx.helpers.buildInjectedText(...)`
  请求不可稳定改写时，必须保留 hook 并 `return null`

- `extractResponse(ctx)`
  负责从真实响应里提取 AI 正文
  必须保留协议块，不要把 `toolCall` / `toolResult` / `codeMode` 过滤掉
  必须返回 `responseContentPreview`
  不要随意 `slice(...)`

- `decorateBubbles(ctx)`
  负责隐藏用户注入块
  负责把可见协议块变成统一卡片
  负责保留协议块之外的普通文本
  必须直接走 `ctx.helpers.ui.decorateProtocolBubbles(...)`

- `continueConversation(ctx)`
  负责返回 DOM 发送方案
  必须直接走 `ctx.helpers.plans.dom(...)`
  必须使用 `ctx.continuationText`
  不能自己执行真实 DOM 副作用

### 3. 协议块语义

- `toolCall` 默认只展示，不等于自动执行
- 真正可自动执行 / 手动执行的是 `codeMode`
- `codeMode` 卡片的手动运行按钮、卡片容器、源码节点，统一由平台 helper 负责，不让站点脚本重复造轮子

## 何时使用 chrome-cdp

在任何准备使用 `chrome-cdp` 之前，先检查当前环境里是否已经安装该 skill。

如果当前环境没有安装 `chrome-cdp` skill：

- 不要继续页面调试
- 不要改走“让用户自己开 DevTools 自己查”的替代流程
- 直接回复用户先安装：`https://github.com/pasky/chrome-cdp-skill`
- 等用户装好后再继续

只有在用户明确允许你调试已经打开的 Chrome 页面后，才使用 `chrome-cdp`。

适用场景：

- 需要直接看真实 Network 请求体和响应体
- 需要确认输入框、发送按钮、DOM 结构
- 需要验证真实发送链是否能被插件触发

如果用户没有明确同意调试页面，就不要使用 `chrome-cdp`。

## 调试分工

使用 Chrome 页面调试时，固定按这个节奏推进：

1. AI 先准备好调试环境
   - 找到目标标签页
   - 准备观察 Network / DOM / 输入框 / 发送按钮
   - 告诉用户现在只需要手动发一条消息
2. 用户回页面手动发送一条真实消息
3. 用户明确回复：`发好了`
4. AI 再继续分析这条新请求、新响应和新 DOM

硬要求：

- 不要代用户发送首条消息
- 不要在用户说 `发好了` 前假设请求已经产生
- 不要把“让用户自己开 DevTools 自己找请求”当默认流程；如果已获许可，优先由 AI 用 `chrome-cdp` 直接看

## 工作流程

### 模式 A：生成或修复 adapter

按下面顺序工作：

1. 确认目标站点 URL
2. 拿到真实请求样本
3. 拿到真实响应样本
4. 如果是流式响应，拿到完整流式样本
5. 拿到用户消息、AI 消息、输入框、发送按钮的 DOM 信息
6. 先判断 `transformRequest` 能不能稳定改写
7. 再判断 `extractResponse` 怎么提取正文和协议块
8. 再给出 `decorateBubbles`
9. 最后给出 `continueConversation`
10. 自检是否符合全部硬规则

如果样本不足，先指出缺什么，不要装作信息足够。

### 模式 B：审查现有 adapter

不要只看四个函数在不在。

必须逐项检查：

1. `meta` 是否完整
2. `transformRequest` 是否使用 `ctx.helpers.buildInjectedText(...)` 或明确 `return null`
3. `extractResponse` 是否返回 `responseContentPreview`
4. `decorateBubbles` 是否直接使用 `ctx.helpers.ui.decorateProtocolBubbles(...)`
5. `continueConversation` 是否直接使用 `ctx.helpers.plans.dom(...)`
6. `continueConversation` 是否使用 `ctx.continuationText`
7. 是否还残留旧卡片函数或协议硬编码

输出顺序固定：

1. findings
2. 证据不足 / 假设
3. 总评

## 抓样本时必须确认的内容

### 请求侧

- 用户真实输入在哪个字段
- 如果是消息数组，最后一条 user 消息怎么定位
- 请求体是不是 JSON
- 是否有签名、加密、opaque body，导致请求层不能稳定改写

### 响应侧

- AI 正文在哪个字段
- 是否是 SSE / EventSource / WebSocket / 其他流式格式
- 协议块是混在正文里，还是单独字段
- 是否存在 answer / thinking / summary 多阶段
- `codeMode` begin/end 是否能完整保留

### DOM 侧

- 用户消息容器
- AI 消息容器
- 输入框
- 发送按钮，或 Enter 发送目标
- 输入框赋值后是否需要 `input` / `change`

## 生成脚本时的强制要求

### transformRequest

- 请求可改时：
  - 用 `ctx.helpers.buildInjectedText(...)`
  - 返回 `applied / bodyText / requestMessagePath / requestMessagePreview`
- 请求不可改时：
  - 保留 hook
  - 直接 `return null`

### extractResponse

- 默认返回完整提取文本
- 返回 `responseContentPreview`
- 如果是 SSE / 流式响应，先按真实事件格式重组，再提取正文
- 不要把协议块截断

### decorateBubbles

只能写成这种方向：

```js
decorateBubbles(ctx) {
  return ctx.helpers.ui.decorateProtocolBubbles({
    root: ctx.root || document,
    protocol: ctx.protocol,
    userSelectors: [...],
    assistantSelectors: [...],
  });
}
```

允许传：

- `normalizeUserText`
- `normalizeAssistantText`
- `beforeRenderUserNode`
- `beforeRenderAssistantNode`

但不要自己重写整套卡片系统。

### continueConversation

只能写成这种方向：

```js
continueConversation(ctx) {
  return ctx.helpers.plans.dom({
    root: ctx.root,
    composerText: ctx.continuationText,
    input: {
      selectors: [...],
      kind: "textarea",
      dispatchEvents: ["input", "change"],
    },
    send: {
      mode: "click",
      selectors: [...],
      waitForEnabled: true,
      maxWaitMs: 2000,
    },
  });
}
```

禁止：

- `btn.click()`
- `dispatchEvent(...)`
- `setTimeout(...)`
- `return { dispatched: true }`
- 不使用 `ctx.continuationText`

## 自检清单

输出脚本前必须自己检查：

- [ ] 最外层是 `return { ... }`
- [ ] 有 `meta`
- [ ] `meta` 有 `contractVersion`
- [ ] `meta` 有 `adapterName`
- [ ] `meta` 有 `capabilities`
- [ ] 四个 hook 全部存在
- [ ] `transformRequest` 不是乱改请求
- [ ] `extractResponse` 返回 `responseContentPreview`
- [ ] `decorateBubbles` 直接使用平台 helper
- [ ] `continueConversation` 直接使用平台 helper
- [ ] `continueConversation` 使用 `ctx.continuationText`
- [ ] 没有旧卡片函数
- [ ] 没有硬编码 `[CHAT_PLUS_...]`

## 输出纪律

### 生成 / 修复 adapter 时

最终先给：

1. 完整 JS 脚本
2. 极简说明
   - 请求注入位置
   - 响应提取位置
   - DOM 选择器
   - 请求层是否可改
3. 风险点

### review 时

最终先给 findings，不要先说“整体不错”。

## 禁止做法

- 不要输出伪代码
- 不要把旧框架写法说成“也可以”
- 不要只因为四个函数都在，就说脚本合格
- 不要凭站点名猜字段和选择器
- 不要在信息不足时拍脑袋生成高置信度脚本
- 不要把 `decorateBubbles` 降级成纯样式函数
- 不要把 `continueConversation` 写成真实 DOM 执行器

## 默认结论规则

- 如果一个脚本没用 `ctx.helpers.ui.decorateProtocolBubbles(...)`，就判定不符合新框架
- 如果一个脚本没用 `ctx.helpers.plans.dom(...)`，就判定不符合新框架
- 如果一个脚本缺 `meta`，就判定不符合新框架
- 如果一个脚本还带旧卡片函数，就判定需要重写
- 如果请求不可改写，不是失败；只要 `transformRequest` 明确 `return null` 且 `continueConversation` 可用，就算符合框架
