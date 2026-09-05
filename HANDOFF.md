# 陆耀威个人网站 · 上下文备忘(2026-09-04)

## 一句话状态
个人求职网站已完整上线:**https://wei9930.cloud**(国内直连,Cloudflare Workers + D1),AI 对话(DeepSeek)真回答,管理端可用。

## 项目位置
- 本地工作区:`C:\Users\35713\Desktop\个人网站`
- Git 仓库(本地已 init + 推送):GitHub `Wei312888/luyaowei-personal-site`(master,已推送 4 个 commit)
- 注意:本机 git 全局配置把 github.com 改写为 kkgithub.com(镜像),推送需绕过(Bypass 方法:临时空 GIT_CONFIG_GLOBAL + http.extraHeader token)。

## 两套运行形态
1. **Node 本地版**(开发用):`npm start` → http://localhost:3000;`data/site.db`(gitignored)+ `seed/content-seed.json`。
2. **Cloudflare 线上版**(正式):`workers/app.js`(Hono + D1 + ASSETS)+ `wrangler.toml`。本地测:`node_modules\.bin\wrangler.cmd dev --port 8787`;部署:`CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` 环境变量 + `wrangler deploy`。

## 线上环境要素
- 云端账号:Cloudflare(3571334658@qq.com's Account),Account ID `6be3ec92…4362b8`
- Worker:`luyaowei-site`;workers.dev 子域名 `3571334658`
- 自定义域名:**wei9930.cloud**(certs 已签发;DNS 记录为 Worker 类型、已代理)
- zone id:`8877fc9092…303e63`;D1:`luyaowei_site`(id `0d514799-762b-45ce-afb0-71ee6b71dfbd`)
- 运行时 secret:`AGENT_API_KEY`(DeepSeek 值,已上传;勿在对话/文件中明文扩散)
- 阿里云域名:wei9930.cloud(持有者 陆耀威,实名已过),NS = felipe/jasmine.ns.cloudflare.com

## 站点功能(已实现并验证)
- AI-first 首页(大号 AI 面板:欢迎语+3 快捷问题,SSE 流式,DeepSeek 真答)
- 六节内容:个人介绍 / 项目 5 / 进程 5 / 校园(电子基地会长)/ 荣誉 4 / 实习(4 模块+收货)
- 旗舰深度详情页 `/p/eda-agent-bridge`、`/p/wei-plus`(经 `/api/project/:slug`)
- 项目链接按钮样式(带框+克莱因蓝 hover;wei+ 已填 GitHub 开源地址)
- 六节 1px 细线分框;hover 仅边框变克莱因蓝(无上浮/无底色,符合 DESIGN_SPEC)
- SEO/OG/JSON-LD(og:url 目前为 workers.dev 地址,可改为 wei9930.cloud)
- 管理端 `/admin`(scrypt→线上版 PBKDF2;**线上尚未设管理密码,首次访问需设置**)
- 图片上传:线上版暂未支持(501,可后续接 R2)

## 密钥清单(均已出现在对话中,请按需处理)
- GitHub PAT:`ghp_…`(推送用,建议删除并可在需要时重新生成)
- Cloudflare Token 有效版:`cfat_mRSf…`(**保留,用于部署**;不建议删除)
- Cloudflare Token 旧版:`cfat_cBEg…`(无权限,建议删除)
- Render API Key:`rnd_…`(没用上,建议删除)
- DeepSeek Key:`sk-…`(仅存于 Cloudflare secret;勿扩散)
- ❗用户曾贴过银行卡号(已被拒)——提醒注意该卡信息暴露

## 日常操作
- 改内容:**https://wei9930.cloud/admin** 直接编辑(存 D1,即时生效;本地 site.db 与线上 D1 相互独立)
- 改代码:编辑本地文件 → 让 agent/自己 `wrangler deploy` 上线(暂无自动部署;可选配 GitHub Actions)
- 本地验证线上同款:http://localhost:3000(Node)或 wrangler dev(CF)

## 待办/可选
- [ ] 线上 /admin 设置管理密码
- [ ] README 更新为 Cloudflare + wei9930.cloud(仍写 Render)
- [ ] (可选)GitHub Actions 自动部署
- [ ] (可选)og:url 改为 wei9930.cloud
- [ ] (可选)图片上传接 R2 / 后续换最终域名链接
