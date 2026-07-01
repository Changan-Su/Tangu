import { describe, expect, it } from 'vitest'
import { attachmentPaths } from './attachmentPaths'

describe('attachmentPaths', () => {
  it('attachments mode → sibling attachments/ folder', () => {
    expect(attachmentPaths('Notes/ideas.md', 'p.png', { mode: 'attachments', folder: 'assets' })).toEqual({
      destDirRel: 'Notes/attachments',
      fileVaultRel: 'Notes/attachments/p.png',
      pageRel: 'attachments/p.png',
    })
  })

  it('attachments mode at vault root', () => {
    expect(attachmentPaths('ideas.md', 'p.png', { mode: 'attachments', folder: '' })).toEqual({
      destDirRel: 'attachments',
      fileVaultRel: 'attachments/p.png',
      pageRel: 'attachments/p.png',
    })
  })

  it('same mode → note folder, flat', () => {
    expect(attachmentPaths('Notes/ideas.md', 'p.png', { mode: 'same', folder: 'assets' })).toEqual({
      destDirRel: 'Notes',
      fileVaultRel: 'Notes/p.png',
      pageRel: 'p.png',
    })
  })

  it('same mode at vault root', () => {
    expect(attachmentPaths('ideas.md', 'p.png', { mode: 'same', folder: 'assets' })).toEqual({
      destDirRel: '',
      fileVaultRel: 'p.png',
      pageRel: 'p.png',
    })
  })

  it('vault mode → fixed folder, page-relative steps up out of the note folder', () => {
    expect(attachmentPaths('Notes/ideas.md', 'p.png', { mode: 'vault', folder: '/assets/' })).toEqual({
      destDirRel: 'assets',
      fileVaultRel: 'assets/p.png',
      pageRel: '../assets/p.png',
    })
  })

  it('destDir is independent of the (deduped) base name', () => {
    const a = attachmentPaths('a/b.md', 'x.png', { mode: 'attachments', folder: '' }).destDirRel
    const b = attachmentPaths('a/b.md', 'x-1.png', { mode: 'attachments', folder: '' }).destDirRel
    expect(a).toBe(b)
  })
})
