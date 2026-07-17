---
title: Forsion 是什么
description: 产品家族总览:Tangu 引擎、Forsion Desktop、Amadeus 笔记,以及它们背后的设计理念。
---

# Forsion 是什么

Forsion(扶桑)不是"又一个聊天客户端"。它是一个 **AI 工作台**:AI 不只回答问题,还能记笔记、管日程、盯任务、跑自动化、写代码并当场预览——而这一切都发生在你自己的电脑上。

## 产品家族

| 名字 | 是什么 |
|------|--------|
| **Tangu** | 智能体引擎,整个系统的大脑。负责跑模型、调用工具、管理 Agent 与会话。可以嵌在桌面端里,也可以独立跑在服务器或终端里 |
| **Forsion Desktop** | 桌面应用(macOS / Windows / Linux),本文档的主角。Tangu 引擎 + 可停靠工作区 + 各种功能空间 |
| **Amadeus** | 内置笔记系统:本地 Markdown 库、双链、多维表、白板、PDF 批注,格式与 Obsidian 兼容 |
| **Forsion Web** | 浏览器版云客户端,不装应用也能用 |
| **Forsion Mobile** | Android 版,默认连接云端 |
| **Tangu CLI** | 终端里的 Tangu,随桌面端一键安装 |

## 设计理念

**本地优先。** 你的笔记是磁盘上的 Markdown 文件,Agent 的记忆是你能打开编辑的文本,配置是一个 JSON。卸载 Forsion,你的数据还在,还能用任何编辑器打开。云端能力(同步、共享、云端模型)全部是可选叠加,不开就不上传。详见[数据与隐私](../reference/data-and-privacy.md)。

**Agent 是长期伙伴,不是一次性会话。** 每个 Agent 有自己的人格设定、独立记忆、资料库和日志,越用越懂你。详见 [Agent 总览](../agents/overview.md)。

**AI 应该主动。** 除了"你问我答",Forsion 有一整套主动机制:[Muse](../agents/muse.md) 会按你定的规则盯着事情,[自动化空间](../spaces/automation.md)让任务定时自己跑,结果送进[收件箱](../spaces/inbox.md)。

**一切可换。** 模型服务商可换、主题可换、功能空间可增删、插件可装——[应用市场](../customization/market.md)里技能、代理、插件、空间、主题一站式安装。

## 下一步

- [安装与更新](installation.md)
- [快速上手](quickstart.md)
