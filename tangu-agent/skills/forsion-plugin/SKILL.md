---
name: Forsion 扩展开发
description: 当用户要给 Forsion / Tangu 做插件、主题、Space 或智能体(agent)——或要把某个能力做成可分发/可上架市场的扩展——时使用。内置四类官方模板(samples/),讲清各自的格式基线与硬约束(尤其两种"插件"是完全不同的系统),照抄模板改比从零写靠谱。
version: 1.0.0
author: Forsion
category: Forsion
---

# Forsion 扩展开发

Forsion / Tangu 有四类可分发扩展。每类都有一份官方模板放在本技能的 `samples/` 下 —— **先复制对应模板再改**,别从零搭。

| 类型 | 是什么 | 模板 | 最小产物 |
|------|--------|------|----------|
| **引擎插件** | 给 agent 加工具 / 设置 / 提示片段 | `samples/forsion-sample-plugin/` | `tangu-plugin.json` + `dist/index.js` |
| **主题** | 换 UI 结构+配色(纯数据) | `samples/forsion-sample-theme/` | `theme.json` + `theme.css` |
| **Space** | 视图布局配方(纯数据) | `samples/forsion-sample-space/` | `space.json` |
| **智能体** | 预设人设+记忆+技能的 agent | `samples/forsion-sample-agent/` | `config.toml` + `SOUL.md` |

> ⚠️ "插件"有**两个互不相干的系统**,先分清用户要哪个:
> - **引擎插件**(本技能 `samples/forsion-sample-plugin`):后端/Agent 层,`tangu-plugin.json` + `activate(ctx)`,给模型加工具。
> - **Amadeus 编辑器插件**:笔记编辑器层,`manifest.json` + 裸 `main.js`(宿主 `new Function('ctx', code)` 跑),加命令/斜杠项/视图/文件类型。**不在本模板集内** —— 桌面端 设置 → 笔记插件 有一键脚手架(hello-amadeus),真实范例见 `forsion-plugin-mindmap`。

## 通用纪律

1. **先有动机再做**:每个扩展要能指回一条真实痛点,说不出就别做。
2. **注入模型的文本一律英文**:工具 `description`、参数说明、promptSection —— 给模型读的全英文;用户可见字段用 `name`/`nameEn`、`description`/`descriptionEn` 双语镜像。
3. **id 全局唯一、kebab-case**:命令/斜杠/工具 id 处于全局命名空间,裸名会互相顶掉;主题 id **就是** `data-theme` 值,更要独一无二。
4. **交付=能跑+能回归**:非平凡逻辑留一个 `check.mjs`(`node check.mjs` 一条命令),范式见 `forsion-plugin-mindmap` / activitywatch 的 check 模式。

## 引擎插件(samples/forsion-sample-plugin)

三个常用贡献点:工具(`sample_greet`)、设置 schema(`text`/`toggle`,设置页通用渲染)、`promptSection`(启用时注入系统提示)。硬约束:

- **绝不运行时 import 核心包**。对 `@forsion/tangu-agent` 只允许 `import type`(模板 tsconfig 开了 `verbatimModuleSyntax`,值导入直接编译错误)。运行时能力全走 `activate(ctx)` 的 **`ctx.sdk`** —— 否则核心的模块级单例被复制成第二份,行为诡异。
- **`dist/` 必须提交**。市场安装 = 解压源码到 `~/.forsion/plugins/<id>/`,全程不构建;改 `src/` 后必须 `npm run build`(tsc→dist/)再提交。
- **工具门禁**:`isEnabledFor` 返回 `store.isPluginEnabledSync(id)`,插件启用才对模型可见。
- 类型契约 `types/tangu-agent.d.ts` 是 apiVersion 1 的 API 拷贝,随模板分发;宿主升 apiVersion 时替换它并同步 manifest 的 `apiVersion`。

装本机:整夹拷到 `~/.forsion/plugins/<id>/` → 重启后端(同 id 原位升级受 ESM 缓存影响,必须重启)。

## 主题(samples/forsion-sample-theme)

双轴模型:**语言(结构:圆角/字体/阴影/布局)× 配色(颜色)× 明暗**。磁盘主题装 `~/.forsion/themes/<id>/`,**目录名必须 == id**。

- 主题 CSS 是**全局注入**(非隔离),因此**每条规则都要 scope 在 `[data-theme='<id>']` 下**,否则污染其它主题。
- **不要硬编码颜色**:配色由 skin 提供,主题只定结构,消费 `var(--bg)`/`var(--text)`/`var(--accent)` 等词表 token —— 这样任意配色/明暗都成立。
- 可选 `settings[]`(number/select/boolean/color)让用户在设置页调主题内参数:`key` **就是** CSS 自定义属性名,宿主把值写进 `:root` 内联变量,主题用 `var(--key, 默认值)` 消费。参考本仓内置 `genesis-glass` 主题(`desktop/frontend/src/theme/themes/genesis-glass/`)。

## Space(samples/forsion-sample-space)

`space.json` 声明视图布局配方(引用视图类型 id;插件视图用 `plugin:<插件id>:<视图id>` 并在 `requires.views` 声明)。纯数据,无代码。

## 智能体(samples/forsion-sample-agent)

文件夹式:`config.toml`(模型/工具/技能开关)+ `SOUL.md`(人设,英文写给模型)+ `Library/`(参考资料)+ 每-agent 记忆。装 `~/.forsion/agents/<slug>/`。

## 发布到市场

推成独立 GitHub 公开仓库(引擎插件记得含 `dist/`)→ 个人中心 → 投稿 选对应类型给仓库链接或传 zip(zip 内容放根或单层文件夹,两层路径装不了)。GitHub 来源会**锁定过审时的 release tag**,发新版需重新过审。升版号必写 `CHANGELOG.md` 一节(`## x.y.z — YYYY-MM-DD`),宿主会渲染成插件详情页的更新日志。
