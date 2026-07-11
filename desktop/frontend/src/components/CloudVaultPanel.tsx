/**
 * 云端库面板(window.amadeusCollab 解闸;web/桌面同款):
 * 我的库切换 + 「与我共享」(页面级共享,点击进入) + 已发布链接管理。
 * 成员/邀请管理在每页的分享卡片(ShareCard)里,不在这里。
 */
import React, { useEffect, useState } from 'react'
import { X, Copy, Trash2, FolderOpen, Check, Users, Globe2 } from 'lucide-react'
import { useApp } from '../stores/appStore'
import { openNote } from '../amadeusNav'

export function CloudVaultPanel({ onClose }: { onClose: () => void }): React.ReactElement | null {
  const collab = window.amadeusCollab
  const toast = (t: string, err = false): void => useApp.getState().toast(t, err)
  const [vaults, setVaults] = useState<Array<{ id: string; name: string }>>([])
  const [activeId, setActiveId] = useState('')
  const [shared, setShared] = useState<Array<{ vaultId: string; path: string; title: string; role: string; ownerName: string | null }>>([])
  const [pubs, setPubs] = useState<Array<{ token: string; mode: string; path: string }>>([])
  const [quota, setQuota] = useState<{ publish: number } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const refresh = (): void => {
    if (!collab) return
    void collab.listVaults().then((v) => setVaults(v.map((x) => ({ id: x.id, name: x.name })))).catch(() => {})
    void collab.activeVaultId().then(setActiveId).catch(() => {})
    void collab.sharedWithMe().then(setShared).catch(() => setShared([]))
    void collab.publishes().then((r) => { setPubs(r.shares); setQuota(r.quota) }).catch(() => setPubs([]))
  }
  useEffect(refresh, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!collab) return null

  const copy = (url: string, key: string): void => {
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(null), 1200)
    })
  }

  return (
    <div className="amxc-overlay" onClick={onClose}>
      <div className="amxc-panel" onClick={(e) => e.stopPropagation()}>
        <div className="amxc-head">
          <span><FolderOpen size={14} /> 云端笔记库</span>
          <button className="amxc-x" onClick={onClose}><X size={14} /></button>
        </div>

        <div className="amxc-sec">我的库</div>
        {vaults.map((v) => (
          <button key={v.id} className={`amxc-row${v.id === activeId ? ' on' : ''}`}
            onClick={() => { if (v.id !== activeId) collab.switchVault(v.id) }}>
            <span className="amxc-row-name">{v.name}</span>
            {v.id === activeId && <Check size={13} />}
          </button>
        ))}

        <div className="amxc-sec"><Users size={12} /> 与我共享 · {shared.length}</div>
        {shared.length === 0 && <div className="amxc-hint">别人共享给你的页面会出现在这里(打开对方发的邀请链接并同意)。</div>}
        {shared.map((s) => (
          <button key={`${s.vaultId}:${s.path}`} className="amxc-row"
            onClick={() => {
              onClose()
              if (s.vaultId === activeId) void openNote(s.path)
              else collab.switchVault(s.vaultId) // 切库后树只显示共享范围(服务端过滤)
            }}>
            <span className="amxc-row-name">{s.title}</span>
            <span className="amxc-tag">{s.role === 'viewer' ? '只读' : '可编辑'}{s.ownerName ? ` · ${s.ownerName}` : ''}</span>
          </button>
        ))}

        <div className="amxc-sec"><Globe2 size={12} /> 已发布 · {pubs.length}{quota && Number.isFinite(quota.publish) ? ` / ${quota.publish}` : ''}</div>
        {pubs.length === 0 && <div className="amxc-hint">在笔记的「分享 → 发布」里生成公开链接,链接会列在这里。</div>}
        {pubs.map((s) => (
          <div key={s.token} className="amxc-row static">
            <span className="amxc-row-name" title={s.path}>{s.mode === 'subtree' ? '📁 ' : '📄 '}{s.path}</span>
            <button className="amxc-ic" title="复制链接" onClick={() => copy(collab.publishUrl(s.token), s.token)}>
              {copied === s.token ? <Check size={12} /> : <Copy size={12} />}
            </button>
            <button className="amxc-ic" title="取消发布"
              onClick={() => void collab.revokePublish(s.token).then(() => { toast('已取消发布,链接立即失效'); refresh() })}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
