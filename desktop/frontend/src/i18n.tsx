/**
 * 轻量 i18n:中/英双语,默认中文,localStorage 持久化。
 * 用法:`const { t, locale, setLocale } = useI18n()`;`t('ns.key')` 或 `t('ns.key', { x })`(占位 {x})。
 * 字典是扁平 `key -> 文案`(对齐 AI Studio i18n)。缺失键回退:en 缺 → zh → key 本身。
 *
 * 各组件按命名空间拥有自己的键前缀(sidebar.* / input.* / chat.* / panel.* / settings.* /
 * about.* / onboarding.* / approval.* / tool.* / inquiry.* / thinking.* / toc.* / common.*)。
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

export type Locale = 'zh' | 'en'

const LS_KEY = 'tangu_locale'

export function resolveInitialLocale(): Locale {
  try {
    const v = localStorage.getItem(LS_KEY)
    if (v === 'en' || v === 'zh') return v
  } catch {
    /* ignore */
  }
  return 'zh' // 默认中文
}

type Dict = Record<string, string>

// ── 字典 ────────────────────────────────────────────────────────────────────
// 注:这里先放基础设施会用到的键 + 任务新增键;其余界面文案由全量翻译批次补入。
const zh: Dict = {
  'common.save': '保存',
  'common.cancel': '取消',
  'common.confirm': '确定',
  'common.close': '关闭',
  'common.back': '返回',
  'common.refresh': '刷新',
  'common.loading': '加载中…',
  'common.delete': '删除',
  'common.edit': '编辑',
  'common.open': '打开',
  'common.language': '语言',
  'common.copyCode': '复制代码',

  'locale.zh': '中文',
  'locale.en': 'English',
  'locale.toggleTitle': '切换语言',

  // 侧栏账号卡
  'sidebar.account.login': '登录 Forsion',
  'sidebar.account.loginHint': '登录后可用云端记忆 / 技能 / 托管模型(不登录也能正常使用)',
  'sidebar.account.loggingIn': '登录中…',
  'sidebar.account.center': '个人中心',
  'sidebar.account.logout': '登出',
  'sidebar.account.guest': '未登录',
  'sidebar.account.loginFail': '登录失败:{e}',
  'sidebar.settings': '设置 (Ctrl+,)',

  // 设置 - 关于
  'settings.tab.about': '关于',
  'about.version': '版本',
  'about.checkUpdates': '前往官网',
  'about.changelogTitle': '最新更新',
  'about.builtWith': 'Tangu Agent · Forsion 扶桑',

  // 设置 - 连接(云端地址改为只读/环境变量)
  'settings.cloud.envOnly': 'Forsion 云端地址由环境变量 TANGU_CLOUD_URL 设置(此处只读)。',
  'settings.cloud.label': 'Forsion 云端地址(大脑:记忆/技能/托管模型)',
  'settings.cloud.unset': '(未设置,用内置默认)',

  // 模型 / Provider 分组
  'model.group.forsion': 'Forsion 托管',
  'model.group.direct': '直连',
  'model.collapseAll': '全部折叠',
  'model.expandAll': '全部展开',
  'model.empty': '暂无模型',
  'model.searchPlaceholder': '搜索模型…',
}

const en: Dict = {
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.confirm': 'OK',
  'common.close': 'Close',
  'common.back': 'Back',
  'common.refresh': 'Refresh',
  'common.loading': 'Loading…',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.open': 'Open',
  'common.language': 'Language',
  'common.copyCode': 'Copy code',

  'locale.zh': '中文',
  'locale.en': 'English',
  'locale.toggleTitle': 'Switch language',

  'sidebar.account.login': 'Sign in to Forsion',
  'sidebar.account.loginHint': 'Sign in for cloud memory / skills / hosted models (works fine without signing in too)',
  'sidebar.account.loggingIn': 'Signing in…',
  'sidebar.account.center': 'Account Center',
  'sidebar.account.logout': 'Log out',
  'sidebar.account.guest': 'Not signed in',
  'sidebar.settings': 'Settings (Ctrl+,)',

  'settings.tab.about': 'About',
  'about.version': 'Version',
  'about.checkUpdates': 'Visit website',
  'about.changelogTitle': "What's New",
  'about.builtWith': 'Tangu Agent · Forsion',

  'settings.cloud.envOnly': 'The Forsion cloud URL is set via the TANGU_CLOUD_URL environment variable (read-only here).',
  'settings.cloud.label': 'Forsion cloud URL (brain: memory/skills/hosted models)',
  'settings.cloud.unset': '(unset — using built-in default)',

  'model.group.forsion': 'Forsion Hosted',
  'model.group.direct': 'Direct',
  'model.collapseAll': 'Collapse all',
  'model.expandAll': 'Expand all',
  'model.empty': 'No models',
  'model.searchPlaceholder': 'Search models…',
}

const DICTS: Record<Locale, Dict> = { zh, en }

/** 合并全量翻译批次产出的字典片段(键 -> {zh,en})。在模块加载时调用。 */
export function registerMessages(fragment: Record<string, { zh: string; en: string }>): void {
  for (const [key, val] of Object.entries(fragment)) {
    if (val.zh != null) zh[key] = val.zh
    if (val.en != null) en[key] = val.en
  }
}

function interpolate(s: string, vars?: Record<string, unknown>): string {
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (_m, k) => (k in vars ? String(vars[k]) : `{${k}}`))
}

interface I18nValue {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: string, vars?: Record<string, unknown>) => string
}

const I18nContext = createContext<I18nValue | null>(null)

export const LocaleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<Locale>(resolveInitialLocale)

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    try { localStorage.setItem(LS_KEY, l) } catch { /* ignore */ }
    try { document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en' } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    try { document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en' } catch { /* ignore */ }
  }, [locale])

  const value = useMemo<I18nValue>(() => ({
    locale,
    setLocale,
    t: (key, vars) => {
      const d = DICTS[locale]
      const s = d[key] ?? DICTS.zh[key] ?? key
      return interpolate(s, vars)
    },
  }), [locale, setLocale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (ctx) return ctx
  // Provider 缺失时的降级(不应发生):始终返回中文。
  return {
    locale: 'zh',
    setLocale: () => {},
    t: (key, vars) => interpolate(zh[key] ?? key, vars),
  }
}
