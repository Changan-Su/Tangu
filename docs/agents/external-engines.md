---
title: 外部引擎
description: 把 Claude Code 等第三方智能体接进 Forsion,共用同一套会话与界面。
---

# 外部引擎

除了内置的 Tangu 引擎,Forsion 还能作为**宿主**接入第三方智能体引擎(基于 ACP,Agent Client Protocol 生态)——比如把 Claude Code 挂进来,让它在 Forsion 的界面里干活。

## 为什么要接外部引擎

- 你已经在用某个专业智能体(如专精编码的 Claude Code),想要它的能力,但更想要 Forsion 的**统一界面**:会话管理、历史记录、与笔记 / 空间的联动;
- 不同任务用不同引擎:日常对话用 Tangu,重型编码任务委托给外部引擎。

## 怎么用

在 Agent 配置中把某个 Agent 的引擎指定为已安装的外部引擎。与这个 Agent 对话时,回合会**整体委托**给外部引擎执行,输出照常流式显示在 Forsion 里。

> ⚠️ **注意**:外部引擎需要本机已安装对应工具,且仅在本地模式下可用。审批与权限遵循该引擎自身的机制。

## 边界

外部引擎是**可选附加**,不替换内置引擎:Muse、自动化、群聊等深度整合能力仍由 Tangu 引擎驱动。

## 相关页面

- [Agent 总览](overview.md)
- [命令行(Tangu CLI)](../reference/cli.md)
