// A small multi-router network for the MTCRE labs. Every router is a full RouterOS simulator state
// (the same CLI as in MTCNA and MTCSE); this module cables them together and computes what the
// routers do with that configuration:
//   - interfaces and links (a link can be cut, or fail "silently" behind a switch: the port stays up
//     but nothing passes, which only check-gateway can notice)
//   - connected and static routes with distance, ECMP, recursive next hops (scope / target-scope),
//     check-gateway, blackhole routes, routing tables and /routing rule, mangle mark-routing, srcnat
//     and rp-filter
//   - tunnels: VLAN, GRE, IPIP, EoIP (layer 2, can be bridged) and WireGuard (allowed-address)
//   - OSPFv2 as in RouterOS 7: instance, areas (backbone, stub, totally stubby, NSSA), interface
//     templates, network types, DR/BDR election, passive interfaces, cost, ECMP, area ranges,
//     redistribution, originate-default and routing filters
// and simulates ping and traceroute hop by hop, including the reply path.

import { RouterOS, emptyConfig, evalChain } from '../routeros.js'
import { ipToInt, intToIp, parseCidr, inSubnet } from '../net.js'
import { runFilter } from '../rfilter.js'

const yes = (v) => v === 'yes' || v === true
const on = (x) => !!x && !yes(x.disabled)
const L = (st, p) => st.lists[p] || []
const pad = (s, n) => { s = String(s ?? ''); return s.length >= n ? s + ' ' : s + ' '.repeat(n - s.length) }
const TUN = { 'interface gre': 'gre', 'interface ipip': 'ipip', 'interface eoip': 'eoip' }
const secsOf = (v) => { let n = 0; for (const [, x, u] of String(v || '').matchAll(/(\d+)([hms]?)/g)) n += Number(x) * ({ h: 3600, m: 60, s: 1, '': 1 }[u]); return n }
const cidrStr = (c) => intToIp(c.net) + '/' + c.prefix
const hash = (s) => { let h = 7; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h }

// ---------- building a network ----------
// spec: { routers: [{ name, ifaces?, cmds?, x, y, note? }], links: [{ a: 'R1:ether1', b: 'R2:ether1', state? }],
//         hosts: [{ name, ip: 'a.b.c.d/nn', gw, at: 'R1:ether5', x, y }] }
export function makeNet(spec) {
  const net = new Net(spec)
  for (const r of spec.routers) {
    const st = emptyConfig()
    st.interfaces = (r.ifaces || ['ether1', 'ether2', 'ether3', 'ether4', 'ether5']).map((n, i) => ({ name: n, type: 'ether', mtu: '1500', disabled: 'no', 'mac-address': `48:A9:8A:${(net.order.length + 16).toString(16).toUpperCase()}:00:${(i + 1).toString(16).toUpperCase().padStart(2, '0')}`, comment: '' }))
    st.interfaces.push({ name: 'lo', type: 'loopback', mtu: '65536', disabled: 'no', 'mac-address': '00:00:00:00:00:00', comment: '' })
    st.wireless = {}
    st.singletons['system identity'].name = r.name
    Object.defineProperty(st, 'net', { value: net, enumerable: false, writable: true })
    st.rname = r.name
    net.routers[r.name] = st
    net.order.push(r.name)
  }
  for (const r of spec.routers) {
    const st = net.routers[r.name]
    st.cabled = net.cabledOf(r.name)
    const ros = new RouterOS(st)
    for (const c of r.cmds || []) {
      const out = ros.exec(c)
      if (out && /^(bad|expected|failure|input|invalid|syntax|no such)/.test(out)) console.warn('[net]', r.name, c, '->', out)
    }
    st.lastPrint = {}
  }
  return net
}

class Net {
  constructor(spec) {
    this.spec = spec
    this.routers = {}
    this.order = []
    this.links = spec.links.map((l) => ({ ...l, state: l.state || 'up' }))
    this.hosts = (spec.hosts || []).map((h) => ({ ...h, c: parseCidr(h.ip) }))
    this._key = null
    this._S = null
  }

  cabledOf(name) {
    const out = []
    for (const l of this.links) for (const end of [l.a, l.b]) { const [r, i] = end.split(':'); if (r === name) out.push(i) }
    for (const h of this.hosts) { const [r, i] = h.at.split(':'); if (r === name) out.push(i) }
    return out
  }

  // cut / restore / silently fail a link (lab actions)
  setLink(i, state) { this.links[i].state = state; this._key = null }

  // ---------- computed state ----------
  key() {
    return JSON.stringify([this.order.map((n) => { const st = this.routers[n]; return [st.lists, st.interfaces, st.singletons['ip settings']] }), this.links.map((l) => l.state)])
  }

  S() {
    const k = this.key()
    if (k === this._key) return this._S
    this._key = k
    this._S = compute(this)
    return this._S
  }

  isRunning(st, name) { const s = this.S(); return !!(s.r[st.rname] && s.r[st.rname].run[name]) }
  routes(st) { return this.S().r[st.rname].routes }
  reach(from, dst, opts = {}) { return pingPath(this.S(), from, dst, opts) }
  ospfOf(name) { return this.S().r[name].ospf }
  printOspf(st, path) { return printOspf(this.S(), st.rname, path) }
  log(st) { return (this.S().r[st.rname].log || []).join('\n') }

  ping(st, target, count, kv) {
    const S = this.S()
    const ip = target
    if (ipToInt(ip) === null) return `failure: could not resolve name ${target} (the lab network has no DNS, use addresses)`
    const res = pingPath(S, st.rname, ip, { src: kv['src-address'], table: kv['routing-table'], iface: kv.interface })
    const lines = ['  SEQ HOST                                     SIZE TTL TIME       STATUS']
    let rec = 0, sum = 0
    for (let n = 0; n < count; n++) {
      if (res.ok) {
        const t = (0.3 + res.hops * 0.4 + Math.random() * 0.3).toFixed(3)
        sum += Number(t); rec++
        lines.push(`    ${n} ${pad(ip, 40)} 56  ${pad(res.ttl, 3)} ${pad(t.replace('.', 'ms') + 'us', 10)}`)
      } else lines.push(`    ${n} ${pad(res.fromIp || ip, 40)}${res.status === 'timeout' ? '                     timeout' : '84  64  0ms        ' + res.status}`)
    }
    lines.push(`    sent=${count} received=${rec} packet-loss=${Math.round((1 - rec / count) * 100)}%` + (rec ? ` min-rtt=${(sum / rec * 0.9).toFixed(1)}ms avg-rtt=${(sum / rec).toFixed(1)}ms` : ''))
    if (!res.ok && res.why) lines.push(`# simulator: ${res.why}`)
    return lines.join('\n')
  }

  traceroute(st, target, kv) {
    const S = this.S()
    if (ipToInt(target) === null) return `failure: could not resolve name ${target}`
    const src = kv['src-address'] || firstSrc(S, st.rname, target, { table: kv['routing-table'] })
    const go = send(S, st.rname, src, target, { table: kv['routing-table'] })
    const out = ['Columns: ADDRESS, LOSS, SENT, LAST, AVG, BEST, WORST', '#  ADDRESS          LOSS  SENT  LAST    AVG    BEST   WORST']
    const row = (n, ip, ok) => ok ? `${pad(n, 2)} ${pad(ip, 17)}0%    3     ${pad((n * 0.4 + 0.1).toFixed(1) + 'ms', 8)}${pad((n * 0.4 + 0.2).toFixed(1), 7)}${pad(n * 0.4 + '', 7)}${(n * 0.4 + 0.5).toFixed(1)}` : `${pad(n, 2)} ${pad('', 17)}100%  3     timeout`
    let why = go.ok ? '' : go.why
    const hops = go.path.map((ip, k) => ({ ip, node: go.nodes[k] }))
    if (go.ok) hops.push({ ip: target, node: go.at })
    hops.forEach((h, k) => {
      const back = send(S, h.node, h.ip, src, { nat: go.nat, reply: true })
      out.push(row(k + 1, h.ip, back.ok))
      if (!back.ok && !why) why = `hop ${k + 1} (${h.node}) cannot send its answer back to ${src}: ${back.why}`
    })
    if (!go.ok) for (let n = hops.length; n < hops.length + 3; n++) out.push(row(n + 1, '', false))
    if (why) out.push(`# simulator: ${why}`)
    return out.join('\n')
  }
}

// =====================================================================================
// computation
// =====================================================================================
function compute(net) {
  const S = { net, r: {}, segOf: {}, segs: [], tunnels: {}, wg: {} }
  for (const n of net.order) S.r[n] = { name: n, st: net.routers[n], run: {}, log: [] }
  let up = {}
  for (let pass = 0; pass < 4; pass++) {
    buildL2(S, up)
    buildAddresses(S)
    for (const n of S.net.order) S.r[n].cgFail = {}
    ospf(S, false)
    buildRoutes(S)
    checkGateways(S)
    ospf(S, true)
    buildRoutes(S, true)
    const next = tunnelStatus(S)
    if (JSON.stringify(next) === JSON.stringify(up)) break
    up = next
  }
  return S
}

// ---------- interfaces, segments ----------
function ifaceTable(st) {
  const res = {}
  for (const i of st.interfaces) res[i.name] = { kind: i.type === 'loopback' ? 'lo' : 'ether', it: i }
  for (const b of L(st, 'interface bridge')) res[b.name] = { kind: 'bridge', it: b }
  for (const v of L(st, 'interface vlan')) res[v.name] = { kind: 'vlan', it: v }
  for (const [p, k] of Object.entries(TUN)) for (const t of L(st, p)) res[t.name] = { kind: k, it: t }
  for (const w of L(st, 'interface wireguard')) res[w.name] = { kind: 'wg', it: w }
  return res
}

function linkPeer(net, rname, ifn) {
  for (const l of net.links) {
    if (l.a === rname + ':' + ifn) return { end: l.b, link: l }
    if (l.b === rname + ':' + ifn) return { end: l.a, link: l }
  }
  for (const h of net.hosts) if (h.at === rname + ':' + ifn) return { host: h, link: { state: 'up' } }
  return null
}

function bridgeOfIf(st, ifn) {
  const p = L(st, 'interface bridge port').find((x) => on(x) && x.interface === ifn)
  if (!p) return null
  const b = L(st, 'interface bridge').find((x) => x.name === p.bridge)
  return b && on(b) ? b.name : null
}

function buildL2(S, tunUp) {
  const net = S.net
  // 1. running state
  for (const n of net.order) {
    const R = S.r[n], st = R.st
    R.ifs = ifaceTable(st)
    R.run = {}
    for (const [name, d] of Object.entries(R.ifs)) {
      if (d.kind === 'ether') {
        const pe = linkPeer(net, n, name)
        let ok = on(d.it) && !!pe && pe.link.state !== 'down'
        if (ok && pe.end) { const [pr, pi] = pe.end.split(':'); const o = net.routers[pr].interfaces.find((x) => x.name === pi); ok = on(o) }
        R.run[name] = ok
      } else if (d.kind === 'lo') R.run[name] = true
    }
    for (const [name, d] of Object.entries(R.ifs)) if (d.kind === 'vlan') R.run[name] = on(d.it) && !!R.run[d.it.interface]
    for (const [name, d] of Object.entries(R.ifs)) {
      if (d.kind === 'bridge') {
        const ports = L(st, 'interface bridge port').filter((p) => on(p) && p.bridge === name)
        R.run[name] = on(d.it) && (!ports.length || ports.some((p) => R.run[p.interface] || tunUp[n + ':' + p.interface]))
      }
      if (['gre', 'ipip', 'eoip'].includes(d.kind)) {
        const t = tunUp[n + ':' + name]
        // with keepalive the tunnel goes down when the far end does not answer; without it, it always looks running
        R.run[name] = on(d.it) && (!!t || !d.it.keepalive)
      }
      if (d.kind === 'wg') R.run[name] = on(d.it)
    }
  }
  // 2. layer 2 segments (union-find over router interfaces and hosts)
  const parent = {}
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  const add = (x) => { if (parent[x] === undefined) parent[x] = x }
  const union = (a, b) => { add(a); add(b); const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb }
  const silentRoots = new Set()
  const ep = (rn, ifn) => { const st = net.routers[rn]; const b = bridgeOfIf(st, ifn); return rn + ':' + (b || ifn) }
  for (const n of net.order) for (const name of Object.keys(S.r[n].ifs)) add(ep(n, name))
  for (const h of net.hosts) add('host:' + h.name)
  const silent = []
  for (const l of net.links) {
    const [ra, ia] = l.a.split(':'), [rb, ib] = l.b.split(':')
    if (!S.r[ra].run[ia] || !S.r[rb].run[ib]) continue
    union(ep(ra, ia), ep(rb, ib))
    if (l.state === 'silent') silent.push(ep(ra, ia))
    // VLANs on both ends of the same cable with the same VLAN ID share a segment
    for (const va of L(net.routers[ra], 'interface vlan').filter((v) => on(v) && v.interface === ia))
      for (const vb of L(net.routers[rb], 'interface vlan').filter((v) => on(v) && v.interface === ib && String(v['vlan-id']) === String(va['vlan-id']))) {
        union(ep(ra, va.name), ep(rb, vb.name))
        if (l.state === 'silent') silent.push(ep(ra, va.name))
      }
  }
  for (const h of net.hosts) { const [r, i] = h.at.split(':'); if (S.r[r].run[i]) union('host:' + h.name, ep(r, i)) }
  for (const [k, v] of Object.entries(tunUp)) {
    if (!v || v === true) continue
    const [n, ifn] = k.split(':')
    const [pn, pifn] = v.split(':')
    if (S.r[n].run[ifn] && S.r[pn].run[pifn]) union(ep(n, ifn), ep(pn, pifn))
  }
  for (const s of silent) silentRoots.add(find(s))
  S.segOf = {}
  const segs = {}
  for (const x of Object.keys(parent)) {
    const root = find(x)
    S.segOf[x] = root
    ;(segs[root] = segs[root] || { id: root, members: [], silent: silentRoots.has(root) }).members.push(x)
  }
  S.segs = segs
  S.ep = ep
  S.tunUp = tunUp
}

function buildAddresses(S) {
  for (const n of S.net.order) {
    const R = S.r[n], st = R.st
    R.addrs = []
    for (const a of L(st, 'ip address')) {
      if (!on(a)) continue
      const c = parseCidr(a.address)
      if (!c || !R.ifs[a.interface]) continue
      const slave = !!bridgeOfIf(st, a.interface)
      const peer = c.prefix === 32 && a.network && a.network !== intToIp(c.ip) ? a.network : null
      R.addrs.push({ ip: intToIp(c.ip), c, iface: a.interface, run: !!R.run[a.interface] && !slave, peer, invalid: slave })
    }
  }
}

const ownsIp = (R, ip) => R.addrs.some((a) => a.ip === ip && !a.invalid && (a.run || R.ifs[a.iface].kind === 'lo'))
function segKey(S, rn, ifn) { return S.segOf[S.ep(rn, ifn)] }
// who answers ARP for ip on the segment of router rn / interface ifn
function ownerOn(S, rn, ifn, ip) {
  const seg = S.segs[segKey(S, rn, ifn)]
  if (!seg) return null
  for (const m of seg.members) {
    if (m.startsWith('host:')) {
      const h = S.net.hosts.find((x) => 'host:' + x.name === m)
      if (h && intToIp(h.c.ip) === ip) return { host: h, seg }
      continue
    }
    const [r, i] = m.split(':')
    if (r === rn && i === (bridgeOfIf(S.r[rn].st, ifn) || ifn)) continue
    const R = S.r[r]
    const a = R.addrs.find((x) => x.ip === ip && x.run && x.iface === i)
    if (a) return { router: r, iface: i, seg }
  }
  return null
}

// ---------- routes ----------
function connectedRoutes(R) {
  const out = []
  for (const a of R.addrs) {
    if (a.invalid) continue
    const dst = a.peer ? a.peer + '/32' : cidrStr(a.c)
    out.push({ dst, c: parseCidr(dst), gateway: a.iface, gwText: a.iface, distance: 0, proto: 'c', type: 'C', dynamic: true, active: a.run, scope: 10, table: 'main', nh: a.run ? [{ iface: a.iface, gw: null }] : [], iface: a.iface })
  }
  return out
}

function staticDefs(R) {
  const st = R.st
  return L(st, 'ip route').filter(on).map((r) => {
    const dst = r['dst-address'] || '0.0.0.0/0'
    const c = parseCidr(dst)
    const bh = yes(r.blackhole) || ['blackhole', 'prohibit', 'unreachable'].includes(r.type)
    return { dst: c ? cidrStr(c) : dst, c, item: r, gateway: r.gateway || '', gwText: bh ? (r.type && r.type !== 'blackhole' ? r.type : '') : r.gateway || '', distance: Number(r.distance || 1), proto: 's', type: 'S', dynamic: false, blackhole: bh, kind: bh ? (r.type || 'blackhole') : 'unicast', scope: Number(r.scope ?? 30), target: Number(r['target-scope'] ?? 10), table: r['routing-table'] || r['routing-mark'] || 'main', check: ['ping', 'arp'].includes(r['check-gateway']) ? r['check-gateway'] : null, prefSrc: r['pref-src'] || null }
  })
}

function bestIn(list, ip) {
  let best = null
  for (const r of list) if (r.selected && r.c && inSubnet(ip, r.c) && (!best || r.c.prefix > best.c.prefix)) best = r
  return best
}

function buildRoutes(S, final = false) {
  for (const n of S.net.order) {
    const R = S.r[n]
    const conn = connectedRoutes(R)
    const ospfR = (R.ospf && R.ospf.routes || []).filter((r) => final || r.otype !== 'ext1' && r.otype !== 'ext2')
    const stat = staticDefs(R)
    for (const s of stat) { s.active = false; s.nh = []; s.failedCheck = (R.cgFail || {})[s.item['.id']] }
    // resolve gateways; repeat so that recursive routes can use routes resolved in the previous round
    for (let round = 0; round < 4; round++) {
      const resolvers = [...conn, ...ospfR.map((o) => ({ ...o, selected: true })), ...stat.filter((s) => s.active && !s.blackhole && s.table === 'main')]
      selectAll(resolvers)
      for (const s of stat) {
        if (s.blackhole) { s.active = true; s.nh = []; continue }
        if (s.failedCheck && s.failedCheck.all) { s.active = false; continue }
        const nhs = []
        for (const g of s.gateway.split(',').filter(Boolean)) {
          const [gip, gif] = g.split('%')
          if (ipToInt(gip) === null) { if (R.run[gip]) nhs.push({ iface: gip, gw: null }); continue }
          if (gif) { if (R.run[gif]) nhs.push({ iface: gif, gw: gip }); continue }
          if (s.failedCheck && s.failedCheck[gip]) continue
          const cand = resolvers.filter((x) => x !== s && x.active && x.scope <= s.target && x.c && inSubnet(gip, x.c))
          cand.sort((a, b) => b.c.prefix - a.c.prefix || a.distance - b.distance)
          const via = cand[0]
          if (!via) continue
          if (via.proto === 'c') nhs.push({ iface: via.nh[0].iface, gw: gip })
          else { const v = via.nh[hash(gip) % via.nh.length]; if (v) nhs.push({ iface: v.iface, gw: v.gw || gip, recursive: true, via: gip }) }
        }
        s.nh = nhs
        s.active = nhs.length > 0
      }
    }
    const all = [...conn, ...ospfR, ...stat]
    // DHCP/PPP dynamic routes are not used in the network labs
    for (const r of all) r.iface = r.nh && r.nh[0] ? r.nh[0].iface : r.iface || null
    selectAll(all)
    R.routes = all
  }
}

// choose active routes per table and destination: lowest distance wins, equal distance = ECMP
function selectAll(list) {
  const groups = {}
  for (const r of list) { r.selected = false; r.ecmp = false; if (!r.active || !r.c) continue; (groups[(r.table || 'main') + ' ' + r.dst] = groups[(r.table || 'main') + ' ' + r.dst] || []).push(r) }
  for (const g of Object.values(groups)) {
    const min = Math.min(...g.map((r) => r.distance))
    let win = g.filter((r) => r.distance === min)
    if (win.some((r) => r.proto === 'o')) {
      // OSPF: intra-area before inter-area before external type 1 before type 2, then the lowest cost
      const rank = { intra: 0, inter: 1, ext1: 2, ext2: 3 }
      const ospfWin = win.filter((r) => r.proto === 'o')
      const best = Math.min(...ospfWin.map((r) => rank[r.otype] * 1e7 + r.cost))
      win = win.filter((r) => r.proto !== 'o' || rank[r.otype] * 1e7 + r.cost === best)
    }
    if (win.some((r) => r.proto === 'c')) win = win.filter((r) => r.proto === 'c').slice(0, 1)
    for (const r of win) { r.selected = true; r.ecmp = win.length > 1 || (r.nh && r.nh.length > 1) }
  }
}

function lookup(R, table, ip) {
  const list = R.routes.filter((r) => (r.table || 'main') === table)
  const cands = list.filter((r) => r.selected && r.c && inSubnet(ip, r.c))
  if (!cands.length) return null
  const pfx = Math.max(...cands.map((r) => r.c.prefix))
  const win = cands.filter((r) => r.c.prefix === pfx)
  const nh = win.flatMap((r) => r.nh || [])
  return { route: win[0], routes: win, nh }
}

function checkGateways(S) {
  let changed = false
  for (const n of S.net.order) {
    const R = S.r[n]
    for (const s of R.routes.filter((r) => r.proto === 's' && r.item && r.check)) {
      const failed = {}
      let okAny = false
      for (const g of s.gateway.split(',').filter(Boolean)) {
        const gip = g.split('%')[0]
        if (ipToInt(gip) === null) { okAny = true; continue }
        const nh = s.nh.find((x) => (x.via || x.gw) === gip)
        let ok = false
        if (nh && !nh.recursive) ok = !!ownerOn(S, n, nh.iface, gip) && !(S.segs[segKey(S, n, nh.iface)] || {}).silent
        else if (nh) ok = pingPath(S, n, gip, { skipRoute: s.item }).ok
        if (!ok) failed[gip] = true; else okAny = true
      }
      if (Object.keys(failed).length) { R.cgFail[s.item['.id']] = { ...failed, all: !okAny }; changed = true }
    }
  }
  if (changed) buildRoutes(S)
}

// ---------- tunnels ----------
function tunnelStatus(S) {
  const up = {}
  const net = S.net
  const allTun = []
  for (const n of net.order) for (const [p, kind] of Object.entries(TUN)) for (const t of L(net.routers[n], p)) if (on(t)) allTun.push({ n, t, kind })
  for (const a of allTun) {
    const peer = allTun.find((b) => b.n !== a.n && b.kind === a.kind && ownsIpAny(S.r[b.n], a.t['remote-address']) && ownsIpAny(S.r[a.n], b.t['remote-address'])
      && (a.kind !== 'eoip' || String(a.t['tunnel-id']) === String(b.t['tunnel-id']))
      && (!a.t['local-address'] || a.t['local-address'] === '0.0.0.0' || a.t['local-address'] === b.t['remote-address'])
      && (!b.t['local-address'] || b.t['local-address'] === '0.0.0.0' || b.t['local-address'] === a.t['remote-address']))
    if (!peer) continue
    // the tunnel only works when the endpoints reach each other through the underlay (not through a tunnel)
    const there = pingPath(S, a.n, a.t['remote-address'], { src: b0(a.t['local-address']) || peer.t['remote-address'], underlay: true })
    if (there.ok) up[a.n + ':' + a.t.name] = peer.n + ':' + peer.t.name
    else if (there.viaTunnel) S.r[a.n].log.push(`${a.t.name}: remote address ${a.t['remote-address']} is routed through a tunnel (recursive routing), tunnel goes down`)
  }
  // WireGuard: a peer pair works when the public keys match and one side can reach the other's endpoint
  S.wg = {}
  for (const n of net.order) {
    for (const w of L(net.routers[n], 'interface wireguard').filter(on)) {
      for (const p of L(net.routers[n], 'interface wireguard peers').filter((x) => on(x) && x.interface === w.name)) {
        const remote = net.order.map((m) => ({ m, w2: L(net.routers[m], 'interface wireguard').find((x) => on(x) && x['public-key'] === p['public-key']) })).find((x) => x.w2 && x.m !== n)
        if (!remote) continue
        const back = L(net.routers[remote.m], 'interface wireguard peers').find((x) => on(x) && x.interface === remote.w2.name && x['public-key'] === w['public-key'])
        if (!back) continue
        const ep1 = p['endpoint-address'] && ownsIpAny(S.r[remote.m], p['endpoint-address']) && String(p['endpoint-port'] || '') === String(remote.w2['listen-port'] || '13231') && pingPath(S, n, p['endpoint-address'], { underlay: true }).ok
        const ep2 = back['endpoint-address'] && ownsIpAny(S.r[n], back['endpoint-address']) && String(back['endpoint-port'] || '') === String(w['listen-port'] || '13231') && pingPath(S, remote.m, back['endpoint-address'], { underlay: true }).ok
        if (ep1 || ep2) S.wg[n + ':' + w.name + ':' + p['.id']] = { m: remote.m, w2: remote.w2.name, allowed: p['allowed-address'] || '', back }
      }
    }
  }
  return up
}
const b0 = (x) => x && x !== '0.0.0.0' ? x : null
const ownsIpAny = (R, ip) => !!ip && R.addrs.some((a) => a.ip === ip && !a.invalid)

// =====================================================================================
// forwarding: one packet hop by hop, then the reply
// =====================================================================================
function nodeOf(S, name) { return S.r[name] ? { router: name } : (S.net.hosts.find((h) => h.name === name) ? { host: S.net.hosts.find((h) => h.name === name) } : null) }

function chooseSrc(S, rn, route, nh, dst) {
  const R = S.r[rn]
  if (route && route.prefSrc) return route.prefSrc
  if (nh) {
    const tgt = nh.gw || dst
    const a = R.addrs.find((x) => x.iface === nh.iface && !x.invalid && (inSubnet(tgt, x.c) || x.peer === tgt)) || R.addrs.find((x) => x.iface === (bridgeOfIf(R.st, nh.iface) || nh.iface) && !x.invalid)
    if (a) return a.ip
  }
  const any = R.addrs.find((x) => x.run && !x.invalid)
  return any ? any.ip : '0.0.0.0'
}

function routeFor(S, rn, pk, first) {
  const R = S.r[rn], st = R.st
  // mangle: output for packets from the router itself, prerouting for transit packets
  const m = { src: pk.src, dst: pk.dst, protocol: 'icmp', inIf: first ? undefined : pk.inIf, state: 'new', routingMark: pk.mark }
  evalChain(st, 'mangle', first ? 'output' : 'prerouting', m)
  let table = pk.table || m.routingMark || 'main'
  let only = false
  for (const ru of L(st, 'routing rule').filter(on)) {
    const ok = (!ru['src-address'] || inSubnet(pk.src, ru['src-address'])) && (!ru['dst-address'] || inSubnet(pk.dst, ru['dst-address']))
      && (!ru['routing-mark'] || ru['routing-mark'] === m.routingMark) && (!ru.interface || (!first && ru.interface === pk.inIf))
    if (!ok) continue
    const a = ru.action || 'lookup'
    if (a === 'drop' || a === 'unreachable') return { drop: `dropped by /routing rule action=${a}` }
    table = ru.table || 'main'; only = a === 'lookup-only-in-table'
    break
  }
  let found = lookup(R, table, pk.dst)
  if (!found && table !== 'main' && !only && !L(st, 'routing table').some((t) => t.name === table && !yes(t.fib) && false)) found = lookup(R, 'main', pk.dst)
  if (!found) return { drop: `${rn} has no route to ${pk.dst}${table !== 'main' ? ' in routing table ' + table : ''}` }
  return { found, table, mark: m.routingMark }
}

// Send one packet from node `from` (router or host name). Returns { ok, at, why, path, ttl, viaTunnel, nat }
function send(S, from, src, dst, opts = {}) {
  let node = nodeOf(S, from)
  if (!node) return { ok: false, why: 'unknown node ' + from }
  let pk = { src, dst, ttl: 64, inIf: null, mark: null, table: opts.table }
  const path = []
  const nodes = []
  const nat = [...(opts.nat || [])]
  let first = true, viaTunnel = false
  for (let step = 0; step < 40; step++) {
    if (node.host) {
      const h = node.host
      if (intToIp(h.c.ip) === pk.dst) return { ok: true, at: h.name, path, nodes, ttl: pk.ttl, nat, viaTunnel }
      if (!first) return { ok: false, at: h.name, why: `${h.name} is a host and does not route packets`, path, nodes }
      const [r, i] = h.at.split(':')
      if (!S.r[r].run[i]) return { ok: false, why: `${h.name}: the cable to ${r} ${i} is down`, path, nodes }
      const tgt = inSubnet(pk.dst, h.c) ? pk.dst : h.gw
      if (!inSubnet(tgt, h.c)) return { ok: false, why: `${h.name}: gateway ${h.gw} is not in its subnet`, path, nodes }
      const seg = S.segs[S.segOf['host:' + h.name]]
      if (seg && seg.silent) return { ok: false, why: 'the link is dead behind the switch', path, nodes }
      const o = findOwnerInSeg(S, seg, tgt, 'host:' + h.name)
      if (!o) return { ok: false, why: `${h.name}: nobody answers ARP for ${tgt}`, path, nodes }
      node = o.router ? { router: o.router } : { host: o.host }
      pk.inIf = o.iface
      first = false
      continue
    }
    const rn = node.router, R = S.r[rn], st = R.st
    if (!first) {
      // undo source NAT for replies
      const nt = nat.find((x) => x.router === rn && x.to === pk.dst)
      if (nt) pk.dst = nt.from
      // reverse path filter
      const rp = st.singletons['ip settings'] && st.singletons['ip settings']['rp-filter']
      if (rp === 'strict' || rp === 'loose') {
        const back = lookup(R, 'main', pk.src)
        const okRp = back && (rp === 'loose' || back.nh.some((x) => x.iface === pk.inIf || bridgeOfIf(st, x.iface) === pk.inIf))
        if (!okRp) return { ok: false, at: rn, why: `${rn} dropped the packet: rp-filter=${rp}, the reply to ${pk.src} would not leave through ${pk.inIf} (source address spoofing protection)`, path, nodes }
      }
    }
    if (ownsIp(R, pk.dst) || (!first && R.addrs.some((a) => a.ip === pk.dst && !a.invalid))) return { ok: true, at: rn, path, nodes, ttl: pk.ttl, nat, viaTunnel }
    if (!first) {
      pk.ttl--
      const a = R.addrs.find((x) => x.iface === pk.inIf && !x.invalid)
      path.push(a ? a.ip : rn)
      nodes.push(rn)
      if (pk.ttl <= 0) return { ok: false, at: rn, why: `TTL exceeded at ${rn}: the packet is going round in a routing loop`, path, nodes }
      if (st.singletons['ip settings'] && st.singletons['ip settings']['ip-forward'] === 'no') return { ok: false, at: rn, why: `${rn} has ip-forward=no`, path, nodes }
    }
    const d = routeFor(S, rn, pk, first)
    if (d.drop) return { ok: false, at: rn, why: d.drop, path, nodes, status: first ? 'no route to host' : 'timeout' }
    const { found } = d
    if (opts.skipRoute && found.route.item === opts.skipRoute && found.routes.length === 1) return { ok: false, at: rn, why: 'check-gateway probe', path, nodes }
    if (found.route.blackhole) return { ok: false, at: rn, why: `${rn}: ${found.route.dst} is a ${found.route.kind} route`, path, nodes, status: first ? (found.route.kind === 'blackhole' ? 'timeout' : found.route.kind) : 'timeout' }
    const nh = found.nh[hash(pk.src + pk.dst) % found.nh.length]
    if (!nh) return { ok: false, at: rn, why: `${rn}: route ${found.route.dst} has no usable gateway`, path, nodes }
    if (opts.underlay && ['gre', 'ipip', 'eoip', 'wg'].includes((R.ifs[nh.iface] || {}).kind)) return { ok: false, at: rn, why: 'underlay goes through a tunnel', path, nodes, viaTunnel: true }
    if (['gre', 'ipip', 'eoip', 'wg'].includes((R.ifs[nh.iface] || {}).kind)) viaTunnel = true
    if (first && !pk.src) pk.src = chooseSrc(S, rn, found.route, nh, pk.dst)
    // source NAT on the way out
    const sn = evalChain(st, 'nat', 'srcnat', { src: pk.src, dst: pk.dst, protocol: 'icmp', outIf: nh.iface, state: 'new', routingMark: d.mark })
    if (['masquerade', 'src-nat'].includes(sn.verdict) && !first && !opts.reply) {
      const to = sn.verdict === 'src-nat' && sn.rule['to-addresses'] ? sn.rule['to-addresses'].split('-')[0] : chooseSrc(S, rn, null, nh, pk.dst)
      if (to !== pk.src) { nat.push({ router: rn, from: pk.src, to }); pk.src = to }
    }
    // WireGuard: pick the peer by allowed-address
    if (R.ifs[nh.iface] && R.ifs[nh.iface].kind === 'wg') {
      const w = R.ifs[nh.iface].it
      const peers = Object.entries(S.wg).filter(([k]) => k.startsWith(rn + ':' + w.name + ':'))
      const pe = peers.find(([, v]) => v.allowed.split(',').filter(Boolean).some((x) => inSubnet(pk.dst, x)))
      const cfgPeer = L(st, 'interface wireguard peers').find((x) => on(x) && x.interface === w.name && (x['allowed-address'] || '').split(',').filter(Boolean).some((a) => inSubnet(pk.dst, a)))
      if (!cfgPeer) return { ok: false, at: rn, why: `${rn}: no WireGuard peer on ${w.name} has ${pk.dst} in allowed-address`, path, nodes }
      if (!pe) return { ok: false, at: rn, why: `${rn}: WireGuard peer on ${w.name} has no handshake (check keys, endpoint address and port)`, path, nodes }
      const v = pe[1]
      if (!(v.back['allowed-address'] || '').split(',').filter(Boolean).some((x) => inSubnet(pk.src, x))) return { ok: false, at: v.m, why: `${v.m}: dropped, source ${pk.src} is not in the allowed-address of its WireGuard peer`, path, nodes }
      node = { router: v.m }
      pk.inIf = v.w2
      first = false
      continue
    }
    const seg = S.segs[segKey(S, rn, nh.iface)]
    if (seg && seg.silent) return { ok: false, at: rn, why: `the link from ${rn} ${nh.iface} is dead behind the switch (port still up, no traffic passes)`, path, nodes }
    const tgt = nh.gw || pk.dst
    let o = ownerOn(S, rn, nh.iface, tgt)
    if (!o && !nh.gw && seg) {
      // interface gateway on a point-to-point tunnel: the other end takes everything
      const others = seg.members.filter((m) => m !== S.ep(rn, nh.iface))
      if (others.length === 1 && !others[0].startsWith('host:')) { const [r2, i2] = others[0].split(':'); o = { router: r2, iface: i2 } }
    }
    if (!o) return { ok: false, at: rn, why: `${rn}: no answer to ARP for ${tgt} on ${nh.iface}`, path, nodes, status: first ? 'host unreachable' : 'timeout' }
    node = o.router ? { router: o.router } : { host: o.host }
    pk.inIf = o.iface
    first = false
  }
  // name the routers that keep passing the packet back and forth
  const loop = [...new Set(nodes.slice(-6))]
  return { ok: false, why: `routing loop: the packet circles between ${loop.join(' and ')} until its TTL expires`, path, nodes, status: 'TTL exceeded' }
}

function findOwnerInSeg(S, seg, ip, self) {
  if (!seg) return null
  for (const m of seg.members) {
    if (m === self) continue
    if (m.startsWith('host:')) { const h = S.net.hosts.find((x) => 'host:' + x.name === m); if (h && intToIp(h.c.ip) === ip) return { host: h }; continue }
    const [r, i] = m.split(':')
    if (S.r[r].addrs.some((a) => a.ip === ip && a.iface === i && a.run)) return { router: r, iface: i }
  }
  return null
}

// ping: request and reply
export function pingPath(S, from, dst, opts = {}) {
  const fromNode = nodeOf(S, from)
  let src = opts.src || null
  if (fromNode && fromNode.host) src = intToIp(fromNode.host.c.ip)
  if (src && fromNode && fromNode.router && !S.r[from].addrs.some((a) => a.ip === src)) return { ok: false, why: `${src} is not an address of ${from}`, status: 'timeout' }
  const go = send(S, from, src, dst, opts)
  if (!go.ok) return { ...go, hops: go.path.length, status: go.status || 'timeout' }
  if (opts.underlay && go.viaTunnel) return { ok: false, viaTunnel: true, why: 'through a tunnel' }
  const realSrc = src || (go.path.length || true ? null : null)
  const srcIp = src || firstSrc(S, from, dst, opts)
  const replySrc = dst
  // the reply goes from the node that answered back to the (possibly translated) source
  const natTo = go.nat.length ? go.nat[go.nat.length - 1].to : srcIp
  const back = send(S, go.at, replySrc, natTo, { nat: go.nat, underlay: opts.underlay, reply: true })
  if (!back.ok) return { ok: false, why: 'the request arrived, but the reply was lost: ' + back.why, path: go.path.concat([dst]), hops: go.path.length, status: 'timeout' }
  if (opts.underlay && back.viaTunnel) return { ok: false, viaTunnel: true, why: 'reply through a tunnel' }
  return { ok: true, path: go.path.concat([dst]), hops: go.path.length, ttl: back.ttl, viaTunnel: go.viaTunnel }
}
function firstSrc(S, from, dst, opts) {
  if (!S.r[from]) return null
  const d = routeFor(S, from, { src: null, dst, table: opts.table }, true)
  if (d.drop) return null
  const nh = d.found.nh[hash('' + dst) % Math.max(1, d.found.nh.length)]
  return chooseSrc(S, from, d.found.route, nh, dst)
}

// =====================================================================================
// OSPF
// =====================================================================================
const AREA0 = '0.0.0.0'
const rtrIdOf = (R) => {
  const inst = L(R.st, 'routing ospf instance').find(on)
  if (inst && ipToInt(inst['router-id']) !== null) return inst['router-id']
  const lo = R.addrs.filter((a) => R.ifs[a.iface].kind === 'lo' || (R.ifs[a.iface].kind === 'bridge' && !L(R.st, 'interface bridge port').some((p) => p.bridge === a.iface)))
  const pool = (lo.length ? lo : R.addrs).filter((a) => !a.invalid).map((a) => ipToInt(a.ip))
  return pool.length ? intToIp(Math.max(...pool)) : '0.0.0.0'
}

function ospfIfaces(S, R) {
  const st = R.st
  const inst = L(st, 'routing ospf instance').find(on)
  if (!inst) return null
  const areas = L(st, 'routing ospf area').filter((a) => on(a) && a.instance === inst.name)
  const tpls = L(st, 'routing ospf interface-template').filter(on)
  const out = []
  for (const a of R.addrs) {
    if (a.invalid || !a.run) continue
    const t = tpls.find((t) => (t.interfaces && t.interfaces.split(',').includes(a.iface)) || (t.networks && t.networks.split(',').some((nw) => inSubnet(a.ip, nw))))
    if (!t) continue
    const area = areas.find((x) => x.name === t.area)
    if (!area) continue
    const kind = R.ifs[a.iface].kind
    out.push({ R: R.name, iface: a.iface, ip: a.ip, c: a.c, peer: a.peer, area: area['area-id'] || AREA0, areaName: area.name, atype: area.type || 'default', noSum: yes(area['no-summaries']), defCost: Number(area['default-cost'] || 1),
      type: t.type || 'broadcast', cost: Number(t.cost ?? 1), prio: Number(t.priority ?? 128), passive: yes(t.passive) || kind === 'lo', hello: secsOf(t['hello-interval'] || '10s'), dead: secsOf(t['dead-interval'] || '40s'), auth: t.auth || '', key: t['auth-key'] || '' })
  }
  return { inst, ifs: out, rid: rtrIdOf(R) }
}

function ospf(S, withExternals) {
  const net = S.net
  const O = {}
  for (const n of net.order) {
    const R = S.r[n]
    const oi = ospfIfaces(S, R)
    R.ospf = oi ? { ...oi, nbrs: [], routes: [], lsas: [], problems: [] } : null
    if (oi) O[n] = R.ospf
  }
  // neighbours per segment
  const segIfs = {}
  for (const [n, o] of Object.entries(O)) for (const i of o.ifs) {
    const k = segKey(S, n, i.iface)
    if (!k) continue
    ;(segIfs[k] = segIfs[k] || []).push(i)
  }
  const segInfo = {}
  for (const [k, list] of Object.entries(segIfs)) {
    const seg = S.segs[k]
    const act = list.filter((i) => !i.passive)
    const pairs = []
    for (let x = 0; x < act.length; x++) for (let y = x + 1; y < act.length; y++) {
      const a = act[x], b = act[y]
      if (a.R === b.R) continue
      const sameNet = a.peer || b.peer ? (a.peer === b.ip || b.peer === a.ip) : (a.c.net === b.c.net && a.c.prefix === b.c.prefix)
      let why = ''
      if (!sameNet) why = `${a.ip} and ${b.ip} are not in the same subnet`
      else if (a.area !== b.area) why = `area ID mismatch (${a.area} / ${b.area})`
      else if (a.hello !== b.hello || a.dead !== b.dead) why = `hello/dead interval mismatch (${a.hello}/${a.dead} s and ${b.hello}/${b.dead} s)`
      else if ((a.atype === 'stub') !== (b.atype === 'stub') || (a.atype === 'nssa') !== (b.atype === 'nssa')) why = 'area type mismatch (stub / NSSA flag differs)'
      else if (a.auth !== b.auth || a.key !== b.key) why = 'authentication mismatch'
      else if ((a.type === 'ptp') !== (b.type === 'ptp')) why = `network type mismatch (${a.type} / ${b.type})`
      else if (O[a.R].rid === O[b.R].rid) why = `duplicate router ID ${O[a.R].rid}`
      else if (a.type === 'nbma' && !nbmaOk(S, a, b) && !nbmaOk(S, b, a)) why = 'NBMA: no static neighbour configured'
      if (seg && seg.silent) why = why || 'no hellos received (link dead behind the switch)'
      if (why) { S.r[a.R].log.push(`ospf,warning ${a.iface}: neighbour ${b.ip}: ${why}`); S.r[b.R].log.push(`ospf,warning ${b.iface}: neighbour ${a.ip}: ${why}`); continue }
      pairs.push([a, b])
    }
    // DR / BDR election on broadcast and NBMA segments
    let dr = null, bdr = null
    const multi = act.filter((i) => i.type === 'broadcast' || i.type === 'nbma').filter((i) => pairs.some(([a, b]) => a === i || b === i))
    if (multi.length) {
      const cand = multi.filter((i) => i.prio > 0).sort((a, b) => b.prio - a.prio || ipToInt(O[b.R].rid) - ipToInt(O[a.R].rid))
      dr = cand[0] || null
      bdr = cand[1] || null
    }
    segInfo[k] = { list, pairs, dr, bdr }
    for (const [a, b] of pairs) {
      const ptp = a.type === 'ptp'
      const full = ptp || [dr, bdr].includes(a) || [dr, bdr].includes(b)
      const role = (i) => ptp ? 'ptp' : i === dr ? 'DR' : i === bdr ? 'BDR' : 'DROther'
      O[a.R].nbrs.push({ iface: a.iface, area: a.areaName, addr: b.ip, rid: O[b.R].rid, state: full ? 'Full' : '2-Way', prio: b.prio, dr: dr ? dr.ip : '', bdr: bdr ? bdr.ip : '', role: role(b), peer: b, me: a })
      O[b.R].nbrs.push({ iface: b.iface, area: b.areaName, addr: a.ip, rid: O[a.R].rid, state: full ? 'Full' : '2-Way', prio: a.prio, dr: dr ? dr.ip : '', bdr: bdr ? bdr.ip : '', role: role(a), peer: a, me: b })
    }
    for (const i of list) i.role = i.passive ? 'passive' : i.type === 'ptp' ? 'ptp' : i === dr ? 'DR' : i === bdr ? 'BDR' : multi.includes(i) ? 'DROther' : 'waiting'
  }
  // link-state graph per area
  const areas = {}
  for (const [n, o] of Object.entries(O)) for (const i of o.ifs) (areas[i.area] = areas[i.area] || { id: i.area, routers: new Set(), type: i.atype, noSum: false }).routers.add(n)
  for (const [n, o] of Object.entries(O)) for (const i of o.ifs) if (i.noSum) areas[i.area].noSum = true
  const intra = {}  // intra[area][router] = Map(prefix -> { cost, nh: [{iface, gw}] })
  const distTo = {} // distTo[area][from][to] = { cost, nh }
  for (const A of Object.values(areas)) {
    intra[A.id] = {}; distTo[A.id] = {}
    // adjacency: router -> [{ to, cost, iface, gw }]   (transit networks as nodes "N:<seg>")
    const adj = {}
    const stubs = {}
    const addE = (f, e) => (adj[f] = adj[f] || []).push(e)
    for (const n of A.routers) {
      stubs[n] = []
      for (const i of O[n].ifs.filter((x) => x.area === A.id)) {
        const k = segKey(S, n, i.iface)
        const si = segInfo[k]
        const myPairs = si ? si.pairs.filter(([a, b]) => a === i || b === i) : []
        const pfx = i.peer ? i.peer + '/32' : cidrStr(i.c)
        if (i.type === 'ptp' || !si || !si.dr || !myPairs.length) {
          // point-to-point links and stub networks
          for (const [a, b] of myPairs) { const o = a === i ? b : a; addE(n, { to: o.R, cost: i.cost, iface: i.iface, gw: o.ip }) }
          stubs[n].push({ pfx: i.type === 'ptp' && !i.peer ? cidrStr(i.c) : pfx, cost: i.cost, iface: i.iface })
          if (i.peer) stubs[n].push({ pfx: i.ip + '/32', cost: 0, iface: i.iface, own: true })
        } else {
          // transit network represented by its DR
          const N = 'N:' + k
          const full = i === si.dr || myPairs.some(([a, b]) => [si.dr].includes(a === i ? b : a))
          if (!full && i !== si.bdr && !myPairs.some(([a, b]) => [si.dr, si.bdr].includes(a === i ? b : a))) { stubs[n].push({ pfx, cost: i.cost, iface: i.iface }); continue }
          addE(n, { to: N, cost: i.cost, iface: i.iface, gw: null })
          addE(N, { to: n, cost: 0, gwIp: i.ip })
          stubs[N] = [{ pfx: cidrStr(i.c), cost: 0 }]
        }
      }
    }
    // Dijkstra from every router of the area
    for (const root of A.routers) {
      const dist = { [root]: { cost: 0, nh: [] } }
      const done = new Set()
      for (;;) {
        let u = null
        for (const [k, v] of Object.entries(dist)) if (!done.has(k) && (u === null || v.cost < dist[u].cost)) u = k
        if (u === null) break
        done.add(u)
        for (const e of adj[u] || []) {
          const c = dist[u].cost + e.cost
          let nh
          if (u === root) nh = e.to.startsWith('N:') ? [{ iface: e.iface, gw: null, viaNet: e.to }] : [{ iface: e.iface, gw: e.gw }]
          else if (u.startsWith('N:') && dist[u].nh.length && dist[u].nh[0].viaNet && dist[u].nh[0].gw === null) nh = [{ iface: dist[u].nh[0].iface, gw: e.gwIp }]
          else nh = dist[u].nh
          if (!dist[e.to] || c < dist[e.to].cost) dist[e.to] = { cost: c, nh: [...nh] }
          else if (c === dist[e.to].cost) for (const x of nh) if (!dist[e.to].nh.some((y) => y.iface === x.iface && y.gw === x.gw)) dist[e.to].nh.push(x)
        }
      }
      distTo[A.id][root] = dist
      const table = new Map()
      const mine = new Set(O[root].ifs.map((i) => i.peer ? i.peer + '/32' : cidrStr(i.c)))
      for (const [node, d] of Object.entries(dist)) {
        for (const s of stubs[node] || []) {
          if (node === root || mine.has(s.pfx)) continue
          const cost = d.cost + s.cost
          const nh = d.nh.filter((x) => x.gw !== null)
          if (!nh.length) continue
          const cur = table.get(s.pfx)
          if (!cur || cost < cur.cost) table.set(s.pfx, { cost, nh: [...nh] })
          else if (cost === cur.cost) for (const x of nh) if (!cur.nh.some((y) => y.iface === x.iface && y.gw === x.gw)) cur.nh.push(x)
        }
      }
      intra[A.id][root] = table
    }
    A.stubs = stubs
  }
  // ABRs
  const abrs = Object.keys(O).filter((n) => new Set(O[n].ifs.map((i) => i.area)).size > 1 && O[n].ifs.some((i) => i.area === AREA0))
  const ownPrefixes = (n, area) => new Set(O[n].ifs.filter((i) => i.area === area).map((i) => i.peer ? i.peer + '/32' : cidrStr(i.c)))
  // prefixes an area offers to others, after area ranges on the ABR
  const areaPrefixes = (abr, area) => {
    const m = new Map()
    for (const [p, v] of intra[area][abr] || []) m.set(p, v.cost)
    for (const p of ownPrefixes(abr, area)) if (!m.has(p)) m.set(p, O[abr].ifs.find((i) => i.area === area && (i.peer ? i.peer + '/32' : cidrStr(i.c)) === p).cost)
    const ranges = L(S.r[abr].st, 'routing ospf area range').filter(on).filter((r) => { const a = L(S.r[abr].st, 'routing ospf area').find((x) => x.name === r.area); return a && (a['area-id'] || AREA0) === area })
    const out = new Map()
    for (const [p, c] of m) {
      const rg = ranges.find((r) => inSubnet(parseCidr(p).net, r.prefix) && parseCidr(p).prefix >= parseCidr(r.prefix).prefix)
      if (rg) { if (yes(rg.advertise) || rg.advertise === undefined) out.set(cidrStr(parseCidr(rg.prefix)), Math.max(out.get(cidrStr(parseCidr(rg.prefix))) || 0, rg.cost ? Number(rg.cost) : c)) }
      else out.set(p, c)
    }
    return out
  }
  // summaries into each area: { area: [{ abr, pfx, cost }] }
  const summ = {}
  for (const abr of abrs) {
    const myAreas = [...new Set(O[abr].ifs.map((i) => i.area))]
    for (const a of myAreas) for (const b of myAreas) {
      if (a === b) continue
      if (b !== AREA0 && a !== AREA0) continue // only through the backbone
      const target = areas[b]
      if (target.type !== 'default' && target.noSum) continue
      for (const [p, c] of areaPrefixes(abr, a)) (summ[b] = summ[b] || []).push({ abr, pfx: p, cost: c, from: a })
    }
  }
  // backbone routers know non-backbone prefixes; ABRs then pass prefixes of other non-backbone areas on
  for (const abr of abrs) {
    const myAreas = [...new Set(O[abr].ifs.map((i) => i.area))].filter((x) => x !== AREA0)
    for (const s of summ[AREA0] || []) {
      if (s.abr === abr || myAreas.includes(s.from)) continue
      const d = distTo[AREA0][abr] && distTo[AREA0][abr][s.abr]
      if (!d) continue
      for (const b of myAreas) if (!(areas[b].type !== 'default' && areas[b].noSum)) (summ[b] = summ[b] || []).push({ abr, pfx: s.pfx, cost: d.cost + s.cost, from: s.from })
    }
    for (const b of myAreas) if (areas[b].type !== 'default') (summ[b] = summ[b] || []).push({ abr, pfx: '0.0.0.0/0', cost: O[abr].ifs.find((i) => i.area === b).defCost, from: 'default' })
  }
  // externals (ASBR)
  const ext = [] // { asbr, area (originating area for NSSA), pfx, metric, etype }
  if (withExternals) {
    for (const [n, o] of Object.entries(O)) {
      const inst = o.inst
      const R = S.r[n]
      const red = (inst.redistribute || '').split(',').filter(Boolean)
      const cands = []
      if (red.includes('connected')) for (const r of R.routes.filter((x) => x.proto === 'c' && x.active)) if (!o.ifs.some((i) => (i.peer ? i.peer + '/32' : cidrStr(i.c)) === r.dst)) cands.push({ dst: r.dst, proto: 'connected' })
      if (red.includes('static')) for (const r of R.routes.filter((x) => x.proto === 's' && x.selected && (x.table || 'main') === 'main')) cands.push({ dst: r.dst, proto: 'static' })
      const od = inst['originate-default'] || 'never'
      if (od === 'always' || (od === 'if-installed' && R.routes.some((x) => x.dst === '0.0.0.0/0' && x.selected && x.proto !== 'o' && (x.table || 'main') === 'main'))) cands.push({ dst: '0.0.0.0/0', proto: 'default', forced: true })
      for (const c of cands) {
        let etype = 'type2', metric = c.forced ? 1 : 20
        if (inst['out-filter-chain'] && !c.forced) {
          const rules = L(R.st, 'routing filter rule')
          if (rules.some((x) => x.chain === inst['out-filter-chain'])) {
            const f = runFilter(rules, inst['out-filter-chain'], { dst: c.dst, proto: c.proto, distance: 0 })
            if (f.verdict !== 'accept') continue
            if (f.set['ospf-ext-type']) etype = f.set['ospf-ext-type'] === 'type1' || f.set['ospf-ext-type'] === '1' ? 'type1' : 'type2'
            if (f.set['ospf-ext-metric']) metric = Number(f.set['ospf-ext-metric'])
          }
        }
        const nssaArea = o.ifs.find((i) => i.atype === 'nssa')
        ext.push({ asbr: n, pfx: c.dst, metric, etype, nssa: nssaArea ? nssaArea.area : null })
      }
    }
  }
  // routes per router
  for (const [n, o] of Object.entries(O)) {
    const best = new Map()
    const put = (pfx, cand) => {
      const cur = best.get(pfx)
      const rank = { intra: 0, inter: 1, ext1: 2, ext2: 3 }
      const key = (x) => rank[x.otype] * 1e9 + (x.otype === 'ext2' ? x.metric * 1e5 + x.cost : x.cost)
      if (!cur || key(cand) < key(cur)) best.set(pfx, { ...cand, nh: [...cand.nh] })
      else if (key(cand) === key(cur)) for (const x of cand.nh) if (!cur.nh.some((y) => y.iface === x.iface && y.gw === x.gw)) cur.nh.push(x)
    }
    const myAreas = [...new Set(o.ifs.map((i) => i.area))]
    for (const a of myAreas) for (const [p, v] of intra[a][n] || []) put(p, { otype: 'intra', cost: v.cost, nh: v.nh, area: a })
    for (const a of myAreas) for (const s of summ[a] || []) {
      if (s.abr === n) continue
      if (abrs.includes(n) && a !== AREA0) continue // an ABR takes inter-area routes from the backbone only
      const d = distTo[a][n] && distTo[a][n][s.abr]
      if (!d || !d.nh.length) continue
      put(s.pfx, { otype: 'inter', cost: d.cost + s.cost, nh: d.nh.filter((x) => x.gw !== null), area: a })
    }
    for (const e of ext) {
      if (e.asbr === n) continue
      // which of my areas lets me reach the ASBR, and is the external allowed into that area?
      let bestD = null
      for (const a of myAreas) {
        const at = areas[a].type
        if (at === 'stub') continue
        if (at === 'nssa' && e.nssa !== a) continue
        if (at === 'default' && e.nssa && e.nssa !== a && !abrs.some((x) => O[x].ifs.some((i) => i.area === e.nssa))) continue
        let d = distTo[a][n] && distTo[a][n][e.asbr]
        if (!d) {
          // ASBR in another area: go to an ABR of this area first
          for (const abr of abrs) {
            const d1 = distTo[a][n] && distTo[a][n][abr]
            const d2 = Object.values(distTo).map((x) => x[abr] && x[abr][e.asbr]).find(Boolean)
            if (d1 && d2 && (!d || d1.cost + d2.cost < d.cost)) d = { cost: d1.cost + d2.cost, nh: d1.nh }
          }
        }
        if (d && d.nh.length && (!bestD || d.cost < bestD.cost)) bestD = d
      }
      if (!bestD) continue
      put(e.pfx, { otype: e.etype === 'type1' ? 'ext1' : 'ext2', cost: e.etype === 'type1' ? bestD.cost + e.metric : e.metric, metric: e.metric, nh: bestD.nh.filter((x) => x.gw !== null) })
    }
    // in-filter
    const inst = o.inst
    const rules = L(S.r[n].st, 'routing filter rule')
    const useIn = inst['in-filter-chain'] && rules.some((x) => x.chain === inst['in-filter-chain'])
    o.routes = []
    for (const [p, v] of best) {
      if (!v.nh.length) continue
      let distance = 110
      if (useIn) {
        const f = runFilter(rules, inst['in-filter-chain'], { dst: p, proto: 'ospf', distance: 110, metric: v.cost })
        if (f.verdict !== 'accept') continue
        if (f.set.distance) distance = Number(f.set.distance)
      }
      o.routes.push({ dst: p, c: parseCidr(p), gateway: v.nh.map((x) => x.gw).join(','), gwText: v.nh.map((x) => x.gw + '%' + x.iface).join(','), distance, proto: 'o', type: 'O', dynamic: true, active: true, scope: 20, table: 'main', nh: v.nh, cost: v.cost, otype: v.otype })
    }
    // LSA view
    const lsas = []
    for (const a of myAreas) {
      for (const r of areas[a].routers) lsas.push({ area: a, type: 'router', id: O[r].rid, orig: O[r].rid })
      for (const [k, si] of Object.entries(segInfo)) if (si.dr && si.dr.area === a && si.pairs.length) lsas.push({ area: a, type: 'network', id: si.dr.ip, orig: O[si.dr.R].rid })
      for (const s of summ[a] || []) lsas.push({ area: a, type: 'inter-area-prefix', id: s.pfx, orig: O[s.abr].rid })
      for (const e of ext) if (areas[a].type === 'default' && !e.nssa || e.nssa === a) lsas.push({ area: e.nssa === a ? a : 'as', type: e.nssa === a ? 'nssa-external' : 'external', id: e.pfx, orig: O[e.asbr].rid })
    }
    o.lsas = lsas.filter((x, i) => lsas.findIndex((y) => y.area === x.area && y.type === x.type && y.id === x.id && y.orig === x.orig) === i)
    o.areas = myAreas
    o.abr = abrs.includes(n)
    o.asbr = ext.some((e) => e.asbr === n)
  }
}
function nbmaOk(S, a, b) { return L(S.r[a.R].st, 'routing ospf static-neighbor').some((x) => on(x) && x.address === b.ip) }

function printOspf(S, n, path) {
  const o = S.r[n].ospf
  if (!o) return 'Flags: (no OSPF instance on this router: /routing ospf instance add name=default-v2)'
  if (path === 'routing ospf neighbor') {
    const out = ['Flags: V - virtual; D - dynamic', 'Columns: INSTANCE, AREA, ADDRESS, ROUTER-ID, STATE, PRIORITY, DR, BDR', '#   INSTANCE    AREA        ADDRESS          ROUTER-ID      STATE   PRIORITY  DR              BDR']
    o.nbrs.forEach((x, i) => out.push(`${pad(i, 2)}D ${pad(o.inst.name, 12)}${pad(x.area, 12)}${pad(x.addr + '%' + x.iface, 17)}${pad(x.rid, 15)}${pad(x.state, 8)}${pad(x.prio, 10)}${pad(x.dr, 16)}${x.bdr}`))
    if (!o.nbrs.length) out.push('# simulator: no neighbours. Check /routing ospf interface print and /log print')
    return out.join('\n')
  }
  if (path === 'routing ospf interface') {
    const out = ['Flags: D - dynamic, P - passive', 'Columns: AREA, INTERFACE, ADDRESS, NETWORK-TYPE, STATE, COST, PRIORITY', '#   AREA        INTERFACE       ADDRESS            NETWORK-TYPE  STATE     COST  PRIORITY']
    o.ifs.forEach((x, i) => out.push(`${pad(i, 2)}D${x.passive ? 'P' : ' '} ${pad(x.areaName, 12)}${pad(x.iface, 16)}${pad(x.ip + '/' + x.c.prefix, 19)}${pad(x.type, 14)}${pad(x.role ? x.role.toLowerCase() : 'waiting', 10)}${pad(x.cost, 6)}${x.prio}`))
    if (!o.ifs.length) out.push('# simulator: no interface matches an interface-template (check interfaces= or networks=)')
    return out.join('\n')
  }
  const out = ['Columns: AREA, TYPE, ID, ORIGINATOR, AGE', '#   AREA      TYPE                 ID                ORIGINATOR      AGE']
  o.lsas.forEach((x, i) => out.push(`${pad(i, 2)}  ${pad(x.area === AREA0 ? 'backbone' : x.area, 10)}${pad(x.type, 21)}${pad(x.id, 18)}${pad(x.orig, 16)}${12 + i * 7}s`))
  return out.join('\n')
}

// ---------- helpers for lab checks ----------
export function hasRoute(net, rn, dst, proto) { return net.routes(net.routers[rn]).some((r) => r.dst === dst && r.selected && (!proto || r.proto === proto)) }
export function ospfFull(net, a, b) { const o = net.ospfOf(a); return !!o && o.nbrs.some((x) => x.peer.R === b && x.state === 'Full') }
