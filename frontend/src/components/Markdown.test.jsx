// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Markdown from './Markdown.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* The Coach's Markdown answer as elements, never as HTML: a string that looks like a tag stays
   text, and the shapes a coaching answer uses — a heading, a list, a table, a callout — land as
   the elements the stylesheet expects. */
describe('Markdown', () => {
  let host, root
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
  afterEach(() => { act(() => root.unmount()); host.remove() })

  it('renders headings, lists, tables and callouts as elements', () => {
    act(() => root.render(<Markdown text={'## Bench\n\n- one\n- **two**\n\n| a | b |\n|--|--|\n| 1 | 2 |\n\n> watch'} />))
    expect(host.querySelector('h3.md-h').textContent).toBe('Bench')
    expect(host.querySelectorAll('li').length).toBe(2)
    expect(host.querySelector('li strong').textContent).toBe('two')
    expect(host.querySelectorAll('td').length).toBe(2)
    expect(host.querySelector('.md-callout').textContent).toBe('watch')
  })

  it('never injects markup: a tag in the text is shown as text', () => {
    act(() => root.render(<Markdown text={'hello <img src=x onerror=alert(1)> there'} />))
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('p').textContent).toContain('<img src=x onerror=alert(1)>')
  })
})
