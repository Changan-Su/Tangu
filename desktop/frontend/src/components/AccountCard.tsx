/**
 * 侧栏左下角 Forsion 账号卡(对齐 AI Studio):
 *  - 已登录:头像(URL 或首字母)+ 昵称/用户名,点击 → 浏览器打开个人中心({cloudUrl}/account?token=);
 *    悬停露出「登出」。
 *  - 未登录:「登录 Forsion」按钮(浏览器设备码登录);不登录 Tangu 也能正常用。
 * 自管 authStatus(挂载即拉 + 监听 auth:device 推登录链接);登录/登出后回调 onAuthChange 让上层重连。
 */
import React, { useCallback, useEffect, useState } from 'react'
import { LogIn, LogOut, Loader2, UserRound } from 'lucide-react'
import type { AuthStatusInfo } from '../types'
import { useI18n } from '../i18n'

const AVATAR_COLORS = ['#E8743B', '#1B9E77', '#7570B3', '#D95F8E', '#3B86E8', '#11998E', '#C0392B', '#8E44AD']
function colorFor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export const AccountCard: React.FC<{
  onToast?: (text: string, error?: boolean) => void
  onAuthChange?: () => void
}> = ({ onToast, onAuthChange }) => {
  const { t } = useI18n()
  const [auth, setAuth] = useState<AuthStatusInfo | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)

  const refresh = useCallback(() => {
    void window.tangu?.authStatus?.().then(setAuth).catch(() => setAuth(null))
  }, [])

  useEffect(() => {
    refresh()
    // 登录设备码:浏览器没弹时把链接 toast 出来。
    const off = window.tangu?.onAuthDevice?.((info) => {
      if (info?.url) onToast?.(`${t('sidebar.account.center')}: ${info.url}${info.userCode ? ` (${info.userCode})` : ''}`)
    })
    return () => { off?.() }
  }, [refresh, onToast, t])

  const login = async (): Promise<void> => {
    if (!window.tangu?.forsionLogin) return
    setLoggingIn(true)
    try {
      await window.tangu.forsionLogin()
      refresh()
      onAuthChange?.()
    } catch (e: any) {
      onToast?.(t('sidebar.account.loginFail', { e: e?.message || e }), true)
    } finally {
      setLoggingIn(false)
    }
  }
  const logout = async (): Promise<void> => {
    await window.tangu?.forsionLogout?.().catch(() => {})
    refresh()
    onAuthChange?.()
  }
  const openCenter = (): void => { void window.tangu?.openAccountCenter?.() }

  if (!auth?.loggedIn) {
    return (
      <button className="account-card login" onClick={() => void login()} disabled={loggingIn} title={t('sidebar.account.loginHint')}>
        {loggingIn ? <Loader2 size={14} className="spin" /> : <LogIn size={14} />}
        <span className="account-name">{loggingIn ? t('sidebar.account.loggingIn') : t('sidebar.account.login')}</span>
      </button>
    )
  }

  const display = auth.nickname || auth.username || 'Forsion'
  return (
    <div className="account-card" role="button" tabIndex={0} title={t('sidebar.account.center')}
      onClick={openCenter}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCenter() } }}
    >
      {auth.avatar ? (
        <img className="account-avatar" src={auth.avatar} alt="" />
      ) : (
        <span className="account-avatar fallback" style={{ background: colorFor(display) }}>
          {display.trim().charAt(0).toUpperCase() || <UserRound size={13} />}
        </span>
      )}
      <span className="account-name">{display}</span>
      <button
        className="icon-btn account-logout"
        title={t('sidebar.account.logout')}
        onClick={(e) => { e.stopPropagation(); void logout() }}
      >
        <LogOut size={13} />
      </button>
    </div>
  )
}
