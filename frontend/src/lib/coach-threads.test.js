import { describe, it, expect } from 'vitest'
import { ensureThreads, pushMessage, newThread, switchThread, renameThread, deleteThread, offerTitle, autoTitle, searchThreads, groupThreads, threadLines, THREADS_MAX } from './coach-threads.js'

const line = (role, text, at) => ({ role, kind: 'text', text, at })

describe('ensureThreads', () => {
  it('folds an existing chat into Thread #1 and mirrors it back into chat', () => {
    const c = { chat: [line('user', 'hi', 1), line('coach', 'hello', 2)] }
    ensureThreads(c)
    expect(c.threads.length).toBe(1)
    expect(c.threads[0].title).toBe('Thread #1')
    expect(c.threads[0].messages.length).toBe(2)
    expect(c.threads[0].updatedAt).toBe(2)
    expect(c.activeThread).toBe(c.threads[0].id)
  })
  it('a profile without a chat gets one empty new thread', () => {
    const c = {}
    ensureThreads(c)
    expect(c.threads[0].title).toBe('New chat')
    expect(c.threads[0].messages).toEqual([])
  })
  it('is idempotent and repairs a dangling active id', () => {
    const c = { chat: [line('user', 'x', 1)] }
    ensureThreads(c); const id = c.activeThread
    c.activeThread = 'nope'
    ensureThreads(c)
    expect(c.threads.length).toBe(1)
    expect(c.activeThread).toBe(id)
  })
})

describe('messages and threads', () => {
  it('a message lands in the active thread, names it from the first user line, and keeps chat in sync', () => {
    const c = {}
    pushMessage(c, line('user', 'Why does my bench stall every time I add weight?'))
    expect(c.threads[0].title).toBe('Why does my bench stall every time I add…')
    expect(c.chat.length).toBe(1)
    expect(c.chat).toBe(c.threads[0].messages)
    pushMessage(c, line('user', 'another'))
    expect(c.threads[0].title).toBe('Why does my bench stall every time I add…')
  })
  it('new thread, switch, rename, delete', () => {
    const c = {}
    pushMessage(c, line('user', 'first'))
    const a = c.activeThread
    const b = newThread(c)
    expect(c.activeThread).toBe(b.id)
    expect(c.chat).toEqual([])
    expect(newThread(c)).toBe(b)   // an empty active thread is reused
    expect(switchThread(c, a)).toBe(true)
    expect(c.chat.length).toBe(1)
    expect(switchThread(c, 'nope')).toBe(false)
    expect(renameThread(c, a, '  Bench   stall ')).toBe(true)
    expect(c.threads.find(x => x.id === a).title).toBe('Bench stall')
    expect(renameThread(c, a, '   ')).toBe(false)
    expect(deleteThread(c, a)).toBe(true)
    expect(c.activeThread).toBe(b.id)
    expect(deleteThread(c, b.id)).toBe(true)
    expect(c.threads.length).toBe(1)
    expect(c.threads[0].messages).toEqual([])
  })
  it('the Coach may title a thread only while its title is still automatic', () => {
    const c = {}
    pushMessage(c, line('user', 'q'))
    const id = c.activeThread
    expect(offerTitle(c, id, 'Bench press stall')).toBe(false)
    const d = newThread(c)
    expect(offerTitle(c, d.id, 'Protein on rest days')).toBe(true)
    expect(d.title).toBe('Protein on rest days')
    expect(offerTitle(c, d.id, 'Other')).toBe(false)
  })
  it('keeps at most THREADS_MAX threads', () => {
    const c = {}
    for (let i = 0; i < THREADS_MAX + 5; i++) { newThread(c); pushMessage(c, line('user', 'm' + i)) }
    expect(c.threads.length).toBe(THREADS_MAX)
  })
})

describe('autoTitle', () => {
  it('first sentence, cut at a word', () => {
    expect(autoTitle('Short one. Then more.')).toBe('Short one.')
    expect(autoTitle('  lots   of   space  ')).toBe('lots of space')
    expect(autoTitle('x'.repeat(80))).toBe('x'.repeat(40) + '…')
  })
})

describe('search and timeline', () => {
  const day = 86400000
  const at = new Date(2026, 9, 23, 15).getTime()
  const th = (id, title, updatedAt, text = '') => ({ id, title, at: updatedAt, updatedAt, messages: text ? [line('user', text, updatedAt)] : [] })
  const threads = [th('a', 'Bench', at - 1000, 'stall'), th('b', 'Diet', at - day, 'protein'), th('c', 'Old', at - 5 * day), th('d', 'Older', at - 30 * day)]
  it('searches titles and messages, case-insensitively', () => {
    expect(searchThreads(threads, 'PROT').map(x => x.id)).toEqual(['b'])
    expect(searchThreads(threads, 'bench').map(x => x.id)).toEqual(['a'])
    expect(searchThreads(threads, '').length).toBe(4)
  })
  it('groups newest first into Today, Yesterday, Previous 7 days, Older', () => {
    const g = groupThreads(threads, at)
    expect(g.map(x => [x.label, x.threads.map(t => t.id)])).toEqual([['Today', ['a']], ['Yesterday', ['b']], ['Previous 7 days', ['c']], ['Older', ['d']]])
  })
})

describe('threadLines', () => {
  it('keeps user and coach text lines only, oldest first, bounded', () => {
    const th = { messages: [line('user', 'a'), { role: 'coach', kind: 'applied', text: 'x' }, { role: 'coach', kind: 'text', text: 'b' }, { role: 'coach', kind: 'nochange', text: 'c' }, { role: 'coach', kind: 'error', text: 'e' }] }
    expect(threadLines(th)).toEqual([{ who: 'user', text: 'a' }, { who: 'coach', text: 'b' }, { who: 'coach', text: 'c' }])
    expect(threadLines(th, { max: 1 })).toEqual([{ who: 'coach', text: 'c' }])
  })
})
