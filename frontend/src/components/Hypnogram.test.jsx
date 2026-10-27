// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Hypnogram from './Hypnogram.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let container, root
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
afterEach(() => { act(() => root.unmount()); container.remove() })

describe('Hypnogram', () => {
  it('draws one block per stage on its row, awake at the top and deep at the bottom, with hour ticks', () => {
    const t0 = new Date(2026, 9, 25, 23, 10).getTime()
    const h = n => t0 + n * 3600000
    const stages = [[h(0), h(0.5), 'light'], [h(0.5), h(1.5), 'deep'], [h(1.5), h(2), 'rem'], [h(2), h(2.2), 'awake'], [h(2.2), h(7), 'light']]
    act(() => root.render(<Hypnogram stages={stages} from={h(0)} to={h(7)} />))
    const rects = [...container.querySelectorAll('rect')]
    expect(rects).toHaveLength(5)
    const y = cls => Number(rects.find(r => r.getAttribute('class') === cls).getAttribute('y'))
    expect(y('awake')).toBeLessThan(y('rem')); expect(y('rem')).toBeLessThan(y('light')); expect(y('light')).toBeLessThan(y('deep'))
    const labels = [...container.querySelectorAll('text')].map(n => n.textContent)
    expect(labels).toEqual(expect.arrayContaining(['Awake', 'REM', 'Light', 'Deep']))
    expect(labels.filter(l => /:00/.test(l)).length).toBeGreaterThanOrEqual(3)
  })
  it('renders nothing for fewer than two segments', () => {
    act(() => root.render(<Hypnogram stages={[[1, 2, 'light']]} />))
    expect(container.querySelector('svg')).toBeNull()
  })
})
