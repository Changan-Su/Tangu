/**
 * Forsion 应用市场:全屏 overlay(复刻设置页外壳 .settings-page)。
 * 四类:技能 / 智能体 / 插件(卡片浏览 → 详情 README → 一键安装到 ~/.tangu)+ 投稿(跳网页个人中心)。
 * 浏览/安装全走主进程 IPC(marketService),token 不下发渲染层。
 */
import { useEffect, useState, useCallback } from 'react'
import { ArrowLeft, Download, Check, Loader2, ExternalLink, PackageOpen } from 'lucide-react'
import { useI18n } from '../i18n'
import { useApp } from '../stores/appStore'
import { Markdown } from './Markdown'
import { listMarket, getMarketDetail, installMarket, listInstalled } from '../services/marketService'
import type { MarketCard, MarketDetail } from '../types'

type Tab = 'skill' | 'agent' | 'plugin' | 'submit'
const CONTENT_TABS: Tab[] = ['skill', 'agent', 'plugin']

export function MarketModal() {
  const { t } = useI18n()
  const close = useApp((s) => s.closeMarket)
  const toast = useApp((s) => s.toast)
  const [tab, setTab] = useState<Tab>('skill')
  const [items, setItems] = useState<MarketCard[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [installed, setInstalled] = useState<Record<string, string[]>>({})
  const [detail, setDetail] = useState<MarketDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)

  const refreshInstalled = useCallback(() => {
    listInstalled().then(setInstalled).catch(() => {})
  }, [])

  useEffect(() => { refreshInstalled() }, [refreshInstalled])

  useEffect(() => {
    if (tab === 'submit') return
    setDetail(null)
    setErr('')
    setLoading(true)
    listMarket(tab)
      .then(setItems)
      .catch((e) => setErr(t('market.loadFail', { e: e?.message || String(e) })))
      .finally(() => setLoading(false))
  }, [tab, t])

  const isInstalled = (c: MarketCard): boolean => (installed[c.type] || []).includes(c.installSlug)

  const onInstall = async (c: MarketCard): Promise<void> => {
    setInstalling(c.id)
    try {
      await installMarket(c.id)
      toast(t('market.installOk', { name: c.name }))
      refreshInstalled()
    } catch (e: any) {
      toast(t('market.installFail', { e: e?.message || String(e) }), true)
    } finally {
      setInstalling(null)
    }
  }

  const openDetail = (c: MarketCard): void => {
    setDetailLoading(true)
    setDetail(null)
    getMarketDetail(c.id)
      .then(setDetail)
      .catch((e) => toast(t('market.loadFail', { e: e?.message || String(e) }), true))
      .finally(() => setDetailLoading(false))
  }

  const installBtn = (c: MarketCard) => {
    const busy = installing === c.id
    const done = isInstalled(c)
    return (
      <button className={`btn sm ${done ? '' : 'primary'}`} disabled={busy} onClick={(e) => { e.stopPropagation(); void onInstall(c) }}>
        {busy ? <Loader2 size={13} className="mk-spin" /> : done ? <Check size={13} /> : <Download size={13} />}
        {busy ? t('market.installing') : done ? t('market.reinstall') : t('market.install')}
      </button>
    )
  }

  const navLabel: Record<Tab, string> = {
    skill: t('market.tab.skills'),
    agent: t('market.tab.agents'),
    plugin: t('market.tab.plugins'),
    submit: t('market.tab.submit'),
  }

  return (
    <div className="settings-page">
      <aside className="settings-nav" aria-label="Market navigation">
        <div className="settings-nav-top">
          <button className="settings-back" onClick={close}>
            <ArrowLeft size={15} /> {t('settings.backToApp')}
          </button>
        </div>
        <div className="settings-nav-list">
          <div className="settings-nav-group">
            <div className="settings-nav-grouphead">{t('market.title')}</div>
            {CONTENT_TABS.map((id) => (
              <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{navLabel[id]}</button>
            ))}
            <button className={tab === 'submit' ? 'active' : ''} onClick={() => setTab('submit')}>{navLabel.submit}</button>
          </div>
        </div>
      </aside>

      <section className="settings-main">
        <div className="settings-main-head">
          <div className="settings-main-title">{detail ? detail.name : navLabel[tab]}</div>
        </div>
        <div className="settings-body">
          {tab === 'submit' ? (
            <div className="mk-submit">
              <PackageOpen size={40} className="mk-submit-ic" />
              <p className="mk-submit-hint">{t('market.submitHint')}</p>
              <button className="btn primary" onClick={() => void window.tangu?.openAccountCenter?.('submission')}>
                <ExternalLink size={15} /> {t('market.submitOpen')}
              </button>
            </div>
          ) : detail ? (
            <div className="mk-detail">
              <button className="settings-back mk-detail-back" onClick={() => setDetail(null)}>
                <ArrowLeft size={14} /> {t('market.detailBack')}
              </button>
              <div className="mk-detail-head">
                <div>
                  <div className="mk-detail-title">{detail.name}</div>
                  <div className="mk-card-meta">
                    {t('market.author')} {detail.author} · {t('market.downloads', { n: detail.downloads })}
                  </div>
                </div>
                {installBtn(detail)}
              </div>
              {detail.githubRepoUrl && (
                <a className="mk-repo-link" href={detail.githubRepoUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={12} /> {t('market.openRepo')}
                </a>
              )}
              <div className="mk-readme">
                {detail.readme ? <Markdown content={detail.readme} /> : <span className="mk-muted">{t('market.readmeEmpty')}</span>}
              </div>
            </div>
          ) : loading || detailLoading ? (
            <div className="mk-state"><Loader2 size={20} className="mk-spin" /></div>
          ) : err ? (
            <div className="mk-state mk-error">{err}</div>
          ) : items.length === 0 ? (
            <div className="mk-state mk-muted">{t('market.empty')}</div>
          ) : (
            <div className="mk-grid">
              {items.map((c) => (
                <div key={c.id} className="mk-card" onClick={() => openDetail(c)}>
                  <div className="mk-card-title">{c.name}</div>
                  <div className="mk-card-summary">{c.summary || ''}</div>
                  <div className="mk-card-foot">
                    <span className="mk-card-meta">{t('market.author')} {c.author} · {t('market.downloads', { n: c.downloads })}</span>
                    {installBtn(c)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
