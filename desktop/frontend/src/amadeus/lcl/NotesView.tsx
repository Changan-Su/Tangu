// The rebuilt Amadeus renderer, on the vendored LCL design language. One React tree, two
// looks: it renders into the .tangu-soft (圆润) or .tangu-lovable (纸感) base and reuses each
// base's own shell classes (exact LCL parity) via a per-language class map, plus the token
// bridge so the existing note components (PageView, panels) inherit the base look.

import { useEffect, useMemo, useState } from 'react'
import { usePageStore } from '../store/pageStore'
import { useUiStore } from '../store/uiStore'
import { useLclTheme, rootProps, type Lang } from './lclTheme'
import { PageView } from '../components/PageView'
import { OutlinePanel } from '../plugins/components/OutlinePanel'
import { BacklinksPanel } from '../components/BacklinksPanel'

type Cls = Record<string, string>
const MAP: Record<Lang, Cls> = {
  soft: {
    frame: 'ts-stage', grid: 'ts-grid',
    side: 'ts-card ts-side', brand: 'ts-brand', mark: 'ts-mark', group: 'ts-side-group',
    nav: 'ts-nav', navItem: 'ts-nav-item', dot: 'ts-nav-dot',
    account: 'ts-account', avatar: 'ts-avatar', accName: 'ts-account-name', accSub: 'ts-account-sub',
    mid: 'ts-col-mid', header: 'ts-card ts-header', title: 'ts-title', conn: 'ts-conn', connDot: 'd',
    iconBtn: 'ts-icon-btn', body: 'ts-chat',
    rail: 'ts-card ts-ws', railTabs: 'ts-ws-tabs', railTab: 'ts-ws-tab', railBody: 'ts-ws-body',
  },
  lovable: {
    frame: 'tg-window', grid: 'app',
    side: 'sidebar', brand: 'sidebar-brand', mark: 'tg-mark', group: 'ws-group-head',
    nav: 'ws-sessions', navItem: 'session-item', dot: 'session-dot',
    account: 'account-card', avatar: 'tg-avatar', accName: 'tg-acc-name', accSub: 'tg-tier',
    mid: 'main', header: 'chat-header', title: 'chat-title', conn: 'conn-pill', connDot: 'dot',
    iconBtn: 'icon-btn', body: 'chat-area',
    rail: 'right-panel', railTabs: 'right-panel-tabs', railTab: '', railBody: 'right-panel-body',
  },
}

type RailTab = 'outline' | 'backlinks' | 'words'

function statusLabel(s: string): string {
  return s === 'saving' ? '保存中…' : s === 'loading' ? '加载中…' : '已保存'
}
const baseName = (p: string): string => p.split('/').pop()!.replace(/\.md$/, '')

export function NotesView() {
  const t = useLclTheme()
  const lang = t.lang
  const C = MAP[lang]
  const lovable = lang === 'lovable'

  const pages = usePageStore((s) => s.pages)
  const activePage = usePageStore((s) => s.activePage)
  const vaultRoot = usePageStore((s) => s.vaultRoot)
  const manifest = usePageStore((s) => s.manifest)
  const blocks = usePageStore((s) => s.blocks)
  const status = usePageStore((s) => s.status)
  const loadPage = usePageStore((s) => s.loadPage)
  const setPalette = useUiStore((s) => s.setPalette)

  const [tab, setTab] = useState<RailTab>('outline')

  // Theme the whole document (body) so overlays — Settings, palettes, dialogs, context menus,
  // which render outside the shell root — inherit the active base + token bridge too.
  useEffect(() => {
    const el = document.body
    const rp = rootProps(t)
    const other = rp.className === 'tangu-soft' ? 'tangu-lovable' : 'tangu-soft'
    el.classList.add(rp.className)
    el.classList.remove(other)
    if (rp['data-theme']) el.dataset.theme = rp['data-theme']
    else delete el.dataset.theme
    if (rp['data-skin']) el.dataset.skin = rp['data-skin']
    else delete el.dataset.skin
    el.dataset.mode = rp['data-mode']
    el.dataset.flat = rp['data-flat']
    const keys: string[] = []
    if (rp.style) {
      for (const [k, v] of Object.entries(rp.style)) {
        el.style.setProperty(k, String(v))
        keys.push(k)
      }
    }
    return () => {
      el.classList.remove('tangu-soft', 'tangu-lovable')
      delete el.dataset.theme
      delete el.dataset.skin
      delete el.dataset.mode
      delete el.dataset.flat
      keys.forEach((k) => el.style.removeProperty(k))
    }
  }, [t, t.lang, t.softTheme, t.lovableSkin, t.mode, t.color, t.flat])

  const title = manifest?.title || (activePage ? baseName(activePage) : '')
  const vaultName = vaultRoot ? baseName(vaultRoot) : 'Vault'
  const { words, blockCount } = useMemo(() => {
    const vals = Object.values(blocks)
    return {
      words: vals.map((b) => b.content).join(' ').replace(/\s/g, '').length,
      blockCount: vals.length,
    }
  }, [blocks])

  // Inline #tags (a # glued to a word — not a markdown heading's "# "); for the sidebar strip.
  const tags = useMemo(() => {
    const set = new Set<string>()
    for (const b of Object.values(blocks))
      for (const m of b.content.matchAll(/(?:^|\s)#([0-9A-Za-z一-龥_][0-9A-Za-z一-龥_-]*)/g))
        set.add(m[1])
    return [...set].slice(0, 12)
  }, [blocks])
  const tagsEl = tags.length > 0 && (
    <div className="am-tags">{tags.map((tag) => <span key={tag} className="am-tag">#{tag}</span>)}</div>
  )

  const nav = (
    <nav className={C.nav}>
      {pages.length === 0 && <div className="am-empty">打开一个 Vault 开始</div>}
      {pages.map((p) => {
        const on = p === activePage
        return (
          <button
            key={p}
            className={`${C.navItem}${on ? (lovable ? ' active' : ' on') : ''}`}
            onClick={() => void loadPage(p)}
            title={p}
          >
            <span className={C.dot} style={{ background: on ? 'var(--accent)' : 'var(--ink-ghost, var(--text-ghost))' }} />
            <span className="am-nav-label">{baseName(p)}</span>
          </button>
        )
      })}
    </nav>
  )

  const account = lovable ? (
    <div className="sidebar-footer">
      <div className="account-card">
        <span className={C.avatar}>{vaultName.charAt(0).toUpperCase()}</span>
        <span className={C.accName}>{vaultName}</span>
        <span className={C.accSub}>Vault</span>
      </div>
      <button className="icon-btn" onClick={() => setPalette('settings')} title="设置">⚙</button>
    </div>
  ) : (
    <div className={C.account}>
      <span className={C.avatar}>{vaultName.charAt(0).toUpperCase()}</span>
      <span className={C.accName}>
        {vaultName}
        <span className={C.accSub}>本地 Vault</span>
      </span>
    </div>
  )

  const sidebar = (
    <aside className={C.side}>
      {lovable ? (
        <div className="sidebar-header">
          <div className={C.brand}><span className={C.mark}>扶</span> Amadeus</div>
        </div>
      ) : (
        <div className={C.brand}><span className={C.mark}>扶</span> Amadeus</div>
      )}
      {lovable ? (
        <div className="session-list">
          <div className={C.group}><span>▾ 笔记</span><span className="tg-count">{pages.length}</span></div>
          {nav}
          {tagsEl}
        </div>
      ) : (
        <>
          <div className={C.group}>文件库</div>
          {nav}
          {tags.length > 0 && <div className={C.group}>标签</div>}
          {tagsEl}
        </>
      )}
      {account}
    </aside>
  )

  const center = (
    <div className={C.mid}>
      <div className={C.header}>
        <button className={C.iconBtn} onClick={() => setPalette('command')} title="命令">◧</button>
        <span className={C.title}>{title || 'Amadeus'}</span>
        <span className={C.conn}><span className={C.connDot} /> {statusLabel(status)}</span>
        <button className={C.iconBtn} onClick={t.toggleMode} title="明暗">{t.mode === 'light' ? '☾' : '☀'}</button>
        <button
          className={C.iconBtn}
          onClick={() => t.setLang(lovable ? 'soft' : 'lovable')}
          title="切换设计语言"
        >
          ⤢
        </button>
        <button className={C.iconBtn} onClick={() => setPalette('settings')} title="设置">⋯</button>
      </div>
      <div className={C.body}>
        <div className={lovable ? 'stream-inner am-note-doc' : undefined}>
          <div className="am-note-title">{title}</div>
          <div className="am-note-meta">
            <span>{blockCount} 块</span>
            <span>{words} 字</span>
          </div>
          <PageView bare />
        </div>
      </div>
    </div>
  )

  const rail = (
    <aside className={C.rail}>
      <div className={C.railTabs}>
        <button className={`${C.railTab} ${tab === 'outline' ? (lovable ? 'active' : 'on') : ''}`} onClick={() => setTab('outline')}>大纲</button>
        <button className={`${C.railTab} ${tab === 'backlinks' ? (lovable ? 'active' : 'on') : ''}`} onClick={() => setTab('backlinks')}>反链</button>
        <button className={`${C.railTab} ${tab === 'words' ? (lovable ? 'active' : 'on') : ''}`} onClick={() => setTab('words')}>字数</button>
      </div>
      <div className={C.railBody}>
        {tab === 'outline' && <OutlinePanel />}
        {tab === 'backlinks' && <BacklinksPanel />}
        {tab === 'words' && (
          <div className="am-words">
            <div className="am-words-n">{words}</div>
            <div className="am-words-l">字 · {blockCount} 块</div>
          </div>
        )}
      </div>
    </aside>
  )

  const rp = rootProps(t)
  return (
    <div
      className={`am-app ${rp.className}`}
      data-theme={rp['data-theme']}
      data-skin={rp['data-skin']}
      data-mode={rp['data-mode']}
      data-flat={rp['data-flat']}
      style={rp.style}
    >
      <div className={C.frame}>
        <div className={C.grid}>
          {sidebar}
          {center}
          {rail}
        </div>
      </div>
    </div>
  )
}
