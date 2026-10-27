// The band's live heart rate in the workout header (lib/live-hr.js): the figure coloured by
// its zone, the last minute as a sparkline beside it, a grey dash while the band is silent.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import * as liveHr from '../lib/live-hr.js'
import { maxHrOf, zoneOf, ZONE_COLORS } from '../lib/hr-zones.js'
import Icon from './Icon.jsx'

const SPARK_MS = 60000
export default function LiveHrPill({ bpm }) {
  const S = useStore(s => s.S)
  const [spark, setSpark] = useState([])
  useEffect(() => {
    const now = Date.now()
    setSpark(liveHr.liveSamples().filter(x => x.at >= now - SPARK_MS))
  }, [bpm])
  const max = maxHrOf(S)
  const zone = bpm ? zoneOf(bpm, max) : 0
  const color = zone ? ZONE_COLORS[zone - 1] : 'var(--label-3)'
  const W = 36, H = 14
  let path = null
  if (spark.length >= 2) {
    const t0 = spark[0].at, t1 = spark[spark.length - 1].at || t0 + 1
    const ys = spark.map(x => x.bpm), lo = Math.min(...ys), hi = Math.max(...ys)
    path = spark.map((x, i) => `${i ? 'L' : 'M'}${((x.at - t0) / (t1 - t0) * (W - 2) + 1).toFixed(1)},${(hi > lo ? H - 1 - (x.bpm - lo) / (hi - lo) * (H - 2) : H / 2).toFixed(1)}`).join(' ')
  }
  return <span className={'whdr-hr' + (bpm ? '' : ' off')} style={{ '--c': color }} aria-label={t('Heart rate') + (zone ? ` · ${t('zone')} ${zone}` : '')}>
    <Icon name="heart" />{bpm || '–'}
    {path && <svg className="whdr-spark" viewBox={`0 0 ${W} ${H}`} aria-hidden="true"><path d={path} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" /></svg>}
    {zone > 0 && <i className="whdr-z">Z{zone}</i>}
  </span>
}
