// The one stat-tile row and the one section header the Home, Health and Nutrition cards share
// (health.css .hl-tiles): a number, its label under it, tabular figures, four to a row on a
// phone. A tile with a `color` tints its number; `sub` is a lighter note after the label.
import { Fragment } from 'react'

export function Tiles({ items, cols }) {
  const rows = (items || []).filter(Boolean)
  if (!rows.length) return null
  return <div className="hl-tiles" style={cols ? { gridTemplateColumns: `repeat(${cols}, 1fr)` } : undefined}>
    {rows.map((x, i) => <div key={x.key || i} className={x.onClick ? 'tappable' : undefined} onClick={x.onClick} role={x.onClick ? 'button' : undefined}>
      <b style={x.color ? { color: x.color } : undefined}>{x.v}{x.delta ? <small style={{ color: x.deltaColor || 'var(--label-2)' }}> {x.delta}</small> : null}</b>
      <span>{x.l}{x.sub ? <Fragment> · {x.sub}</Fragment> : null}</span>
    </div>)}
  </div>
}

/** A card's heading with at most one small action on the right. */
export function SectionHead({ title, note, action, children }) {
  return <div className="row between sec-head">
    <h2 style={{ margin: 0 }}>{title}{note ? <span className="dim" style={{ textTransform: 'none', fontWeight: 400 }}> · {note}</span> : null}</h2>
    {action || children || null}
  </div>
}
