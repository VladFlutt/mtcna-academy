// MTCRE simulators: route selection, recursive next hops, policy routing walk, tunnel MTU,
// OSPF SPF (Dijkstra) stepper, DR/BDR election and OSPF area types. Each renders into an element.

import { T } from '../i18n.js'
import { ipToInt, parseCidr, inSubnet } from '../net.js'

const $ = (root, sel) => root.querySelector(sel)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export const RE_SIMS = [
  { id: 'route-select', icon: '🧭', title: T('Route selection', 'Выбор маршрута'), desc: T('Edit a routing table, pick a destination and watch RouterOS choose: longest prefix, then distance, then ECMP.', 'Измените таблицу маршрутизации, выберите адрес назначения и посмотрите, как выбирает RouterOS: самый длинный префикс, затем distance, затем ECMP.'), render: selectSim },
  { id: 'recursive', icon: '🔁', title: T('Recursive next hop', 'Рекурсивный следующий хоп'), desc: T('See how a gateway that is not directly connected is resolved through other routes, and what scope and target-scope allow.', 'Посмотрите, как шлюз, который не подключён напрямую, разрешается через другие маршруты, и что разрешают scope и target-scope.'), render: recursiveSim },
  { id: 'pbr-walk', icon: '🔀', title: T('Policy routing walk', 'Путь через политики маршрутизации'), desc: T('Send a packet through mangle, routing rules and routing tables and see which gateway it leaves through.', 'Отправьте пакет через mangle, правила маршрутизации и таблицы и посмотрите, через какой шлюз он уйдёт.'), render: pbrSim },
  { id: 'tunnel-mtu', icon: '📦', title: T('Tunnel overhead and MTU', 'Накладные расходы туннелей и MTU'), desc: T('Stack VLAN, PPPoE, GRE, IPIP, EoIP, WireGuard and IPsec headers and get the MTU and TCP MSS that fit.', 'Сложите заголовки VLAN, PPPoE, GRE, IPIP, EoIP, WireGuard и IPsec и получите подходящие MTU и TCP MSS.'), render: mtuSim },
  { id: 'spf', icon: '🌳', title: T('OSPF SPF stepper', 'Пошаговый SPF в OSPF'), desc: T('Run Dijkstra step by step on a small OSPF area, change link costs and watch the shortest-path tree change.', 'Выполните алгоритм Дейкстры по шагам на небольшой области OSPF, меняйте стоимости каналов и смотрите, как меняется дерево кратчайших путей.'), render: spfSim },
  { id: 'dr-election', icon: '🗳️', title: T('DR/BDR election', 'Выборы DR/BDR'), desc: T('Bring routers up on a broadcast segment in any order, change priorities, fail the DR and count the adjacencies.', 'Включайте маршрутизаторы в сегменте broadcast в любом порядке, меняйте приоритеты, роняйте DR и считайте соседства.'), render: drSim },
  { id: 'area-types', icon: '🗺️', title: T('OSPF area types and LSAs', 'Типы областей OSPF и LSA'), desc: T('Pick an area type and see which LSA types may enter it and where the default route comes from.', 'Выберите тип области и посмотрите, какие типы LSA в неё допускаются и откуда берётся маршрут по умолчанию.'), render: areaSim },
]

// ---------- route selection ----------
const SEL_ROUTES = [
  ['0.0.0.0/0', '172.16.1.1', 1, 's'], ['0.0.0.0/0', '172.16.2.1', 2, 's'], ['10.0.0.0/8', '10.0.12.2', 1, 's'],
  ['10.1.0.0/16', '10.0.13.2', 110, 'o'], ['10.1.0.0/16', '10.0.12.2', 1, 's'], ['10.1.1.0/24', '10.0.13.2,10.0.12.2', 1, 's'],
  ['192.168.1.0/24', 'ether5', 0, 'c'],
]
function selectSim(el) {
  let rows = SEL_ROUTES.map(([dst, gw, dist, proto]) => ({ dst, gw, dist, proto, on: true }))
  el.innerHTML = `<div class="sim-grid"><div class="card"><h3>${T('Routing table', 'Таблица маршрутизации')}</h3><div id="rs-rows"></div>
    <button class="btn ghost sm" id="rs-add">+ ${T('route', 'маршрут')}</button></div>
    <div class="card"><h3>${T('Packet to', 'Пакет к')}</h3><div class="row wrap"><input id="rs-dst" value="10.1.1.20" size="16" aria-label="${T('Destination address', 'Адрес назначения')}">
    ${['10.1.1.20', '10.1.9.9', '10.200.0.1', '8.8.8.8', '192.168.1.7'].map((x) => `<button class="chip mono" data-ip="${x}">${x}</button>`).join('')}</div><ol id="rs-steps" class="steps"></ol></div></div>`
  const drawRows = () => {
    $(el, '#rs-rows').innerHTML = `<div class="table-wrap"><table><thead><tr><th></th><th>dst-address</th><th>gateway</th><th>distance</th><th>${T('type', 'тип')}</th><th></th></tr></thead><tbody>${rows.map((r, i) => `<tr>
      <td><input type="checkbox" data-i="${i}" data-k="on" ${r.on ? 'checked' : ''} aria-label="${T('active', 'активен')}"></td>
      <td><input class="mono" size="15" data-i="${i}" data-k="dst" value="${esc(r.dst)}"></td><td><input class="mono" size="18" data-i="${i}" data-k="gw" value="${esc(r.gw)}"></td>
      <td><input size="3" data-i="${i}" data-k="dist" value="${r.dist}"></td><td><select data-i="${i}" data-k="proto">${[['c', 'connected'], ['s', 'static'], ['o', 'ospf']].map(([v, t]) => `<option value="${v}" ${r.proto === v ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
      <td><button class="link" data-del="${i}" aria-label="${T('delete', 'удалить')}">✕</button></td></tr>`).join('')}</tbody></table></div>`
  }
  const run = () => {
    const ip = $(el, '#rs-dst').value.trim()
    const steps = []
    if (ipToInt(ip) === null) { $(el, '#rs-steps').innerHTML = `<li class="bad">${T('Enter an IPv4 address', 'Введите адрес IPv4')}</li>`; return }
    const valid = rows.map((r, i) => ({ ...r, i, c: parseCidr(r.dst) })).filter((r) => r.c)
    const act = valid.filter((r) => r.on)
    steps.push(`${T('Inactive routes are ignored', 'Неактивные маршруты не участвуют')}: ${valid.length - act.length ? valid.filter((r) => !r.on).map((r) => r.dst).join(', ') : T('none', 'нет')}.`)
    const match = act.filter((r) => inSubnet(ip, r.c))
    if (!match.length) { steps.push(`<b class="bad">${T('No route contains', 'Ни один маршрут не содержит')} ${esc(ip)}: ${T('the packet is dropped and the sender gets ICMP "network unreachable".', 'пакет отбрасывается, отправитель получает ICMP «network unreachable».')}</b>`); return show(steps) }
    steps.push(`${T('Routes whose prefix contains', 'Маршруты, префикс которых содержит')} ${esc(ip)}: <span class="mono">${match.map((r) => r.dst).join(', ')}</span>`)
    const best = Math.max(...match.map((r) => r.c.prefix))
    const lp = match.filter((r) => r.c.prefix === best)
    steps.push(`${T('Longest prefix', 'Самый длинный префикс')}: <b>/${best}</b>. ${T('A more specific route always wins, whatever its distance.', 'Более специфичный маршрут всегда выигрывает, какой бы ни был distance.')}`)
    const md = Math.min(...lp.map((r) => Number(r.dist)))
    const win = lp.filter((r) => Number(r.dist) === md)
    if (lp.length > 1) steps.push(`${T('Among them the lowest distance', 'Среди них наименьший distance')}: <b>${md}</b>${lp.length > win.length ? ` (${T('loses', 'проигрывает')}: ${lp.filter((r) => Number(r.dist) !== md).map((r) => `${r.gw} d=${r.dist}`).join(', ')})` : ''}.`)
    const gws = win.flatMap((r) => r.gw.split(',').map((g) => g.trim()).filter(Boolean))
    if (gws.length > 1) steps.push(`<b class="good">ECMP</b>: ${T('equal routes, traffic is spread per connection over', 'равнозначные маршруты, трафик распределяется по соединениям между')} <span class="mono">${gws.join(', ')}</span>.`)
    else steps.push(`<b class="good">${T('Selected', 'Выбран')}</b>: <span class="mono">${win[0].dst} → ${esc(gws[0])}</span> (${{ c: 'connected', s: 'static', o: 'ospf' }[win[0].proto]}, distance ${win[0].dist}).`)
    show(steps)
  }
  const show = (steps) => { $(el, '#rs-steps').innerHTML = steps.map((s) => `<li>${s}</li>`).join('') }
  el.addEventListener('input', (e) => {
    const d = e.target.dataset
    if (d.i !== undefined) { const r = rows[Number(d.i)]; r[d.k] = d.k === 'on' ? e.target.checked : e.target.value }
    run()
  })
  el.addEventListener('click', (e) => {
    const d = e.target.dataset
    if (d.ip) { $(el, '#rs-dst').value = d.ip; run() }
    if (d.del !== undefined) { rows.splice(Number(d.del), 1); drawRows(); run() }
    if (e.target.id === 'rs-add') { rows.push({ dst: '10.1.1.0/25', gw: '10.0.14.2', dist: 1, proto: 's', on: true }); drawRows(); run() }
  })
  drawRows(); run()
}

// ---------- recursive next hop ----------
function recursiveSim(el) {
  const st = { scope8: 10, target: 11, cg: true, isp1Up: true, isp1Inet: true }
  el.innerHTML = `<div class="sim-grid"><div class="card"><h3>${T('Configuration on R1', 'Конфигурация R1')}</h3><div id="rc-code"></div>
    <label class="row">scope ${T('of the route to 8.8.8.8', 'маршрута к 8.8.8.8')} <input type="range" min="10" max="40" step="10" id="rc-scope" value="10"> <b id="rc-scope-v"></b></label>
    <label class="row">target-scope ${T('of the default route', 'маршрута по умолчанию')} <input type="range" min="10" max="31" id="rc-target" value="11"> <b id="rc-target-v"></b></label>
    <label class="row"><input type="checkbox" id="rc-cg" checked> check-gateway=ping</label></div>
    <div class="card"><h3>${T('What happens', 'Что происходит')}</h3><div class="row wrap"><label><input type="checkbox" id="rc-isp1" checked> ${T('ISP1 router answers', 'маршрутизатор ISP1 отвечает')}</label><label><input type="checkbox" id="rc-inet" checked> ${T('Internet behind ISP1 works (8.8.8.8 answers)', 'Интернет за ISP1 работает (8.8.8.8 отвечает)')}</label></div>
    <ol id="rc-steps" class="steps"></ol></div></div>`
  const draw = () => {
    st.scope8 = Number($(el, '#rc-scope').value); st.target = Number($(el, '#rc-target').value); st.cg = $(el, '#rc-cg').checked
    st.isp1Up = $(el, '#rc-isp1').checked; st.isp1Inet = $(el, '#rc-inet').checked && st.isp1Up
    $(el, '#rc-scope-v').textContent = st.scope8; $(el, '#rc-target-v').textContent = st.target
    $(el, '#rc-code').innerHTML = `<pre class="code sm"><code>/ip route
add dst-address=8.8.8.8/32 gateway=172.16.1.1 scope=${st.scope8}
add dst-address=1.1.1.1/32 gateway=172.16.2.1 scope=10
add gateway=8.8.8.8 target-scope=${st.target}${st.cg ? ' check-gateway=ping' : ''}
add gateway=1.1.1.1 target-scope=11 distance=2${st.cg ? ' check-gateway=ping' : ''}</code></pre>`
    const s = []
    s.push(T('172.16.1.1 is in the connected network 172.16.1.0/30 (connected routes have scope 10), so the /32 route to 8.8.8.8 is active as long as the cable to ISP1 is up.', '172.16.1.1 находится в подключённой сети 172.16.1.0/30 (у connected-маршрутов scope 10), поэтому маршрут /32 к 8.8.8.8 активен, пока кабель к ISP1 подключён.'))
    const resolves = st.scope8 <= st.target
    s.push(resolves ? `<span class="good">${T(`Gateway 8.8.8.8 is not connected, so RouterOS looks for a route to it whose scope (${st.scope8}) is ≤ the target-scope (${st.target}) of the default route: found 8.8.8.8/32, the gateway resolves recursively to 172.16.1.1.`, `Шлюз 8.8.8.8 не подключён напрямую, поэтому RouterOS ищет маршрут к нему, у которого scope (${st.scope8}) ≤ target-scope (${st.target}) маршрута по умолчанию: найден 8.8.8.8/32, шлюз рекурсивно разрешается в 172.16.1.1.`)}</span>`
      : `<span class="bad">${T(`The route to 8.8.8.8 has scope ${st.scope8}, higher than target-scope ${st.target}: it may not be used to resolve the gateway. The default route through 8.8.8.8 stays unreachable (inactive). Raise target-scope or lower scope.`, `У маршрута к 8.8.8.8 scope ${st.scope8}, больше target-scope ${st.target}: его нельзя использовать для разрешения шлюза. Маршрут по умолчанию через 8.8.8.8 остаётся недостижимым (неактивным). Увеличьте target-scope или уменьшите scope.`)}</span>`)
    let primary = resolves && st.isp1Up
    if (resolves && !st.isp1Up) s.push(`<span class="bad">${T('The cable to ISP1 is down: 172.16.1.0/30 disappears, 8.8.8.8/32 becomes inactive and so does the default route through it.', 'Кабель к ISP1 отключён: 172.16.1.0/30 исчезает, 8.8.8.8/32 становится неактивным, а с ним и маршрут по умолчанию через него.')}</span>`)
    if (primary && !st.isp1Inet) {
      if (st.cg) { primary = false; s.push(`<span class="good">${T('check-gateway pings 8.8.8.8 (through ISP1, because of the /32 route) every 10 s. It stops answering, so the route is marked unreachable.', 'check-gateway пингует 8.8.8.8 (через ISP1 благодаря маршруту /32) каждые 10 с. Он перестал отвечать, и маршрут помечается недостижимым.')}</span>`) }
      else s.push(`<span class="bad">${T('Without check-gateway nothing notices that the Internet behind ISP1 is gone: the route stays active and traffic is lost.', 'Без check-gateway никто не замечает, что Интернета за ISP1 нет: маршрут остаётся активным, трафик теряется.')}</span>`)
    }
    s.push(primary ? `<b class="${st.isp1Inet ? 'good' : 'bad'}">${T('Active default route: through 8.8.8.8 → 172.16.1.1 (ISP1).', 'Активный маршрут по умолчанию: через 8.8.8.8 → 172.16.1.1 (ISP1).')}</b>` : `<b class="good">${T('Active default route: the distance=2 route through 1.1.1.1 → 172.16.2.1 (ISP2).', 'Активный маршрут по умолчанию: маршрут с distance=2 через 1.1.1.1 → 172.16.2.1 (ISP2).')}</b>`)
    s.push(T('Note: traffic to 8.8.8.8 itself always goes through ISP1 because of the /32 route. Pick monitoring hosts that users do not depend on.', 'Обратите внимание: трафик к самому 8.8.8.8 всегда идёт через ISP1 из-за маршрута /32. Выбирайте для мониторинга хосты, от которых не зависят пользователи.'))
    $(el, '#rc-steps').innerHTML = s.map((x) => `<li>${x}</li>`).join('')
  }
  el.addEventListener('input', draw)
  draw()
}

// ---------- policy routing walk ----------
function pbrSim(el) {
  const rules = [
    { src: '192.168.1.20/32', dst: '', action: 'lookup', table: 'isp2' },
    { src: '', dst: '10.0.0.0/8', action: 'lookup-only-in-table', table: 'main' },
    { src: '172.16.2.2/32', dst: '', action: 'lookup', table: 'isp2' },
  ]
  el.innerHTML = `<div class="sim-grid"><div class="card"><h3>/routing rule</h3><div id="pb-rules"></div>
    <h3>${T('Routing tables', 'Таблицы маршрутизации')}</h3><label class="row"><input type="checkbox" id="pb-isp2" checked> ${T('isp2: 0.0.0.0/0 via 172.16.2.1 is active (cable to ISP2 up)', 'isp2: 0.0.0.0/0 через 172.16.2.1 активен (кабель к ISP2 подключён)')}</label>
    <label class="row"><input type="checkbox" id="pb-mangle"> ${T('mangle: mark-routing=isp2 for dst-port=443 from the LAN', 'mangle: mark-routing=isp2 для dst-port=443 из LAN')}</label>
    <p class="muted sm">main: 0.0.0.0/0 → 172.16.1.1 (ISP1), 10.0.0.0/8 → 10.0.12.2, 192.168.1.0/24 ether5</p></div>
    <div class="card"><h3>${T('Packet', 'Пакет')}</h3><div class="row wrap"><label>src <input id="pb-src" class="mono" value="192.168.1.20" size="14"></label><label>dst <input id="pb-dst" class="mono" value="93.184.216.34" size="14"></label><label>dst-port <input id="pb-port" value="80" size="5"></label></div>
    <ol id="pb-steps" class="steps"></ol></div></div>`
  const drawRules = () => {
    $(el, '#pb-rules').innerHTML = `<div class="table-wrap"><table><thead><tr><th>#</th><th>src-address</th><th>dst-address</th><th>action</th><th>table</th></tr></thead><tbody>${rules.map((r, i) => `<tr><td>${i}</td>
      <td><input class="mono" size="14" data-i="${i}" data-k="src" value="${esc(r.src)}"></td><td><input class="mono" size="12" data-i="${i}" data-k="dst" value="${esc(r.dst)}"></td>
      <td><select data-i="${i}" data-k="action">${['lookup', 'lookup-only-in-table', 'drop', 'unreachable'].map((a) => `<option ${a === r.action ? 'selected' : ''}>${a}</option>`).join('')}</select></td>
      <td><select data-i="${i}" data-k="table">${['main', 'isp2'].map((a) => `<option ${a === r.table ? 'selected' : ''}>${a}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>`
  }
  const tables = (isp2) => ({ main: [['10.0.0.0/8', '10.0.12.2'], ['192.168.1.0/24', 'ether5 (connected)'], ['0.0.0.0/0', '172.16.1.1 (ISP1)']], isp2: isp2 ? [['0.0.0.0/0', '172.16.2.1 (ISP2)']] : [] })
  const look = (tb, dst) => { const m = tb.map(([p, g]) => ({ c: parseCidr(p), p, g })).filter((x) => inSubnet(dst, x.c)).sort((a, b) => b.c.prefix - a.c.prefix); return m[0] }
  const run = () => {
    const src = $(el, '#pb-src').value.trim(), dst = $(el, '#pb-dst').value.trim(), port = Number($(el, '#pb-port').value)
    if (ipToInt(src) === null || ipToInt(dst) === null) { $(el, '#pb-steps').innerHTML = `<li class="bad">${T('Enter IPv4 addresses', 'Введите адреса IPv4')}</li>`; return }
    const tb = tables($(el, '#pb-isp2').checked)
    const s = []
    let mark = null
    if ($(el, '#pb-mangle').checked && port === 443 && inSubnet(src, parseCidr('192.168.1.0/24'))) { mark = 'isp2'; s.push(T('mangle prerouting matches (dst-port 443 from the LAN): routing mark isp2.', 'mangle prerouting совпадает (dst-port 443 из LAN): метка маршрутизации isp2.')) }
    else s.push(T('mangle: no routing mark.', 'mangle: метки маршрутизации нет.'))
    const finish = (table, only) => {
      const r = look(tb[table], dst)
      if (r) { s.push(`<b class="good">${T('Table', 'Таблица')} ${table}: ${r.p} → ${esc(r.g)}</b>`); return true }
      if (only) { s.push(`<b class="bad">${T('Table', 'Таблица')} ${table} ${T('has no route and the action is lookup-only-in-table: the packet is dropped (unreachable).', 'не содержит маршрута, а действие lookup-only-in-table: пакет отбрасывается (unreachable).')}</b>`); return true }
      s.push(`${T('Table', 'Таблица')} ${table} ${T('has no route; action lookup continues with the main table.', 'не содержит маршрута; действие lookup продолжает поиск в таблице main.')}`)
      return false
    }
    if (mark) { if (!finish(mark, false)) finish('main', true); return show(s) }
    for (const [i, r] of rules.entries()) {
      const okSrc = !r.src || (parseCidr(r.src) && inSubnet(src, parseCidr(r.src)))
      const okDst = !r.dst || (parseCidr(r.dst) && inSubnet(dst, parseCidr(r.dst)))
      if (!okSrc || !okDst) { s.push(`<span class="muted">${T('rule', 'правило')} ${i}: ${T('does not match', 'не совпадает')}</span>`); continue }
      s.push(`${T('rule', 'правило')} ${i} ${T('matches', 'совпадает')}: action=${r.action}${r.action.startsWith('lookup') ? ' table=' + r.table : ''}`)
      if (r.action === 'drop') { s.push(`<b class="bad">${T('dropped silently', 'тихо отброшен')}</b>`); return show(s) }
      if (r.action === 'unreachable') { s.push(`<b class="bad">${T('dropped, the sender gets ICMP unreachable', 'отброшен, отправитель получает ICMP unreachable')}</b>`); return show(s) }
      if (finish(r.table, r.action === 'lookup-only-in-table')) return show(s)
      if (r.table === 'main') return show(s)
      finish('main', true); return show(s)
    }
    s.push(T('No rule matched: the main table is used.', 'Ни одно правило не совпало: используется таблица main.'))
    finish('main', true)
    show(s)
  }
  const show = (s) => { $(el, '#pb-steps').innerHTML = s.map((x) => `<li>${x}</li>`).join('') }
  el.addEventListener('input', (e) => { const d = e.target.dataset; if (d.i !== undefined) rules[Number(d.i)][d.k] = e.target.value; run() })
  drawRules(); run()
}

// ---------- tunnel MTU ----------
const LAYERS = [
  ['pppoe', 'PPPoE', 8, T('PPPoE session + PPP header on the WAN', 'сессия PPPoE + заголовок PPP на WAN')],
  ['ipsec', 'IPsec ESP', 58, T('tunnel mode, AES-CBC + SHA1, about 50-73 bytes with padding', 'режим tunnel, AES-CBC + SHA1, около 50-73 байт с выравниванием')],
  ['wg', 'WireGuard', 60, T('outer IPv4 20 + UDP 8 + WireGuard 32 (80 with IPv6 outer)', 'внешний IPv4 20 + UDP 8 + WireGuard 32 (80 с внешним IPv6)')],
  ['gre', 'GRE', 24, T('outer IP 20 + GRE 4', 'внешний IP 20 + GRE 4')],
  ['ipip', 'IPIP', 20, T('outer IP 20', 'внешний IP 20')],
  ['eoip', 'EoIP', 42, T('outer IP 20 + GRE 8 + inner Ethernet 14', 'внешний IP 20 + GRE 8 + внутренний Ethernet 14')],
]
function mtuSim(el) {
  const on = new Set(['gre'])
  el.innerHTML = `<div class="sim-grid"><div class="card"><h3>${T('Underlay', 'Нижний уровень')}</h3><label class="row">${T('Physical MTU', 'Физический MTU')} <input id="mt-base" value="1500" size="5"></label>
    <h3>${T('Encapsulations, outside → inside', 'Инкапсуляции снаружи внутрь')}</h3><div id="mt-layers"></div>
    <p class="muted sm">${T('A VLAN tag (4 bytes) uses the L2 MTU, not the IP MTU, so it does not reduce the IP MTU on RouterBOARDs whose L2 MTU is larger than 1500.', 'Тег VLAN (4 байта) расходует L2 MTU, а не IP MTU, поэтому не уменьшает IP MTU на RouterBOARD, у которых L2 MTU больше 1500.')}</p></div>
    <div class="card"><h3>${T('Result', 'Результат')}</h3><div id="mt-bar" class="mtu-bar"></div><div id="mt-out"></div></div></div>`
  const draw = () => {
    $(el, '#mt-layers').innerHTML = LAYERS.map(([id, name, b, d]) => `<label class="row"><input type="checkbox" data-l="${id}" ${on.has(id) ? 'checked' : ''}> <b>${name}</b> <span class="mono">${b} B</span> <span class="muted sm">${d}</span></label>`).join('')
    calc()
  }
  const calc = () => {
    const base = Math.max(576, Math.min(9000, Number($(el, '#mt-base').value) || 1500))
    const used = LAYERS.filter(([id]) => on.has(id))
    const over = used.reduce((a, l) => a + l[2], 0)
    const mtu = base - over
    const mss = mtu - 40
    $(el, '#mt-bar').innerHTML = used.map(([, n, b]) => `<span style="flex:${b}" class="hdr" title="${n} ${b} B">${n}</span>`).join('') + `<span style="flex:${Math.max(1, mtu)}" class="pay">${T('inner IP packet', 'внутренний IP-пакет')} ${mtu} B</span>`
    $(el, '#mt-out').innerHTML = `<div class="kv"><div><span>${T('overhead', 'накладные')}</span><b>${over} B</b></div><div><span>${T('inner MTU', 'внутренний MTU')}</span><b>${mtu}</b></div><div><span>TCP MSS</span><b>${mss}</b></div></div>
      <p class="sm">${T('Packets bigger than this are fragmented (or dropped when DF is set, which breaks web pages and large downloads). Clamp the TCP MSS on the tunnel:', 'Пакеты больше этого фрагментируются (или отбрасываются при установленном DF, что ломает веб-страницы и большие загрузки). Ограничьте TCP MSS на туннеле:')}</p>
      <pre class="code sm"><code>/ip firewall mangle add chain=forward protocol=tcp tcp-flags=syn \\
  out-interface=&lt;tunnel&gt; action=change-mss new-mss=clamp-to-pmtu passthrough=yes</code></pre>
      <p class="muted sm">${T('RouterOS default tunnel MTUs: GRE 1476, IPIP 1480, EoIP 1458 (actual MTU), WireGuard 1420.', 'MTU туннелей по умолчанию в RouterOS: GRE 1476, IPIP 1480, EoIP 1458 (actual MTU), WireGuard 1420.')}</p>`
  }
  el.addEventListener('change', (e) => { const l = e.target.dataset.l; if (l) { e.target.checked ? on.add(l) : on.delete(l); calc() } })
  el.addEventListener('input', (e) => { if (e.target.id === 'mt-base') calc() })
  draw()
}

// ---------- SPF (Dijkstra) ----------
const SPF_NODES = { R1: [70, 60], R2: [250, 40], R3: [430, 60], R4: [90, 200], R5: [270, 190], R6: [450, 210] }
const SPF_EDGES = [['R1', 'R2', 10], ['R2', 'R3', 10], ['R1', 'R4', 5], ['R4', 'R5', 5], ['R2', 'R5', 1], ['R5', 'R6', 20], ['R3', 'R6', 1], ['R5', 'R3', 15]]
function spfSim(el) {
  const edges = SPF_EDGES.map(([a, b, c]) => ({ a, b, c }))
  let root = 'R1', step = 0
  el.innerHTML = `<div class="sim-grid"><div class="card"><h3>${T('Area 0', 'Область 0')}</h3><div id="sp-svg"></div>
    <p class="muted sm">${T('Click a cost to change it. Costs are the same in both directions here; in real OSPF each router sets the cost of its own outgoing interface.', 'Нажмите на стоимость, чтобы изменить её. Здесь стоимость одинакова в обе стороны; в настоящем OSPF каждый маршрутизатор задаёт стоимость своего исходящего интерфейса.')}</p></div>
    <div class="card"><div class="row wrap"><label>${T('Root', 'Корень')} <select id="sp-root">${Object.keys(SPF_NODES).map((n) => `<option>${n}</option>`).join('')}</select></label>
    <button class="btn sm" id="sp-step">${T('Next step', 'Следующий шаг')}</button><button class="btn ghost sm" id="sp-all">${T('Run to the end', 'До конца')}</button><button class="btn ghost sm" id="sp-reset">${T('Reset', 'Сброс')}</button></div>
    <div id="sp-table"></div><p id="sp-msg" class="sm"></p></div></div>`
  const dijkstra = () => {
    const dist = { [root]: 0 }, prev = {}, done = [], log = []
    const nb = (n) => edges.filter((e) => e.a === n || e.b === n).map((e) => ({ n: e.a === n ? e.b : e.a, c: Number(e.c) }))
    while (done.length < Object.keys(SPF_NODES).length) {
      const cand = Object.keys(dist).filter((n) => !done.includes(n)).sort((x, y) => dist[x] - dist[y] || x.localeCompare(y))
      if (!cand.length) break
      const u = cand[0]
      done.push(u)
      const upd = []
      for (const { n, c } of nb(u)) if (!done.includes(n) && (dist[n] === undefined || dist[u] + c < dist[n])) { dist[n] = dist[u] + c; prev[n] = [u]; upd.push(n) } else if (!done.includes(n) && dist[u] + c === dist[n]) { prev[n].push(u) }
      log.push({ u, d: dist[u], upd, snap: { dist: { ...dist }, prev: JSON.parse(JSON.stringify(prev)), done: [...done] } })
    }
    return log
  }
  const draw = () => {
    const log = dijkstra()
    const cur = step ? log[step - 1].snap : { dist: { [root]: 0 }, prev: {}, done: [] }
    const tree = new Set()
    for (const n of cur.done) for (const p of cur.prev[n] || []) tree.add([p, n].sort().join('-'))
    $(el, '#sp-svg').innerHTML = `<svg viewBox="0 0 520 250" class="topo-svg">${edges.map((e, i) => { const [x1, y1] = SPF_NODES[e.a], [x2, y2] = SPF_NODES[e.b]; const on = tree.has([e.a, e.b].sort().join('-')); return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="w ${on ? 'spt' : ''}"/><g class="cost" data-e="${i}" tabindex="0" role="button"><circle cx="${(x1 + x2) / 2}" cy="${(y1 + y2) / 2}" r="12"/><text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 + 4}" text-anchor="middle">${e.c}</text></g>` }).join('')}
      ${Object.entries(SPF_NODES).map(([n, [x, y]]) => `<g class="rtr ${n === root ? 'on' : ''} ${cur.done.includes(n) ? 'done' : ''}"><rect x="${x - 30}" y="${y - 16}" width="60" height="32" rx="8" class="r"/><text x="${x}" y="${y + 5}" text-anchor="middle" class="t">${n}</text></g>`).join('')}</svg>`
    $(el, '#sp-table').innerHTML = `<div class="table-wrap"><table><thead><tr><th>${T('router', 'маршрутизатор')}</th><th>${T('cost', 'стоимость')}</th><th>${T('via (parent)', 'через (родитель)')}</th><th>${T('state', 'состояние')}</th></tr></thead><tbody>${Object.keys(SPF_NODES).map((n) => `<tr><td>${n}</td><td>${cur.dist[n] ?? '∞'}</td><td>${(cur.prev[n] || []).join(', ') || (n === root ? '—' : '')}</td><td>${cur.done.includes(n) ? T('in the tree', 'в дереве') : cur.dist[n] !== undefined ? T('candidate', 'кандидат') : ''}</td></tr>`).join('')}</tbody></table></div>`
    $(el, '#sp-msg').innerHTML = !step ? T(`Start: only the root ${root} is known, with cost 0. Each step moves the candidate with the lowest total cost into the tree and updates its neighbours.`, `Начало: известен только корень ${root} со стоимостью 0. Каждый шаг переносит в дерево кандидата с наименьшей общей стоимостью и обновляет его соседей.`)
      : step <= log.length ? T(`Step ${step}: ${log[step - 1].u} joins the tree with cost ${log[step - 1].d}.${log[step - 1].upd.length ? ' Updated: ' + log[step - 1].upd.join(', ') + '.' : ''}${step === log.length ? ' Done: this is the shortest-path tree. Two parents mean equal-cost paths (ECMP).' : ''}`, `Шаг ${step}: ${log[step - 1].u} входит в дерево со стоимостью ${log[step - 1].d}.${log[step - 1].upd.length ? ' Обновлены: ' + log[step - 1].upd.join(', ') + '.' : ''}${step === log.length ? ' Готово: это дерево кратчайших путей. Два родителя означают пути равной стоимости (ECMP).' : ''}`) : ''
    $(el, '#sp-step').disabled = step >= log.length
    return log
  }
  el.addEventListener('click', (e) => {
    const g = e.target.closest('[data-e]')
    if (g) { const ed = edges[Number(g.dataset.e)]; const v = prompt(T(`Cost of ${ed.a}–${ed.b}`, `Стоимость ${ed.a}–${ed.b}`), ed.c); if (v !== null && Number(v) > 0) { ed.c = Math.min(65535, Math.round(Number(v))); step = 0; draw() } }
    if (e.target.id === 'sp-step') { step++; draw() }
    if (e.target.id === 'sp-all') { step = dijkstra().length; draw() }
    if (e.target.id === 'sp-reset') { step = 0; draw() }
  })
  el.addEventListener('change', (e) => { if (e.target.id === 'sp-root') { root = e.target.value; step = 0; draw() } })
  draw()
}

// ---------- DR/BDR election ----------
function drSim(el) {
  const R = [['R1', '1.1.1.1', 1], ['R2', '2.2.2.2', 1], ['R3', '3.3.3.3', 1], ['R4', '4.4.4.4', 1], ['R5', '5.5.5.5', 1]].map(([n, id, p]) => ({ n, id, p, up: false, role: '' }))
  let dr = null, bdr = null
  const log = []
  el.innerHTML = `<div class="sim-grid"><div class="card"><h3>${T('Routers on one switch (broadcast network)', 'Маршрутизаторы на одном коммутаторе (сеть broadcast)')}</h3><div id="dr-rows"></div>
    <button class="btn ghost sm" id="dr-reset">${T('Power everything off', 'Выключить всё')}</button></div>
    <div class="card"><h3>${T('Adjacencies', 'Соседства')}</h3><div id="dr-adj"></div><h4>${T('Log', 'Журнал')}</h4><ol id="dr-log" class="sm"></ol></div></div>`
  const better = (a, b) => a.p - b.p || (ipToInt(a.id) - ipToInt(b.id))
  const elect = () => {
    // non-preemptive: an existing DR/BDR keeps the role; only a missing role is elected
    const elig = R.filter((r) => r.up && r.p > 0)
    if (dr && !dr.up) { log.push(T(`${dr.n} (DR) is gone: the BDR takes over as DR`, `${dr.n} (DR) пропал: BDR становится DR`)); dr = bdr && bdr.up ? bdr : null; bdr = null }
    if (bdr && !bdr.up) bdr = null
    if (!dr) { const c = elig.filter((r) => r !== bdr).sort(better).pop(); if (c) { dr = c; log.push(T(`${c.n} becomes DR (priority ${c.p}, router ID ${c.id})`, `${c.n} становится DR (priority ${c.p}, router ID ${c.id})`)) } }
    if (!bdr) { const c = elig.filter((r) => r !== dr).sort(better).pop(); if (c) { bdr = c; log.push(T(`${c.n} becomes BDR`, `${c.n} становится BDR`)) } }
    for (const r of R) r.role = !r.up ? '' : r === dr ? 'DR' : r === bdr ? 'BDR' : 'DROther'
  }
  const draw = () => {
    $(el, '#dr-rows').innerHTML = `<div class="table-wrap"><table><thead><tr><th></th><th>router ID</th><th>priority</th><th>${T('role', 'роль')}</th></tr></thead><tbody>${R.map((r, i) => `<tr><td><button class="btn sm ${r.up ? '' : 'ghost'}" data-pw="${i}">${r.up ? '⏻ ' + r.n : r.n + ' ' + T('off', 'выкл')}</button></td><td class="mono">${r.id}</td>
      <td><input type="number" min="0" max="255" value="${r.p}" data-pr="${i}" style="width:60px" aria-label="priority ${r.n}"></td><td><b class="${r.role === 'DR' ? 'good' : ''}">${r.role}</b></td></tr>`).join('')}</tbody></table></div>`
    const up = R.filter((r) => r.up)
    const n = up.length
    const full = up.filter((r) => r.role !== 'DROther').length ? (n - 1) + (bdr ? n - 2 : 0) : 0
    $(el, '#dr-adj').innerHTML = `<div class="kv"><div><span>${T('routers up', 'включено')}</span><b>${n}</b></div><div><span>${T('Full adjacencies with DR/BDR', 'Full-соседств с DR/BDR')}</span><b>${Math.max(0, full)}</b></div><div><span>${T('without DR (full mesh)', 'без DR (полная сетка)')}</span><b>${n * (n - 1) / 2}</b></div></div>
      <p class="sm">${T('Every router is Full with the DR and the BDR only; DROthers stay in 2-Way with each other. LSAs go to 224.0.0.6 (DR and BDR) and the DR floods them back to 224.0.0.5 (all OSPF routers).', 'Каждый маршрутизатор в Full только с DR и BDR; DROther между собой остаются в 2-Way. LSA отправляются на 224.0.0.6 (DR и BDR), а DR рассылает их обратно на 224.0.0.5 (все маршрутизаторы OSPF).')}</p>`
    $(el, '#dr-log').innerHTML = log.slice(-8).map((x) => `<li>${x}</li>`).join('')
  }
  el.addEventListener('click', (e) => {
    const i = e.target.dataset.pw
    if (i !== undefined) { const r = R[Number(i)]; r.up = !r.up; log.push(r.up ? T(`${r.n} comes up and listens for hellos`, `${r.n} включается и слушает hello`) : T(`${r.n} goes down`, `${r.n} выключается`)); elect(); draw() }
    if (e.target.id === 'dr-reset') { R.forEach((r) => { r.up = false; r.role = '' }); dr = bdr = null; log.length = 0; draw() }
  })
  el.addEventListener('change', (e) => {
    const i = e.target.dataset.pr
    if (i !== undefined) { const r = R[Number(i)]; r.p = Math.max(0, Math.min(255, Number(e.target.value) || 0)); log.push(T(`${r.n} priority ${r.p}: no re-election, the roles only change when the DR or BDR fails`, `${r.n} priority ${r.p}: перевыборов нет, роли меняются только при отказе DR или BDR`)); if (r.p === 0 && (r === dr || r === bdr)) { log.push(T('priority 0 makes it ineligible: it gives up its role', 'priority 0 делает его неизбираемым: он отказывается от роли')); if (r === dr) { dr = bdr; bdr = null } else bdr = null }; elect(); draw() }
  })
  draw()
}

// ---------- area types ----------
const AREAS = [
  ['backbone', T('Backbone (area 0)', 'Магистральная (area 0)'), [1, 2, 3, 4, 5], T('Has every route. All other areas attach to it.', 'Содержит все маршруты. Все остальные области подключаются к ней.')],
  ['normal', T('Normal (standard) area', 'Обычная (стандартная) область'), [1, 2, 3, 4, 5], T('Gets inter-area (3) and external (5) routes from the ABR.', 'Получает межобластные (3) и внешние (5) маршруты от ABR.')],
  ['stub', T('Stub', 'Stub (тупиковая)'), [1, 2, 3], T('No external LSAs (4, 5); the ABR injects a default route as a type 3 LSA. No ASBR is allowed inside.', 'Нет внешних LSA (4, 5); ABR добавляет маршрут по умолчанию как LSA type 3. ASBR внутри не допускается.')],
  ['tstub', T('Totally stubby (stub + no-summaries)', 'Totally stubby (stub + no-summaries)'), [1, 2, '3*'], T('Only intra-area routes plus one default route (type 3) from the ABR.', 'Только внутриобластные маршруты и один маршрут по умолчанию (type 3) от ABR.')],
  ['nssa', 'NSSA', [1, 2, 3, 7], T('Like a stub, but a local ASBR may redistribute routes as type 7 LSAs, which the ABR translates to type 5 for the rest of the network. A default route is not added automatically.', 'Как stub, но локальный ASBR может перераспределять маршруты как LSA type 7, которые ABR транслирует в type 5 для остальной сети. Маршрут по умолчанию автоматически не добавляется.')],
  ['tnssa', T('Totally NSSA (nssa + no-summaries)', 'Totally NSSA (nssa + no-summaries)'), [1, 2, '3*', 7], T('NSSA without inter-area routes; the ABR sends a default route.', 'NSSA без межобластных маршрутов; ABR отправляет маршрут по умолчанию.')],
]
const LSA = [[1, 'Router', T('every router, inside its area', 'каждый маршрутизатор, внутри своей области')], [2, 'Network', T('the DR of a broadcast segment', 'DR сегмента broadcast')], [3, 'Summary', T('ABR: networks of other areas', 'ABR: сети других областей')], [4, 'ASBR summary', T('ABR: how to reach an ASBR', 'ABR: как добраться до ASBR')], [5, 'External', T('ASBR: redistributed routes', 'ASBR: перераспределённые маршруты')], [7, 'NSSA external', T('ASBR inside an NSSA', 'ASBR внутри NSSA')]]
function areaSim(el) {
  let cur = 'stub'
  const draw = () => {
    const a = AREAS.find((x) => x[0] === cur)
    const allowed = (n) => a[2].some((x) => x === n || x === n + '*')
    el.innerHTML = `<div class="row wrap">${AREAS.map(([id, name]) => `<button class="chip ${id === cur ? 'on' : ''}" data-a="${id}">${name}</button>`).join('')}</div>
      <div class="sim-grid"><div class="card"><h3>${a[1]}</h3><p>${a[3]}</p>
      ${cur === 'stub' || cur === 'tstub' ? `<pre class="code sm"><code>/routing ospf area add name=area1 area-id=0.0.0.1 \\\n  instance=default-v2 type=stub${cur === 'tstub' ? ' no-summaries' : ''}</code></pre>` : cur === 'nssa' || cur === 'tnssa' ? `<pre class="code sm"><code>/routing ospf area add name=area2 area-id=0.0.0.2 \\\n  instance=default-v2 type=nssa${cur === 'tnssa' ? ' no-summaries' : ''}</code></pre>` : ''}
      <p class="muted sm">${T('Every router in the area must agree on the area type, otherwise they do not become neighbours (the stub flag is in the hello). no-summaries matters on the ABR.', 'Все маршрутизаторы области должны совпадать по типу области, иначе они не станут соседями (флаг stub передаётся в hello). no-summaries имеет значение на ABR.')}</p></div>
      <div class="card"><div class="table-wrap"><table><thead><tr><th>LSA</th><th>${T('from', 'от кого')}</th><th>${T('enters this area', 'входит в область')}</th></tr></thead><tbody>${LSA.map(([n, name, who]) => `<tr><td><b>${n}</b> ${name}</td><td class="sm">${who}</td><td class="${allowed(n) ? 'good' : 'bad'}">${allowed(n) ? (a[2].includes(n + '*') ? T('only the default route', 'только маршрут по умолчанию') : '✓') : '✗'}</td></tr>`).join('')}</tbody></table></div></div></div>`
  }
  el.addEventListener('click', (e) => { const id = e.target.dataset.a; if (id) { cur = id; draw() } })
  draw()
}
