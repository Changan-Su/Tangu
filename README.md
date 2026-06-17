# @forsion/tangu-agent

> **与宿主无关的服务端 Agent 运行时**。一套 Core,通过四个接缝注入不同适配器 = 不同运行模式;
> 同一份代码既可作为 Forsion 微后端插件跑在云端,也可独立运行(云端大脑客户端 / 多机 worker 集群)。

Tangu = **Agent Core 运行时 + 一套 App 适配规范 + 一个云端共享大脑**。一个云中心化的「Agent 大脑」,
分发到不同 app / 设备去执行——所有节点调用同一个中枢,故 Memory / Skills / Subagents 跨设备共享,
只有应用层的 prompt / tools / skills 装载按 app 不同。

完整设计见 [`../../server/Documents/Tangu/Tangu_Agent_Architecture_v2.0.md`](../../server/Documents/Tangu/Tangu_Agent_Architecture_v2.0.md)。

---

## 核心思想:一套 Core + 四个接缝

运行时本体是 `createTanguModule({ host, brain, billing, profile })`。「运行模式」= 往这四个槽插不同实现:

| 注入点 | 是什么 | 接缝 |
|---|---|---|
| `host` (`HostServices`) | DB(`host.query`)/ 鉴权中间件 / 日志 | — |
| `brain` (`CloudBrainServices`) | LLM / 用户 / 记忆 / 技能 / 搜索 / 存储 | 接缝② |
| `billing` (`BillingServices`) | 配额 / 计费 / 用量 | 接缝② |
| `profile` (`AppProfile`) | appId / 沙箱模式 / 能力开关 | 接缝① |

**core loop 逻辑不随模式改变**;差异全部收敛进注入的适配器。

---

## 部署形态

| 形态 | 入口 | host | brain | billing | 用途 |
|---|---|---|---|---|---|
| **microserver**(进程内) | Forsion `server/microserver/agent-core` | Forsion 进程内 | `forsionSeams`(直连) | 真实计费 | 与 AI Studio 等部署在一起,云端多租户 |
| **TUI / CLI**(终端 agent) | `dist/tui/main.js`(`tangu`) | `sqliteHost`(SQLite/WAL,**零安装**) | `httpBrain` | noop | 成熟终端 agent(Ink,hermes/codex 形);进程内跑 loop、**无端口**;**host-exec** 直接操作本机 FS/shell + 三档审批;Markdown/工具卡片/状态栏/slash 命令 |
| **standalone**(server/云端大脑客户端) | `dist/standalone/main.js`(`tangu-server`) | `sqliteHost`(SQLite/WAL,**零安装**)/ `localHost`(外部 PG) | `httpBrain`(→ brain-api) | noop | headless HTTP/SSE 服务,给 desktop / 远程 / 脚本用;可 BYO-key 直连 LLM |
| **worker**(分离式云节点,**插件**) | `tangu worker`(插件 `plugins/forsion-worker`) | `cloudWorkerHost`(共享云库 + JWT 多用户) | `httpBrain`(per-user token) | noop(计费收口云端) | 多机横向扩展;**不在开源核心**,作为 `./plugins` 插件加载,后续独立成项目 |
| **desktop**(GUI) | `desktop/`(Electron) | — | renderer 直连 standalone HTTP/SSE | — | 本地桌面客户端(壳) |

三种服务端形态**共用同一份 Core**;run 接口契约一致:`POST /agent/runs` + SSE `GET /agent/runs/:id/events`。

---

## 目录结构

```
src/
├── index.ts            # 包入口:createTanguModule(deps) → { userRouter, adminRouter, runMigration, startBackgroundTasks, dispose }
├── seams/              # 接缝定义(host / cloudBrain / billing / appProfile / runtime / runContext)
├── core/               # 纯类型 + DB/HTTP 垫片(无 Forsion 耦合)
├── services/           # agentLoop / runStore / eventBus / historian —— Core 运行时本体
├── tools/              # 工具注册表(含 host-exec 门禁)/ hostExec(run_bash+真实FS)/ 自定义工具 / 文件工作区
├── sandbox/            # docker 会话沙箱(run_python 等)
├── routes/             # /agent/runs(+SSE)/ workspace / admin
├── services/           # agentLoop / eventBus / runStore / approvals(host-exec 审批闸门)/ historian
├── llm/                # 多 provider:openaiCompat(直连)+ providerRegistry
├── adapters/
│   └── standalone/               # localHost / httpBrain / multiBrain / noopBilling
├── plugins/            # 插件宿主系统:types(契约)/ loader(./plugins 发现)/ bootstrap(ctx.sdk 装配)
├── tui/                # Ink 终端 UI(`tangu`):main/app/events/commands/sessions + components/*
├── standalone/         # standalone 入口(main + config;`tangu-server`)
└── db/                 # 迁移 + standalone schema
desktop/                # Electron + React 本地 GUI(构建隔离,自带 electron-vite)
plugins/                # 运行时 drop-in 插件目录(git/docker 忽略);worker 模式即 plugins/forsion-worker
```

> **插件系统**:核心从 `./plugins/` 发现并加载插件(`src/plugins/loader.ts`),经 `tangu` 子命令触发。
> 插件以独立模块图运行,**仅 `import type` 核心**、运行时全走传入的 `ctx.sdk`(契约见 `src/plugins/types.ts`)。
> worker 模式即首个插件 `plugins/forsion-worker`(`tangu worker`),不在开源核心、独立分发。`tangu plugins` 列出已加载插件。

---

## 构建

```bash
npm install
npm run build       # tsc → dist/
npm run typecheck   # tsc --noEmit
```

> 包以 `file:` 依赖被 Forsion server 消费(`server/package.json` → `@forsion/tangu-agent`);改动 `src/**` 后 `npm run build`,server 经 symlink 生效。`desktop/` 构建完全隔离,`tsc` 只编 `src/**`。

---

## 运行

> 三种服务端形态 + 两个前端共用同一引擎:**CLI**(终端)/ **desktop**(GUI)/ **standalone**(headless server)/ **worker**(集群)/ **microserver**(Forsion 进程内)。

### TUI(成熟终端 agent,hermes/codex 形)

`tangu` 进入 **Ink 终端界面**:Markdown/代码高亮渲染、工具调用卡片、底部状态栏(model·cwd·审批档·token 用量)、slash 命令、Tab 补全、@文件提及、↑↓历史。进程内跑 loop、无端口、嵌入式 DB 零安装。默认 **host-exec**——`run_bash` + 真实文件读写(`read_file`/`write_file`/`edit_file`/`list_dir`,相对 `--cwd`),破坏性操作经**审批**把关。

**codex 式浏览器登录**——出链接、浏览器登录、token 自动回存,登录后免 token:

```bash
# ① 首次:浏览器登录(打印链接 + 验证码 → 浏览器登录批准 → token 自动存 ~/.tangu/auth.json)
tangu login --cloud-url http://localhost:3001     # 或 node dist/tui/main.js login …

# ② 之后:直接开聊(免 --token / --cloud-url,已从凭证读取)
tangu --model <模型id 或 ollama/llama3>           # 或 npm run tui -- --model <id>
tangu --model <id> --cwd ~/proj --approval auto-edit   # host-exec 工作目录 + 审批档
tangu --model <id> --sandbox-exec                  # 改用云沙箱 + 云工作区(run_python)
```

> 审批档:`readonly`(写文件/跑命令都要批)·`auto-edit`(默认,改文件放行、命令需批)·`full-auto`(全放行)。会话内 `/approval <档>` 热切。
> 仍可显式传 `--token <forsion_token>` / `--cloud-url` 覆盖凭证(脚本/CI 用)。HTTP/脚本化用 `tangu-server`。

**用 AI 订阅账号当 LLM**(loopback + PKCE OAuth,首发 xAI Grok——公开 client_id + OpenAI 兼容,token 直接接 provider registry):

```bash
tangu login xai             # 浏览器登录 xAI → 凭证存 ~/.tangu/provider-auth.json(带 refresh)
tangu --model xai/grok-2     # 用你的 xAI 账号当 LLM(api.x.ai/v1,直连不经 Forsion)
```

> 加新 provider:往 `src/llm/providerOAuth.ts` 的 `OAUTH_PROVIDERS` 加一条即可复用同一 loopback+PKCE 流程。

会话内命令:`/help /new /clear /model /sessions /resume /approval /cwd /tools /skills /memory /cost /copy /retry /config /compact /exit`。

```
  ✦ Tangu  本地 agent · model=… · cwd=~/proj · 执行=host
  › 帮我重构 auth.ts 里的 token 校验

  ⚙ read_file  auth.ts                          ✓ 142 行
  分三步重构：1) 提取 verifyToken …(Markdown + 代码高亮)
  ⚙ run_bash  npm test          [a]同意 [A]总是 [e]改 [n]否

  ● opus-4.8 · ~/proj · auto-edit · ⛁ 12.3k tok · idle
  ╭──────────────────────────────────────────────╮
  │ › _                                            │
  ╰────────────────────────────────────────────────╯
```

### standalone(server / 云端大脑客户端)

只需一个能连到 Forsion 云端(brain-api)的 `forsion_token`。**数据库零安装**——默认用嵌入式 **SQLite(WAL 模式)**,落单文件 `~/.tangu/state.db`,不需要装/起任何 Postgres。

```bash
node dist/standalone/main.js \
  --cloud-url https://api.forsion.app \   # brain-api 所在
  --token <forsion_token> \               # 调云端 + 本地端点鉴权
  --model <默认模型 id> --port 8787 --sandbox auto
# 或:npm run standalone   (参数走环境变量,见 --help)
```

- run/会话/事件态落本地 SQLite:默认 `~/.tangu/state.db`;`--data-dir memory` = 纯内存(退出即丢);`--data-dir <path>` 自定义文件。
- **本地会话共享**:`tangu`(TUI)与本机的 standalone(含 Desktop 内置后端)默认同指 `~/.tangu/state.db`,SQLite WAL「一写多读、多进程共享」→ 两端会话/历史互通。想要各自独立库就给不同的 `--data-dir`。
- 想接外部 Postgres(共享/已有库)→ 加 `--db postgres://…`,自动改走外部库(多机/跨设备共享会话用这个)。
- 大脑(记忆/技能/LLM)始终在云端 brain-api,不落本地 → 跨设备本就一致。
- 回退:`TANGU_EMBED=pglite` 仍可用旧 PGlite(单进程,不与他端共享),仅排障/回滚用。

**LLM 多 provider(可选,BYO-key 直连)**——Forsion 只是其中一个托管 provider:

```bash
node dist/standalone/main.js --cloud-url … --token … --db … \
  --provider ollama --provider-base-url http://localhost:11434/v1 \
  --model ollama/llama3        # modelId 命中本地 provider → 直连;否则走 Forsion 托管模型
```

`--help` 查看全部参数/环境变量。

### worker(分离式云节点,多机横向扩展)——**外置插件**

worker 模式**不在开源核心**,以插件形式存在(`plugins/forsion-worker`,git/docker 忽略,后续独立成项目),
经 `tangu worker` 触发。连**共享云端 Postgres**,用 `JWT_SECRET`(与 Forsion 同一密钥)本地验签 forsion_token
服务多用户;LLM/记忆经 brain-api,计费在云端收口。

```bash
# 先构建核心与插件(插件 import type 核心,故须核心先 build 出 dist/index.d.ts)
npm run build                                                  # 核心 → dist/
( cd plugins/forsion-worker && npm install && npm run build )  # 插件 → plugins/forsion-worker/dist/

# 启动(经 tangu CLI 的插件命令分发)
JWT_SECRET=<与 Forsion 同一密钥> \
tangu worker \
  --cloud-url https://api.forsion.app \   # brain-api
  --db postgres://cloud-host/forsion \    # 共享云库
  --app-id ai-studio \                    # 一个 fleet 服务一个 app
  --port 8790 --sandbox auto
```

然后在 **Forsion admin 面板「实例管理」** 注册 worker 实例,server 即按 session 亲和把 `/api/agent/*` 转发过去:

```
Forsion admin → 实例管理(/api/admin/agent-core/workers)→ 增删改 worker URL + 测试连通
```

> ⚠️ 自 2026-06-10 起 server **恒为调度网关**(不再进程内跑 loop):`AGENT_DISPATCH_MODE` 已移除,
> 实例改由 `agent_workers` 表 + admin 面板管理(DB 粘滞 pin 保 session 亲和,15s /health 探测)。
> `TANGU_WORKERS=csv` 仅在表为空时**一次性 seed**,之后不再生效。

### microserver(由 Forsion server 自动挂载,**纯调度网关**)

无需单独启动——`server/microserver/agent-core` 被 Forsion 的 `mountMicroBackends` 自动发现并挂在 `/api/agent/*`。
启动 Forsion server(`npm run server:dev`)即生效。

> **它不跑 agent loop**,而是把请求按 session 亲和转发给上面注册的 **worker** 实例(网关 + 执行器是一对)。
> 故云端生产形态 = microserver(网关)+ ≥1 个 worker;**未注册任何 worker 时返回 503 `NO_AGENT_WORKERS`**。

### desktop(本地 GUI)

Desktop 是 GUI 壳,经 HTTP/SSE 连一个 standalone 后端(**不是连 TUI**),两种模式:

- **managed**(内置):自己 spawn 一个 tangu-server 子进程(动态端口),`--data-dir` 默认 `~/.tangu/state.db` → 与 TUI 共享会话。
- **external**:连一个你已起好的 standalone(默认 `127.0.0.1:8787`)。

```bash
npm run desktop:install
npm run desktop:dev     # external 模式需先起一个 standalone;managed 模式自带后端(dev 用系统 node 跑)
```

> better-sqlite3 是原生模块:**managed 打包态**需为 Electron ABI 重建(已配 `build/afterPack.cjs`);
> **dev 用系统 node 跑后端**(免 rebuild);**external 模式**连系统-node 起的 standalone 同样即刻共享。

---

## Run API(三形态一致)

```
POST /agent/runs
  body: { session_id, model_id, message, attachments?, agent_config? }
  → { runId, assistantMessageId, userMessageId }

GET  /agent/runs/:id/events?fromSeq=0     # SSE,可断线重连(seq 去重 + 回放)
GET  /agent/runs?session_id=<id>          # 列出 session 的在飞/最近 run
POST /agent/runs/:id/abort                # 中止
```

> standalone/worker 挂在 `/`(`/agent/...`);microserver 挂在 `/api`(`/api/agent/...`)。

---

## 关键约束

- **沙箱永远保留**:非本地形态的代码执行(`run_python`)必须隔离在 docker 沙箱;无 docker 则该工具降级禁用。
- **session 亲和 = 进程内串行正确性前提**:同一 session 的 run 必须落同一执行节点;worker 集群靠 `hash(session_id)` 路由。
- **计费单一收口**:经 brain-api 用 Forsion 托管模型时只在 `/brain/llm/stream` 计费一次;进程内形态在 loop 内计费且不经 brain-api;直连 provider(用户自有 key)不计 Forsion。
- **云端共享大脑是 Memory/Skills 的唯一真相源**;远端节点经 brain-api 共享,不另起存储。

---

## 文档

- 架构总纲:[`Tangu_Agent_Architecture_v2.0.md`](../../server/Documents/Tangu/Tangu_Agent_Architecture_v2.0.md)
- 桌面 GUI:[`Tangu_Desktop_GUI_v1.md`](../../server/Documents/Tangu/Tangu_Desktop_GUI_v1.md)
- 开发日志:[`../../docs/Log/`](../../docs/Log/)
