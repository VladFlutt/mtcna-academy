// MTCTCE simulators: DHCP option 121 encoder, packet flow walker (RouterOS 6/7), HTB allocator
// with the trees from the course slides, PSD and connection-limit detector, and a tester for
// proxy wildcards and DNS regexps. The MTCNA burst and PCQ simulators are reused as they are.

import { T } from '../i18n.js'
import { parseRate } from '../routeros.js'
import { opt121Encode, opt121Decode, htbAllocate, fmt, proxyMatch } from './engine.js'

const $ = (root, sel) => root.querySelector(sel)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export const TCE_SIMS = [
  { id: 'opt121', icon: '🧾', title: T('DHCP option 121 encoder', 'Кодировщик опции DHCP 121'), desc: T('Turn classless static routes into the hex value for /ip dhcp-server option, or decode a value back into routes.', 'Превратите бесклассовые статические маршруты в hex-значение для /ip dhcp-server option или раскодируйте значение обратно в маршруты.'), render: opt121Sim },
  { id: 'packet-flow', icon: '🛤️', title: T('Packet flow walker', 'Путь пакета'), desc: T('Pick traffic to, through or from the router, bridged or routed, with or without FastTrack, and see every chain and queue it passes in order.', 'Выберите трафик к маршрутизатору, через него или от него, бриджевый или маршрутизируемый, с FastTrack или без, и посмотрите по порядку все цепочки и очереди, через которые он проходит.'), render: flowSim },
  { id: 'htb', icon: '🌲', title: T('HTB allocator', 'Распределение HTB'), desc: T('Build a queue tree with limit-at, max-limit, priority and demand, and see how HTB shares the bandwidth step by step. The examples from the course slides are built in.', 'Постройте дерево очередей с limit-at, max-limit, priority и потреблением и посмотрите, как HTB делит полосу по шагам. Примеры со слайдов курса встроены.'), render: htbSim },
  { id: 'psd', icon: '🕵️', title: T('Port scan and connection flood detector', 'Детектор сканирования портов и флуда соединений'), desc: T('See how psd adds up port weights within the delay threshold, and when connection-limit fires.', 'Посмотрите, как psd суммирует веса портов в пределах delay threshold и когда срабатывает connection-limit.'), render: psdSim },
  { id: 'patterns', icon: '🔎', title: T('Proxy and DNS pattern tester', 'Проверка шаблонов прокси и DNS'), desc: T('Test web proxy wildcards (*, ?), proxy regexes (starting with :) and DNS static regexps against host names.', 'Проверьте шаблоны веб-прокси (*, ?), регулярные выражения прокси (начинаются с :) и regexp статического DNS на именах хостов.'), render: patternSim },
]

// ---------- option 121 ----------
function opt121Sim(el) {
  let rows = [{ dst: '10.10.0.0/16', gw: '192.168.33.254' }, { dst: '0.0.0.0/0', gw: '192.168.33.1' }]
  el.innerHTML = `<div class="sim-grid"><div class="card"><h3>${T('Routes', 'Маршруты')}</h3><div id="o-rows"></div><button class="btn ghost sm" id="o-add">+ ${T('route', 'маршрут')}</button>
    <div id="o-out" class="result"></div></div>
    <div class="card"><h3>${T('Decode a value', 'Раскодировать значение')}</h3><input id="o-hex" class="mono" size="34" value="0x100A270A260101" aria-label="hex">
    <div class="row wrap">${['0x100A270A260101', '0x18C0A8210A010101', '0x00C0A85801'].map((x) => `<button class="chip mono" data-h="${x}">${x}</button>`).join('')}</div><div id="o-dec" class="result"></div>
    <p class="muted">${T('Format of every route: prefix length (1 byte), only the significant octets of the destination (0 to 4 bytes), the gateway (4 bytes). A client that receives option 121 ignores option 3 (the router), so include the default route too.', 'Формат каждого маршрута: длина префикса (1 байт), только значащие октеты сети назначения (от 0 до 4 байт), шлюз (4 байта). Клиент, получивший опцию 121, игнорирует опцию 3 (router), поэтому добавьте и маршрут по умолчанию.')}</p></div></div>`
  const draw = () => {
    $(el, '#o-rows').innerHTML = `<div class="table-wrap"><table><thead><tr><th>dst-address</th><th>gateway</th><th></th></tr></thead><tbody>${rows.map((r, i) => `<tr><td><input class="mono" size="16" data-i="${i}" data-k="dst" value="${esc(r.dst)}"></td><td><input class="mono" size="15" data-i="${i}" data-k="gw" value="${esc(r.gw)}"></td><td><button class="link" data-del="${i}" aria-label="${T('delete', 'удалить')}">✕</button></td></tr>`).join('')}</tbody></table></div>`
    out()
  }
  const out = () => {
    const parts = rows.map((r) => ({ r, hex: opt121Encode([r]) }))
    const all = opt121Encode(rows)
    $(el, '#o-out').innerHTML = all ? `${parts.map(({ r, hex }) => `<div class="mono">${esc(r.dst)} → ${esc(r.gw)}: <b>${hex.slice(2).match(/../g).join(' ')}</b></div>`).join('')}<p><code>/ip dhcp-server option add name=classless code=121 value=${all}</code></p>` : `<span class="bad">${T('Check the addresses: dst-address as a.b.c.d/len, gateway as a.b.c.d', 'Проверьте адреса: dst-address как a.b.c.d/len, gateway как a.b.c.d')}</span>`
  }
  const dec = () => {
    const r = opt121Decode($(el, '#o-hex').value.trim())
    $(el, '#o-dec').innerHTML = r ? r.map((x) => `<div class="mono">${x.dst} → ${x.gw}</div>`).join('') || '-' : `<span class="bad">${T('Not a valid option 121 value', 'Это не корректное значение опции 121')}</span>`
  }
  el.addEventListener('input', (e) => { const i = e.target.dataset.i; if (i !== undefined) { rows[+i][e.target.dataset.k] = e.target.value.trim(); out() } if (e.target.id === 'o-hex') dec() })
  el.addEventListener('click', (e) => {
    if (e.target.id === 'o-add') { rows.push({ dst: '172.16.0.0/12', gw: '192.168.33.254' }); draw() }
    if (e.target.dataset.del !== undefined) { rows.splice(+e.target.dataset.del, 1); draw() }
    if (e.target.dataset.h) { $(el, '#o-hex').value = e.target.dataset.h; dec() }
  })
  draw(); dec()
}

// ---------- packet flow ----------
// Stages of the RouterOS 6/7 IP packet flow. skipFT: skipped by fasttracked packets.
const ST = {
  inIf: ['in-interface', T('The packet arrives on an interface (or is decapsulated from a tunnel)', 'Пакет приходит на интерфейс (или извлекается из туннеля)')],
  bridgeIn: ['bridge input', T('Bridge decision: the destination MAC is another bridge port, so the frame is switched, not routed', 'Решение бриджа: MAC назначения на другом порту бриджа, кадр коммутируется, а не маршрутизируется')],
  bfilter: ['/interface bridge filter, nat', T('Bridge firewall chains (forward, MAC-level)', 'Цепочки файрвола бриджа (forward, на уровне MAC)')],
  raw: ['raw prerouting', T('RAW: before connection tracking; drop or notrack cheaply', 'RAW: до отслеживания соединений; дешёвый drop или notrack')],
  ct: ['connection tracking', T('The packet is matched to a connection: new, established, related, invalid', 'Пакет сопоставляется с соединением: new, established, related, invalid')],
  mpre: ['mangle prerouting', T('Mark connections and packets, set routing marks for policy routing', 'Маркировка соединений и пакетов, routing mark для маршрутизации по политикам')],
  dstnat: ['nat dstnat', T('Destination NAT: port forwarding, redirect to the router (DNS, proxy)', 'Destination NAT: проброс портов, redirect на маршрутизатор (DNS, прокси)')],
  route: ['routing decision', T('Lookup in the routing table (the one chosen by routing rules or the routing mark)', 'Поиск в таблице маршрутизации (выбранной routing rules или routing mark)')],
  min: ['mangle input', T('Marks for traffic to the router itself', 'Метки для трафика к самому маршрутизатору')],
  fin: ['filter input', T('Protect the router: management, DNS, VPN', 'Защита маршрутизатора: управление, DNS, VPN')],
  qin: ['queue: global (input)', T('Queue tree with parent=global and simple queues see download traffic to the router here', 'Здесь queue tree с parent=global и простые очереди видят трафик к маршрутизатору')],
  local: ['local process', T('The router\'s own services (Winbox, DNS, proxy, VPN)', 'Собственные сервисы маршрутизатора (Winbox, DNS, прокси, VPN)')],
  ttl: ['TTL − 1', T('The router decrements TTL; at 0 the packet is dropped and ICMP time exceeded is sent', 'Маршрутизатор уменьшает TTL; при 0 пакет отбрасывается и отправляется ICMP time exceeded')],
  mfwd: ['mangle forward', T('Marks on transit traffic once both interfaces are known', 'Метки транзитного трафика, когда известны оба интерфейса')],
  ffwd: ['filter forward', T('Protect the networks behind the router; FastTrack is decided here', 'Защита сетей за маршрутизатором; здесь решается FastTrack')],
  rawout: ['raw output', T('RAW for packets the router sends itself', 'RAW для пакетов, которые отправляет сам маршрутизатор')],
  ctout: ['connection tracking', T('Connections the router opens itself are tracked too', 'Соединения, которые открывает сам маршрутизатор, тоже отслеживаются')],
  mout: ['mangle output', T('Marks on the router\'s own traffic', 'Метки собственного трафика маршрутизатора')],
  fout: ['filter output', T('Control what the router itself may send', 'Контроль того, что может отправлять сам маршрутизатор')],
  radj: ['routing adjustment', T('If mangle output set a routing mark, the route is looked up again', 'Если mangle output поставил routing mark, маршрут ищется заново')],
  mpost: ['mangle postrouting', T('Last chance to mark; DSCP and MSS changes', 'Последняя возможность маркировки; изменение DSCP и MSS')],
  srcnat: ['nat srcnat', T('Source NAT: masquerade, src-nat', 'Source NAT: masquerade, src-nat')],
  ipsec: ['IPsec policy', T('A matching policy encrypts the packet and it goes through the flow again as ESP', 'Совпавшая политика шифрует пакет, и он снова проходит путь как ESP')],
  qpost: ['queue: global + simple queues', T('Queue tree parent=global and simple queues (v6+: global-in/out/total are gone)', 'Queue tree parent=global и простые очереди (v6+: global-in/out/total больше нет)')],
  qif: ['queue: interface HTB', T('Queue tree with parent=<out-interface>, then the interface queue type', 'Queue tree с parent=<выходной интерфейс>, затем тип очереди интерфейса')],
  outIf: ['out-interface', T('The packet leaves the router', 'Пакет покидает маршрутизатор')],
}
const SKIP_FT = new Set(['raw', 'mpre', 'dstnat', 'mfwd', 'ffwd', 'mpost', 'srcnat', 'qpost', 'qif', 'ipsec'])
function flowPath(dir, bridged, ipfw, ft) {
  if (dir === 'to') return ['inIf', 'raw', 'ct', 'mpre', 'dstnat', 'route', 'min', 'fin', 'qin', 'local']
  if (dir === 'from') return ['local', 'route', 'rawout', 'ctout', 'mout', 'fout', 'radj', 'mpost', 'srcnat', 'ipsec', 'qpost', 'qif', 'outIf']
  if (bridged) return ipfw ? ['inIf', 'bridgeIn', 'bfilter', 'raw', 'ct', 'mpre', 'dstnat', 'mfwd', 'ffwd', 'mpost', 'srcnat', 'qpost', 'qif', 'outIf'] : ['inIf', 'bridgeIn', 'bfilter', 'qif', 'outIf']
  return ['inIf', 'raw', 'ct', 'mpre', 'dstnat', 'route', 'ttl', 'mfwd', 'ffwd', 'mpost', 'srcnat', 'ipsec', 'qpost', 'qif', 'outIf'].filter((s) => !(ft && SKIP_FT.has(s)))
}
function flowSim(el) {
  el.innerHTML = `<div class="card"><div class="row wrap">
    <label>${T('Traffic', 'Трафик')} <select id="f-dir"><option value="through">${T('through the router (forward)', 'через маршрутизатор (forward)')}</option><option value="to">${T('to the router (input)', 'к маршрутизатору (input)')}</option><option value="from">${T('from the router (output)', 'от маршрутизатора (output)')}</option></select></label>
    <label><input type="checkbox" id="f-br"> ${T('bridged (same bridge)', 'через бридж (тот же бридж)')}</label>
    <label><input type="checkbox" id="f-ipfw"> use-ip-firewall=yes</label>
    <label><input type="checkbox" id="f-ft"> ${T('fasttracked connection', 'соединение в FastTrack')}</label></div>
    <ol id="f-steps" class="steps"></ol><div id="f-note" class="result"></div></div>`
  const draw = () => {
    const dir = $(el, '#f-dir').value, br = $(el, '#f-br').checked && dir === 'through', ipfw = $(el, '#f-ipfw').checked, ft = $(el, '#f-ft').checked && dir === 'through' && !br
    const path = flowPath(dir, br, ipfw, ft)
    $(el, '#f-steps').innerHTML = path.map((k) => `<li><b class="mono">${ST[k][0]}</b> <span class="muted">${ST[k][1]}</span></li>`).join('')
    const notes = []
    if (ft) notes.push(T('FastTrack: after the first packets, an established connection skips mangle, filter, NAT and all queues (fast path). Packets that must be shaped or marked must not be fasttracked.', 'FastTrack: после первых пакетов установленное соединение обходит mangle, filter, NAT и все очереди (fast path). Пакеты, которые нужно ограничивать или маркировать, не должны попадать в FastTrack.'))
    if (br && !ipfw) notes.push(T('Bridged traffic does not pass the IP firewall at all unless the bridge has use-ip-firewall=yes.', 'Бриджевый трафик вообще не проходит IP-файрвол, если у бриджа не включено use-ip-firewall=yes.'))
    if (br && ipfw) notes.push(T('With use-ip-firewall=yes, bridged IP packets go through prerouting, forward and postrouting; match the ports with in-bridge-port and out-bridge-port.', 'С use-ip-firewall=yes бриджевые IP-пакеты проходят prerouting, forward и postrouting; порты сопоставляются по in-bridge-port и out-bridge-port.'))
    if (dir === 'to') notes.push(T('Download to the router is shaped where input traffic is queued: queue tree parent=global or a simple queue. An interface queue only sees outgoing packets.', 'Загрузка к маршрутизатору ограничивается там, где ставится в очередь входящий трафик: queue tree parent=global или простая очередь. Очередь интерфейса видит только исходящие пакеты.'))
    if (dir === 'through' && !br && !ft) notes.push(T('Order to remember: prerouting = RAW, conntrack, mangle, dstnat; forward = mangle, filter; postrouting = mangle, srcnat, then the queues.', 'Порядок для запоминания: prerouting = RAW, conntrack, mangle, dstnat; forward = mangle, filter; postrouting = mangle, srcnat, затем очереди.'))
    $(el, '#f-note').innerHTML = notes.join('<br>')
  }
  el.addEventListener('change', draw)
  draw()
}

// ---------- HTB ----------
const N = (name, parent, la, ml, pr = 8, demand = '') => ({ name, parent, la, ml, pr, demand })
const PRESETS = {
  'E1': { cap: '10M', rows: [N('Q01', 'global', '', '10M'), N('Q02', 'Q01', '4M', '10M'), N('Q03', 'Q01', '6M', '10M', 1), N('Q04', 'Q02', '2M', '10M', 3), N('Q05', 'Q02', '2M', '10M', 5)] },
  'E2': { cap: '10M', rows: [N('Q01', 'global', '', '10M'), N('Q02', 'Q01', '4M', '10M'), N('Q03', 'Q01', '2M', '10M', 3), N('Q04', 'Q02', '2M', '10M', 1), N('Q05', 'Q02', '2M', '10M', 5)] },
  'E3': { cap: '10M', rows: [N('Q01', 'global', '', '10M'), N('Q02', 'Q01', '8M', '10M'), N('Q03', 'Q01', '2M', '10M', 1), N('Q04', 'Q02', '2M', '10M', 3), N('Q05', 'Q02', '2M', '10M', 5)] },
  'E4': { cap: '10M', rows: [N('Q01', 'global', '', '10M'), N('Q02', 'Q01', '4M', '10M'), N('Q03', 'Q01', '6M', '10M', 1), N('Q04', 'Q02', '2M', '10M', 3), N('Q05', 'Q02', '12M', '15M', 5)] },
  'T6': { cap: '', rows: [N('A', 'global', '', '8M'), N('B', 'A', '2M', '4M', 1), N('C', 'A', '4M', '6M'), N('C1', 'C', '2M', '3M', 4), N('C2', 'C', '2M', '3M', 8)] },
  'T9': { cap: '', rows: [N('A', 'global', '', '8M'), N('B', 'A', '2M', '4M'), N('B1', 'B', '1M', '2M', 5), N('B2', 'B', '1M', '2M', 6), N('C', 'A', '3M', '6M'), N('C1', 'C', '1M', '2M', 2), N('C2', 'C', '1M', '2M', 3), N('C3', 'C', '1M', '2M', 4)] },
  'T10': { cap: '', rows: [N('A', 'global', '', '8M'), N('B', 'A', '4M', '4M'), N('B1', 'B', '1M', '2M', 5), N('B2', 'B', '1M', '2M', 6), N('C', 'A', '3M', '6M'), N('C1', 'C', '1M', '2M', 2), N('C2', 'C', '1M', '2M', 3), N('C3', 'C', '1M', '2M', 4)] },
  'lab': { cap: '', rows: [N('A', 'bridgeLAN', '', '30M'), N('B', 'A', '15M', '30M', 1), N('B1', 'B', '7M', '10M', 7), N('B2', 'B', '2M', '20M', 8), N('C', 'A', '6M', '20M'), N('C1', 'C', '2M', '10M', 2), N('C2', 'C', '2M', '10M', 4), N('C3', 'C', '3M', '10M', 6)] },
  'lab-2': { cap: '', rows: [N('A', 'bridgeLAN', '', '30M'), N('B', 'A', '15M', '30M', 1), N('B1', 'B', '7M', '10M', 7, '3M'), N('B2', 'B', '2M', '20M', 8), N('C', 'A', '6M', '20M'), N('C1', 'C', '2M', '10M', 2), N('C2', 'C', '2M', '10M', 4, '0'), N('C3', 'C', '3M', '10M', 6)] },
}
function htbSim(el) {
  let cur = JSON.parse(JSON.stringify(PRESETS.E1))
  el.innerHTML = `<div class="card"><div class="row wrap"><b>${T('Slide examples', 'Примеры со слайдов')}:</b> ${Object.keys(PRESETS).map((k) => `<button class="chip" data-p="${k}">${k}</button>`).join('')}
    <label>${T('link speed', 'скорость канала')} <input id="h-cap" size="6" placeholder="∞"></label></div>
    <div id="h-rows"></div><button class="btn ghost sm" id="h-add">+ ${T('queue', 'очередь')}</button>
    <p class="muted">${T('Empty demand means the leaf wants as much as it can get. Priority matters only on leaves (1 highest, 8 lowest).', 'Пустое потребление значит, что лист хочет столько, сколько сможет получить. Приоритет действует только на листьях (1 высший, 8 низший).')}</p></div>
    <div class="sim-grid"><div class="card"><h3>${T('Result', 'Результат')}</h3><div id="h-bars" class="bars"></div></div><div class="card"><h3>${T('Steps', 'Шаги')}</h3><ol id="h-steps" class="steps"></ol></div></div>`
  const draw = () => {
    $(el, '#h-cap').value = cur.cap
    $(el, '#h-rows').innerHTML = `<div class="table-wrap"><table><thead><tr><th>name</th><th>parent</th><th>limit-at</th><th>max-limit</th><th>priority</th><th>${T('demand', 'потребление')}</th><th></th></tr></thead><tbody>${cur.rows.map((r, i) => `<tr>${['name', 'parent', 'la', 'ml', 'pr', 'demand'].map((k) => `<td><input class="mono" size="${k === 'pr' ? 2 : 8}" data-i="${i}" data-k="${k}" value="${esc(r[k])}"></td>`).join('')}<td><button class="link" data-del="${i}" aria-label="${T('delete', 'удалить')}">✕</button></td></tr>`).join('')}</tbody></table></div>`
    calc()
  }
  const calc = () => {
    const rt = (v) => v === '' ? 0 : parseRate(v)
    const nodes = cur.rows.filter((r) => r.name).map((r) => ({ name: r.name, parent: r.parent, limitAt: rt(r.la) || 0, maxLimit: rt(r.ml) || 0, priority: Number(r.pr) || 8, demand: r.demand === '' ? undefined : rt(r.demand) }))
    const res = htbAllocate(nodes, cur.cap ? parseRate(cur.cap) : undefined)
    const leaves = res.leaves
    const top = Math.max(1, ...leaves.map((l) => res.rate[l]))
    $(el, '#h-bars').innerHTML = leaves.map((l) => `<div class="bar"><div style="height:${Math.max(2, res.rate[l] / top * 100)}%"></div><span>${esc(l)}</span><em>${fmt(res.rate[l])}</em></div>`).join('')
    $(el, '#h-steps').innerHTML = res.steps.map((s) => `<li>${esc(s.text)}<br><span class="mono muted">${Object.entries(s.rate).map(([k, v]) => `${esc(k)} ${fmt(v)}`).join(' · ')}</span></li>`).join('') +
      `<li><b>${T('Inner queues', 'Внутренние очереди')}:</b> <span class="mono">${cur.rows.filter((r) => !leaves.includes(r.name)).map((r) => `${esc(r.name)} ${fmt(res.rate[r.name] || 0)}`).join(' · ')}</span></li>`
  }
  el.addEventListener('input', (e) => { const i = e.target.dataset.i; if (i !== undefined) { cur.rows[+i][e.target.dataset.k] = e.target.value.trim(); calc() } if (e.target.id === 'h-cap') { cur.cap = e.target.value.trim(); calc() } })
  el.addEventListener('click', (e) => {
    if (e.target.dataset.p) { cur = JSON.parse(JSON.stringify(PRESETS[e.target.dataset.p])); draw() }
    if (e.target.id === 'h-add') { cur.rows.push(N('new', cur.rows[0] ? cur.rows[0].name : 'global', '1M', '2M')); draw() }
    if (e.target.dataset.del !== undefined) { cur.rows.splice(+e.target.dataset.del, 1); draw() }
  })
  draw()
}

// ---------- PSD and connection-limit ----------
function psdSim(el) {
  el.innerHTML = `<div class="sim-grid"><div class="card"><h3>psd</h3><div class="row wrap">
    <label>weight-threshold <input id="p-w" size="3" value="21"></label><label>delay-threshold (s) <input id="p-d" size="3" value="3"></label>
    <label>low-port-weight <input id="p-lo" size="2" value="3"></label><label>high-port-weight <input id="p-hi" size="2" value="1"></label></div>
    <div class="row wrap"><label>${T('ports, in order', 'порты по порядку')} <input id="p-ports" class="mono" size="30" value="21,22,23,25,80,110,139,443"></label><label>${T('seconds between probes', 'секунд между пробами')} <input id="p-gap" size="4" value="0.2"></label></div>
    <div class="row wrap">${[[T('fast scan of privileged ports', 'быстрый скан привилегированных портов'), '21,22,23,25,80,110,139,443', '0.2'], [T('high ports', 'высокие порты'), '3000,3001,3002,3003,3004,3005,3006,3007,3008,3009,3010,3011,3012,3013,3014,3015,3016,3017,3018,3019,3020,3021', '0.1'], [T('slow scan', 'медленный скан'), '21,22,23,25,80,110,139,443', '2'], [T('a normal user', 'обычный пользователь'), '443,443,80,443', '0.5']].map(([n, p, g]) => `<button class="chip" data-ports="${p}" data-gap="${g}">${n}</button>`).join('')}</div>
    <ol id="p-log" class="steps"></ol></div>
    <div class="card"><h3>connection-limit</h3><div class="row wrap"><label>connection-limit <input id="c-lim" size="3" value="100"></label><label>netmask <input id="c-mask" size="2" value="32"></label></div>
    <label>${T('connections from 198.51.100.7', 'соединений с 198.51.100.7')} <input id="c-n" type="range" min="0" max="300" value="60"> <b id="c-nv"></b></label>
    <label>${T('connections from the rest of 198.51.100.0/24', 'соединений с остальных адресов 198.51.100.0/24')} <input id="c-o" type="range" min="0" max="300" value="80"> <b id="c-ov"></b></label>
    <div id="c-out" class="result"></div>
    <p class="muted">${T('connection-limit=N,mask matches when the number of connections from the source, counted per address block of that mask, is greater than N. Use it on new TCP connections and send the source to an address list instead of dropping single packets.', 'connection-limit=N,mask совпадает, когда число соединений с источника, посчитанное по блоку адресов этой маски, больше N. Используйте его для новых TCP-соединений и отправляйте источник в address list, а не отбрасывайте отдельные пакеты.')}</p></div></div>`
  const draw = () => {
    const w = +$(el, '#p-w').value, d = +$(el, '#p-d').value, lo = +$(el, '#p-lo').value, hi = +$(el, '#p-hi').value, gap = +$(el, '#p-gap').value
    const ports = $(el, '#p-ports').value.split(',').map((x) => +x.trim()).filter((x) => x > 0)
    const hist = []
    let hit = -1
    const log = ports.map((port, i) => {
      const t = i * gap
      hist.push({ t, port })
      const win = hist.filter((h) => t - h.t <= d)
      const uniq = new Map(win.map((h) => [h.port, h.port < 1024 ? lo : hi]))
      const sum = [...uniq.values()].reduce((a, b) => a + b, 0)
      if (sum >= w && hit < 0) hit = i
      return `<li class="${sum >= w ? 'bad' : ''}"><span class="mono">t=${t.toFixed(1)}s port ${port}</span>: ${T('weight', 'вес')} ${sum}${sum >= w ? T(' ≥ threshold: scanner detected', ' ≥ порога: сканер обнаружен') : ''}</li>`
    })
    $(el, '#p-log').innerHTML = log.join('') + `<li>${hit >= 0 ? T(`Detected at probe ${hit + 1}.`, `Обнаружен на пробе ${hit + 1}.`) : T('Not detected: the ports in the window never reach the threshold. A repeated port counts once.', 'Не обнаружен: порты в окне не набирают порога. Повторный порт считается один раз.')}</li>`
    const lim = +$(el, '#c-lim').value, mask = +$(el, '#c-mask').value, n = +$(el, '#c-n').value, o = +$(el, '#c-o').value
    $(el, '#c-nv').textContent = n; $(el, '#c-ov').textContent = o
    const count = mask >= 32 ? n : n + o
    $(el, '#c-out').innerHTML = `${T('Counted for this source', 'Посчитано для этого источника')}: <b>${count}</b> (${mask >= 32 ? T('only its own connections', 'только его собственные соединения') : T('all connections of its /' + mask, 'все соединения его /' + mask)}). ` + (count > lim ? `<span class="bad">${T('connection-limit matches: the rule fires', 'connection-limit совпадает: правило срабатывает')}</span>` : `<span class="good">${T('below the limit: no match', 'ниже лимита: совпадения нет')}</span>`)
  }
  el.addEventListener('input', draw)
  el.addEventListener('click', (e) => { if (e.target.dataset.ports) { $(el, '#p-ports').value = e.target.dataset.ports; $(el, '#p-gap').value = e.target.dataset.gap; draw() } })
  draw()
}

// ---------- patterns ----------
const HOSTS = 'www.mikrotik.com\nmikrotik.com\nhelp.mikrotik.com\nrutorrent.org\nwww.thepiratebay.org\nads.example.com\nx.ads.example.com\nbadads.example.com\nexample.com'
function patternSim(el) {
  el.innerHTML = `<div class="sim-grid"><div class="card"><h3>${T('Pattern', 'Шаблон')}</h3>
    <label><select id="r-kind"><option value="proxy">/ip proxy access dst-host</option><option value="dns">/ip dns static regexp</option></select></label>
    <input id="r-pat" class="mono" size="34" value="*mikrotik.com" aria-label="${T('pattern', 'шаблон')}">
    <div class="row wrap">${[['proxy', '*mikrotik.com'], ['proxy', 'www.mikrotik.co?'], ['proxy', ':(torrent|piratebay)'], ['proxy', ':^www\\.'], ['dns', '(^|\\.)ads\\.example\\.com$'], ['dns', 'ads\\.example\\.com']].map(([k, p]) => `<button class="chip mono" data-k="${k}" data-p="${esc(p)}">${esc(p)}</button>`).join('')}</div>
    <p class="muted">${T('Proxy: * is any number of characters, ? is one character, and the whole host must match. A value that starts with : is a regular expression and may match anywhere. DNS regexp is always a regular expression; anchor it with ^ and $ (written \\$ inside quotes on the CLI).', 'Прокси: * любое число символов, ? один символ, совпадать должен весь хост. Значение, начинающееся с :, это регулярное выражение, оно может совпасть в любом месте. Regexp в DNS всегда регулярное выражение; привязывайте его ^ и $ (в кавычках в CLI пишется \\$).')}</p></div>
    <div class="card"><h3>${T('Host names', 'Имена хостов')}</h3><textarea id="r-hosts" rows="9" class="mono" aria-label="hosts">${HOSTS}</textarea><ul id="r-out"></ul></div></div>`
  const draw = () => {
    const kind = $(el, '#r-kind').value, pat = $(el, '#r-pat').value
    let bad = false
    const test = (h) => { if (kind === 'proxy') return proxyMatch(pat, h); try { return new RegExp(pat, 'i').test(h) } catch { bad = true; return false } }
    const rows = $(el, '#r-hosts').value.split('\n').map((h) => h.trim()).filter(Boolean).map((h) => `<li class="${test(h) ? 'good' : 'muted'}"><span class="mono">${esc(h)}</span> ${test(h) ? '✓' : '·'}</li>`)
    $(el, '#r-out').innerHTML = bad ? `<li class="bad">${T('Invalid regular expression', 'Некорректное регулярное выражение')}</li>` : rows.join('')
  }
  el.addEventListener('input', draw)
  el.addEventListener('click', (e) => { if (e.target.dataset.p) { $(el, '#r-kind').value = e.target.dataset.k; $(el, '#r-pat').value = e.target.dataset.p; draw() } })
  draw()
}
