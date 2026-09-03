# 陆耀威 · 个人求职站点

「把自己蒸馏成一个网站」：访客端以 AI 问答为首屏主角（AI-first），公开浏览六类内容、直接向 AI 分身提问，并查看两大旗舰项目（EDA Agent 桥、wei+ 串口助手）的深度详情页；管理端（仅我）维护内容与智能体配置。

- 访客端：`/`（免登录），项目深度详情页 `/p/:slug`（免登录）
- 管理端：`/admin`（首次访问设置密码后使用）

## 站点特性

- **AI 首屏主角**：开篇即是一个常展开的大号 AI 问答面板（含欢迎语与 3 个推荐问题），访客可就地提问、SSE 流式逐字回答；个人简介与六类内容下移为展示区。
- **两大旗舰项目深度详情页**：`/p/eda-agent-bridge`、`/p/wei-plus` 由 `GET /api/project/:slug` 按 slug 渲染 projectDocs（架构链路图、MCP 工具清单、关键难点与方案、量化成果、链接），不硬编码在前端。
- **校园经历补全**：campus 补充「贺州学院 · 电子设计竞赛基地 · 会长」条目（负责实验室管理、组织科创竞赛、教授新成员知识）。
- **配图 / 结构图**：`public/assets/svg/` 提供 EDA Agent 桥三层架构图、wei+ 四接口与协议流程图、信号测量装置框图，以及克莱因蓝分享卡片（`share-card.png`，1200×630，供 og:image；源文件 `share-card.svg`）。
- **SEO / OG 分享**：首页与详情页带 `og:*`、`twitter:card` 与 Person JSON-LD，便于在微信 / 社交平台分享。

## 技术

Node.js（>=22）+ Express + 内置 `node:sqlite`（无原生依赖）。前端为零框架手写 HTML/CSS/JS，无 CDN、无 webfont。数据存于 `data/site.db` 单个文件；首次启动为空库时自动导入 `seed/content-seed.json`（以 2026-08-24 简历为准，已经本人逐项确认），其后每次启动会对已有库做**增量迁移**——补齐校园经历（campus）与项目深度文档（`projectDocs`，存 `kv.projectDocs_json`），不会重置管理密码或智能体设置。

## 本地运行

```bash
npm install
npm start          # 监听 http://localhost:3000（PORT 环境变量可改）
```

## 管理端使用

1. 打开 `/admin`，首次访问设置管理密码（>=6 位）。密码用 scrypt 哈希入库，登录会话 7 天有效。
2. 六类内容（个人介绍 / 项目经历 / 项目进程 / 校园经历 / 荣誉奖项 / 实习经历）均支持新增、编辑、删除、排序；保存即持久化，访客端即时同步。
3. 智能体设置：Base URL 默认 `https://api.deepseek.com`，模型默认 `deepseek-chat`，填自己的 DeepSeek API Key 保存。Key 只回显掩码（如 `sk-***abcd`），不清除就留空。
4. 未配置 Key 时访客端对话走「基于站点内容的离线摘要兜底」，并在回答中注明——不会答非所问，也不编造。
5. 备份与恢复：备份下载全部内容 JSON（不含 API Key）；恢复接受此前导出的 JSON。**建议每次大改后备份**。

## 访客端对话

访客在首屏 AI 面板（或右下角浮层）提问 → 后端把六类内容的公开展示数据整理进系统提示 → 以第一人称「我」= 陆耀威本人回答，依据仅限站点公开内容，不编造；涉及隐私（手机号、住址等）礼貌回避，联系方式只给邮箱。同一 IP 每分钟限流 20 次。未配置 API Key 时走基于站点内容的离线摘要兜底。

## 部署到 Render（免费）

### 方式一：BluePrint 一键（推荐）

项目已带 `render.yaml`。到 https://render.com 用 GitHub 登录：

1. 把本项目推送到一个 GitHub 仓库（`git init && git add -A && git commit -m "init" && git push`）
2. Render 控制台 → New → Blueprint，选该仓库，等它自动创建 Web Service
3. **给服务加一个 secret 环境变量 `AGENT_API_KEY`（值 = 你的 DeepSeek API Key）**——项目已支持从环境变量读取，线上访客端 AI 问答才能真实回答；不配置则走离线兜底
4. 完成后打开服务 URL 即上线（域名如 `luyaowei-personal-site.onrender.com`，即 `og:url` 占位值）

### 方式二：手动挂 Web Service

1. 推送到 GitHub 仓库
2. Render → New → Web Service，连仓库，选 Node
3. Root Directory：`/`；Build Command：`npm install`；Start Command：`npm start`
4. 免费实例 RAM 512MB / Node 22，够用。域名自动分配如 `xxx.onrender.com`，也可在 Settings 里绑定自有域名

### 重要：数据持久化与备份

Render 免费实例的文件系统是**临时的**（重启/重新部署后 `data/site.db` 可能丢失）。最坏情况：站点内容回到简历初始版本（启动时自动重导种子），管理密码需重设。

对策（二选一）：

- **定期备份（免费）**：在管理端「备份与恢复」把 JSON 下载到本地保存；站点数据丢失后上传恢复即可。
- **持久磁盘（约 $0.5/GB/月）**：Render → Settings → Persist Disk，挂载该盘，然后为服务添加环境变量 `DATA_DIR=<挂载路径>` 即可（项目已支持）。

## 目录结构

```
server.js          入口（含 /api/project/:slug、/p/:slug 路由）
lib/               后端模块（db/auth/content/chat/settings/routes/errors）
public/            前端（index.html 访客端 / admin.html 管理端 / detail.html 项目详情页 / assets）
  assets/svg/      结构图与分享卡片（eda-agent-bridge.svg / wei-plus.svg / share-card.svg / signal-measurement-device.svg）
seed/              初始内容（简历解析产物，已确认；含 campus 与 projectDocs）
docs/              接口契约与视觉规范
data/              运行时数据库（gitignore）
```
