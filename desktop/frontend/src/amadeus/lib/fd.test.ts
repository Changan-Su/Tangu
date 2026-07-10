import { describe, it, expect } from 'vitest'
import { computeFdChildren, fdDirOf, isFdDir, isNoteMd, nearestFd, noteOfFd } from './fd'

describe('fd 路径约定', () => {
  it('fdDirOf / noteOfFd 互逆,X.fd.md 无歧义', () => {
    expect(fdDirOf('Notes/Diary.md')).toBe('Notes/Diary.fd')
    expect(noteOfFd('Notes/Diary.fd')).toBe('Notes/Diary.md')
    expect(fdDirOf('X.fd.md')).toBe('X.fd.fd') // 笔记名本身带 .fd 后缀也成对
    expect(isNoteMd('a/b.md')).toBe(true)
    expect(isFdDir('a/b.fd')).toBe(true)
    expect(isFdDir('a/b.fda')).toBe(false)
  })

  it('nearestFd:最近 .fd 祖先段', () => {
    expect(nearestFd('Notes/Diary.fd/x.md')).toBe('Notes/Diary.fd')
    expect(nearestFd('Diary.fd/Sub.fd/y.md')).toBe('Diary.fd/Sub.fd')
    expect(nearestFd('Notes/x.md')).toBeNull()
    expect(nearestFd('x.md')).toBeNull()
  })

  it('computeFdChildren:仅直接子文件,pages+files 并集,basename 字典序', () => {
    const pages = ['Diary.md', 'Diary.fd/b-note.md', 'Diary.fd/Sub.fd/deep.md', 'Other.md']
    const files = ['Diary.fd/a-打卡.db', 'Diary.fd/attachments/img.png', 'root.db']
    expect(computeFdChildren('Diary.md', pages, files)).toEqual(['a-打卡.db', 'b-note.md'])
    expect(computeFdChildren('Other.md', pages, files)).toEqual([])
  })
})
