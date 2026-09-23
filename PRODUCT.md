# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- 主要访客：招聘方（HR / 技术面试官）与潜在合作者。他们在手机或电脑上、中国大陆网络环境直接访问站点（无需 VPN），任务：快速判断陆耀威是否符合预期，并决定是否联系；站点以中文呈现。
- 第二用户：陆耀威本人（管理端 `/admin`），维护六类内容与 AI 智能体配置。

## Product Purpose

把「陆耀威」蒸馏成一个网站：访客第一屏即与 AI 分身对话（AI-first），可浏览公开内容与两大旗舰项目深度详情页；成功定义是获得面试或合作机会。AI 分身以第一人称「我」= 陆耀威本人回答，依据仅限站点公开内容，不编造。

## Positioning

一个以 AI 第一人称分身为首屏主角的求职站点：不是静态简历，而是可被追问、逐条回答的「数字版本人」。站点由陆耀威本人自建并维护（AI 问答、内容、部署、运维全部自己完成），这件事本身就是能力证明——「把自己蒸馏成一个网站」。

## Operating Context

- 访客端：`/`（免登录）；项目深度详情页 `/p/:slug`（免登录）；管理端 `/admin`（首次访问设置密码）。
- 线上托管于 Cloudflare Workers + D1，自定义域名 wei9930.cloud，国内直连、手机与电脑均可用、无需 VPN（已实测）。
- 内容维护：管理端保存即生效（线上 D1）；代码改动需重新部署（`wrangler deploy`）。
- 内容事实源：2026-08-24 版简历，已逐项确认；种子数据 `seed/content-seed.json`。
- AI：DeepSeek API（默认 base `https://api.deepseek.com`，模型 `deepseek-chat`），Key 存为 worker secret `AGENT_API_KEY` 或在管理端配置；未配置时走基于站点内容的离线摘要兜底，并在回答中注明。

## Capabilities and Constraints

- 六类内容：个人介绍 / 项目经历 / 项目进程 / 校园经历 / 荣誉奖项 / 实习经历；实习含 4 个子模块与「实习收获」（点击展开）。
- 项目详情页由 `GET /api/project/:slug` 按 slug 渲染 projectDocs（架构链路图、MCP 工具清单、关键难点与方案、量化成果、链接）。
- AI 首屏常开问答面板（欢迎语 + 快捷问题，SSE 流式逐字回答，回答按轻量 Markdown 渲染）；另有右下角浮层入口。
- 隐私约束：联系方式只给邮箱（luyaowei9930@163.com）；不展示手机号、住址等；AI 涉及隐私时礼貌回避。
- 已明确：无访客留言表单。
- 本地 `data/site.db` 与线上 D1 相互独立；每次启动对种子做增量迁移，不重置密码/智能体设置。
- 技术约束：前端零框架手写 HTML/CSS/JS，无 CDN、无 webfont；线上图片上传暂不支持（501 占位）。

## Brand Commitments

- 名称：陆耀威；域名 wei9930.cloud。
- 声音：AI 以第一人称「我」= 陆耀威本人回答；AI 面板文案「由陆耀威自建的个人AI向您回答」。
- 既有视觉承诺（paper-minimal、克莱因蓝 #002FA7 仅作点缀、1px 发丝线、悬停仅边框变蓝）曾为绑定约束，记录于 `docs/DESIGN_SPEC.md`；本次为重塑（redesign），该视觉世界将在 new-work 中整体替换——旧规范视为反例参考而非保留对象（待用户新需求确认）。

## Evidence on Hand

- 2026-08-24 版简历（已确认）与 `seed/content-seed.json`；线上 `/api/content` 已核对一致。
- 两大旗舰项目：EDA Agent 桥、wei+ 串口助手（链接 https://github.com/Wei312888/wei-plus-serial-assistant）。
- 仓库内含项目技术报告：《信号分离装置，模拟信号收发机的项目技术报告.md》。
- 已有 `docs/DESIGN_SPEC.md`（旧视觉规范）与 `docs/API_CONTRACT.md`。
- 缺失且不得伪造：两个项目的真实截图/实拍素材（用户稍后提供，届时以真实素材为准）。

## Product Principles

1. **AI 分身是主角**：第一屏让访客直接提问，而不是先读长篇内容。
2. **真实不编造**：AI 回答仅依据站点公开内容；无依据就明确兜底、不虚构事实、不虚构素材。
3. **自己动手**：站点的构建、部署、内容、运维都是「能动手」这一能力证明的一部分。
4. **开放但守隐私**：乐于回答，但联系方式只给邮箱，绝不泄露手机号/住址。
5. **随时可访问**：国内直连、手机+电脑、无需 VPN，内容与功能不依赖第三方平台账号。

## Accessibility & Inclusion

- 中文为主；必须支持中国大陆网络环境与移动端桌面端均可使用。
- 未建立特定无障碍标准要求（WCAG 等级等未指定）。
