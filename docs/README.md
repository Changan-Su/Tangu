---
title: Forsion 文档
description: Forsion 桌面 AI 工作台使用文档——对话、Agent、笔记、自动化,以及整个产品家族。
---

# Forsion 文档

Forsion(扶桑)是一个 AI 驱动的桌面工作台:以 **Tangu** 智能体引擎为核心,把对话、笔记(**Amadeus**)、日历、自动化、收件箱、编码等能力装进一个可自由布局的工作区。你可以用官方云端模型开箱即用,也可以带自己的 API Key、订阅账号甚至本地模型——数据始终本地优先。

本文档面向使用者:每个功能是什么、怎么用、行为边界在哪里。

> 📌 文档对应 **Forsion Desktop 2.6+**。功能随版本演进,细节以应用内为准。

## 快速开始

- [Forsion 是什么](getting-started/introduction.md) — 产品家族与设计理念
- [安装与更新](getting-started/installation.md) — macOS / Windows / Linux
- [快速上手](getting-started/quickstart.md) — 十分钟跑通第一次对话与第一篇笔记
- [核心概念](getting-started/concepts.md) — 引擎、Agent、会话、Space、工作区

## 对话

- [对话基础](chat/basics.md) — 流式输出、思考过程、重新生成 / 分支 / 编辑
- [模型与接入方式](chat/models-and-providers.md) — 官方云端、自带 Key、订阅登录、自定义服务商
- [工具与审批](chat/tools-and-approvals.md) — 计划模式、审批卡、工具黑白名单、MCP
- [附件与图片](chat/attachments-and-vision.md) — 发图识图、文件预览、AI 生成的文件
- [群聊模式](chat/group-chat.md) — 多个 Agent 同场讨论

## Agent

- [Agent 总览](agents/overview.md) — 创建、配置、人格(SOUL)与资料库
- [记忆系统](agents/memory.md) — 每个 Agent 独立记忆,本地优先
- [Muse 主动助理](agents/muse.md) — 盯任务、活动感知、主动找你
- [技能(Skills)](agents/skills.md) — 给 AI 装"做事说明书"
- [外部引擎](agents/external-engines.md) — 接入 Claude Code 等第三方智能体

## Amadeus 笔记

- [Amadeus 总览](amadeus/overview.md) — 本地 Markdown 库、与 Obsidian 兼容
- [编辑器](amadeus/editor.md) — 块编辑、斜杠菜单、Markdown 快捷输入
- [双链与属性](amadeus/links-and-properties.md) — `[[双链]]`、子笔记、页面属性
- [多维表](amadeus/databases.md) — 列类型、多视图、筛选排序统计
- [白板](amadeus/whiteboard.md) — Excalidraw 兼容的无限画布
- [PDF 批注](amadeus/pdf-annotation.md) — 批注直接写进 PDF 文件
- [日历](amadeus/calendar.md) — 把表格与待办装进日历
- [云同步与共享](amadeus/cloud-and-sharing.md) — 云端库、页面分享、多人协作

## 空间(Spaces)

- [Space 总览](spaces/overview.md) — 功能空间的概念与管理
- [自动化](spaces/automation.md) — 定时 / 事件触发,让 Agent 自己干活
- [收件箱](spaces/inbox.md) — Agent 主动发给你的消息
- [编码空间](spaces/coding.md) — 写网页立即预览

## 个性化

- [主题与外观](customization/themes.md) — 设计语言、配色、主题包
- [插件](customization/plugins.md) — 桌面插件与引擎插件、安装渠道、安全模型
- [应用市场](customization/market.md) — 技能 / 代理 / 插件 / 空间 / 主题一站式安装
- [成就系统](customization/achievements.md) — 边探索边解锁

## 参考

- [命令行(Tangu CLI)](reference/cli.md) — 在终端里使用 Tangu
- [浏览器版与移动端](reference/web-and-mobile.md) — Forsion Web 与 Android 版
- [数据与隐私](reference/data-and-privacy.md) — 数据存在哪、什么会上云
- [常见问题](reference/faq.md) — 排障速查
