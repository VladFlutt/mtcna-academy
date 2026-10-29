// Drawing helpers for the MTCRE network labs: the topology picture, the link controls and the
// reachability panel. Pure functions that return HTML strings; app.js wires up the events.

import { T } from '../i18n.js'

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const W = 640

function pos(net, end) {
  const [r] = end.split(':')
  const s = net.spec.routers.find((x) => x.name === r)
  return s ? { x: s.x, y: s.y } : null
}

// The topology: routers are boxes (the active one highlighted, preconfigured ones dashed), hosts are
// smaller boxes with their address, links are lines labelled with the interface at each end.
export function topoSvg(net, active) {
  const h = net.spec.h || 300
  const parts = []
  // the interface name sits on the line just outside the router box at end a
  const label = (a, b, ifn) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const d = Math.min(len * 0.45, Math.abs(b.x - a.x) / len > 0.8 ? 72 : 46)
    const x = a.x + (b.x - a.x) * d / len, y = a.y + (b.y - a.y) * d / len
    return `<text x="${x}" y="${y - 4}" text-anchor="middle" class="s ifl">${esc(ifn)}</text>`
  }
  net.links.forEach((l, i) => {
    const a = pos(net, l.a), b = pos(net, l.b)
    if (!a || !b) return
    parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="w ${l.state}" data-link="${i}"><title>${esc(l.a)} ↔ ${esc(l.b)}: ${l.state}</title></line>`)
    parts.push(label(a, b, l.a.split(':')[1]), label(b, a, l.b.split(':')[1]))
    if (l.state !== 'up') parts.push(`<text x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 + 4}" text-anchor="middle" class="x ${l.state}">${l.state === 'down' ? '✕' : '⚠'}</text>`)
  })
  for (const hst of net.hosts) {
    const r = pos(net, hst.at)
    if (!r) continue
    parts.push(`<line x1="${hst.x}" y1="${hst.y}" x2="${r.x}" y2="${r.y}" class="w host"/>`, label(r, hst, hst.at.split(':')[1]))
  }
  for (const hst of net.hosts) {
    parts.push(`<g class="hostn"><rect x="${hst.x - 52}" y="${hst.y - 17}" width="104" height="34" rx="6" class="n"/><text x="${hst.x}" y="${hst.y - 2}" text-anchor="middle" class="t sm">${esc(hst.name)}</text><text x="${hst.x}" y="${hst.y + 11}" text-anchor="middle" class="s">${esc(hst.ip.split('/')[0])}</text></g>`)
  }
  for (const r of net.spec.routers) {
    parts.push(`<g class="rtr ${r.name === active ? 'on' : ''} ${r.locked ? 'lk' : ''}" data-router="${esc(r.name)}" tabindex="0" role="button" aria-label="${T('Open the terminal of', 'Открыть терминал')} ${esc(r.name)}"><rect x="${r.x - 44}" y="${r.y - 20}" width="88" height="40" rx="9" class="r"/><text x="${r.x}" y="${r.y + 5}" text-anchor="middle" class="t">${esc(r.name)}</text></g>`)
  }
  return `<svg viewBox="-14 0 ${W + 28} ${h}" class="topo-svg net-svg" role="img" aria-label="${T('Lab topology', 'Топология лабы')}">${parts.join('')}</svg>`
}

export function linksPanel(net) {
  const opt = (v, cur, t) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${t}</option>`
  return `<h4>🔌 ${T('Links', 'Каналы')}</h4><div class="links">${net.links.map((l, i) => `<label class="linkrow"><span class="mono sm">${esc(l.a)} ↔ ${esc(l.b)}</span>
    <select data-link="${i}" aria-label="${T('Link state', 'Состояние канала')}">${opt('up', l.state, T('up', 'работает'))}${opt('down', l.state, T('cable cut', 'кабель отключён'))}${opt('silent', l.state, T('silent failure', 'тихий отказ'))}</select></label>`).join('')}</div>
    <p class="muted sm">${T('"Silent failure" keeps both ports up but nothing passes, like a dead device behind a switch. Only check-gateway, keepalive or a routing protocol notices it.', '«Тихий отказ» оставляет оба порта поднятыми, но ничего не проходит, как мёртвое устройство за коммутатором. Это замечают только check-gateway, keepalive или протокол маршрутизации.')}</p>`
}

// probes: [[from, ip], ...]; returns { html, tests } where tests is a summary for the tutor
export function reachPanel(net, probes) {
  const tests = probes.map(([from, to]) => {
    let r
    try { r = net.reach(from, to) } catch (e) { r = { ok: false, why: String(e.message || e) } }
    const host = net.hosts.find((h) => h.ip.split('/')[0] === to)
    return { from, to, name: host ? host.name : to, ok: r.ok, path: r.path || [], why: r.why || '', tunnel: !!r.viaTunnel }
  })
  const html = `<h4>📡 ${T('Reachability', 'Связность')}</h4><ul class="reach">${tests.map((x) => `<li class="${x.ok ? 'good' : 'bad'}"><b>${x.ok ? '✓' : '✗'}</b><div><span class="mono sm">${esc(x.from)} → ${esc(x.name)}${x.name !== x.to ? ` (${esc(x.to)})` : ''}</span>
    ${x.ok ? `<span class="muted sm">${T('path', 'путь')}: ${x.path.map(esc).join(' → ')}${x.tunnel ? T(' · through a tunnel', ' · через туннель') : ''}</span>` : `<span class="why sm">${esc(x.why || T('no answer', 'нет ответа'))}</span>`}</div></li>`).join('')}</ul>`
  return { html, tests }
}
