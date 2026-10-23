// The Coach's conversations as threads (views/CoachChat.jsx): several, each with a title, the
// way a chat app keeps them. Pure over the coach namespace `c` (S.coach), called inside
// store.update, so the drawer's every move is testable without a screen.
//
// Shape: `c.threads = [{ id, title, at, updatedAt, messages: [...] }]`, `c.activeThread = id`.
// The messages are the lines appendChat always wrote (lib/coach.js). `c.chat` stays what it was —
// the active thread's lines — so everything that read the single conversation (the payload
// builder's `conversation`, the chat screen's job-ended effect) keeps reading it unchanged:
// `syncChat` copies the active thread into it after every change, and `ensureThreads` folds a
// profile's existing `chat` into its first thread on the first read.
import { uid } from './format.js'
import { t } from './i18n.js'

export const THREADS_MAX = 30
export const THREAD_MESSAGES_MAX = 60
export const TITLE_MAX = 60

const now = () => Date.now()
export const firstThreadTitle = () => t('Thread #1')
export const newThreadTitle = () => t('New chat')

/** Threads exist from here on; an older profile's single chat becomes its first thread. */
export function ensureThreads(c) {
  if (!Array.isArray(c.threads)) c.threads = []
  if (!c.threads.length) {
    const had = Array.isArray(c.chat) ? c.chat : []
    const at = had[0]?.at || now()
    c.threads.push({ id: uid(), title: had.length ? firstThreadTitle() : newThreadTitle(), at, updatedAt: had[had.length - 1]?.at || at, messages: [...had] })
  }
  if (!c.threads.some(th => th.id === c.activeThread)) c.activeThread = c.threads[c.threads.length - 1].id
  return c
}
export const activeThread = c => { ensureThreads(c); return c.threads.find(th => th.id === c.activeThread) }
/** `c.chat` mirrors the active thread, for everything that still reads the single conversation. */
export function syncChat(c) {
  const th = activeThread(c)
  c.chat = th.messages
  return th
}

/** A line into the active thread (what appendChat does once threads exist). */
export function pushMessage(c, entry) {
  const th = activeThread(c)
  const m = { ...entry, id: entry.id || uid(), at: entry.at || now() }
  th.messages = [...th.messages, m].slice(-THREAD_MESSAGES_MAX)
  th.updatedAt = m.at
  // The first thing the person says names the thread, until the Coach offers a better title.
  if (m.role === 'user' && m.kind === 'text' && m.text && (!th.title || th.title === newThreadTitle() || th.title === firstThreadTitle()) && th.messages.filter(x => x.role === 'user').length === 1) th.title = autoTitle(m.text)
  syncChat(c)
  return m
}

/** A line into one thread by id — the one a question was asked in, whichever is open now. */
export function pushMessageTo(c, threadId, entry) {
  ensureThreads(c)
  const th = c.threads.find(x => x.id === threadId)
  if (!th) return pushMessage(c, entry)
  const m = { ...entry, id: entry.id || uid(), at: entry.at || now() }
  th.messages = [...th.messages, m].slice(-THREAD_MESSAGES_MAX)
  th.updatedAt = m.at
  syncChat(c)
  return m
}

/** A fresh empty thread, made active. An empty active thread is reused rather than doubled. */
export function newThread(c) {
  ensureThreads(c)
  const cur = activeThread(c)
  if (cur && !cur.messages.length) { cur.updatedAt = now(); syncChat(c); return cur }
  const th = { id: uid(), title: newThreadTitle(), at: now(), updatedAt: now(), messages: [] }
  c.threads = [...c.threads, th].slice(-THREADS_MAX)
  c.activeThread = th.id
  syncChat(c)
  return th
}
export function switchThread(c, id) {
  ensureThreads(c)
  if (!c.threads.some(th => th.id === id)) return false
  c.activeThread = id
  syncChat(c)
  return true
}
export function renameThread(c, id, title) {
  const th = (c.threads || []).find(x => x.id === id)
  if (!th) return false
  const clean = String(title || '').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX)
  if (!clean) return false
  th.title = clean
  return true
}
/** Deleting the last thread leaves a fresh empty one, so the screen always has somewhere to type. */
export function deleteThread(c, id) {
  ensureThreads(c)
  const i = c.threads.findIndex(th => th.id === id)
  if (i < 0) return false
  c.threads = c.threads.filter(th => th.id !== id)
  if (!c.threads.length) c.threads.push({ id: uid(), title: newThreadTitle(), at: now(), updatedAt: now(), messages: [] })
  if (c.activeThread === id) c.activeThread = c.threads[c.threads.length - 1].id
  syncChat(c)
  return true
}
/** The Coach's own title for a thread that still carries an automatic one. */
export function offerTitle(c, id, title) {
  const th = (c.threads || []).find(x => x.id === id)
  if (!th || !title) return false
  const auto = !th.title || th.title === newThreadTitle() || th.title === firstThreadTitle() || th.autoTitled
  if (!auto) return false
  th.title = String(title).replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX)
  th.autoTitled = false
  return true
}

/** A title from a first message: its first sentence, cut at a word, at most 40 characters. */
export function autoTitle(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  const sentence = s.split(/(?<=[.!?])\s/)[0] || s
  if (sentence.length <= 40) return sentence
  const cut = sentence.slice(0, 41)
  const sp = cut.lastIndexOf(' ')
  return (sp >= 20 ? cut.slice(0, sp) : sentence.slice(0, 40)).trimEnd() + '…'
}

/** Case-insensitive search over titles and message text. */
export function searchThreads(threads, q) {
  const needle = String(q || '').trim().toLowerCase()
  if (!needle) return [...(threads || [])]
  return (threads || []).filter(th => (th.title || '').toLowerCase().includes(needle) || (th.messages || []).some(m => typeof m.text === 'string' && m.text.toLowerCase().includes(needle)))
}

/**
 * The drawer's timeline: newest first, under Today / Yesterday / Previous 7 days / Older. Each
 * group is `{ key, label, threads }`; empty groups are left out.
 */
export function groupThreads(threads, at = now()) {
  const day = ms => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() }
  const today = day(at)
  const keyOf = th => {
    const d = day(th.updatedAt || th.at || 0)
    if (d >= today) return 'today'
    if (d >= today - 86400000) return 'yesterday'
    if (d >= today - 7 * 86400000) return 'week'
    return 'older'
  }
  const labels = { today: () => t('Today'), yesterday: () => t('Yesterday'), week: () => t('Previous 7 days'), older: () => t('Older') }
  const sorted = [...(threads || [])].sort((a, b) => (b.updatedAt || b.at || 0) - (a.updatedAt || a.at || 0))
  return ['today', 'yesterday', 'week', 'older']
    .map(key => ({ key, label: labels[key](), threads: sorted.filter(th => keyOf(th) === key) }))
    .filter(g => g.threads.length)
}

/** The thread as the lines a chat job reads: who said what, oldest first, proposals left out. */
export function threadLines(th, { max = 12 } = {}) {
  return (th?.messages || [])
    .filter(m => m && typeof m.text === 'string' && m.text.trim() && ((m.role === 'user' && m.kind === 'text') || (m.role === 'coach' && (m.kind === 'text' || m.kind === 'nochange'))))
    .slice(-max)
    .map(m => ({ who: m.role === 'user' ? 'user' : 'coach', text: m.text.trim().slice(0, 400) }))
}
