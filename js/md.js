import { T } from './i18n.js'
// Minimal Markdown renderer for the lesson files (headings, paragraphs,
// lists, tables, blockquotes, indented code, bold, italic, inline code, figures).
// A figure is a line of its own: ![Caption](/img/course/name.svg). SVG figures are
// inlined by the app after rendering so that they follow the light/dark theme.

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function inline(s) {
  const codes = []
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000` })
  s = esc(s)
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i])}</code>`)
  return s
}

export function renderMarkdown(src) {
  const lines = src.replace(/\r/g, '').split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    if (!l.trim()) { i++; continue }
    if (/^ {4}/.test(l)) {
      const buf = []
      while (i < lines.length && (/^ {4}/.test(lines[i]) || (!lines[i].trim() && /^ {4}/.test(lines[i + 1] || '')))) { buf.push(lines[i].slice(4)); i++ }
      out.push(`<pre class="code"><code>${esc(buf.join('\n'))}</code><button class="copy" title="${T('Copy', 'Копировать')}">${T('Copy', 'Копировать')}</button></pre>`)
      continue
    }
    const fig = l.match(/^!\[([^\]]*)\]\((\/img\/[\w\/.-]+)\)\s*$/)
    if (fig) {
      out.push(`<figure class="fig"><img src="${fig[2]}" alt="${esc(fig[1]).replace(/"/g, '&quot;')}" loading="lazy"><figcaption>${inline(fig[1])}</figcaption></figure>`)
      i++
      continue
    }
    const h = l.match(/^(#{1,4})\s+(.*)/)
    if (h) { const n = h[1].length + 1; out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue }
    if (l.startsWith('|')) {
      const rows = []
      while (i < lines.length && lines[i].startsWith('|')) { rows.push(lines[i]); i++ }
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      const head = cells(rows[0])
      const body = rows.slice(2).map(cells)
      out.push('<div class="table-wrap"><table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        body.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>')
      continue
    }
    if (l.startsWith('>')) {
      const buf = []
      while (i < lines.length && lines[i].startsWith('>')) { buf.push(lines[i].replace(/^>\s?/, '')); i++ }
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`)
      continue
    }
    if (/^(\s*[-*]|\s*\d+\.)\s/.test(l)) {
      const ordered = /^\s*\d+\./.test(l)
      const items = []
      while (i < lines.length && /^(\s*[-*]|\s*\d+\.)\s/.test(lines[i])) {
        let t = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '')
        i++
        while (i < lines.length && /^\s{2,3}\S/.test(lines[i]) && !/^(\s*[-*]|\s*\d+\.)\s/.test(lines[i])) { t += ' ' + lines[i].trim(); i++ }
        items.push(`<li>${inline(t)}</li>`)
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`)
      continue
    }
    const buf = []
    while (i < lines.length && lines[i].trim() && !/^(#|\||>| {4}|\s*[-*]\s|\s*\d+\.\s|!\[)/.test(lines[i])) { buf.push(lines[i]); i++ }
    out.push(`<p>${inline(buf.join(' '))}</p>`)
  }
  return out.join('\n')
}

// Split a module file into lessons on "# Lesson: Title" lines.
export function splitLessons(src) {
  const parts = src.split(/^# Lesson:\s*/m).filter((p) => p.trim())
  return parts.map((p) => {
    const nl = p.indexOf('\n')
    return { title: p.slice(0, nl).trim(), body: p.slice(nl + 1) }
  })
}
