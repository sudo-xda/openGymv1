// A small Markdown reader for what the Coach writes back (views/CoachChat.jsx): headings, bullet
// and numbered lists, tables, callouts (block quotes), bold, italic and inline code. Nothing
// here touches the DOM — the parser returns a tree the Markdown component renders with React,
// so no string the model wrote is ever handed to innerHTML. Links are kept as their text only:
// a chat answer has nowhere safe to send anyone. A dependency-light app has no room for a
// Markdown library, and this covers what a coaching answer actually uses.

/** Inline runs: `{ t: 'text'|'b'|'i'|'code', text }`, nested for bold-inside-italic and so on. */
export function parseInline(src) {
  const out = []
  let text = ''
  const flush = () => { if (text) { out.push({ t: 'text', text }); text = '' } }
  let i = 0
  const s = String(src || '')
  while (i < s.length) {
    const c = s[i]
    // `code` — never styled inside, so it is read first.
    if (c === '`') {
      const end = s.indexOf('`', i + 1)
      if (end > i) { flush(); out.push({ t: 'code', text: s.slice(i + 1, end) }); i = end + 1; continue }
    }
    // **bold** and __bold__
    if ((c === '*' || c === '_') && s[i + 1] === c) {
      const end = s.indexOf(c + c, i + 2)
      if (end > i + 1) { flush(); out.push({ t: 'b', children: parseInline(s.slice(i + 2, end)) }); i = end + 2; continue }
    }
    // *italic* and _italic_ — a single marker with a non-space right after it. An underscore
    // inside a word (snake_case) is a letter, not a marker: the run has to start and end at a
    // word boundary.
    if ((c === '*' || c === '_') && s[i + 1] && !/\s/.test(s[i + 1]) && !(c === '_' && i > 0 && /\w/.test(s[i - 1]))) {
      const end = s.indexOf(c, i + 1)
      if (end > i + 1 && !/\s/.test(s[end - 1]) && !(c === '_' && /\w/.test(s[end + 1] || ''))) { flush(); out.push({ t: 'i', children: parseInline(s.slice(i + 1, end)) }); i = end + 1; continue }
    }
    // [text](url) keeps the text and drops the destination.
    if (c === '[') {
      const m = /^\[([^\]]+)\]\(([^)]*)\)/.exec(s.slice(i))
      if (m) { text += m[1]; i += m[0].length; continue }
    }
    text += c
    i++
  }
  flush()
  return out
}

const HEADING = /^(#{1,6})\s+(.*)$/
const BULLET = /^\s*[-*+]\s+(.*)$/
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/
const QUOTE = /^\s*>\s?(.*)$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
const FENCE = /^\s*```/

const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())

/**
 * Blocks: `{ t: 'h', level, children }`, `{ t: 'p', children }`, `{ t: 'ul'|'ol', items: [children] }`,
 * `{ t: 'quote', children }`, `{ t: 'table', head: [cells], rows: [[cells]] }`, `{ t: 'hr' }`,
 * `{ t: 'pre', text }`. A line that follows a paragraph line joins it, as Markdown reads it.
 */
export function parseMarkdown(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let i = 0
  const para = []
  const flushPara = () => {
    if (!para.length) return
    blocks.push({ t: 'p', children: parseInline(para.join(' ')) })
    para.length = 0
  }
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { flushPara(); i++; continue }
    if (FENCE.test(line)) {
      flushPara()
      const buf = []
      i++
      while (i < lines.length && !FENCE.test(lines[i])) buf.push(lines[i++])
      i++
      blocks.push({ t: 'pre', text: buf.join('\n') })
      continue
    }
    let m
    if ((m = HEADING.exec(line))) { flushPara(); blocks.push({ t: 'h', level: m[1].length, children: parseInline(m[2].replace(/\s+#+\s*$/, '')) }); i++; continue }
    if (RULE.test(line)) { flushPara(); blocks.push({ t: 'hr' }); i++; continue }
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      flushPara()
      const head = cells(line).map(parseInline)
      i += 2
      const rows = []
      while (i < lines.length && TABLE_ROW.test(lines[i])) rows.push(cells(lines[i++]).map(parseInline))
      blocks.push({ t: 'table', head, rows })
      continue
    }
    if (QUOTE.test(line)) {
      flushPara()
      const buf = []
      while (i < lines.length && QUOTE.test(lines[i])) buf.push(QUOTE.exec(lines[i++])[1])
      blocks.push({ t: 'quote', children: parseInline(buf.join(' ')) })
      continue
    }
    if (BULLET.test(line) || NUMBERED.test(line)) {
      flushPara()
      const ordered = NUMBERED.test(line)
      const items = []
      while (i < lines.length) {
        const b = ordered ? NUMBERED.exec(lines[i]) : BULLET.exec(lines[i])
        if (!b) break
        const item = [b[ordered ? 2 : 1]]
        i++
        // A wrapped item continues on indented lines that start no new item.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i])) item.push(lines[i++].trim())
        items.push(parseInline(item.join(' ')))
      }
      blocks.push({ t: ordered ? 'ol' : 'ul', items })
      continue
    }
    para.push(line.trim())
    i++
  }
  flushPara()
  return blocks
}

/** The plain words of a Markdown text, for a thread title or a copy without the markup. */
export function plainText(src) {
  const inline = nodes => nodes.map(n => (n.t === 'text' || n.t === 'code' ? n.text : inline(n.children || []))).join('')
  return parseMarkdown(src).map(b => {
    if (b.t === 'pre') return b.text
    if (b.t === 'hr') return ''
    if (b.t === 'ul' || b.t === 'ol') return b.items.map((it, i) => (b.t === 'ol' ? i + 1 + '. ' : '• ') + inline(it)).join('\n')
    if (b.t === 'table') return [b.head, ...b.rows].map(r => r.map(inline).join(' | ')).join('\n')
    return inline(b.children)
  }).filter(Boolean).join('\n\n')
}
