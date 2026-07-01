// Watches the vault for external page (.md) edits — e.g. Obsidian writing main.md.
// Dot-sidecars/manifests are ignored; our own writes are filtered via the self-write ledger.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import type { VaultManager } from './vaultManager'

export class VaultWatcher {
  private watcher: FSWatcher | null = null

  constructor(
    private readonly vault: VaultManager,
    private readonly onExternalPageChange: (pagePath: string) => void,
    private readonly onStructureChange: () => void,
  ) {}

  start(root: string): void {
    this.stop()
    this.watcher = chokidar.watch(root, {
      ignoreInitial: true,
      depth: 12,
      ignored: (p: string) => {
        const base = path.basename(p)
        return base.startsWith('.') || base === 'node_modules'
      },
    })
    this.watcher.on('change', (abs) => {
      void this.handle(abs, root)
    })
    // Pages/folders added or removed externally → let the app refresh its tree + index.
    for (const ev of ['add', 'unlink', 'addDir', 'unlinkDir'] as const) {
      this.watcher.on(ev, (abs) => {
        if ((ev === 'add' || ev === 'unlink') && !abs.endsWith('.md')) return
        this.onStructureChange()
      })
    }
  }

  private async handle(abs: string, root: string): Promise<void> {
    if (!abs.endsWith('.md')) return
    let content = ''
    try {
      content = await fs.readFile(abs, 'utf8')
    } catch {
      return
    }
    // Ignore the echo of our own atomic writes.
    if (this.vault.wasSelfWrite(abs, content)) return
    this.onExternalPageChange(path.relative(root, abs))
  }

  stop(): void {
    if (this.watcher) {
      void this.watcher.close()
      this.watcher = null
    }
  }
}
