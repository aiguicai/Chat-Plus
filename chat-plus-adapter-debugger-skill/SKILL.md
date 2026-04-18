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
9. 输出抓取必须基于真实协议 / 真实响应，不接受用消息 DOM 反向抄正文代替 `extractResponse`
10. 输入实现允许两条路：
   - 优先请求层协议注入
   - 协议层因加密、签名、opaque body 或其他原因无法稳定改写时，退回 DOM 发送

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
  输入注入优先走协议层
  请求可稳定改写时，必须用 `ctx.helpers.buildInjectedText(...)`
  请求不可稳定改写时，必须保留 hook 并 `return null`

- `extractResponse(ctx)`
  负责从真实响应里提取 AI 正文
  输出抓取必须走真实协议 / 真实响应
  不要从页面现成消息 DOM 倒推正文，当成响应提取
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

## chrome-cdp 授权阻塞处理

首次连接某个标签页进行 CDP 调试时，Chrome 可能会弹出“Allow debugging / 允许调试”之类的授权提示。

如果 AI 发起 `chrome-cdp` 调试后，用户没有及时点击允许，导致：

- `list` / `snap` / `eval` / 其他调试命令卡住、超时、失败
- 无法进入目标标签页的调试会话
- 明显判断是授权弹窗未确认

则必须：

1. 立即停止继续调试，不要反复重试
2. 不要改走其他绕过方式
3. 直接告知用户去浏览器里点击“允许”
4. 等用户明确回复“可以了”或“已经点了允许”后，再重新发起调试请求

硬要求：

- 不要在用户未确认前持续重试 CDP 请求
- 不要把这种情况误判成页面结构问题或站点兼容问题
- 不要在用户未授权完成时继续后续分析

## 模式差异处理

有些站点存在会明显改变请求结构、响应结构或消息 DOM 的模式开关，例如：

- 思考 / 深度思考
- 联网搜索 / 智能搜索
- 专家模式 / 快速模式
- 其他会影响消息渲染或发送链的开关

遇到这种情况时，必须先确认用户实际使用的是哪种模式，再决定抓样本和写 adapter。

硬要求：

- 不要默认把“无思考”样本当成“有思考”也可用
- 不要默认把“无搜索”样本当成“有搜索”也可用
- 不要只因为基础聊天能工作，就假设带模式开关时 DOM 结构不变

推荐流程：

1. 先观察当前页面这些开关是否存在、是否已开启
2. 如果这些模式可能影响结构，优先确认用户平时是否会开启它们
3. 如果用户会使用这些模式，优先让用户按真实使用方式开启后再抓样本
4. 如果不确定，先提醒用户这类模式会影响适配结果，再让用户确认是否需要覆盖该模式

默认策略：

- 如果用户明确会使用思考模式，就优先在思考模式开启时调试
- 如果用户明确会使用搜索模式，就优先在搜索模式开启时调试
- 如果用户会同时使用多种模式，优先按“最复杂、最接近真实使用”的组合抓样本
- 如果用户不使用这些模式，可以按当前关闭状态调试

与用户沟通时，优先用简短直白的话说明：

- “这个站点的思考/搜索模式会改 DOM 和响应结构。”
- “如果你平时会开它，请先按真实使用方式打开，我再继续抓样本。”

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
- 如果请求层不能稳定改写，是否应改为 DOM 发送链兜底

### 响应侧

- AI 正文在哪个字段
- 是否是 SSE / EventSource / WebSocket / 其他流式格式
- 协议块是混在正文里，还是单独字段
- 是否存在 answer / thinking / summary 多阶段
- 思考 / 搜索模式开启后，响应事件格式是否发生变化
- `codeMode` begin/end 是否能完整保留
- 输出是否能直接从真实响应事件 / 响应体提取，而不是依赖页面已渲染 DOM

### DOM 侧

- 用户消息容器
- AI 消息容器
- 思考区块 / 搜索区块 / 引用区块 是否插入到 assistant turn 内部
- 输入框
- 发送按钮，或 Enter 发送目标
- 输入框赋值后是否需要 `input` / `change`

## 生成脚本时的强制要求

### transformRequest

- 请求可改时：
  - 这是输入侧的优先方案
  - 用 `ctx.helpers.buildInjectedText(...)`
  - 返回 `applied / bodyText / requestMessagePath / requestMessagePreview`
- 请求不可改时：
  - 常见原因包括签名、加密、protobuf/二进制、opaque body、不可稳定定位消息字段
  - 保留 hook
  - 直接 `return null`
  - 后续输入改走 DOM 发送链，不要硬改协议

### extractResponse

- 默认返回完整提取文本
- 只能基于真实协议 / 真实响应提取
- 返回 `responseContentPreview`
- 如果是 SSE / 流式响应，先按真实事件格式重组，再提取正文
- 不要把协议块截断
- 不要把页面消息气泡的 `innerText` / `textContent` 当作主提取方案

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

输入侧策略说明：

- 优先协议注入
- 协议注入不可稳定实现时，才退回这个 DOM 发送方案
- 不要明明能稳定改请求，还默认只做 DOM 发送

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
- [ ] 输入侧已按“优先协议注入，失败再退 DOM 发送”判断
- [ ] `extractResponse` 返回 `responseContentPreview`
- [ ] 输出正文来自真实协议 / 真实响应，不是页面 DOM 抄取
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
   - 输入走协议注入还是 DOM 发送
   - 如果没走协议注入，为什么不能稳定改协议
   - 响应是从哪个真实协议字段 / 事件提取
   - DOM 选择器
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
- 不要把输出抓取写成“从聊天气泡 DOM 读文本”
- 不要在协议可稳定改写时，直接跳过协议注入只做 DOM 发送

## 默认结论规则

- 如果一个脚本没用 `ctx.helpers.ui.decorateProtocolBubbles(...)`，就判定不符合新框架
- 如果一个脚本没用 `ctx.helpers.plans.dom(...)`，就判定不符合新框架
- 如果一个脚本缺 `meta`，就判定不符合新框架
- 如果一个脚本还带旧卡片函数，就判定需要重写
- 如果一个脚本的输出正文依赖页面消息 DOM 抓取，而不是协议 / 响应提取，就判定不符合框架预期
- 如果请求不可改写，不是失败；只要 `transformRequest` 明确 `return null` 且 `continueConversation` 可用，就算符合框架
