/** Forsion 品牌标(非 admin 应用统一 Forsion-LOGO3.svg;经 vite asset 引入)。 */
import React from 'react'
import logoUrl from '../assets/Forsion-LOGO3.svg'

export const BrandLogo: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <img src={logoUrl} width={size} height={size} alt="Forsion" draggable={false} />
)
