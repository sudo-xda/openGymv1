// What the Coach writes back, rendered: lib/markdown.js reads the text into a tree and this
// turns the tree into elements. Nothing the model wrote ever reaches innerHTML.
import { useMemo } from 'react'
import { parseMarkdown } from '../lib/markdown.js'

function Inline({ nodes }) {
  return nodes.map((n, i) => {
    if (n.t === 'b') return <strong key={i}><Inline nodes={n.children} /></strong>
    if (n.t === 'i') return <em key={i}><Inline nodes={n.children} /></em>
    if (n.t === 'code') return <code key={i}>{n.text}</code>
    return n.text
  })
}

export default function Markdown({ text, className = '' }) {
  const blocks = useMemo(() => parseMarkdown(text), [text])
  return <div className={'md ' + className}>
    {blocks.map((b, i) => {
      if (b.t === 'h') {
        const Tag = 'h' + Math.min(4, b.level + 1)   // a chat heading is never the page's h1
        return <Tag key={i} className="md-h"><Inline nodes={b.children} /></Tag>
      }
      if (b.t === 'ul') return <ul key={i}>{b.items.map((it, j) => <li key={j}><Inline nodes={it} /></li>)}</ul>
      if (b.t === 'ol') return <ol key={i}>{b.items.map((it, j) => <li key={j}><Inline nodes={it} /></li>)}</ol>
      if (b.t === 'quote') return <div key={i} className="md-callout"><Inline nodes={b.children} /></div>
      if (b.t === 'hr') return <hr key={i} />
      if (b.t === 'pre') return <pre key={i}>{b.text}</pre>
      if (b.t === 'table') {
        return <div key={i} className="md-table"><table>
          <thead><tr>{b.head.map((c, j) => <th key={j}><Inline nodes={c} /></th>)}</tr></thead>
          <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}><Inline nodes={c} /></td>)}</tr>)}</tbody>
        </table></div>
      }
      return <p key={i}><Inline nodes={b.children} /></p>
    })}
  </div>
}
