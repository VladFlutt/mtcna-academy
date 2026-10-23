import { GLOSSARY } from './glossary.js'
import { LANG, T } from './i18n.js'
// Click tooltips for terms and abbreviations. Text inside the page is scanned for glossary aliases and
// each match becomes a focusable <span class="gl">; clicking it opens a short explanation.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

export const BY_ID = Object.fromEntries(GLOSSARY.map((g) => [g.id, g]))

// ---------- matcher ----------
const textAliases = []
const codeAliases = new Map()
for (const g of GLOSSARY) {
  if (g.aliases === null) continue
  // a term listed as code-only (`new, `input, `drop) is an ordinary English word, so in English text it is
  // matched only inside code; in Russian text these Latin words are always terms
  const codeOnly = g.aliases.includes('`' + g.term)
  const list = /[()]/.test(g.term) || codeOnly ? [...g.aliases] : [g.term, ...g.aliases]
  for (const a of new Set(list)) {
    if (a.startsWith('`')) {
      codeAliases.set(a.slice(1).toLowerCase(), g.id)
      if (LANG === 'ru') textAliases.push({ a: a.slice(1), id: g.id, caps: false })
      continue
    }
    codeAliases.set(a.replace(/\*/g, '').toLowerCase(), codeAliases.get(a.replace(/\*/g, '').toLowerCase()) || g.id)
    textAliases.push({ a, id: g.id, caps: !/[a-zа-яё]/.test(a) })
  }
}
textAliases.sort((x, y) => y.a.length - x.a.length)
const source = textAliases.map(({ a, caps }) => {
  let s = reEsc(a).replace(/\\\*/g, '\\p{L}*')
  if (caps && /[A-Z]$/.test(a)) s += '(?:s)?'
  else if (/^[\x20-\x7e]+$/.test(a) && /[a-z]$/.test(a) && !a.includes('*')) s += '(?:e?s)?'
  return `(${s})`
}).join('|')
const RE = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`, 'giu')

// Elements whose text is never tagged: code, controls, links, the terminal, active quizzes and exams.
const SKIP = 'pre, code, a, button, input, textarea, select, option, script, style, svg, label.opt, .term, .gl, .gl-tip, [data-noterms], header, nav, footer, .subnav'

function tagText(node) {
  const text = node.nodeValue
  RE.lastIndex = 0
  let m, last = 0, frag = null
  while ((m = RE.exec(text))) {
    const i = m.findIndex((g, k) => k > 0 && g !== undefined) - 1
    const al = textAliases[i]
    if (!al || (al.caps && !m[0].startsWith(al.a))) continue
    frag = frag || document.createDocumentFragment()
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)))
    const s = document.createElement('span')
    s.className = 'gl'; s.dataset.g = al.id; s.tabIndex = 0; s.setAttribute('role', 'button')
    s.textContent = m[0]
    frag.appendChild(s)
    last = m.index + m[0].length
  }
  if (!frag) return
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)))
  node.parentNode.replaceChild(frag, node)
}

export function tagTerms(el) {
  if (!el || el.nodeType !== 1 || el.closest(SKIP)) return
  // inline code that is exactly one term, such as `srcnat` or `ap-bridge`
  el.querySelectorAll(':not(pre) > code').forEach((c) => {
    if (c.closest('a, button, [data-noterms], .term')) return
    const id = codeAliases.get(c.textContent.trim().toLowerCase())
    if (id && !c.classList.contains('gl')) { c.classList.add('gl'); c.dataset.g = id; c.tabIndex = 0; c.setAttribute('role', 'button') }
  })
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => n.nodeType === 1 ? (n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP) : (/[\p{L}\d]{2}/u.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  })
  const nodes = []
  while (walker.nextNode()) nodes.push(walker.currentNode)
  nodes.forEach(tagText)
}

// ---------- tooltip ----------
let tip = null, owner = null
function closeTip() { if (tip) { tip.remove(); tip = null }; if (owner) owner.setAttribute('aria-expanded', 'false'); owner = null }

function openTip(el) {
  const g = BY_ID[el.dataset.g]
  if (!g) return
  if (owner === el) { closeTip(); return }
  closeTip()
  owner = el
  el.setAttribute('aria-expanded', 'true')
  tip = document.createElement('div')
  tip.className = 'gl-tip'
  tip.setAttribute('role', 'tooltip')
  const sub = [g.full, LANG === 'ru' && g.ru.toLowerCase() !== g.term.toLowerCase() ? g.ru : ''].filter((x) => x && x !== g.term)
  tip.innerHTML = `<b>${esc(g.term)}</b>${sub.length ? `<span class="gl-full">${sub.map(esc).join(' · ')}</span>` : ''}<p>${esc(LANG === 'ru' ? g.ruDef : g.en)}</p><a href="#/glossary/${g.id}">${T('Open in the glossary', 'Открыть в словаре')} →</a>`
  document.body.appendChild(tip)
  const r = el.getBoundingClientRect()
  const w = tip.offsetWidth, h = tip.offsetHeight
  const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, document.documentElement.clientWidth - w - 8))
  const below = r.bottom + h + 10 < window.innerHeight || r.top < h + 10
  tip.style.left = left + window.scrollX + 'px'
  tip.style.top = (below ? r.bottom + 8 : r.top - h - 8) + window.scrollY + 'px'
  tip.classList.toggle('above', !below)
}

export function initTerms(root) {
  document.addEventListener('click', (e) => {
    const t = e.target.closest('.gl')
    if (t) { e.preventDefault(); openTip(t); return }
    if (tip && !e.target.closest('.gl-tip')) closeTip()
    else if (e.target.closest('.gl-tip a')) closeTip()
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeTip()
    else if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('gl')) { e.preventDefault(); openTip(e.target) }
  })
  window.addEventListener('resize', closeTip)
  window.addEventListener('hashchange', closeTip)
  // Tag whatever the pages render, including content that is re-rendered later (lab tasks, simulators, tutor answers).
  const obs = new MutationObserver((records) => {
    const seen = new Set()
    for (const r of records) for (const n of r.addedNodes) {
      const el = n.nodeType === 1 ? n : n.parentElement
      if (el && !seen.has(el) && el.isConnected) { seen.add(el); tagTerms(el) }
    }
    obs.takeRecords()
  })
  obs.observe(root, { childList: true, subtree: true })
}
