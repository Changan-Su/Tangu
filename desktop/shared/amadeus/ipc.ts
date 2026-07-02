// The IPC contract shared by main (handlers), preload (bridge), and renderer (consumer).
import type { LoadedPage, PageManifest } from './compiler/types'

export const IPC = {
  openVault: 'vault:open',
  restoreVault: 'vault:restore',
  listPages: 'vault:list',
  loadPage: 'page:load',
  readPage: 'page:read',
  newPage: 'page:new',
  savePage: 'page:save',
  renamePage: 'page:rename',
  reconcilePage: 'page:reconcile',
  saveAsset: 'asset:save',
  saveAttachment: 'attachment:save',
  openAttachment: 'attachment:open',
  externalChange: 'page:external-change',
  search: 'vault:search',
  backlinks: 'vault:backlinks',
  reindex: 'vault:reindex',
  listTags: 'vault:tags',
  pagesByTag: 'vault:tag-pages',
  deletePage: 'page:delete',
  movePage: 'page:move',
  resolveEmbed: 'embed:resolve',
  blockBacklinks: 'embed:backlinks',
  listFolders: 'vault:folders',
  createFolder: 'folder:create',
  renameFolder: 'folder:rename',
  deleteFolder: 'folder:delete',
  structureChange: 'vault:structure-change',
  listPlugins: 'plugins:list',
  openPluginsFolder: 'plugins:open-folder',
  scaffoldPlugin: 'plugins:scaffold',
  revealInFileManager: 'shell:reveal',
} as const

/** A user plugin discovered under the vault's .amadeus/plugins/ folder. */
export interface ExternalPluginSource {
  id: string
  name: string
  version: string
  description?: string
  /** The plugin's main JS source; evaluated in the renderer with a `ctx` argument. */
  code: string
}

/** A full-text search hit (computed by the main-process vault index). */
export interface SearchHit {
  path: string
  title: string
  /** A short context window around the match, marker/frontmatter stripped. */
  snippet: string
  /** 1-based line number of the match within the cleaned text. */
  line: number
  score: number
}

/** A note that links to the active page via a [[wikilink]]. */
export interface BacklinkRef {
  path: string
  title: string
  /** The sentence/line containing the [[link]]. */
  snippet: string
}

/** Where a dragged-in attachment is stored (from Tangu notes settings). */
export interface AttachmentOpts {
  /** attachments=<笔记目录>/attachments/;same=与笔记同目录;vault=vault 内固定文件夹(见 folder)。 */
  mode: 'attachments' | 'same' | 'vault'
  /** mode==='vault' 时的 vault 相对文件夹(如 "assets")。 */
  folder: string
}

/** A resolved `![[ ]]` block embed: its owning note + the block's content. */
export interface EmbedResolved {
  /** owning note path, vault-relative (for "edit at source") */
  owner: string
  /** the block's raw markdown content */
  content: string
  /** the block's registered type (default "markdown") */
  type: string
}

/** A tag and how many notes use it. */
export interface TagCount {
  tag: string
  count: number
}

export interface VaultInfo {
  root: string
  /** Page paths relative to the vault root, e.g. "main.md", "Notes/ideas.md". */
  pages: string[]
  /** Sub-folder paths relative to the vault root (includes empty folders). */
  folders: string[]
  /** The page that was open last time (if it still exists). */
  lastPage?: string
}

/** The surface exposed on `window.amadeus` by the preload bridge. */
export interface AmadeusApi {
  openVault(): Promise<VaultInfo | null>
  /** Re-open the last vault (persisted across launches), or null if none/unavailable. */
  restoreVault(): Promise<VaultInfo | null>
  listPages(): Promise<string[]>
  loadPage(pagePath: string): Promise<LoadedPage>
  /** 只读加载(模板读取等):不写 lastPage,不算「打开」。 */
  readPage(pagePath: string): Promise<LoadedPage>
  newPage(pagePath: string): Promise<LoadedPage>
  savePage(pagePath: string, manifest: PageManifest, contents: Record<string, string>): Promise<void>
  /** Rename a page (same folder); rewrites manifest + all block sidecars + main.md. */
  renamePage(
    oldPath: string,
    newName: string,
    manifest: PageManifest,
    contents: Record<string, string>,
  ): Promise<{ newPath: string; page: LoadedPage }>
  /** Re-derive the model after an external main.md edit; main reads the new file from disk. */
  reconcilePage(
    pagePath: string,
    prevManifest: PageManifest,
    prevContents: Record<string, string>,
  ): Promise<LoadedPage>
  /** Save a pasted/dropped binary asset under the page's .amadeus/ folder.
   *  Returns the page-folder-relative path, e.g. ".amadeus/img-xyz.png". */
  saveAsset(pagePath: string, fileName: string, bytes: Uint8Array): Promise<string>
  /** Import a dragged-in file to the configured attachment location (keeps its name, de-duped).
   *  Returns the page-relative path (for `[name](rel)` links) + final basename (for `![[base]]`). */
  saveAttachment(
    pagePath: string,
    fileName: string,
    bytes: Uint8Array,
    opts: AttachmentOpts,
  ): Promise<{ pageRel: string; base: string }>
  /** Open an attachment (ref = page-relative path or bare basename) with the OS default app. */
  openAttachment(pagePath: string, ref: string): Promise<void>
  /** Subscribe to external main.md changes. Returns an unsubscribe function. */
  onExternalChange(cb: (pagePath: string) => void): () => void
  /** Full-text search across the vault (main-process index). */
  search(query: string): Promise<SearchHit[]>
  /** Notes that link to `pagePath` via a [[wikilink]]. */
  backlinks(pagePath: string): Promise<BacklinkRef[]>
  /** Force a full rebuild of the vault index. */
  reindex(): Promise<void>
  /** All tags in the vault with their note counts. */
  listTags(): Promise<TagCount[]>
  /** Page paths that carry the given tag. */
  pagesByTag(tag: string): Promise<string[]>
  /** Delete a page and all its sidecar files. */
  deletePage(pagePath: string): Promise<void>
  /** Move a page into another folder ('' = vault root); returns its new path. */
  movePage(pagePath: string, destFolder: string): Promise<string>
  /** Resolve a `![[ ]]` block embed target (by basename) to its content + owning note. */
  resolveEmbed(target: string): Promise<EmbedResolved | null>
  /** Notes that embed the given block basename (for safe-delete warnings). */
  blockBacklinks(target: string): Promise<BacklinkRef[]>
  /** All sub-folders (incl. empty), vault-relative. */
  listFolders(): Promise<string[]>
  /** Create a folder under `parentFolder` ('' = root); returns its vault-relative path. */
  createFolder(parentFolder: string, name: string): Promise<string>
  /** Rename a folder in place; returns its new vault-relative path. */
  renameFolder(folderPath: string, newName: string): Promise<string>
  /** Delete a folder and everything inside it. */
  deleteFolder(folderPath: string): Promise<void>
  /** Subscribe to vault structure changes (pages/folders added/removed). Returns unsubscribe. */
  onStructureChange(cb: () => void): () => void
  /** Discover user plugins under the vault's .amadeus/plugins/ folder. */
  listPlugins(): Promise<ExternalPluginSource[]>
  /** Open the vault's plugins folder in the OS file manager (creating it if needed). */
  openPluginsFolder(): Promise<void>
  /** Write a runnable sample plugin into the plugins folder. */
  scaffoldSamplePlugin(): Promise<void>
  /** Reveal a vault-relative file/folder in the OS file manager (Finder/Explorer), selecting it. */
  revealInFileManager(targetPath: string): Promise<void>
}

declare global {
  interface Window {
    amadeus: AmadeusApi
  }
}
