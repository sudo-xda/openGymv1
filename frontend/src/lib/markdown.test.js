import { describe, it, expect } from 'vitest'
import { parseInline, parseMarkdown, plainText } from './markdown.js'

describe('parseInline', () => {
  it('reads bold, italic and code, and keeps the rest as text', () => {
    expect(parseInline('a **b** _c_ `d` e')).toEqual([
      { t: 'text', text: 'a ' }, { t: 'b', children: [{ t: 'text', text: 'b' }] }, { t: 'text', text: ' ' },
      { t: 'i', children: [{ t: 'text', text: 'c' }] }, { t: 'text', text: ' ' }, { t: 'code', text: 'd' }, { t: 'text', text: ' e' }
    ])
  })
  it('does not style inside code, and leaves a lone marker alone', () => {
    expect(parseInline('`**x**`')).toEqual([{ t: 'code', text: '**x**' }])
    expect(parseInline('5 * 3 = 15')).toEqual([{ t: 'text', text: '5 * 3 = 15' }])
    expect(parseInline('snake_case_name')).toEqual([{ t: 'text', text: 'snake_case_name' }])
  })
  it('keeps a link as its words only', () => {
    expect(parseInline('see [this](https://x.y)')).toEqual([{ t: 'text', text: 'see this' }])
  })
})

describe('parseMarkdown', () => {
  it('reads headings, paragraphs, lists, quotes and rules', () => {
    const b = parseMarkdown('## Bench\n\nIt moved.\nTwice.\n\n- one\n- two\n  wrapped\n\n1. first\n2) second\n\n> watch it\n> closely\n\n---')
    expect(b.map(x => x.t)).toEqual(['h', 'p', 'ul', 'ol', 'quote', 'hr'])
    expect(b[0].level).toBe(2)
    expect(b[1].children).toEqual([{ t: 'text', text: 'It moved. Twice.' }])
    expect(b[2].items[1]).toEqual([{ t: 'text', text: 'two wrapped' }])
    expect(b[3].items.length).toBe(2)
    expect(b[4].children).toEqual([{ t: 'text', text: 'watch it closely' }])
  })
  it('reads a table with a separator row', () => {
    const b = parseMarkdown('| Lift | Best |\n|---|---:|\n| Bench | **80x5** |\n| Squat | 100x5 |')
    expect(b[0].t).toBe('table')
    expect(b[0].head.map(c => c[0].text)).toEqual(['Lift', 'Best'])
    expect(b[0].rows.length).toBe(2)
    expect(b[0].rows[0][1]).toEqual([{ t: 'b', children: [{ t: 'text', text: '80x5' }] }])
  })
  it('a pipe line without a separator is a paragraph, and a fence is kept verbatim', () => {
    const b = parseMarkdown('| not | a table |\n\n```\n**raw**\n```')
    expect(b[0].t).toBe('p')
    expect(b[1]).toEqual({ t: 'pre', text: '**raw**' })
  })
  it('never throws on empty or odd input', () => {
    expect(parseMarkdown('')).toEqual([])
    expect(parseMarkdown(null)).toEqual([])
    expect(parseMarkdown('***')).toEqual([{ t: 'hr' }])
  })
})

describe('plainText', () => {
  it('drops the markup and keeps the words', () => {
    expect(plainText('## Hi\n\n**bold** and `code`\n\n- a\n- b\n\n| x | y |\n|--|--|\n| 1 | 2 |')).toBe('Hi\n\nbold and code\n\n• a\n• b\n\nx | y\n1 | 2')
  })
})
