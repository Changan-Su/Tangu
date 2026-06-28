/**
 * 主题 manifest schema(移植自 Forsion-AI-Studio themes/_schema/manifest.ts,机制同源)。
 * 新增主题:src/theme/themes/<id>/ 下放 theme.json(本 shape)+ theme.css,重启 dev 即被注册表收录。
 */
export interface ThemeManifest {
  /** 稳定 id,kebab-case,必须等于目录名。 */
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  /** 是否提供独立暗色样式(.dark[data-theme=…])。 */
  supportsDarkMode: boolean;
  /** 浮卡布局信号:>0 时 Shell 给停靠面板留间距(soft=8)。取代旧的 lang==='soft' 魔法字符串。 */
  panelGap?: number;
  tags?: string[];
  /** 主题激活时懒加载的 Google Fonts(离线环境会静默失败,主题需有本地字体回退)。 */
  fonts?: { google?: string[] };
  preview: ThemePreview;
}

export interface ThemePreview {
  background: string | { light: string; dark: string };
  accent: string;
  label?: string;
  title?: { text?: string };
  swatches?: string[];
  tagline?: string;
}

export interface ThemeEntry {
  manifest: ThemeManifest;
  /** bundle 主题:Vite 资源 URL,走 <link>。 */
  cssUrl?: string;
  /** 磁盘主题:主进程读回的 CSS 文本,走 <style>(CSP 禁 file://)。 */
  cssText?: string;
}
