// Interactive simulators. Each one renders into a container element.

import { subnetInfo, parseCidr, intToIp, ipToInt, inSubnet, parseRate, fmtRate, matchAddr } from './net.js'

const $ = (root, sel) => root.querySelector(sel)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export const SIMS = [
  { id: 'subnet', icon: '🧮', title: 'Subnet calculator', desc: 'Network, broadcast, host range and mask for any IPv4 prefix, plus a practice quiz.', render: subnetSim },
  { id: 'route', icon: '🧭', title: 'Route lookup', desc: 'Build a routing table and see which route wins: longest prefix first, then distance.', render: routeSim },
  { id: 'firewall', icon: '🛡️', title: 'Firewall rule order', desc: 'Send packets through a filter chain and watch which rule matches first.', render: firewallSim },
  { id: 'burst', icon: '📈', title: 'Burst simulator', desc: 'See how burst-limit, burst-threshold and burst-time shape a download over time.', render: burstSim },
  { id: 'pcq', icon: '👥', title: 'PCQ simulator', desc: 'How max-limit and pcq-rate are shared between active users.', render: pcqSim },
  { id: 'channels', icon: '📡', title: '2.4 GHz channel planner', desc: 'Place access points on channels and spot overlap.', render: channelSim },
  { id: 'naming', icon: '🏷️', title: 'Product name decoder', desc: 'Decode RouterBOARD, CCR and CRS model names.', render: namingSim },
]

// ---------- subnet ----------
function subnetSim(el) {
  el.innerHTML = `
  <div class="sim-grid">
    <div class="card">
      <label>IP address / prefix <input id="sn-in" value="192.168.10.77/27" spellcheck="false"></label>
      <input id="sn-range" type="range" min="0" max="32" value="27" aria-label="Prefix length">
      <div id="sn-out" class="kv"></div>
      <div id="sn-bits" class="bits"></div>
    </div>
    <div class="card">
      <h3>Practice</h3>
      <p id="sn-q" class="q"></p>
      <div class="row"><input id="sn-a" placeholder="your answer" spellcheck="false"><button id="sn-check" class="btn">Check</button><button id="sn-next" class="btn ghost">Next</button></div>
      <p id="sn-fb" class="fb"></p>
      <p class="muted">Score: <span id="sn-score">0 / 0</span></p>
    </div>
  </div>`
  const inp = $(el, '#sn-in'), rng = $(el, '#sn-range')
  const show = () => {
    const i = subnetInfo(inp.value)
    if (!i) { $(el, '#sn-out').innerHTML = '<p class="bad">Enter an address like 10.1.2.3/20</p>'; return }
    rng.value = i.prefix
    $(el, '#sn-out').innerHTML = [
      ['Address', i.address], ['Netmask', `${i.mask} (/${i.prefix})`], ['Wildcard', i.wildcard], ['Network', i.network],
      ['Broadcast', i.broadcast], ['Host range', `${i.first} - ${i.last}`], ['Usable hosts', i.hosts.toLocaleString()], ['Type', i.private ? 'Private (RFC 1918)' : 'Public / other'],
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')
    const ip = ipToInt(i.address)
    let bits = ''
    for (let b = 31; b >= 0; b--) {
      const v = (ip >>> b) & 1
      bits += `<i class="${31 - b < i.prefix ? 'n' : 'h'}">${v}</i>` + (b % 8 === 0 && b ? '<s>.</s>' : '')
    }
    $(el, '#sn-bits').innerHTML = bits + `<div class="legend"><i class="n">1</i> network bits <i class="h">1</i> host bits</div>`
  }
  inp.addEventListener('input', show)
  rng.addEventListener('input', () => { inp.value = inp.value.split('/')[0] + '/' + rng.value; show() })
  show()
  let q, good = 0, total = 0
  const kinds = [
    (i) => [`Network address of ${i.address}/${i.prefix}?`, i.network],
    (i) => [`Broadcast address of ${i.address}/${i.prefix}?`, i.broadcast],
    (i) => [`How many usable hosts in a /${i.prefix}?`, String(i.hosts)],
    (i) => [`Subnet mask for /${i.prefix}?`, i.mask],
    (i) => [`Last usable host of ${i.address}/${i.prefix}?`, i.last],
  ]
  const next = () => {
    const pfx = 22 + Math.floor(Math.random() * 9)
    const ip = `${[10, 172, 192][Math.floor(Math.random() * 3)]}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${1 + Math.floor(Math.random() * 254)}`
    const i = subnetInfo(ip + '/' + pfx)
    q = kinds[Math.floor(Math.random() * kinds.length)](i)
    $(el, '#sn-q').textContent = q[0]; $(el, '#sn-a').value = ''; $(el, '#sn-fb').textContent = ''
  }
  $(el, '#sn-check').onclick = () => {
    total++
    const ok = $(el, '#sn-a').value.trim() === q[1]
    if (ok) good++
    $(el, '#sn-fb').innerHTML = ok ? '<span class="good">Correct!</span>' : `<span class="bad">Not quite. Answer: ${q[1]}</span>`
    $(el, '#sn-score').textContent = `${good} / ${total}`
  }
  $(el, '#sn-a').addEventListener('keydown', (e) => { if (e.key === 'Enter') $(el, '#sn-check').click() })
  $(el, '#sn-next').onclick = next
  next()
}

// ---------- route lookup ----------
function routeSim(el) {
  let routes = [
    { dst: '0.0.0.0/0', gw: '22.1.1.1', dist: 1, active: true },
    { dst: '0.0.0.0/0', gw: '172.16.0.1', dist: 2, active: true },
    { dst: '10.0.0.0/8', gw: '10.255.0.1', dist: 1, active: true },
    { dst: '10.1.0.0/16', gw: '10.255.0.2', dist: 1, active: true },
    { dst: '10.1.1.0/24', gw: '10.255.0.3', dist: 1, active: true },
    { dst: '192.168.33.0/24', gw: 'bridgeLAN', dist: 0, active: true, c: true },
  ]
  el.innerHTML = `
  <div class="card">
    <div class="row wrap"><label>Destination <input id="rt-dst" value="10.1.1.5" spellcheck="false"></label>
    <span class="muted">Try 10.1.2.9, 10.200.0.1, 8.8.8.8, 192.168.33.20. Untick a route to make it inactive (failed gateway).</span></div>
    <div class="table-wrap"><table class="rt"><thead><tr><th>Active</th><th>Dst-address</th><th>Gateway</th><th>Distance</th><th></th></tr></thead><tbody id="rt-body"></tbody></table></div>
    <div class="row wrap"><input id="rt-ndst" placeholder="dst e.g. 10.1.1.128/25" spellcheck="false"><input id="rt-ngw" placeholder="gateway" spellcheck="false"><input id="rt-nd" type="number" value="1" min="0" max="255" style="width:5em"><button id="rt-add" class="btn">Add route</button></div>
    <div id="rt-res" class="result"></div>
  </div>`
  const draw = () => {
    const dst = $(el, '#rt-dst').value.trim()
    const ip = ipToInt(dst)
    let win = null, why = ''
    if (ip !== null) {
      const cand = routes.filter((r) => r.active && inSubnet(ip, r.dst))
      cand.sort((a, b) => parseCidr(b.dst).prefix - parseCidr(a.dst).prefix || a.dist - b.dist)
      win = cand[0] || null
      if (win) {
        const same = cand.filter((r) => r.dst === win.dst)
        why = `Matching routes: ${cand.map((r) => r.dst + ' (d' + r.dist + ')').join(', ')}. Longest prefix is /${parseCidr(win.dst).prefix}` + (same.length > 1 ? `; ${same.length} routes share it, lowest distance ${win.dist} wins.` : '.')
      }
    }
    $(el, '#rt-body').innerHTML = routes.map((r, i) => `<tr class="${r === win ? 'win' : ''}"><td><input type="checkbox" data-i="${i}" ${r.active ? 'checked' : ''} ${r.c ? 'disabled' : ''}></td><td>${esc(r.dst)}</td><td>${esc(r.gw)}</td><td>${r.dist}</td><td>${r.c ? '<span class="tag">DAC</span>' : `<button class="link" data-del="${i}">remove</button>`}</td></tr>`).join('')
    $(el, '#rt-res').innerHTML = ip === null ? '<span class="bad">Enter a valid IPv4 address</span>' : win ? `<b>${esc(dst)}</b> goes via <b>${esc(win.gw)}</b> using route <b>${esc(win.dst)}</b>.<br><span class="muted">${esc(why)}</span>` : `<span class="bad">No route to host: the packet is dropped (ICMP unreachable).</span>`
  }
  el.addEventListener('change', (e) => { if (e.target.dataset.i) { routes[e.target.dataset.i].active = e.target.checked; draw() } })
  el.addEventListener('click', (e) => { if (e.target.dataset.del) { routes.splice(Number(e.target.dataset.del), 1); draw() } })
  $(el, '#rt-dst').addEventListener('input', draw)
  $(el, '#rt-add').onclick = () => {
    const d = $(el, '#rt-ndst').value.trim(), g = $(el, '#rt-ngw').value.trim()
    const c = parseCidr(d)
    if (!c || !g) return
    routes.push({ dst: intToIp(c.net) + '/' + c.prefix, gw: g, dist: Number($(el, '#rt-nd').value || 1), active: true })
    draw()
  }
  draw()
}

// ---------- firewall ----------
const FW_PRESETS = {
  bad: [
    { chain: 'input', action: 'drop', note: 'drop everything' },
    { chain: 'input', action: 'accept', src: '192.168.33.0/24', note: 'allow LAN (never reached!)' },
  ],
  good: [
    { chain: 'input', action: 'accept', state: 'established,related', note: 'accept established,related' },
    { chain: 'input', action: 'drop', state: 'invalid', note: 'drop invalid' },
    { chain: 'input', action: 'accept', proto: 'icmp', note: 'allow ping' },
    { chain: 'input', action: 'accept', inIf: 'bridgeLAN', note: 'allow from LAN' },
    { chain: 'input', action: 'drop', note: 'drop everything else' },
    { chain: 'forward', action: 'accept', state: 'established,related', note: 'accept established,related' },
    { chain: 'forward', action: 'drop', state: 'invalid', note: 'drop invalid' },
    { chain: 'forward', action: 'drop', inIf: 'ether1', nat: '!dstnat', note: 'drop new from WAN not port-forwarded' },
  ],
  lab: [
    { chain: 'input', action: 'drop', inIf: 'ether1', proto: 'tcp', port: '8291', note: '1: no Winbox from WAN' },
    { chain: 'forward', action: 'drop', outIf: 'ether1', src: '192.168.33.65-192.168.33.89', note: '2: bad users' },
    { chain: 'input', action: 'accept', proto: 'tcp', port: '1723', note: '3: PPTP' },
    { chain: 'input', action: 'accept', proto: 'udp', port: '1701', note: '3: L2TP' },
    { chain: 'forward', action: 'drop', proto: 'icmp', dst: '8.8.8.8', note: '4: no ping to 8.8.8.8' },
    { chain: 'input', action: 'drop', proto: 'tcp', port: '23', note: '5: no telnet' },
    { chain: 'forward', action: 'drop', proto: 'tcp', port: '110,25,143,80', dst: '212.0.3.43', src: '192.168.33.24/31', note: '6: block server' },
    { chain: 'output', action: 'drop', dst: '212.0.200.1', note: '7: router must not ping' },
  ],
}
const PACKETS = [
  { label: 'LAN laptop opens Winbox on the router', chain: 'input', src: '192.168.33.2', dst: '192.168.33.1', proto: 'tcp', port: 8291, inIf: 'bridgeLAN', state: 'new' },
  { label: 'Internet host opens Winbox on the router', chain: 'input', src: '203.0.113.9', dst: '22.1.1.33', proto: 'tcp', port: 8291, inIf: 'ether1', state: 'new' },
  { label: 'Internet host pings the router', chain: 'input', src: '203.0.113.9', dst: '22.1.1.33', proto: 'icmp', inIf: 'ether1', state: 'new' },
  { label: 'Reply to the router\'s own DNS query', chain: 'input', src: '8.8.8.8', dst: '22.1.1.33', proto: 'udp', port: 53000, inIf: 'ether1', state: 'established' },
  { label: 'Laptop browses a web site', chain: 'forward', src: '192.168.33.2', dst: '142.250.74.46', proto: 'tcp', port: 443, inIf: 'bridgeLAN', outIf: 'ether1', state: 'new' },
  { label: 'Laptop pings 8.8.8.8', chain: 'forward', src: '192.168.33.2', dst: '8.8.8.8', proto: 'icmp', inIf: 'bridgeLAN', outIf: 'ether1', state: 'new' },
  { label: 'Bad user .70 goes to the Internet', chain: 'forward', src: '192.168.33.70', dst: '142.250.74.46', proto: 'tcp', port: 443, inIf: 'bridgeLAN', outIf: 'ether1', state: 'new' },
  { label: 'Host .25 reads mail on 212.0.3.43:110', chain: 'forward', src: '192.168.33.25', dst: '212.0.3.43', proto: 'tcp', port: 110, inIf: 'bridgeLAN', outIf: 'ether1', state: 'new' },
  { label: 'Attacker connects to a LAN PC', chain: 'forward', src: '203.0.113.9', dst: '192.168.33.2', proto: 'tcp', port: 445, inIf: 'ether1', outIf: 'bridgeLAN', state: 'new' },
  { label: 'Port-forwarded web request to 192.168.33.10', chain: 'forward', src: '203.0.113.9', dst: '192.168.33.10', proto: 'tcp', port: 80, inIf: 'ether1', outIf: 'bridgeLAN', state: 'new', nat: 'dstnat' },
  { label: 'Router pings 212.0.200.1', chain: 'output', src: '22.1.1.33', dst: '212.0.200.1', proto: 'icmp', outIf: 'ether1', state: 'new' },
  { label: 'Telnet from LAN to the router', chain: 'input', src: '192.168.33.2', dst: '192.168.33.1', proto: 'tcp', port: 23, inIf: 'bridgeLAN', state: 'new' },
  { label: 'Invalid packet from the Internet', chain: 'input', src: '203.0.113.9', dst: '22.1.1.33', proto: 'tcp', port: 8291, inIf: 'ether1', state: 'invalid' },
]

function fwMatch(r, p) {
  if (r.chain !== p.chain) return false
  const n = (v, f) => { if (!v) return true; const neg = v.startsWith('!'); const res = f(neg ? v.slice(1) : v); return neg ? !res : res }
  return n(r.src, (v) => matchAddr(v, p.src)) && n(r.dst, (v) => matchAddr(v, p.dst)) && n(r.proto, (v) => v === p.proto)
    && n(r.port, (v) => v.split(',').some((x) => Number(x) === p.port)) && n(r.inIf, (v) => v === p.inIf) && n(r.outIf, (v) => v === p.outIf)
    && n(r.state, (v) => v.split(',').includes(p.state)) && n(r.nat, (v) => v === (p.nat || ''))
}

function firewallSim(el) {
  let rules = FW_PRESETS.good.map((r) => ({ ...r }))
  let pk = 0
  el.innerHTML = `
  <div class="card">
    <div class="row wrap">Preset:
      <button class="btn ghost" data-p="good">Secure basic</button><button class="btn ghost" data-p="bad">Wrong order</button><button class="btn ghost" data-p="lab">Course filter lab</button>
    </div>
    <div class="table-wrap"><table class="fw"><thead><tr><th>#</th><th>chain</th><th>matchers</th><th>action</th><th>comment</th><th></th></tr></thead><tbody id="fw-body"></tbody></table></div>
    <details><summary>Add a rule</summary>
      <div class="row wrap fw-add">
        <select id="f-chain"><option>input</option><option>forward</option><option>output</option></select>
        <input id="f-src" placeholder="src-address"><input id="f-dst" placeholder="dst-address"><input id="f-proto" placeholder="protocol"><input id="f-port" placeholder="dst-port">
        <input id="f-in" placeholder="in-interface"><input id="f-out" placeholder="out-interface"><input id="f-state" placeholder="connection-state">
        <select id="f-act"><option>accept</option><option>drop</option><option>reject</option></select><button id="f-add" class="btn">Add at bottom</button>
      </div></details>
  </div>
  <div class="card">
    <label>Packet <select id="fw-pk">${PACKETS.map((p, i) => `<option value="${i}">${esc(p.label)}</option>`).join('')}</select></label>
    <div id="fw-pkt" class="pkt"></div>
    <div id="fw-res" class="result"></div>
  </div>`
  const desc = (r) => [r.src && `src=${r.src}`, r.dst && `dst=${r.dst}`, r.proto && `proto=${r.proto}`, r.port && `dst-port=${r.port}`, r.inIf && `in=${r.inIf}`, r.outIf && `out=${r.outIf}`, r.state && `state=${r.state}`, r.nat && `nat-state=${r.nat}`].filter(Boolean).join(' ') || '<span class="muted">(any)</span>'
  const draw = () => {
    const p = PACKETS[pk]
    let hit = -1
    rules.some((r, i) => { if (fwMatch(r, p)) { hit = i; return true } })
    $(el, '#fw-body').innerHTML = rules.map((r, i) => `<tr class="${i === hit ? (r.action === 'accept' ? 'win' : 'lose') : r.chain === p.chain && i < (hit < 0 ? 99 : hit) ? 'checked' : ''}">
      <td>${i}</td><td>${r.chain}</td><td class="mono">${desc(r)}</td><td><b>${r.action}</b></td><td class="muted">${esc(r.note || '')}</td>
      <td class="nowrap"><button class="link" data-up="${i}" title="Move up">▲</button><button class="link" data-down="${i}" title="Move down">▼</button><button class="link" data-del="${i}" title="Remove">✕</button></td></tr>`).join('')
    $(el, '#fw-pkt').innerHTML = `<span class="tag">${p.chain}</span> ${p.proto.toUpperCase()} ${p.src} → ${p.dst}${p.port ? ':' + p.port : ''} · in=${p.inIf || '-'} out=${p.outIf || '-'} · state=${p.state}${p.nat ? ' · ' + p.nat : ''}`
    const verdict = hit < 0 ? 'accept' : rules[hit].action
    $(el, '#fw-res').innerHTML = (hit < 0 ? `No rule in chain <b>${p.chain}</b> matched, so the default policy applies: ` : `Rule <b>#${hit}</b> matched first. Later rules are not checked. Verdict: `) + `<b class="${verdict === 'accept' ? 'good' : 'bad'}">${verdict.toUpperCase()}</b>`
  }
  el.addEventListener('click', (e) => {
    const d = e.target.dataset
    if (d.p) { rules = FW_PRESETS[d.p].map((r) => ({ ...r })); draw() }
    if (d.up && d.up > 0) { const i = Number(d.up); [rules[i - 1], rules[i]] = [rules[i], rules[i - 1]]; draw() }
    if (d.down !== undefined && Number(d.down) < rules.length - 1) { const i = Number(d.down); [rules[i + 1], rules[i]] = [rules[i], rules[i + 1]]; draw() }
    if (d.del) { rules.splice(Number(d.del), 1); draw() }
  })
  $(el, '#fw-pk').onchange = (e) => { pk = Number(e.target.value); draw() }
  $(el, '#f-add').onclick = () => {
    const v = (id) => $(el, id).value.trim()
    rules.push({ chain: v('#f-chain'), src: v('#f-src'), dst: v('#f-dst'), proto: v('#f-proto'), port: v('#f-port'), inIf: v('#f-in'), outIf: v('#f-out'), state: v('#f-state'), action: v('#f-act'), note: 'custom' })
    draw()
  }
  draw()
}

// ---------- burst ----------
// RouterOS burst: average rate over burst-time is computed every burst-time/16.
// While average < burst-threshold the queue allows burst-limit, otherwise max-limit.
export function simulateBurst({ maxLimit, burstLimit, threshold, burstTime, demand, seconds = 60, pauseAt = null, pauseLen = 0 }) {
  const step = burstTime / 16
  const n = Math.round(seconds / step)
  const win = 16
  const hist = []
  const out = []
  for (let k = 0; k < n; k++) {
    const t = k * step
    const want = pauseAt !== null && t >= pauseAt && t < pauseAt + pauseLen ? 0 : demand
    const avg = hist.length ? hist.slice(-win).reduce((a, b) => a + b, 0) / win : 0
    const allowed = burstLimit > maxLimit && avg < threshold ? burstLimit : maxLimit
    const rate = Math.min(want, allowed)
    hist.push(rate)
    out.push({ t, rate, avg, bursting: rate > maxLimit })
  }
  return out
}

function burstSim(el) {
  el.innerHTML = `
  <div class="card">
    <div class="row wrap">
      <label>max-limit <input id="b-max" value="2M" size="6"></label>
      <label>burst-limit <input id="b-bl" value="5M" size="6"></label>
      <label>burst-threshold <input id="b-th" value="1M" size="6"></label>
      <label>burst-time (s) <input id="b-bt" type="number" value="10" min="1" max="120" style="width:5em"></label>
      <label>client demand <input id="b-dem" value="10M" size="6"></label>
      <label><input id="b-pause" type="checkbox" checked> pause at 30 s for 15 s</label>
    </div>
    <svg id="b-svg" viewBox="0 0 640 260" class="chart" role="img" aria-label="Burst chart"></svg>
    <div id="b-info" class="result"></div>
  </div>`
  const draw = () => {
    const g = (id) => $(el, id).value
    const cfg = { maxLimit: parseRate(g('#b-max')), burstLimit: parseRate(g('#b-bl')), threshold: parseRate(g('#b-th')), burstTime: Number(g('#b-bt')) || 10, demand: parseRate(g('#b-dem')), seconds: 60, pauseAt: $(el, '#b-pause').checked ? 30 : null, pauseLen: 15 }
    if ([cfg.maxLimit, cfg.burstLimit, cfg.threshold, cfg.demand].some((x) => !Number.isFinite(x))) { $(el, '#b-info').innerHTML = '<span class="bad">Use values like 512k, 2M, 1G</span>'; return }
    const d = simulateBurst(cfg)
    const top = Math.max(cfg.burstLimit, cfg.maxLimit, cfg.demand > cfg.burstLimit ? cfg.burstLimit : cfg.demand) * 1.15 || 1
    const X = (t) => 40 + (t / 60) * 590, Y = (v) => 230 - (v / top) * 210
    const path = (k) => d.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p[k]).toFixed(1)}`).join(' ')
    const hl = (v, cls, label) => `<line x1="40" x2="630" y1="${Y(v)}" y2="${Y(v)}" class="${cls}"/><text x="44" y="${Y(v) - 4}" class="lbl">${label} ${fmtRate(v)}</text>`
    let ticks = ''
    for (let s = 0; s <= 60; s += 10) ticks += `<text x="${X(s)}" y="250" class="lbl" text-anchor="middle">${s}s</text>`
    $(el, '#b-svg').innerHTML = `<rect x="40" y="20" width="590" height="210" class="plot"/>${hl(cfg.burstLimit, 'l-bl', 'burst-limit')}${hl(cfg.maxLimit, 'l-max', 'max-limit')}${hl(cfg.threshold, 'l-th', 'burst-threshold')}
      <path d="${path('avg')}" class="avg"/><path d="${path('rate')}" class="rate"/>${ticks}`
    const firstEnd = d.findIndex((p, i) => i > 0 && !p.bursting && d[i - 1].bursting)
    const theory = cfg.burstLimit > 0 ? (cfg.threshold * cfg.burstTime / cfg.burstLimit) : 0
    $(el, '#b-info').innerHTML = `<span class="sw rate"></span> actual rate &nbsp; <span class="sw avg"></span> average over burst-time<br>
      First burst lasts about <b>${firstEnd > 0 ? d[firstEnd].t.toFixed(1) : '-'} s</b> (formula threshold × burst-time / burst-limit = ${theory.toFixed(1)} s). ${cfg.burstLimit <= cfg.maxLimit ? '<span class="bad">burst-limit must be higher than max-limit for burst to work.</span>' : ''}`
  }
  el.addEventListener('input', draw)
  draw()
}

// ---------- PCQ ----------
function pcqSim(el) {
  el.innerHTML = `
  <div class="card">
    <div class="row wrap">
      <label>max-limit <input id="p-max" value="512k" size="7"></label>
      <label>pcq-rate <input id="p-rate" value="128k" size="7"></label>
      <label>active users <input id="p-n" type="range" min="1" max="16" value="4"> <b id="p-nv">4</b></label>
    </div>
    <div id="p-bars" class="bars"></div>
    <div id="p-info" class="result"></div>
  </div>`
  const draw = () => {
    const max = parseRate($(el, '#p-max').value), rate = parseRate($(el, '#p-rate').value), n = Number($(el, '#p-n').value)
    $(el, '#p-nv').textContent = n
    if (!Number.isFinite(max) || !Number.isFinite(rate)) return
    const fair = max / n
    const each = rate > 0 ? Math.min(rate, fair) : fair
    const used = each * n
    $(el, '#p-bars').innerHTML = Array.from({ length: n }, (_, i) => `<div class="bar"><div style="height:${Math.max(3, (each / max) * 100)}%"></div><span>user${i + 1}</span><em>${fmtRate(each)}</em></div>`).join('')
    $(el, '#p-info').innerHTML = `Each user gets <b>${fmtRate(each)}bps</b>. Total used ${fmtRate(used)} of ${fmtRate(max)}.` +
      (rate > 0 && rate * n < max ? ` Users are capped by pcq-rate, <b>${fmtRate(max - used)}</b> stays unused.` : '') +
      (rate > 0 && rate * n > max ? ' max-limit is the bottleneck, so it is shared equally.' : '') + (rate === 0 ? ' pcq-rate=0: no per-user cap, bandwidth is shared equally.' : '')
  }
  el.addEventListener('input', draw)
  draw()
}

// ---------- 2.4 GHz channels ----------
function channelSim(el) {
  let aps = [{ name: 'AP-1', ch: 1 }, { name: 'AP-2', ch: 6 }, { name: 'AP-3', ch: 11 }]
  el.innerHTML = `
  <div class="card">
    <div id="c-ctl" class="row wrap"></div>
    <svg id="c-svg" viewBox="0 0 660 230" class="chart" role="img" aria-label="Channel overlap chart"></svg>
    <div id="c-info" class="result"></div>
    <p class="muted">Channel n centre = 2407 + 5·n MHz (ch 14 = 2484). Each 802.11b/g channel is ~22 MHz wide, so channels closer than 5 apart overlap.</p>
  </div>`
  const colors = ['#1f6feb', '#e5534b', '#2da44e', '#bf8700', '#8250df']
  const draw = () => {
    $(el, '#c-ctl').innerHTML = aps.map((a, i) => `<label>${a.name} <select data-i="${i}">${Array.from({ length: 13 }, (_, k) => `<option ${a.ch === k + 1 ? 'selected' : ''}>${k + 1}</option>`).join('')}</select></label>`).join('') +
      (aps.length < 5 ? '<button class="btn ghost" id="c-add">+ AP</button>' : '') + (aps.length > 1 ? '<button class="btn ghost" id="c-rm">- AP</button>' : '')
    const fx = (f) => 20 + ((f - 2395) / (2490 - 2395)) * 620
    let svg = `<line x1="20" x2="640" y1="190" y2="190" class="axis"/>`
    for (let c = 1; c <= 13; c++) { const f = 2407 + 5 * c; svg += `<line x1="${fx(f)}" x2="${fx(f)}" y1="190" y2="196" class="axis"/><text x="${fx(f)}" y="210" class="lbl" text-anchor="middle">${c}</text>` }
    svg += `<text x="640" y="225" class="lbl" text-anchor="end">channel (2412-2472 MHz)</text>`
    aps.forEach((a, i) => {
      const f = 2407 + 5 * a.ch
      const x1 = fx(f - 11), x2 = fx(f + 11), xm = fx(f)
      svg += `<path d="M${x1},190 Q${xm},${40 + i * 12} ${x2},190" fill="${colors[i]}" fill-opacity=".22" stroke="${colors[i]}" stroke-width="2"/><text x="${xm}" y="${32 + i * 12}" text-anchor="middle" class="lbl" fill="${colors[i]}">${a.name}</text>`
    })
    $(el, '#c-svg').innerHTML = svg
    const issues = []
    for (let i = 0; i < aps.length; i++) for (let j = i + 1; j < aps.length; j++) {
      const d = Math.abs(aps[i].ch - aps[j].ch)
      if (d === 0) issues.push(`${aps[i].name} and ${aps[j].name} share channel ${aps[i].ch} (co-channel: they take turns)`)
      else if (d < 5) issues.push(`${aps[i].name} (ch ${aps[i].ch}) and ${aps[j].name} (ch ${aps[j].ch}) overlap: adjacent-channel interference, the worst case`)
    }
    $(el, '#c-info').innerHTML = issues.length ? '<ul>' + issues.map((x) => `<li class="bad">${x}</li>`).join('') + '</ul>' : '<span class="good">No overlap. 1, 6 and 11 is the classic plan.</span>'
  }
  el.addEventListener('change', (e) => { if (e.target.dataset.i) { aps[e.target.dataset.i].ch = Number(e.target.value); draw() } })
  el.addEventListener('click', (e) => {
    if (e.target.id === 'c-add') { aps.push({ name: 'AP-' + (aps.length + 1), ch: 3 }); draw() }
    if (e.target.id === 'c-rm') { aps.pop(); draw() }
  })
  draw()
}

// ---------- product names ----------
const FEAT = { U: 'USB port', P: 'PoE-out with controller', i: 'single port PoE-out (no controller)', A: 'more memory (and higher licence)', H: 'more powerful CPU', G: 'Gigabit Ethernet', L: 'light edition', S: 'SFP port', e: 'PCIe extension', R: 'miniPCI/miniPCIe slot' }
const ENCL = { C: 'desktop case', IN: 'indoor case', OUT: 'outdoor case', RM: 'rackmount', TC: 'tower case', BU: 'board unit (no case)', EM: 'extended memory', LM: 'light memory', SA: 'sector antenna', HG: 'high-gain antenna', EC: 'special enclosure' }

const ENC_KEYS = ['OUT', 'IN', 'RM', 'TC', 'BU', 'EM', 'LM', 'SA', 'HG', 'EC', 'C']
function enclosure(x) {
  const tags = []
  let k = x
  let found = true
  while (found && k) {
    found = false
    for (const e of ENC_KEYS) if (k.toUpperCase().endsWith(e)) { tags.unshift(ENCL[e]); k = k.slice(0, -e.length); found = true; break }
  }
  return { tags, rest: k }
}

function portPart(part) {
  const p = part.match(/^(\d+)(G|S\+|S|Q\+|XS|P)(.*)$/i)
  if (!p) return null
  const kind = { G: 'Gigabit Ethernet ports', 'S+': 'SFP+ (10G) ports', S: 'SFP ports', 'Q+': 'QSFP+ (40G) ports', XS: 'SFP28 (25G) ports', P: 'PoE-out ports' }[p[2].toUpperCase()]
  const out = [[p[1] + p[2], `${p[1]} ${kind}`]]
  if (p[3]) { const e = enclosure(p[3]); out.push([p[3], e.tags.length ? 'enclosure: ' + e.tags.join(', ') : '?']) }
  return out
}

function wirelessPart(part) {
  const bands = { 2: '2.4 GHz', 5: '5 GHz', 52: '2.4 + 5 GHz' }
  const re = /(52|5|2)(SHP|HP|H)?(n|ac|ax)?/g
  const radios = []
  let m, last = 0
  while ((m = re.exec(part)) && m.index === last && m[0]) {
    radios.push(`${bands[m[1]]}${m[3] ? ' 802.11' + m[3] : ''}${m[2] ? ' (' + { H: 'high', HP: 'high power', SHP: 'super high power' }[m[2]] + ')' : ''}`)
    last = re.lastIndex
  }
  if (!radios.length) return null
  let rest = part.slice(last)
  let chain = ''
  if (/^[SDTQ]/.test(rest)) { chain = { S: 'single', D: 'dual', T: 'triple', Q: 'quad' }[rest[0]] + ' chain'; rest = rest.slice(1) }
  const out = [[part.slice(0, part.length - rest.length), 'built-in wireless: ' + radios.join(' + ') + (chain ? ', ' + chain : '')]]
  if (rest) { const e = enclosure(rest); out.push([rest, e.tags.length ? 'enclosure: ' + e.tags.join(', ') : '?']) }
  return out
}

export function decodeName(name) {
  const res = []
  const s = name.trim()
  let m
  if ((m = s.match(/^(CCR|CRS|CSS)(\d)(\d{2,3})-?(.*)$/i))) {
    const fam = m[1].toUpperCase()
    res.push([fam, { CCR: 'Cloud Core Router', CRS: 'Cloud Router Switch', CSS: 'Cloud Smart Switch' }[fam]])
    res.push([m[2], 'series ' + m[2]])
    res.push([m[3], fam === 'CCR' ? `${Number(m[3])} CPU cores` : `${Number(m[3])} ports in total`])
    for (const part of m[4].split('-').filter(Boolean)) {
      const pp = portPart(part)
      if (pp) { res.push(...pp); continue }
      const e = enclosure(part)
      res.push([part, e.tags.length ? 'enclosure: ' + e.tags.join(', ') : 'variant'])
    }
    return res
  }
  if ((m = s.match(/^RB(\d+)([A-Za-z0-9+]*)?(?:-(.*))?$/i))) {
    const num = m[1]
    res.push(['RB', 'RouterBOARD'])
    if (num.length === 3) res.push([num, `series ${num[0]}, ${num[1]} Ethernet port(s), ${num[2]} wireless interface(s)`])
    else if (num.length === 4) {
      if (['1100', '1000'].includes(num)) res.push([num, 'RB1100/RB1000 family (exception to the rules)'])
      else res.push([num, `series ${num[0]}, ${Number(num.slice(1))} ports (4-digit name: generation + port count)`])
    } else res.push([num, 'model ' + num])
    let feats = m[2] || ''
    const enc = enclosure(feats.replace(/x\d+$/, ''))
    const encTags = feats.match(/x\d+$/) ? [] : enc.tags
    if (encTags.length && /^(RM|IN|OUT|TC)$/i.test(feats.slice(enc.rest.length))) feats = enc.rest
    else encTags.length = 0
    const x = feats.match(/x(\d+)/)
    if (x) feats = feats.replace(x[0], '')
    for (let k = 0; k < feats.length; k++) {
      const ch = feats[k]
      if (ch === 'S' && feats[k + 1] === '+') { res.push(['S+', 'SFP+ (10G) port']); k++; continue }
      if (FEAT[ch]) res.push([ch, FEAT[ch]])
      else if (ch === 'r' || /\d/.test(ch)) res.push([ch, 'hardware revision'])
      else res.push([ch, '?'])
    }
    if (x) res.push([x[0], `${x[1]} CPU cores`])
    if (encTags.length) res.push([m[2].slice(enc.rest.length), 'enclosure: ' + encTags.join(', ')])
    for (const part of (m[3] || '').split('-').filter(Boolean)) {
      const w = /^(52|5|2)/.test(part) ? wirelessPart(part) : null
      if (w) { res.push(...w); continue }
      const e = enclosure(part)
      res.push([part, e.tags.length ? 'enclosure: ' + e.tags.join(', ') : '?'])
    }
    return res
  }
  return [['?', 'Not a RouterBOARD/CCR/CRS name. Try RB952Ui-5ac2nD-TC, RB493, RB4011iGS+RM, CCR1036-8G-2S+EM, CRS326-24G-2S+RM']]
}

function namingSim(el) {
  const ex = ['RB952Ui-5ac2nD-TC', 'RB493', 'RB951G-2HnD', 'RB4011iGS+RM', 'RB1100AHx4', 'CCR1036-8G-2S+EM', 'CRS326-24G-2S+RM', 'RB2011UiAS-2HnD-IN']
  el.innerHTML = `
  <div class="card">
    <label>Model name <input id="n-in" value="RB952Ui-5ac2nD-TC" spellcheck="false"></label>
    <div class="row wrap">${ex.map((e) => `<button class="chip" data-e="${e}">${e}</button>`).join('')}</div>
    <div class="table-wrap"><table><thead><tr><th>Part</th><th>Meaning</th></tr></thead><tbody id="n-out"></tbody></table></div>
    <p class="muted">Based on the MikroTik product naming rules (wiki Manual:Product_Naming). Always confirm details on the product page.</p>
  </div>`
  const draw = () => { $(el, '#n-out').innerHTML = decodeName($(el, '#n-in').value).map(([a, b]) => `<tr><td class="mono"><b>${esc(a)}</b></td><td>${esc(b)}</td></tr>`).join('') }
  $(el, '#n-in').addEventListener('input', draw)
  el.addEventListener('click', (e) => { if (e.target.dataset.e) { $(el, '#n-in').value = e.target.dataset.e; draw() } })
  draw()
}
