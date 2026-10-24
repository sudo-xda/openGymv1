import { describe, expect, it } from 'vitest'
import { workoutCardModel, layoutWorkoutCard, wrapText, parseColor, mixColor, mapColors, viewAspect, MAX_RECORDS, CARD_WIDTH } from './workout-card.js'
import { fmtDate } from './format.js'

// #453: a finished workout shared as a picture. A fake measure stands in for the canvas — every
// character is half its font size wide — so the layout can be checked without one.
const measure = (text, weight, size) => String(text).length * size * 0.5

describe('workoutCardModel', () => {
  const names = { bench: 'barbell bench press', curl: 'dumbbell curl', lunge: 'dumbbell lunge' }
  const nameOf = e => names[e.id] || e.id
  const w = {
    id: 'w1', d: '2026-09-03', start: 0, end: 58 * 60000, name: 'Push', vol: 1790,
    prs: ['curl', 'bench', 'curl'],
    entries: [
      { id: 'bench', target: { mode: 'reps' }, sets: [
        { w: 40, r: 8, done: true, phase: 'warmup' },
        { w: 60, r: 8, done: true },
        { w: 60, r: 6, done: true },
        { w: 60, r: 8, done: false },
      ] },
      { id: 'curl', target: { mode: 'reps' }, sets: [{ w: 12, r: 10, done: true }] },
      { id: 'lunge', target: { mode: 'reps', side: true }, sets: [
        { w: 10, r: 16, done: true, sides: { L: { w: 10, r: 8, done: true }, R: { w: 10, r: 8, done: true } } },
      ] },
    ],
  }

  const stat = m => m.stats.map(s => s.label + ' ' + s.value)

  it('says the name, the dated day, duration, work sets and volume', () => {
    const m = workoutCardModel(w, { unit: 'kg', nameOf })
    expect(m.title).toBe('Push')
    expect(m.date).toBe(fmtDate('2026-09-03', true, true))
    // 2 bench work sets (the warm-up and the unticked set are not counted), 1 curl, and the
    // per-side lunge set once per side.
    expect(stat(m)).toEqual(['Duration 58 min', 'Sets 5', 'Volume 1,790 kg'])
  })

  it('lists each new best once, in the order the workout lists the exercises, title-cased', () => {
    expect(workoutCardModel(w, { unit: 'kg', nameOf }).records).toEqual(['Barbell Bench Press', 'Dumbbell Curl'])
  })

  it('leaves out a duration it does not know and works the volume out when none was saved', () => {
    const imported = { ...w, start: undefined, end: undefined, vol: undefined, prs: undefined }
    const m = workoutCardModel(imported, { unit: 'lb', nameOf })
    // 60×8 + 60×6 bench, 12×10 curl, 10×8 a side on the lunge; the warm-up adds nothing.
    expect(stat(m)).toEqual(['Sets 5', 'Volume 1,120 lb'])
    expect(m.records).toEqual([])
  })

  it('carries the session\'s muscle map, shaded against its own hardest-worked muscle', () => {
    const bench = { ...w, entries: [{ id: '0025', target: { mode: 'reps' }, sets: [
      { w: 40, r: 8, done: true, phase: 'warmup' }, { w: 60, r: 8, done: true }, { w: 60, r: 8, done: false },
    ] }] }
    const { levels } = workoutCardModel(bench, { unit: 'kg', nameOf })
    expect(levels.chest).toBe(4)
    expect(levels.triceps).toBeGreaterThan(0)
    expect(levels.quadriceps).toBe(0)
  })

  it('has no muscle map when no set reached a muscle the map shows', () => {
    expect(workoutCardModel(w, { unit: 'kg', nameOf }).levels).toBeNull()
  })
})

describe('wrapText', () => {
  const width = 100
  const m = s => s.length * 10

  it('keeps a line that fits as it is', () => {
    expect(wrapText('Leg day', width, m, 2)).toEqual(['Leg day'])
  })

  it('wraps at words and cuts the last line with an ellipsis when it runs out of lines', () => {
    const lines = wrapText('upper body strength and conditioning', width, m, 2)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('upper body')
    expect(lines[1].endsWith('…')).toBe(true)
    for (const line of lines) expect(m(line)).toBeLessThanOrEqual(width)
  })

  it('cuts a single word wider than the line instead of overflowing', () => {
    const [line] = wrapText('Oberkörpertrainingseinheit', width, m, 1)
    expect(line.endsWith('…')).toBe(true)
    expect(m(line)).toBeLessThanOrEqual(width)
  })
})

describe('layoutWorkoutCard', () => {
  const model = {
    title: 'Push', date: 'Thu, 3 Sep 2026',
    stats: [{ label: 'Duration', value: '58 min' }, { label: 'Sets', value: '5' }, { label: 'Volume', value: '1,790 kg' }],
    records: ['Barbell Bench Press'],
    levels: { chest: 4 },
  }
  const texts = layout => layout.items.filter(i => i.kind === 'text').map(i => i.text)
  const kinds = (layout, kind) => layout.items.filter(i => i.kind === kind)
  const map = { aspect: 1280 / 727 }

  it('stacks the title, date, stat tiles, records and the openGym footer, top to bottom', () => {
    const layout = layoutWorkoutCard(model, { measure })
    expect(layout.width).toBe(CARD_WIDTH)
    expect(texts(layout)).toEqual(['Push', 'Thu, 3 Sep 2026', 'Duration', '58 min', 'Sets', '5', 'Volume', '1,790 kg', 'New personal records', 'Barbell Bench Press', 'openGym'])
    expect(kinds(layout, 'tile')).toHaveLength(3)
    expect(kinds(layout, 'trophy')).toHaveLength(1)
    const ys = layout.items.filter(i => i.kind === 'text' && !['Sets', '5', 'Volume', '1,790 kg'].includes(i.text)).map(i => i.y)
    expect([...ys].sort((a, b) => a - b)).toEqual(ys)
    expect(Math.max(...ys)).toBeLessThan(layout.height)
  })

  it('lays the tiles out side by side, equal and inside the card', () => {
    const tiles = kinds(layoutWorkoutCard(model, { measure }), 'tile')
    expect(new Set(tiles.map(t => t.w)).size).toBe(1)
    expect(new Set(tiles.map(t => t.y)).size).toBe(1)
    for (let i = 1; i < tiles.length; i++) expect(tiles[i].x).toBeGreaterThan(tiles[i - 1].x + tiles[i - 1].w)
    expect(tiles[2].x + tiles[2].w).toBeLessThanOrEqual(CARD_WIDTH)
  })

  it('shrinks a number too wide for its tile instead of running into the next one', () => {
    const big = { ...model, stats: [...model.stats.slice(0, 2), { label: 'Volume', value: '123,456,789.5 kg' }] }
    const layout = layoutWorkoutCard(big, { measure })
    const tile = kinds(layout, 'tile')[2]
    const value = layout.items.find(i => i.text === '123,456,789.5 kg')
    expect(value.size).toBeLessThan(56)
    expect(value.x + measure(value.text, value.weight, value.size)).toBeLessThanOrEqual(tile.x + tile.w)
  })

  it('keeps every line inside the card', () => {
    const long = { ...model, title: 'A very long routine name that will never fit on one line of the card at all', records: ['an exercise with a name far too long to fit on one line of the card'] }
    const layout = layoutWorkoutCard(long, { measure, map })
    for (const item of layout.items.filter(i => i.kind === 'text')) {
      expect(item.x + measure(item.text, item.weight, item.size), item.text).toBeLessThanOrEqual(layout.width)
    }
  })

  it('adds the front and back of the body, centred, with a less-to-more legend, when asked', () => {
    const without = layoutWorkoutCard(model, { measure })
    const layout = layoutWorkoutCard(model, { measure, map })
    expect(kinds(without, 'map')).toHaveLength(0)
    const [front, back] = kinds(layout, 'map')
    expect([front.view, back.view]).toEqual(['front', 'back'])
    expect(front.h / front.w).toBeCloseTo(map.aspect)
    expect(front.x - 0).toBeCloseTo(CARD_WIDTH - (back.x + back.w))
    expect(kinds(layout, 'swatch').map(s => s.level)).toEqual([0, 1, 2, 3, 4])
    expect(texts(layout)).toEqual(expect.arrayContaining(['Less', 'More']))
    expect(layout.height).toBeGreaterThan(without.height)
    // The map sits between the tiles and the records.
    const tilesEnd = Math.max(...kinds(layout, 'tile').map(t => t.y + t.h))
    const records = layout.items.find(i => i.text === 'New personal records')
    expect(front.y).toBeGreaterThan(tilesEnd)
    expect(records.y).toBeGreaterThan(front.y + front.h)
  })

  it('leaves the map out of a card whose workout has none, even when asked', () => {
    expect(kinds(layoutWorkoutCard({ ...model, levels: null }, { measure, map }), 'map')).toHaveLength(0)
  })

  it('counts the new bests past the limit instead of growing without end', () => {
    const many = { ...model, records: Array.from({ length: 9 }, (_, i) => 'lift ' + i) }
    const layout = layoutWorkoutCard(many, { measure })
    expect(kinds(layout, 'trophy')).toHaveLength(MAX_RECORDS - 1)
    expect(texts(layout)).toContain('and 4 more')
  })

  it('leaves the records section out when there are none', () => {
    const layout = layoutWorkoutCard({ ...model, records: [] }, { measure })
    expect(texts(layout)).not.toContain('New personal records')
    expect(layout.items.some(i => i.kind === 'trophy')).toBe(false)
  })

  it('mirrors for a right-to-left language: lines start at the right edge, tiles run right to left', () => {
    const ltr = layoutWorkoutCard(model, { measure, map })
    const rtl = layoutWorkoutCard(model, { measure, map, rtl: true })
    expect(rtl.rtl).toBe(true)
    const title = l => l.items.find(i => i.text === 'Push')
    expect(title(rtl).x).toBe(rtl.width - title(ltr).x)
    expect(kinds(rtl, 'trophy')[0].x).toBeGreaterThan(rtl.width / 2)
    const first = l => kinds(l, 'tile')[0]
    expect(first(rtl).x + first(rtl).w).toBeCloseTo(rtl.width - first(ltr).x)
    expect(kinds(rtl, 'swatch').map(s => s.level)).toEqual([4, 3, 2, 1, 0])
  })
})

describe('card colours', () => {
  it('reads hex and rgb colours, and nothing else', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1])
    expect(parseColor('#30d158')).toEqual([48, 209, 88, 1])
    expect(parseColor('rgba(235,235,245,.6)')).toEqual([235, 235, 245, 0.6])
    expect(parseColor('rgb(10 20 30 / 50%)')).toEqual([10, 20, 30, 0.5])
    expect(parseColor('var(--acc)')).toBeNull()
  })

  it('mixes the way CSS color-mix(in srgb) does', () => {
    expect(mixColor('#ffffff', '#000000', 0.5)).toBe('rgb(128, 128, 128)')
    expect(mixColor('#30d158', '#1c1c1e', 1)).toBe('rgb(48, 209, 88)')
    // An unreadable colour falls back to the other one rather than to black.
    expect(mixColor('nonsense', '#1c1c1e', 0.5)).toBe('#1c1c1e')
  })

  it('shades the map from the surface towards the accent, five steps, as the app does', () => {
    const { sil, levels } = mapColors({ label: '#ffffff', surface: '#000000', acc: '#ff0000' })
    expect(sil).toBe('rgb(46, 46, 46)')
    expect(levels[0]).toBe('rgb(28, 28, 28)')
    expect(levels[4]).toBe('#ff0000')
    const reds = levels.slice(0, 4).map(c => parseColor(c)[0])
    expect([...reds].sort((a, b) => a - b)).toEqual(reds)
  })

  it('flattens a see-through label onto the surface first, as the light theme needs', () => {
    const { levels } = mapColors({ label: 'rgba(0,0,0,.5)', surface: '#ffffff', acc: '#0000ff' })
    // Half-black over white is mid-grey; 11 % of that over white.
    expect(levels[0]).toBe('rgb(241, 241, 241)')
  })

  it('reads a body view\'s height over its width from its viewBox', () => {
    expect(viewAspect({ vb: '0 95 727 1280' })).toBeCloseTo(1280 / 727)
    expect(viewAspect({})).toBeGreaterThan(1)
  })
})

describe('top lifts and the PR badge', () => {
  const names = { bench: 'barbell bench press', curl: 'dumbbell curl', plank: 'plank' }
  const nameOf = e => names[e.id] || e.id
  const w = {
    id: 'w2', d: '2026-09-03', start: 0, end: 40 * 60000, name: 'Push', vol: 1000, prs: ['bench', 'curl'],
    entries: [
      { id: 'bench', target: { mode: 'reps' }, sets: [{ w: 60, r: 8, done: true }, { w: 70, r: 3, done: true }] },
      { id: 'curl', target: { mode: 'reps' }, sets: [{ w: 12, r: 10, done: true }] },
      { id: 'plank', target: { mode: 'time' }, sets: [{ sec: 60, done: true }] },
    ],
  }
  it('names the heaviest sets by estimated 1RM, the timed work left out, and counts the PRs', () => {
    const m = workoutCardModel(w, { unit: 'kg', nameOf })
    expect(m.prCount).toBe(2)
    expect(m.topLifts).toEqual([{ name: 'Barbell Bench Press', line: '70 kg × 3' }, { name: 'Dumbbell Curl', line: '12 kg × 10' }])
  })
})

describe('story and square formats', () => {
  const model = {
    title: 'Push', date: 'Thu, 3 Sep 2026', prCount: 3,
    stats: [{ label: 'Duration', value: '58 min' }, { label: 'Sets', value: '5' }, { label: 'Volume', value: '1,790 kg' }],
    records: ['Barbell Bench Press', 'Dumbbell Curl'],
    topLifts: [{ name: 'Barbell Bench Press', line: '70 kg × 3' }],
    levels: { chest: 4 },
  }
  const map = { aspect: 1280 / 727 }
  const texts = layout => layout.items.filter(i => i.kind === 'text').map(i => i.text)

  it('a story is 1080×1920 with the content centred, the badge on the bar and the wordmark at the foot', () => {
    const layout = layoutWorkoutCard(model, { measure, map, format: 'story' })
    expect([layout.width, layout.height, layout.format, layout.decor]).toEqual([1080, 1920, 'story', true])
    const badge = layout.items.find(i => i.kind === 'badge')
    expect(badge.text).toBe('PR ×3')
    expect(badge.x + badge.w).toBeLessThanOrEqual(1080 - 88)
    expect(texts(layout)).toContain('Top lifts')
    expect(layout.items.filter(i => i.kind === 'map')).toHaveLength(2)
    const first = layout.items.find(i => i.kind === 'bar')
    const brand = layout.items.find(i => i.brand)
    expect(first.y).toBeGreaterThan(88)              // pushed down by the centring
    expect(brand.y).toBe(1920 - 88)
    for (const item of layout.items) expect(item.y).toBeLessThanOrEqual(1920)
  })

  it('a square is 1080×1080 and gives the map up before anything else, so the card fits', () => {
    const layout = layoutWorkoutCard(model, { measure, map, format: 'square' })
    expect([layout.width, layout.height]).toEqual([1080, 1080])
    expect(layout.items.filter(i => i.kind === 'map')).toHaveLength(0)
    expect(texts(layout)).toContain('Top lifts')
    expect(texts(layout)).toContain('Barbell Bench Press')
    const ys = layout.items.filter(i => i.kind === 'text' && !i.brand).map(i => i.y)
    expect(Math.max(...ys)).toBeLessThanOrEqual(1080 - 88)
  })

  it('with six records and three lifts a square counts the records rather than overflowing', () => {
    const busy = { ...model, records: ['A', 'B', 'C', 'D', 'E', 'F'], topLifts: [{ name: 'A', line: '1 kg × 1' }, { name: 'B', line: '1 kg × 1' }, { name: 'C', line: '1 kg × 1' }] }
    const layout = layoutWorkoutCard(busy, { measure, map, format: 'square' })
    expect(layout.height).toBe(1080)
    expect(texts(layout).some(s => s.startsWith('and ') && s.endsWith(' more'))).toBe(true)
    for (const item of layout.items) expect(item.y).toBeLessThanOrEqual(1080)
  })

  it('a single PR reads "PR", none means no badge, and auto stays as tall as it needs', () => {
    expect(layoutWorkoutCard({ ...model, prCount: 1 }, { measure, format: 'story' }).items.find(i => i.kind === 'badge').text).toBe('PR')
    expect(layoutWorkoutCard({ ...model, prCount: 0 }, { measure, format: 'story' }).items.find(i => i.kind === 'badge')).toBeUndefined()
    const auto = layoutWorkoutCard(model, { measure })
    expect(auto.format).toBeUndefined()
    expect(auto.height).not.toBe(1920)
  })
})

describe('the Coach\'s verdict on the card', () => {
  const nameOf = e => e.id
  const w = { id: 'w3', d: '2026-10-23', start: 0, end: 30 * 60000, name: 'Pull', vol: 500, prs: [], entries: [{ id: 'row', target: { mode: 'reps' }, sets: [{ w: 50, r: 10, done: true }] }] }
  it('the model carries a clamped score and a tidied summary, or nothing', () => {
    expect(workoutCardModel(w, { unit: 'kg', nameOf, ai: { score: 12.4, summary: '  Solid   session.\nKeep going. ' } }).ai).toEqual({ score: 10, summary: 'Solid session. Keep going.' })
    expect(workoutCardModel(w, { unit: 'kg', nameOf, ai: { score: 'x' } }).ai).toBeNull()
    expect(workoutCardModel(w, { unit: 'kg', nameOf }).ai).toBeNull()
  })
  it('lays the score pill under the date and the summary in at most three lines, in every format', () => {
    const model = { ...workoutCardModel(w, { unit: 'kg', nameOf, ai: { score: 8, summary: 'word '.repeat(80) } }), date: 'Fri' }
    for (const format of ['auto', 'story', 'square']) {
      const layout = layoutWorkoutCard(model, { measure, format })
      const pill = layout.items.find(i => i.kind === 'badge' && i.soft)
      const date = layout.items.find(i => i.text === 'Fri')
      expect(pill.text).toBe('Coach · 8/10')
      expect(pill.y).toBeGreaterThan(date.y)
      const lines = layout.items.filter(i => i.kind === 'text' && i.size === 34 && i.weight === 400)
      expect(lines.length).toBe(3)
      expect(lines[2].text.endsWith('…')).toBe(true)
      for (const item of layout.items) expect(item.y).toBeLessThanOrEqual(layout.height)
    }
  })
})
