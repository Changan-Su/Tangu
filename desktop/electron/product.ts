/** 产品档案(主进程/preload 侧):同 frontend/src/product.ts 的注入约定。
 *  main 用它闸托管后端/CLI 自装;preload 用它收缩暴露面。 */
export interface ProductProfile {
  id: string
  displayName: string
  defaultSpace: string
  spaces: string[]
  agentBackend: boolean
  market: boolean
}

declare const __FORSION_PRODUCT__: ProductProfile | undefined

const FULL: ProductProfile = {
  id: 'forsion',
  displayName: 'Forsion',
  defaultSpace: 'tangu',
  spaces: ['tangu', 'inbox', 'amadeus'],
  agentBackend: true,
  market: true,
}

export const PRODUCT: ProductProfile = typeof __FORSION_PRODUCT__ === 'undefined' ? FULL : __FORSION_PRODUCT__
