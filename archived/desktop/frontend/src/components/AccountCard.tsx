/**
 * 侧栏左下角 Forsion 账号卡(forsion-ui UserProfileCard 规范):
 *  - 已登录:36px 头像(URL,或渐变圆+首字母)+ 昵称 + 会员徽章(TierBadge),副标题「用户中心」;
 *    整行可点击 → 浏览器打开个人中心(IPC auth:openAccountCenter);悬停露出「登出」。
 *  - 未登录:头像占位 + 「登录 / 注册」+ 副标题「点击登录」;不登录 Tangu 也能正常用。
 * 自管 authStatus(挂载即拉 + 监听 auth:device 推登录链接);登录/登出后回调 onAuthChange 让上层重连。
 */
import React, { useCallback, useEffect, useState } from 'react'
import { LogOut, Loader2 } from 'lucide-react'
import type { AuthStatusInfo } from '../types'
import { useI18n } from '../i18n'
import { TierBadge } from './TierBadge'

export const AccountCard: React.FC<{
  onToast?: (text: string, error?: boolean) => void
  onAuthChange?: () => void
  /** ribbon 紧凑态:只渲染头像钮(点击→个人中心/登录),无昵称/徽章/登出行。 */
  compact?: boolean
}> = ({ onToast, onAuthChange, compact }) => {
  const { t } = useI18n()
  const [auth, setAuth] = useState<AuthStatusInfo | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)
  const [imgError, setImgError] = useState(false)

  const refresh = useCallback(() => {
    setImgError(false)
    void window.tangu?.authStatus?.().then(setAuth).catch(() => setAuth(null))
  }, [])

  useEffect(() => {
    refresh()
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

  const loggedIn = !!auth?.loggedIn
  const display = auth?.nickname || auth?.username || 'Forsion'
  const initial = display.trim().charAt(0).toUpperCase() || 'F'

  if (compact) {
    return (
      <button
        className="ribbon-account"
        title={loggedIn ? display : t('sidebar.account.login')}
        onClick={() => (loggedIn ? openCenter() : void login())}
      >
        {loggedIn && auth?.avatar && !imgError ? (
          <img className="account-avatar" src={auth.avatar} alt="" onError={() => setImgError(true)} />
        ) : (
          <span className="account-avatar fallback">{loggingIn ? <Loader2 size={14} className="spin" /> : initial}</span>
        )}
      </button>
    )
  }

  return (
    <div
      className="account-card"
      role="button"
      tabIndex={0}
      title={loggedIn ? t('sidebar.account.center') : t('sidebar.account.loginHint')}
      onClick={() => (loggedIn ? openCenter() : void login())}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); loggedIn ? openCenter() : void login() } }}
    >
      {loggedIn && auth?.avatar && !imgError ? (
        <img className="account-avatar" src={auth.avatar} alt="" onError={() => setImgError(true)} />
      ) : (
        <span className="account-avatar fallback">{loggingIn ? <Loader2 size={14} className="spin" /> : initial}</span>
      )}
      <span className="account-meta">
        <span className="account-name-row">
          <span className="account-name">{loggedIn ? display : (loggingIn ? t('sidebar.account.loggingIn') : t('sidebar.account.login'))}</span>
          {loggedIn && <TierBadge tier={auth?.membershipTier} />}
        </span>
        <span className="account-sub">{loggedIn ? t('sidebar.account.center') : t('sidebar.account.loginSub')}</span>
      </span>
      {loggedIn && (
        <button className="icon-btn account-logout" title={t('sidebar.account.logout')} onClick={(e) => { e.stopPropagation(); void logout() }}>
          <LogOut size={13} />
        </button>
      )}
    </div>
  )
}
