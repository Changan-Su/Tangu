/** 默认日历库(种子名「Calendar」)显示名追加 Vault 后缀,区分多 Vault 汇总时的同名 Calendar
 *  (任务1:「每个 Vault 默认 Calendar db 名称加上 Vault 后缀,云端也是」)。纯展示——不改 .db 文件名;
 *  非默认名的库本就可区分,保留原名。 */
export function calDisplayName(name: string, vaultLabel: string): string {
  return name === 'Calendar' && vaultLabel ? `${name} · ${vaultLabel}` : name
}
