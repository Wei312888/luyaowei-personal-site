# API 契约（前后端共同遵守，勿单方面更改）

后端：Node.js + Express（唯一依赖）+ `node:sqlite`（Node 22+ 内置，不引入 better-sqlite3 等原生依赖）。
数据库文件：`data/site.db`（加入 .gitignore）。首次启动若库为空 → 自动导入 `seed/content-seed.json`。

## 存储设计

- 表 `items(id INTEGER PK AUTOINCREMENT, category TEXT, sort INTEGER, data TEXT/JSON, updated_at TEXT)`
  - category ∈ `projects | progress | campus | honors | internship`
- 表 `kv(key TEXT PK, value TEXT)`：`password_hash`、`session_secret`、`agent_base_url`、`agent_api_key`、`agent_model`、`system_prompt_extra`、`projectDocs_json`
- `profile`（个人介绍）为单对象，存 `kv` 键 `profile_json`
- `projectDocs`（项目深度文档）为以 slug 为键的对象，存 `kv` 键 `projectDocs_json`（详见后文）

## 内容 JSON 形状（`GET /api/content` 与 seed 一致）

```json
{
  "profile": {
    "name": "陆耀威", "intent": "…", "location": "…", "politics": "…", "email": "…",
    "summary": "…", "selfEval": "…",
    "education": { "school": "…", "major": "…", "period": "…", "gpa": "…", "courses": "…" },
    "skills": [{ "group": "Agent / MCP", "items": "…" }]
  },
  "projects":  [{ "id":1, "name":"…", "tag":"独立完成", "stack":"…", "period":"…", "bullets":["…"], "link":"", "image":"", "imageWidth":100 }],
  "progress":  [{ "id":1, "project":"EDA Agent 桥", "status":"迭代推进中", "note":"…" }],
  "campus":    [{ "id":1, "title":"…", "org":"…", "period":"…", "detail":"…" }],
  "honors":    [{ "id":1, "name":"…", "detail":"…", "year":"2025", "image":"", "imageWidth":100 }],
  "internship":[{ "id":1, "company":"…", "role":"…", "dept":"…", "period":"2026.08", "bullets":["…"], "modules":[{"title":"…","summary":"…","bullets":["…"]}], "takeaway":"…", "image":"", "imageWidth":100 }]
}
```

`image` 为 `"/uploads/<文件名>"` 或空字符串（无图）；`imageWidth` 为访客端缩略图显示宽度百分比（仅允许 40 | 60 | 80 | 100，默认 100；点击放大始终全屏）。`campus` 初始为空数组 `[]`，访客端须优雅展示「待补充」而非报错。

`internship` 条目在基础字段（company/role/dept/period/bullets）之外新增 `modules`（数组，每项 `{ title, summary, bullets[] }`，按岗前培训、基础测试、缺陷闭环、文档运维等子模块拆分）与 `takeaway`（字符串，整段实习收获）。`bullets` 为顶层要点概览，`modules` 承载更细的子模块分工；两者共存，字段名前后端共同遵守。

## 项目深度文档 projectDocs（`GET /api/project/:slug`，公开）

- 深度文档以 slug 为键，整体存 `kv.projectDocs_json`，seed 里为 `projectDocs` 对象。
- `GET /api/project/:slug`：
  - `:slug` ∈ `eda-agent-bridge | wei-plus`；不存在 → 404 `{"error":"项目文档不存在"}`
  - 响应 200：单个项目文档对象，形状如下（字段名前后端共同遵守）：
    ```json
    {
      "slug": "eda-agent-bridge",
      "name": "EDA Agent 桥（嘉立创 EDA 扩展 + 网关 + MCP）",
      "tagline": "让 AI Agent 用自然语言直接读写嘉立创 EDA 专业版的原理图",
      "stack": "TypeScript / Node.js · MCP · WebSocket · 嘉立创 Pro API",
      "summary": "一句话概述",
      "diagram": "/assets/svg/eda-agent-bridge.svg",
      "architecture": [
        { "label": "外部 AI Agent", "detail": "…" },
        { "label": "MCP Server", "detail": "…" },
        { "label": "本地网关", "detail": "…" },
        { "label": "EDA 扩展", "detail": "…" },
        { "label": "嘉立创 EDA 专业版", "detail": "…" }
      ],
      "mcpTools": [
        { "name": "read_selected", "description": "…" }
      ],
      "httpEndpoints": [
        { "method": "GET", "path": "/api/selected", "purpose": "…" }
      ],
      "challenges": [
        { "title": "…", "solution": "…" }
      ],
      "results": [ "量化成果…" ],
      "link": ""
    }
    ```
  - `diagram` 指向 `public/assets/svg/` 下的结构图（由设计产出）；`link` 为可选开源/演示链接，空串表示暂无。

## 项目详情页路由 `GET /p/:slug`

- `server.js` 为 `/p/:slug` 返回 `public/detail.html`（与静态资源同源，无需登录）；前端按 `location.pathname` 提取 slug，拉取 `GET /api/project/:slug` 渲染，不在前端硬编码项目内容。

## 图片上传（管理端鉴权）

- `POST /api/admin/upload`
  - 请求：`Content-Type: image/png | image/jpeg | image/webp | image/gif`，body 为原始二进制（express.raw，`limit: 5mb`），需登录 cookie。
  - 响应 201：`{ "url": "/uploads/<随机hex>.<ext>" }`；仅允许 png/jpg/jpeg/webp/gif 扩展名；文件写入 `DATA_DIR/uploads/`（DATA_DIR 默认 `data/`，支持环境变量覆盖）。
  - 非法类型 → 400；超限 → 413。
- `DELETE /api/admin/upload` body `{ "url": "/uploads/xxx.png" }`（需鉴权）→ `{ "ok": true }`；仅允许 `/uploads/` 前缀且位于本站 uploads 目录内的文件；不存在 → 404。
- `GET /uploads/*`：express.static 托管 `DATA_DIR/uploads`，**无需登录**（访客端展示），`maxAge: 7d`。

## 鉴权（管理端）

- `GET  /api/auth/state` → `{ "setupNeeded": bool, "authenticated": bool }`
- `POST /api/auth/setup` `{ "password": "…" }`：仅当未设密码时可用（否则 400）；scrypt 哈希存库；成功即登录
- `POST /api/auth/login` `{ "password": "…" }`：成功后设 httpOnly + SameSite=Lax 签名 cookie `lyw_session`（payload.exp + HMAC-SHA256，密钥 `session_secret` 首次随机生成入库），有效期 7 天
- `POST /api/auth/logout`
- 密码错误统一 401 `{"error":"密码错误"}`；所有 `/api/admin/*` 未带有效 cookie → 401 `{"error":"unauthorized"}`

## 管理端内容 API（全部需鉴权）

- `GET    /api/admin/content` → 与 `GET /api/content` 同形状
- `PUT    /api/admin/profile`（body = 完整 profile 对象，整体替换）
- `POST   /api/admin/:category`（body = 不带 id 的 item）→ `201` 返回带新 id 的 item
- `PUT    /api/admin/:category/:id`（body = item，整体替换）
- `DELETE /api/admin/:category/:id` → `{ "ok": true }`
- `PUT    /api/admin/:category/order`（body = `{ "order": [id,…] }`，重排 sort）
  - `:category` ∈ projects | progress | campus | honors | internship；非法 category → 400

## 管理端设置 API（智能体接入信息，需鉴权）

- `GET /api/admin/settings` →
  `{ "agentBaseUrl":"https://api.deepseek.com", "agentModel":"deepseek-chat", "agentApiKeySet": true, "agentApiKeyMasked": "sk-***abcd", "systemPromptExtra": "…" }`
  （任何接口不得把完整 key 返回给前端）
- `PUT /api/admin/settings` body：
  `{ "agentBaseUrl": "…", "agentModel": "…", "agentApiKey": "sk-…（可选，空串=不修改）", "clearApiKey": false, "systemPromptExtra": "…" }`
- 取 key 优先级：`kv.agent_api_key` → 环境变量 `AGENT_API_KEY`（托管部署如 Render 用 secret 环境变量注入，便于重启/重建后 AI 保持可用）

## 备份 / 恢复（需鉴权）

- `GET  /api/admin/backup` → 附件下载 `content-backup-YYYYMMDD.json`，内容 `{ "exportedAt": "…", "profile":…, "projects":…, "progress":…, "campus":…, "honors":…, "internship":… }`（**不含** agent_api_key）
- `POST /api/admin/restore`（body = 备份 JSON）→ 覆盖六类内容（不动设置与密码），返回 `{ "ok": true }`

## 访客对话 `POST /api/chat`（无需登录）

- 请求 body：`{ "message": "…", "history": [{ "role":"user"|"assistant", "content":"…" }] }`（history 截断为最近 12 条）
- 响应：`text/event-stream`（SSE）。事件格式：
  - 增量：`data: {"delta":"…"}\n\n`
  - 结束：`data: [DONE]\n\n`
  - 出错：先 `data: {"error":"…"}\n\n` 再 `[DONE]`（HTTP 仍 200，便于前端统一在流内处理）
- 服务端逻辑：
  1. 从库里读全部六类内容，序列化后拼进 system prompt：AI 以第一人称「我」= 陆耀威本人回答；只依据站点公开资料；不编造；公开内容之外/涉隐私的问题礼貌回避；语气克制自然；访客求助联系方式时只给邮箱。
  2. `system_prompt_extra`（管理端可编辑）追加在 system 末尾。
  3. 调用 OpenAI 兼容接口：`POST {agentBaseUrl}/chat/completions`（baseUrl 默认 `https://api.deepseek.com`，路径拼 `/chat/completions`），`Authorization: Bearer {agent_api_key}`，`model = agent_model`（默认 `deepseek-chat`），`stream: true`，解析上游 SSE 转发为上述事件。
  4. **未配置 key 时离线兜底**：按问题与六类内容的关键词重合度检索相关条目，以第一人称拼接一条摘要式回答，并在开头注明「（AI 尚未接入，以下基于站点公开资料自动整理）」，同样以流式分片发出。
  5. 简单限流：同 IP 每分钟 ≤ 20 次，超出 429（JSON）。
- 上游请求超时 60s；客户端断开时中止上游请求。

## 静态资源

- `public/` 由 express.static 托管：`/` → `index.html`（访客端），`/admin` → `admin.html`（管理端）
- 监听 `process.env.PORT || 3000`，绑定 `0.0.0.0`
- JSON body 上限 2MB；统一错误处理中间件，不向客户端泄漏堆栈

## 联调约定

- 三方（后端/访客端/管理端）一律以本文档为准；实现完成后不得擅自改字段名。
- 前端不得把任何内容硬编码在 HTML/JS 里，一律 fetch 渲染。
