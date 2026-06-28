/** 空状态(新视觉):Forsion 品牌整图(奶油瓦片+神树,同启动加载页;明暗双版)+ 诗句 + 副标。 */
import { BrandLogo } from '../../components/BrandLogo'
import { useI18n } from '../../i18n'
import './chat2.css'

export function EmptyState2({ title, subtitle }: { title?: string; subtitle?: string }) {
  const { t } = useI18n()
  return (
    <div className="t2-empty">
      <div className="t2-empty-mark"><BrandLogo size={64} /></div>
      <div className="t2-empty-title">{title || t('chat.emptyTitle')}</div>
      <div className="t2-empty-sub">{subtitle || t('chat.emptyHint')}</div>
    </div>
  )
}
