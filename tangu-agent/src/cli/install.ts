/**
 * `tangu install` / `tangu uninstall` —— npm 式一条命令装/卸引擎插件。
 *
 * 安全立场(同 pi):插件以完整系统权限运行,装前展示来源+版本+完整性并要求确认。非交互环境(agent
 * 经 run_bash 跑本命令)拿不到 TTY,故先打印元数据 + 风险文案再 exit 2——agent 转述给用户,用户同意后
 * 补 `--yes` 重跑。安装动作本身零代码执行(见 npmInstall 文件头)。
 */
import { createInterface } from 'node:readline/promises';
import { parseInstallSpec, installPlugin, uninstallPlugin, InstallCancelled, type ConfirmInfo } from '../plugins/npmInstall.js';

interface Flags { yes: boolean; force: boolean; link: boolean; preferMirror: boolean; registry?: string }

function parseArgs(argv: string[]): { positional: string[]; flags: Flags } {
  const flags: Flags = { yes: false, force: false, link: false, preferMirror: false };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-y' || a === '--yes') flags.yes = true;
    else if (a === '--force') flags.force = true;
    else if (a === '--link') flags.link = true;
    else if (a === '--mirror') flags.preferMirror = true;
    else if (a === '--registry') flags.registry = argv[++i];
    else positional.push(a);
  }
  return { positional, flags };
}

async function askYesNo(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const a = (await rl.question(prompt)).trim().toLowerCase();
    return a === 'y' || a === 'yes';
  } finally {
    rl.close();
  }
}

const USAGE = '用法: tangu install npm:<包名>[@版本|@dist-tag] | <本地目录|.tgz> [--yes] [--force] [--link] [--registry <url>] [--mirror]';

export async function runInstallCommand(argv: string[]): Promise<number> {
  const { positional, flags } = parseArgs(argv);
  const raw = positional[0];
  if (!raw) { console.error(USAGE); return 2; }

  let spec;
  try { spec = parseInstallSpec(raw); } catch (e: any) { console.error(`✗ ${e?.message || e}`); return 2; }

  // 'need-yes' = 非交互且未 --yes(该退 2,提示补 --yes);'declined' = 交互下用户答 N(退 1)。
  let cancel: 'need-yes' | 'declined' | null = null;
  const confirm = async (info: ConfirmInfo): Promise<boolean> => {
    console.log('\n  即将安装插件:');
    console.log(`    包       ${info.name}@${info.version}`);
    console.log(`    来源     ${info.registry}`);
    if (info.integrity) console.log(`    完整性   ${info.integrity.slice(0, 28)}…`);
    if (info.unpackedSize) console.log(`    体积     ${(info.unpackedSize / 1024).toFixed(0)} KB`);
    console.log('\n  ⚠ 插件以你的完整系统权限运行。只安装你信任的来源;装前建议自审源码:');
    console.log(`    https://www.npmjs.com/package/${info.name}\n`);
    if (flags.yes) return true;
    if (!process.stdin.isTTY) { cancel = 'need-yes'; console.error('  非交互环境无法确认——确认无误后加 --yes 重跑。\n'); return false; }
    const ok = await askYesNo('  确认安装? [y/N] ');
    if (!ok) cancel = 'declined';
    return ok;
  };

  try {
    const r = await installPlugin(spec, raw, {
      force: flags.force,
      link: flags.link,
      preferMirror: flags.preferMirror,
      registry: flags.registry,
      confirm: spec.kind === 'npm' ? confirm : undefined, // 本地源=用户明确指定的文件,不强确认
      onLog: (l) => console.log(`  ${l}`),
    });
    console.log(`\n  ✓ 已安装 ${r.id}@${r.version}`);
    console.log(`    ${r.dir}`);
    console.log('    重启引擎(或桌面「设置 → 插件」刷新)后生效;`tangu plugins` 可查看。\n');
    return 0;
  } catch (e: any) {
    if (e instanceof InstallCancelled) { if (cancel !== 'need-yes') console.log('  已取消。'); return cancel === 'need-yes' ? 2 : 1; }
    console.error(`\n  ✗ 安装失败: ${e?.message || e}\n`);
    return 1;
  }
}

export async function runUninstallCommand(argv: string[]): Promise<number> {
  const { positional, flags } = parseArgs(argv);
  const id = positional[0];
  if (!id) { console.error('用法: tangu uninstall <插件id> [--yes]'); return 2; }

  if (!flags.yes) {
    if (!process.stdin.isTTY) { console.error(`  非交互环境无法确认卸载「${id}」——加 --yes 重跑。`); return 2; }
    if (!(await askYesNo(`  卸载插件「${id}」? [y/N] `))) { console.log('  已取消。'); return 1; }
  }
  try {
    const { dir } = await uninstallPlugin(id);
    console.log(`  ✓ 已卸载 ${id}(${dir})。重启引擎以完整移除其工具。`);
    return 0;
  } catch (e: any) {
    console.error(`  ✗ ${e?.message || e}`);
    return 1;
  }
}
