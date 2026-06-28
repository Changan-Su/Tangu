/** 会员等级徽章(forsion-ui tier-badge 规范):free 中性、plus 橙、pro 紫。 */
import React from 'react'

export const TierBadge: React.FC<{ tier?: string | null }> = ({ tier }) => {
  const t = (tier || 'free').toLowerCase()
  if (t === 'free' || !t) return null // free 不显示徽章(对齐 AI Studio)
  const style =
    t === 'pro'
      ? { background: 'linear-gradient(135deg, #8B5CF6, #A855F7)', color: '#fff', border: 'none' }
      : { background: 'linear-gradient(135deg, #F59E0B, #F97316)', color: '#fff', border: 'none' }
  return <span className="tier-badge" style={style}>{t}</span>
}
