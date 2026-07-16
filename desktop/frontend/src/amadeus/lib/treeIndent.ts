/**
 * 笔记树的左缩进数学(纯函数 → 可测)。
 *
 * 树里有两种行,DOM 结构不同,却要让前导槽(.t2s-lead)落在**同一条竖线**上(用户要求:所有图标左对齐):
 *   笔记/附件行 = <button.t2s-srow style=paddingLeft>        [槽][名字]
 *   文件夹行   = <div.t2s-group style=paddingLeft><button.t2s-group-toggle>[槽][名字]
 * 文件夹行多套了一层 toggle,而 toggle 自带 4.5px 左内边距 —— 故其外层要**减掉**这 4.5px 才对齐。
 *
 * ⚠️ 这三个常量是 sidebar2.css 里 `.t2s-srow{padding-left}` / `.t2s-group-toggle{padding}` 的镜像,
 * 改 CSS 必须同步改这里(scripts/t2s-lead-icon.check.cjs 会拿真浏览器量出来钉住)。
 */

/** .t2s-srow 的基准左内边距。 */
export const ROW_PAD = 14
/** 每层缩进(= 原 sidebar2.css 的 14 × 0.765 取整档)。 */
export const INDENT = 10.5
/** .t2s-group-toggle 自带的左内边距。 */
export const TOGGLE_PAD = 4.5

/** 笔记/附件行的 padding-left。 */
export function rowPadLeft(depth: number): number {
  return ROW_PAD + depth * INDENT
}

/** 文件夹行外层(.t2s-group)的 padding-left —— 扣掉 toggle 自带内边距,槽才与笔记行对齐。 */
export function folderPadLeft(depth: number): number {
  return rowPadLeft(depth) - TOGGLE_PAD
}

/** 前导槽实际宽度(= --t2s-icon 16.9 + 1.5,见 sidebar2.css 的 .t2s-lead)。 */
export const LEAD_W = 18.4
/** 槽与名字之间的 gap(.t2s-srow / .t2sf-row / .t2s-folder-row 均为 5.5)。 */
export const LEAD_GAP = 5.5

/** 行内**名字**的左边缘 —— 给那些要与名字对齐、但本身没有槽的元素用(重命名输入框、「载入中…」占位)。 */
export function nameLeft(depth: number): number {
  return rowPadLeft(depth) + LEAD_W + LEAD_GAP
}
