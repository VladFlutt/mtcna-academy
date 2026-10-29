// MTCTCE traffic engine: the parts of RouterOS behaviour the traffic-control labs and simulators
// need on top of the CLI simulator. DNS answers from static entries and the cache, DHCP option 121
// encoding, web proxy access rules, and the bandwidth allocation of HTB (queue tree) and PCQ.

import { WORLD, parseRate, globMatch, routerInternet, evalChain } from '../routeros.js'
import { ipToInt, intToIp, parseCidr } from '../net.js'

const on = (x) => x && x.disabled !== 'yes'
const L = (st, p) => st.lists[p] || []

// ---------- DNS ----------
// Resolve a name the way the router's DNS server answers a client: static entries top to bottom
// (name, name with match-subdomain, or regexp), CNAME chains, FWD entries, then the upstream servers.
export function dnsLookup(st, name, type = 'A', depth = 0) {
  name = String(name).toLowerCase().replace(/\.$/, '')
  if (depth > 5) return { ok: false, why: 'CNAME loop' }
  for (const d of L(st, 'ip dns static').filter(on)) {
    const t = d.type || (d.cname ? 'CNAME' : d['forward-to'] ? 'FWD' : 'A')
    let hit = false
    if (d.name) {
      const n = d.name.toLowerCase()
      hit = n === name || (d['match-subdomain'] === 'yes' && name.endsWith('.' + n))
    } else if (d.regexp) {
      // a quoted value on the CLI escapes \\ and \$; accept both the escaped and the plain form
      try { hit = new RegExp(d.regexp.replace(/\\\\/g, '\\').replace(/\\\$/g, '$'), 'i').test(name) } catch { hit = false }
    }
    if (!hit) continue
    if (t === 'CNAME') {
      const r = dnsLookup(st, d.cname, type, depth + 1)
      return { ...r, chain: [d.cname, ...(r.chain || [])], entry: d }
    }
    if (t === 'FWD') return { ok: true, forward: d['forward-to'], source: 'forward', entry: d }
    if (t === 'NXDOMAIN') return { ok: false, source: 'static', why: 'NXDOMAIN', entry: d }
    if (t !== type) continue
    return { ok: true, address: d.address, source: 'static', entry: d }
  }
  if (type === 'A' && WORLD.names[name]) {
    const servers = (st.singletons['ip dns'].servers || '').split(',').filter(Boolean).concat((st.dynDns || []))
    if (!routerInternet(st)) return { ok: false, why: 'the router has no Internet access' }
    if (!servers.length && !L(st, 'ip dhcp-client').some((c) => on(c) && c['use-peer-dns'] !== 'no')) return { ok: false, why: 'no upstream DNS server' }
    return { ok: true, address: WORLD.names[name], source: 'upstream' }
  }
  return { ok: false, source: 'upstream', why: 'NXDOMAIN' }
}

// Does a DNS query from a LAN client to some outside server end up at the router? (forced DNS)
export function dnsRedirected(st, client = '192.168.33.2', inIf = 'bridgeLAN', server = '8.8.8.8') {
  const res = evalChain(st, 'nat', 'dstnat', { src: client, dst: server, protocol: 'udp', dstPort: 53, inIf })
  if (res.verdict === 'redirect') return { ok: true, rule: res.rule }
  if (res.verdict === 'dst-nat') {
    const to = res.rule['to-addresses']
    return { ok: !!to && L(st, 'ip address').some((a) => a.address && a.address.split('/')[0] === to), rule: res.rule }
  }
  return { ok: false }
}

// ---------- DHCP option 121 (classless static routes, RFC 3442) ----------
// Each route: prefix length, the significant octets of the destination, then the 4 gateway octets.
export function opt121Encode(routes) {
  const hex = (n) => n.toString(16).padStart(2, '0').toUpperCase()
  let out = ''
  for (const { dst, gw } of routes) {
    const c = parseCidr(dst)
    if (!c || !/^\d+\.\d+\.\d+\.\d+$/.test(gw)) return null
    const octs = intToIp(c.net).split('.').map(Number).slice(0, Math.ceil(c.prefix / 8))
    out += hex(c.prefix) + octs.map(hex).join('') + gw.split('.').map((x) => hex(Number(x))).join('')
  }
  return '0x' + out
}
export function opt121Decode(value) {
  const h = String(value).replace(/^0x/i, '')
  if (!/^([0-9a-f]{2})+$/i.test(h)) return null
  const b = h.match(/../g).map((x) => parseInt(x, 16))
  const routes = []
  let i = 0
  while (i < b.length) {
    const len = b[i++]
    if (len > 32) return null
    const n = Math.ceil(len / 8)
    if (i + n + 4 > b.length) return null
    const dst = [...b.slice(i, i + n), 0, 0, 0, 0].slice(0, 4).join('.')
    i += n
    const gw = b.slice(i, i + 4).join('.')
    i += 4
    routes.push({ dst: `${dst}/${len}`, gw })
  }
  return routes
}

// The options a client on a network receives: the network's own fields plus dhcp-option entries
export function dhcpOptionsFor(st, network) {
  const net = L(st, 'ip dhcp-server network').find((n) => on(n) && n.address === network)
  if (!net) return null
  const names = (net['dhcp-option'] || '').split(',').filter(Boolean)
  const set = net['dhcp-option-set'] && L(st, 'ip dhcp-server option sets').find((s) => s.name === net['dhcp-option-set'])
  if (set) names.push(...(set.options || '').split(','))
  const opts = names.map((n) => L(st, 'ip dhcp-server option').find((o) => o.name === n)).filter(Boolean)
  return { net, opts, routes121: opts.filter((o) => o.code === '121').flatMap((o) => opt121Decode(o.value) || []) }
}

// Which DHCP server answers a client on a broadcast domain where several servers listen?
// servers: [{ name, delay, authoritative }]. The client takes the first offer: the server with the
// lowest delay-threshold that is not held back. A relay path adds the relay's own delay.
export function firstOffer(servers, secs = 0) {
  const ready = servers.filter((s) => (s.delay || 0) <= secs).sort((a, b) => (a.delay || 0) - (b.delay || 0))
  return ready[0] || null
}

// ---------- web proxy ----------
// RouterOS proxy wildcards: * any characters, ? one character. A value that starts with ':' is a regex.
export function proxyMatch(pat, s) {
  if (!pat) return true
  if (pat.startsWith(':')) { try { return new RegExp(pat.slice(1), 'i').test(s) } catch { return false } }
  return globMatch(pat, s)
}
// req: { src, host, path, method, port }. Returns the first matching access rule (or allow by default).
export function proxyDecide(st, req, menu = 'ip proxy access') {
  for (const r of L(st, menu).filter(on)) {
    if (r['src-address'] && !inNet(r['src-address'], req.src)) continue
    if (r['dst-host'] && !proxyMatch(r['dst-host'], req.host)) continue
    if (r.path && !proxyMatch(r.path, req.path || '/')) continue
    if (r.method && r.method.toUpperCase() !== (req.method || 'GET')) continue
    if (r['dst-port'] && String(r['dst-port']) !== String(req.port || 80)) continue
    return { action: r.action || 'allow', redirect: r['redirect-to'], rule: r }
  }
  return { action: 'allow' }
}
const inNet = (spec, ip) => {
  if (!ip) return false
  const neg = spec.startsWith('!')
  const c = parseCidr(neg ? spec.slice(1) : spec.includes('/') ? spec : spec + '/32')
  const res = !!c && (ipToInt(ip) & c.mask) >>> 0 === c.net
  return neg ? !res : res
}

// ---------- HTB ----------
// nodes: [{ name, parent, limitAt, maxLimit, priority, demand }] in bit/s (any unit, as long as all
// agree). parent is another node's name, or anything else for a root (global or an interface).
// capacity: the link speed (optional). Returns { rate: {name: bits}, steps: [text] }.
//
// HTB in RouterOS gives bandwidth in two passes. First every leaf gets its limit-at (CIR), as far as
// it wants it; an inner queue whose limit-at is larger than what its leaves took guarantees the rest
// to its own leaves. If the leaves' CIRs together exceed what is available, they are cut in
// proportion. What is left goes to the leaves by priority (1 first, 8 last) up to their max-limit
// (MIR); leaves with the same priority share equally. Priority of an inner queue does not matter.
export function htbAllocate(nodes, capacity) {
  const eps = 1e-9
  const N = new Map(nodes.map((n) => [n.name, { ...n, kids: [], got: 0 }]))
  for (const n of N.values()) if (N.has(n.parent)) N.get(n.parent).kids.push(n)
  const roots = [...N.values()].filter((n) => !N.has(n.parent))
  const top = { name: '(link)', kids: roots, maxLimit: capacity || Infinity, limitAt: 0 }
  for (const r of roots) r.up = top
  for (const n of N.values()) for (const k of n.kids) k.up = n
  const mir = (n) => n.maxLimit ? n.maxLimit : Infinity
  const leaves = [...N.values()].filter((n) => !n.kids.length)
  const cap = (l) => Math.min(mir(l), l.demand ?? Infinity)
  const leavesOf = (n) => n.kids.length ? n.kids.flatMap(leavesOf) : [n]
  const used = (n) => n.kids.length ? n.kids.reduce((a, k) => a + used(k), 0) : n.got
  const ancestors = (l) => { const a = []; for (let x = l.up; x; x = x.up) a.push(x); return a }
  const head = (l) => Math.max(0, Math.min(cap(l) - l.got, ...ancestors(l).map((a) => mir(a) - used(a))))
  const steps = []
  const fill = (ls, amount) => {
    const prios = [...new Set(ls.map((l) => Number(l.priority) || 8))].sort((a, b) => a - b)
    for (const p of prios) {
      const grp = ls.filter((l) => (Number(l.priority) || 8) === p)
      for (let it = 0; it < 200 && amount > eps; it++) {
        const act = grp.filter((l) => head(l) > eps)
        if (!act.length) break
        const share = amount / act.length
        for (const l of act) { const g = Math.min(share, head(l)); l.got += g; amount -= g }
      }
    }
    return amount
  }
  // 1. CIR of the leaves, scaled down when they do not fit
  const want = leaves.map((l) => Math.min(l.limitAt || 0, cap(l)))
  const avail = Math.min(capacity || Infinity, roots.reduce((a, r) => a + mir(r), 0))
  const total = want.reduce((a, b) => a + b, 0)
  const k = total > avail ? avail / total : 1
  leaves.forEach((l, i) => { l.got = want[i] * k })
  // an inner queue cannot pass more than its own max-limit: scale its subtree down to it
  const byDepth = [...N.values()].filter((n) => n.kids.length).sort((a, b) => ancestors(b).length - ancestors(a).length)
  for (const n of byDepth) { const u = used(n); if (u > mir(n) + eps) for (const l of leavesOf(n)) l.got *= mir(n) / u }
  steps.push({ phase: 'cir', text: k < 1 ? `CIR: leaves want ${fmt(total)} but only ${fmt(avail)} is available, every CIR is cut to ${Math.round(k * 100)}%` : `CIR: every leaf gets its limit-at (${fmt(total)} together)`, rate: snap(leaves) })
  // 2. an inner queue's own limit-at beyond what its leaves already got is reserved for them
  for (const n of byDepth) {
    const reserve = Math.min(n.limitAt || 0, mir(n)) - used(n)
    if (reserve > eps) {
      const left = fill(leavesOf(n), reserve)
      if (reserve - left > eps) steps.push({ phase: 'inner', text: `${n.name}: limit-at ${fmt(n.limitAt)} is more than its leaves took, ${fmt(reserve - left)} more for its own leaves by priority`, rate: snap(leaves) })
    }
  }
  // 3. what is left of the link goes to the leaves by priority up to max-limit
  const before = leaves.reduce((a, l) => a + l.got, 0)
  fill(leaves, Math.max(0, avail - before))
  const after = leaves.reduce((a, l) => a + l.got, 0)
  if (after - before > eps) steps.push({ phase: 'mir', text: `MIR: the remaining ${fmt(after - before)} goes to the leaves by priority, up to max-limit`, rate: snap(leaves) })
  const rate = {}
  for (const n of N.values()) rate[n.name] = used(n)
  return { rate, steps, leaves: leaves.map((l) => l.name) }
}
const snap = (leaves) => Object.fromEntries(leaves.map((l) => [l.name, l.got]))
export const fmt = (b) => !isFinite(b) ? '∞' : b >= 1e6 ? +(b / 1e6).toFixed(2) + 'M' : b >= 1e3 ? +(b / 1e3).toFixed(1) + 'k' : String(Math.round(b))

// The queue tree of a router as HTB nodes (demand: everyone wants as much as possible)
export function treeNodes(st, demand = {}) {
  return L(st, 'queue tree').filter(on).map((q) => ({
    name: q.name, parent: q.parent || 'global', limitAt: parseRate(q['limit-at'] || '0') || 0, maxLimit: parseRate(q['max-limit'] || '0') || 0,
    priority: Number(q.priority || 8), demand: demand[q.name], packetMark: q['packet-mark'] || '',
  }))
}

// ---------- PCQ ----------
// max-limit shared by n active sub-streams; pcq-rate (0 = no limit) caps each one
export function pcqShare(maxLimit, rate, n) {
  if (!n) return 0
  const eq = maxLimit / n
  return rate ? Math.min(rate, eq) : eq
}

// ---------- burst ----------
// One sub-stream that always wants burst-limit. The average is taken over burst-time in 16 steps,
// as RouterOS does; while it is below burst-threshold the queue may send at burst-limit.
export function burstTimeline({ maxLimit, burstLimit, burstThreshold, burstTime, seconds = 30, step = 0.5 }) {
  const n = 16
  const win = burstTime / n
  const hist = new Array(n).fill(0)
  const out = []
  let acc = 0, tWin = 0, cur = 0
  for (let t = 0; t <= seconds + 1e-9; t += step) {
    const avg = hist.reduce((a, b) => a + b, 0) / n
    cur = burstLimit > maxLimit && avg < burstThreshold ? burstLimit : maxLimit
    out.push({ t: +t.toFixed(2), rate: cur, avg })
    acc += cur * step; tWin += step
    if (tWin >= win - 1e-9) { hist.shift(); hist.push(acc / tWin); acc = 0; tWin = 0 }
  }
  return out
}

// ---------- packet marks ----------
// Run a packet through mangle prerouting and forward (or output) and postrouting; returns the marks
export function markPacket(st, p, local = false) {
  const q = { ...p }
  const chains = local ? ['output', 'postrouting'] : ['prerouting', 'forward', 'postrouting']
  const trace = []
  for (const ch of chains) trace.push(...evalChain(st, 'mangle', ch, q).trace)
  return { connMark: q.connMark || '', packetMark: q.packetMark || '', routingMark: q.routingMark || '', dscp: q.dscp, ttl: q.ttl, mss: q.mss, trace }
}
