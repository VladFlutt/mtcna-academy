// AI study assistant: terminal error tutor, configuration audit, troubleshooting
// lab generator, adaptive study plan, exam readiness and the Claude-backed tutor
// chat (with a built-in offline answer when /api/tutor is not configured).

import { RouterOS, evalChain, laptopInternet, laptopState, lookup, routerInternet, bridgeOf } from './routeros.js'
import { STARTS } from './labs.js'
import { T, LANG } from './i18n.js'

const on = (x) => x && x.disabled !== 'yes'
const yes = (v) => v === 'yes' || v === true

// ---------- 1. terminal error tutor ----------
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}
function closest(word, list) {
  let best = null, bd = 99
  for (const w of list) { const x = lev(word, w); if (x < bd) { bd = x; best = w } }
  return best && bd <= Math.max(2, Math.floor(word.length / 3)) ? best : null
}

// Returns a short hint for an error printed by the simulator, or null.
export function explainError(ros, line, res) {
  if (!res) return null
  let m = res.match(/^bad command name (\S+) \(line 1 column (\d+)\)/)
  if (m) {
    const bad = m[1], col = Number(m[2])
    const before = line.slice(0, Math.max(0, col - 1))
    let opts = []
    try { opts = ros.complete(before).list || [] } catch {}
    const sug = closest(bad, opts)
    if (sug) return T(`"${bad}" is not a command here. Did you mean "${sug}"? → ${before}${sug}${line.slice(col - 1 + bad.length)}`, `«${bad}» здесь нет. Возможно, вы имели в виду «${sug}»: ${before}${sug}${line.slice(col - 1 + bad.length)}`)
    return T(`"${bad}" is not valid at this level. Press Tab after "${before.trim() || '/'}" to list what is allowed${opts.length ? ': ' + opts.slice(0, 10).join(', ') : ''}.`, `«${bad}» на этом уровне не существует. Нажмите Tab после «${before.trim() || '/'}», чтобы увидеть варианты${opts.length ? ': ' + opts.slice(0, 10).join(', ') : ''}.`)
  }
  m = res.match(/^expected end of command \(line 1 column (\d+)\)/)
  if (m) {
    const rest = line.slice(Number(m[1]) - 1)
    const arg = (rest.match(/^([\w-]+)=/) || [])[1]
    if (arg) {
      let opts = []
      try { opts = (ros.complete(line.slice(0, Number(m[1]) - 1)).list || []).map((s) => s.replace(/=$/, '')) } catch {}
      const sug = closest(arg, opts)
      return sug ? T(`This command has no argument "${arg}". Did you mean "${sug}="?`, `У этой команды нет аргумента «${arg}». Возможно, нужен «${sug}=»?`) : T(`This command has no argument "${arg}". Press Tab to list the arguments it accepts.`, `У этой команды нет аргумента «${arg}». Нажмите Tab, чтобы увидеть допустимые аргументы.`)
    }
    return T('Something extra is at the end of the line. Check for a missing "=" or a space inside a value (quote values with spaces).', 'В конце строки лишний текст. Проверьте, не пропущен ли «=» и нет ли пробела внутри значения (значения с пробелами берите в кавычки).')
  }
  m = res.match(/^invalid value (\S+) for argument (\S+)/) || res.match(/^invalid value for argument (\S+)/)
  if (m) {
    const arg = m[2] || m[1]
    const tips = {
      action: T('Filter actions: accept, drop, reject, jump, return, log, add-src-to-address-list. NAT: masquerade, src-nat, dst-nat, redirect.', 'Действия filter: accept, drop, reject, jump, return, log, add-src-to-address-list. NAT: masquerade, src-nat, dst-nat, redirect.'),
      gateway: T('A gateway is an IP address (22.1.1.1) or an interface name.', 'Шлюз это IP-адрес (22.1.1.1) или имя интерфейса.'),
      address: T('Addresses are written with a prefix, for example 192.168.33.1/24.', 'Адрес пишется с префиксом, например 192.168.33.1/24.'),
      'dst-address': T('Use a network with a prefix, for example 0.0.0.0/0 or 10.0.0.0/8.', 'Укажите сеть с префиксом, например 0.0.0.0/0 или 10.0.0.0/8.'),
      chain: T('Filter chains: input, forward, output. NAT chains: srcnat, dstnat.', 'Цепочки filter: input, forward, output. Цепочки NAT: srcnat, dstnat.'),
      interface: T('Use an existing interface name; /interface print lists them.', 'Нужно имя существующего интерфейса; список: /interface print.'),
    }
    return (m[2] ? T(`"${m[1]}" is not accepted for ${arg}. `, `«${m[1]}» не подходит для ${arg}. `) : '') + (tips[arg] || T(`Type the command up to "${arg}=" and press Tab to see the accepted values.`, `Наберите команду до «${arg}=» и нажмите Tab, чтобы увидеть допустимые значения.`))
  }
  if (/^input does not match any value of (\S+)/.test(res)) {
    const what = res.match(/of (\S+)/)[1]
    return T(`The ${what} you named does not exist yet. Create it first or check the exact name with print.`, `Указанный ${what} ещё не существует. Сначала создайте его или проверьте точное имя через print.`)
  }
  if (/^no such item/.test(res)) return T('Item numbers come from the last print of this menu. Run print first, then use the number from the # column.', 'Номера элементов берутся из последнего print этого меню. Сначала выполните print, затем используйте номер из столбца #.')
  if (/already exists|already added/.test(res)) return T('That object is already there. Use print to see it, or set to change it instead of add.', 'Такой объект уже есть. Посмотрите его через print или измените через set вместо add.')
  return null
}

// ---------- 2. configuration audit ----------
const WAN_PROBE = '203.0.113.50'
function wanIf(st) { const r = lookup(st, '8.8.8.8'); return (r && r.iface) || 'ether1' }
function lanIf(st) { return bridgeOf(st, st.laptop?.port || 'ether2') || st.laptop?.port || 'ether2' }
function inputFromWan(st, protocol, port) {
  return evalChain(st, 'filter', 'input', { src: WAN_PROBE, dst: '22.1.1.33', protocol, dstPort: port, inIf: wanIf(st), state: 'new' }).verdict === 'accept'
}

const REASON_FIX = [
  ['no srcnat', () => T('Add masquerade for traffic leaving the WAN.', 'Добавьте masquerade для трафика, уходящего в WAN.'), '/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade'],
  ['router has no route to', () => T('The router has no active default route: it is missing, or its gateway is not reachable from the WAN address.', 'У маршрутизатора нет активного маршрута по умолчанию: его нет, или шлюз недоступен с адреса WAN.'), '/ip route print\n/ip address print\n/ip route add dst-address=0.0.0.0/0 gateway=22.1.1.1'],
  ['router WAN is not connected', () => T('The WAN side is not up: check the ether1 address, DHCP client or PPPoE, and the gateway.', 'WAN не поднят: проверьте адрес ether1, DHCP-клиент или PPPoE и шлюз.'), '/ip address print\n/ip route print'],
  ['laptop gateway', () => T('The laptop gets a wrong gateway. Check the DHCP network gateway (or the static laptop settings).', 'Ноутбук получает неверный шлюз. Проверьте gateway в DHCP network (или статические настройки ноутбука).'), '/ip dhcp-server network print'],
  ['not in the same subnet', () => T('The laptop and the router LAN address are in different subnets.', 'Ноутбук и LAN-адрес маршрутизатора в разных подсетях.'), '/ip address print'],
  ['no DHCP server on', () => T('No working DHCP server on the laptop interface: is the server enabled, and is the laptop port in the bridge?', 'На интерфейсе ноутбука нет работающего DHCP-сервера: сервер включён и порт ноутбука точно в бридже?'), '/ip dhcp-server print\n/interface bridge port print'],
  ['no address pool', () => T('The DHCP server has no valid address pool.', 'У DHCP-сервера нет корректного пула адресов.'), '/ip pool print\n/ip dhcp-server print'],
  ['no DHCP network', () => T('There is no DHCP network entry for the leased address.', 'Нет записи DHCP network для выдаваемого адреса.'), '/ip dhcp-server network print'],
  ['cable/port down', () => T('The laptop port is disabled or down.', 'Порт ноутбука выключен или не поднят.'), '/interface print\n/interface bridge port print'],
  ['blocked by filter forward', () => T('A forward rule drops the laptop traffic.', 'Правило forward отбрасывает трафик ноутбука.'), '/ip firewall filter print where chain=forward'],
  ['replies blocked', () => T('Replies are dropped in forward: accept established,related before your drop rules.', 'Ответы отбрасываются в forward: разрешите established,related до правил drop.'), '/ip firewall filter add chain=forward connection-state=established,related action=accept place-before=0'],
  ['allow-remote-requests', () => T('The router does not answer DNS for clients.', 'Маршрутизатор не отвечает клиентам на DNS-запросы.'), '/ip dns set allow-remote-requests=yes'],
  ['DNS to router blocked', () => T('Input rules block DNS from the LAN to the router.', 'Правила input блокируют DNS из LAN к маршрутизатору.'), '/ip firewall filter print where chain=input'],
  ['cannot resolve', () => T('The router has no upstream DNS server.', 'У маршрутизатора нет вышестоящего DNS-сервера.'), '/ip dns set servers=22.1.1.1'],
  ['no DNS server', () => T('The laptop gets no DNS server.', 'Ноутбук не получает DNS-сервер.'), '/ip dhcp-server network print'],
  ['blocked by filter input', () => T('Input rules drop traffic from the laptop to the router.', 'Правила input отбрасывают трафик от ноутбука к маршрутизатору.'), '/ip firewall filter print where chain=input'],
]
export function reasonFix(reason) {
  const r = REASON_FIX.find(([k]) => String(reason || '').includes(k))
  return r ? { text: r[1](), cmd: r[2] } : null
}

// Each finding: { sev: 'high'|'med'|'low', title, why, fix }
export function auditConfig(st) {
  const f = []
  const add = (sev, title, why, fix, cat) => f.push({ sev, title, why, fix, cat })
  const online = routerInternet(st)
  const inet = laptopInternet(st)
  if (!inet.ok) {
    const fx = reasonFix(inet.reason)
    add('high', T('The laptop has no Internet', 'У ноутбука нет Интернета'), (fx ? fx.text + ' ' : '') + T('Simulator says: ', 'Симулятор: ') + inet.reason, fx ? fx.cmd : '', 'inet')
  }
  if (online) {
    if (inputFromWan(st, 'tcp', '8291') || inputFromWan(st, 'tcp', '22')) add('high', T('Router management is open to the Internet', 'Управление маршрутизатором открыто из Интернета'), T('A new connection from the WAN to Winbox (8291) or SSH (22) is accepted. Drop input that does not come from the LAN, after accepting established,related and ICMP.', 'Новое соединение из WAN к Winbox (8291) или SSH (22) принимается. Отбрасывайте input не из LAN, предварительно разрешив established,related и ICMP.'),
      '/ip firewall filter add chain=input connection-state=established,related action=accept\n/ip firewall filter add chain=input protocol=icmp action=accept\n/ip firewall filter add chain=input in-interface=' + wanIf(st) + ' action=drop')
    else if (yes(st.singletons['ip dns']['allow-remote-requests']) && inputFromWan(st, 'udp', '53')) add('high', T('Open DNS resolver on the WAN', 'Открытый DNS-резолвер на WAN'), T('allow-remote-requests=yes and UDP 53 from the WAN is accepted, so anyone can use the router for DNS amplification.', 'allow-remote-requests=yes и UDP 53 из WAN принимается, значит любой может использовать маршрутизатор для DNS-амплификации.'), '/ip firewall filter add chain=input in-interface=' + wanIf(st) + ' protocol=udp dst-port=53 action=drop')
    const inputRules = st.lists['ip firewall filter'].filter((r) => on(r) && r.chain === 'input')
    if (inputRules.some((r) => r.action === 'drop') && !inputRules.some((r) => (r.action || 'accept') === 'accept' && /established/.test(r['connection-state'] || ''))) add('med', T('No "accept established,related" in input', 'Нет «accept established,related» в input'), T('Without it the router cannot get replies to its own DNS, NTP or update requests once you drop the rest.', 'Без него маршрутизатор не получит ответы на свои DNS, NTP и запросы обновлений, когда вы отбрасываете остальное.'), '/ip firewall filter add chain=input connection-state=established,related action=accept place-before=0')
    const lanNet = st.lists['ip address'].find((a) => on(a) && a.interface === lanIf(st))
    if (lanNet && evalChain(st, 'filter', 'forward', { src: WAN_PROBE, dst: lanNet.address.split('/')[0].replace(/\.\d+$/, '.2'), protocol: 'tcp', dstPort: '445', inIf: wanIf(st), outIf: lanIf(st), state: 'new' }).verdict === 'accept') add('med', T('New connections from the WAN can reach the LAN', 'Новые соединения из WAN доходят до LAN'), T('Forward accepts new WAN-to-LAN traffic. NAT hides the LAN in practice, but the MTCNA rule is to drop new connections from the WAN that are not dst-natted.', 'Forward принимает новый трафик из WAN в LAN. NAT на практике скрывает LAN, но правило MTCNA: отбрасывать новые соединения из WAN без dst-nat.'), '/ip firewall filter add chain=forward in-interface=' + wanIf(st) + ' connection-state=new connection-nat-state=!dstnat action=drop')
    if (!st.lists['ip firewall filter'].some((r) => on(r) && r.action === 'drop' && /invalid/.test(r['connection-state'] || ''))) add('low', T('Invalid packets are not dropped', 'Пакеты invalid не отбрасываются'), T('Dropping connection-state=invalid early is part of the stateful firewall template.', 'Ранний drop для connection-state=invalid входит в шаблон stateful firewall.'), '/ip firewall filter add chain=forward connection-state=invalid action=drop')
  }
  const admin = st.lists['user'].find((u) => u.name === 'admin' && on(u))
  if (admin && !admin.password) add('high', T('"admin" has no password', 'У «admin» нет пароля'), T('The default user with an empty password is the first thing scanners try. Create your own full user and disable admin, or at least set a password.', 'Пользователь по умолчанию с пустым паролем первым проверяется сканерами. Создайте своего пользователя full и отключите admin или хотя бы задайте пароль.'), '/user add name=netadmin group=full password=StrongPass123\n/user disable admin')
  const weak = st.services.filter((s) => on(s) && ['telnet', 'ftp', 'www', 'api'].includes(s.name)).map((s) => s.name)
  if (weak.length) add('med', T('Unencrypted services are enabled', 'Включены незашифрованные сервисы'), T(`${weak.join(', ')} send passwords in clear text. Keep winbox and ssh, disable the rest or limit them with address=.`, `${weak.join(', ')} передают пароли открытым текстом. Оставьте winbox и ssh, остальные отключите или ограничьте через address=.`), '/ip service disable ' + weak.join(','))
  const mac = st.singletons['tool mac-server'] || {}
  if ((mac['allowed-interface-list'] || 'all') === 'all') add('med', T('MAC server listens on all interfaces', 'MAC-сервер слушает все интерфейсы'), T('MAC Telnet and MAC Winbox should be reachable only from the LAN.', 'MAC Telnet и MAC Winbox должны быть доступны только из LAN.'), '/interface list add name=LAN\n/interface list member add list=LAN interface=' + lanIf(st) + '\n/tool mac-server set allowed-interface-list=LAN\n/tool mac-server mac-winbox set allowed-interface-list=LAN')
  const nd = st.singletons['ip neighbor discovery-settings'] || {}
  if ((nd['discover-interface-list'] || 'all') === 'all') add('low', T('Neighbor discovery on all interfaces', 'Neighbor discovery на всех интерфейсах'), T('The router announces itself (model, version) on the WAN side too.', 'Маршрутизатор рассылает о себе сведения (модель, версия) и в сторону WAN.'), '/ip neighbor discovery-settings set discover-interface-list=LAN')
  const id = (st.singletons['system identity'] || {}).name
  if (!id || id === 'MikroTik') add('low', T('Default identity', 'Имя по умолчанию'), T('Give every router a unique identity so you know where you are logged in.', 'Задайте каждому маршрутизатору уникальное имя, чтобы видеть, куда вы подключены.'), '/system identity set name=R1-Office')
  const ntp = st.singletons['system ntp client'] || {}
  if (online && !yes(ntp.enabled)) add('low', T('NTP client is off', 'NTP-клиент выключен'), T('Logs and certificates need correct time.', 'Для логов и сертификатов нужно точное время.'), '/system ntp client set enabled=yes servers=pool.ntp.org')
  const order = { high: 0, med: 1, low: 2 }
  return f.sort((a, b) => order[a.sev] - order[b.sev])
}

export function auditScore(findings) {
  return Math.max(0, 100 - findings.reduce((a, x) => a + (x.sev === 'high' ? 25 : x.sev === 'med' ? 10 : 4), 0))
}

// ---------- 3. troubleshooting lab generator ----------
const ruleBy = (st, path, pred) => st.lists[path].find(pred)
export const FAULTS = [
  { id: 'noroute', apply: (st) => { st.lists['ip route'] = st.lists['ip route'].filter((r) => r['dst-address'] !== '0.0.0.0/0') },
    hint: () => T('Can the router itself reach 8.8.8.8? Look at the routing table.', 'Может ли сам маршрутизатор достучаться до 8.8.8.8? Посмотрите таблицу маршрутов.'), diag: '/ip route print\n/ping 8.8.8.8 count=3',
    explain: () => T('The default route 0.0.0.0/0 via 22.1.1.1 was deleted.', 'Удалён маршрут по умолчанию 0.0.0.0/0 через 22.1.1.1.') },
  { id: 'nonat', apply: (st) => { const r = ruleBy(st, 'ip firewall nat', (x) => x.action === 'masquerade'); if (r) r.disabled = 'yes' },
    hint: () => T('The router pings 8.8.8.8, the laptop does not. What translates private addresses?', 'Маршрутизатор пингует 8.8.8.8, а ноутбук нет. Что транслирует частные адреса?'), diag: '/ip firewall nat print',
    explain: () => T('The masquerade rule was disabled (flag X in nat print).', 'Правило masquerade было отключено (флаг X в nat print).') },
  { id: 'dhcpgw', apply: (st) => { const n = st.lists['ip dhcp-server network'][0]; if (n) n.gateway = '192.168.33.254' },
    hint: () => T('The laptop gets an address, but which gateway does it get?', 'Ноутбук получает адрес, но какой шлюз он получает?'), diag: '/ip dhcp-server network print',
    explain: () => T('The DHCP network handed out gateway 192.168.33.254 instead of 192.168.33.1.', 'DHCP network выдавал шлюз 192.168.33.254 вместо 192.168.33.1.') },
  { id: 'fwdrop', apply: (st) => { st.lists['ip firewall filter'].push({ '.id': st.seq++, disabled: 'no', chain: 'forward', action: 'drop', 'src-address': '192.168.33.0/24', comment: 'temp' }) },
    hint: () => T('Routing and NAT look fine. Is something filtering forwarded traffic?', 'Маршрутизация и NAT в порядке. Что-то фильтрует транзитный трафик?'), diag: '/ip firewall filter print',
    explain: () => T('A forgotten "temp" rule dropped all forward traffic from 192.168.33.0/24.', 'Забытое правило «temp» отбрасывало весь forward-трафик из 192.168.33.0/24.') },
  { id: 'dnsremote', apply: (st) => { st.singletons['ip dns']['allow-remote-requests'] = 'no' },
    hint: () => T('Ping by IP works, names do not resolve. Who answers DNS for the laptop?', 'Пинг по IP работает, имена не разрешаются. Кто отвечает ноутбуку на DNS?'), diag: '/ip dns print',
    explain: () => T('allow-remote-requests was off, so the router ignored DNS queries from the LAN.', 'allow-remote-requests был выключен, и маршрутизатор игнорировал DNS-запросы из LAN.') },
  { id: 'dnsservers', apply: (st) => { st.singletons['ip dns'].servers = '' },
    hint: () => T('The router answers DNS, but can it resolve anything itself?', 'Маршрутизатор отвечает на DNS, но может ли он сам что-то разрешить?'), diag: '/ip dns print\n/ping mikrotik.com count=2',
    explain: () => T('The upstream DNS server list on the router was empty.', 'Список вышестоящих DNS-серверов на маршрутизаторе был пуст.') },
  { id: 'wanip', apply: (st) => { const a = ruleBy(st, 'ip address', (x) => x.interface === 'ether1'); if (a) { a.address = '22.1.2.33/24'; a.network = '22.1.2.0' } },
    hint: () => T('The default route exists, but is the gateway reachable from the WAN address?', 'Маршрут по умолчанию есть, но доступен ли шлюз с адреса WAN?'), diag: '/ip address print\n/ip route print',
    explain: () => T('ether1 had 22.1.2.33/24, so gateway 22.1.1.1 was outside the WAN subnet.', 'На ether1 был 22.1.2.33/24, и шлюз 22.1.1.1 оказался вне подсети WAN.') },
  { id: 'bport', apply: (st) => { const p = ruleBy(st, 'interface bridge port', (x) => x.interface === 'ether2'); if (p) p.disabled = 'yes' },
    hint: () => T('The laptop gets no address at all. Is its port part of bridgeLAN?', 'Ноутбук вообще не получает адрес. Его порт входит в bridgeLAN?'), diag: '/interface bridge port print',
    explain: () => T('The ether2 bridge port was disabled, so the laptop was outside bridgeLAN and its DHCP server.', 'Порт ether2 в бридже был отключён, и ноутбук оказался вне bridgeLAN и его DHCP-сервера.') },
  { id: 'dhcpoff', apply: (st) => { const s = st.lists['ip dhcp-server'][0]; if (s) s.disabled = 'yes' },
    hint: () => T('The laptop gets no address. Is the DHCP server running?', 'Ноутбук не получает адрес. DHCP-сервер работает?'), diag: '/ip dhcp-server print',
    explain: () => T('The DHCP server was disabled.', 'DHCP-сервер был отключён.') },
]

function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296 } }

// level 1 = one fault, 2 = two faults, 3 = three faults
export function makeTroubleshoot(seed, level = 1) {
  const r = rng(seed)
  const pool = [...FAULTS]
  const picked = []
  for (let k = 0; k < 40 && picked.length < level && pool.length; k++) {
    const f = pool.splice(Math.floor(r() * pool.length), 1)[0]
    const st = STARTS.onlineDhcp()
    for (const p of [...picked, f]) p.apply(st)
    // each added fault must still leave the laptop offline and be its own problem
    picked.push(f)
    if (laptopInternet(st).ok) picked.pop()
  }
  const st = STARTS.onlineDhcp()
  for (const f of picked) f.apply(st)
  return { st, faults: picked }
}
export function troubleshootSolved(st) {
  return laptopInternet(st).ok && st.lists['interface bridge'].some((b) => b.name === 'bridgeLAN' && on(b)) && !!lookup(st, '8.8.8.8')
}

// ---------- 4. adaptive study plan ----------
// data = store.data, counts[i] = lessons in MODULES[i]
export function moduleMastery(m, i, data, counts, LABS) {
  const n = counts[i] || 1
  const read = Object.keys(data.lessons).filter((k) => k.startsWith(m.id + ':')).length / n
  const quiz = (data.quiz[m.id] || 0) / 100
  const labs = m.labs.length ? m.labs.filter((l) => data.labs[l]).length / m.labs.length : null
  const ex = (data.examMods || {})[m.id]
  const exam = ex && ex.n ? ex.ok / ex.n : null
  const parts = [[read, 0.25], [quiz, 0.4], ...(labs === null ? [] : [[labs, 0.25]]), ...(exam === null ? [] : [[exam, 0.3]])]
  const w = parts.reduce((a, [, x]) => a + x, 0)
  return { read, quiz, labs, exam, score: Math.round((parts.reduce((a, [v, x]) => a + v * x, 0) / w) * 100) }
}

export function studyPlan(MODULES, LABS, data, counts) {
  const ms = MODULES.map((m, i) => ({ m, i, ...moduleMastery(m, i, data, counts, LABS) }))
  const steps = []
  const next = (x) => {
    const { m } = x
    const firstUnread = [...Array(counts[x.i]).keys()].find((k) => !data.lessons[m.id + ':' + k])
    if (x.read < 1 && firstUnread !== undefined) return { href: `#/module/${m.id}/lesson/${firstUnread}`, icon: '📖', text: T(`Read "${m.title}", lesson ${firstUnread + 1}`, `Прочитать «${m.title}», урок ${firstUnread + 1}`), why: T(`${Math.round(x.read * 100)}% of the module read`, `модуль прочитан на ${Math.round(x.read * 100)}%`) }
    if (x.quiz < 0.8) return { href: `#/module/${m.id}/quiz`, icon: '📝', text: T(`Take the "${m.title}" quiz`, `Пройти тест «${m.title}»`), why: data.quiz[m.id] !== undefined ? T(`best score ${data.quiz[m.id]}%, need 80%`, `лучший результат ${data.quiz[m.id]}%, нужно 80%`) : T('theory read, check yourself', 'теория прочитана, проверьте себя') }
    if (x.labs !== null && x.labs < 1) { const l = LABS.find((y) => m.labs.includes(y.id) && !data.labs[y.id]); return { href: `#/lab/${l.id}`, icon: '🧪', text: T(`Do the lab "${l.title}"`, `Выполнить лабу «${l.title}»`), why: T('theory and quiz are done, practise it', 'теория и тест пройдены, пора на практику') } }
    return null
  }
  // 1) the next action in the first module (course order) that is not finished
  const cur = ms.find((x) => next(x))
  if (cur) steps.push(next(cur))
  // 2) modules the last exam showed as weak
  for (const x of ms.filter((y) => y.exam !== null && y.exam < 0.6 && y !== cur).sort((a, b) => a.exam - b.exam).slice(0, 2)) steps.push({ href: `#/module/${x.m.id}/quiz`, icon: '🔁', text: T(`Revise "${x.m.title}"`, `Повторить «${x.m.title}»`), why: T(`${Math.round(x.exam * 100)}% right on the last exam`, `на последнем экзамене верно ${Math.round(x.exam * 100)}%`) })
  // 3) a started module that still needs its quiz or lab
  const started = ms.find((x) => x !== cur && (x.read > 0 || x.quiz > 0) && next(x) && !steps.some((st) => st.href.includes('/' + x.m.id + '/')))
  if (steps.length < 3 && started) steps.push(next(started))
  if (steps.length < 3) steps.push(Object.keys(data.labs).length
    ? { href: '#/troubleshoot', icon: '🛠️', text: T('Fix a generated broken network', 'Починить сгенерированную сломанную сеть'), why: T('troubleshooting is what the exam and real work test', 'именно поиск неисправностей проверяют экзамен и реальная работа') }
    : { href: '#/terminal', icon: '⌨️', text: T('Try the RouterOS terminal', 'Попробовать терминал RouterOS'), why: T('the tutor explains every error you make', 'тьютор объясняет каждую ошибку') })
  if (steps.length < 3 && !cur) steps.push({ href: '#/exam', icon: '🎓', text: T('Take the final exam', 'Сдать финальный экзамен'), why: T('every module is finished', 'все модули пройдены') })
  const weakest = ms.filter((x) => x.read > 0 || x.quiz > 0).sort((a, b) => a.score - b.score)[0]
  return { steps, mastery: ms, weakest }
}

// ---------- 5. exam readiness ----------
export function readiness(MODULES, LABS, data, counts) {
  const ms = MODULES.map((m, i) => moduleMastery(m, i, data, counts, LABS))
  const quiz = MODULES.reduce((a, m) => a + (data.quiz[m.id] || 0), 0) / MODULES.length
  const labs = (LABS.filter((l) => data.labs[l.id]).length / LABS.length) * 100
  const read = (Object.keys(data.lessons).length / counts.reduce((a, b) => a + b, 0)) * 100
  const last = data.exams.slice(-3).map((e) => e.score)
  const exam = last.length ? last.reduce((a, b) => a + b, 0) / last.length : null
  const parts = [[quiz, 0.4], [labs, 0.2], [read, 0.15], ...(exam === null ? [] : [[exam, 0.45]])]
  const w = parts.reduce((a, [, x]) => a + x, 0)
  const score = Math.round(parts.reduce((a, [v, x]) => a + v * x, 0) / w)
  const weak = MODULES.map((m, i) => ({ m, s: ms[i].score })).filter((x) => x.s < 70).sort((a, b) => a.s - b.s).slice(0, 3)
  const verdict = score >= 85 ? T('Ready: book the real exam.', 'Готовы: можно записываться на настоящий экзамен.') : score >= 65 ? T('Almost there: close the weak modules and take a practice exam.', 'Почти готовы: подтяните слабые модули и сдайте пробный экзамен.') : T('Not yet: keep working through the modules and quizzes.', 'Пока рано: продолжайте модули и тесты.')
  return { score, verdict, weak, parts: { quiz: Math.round(quiz), labs: Math.round(labs), read: Math.round(read), exam: exam === null ? null : Math.round(exam) } }
}

// ---------- 6. tutor chat ----------
const TOPICS = [
  [/firewall|filter|фаервол|файрвол|брандмауэр|input|forward/i, () => T('Filter chains: input (to the router), forward (through it), output (from it). Rules are checked top to bottom and the first match wins. Template: accept established,related, drop invalid, accept ICMP, then drop everything not from the LAN.', 'Цепочки filter: input (к маршрутизатору), forward (через него), output (от него). Правила проверяются сверху вниз, срабатывает первое совпадение. Шаблон: accept established,related, drop invalid, accept ICMP, затем drop всего не из LAN.'), '/ip firewall filter print'],
  [/nat|masquerade|маскарад|проброс|port.?forward|dst-nat/i, () => T('srcnat masquerade replaces the private source address with the WAN address. dstnat (dst-nat) forwards a WAN port to a LAN host. NAT rules see only the first packet of a connection.', 'srcnat masquerade заменяет частный адрес источника на адрес WAN. dstnat (dst-nat) пробрасывает порт WAN на хост в LAN. Правила NAT видят только первый пакет соединения.'), '/ip firewall nat print'],
  [/dhcp/i, () => T('A DHCP server needs an interface with an IP address, a pool and a network entry with gateway and dns-server. /ip dhcp-server setup does all of it.', 'DHCP-серверу нужны интерфейс с IP-адресом, пул и запись network с gateway и dns-server. Всё это делает /ip dhcp-server setup.'), '/ip dhcp-server print\n/ip dhcp-server network print'],
  [/dns|имен|резолв/i, () => T('Clients that use the router as DNS need allow-remote-requests=yes and upstream servers. Block UDP/TCP 53 from the WAN so it is not an open resolver.', 'Клиентам, использующим маршрутизатор как DNS, нужны allow-remote-requests=yes и вышестоящие серверы. Закройте UDP/TCP 53 со стороны WAN, чтобы не быть открытым резолвером.'), '/ip dns print'],
  [/route|маршрут|gateway|шлюз|ospf/i, () => T('The most specific route wins, then the lowest distance. A default route is dst-address=0.0.0.0/0 with the ISP gateway.', 'Выигрывает самый специфичный маршрут, затем меньший distance. Маршрут по умолчанию это dst-address=0.0.0.0/0 со шлюзом провайдера.'), '/ip route print'],
  [/bridge|бридж|мост|switch|vlan/i, () => T('A bridge joins ports into one L2 segment; put the IP address on the bridge, not on its ports.', 'Бридж объединяет порты в один L2-сегмент; IP-адрес вешается на бридж, а не на порты.'), '/interface bridge port print'],
  [/wireless|wifi|wlan|wi-fi|беспровод|ssid/i, () => T('An access point is mode=ap-bridge with an SSID and a security profile (WPA2 PSK). Access list and connect list control who may connect.', 'Точка доступа это mode=ap-bridge с SSID и security profile (WPA2 PSK). Access list и connect list управляют подключениями.'), '/interface wireless print'],
  [/queue|очеред|скорост|pcq|limit/i, () => T('Simple queues limit by target address; max-limit is upload/download. PCQ shares a limit equally between users.', 'Simple queues ограничивают по адресу target; max-limit задаётся как upload/download. PCQ делит лимит поровну между пользователями.'), '/queue simple print'],
  [/pppoe|ppp|pptp|sstp|vpn|туннел/i, () => T('A PPP server needs a profile (local/remote address), secrets for users, and the server bound to an interface.', 'PPP-серверу нужны профиль (local/remote address), secrets пользователей и сервер, привязанный к интерфейсу.'), '/ppp secret print\n/ppp active print'],
  [/user|password|парол|пользоват|admin/i, () => T('Create your own user in group full, then disable admin. Services and users can be limited by address=.', 'Создайте своего пользователя в группе full и отключите admin. Сервисы и пользователей можно ограничить через address=.'), '/user print'],
]

export function localAnswer(question, st) {
  const out = []
  const q = String(question || '')
  const tp = TOPICS.find(([re]) => re.test(q))
  if (tp) out.push(tp[1](), T('Check with:', 'Проверьте:') + '\n' + tp[2])
  if (st) {
    const inet = laptopInternet(st)
    if (/интернет|internet|ping|не работ|not work|why|почему|broken|слом/i.test(q) || !tp) {
      if (!inet.ok) { const fx = reasonFix(inet.reason); out.push(T('Your laptop has no Internet right now. ', 'Сейчас у ноутбука нет Интернета. ') + (fx ? fx.text + '\n' + fx.cmd : inet.reason)) }
      else out.push(T('The laptop is online right now.', 'Сейчас ноутбук в сети.'))
    }
    if (!tp) { const a = auditConfig(st).filter((x) => x.sev !== 'low' && x.cat !== 'inet').slice(0, 2); if (a.length) out.push(T('Top audit findings: ', 'Главное по аудиту: ') + a.map((x) => x.title).join('; ') + '.') }
  }
  if (!out.length) out.push(T('Ask about a topic (firewall, NAT, DHCP, DNS, routing, bridge, wireless, queues, PPP) or about your current configuration.', 'Спросите о теме (firewall, NAT, DHCP, DNS, маршрутизация, бридж, Wi-Fi, очереди, PPP) или о текущей конфигурации.'))
  return out.join('\n\n')
}

export function exportConfig(st) {
  try { return new RouterOS(structuredClone(st)).exec('/export') || '' } catch { return '' }
}

// Ask the Claude tutor through /api/tutor; falls back to the built-in answer.
export async function askTutor(question, { st, lab, lastError } = {}) {
  const ctx = {
    question: String(question).slice(0, 1000), lang: LANG,
    config: st ? exportConfig(st).slice(0, 8000) : '',
    laptop: st ? (() => { const L = laptopState(st), i = laptopInternet(st); return { ip: L.ip, gw: L.gw, dns: L.dns, internet: i.ok, reason: i.reason || '' } })() : null,
    lab: lab ? { title: lab.title, tasks: lab.tasks.map((t, k) => ({ t: t.t, done: !!lab.done?.[k] })) } : null,
    lastError: lastError || '',
  }
  try {
    const ctrl = new AbortController()
    const to = setTimeout(() => ctrl.abort(), 45000)
    const r = await fetch('/api/tutor', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ctx), signal: ctrl.signal })
    clearTimeout(to)
    if (r.ok) {
      const j = await r.json()
      if (j.text) return { source: 'claude', text: j.text }
      if (j.refusal) return { source: 'local', text: T('The AI tutor could not answer this one. ', 'ИИ-тьютор не смог ответить на этот вопрос. ') + '\n\n' + localAnswer(question, st) }
    }
  } catch {}
  return { source: 'local', text: localAnswer(question, st) }
}
