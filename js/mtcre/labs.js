// MTCRE guided labs. Unlike the MTCNA and MTCSE labs, every MTCRE lab is a small network of
// simulated routers (js/mtcre/network.js): the student gets one terminal per router, the topology
// and a live reachability panel. Task checks receive the whole network, so they test behaviour
// (does PC1 reach PC3, which path does the traffic take, what happens when a link fails) rather
// than only the presence of commands.

import { T } from '../i18n.js'
import { makeNet, hasRoute, ospfFull } from './network.js'

const on = (x) => !!x && x.disabled !== 'yes'
const L = (net, rn, p) => net.routers[rn].lists[p] || []
const reach = (net, from, ip) => { try { return net.reach(from, ip).ok } catch { return false } }
const pathHas = (net, from, ip, hop) => { try { const r = net.reach(from, ip); return r.ok && r.path.includes(hop) } catch { return false } }
const viaTunnel = (net, from, ip) => { try { const r = net.reach(from, ip); return r.ok && !!r.viaTunnel } catch { return false } }
const routes = (net, rn) => net.routes(net.routers[rn])
const sel = (net, rn, dst, proto) => routes(net, rn).find((r) => r.dst === dst && r.selected && (!proto || r.proto === proto))
const staticTo = (net, rn, dst) => L(net, rn, 'ip route').filter((r) => on(r) && (r['dst-address'] || '0.0.0.0/0') === dst)
const running = (net, rn, ifn) => net.isRunning(net.routers[rn], ifn)
// run a check with a link in another state, then put it back
export function withLink(net, i, state, fn) {
  const old = net.links[i].state
  net.setLink(i, state)
  try { return fn() } finally { net.setLink(i, old) }
}

// ---------- topologies ----------
const ip = (a, i) => `/ip address add address=${a} interface=${i}`
const TRI_ADDR = {
  R1: [ip('10.0.12.1/30', 'ether1'), ip('10.0.13.1/30', 'ether2'), ip('192.168.1.1/24', 'ether5')],
  R2: [ip('10.0.12.2/30', 'ether1'), ip('10.0.23.1/30', 'ether2'), ip('192.168.2.1/24', 'ether5')],
  R3: [ip('10.0.13.2/30', 'ether1'), ip('10.0.23.2/30', 'ether2'), ip('192.168.3.1/24', 'ether5')],
}
const LOOP = { R1: [ip('10.255.255.1/32', 'lo')], R2: [ip('10.255.255.2/32', 'lo')], R3: [ip('10.255.255.3/32', 'lo')] }
const TRI_HOSTS = [
  { name: 'PC1', ip: '192.168.1.10/24', gw: '192.168.1.1', at: 'R1:ether5', x: 50, y: 60 },
  { name: 'PC2', ip: '192.168.2.10/24', gw: '192.168.2.1', at: 'R2:ether5', x: 590, y: 60 },
  { name: 'PC3', ip: '192.168.3.10/24', gw: '192.168.3.1', at: 'R3:ether5', x: 320, y: 300 },
]
const TRI_LINKS = [{ a: 'R1:ether1', b: 'R2:ether1' }, { a: 'R1:ether2', b: 'R3:ether1' }, { a: 'R2:ether2', b: 'R3:ether2' }]
export function triangle(extra = {}, loop = false) {
  const cmds = (n) => [...TRI_ADDR[n], ...(loop ? LOOP[n] : []), ...(extra[n] || [])]
  return {
    h: 340,
    routers: [{ name: 'R1', x: 190, y: 60, cmds: cmds('R1') }, { name: 'R2', x: 450, y: 60, cmds: cmds('R2') }, { name: 'R3', x: 320, y: 200, cmds: cmds('R3') }],
    links: TRI_LINKS.map((l) => ({ ...l })),
    hosts: TRI_HOSTS.map((h) => ({ ...h })),
  }
}

// R1 has two uplinks (ISP1, ISP2); both ISPs reach the "Internet" core NET with three hosts.
// The ISPs use strict reverse-path filtering, like a well-run provider.
const ISP_HOSTS = [
  { name: 'PC1', ip: '192.168.1.10/24', gw: '192.168.1.1', at: 'R1:ether5', x: 50, y: 70 },
  { name: 'PC2', ip: '192.168.1.20/24', gw: '192.168.1.1', at: 'R1:ether5', x: 50, y: 210 },
  { name: 'DNS-A', ip: '8.8.8.8/24', gw: '8.8.8.1', at: 'NET:ether3', x: 600, y: 40 },
  { name: 'DNS-B', ip: '1.1.1.1/24', gw: '1.1.1.2', at: 'NET:ether4', x: 600, y: 140 },
  { name: 'WEB', ip: '93.184.216.34/24', gw: '93.184.216.1', at: 'NET:ether5', x: 600, y: 240 },
]
export function dualIsp(r1 = []) {
  return {
    h: 280,
    routers: [
      { name: 'R1', x: 170, y: 140, cmds: [ip('172.16.1.2/30', 'ether1'), ip('172.16.2.2/30', 'ether2'), ip('192.168.1.1/24', 'ether5'),
        '/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade', '/ip firewall nat add chain=srcnat out-interface=ether2 action=masquerade', ...r1] },
      { name: 'ISP1', x: 330, y: 60, locked: true, cmds: [ip('172.16.1.1/30', 'ether1'), ip('100.64.1.1/30', 'ether2'), '/ip route add gateway=100.64.1.2', '/ip settings set rp-filter=strict'] },
      { name: 'ISP2', x: 330, y: 220, locked: true, cmds: [ip('172.16.2.1/30', 'ether1'), ip('100.64.2.1/30', 'ether2'), '/ip route add gateway=100.64.2.2', '/ip settings set rp-filter=strict'] },
      { name: 'NET', x: 470, y: 140, locked: true, cmds: [ip('100.64.1.2/30', 'ether1'), ip('100.64.2.2/30', 'ether2'), ip('8.8.8.1/24', 'ether3'), ip('1.1.1.2/24', 'ether4'), ip('93.184.216.1/24', 'ether5'),
        '/ip route add dst-address=172.16.1.0/30 gateway=100.64.1.1', '/ip route add dst-address=172.16.2.0/30 gateway=100.64.2.1'] },
    ],
    links: [{ a: 'R1:ether1', b: 'ISP1:ether1' }, { a: 'R1:ether2', b: 'ISP2:ether1' }, { a: 'ISP1:ether2', b: 'NET:ether1' }, { a: 'ISP2:ether2', b: 'NET:ether2' }],
    hosts: ISP_HOSTS.map((h) => ({ ...h })),
  }
}

// Two sites connected over the Internet (router NET): the tunnel labs
export function twoSites(hq = [], br = [], brHost = '192.168.20.10/24', brGw = '192.168.20.1') {
  return {
    h: 220,
    routers: [
      { name: 'HQ', x: 170, y: 100, cmds: [ip('22.1.1.2/30', 'ether1'), '/ip route add gateway=22.1.1.1', ...hq] },
      { name: 'NET', x: 320, y: 100, locked: true, cmds: [ip('22.1.1.1/30', 'ether1'), ip('33.1.1.1/30', 'ether2')] },
      { name: 'BR', x: 470, y: 100, cmds: [ip('33.1.1.2/30', 'ether1'), '/ip route add gateway=33.1.1.1', ...br] },
    ],
    links: [{ a: 'HQ:ether1', b: 'NET:ether1' }, { a: 'NET:ether2', b: 'BR:ether1' }],
    hosts: [{ name: 'PC-HQ', ip: '192.168.10.10/24', gw: '192.168.10.1', at: 'HQ:ether5', x: 50, y: 180 }, { name: 'PC-BR', ip: brHost, gw: brGw, at: 'BR:ether5', x: 590, y: 180 }],
  }
}

// ---------- labs ----------
export const RE_LABS = [
  {
    id: 're-static', module: 're-basics', start: 'tri',
    title: T('Static routes in a triangle', 'Статические маршруты в треугольнике'),
    intro: T('Three routers with their own LANs are cabled in a triangle. The addresses are set, but no router knows the other LANs yet. Add static routes so that every PC reaches every other PC, and remember that the reply needs a route too.', 'Три маршрутизатора со своими LAN соединены треугольником. Адреса настроены, но ни один маршрутизатор пока не знает чужие LAN. Добавьте статические маршруты, чтобы каждый ПК достигал каждого, и помните, что ответу тоже нужен маршрут.'),
    net: () => triangle(),
    probes: [['PC1', '192.168.3.10'], ['PC1', '192.168.2.10'], ['PC2', '192.168.3.10']],
    tasks: [
      { t: T('R1: route to 192.168.3.0/24 through R3 (10.0.13.2)', 'R1: маршрут к 192.168.3.0/24 через R3 (10.0.13.2)'), c: (n) => !!sel(n, 'R1', '192.168.3.0/24', 's') && sel(n, 'R1', '192.168.3.0/24', 's').nh.some((h) => h.gw === '10.0.13.2'), h: '[R1] /ip route add dst-address=192.168.3.0/24 gateway=10.0.13.2' },
      { t: T('PC1 reaches PC3 (R3 needs the way back to 192.168.1.0/24)', 'PC1 достигает PC3 (R3 нужен обратный путь к 192.168.1.0/24)'), c: (n) => reach(n, 'PC1', '192.168.3.10'), h: '[R3] /ip route add dst-address=192.168.1.0/24 gateway=10.0.13.1' },
      { t: T('PC1 reaches PC2', 'PC1 достигает PC2'), c: (n) => reach(n, 'PC1', '192.168.2.10'), h: '[R1] /ip route add dst-address=192.168.2.0/24 gateway=10.0.12.2\n[R2] /ip route add dst-address=192.168.1.0/24 gateway=10.0.12.1' },
      { t: T('PC2 reaches PC3', 'PC2 достигает PC3'), c: (n) => reach(n, 'PC2', '192.168.3.10'), h: '[R2] /ip route add dst-address=192.168.3.0/24 gateway=10.0.23.2\n[R3] /ip route add dst-address=192.168.2.0/24 gateway=10.0.23.1' },
      { t: T('Check with traceroute: from R1, the path to 192.168.3.10 has exactly 2 hops', 'Проверьте traceroute: с R1 путь до 192.168.3.10 занимает ровно 2 хопа'), c: (n) => { const r = n.reach('R1', '192.168.3.10'); return r.ok && r.hops === 1 }, h: '[R1] /tool traceroute 192.168.3.10\n(10.0.13.2 is hop 1, the PC answers as hop 2)' },
    ],
  },
  {
    id: 're-failover', module: 're-static', start: 'tri', linkCtl: true,
    title: T('Failover with distance and check-gateway', 'Резервирование: distance и check-gateway'),
    intro: T('R1 and R3 are cabled directly, but the cable runs through an unmanaged switch: if the far side dies, the port stays up. Make the direct link the primary path between LAN1 and LAN3, the path through R2 the backup, and let check-gateway notice the silent failure. R2 already has routes to both LANs. Finish with ECMP towards LAN2.', 'R1 и R3 соединены напрямую, но кабель идёт через неуправляемый коммутатор: если дальняя сторона умрёт, порт останется поднятым. Сделайте прямой канал основным путём между LAN1 и LAN3, путь через R2 резервным, и пусть check-gateway заметит тихий отказ. На R2 уже есть маршруты к обеим LAN. В конце настройте ECMP к LAN2.'),
    net: () => triangle({ R2: ['/ip route add dst-address=192.168.1.0/24 gateway=10.0.12.1', '/ip route add dst-address=192.168.3.0/24 gateway=10.0.23.2'] }),
    probes: [['PC1', '192.168.3.10'], ['PC3', '192.168.1.10'], ['PC1', '192.168.2.10']],
    tasks: [
      { t: T('Primary routes over the direct link on R1 and R3, with check-gateway=ping; PC1 reaches PC3 directly', 'Основные маршруты по прямому каналу на R1 и R3 с check-gateway=ping; PC1 достигает PC3 напрямую'), c: (n) => staticTo(n, 'R1', '192.168.3.0/24').some((r) => r.gateway === '10.0.13.2' && r['check-gateway'] === 'ping') && staticTo(n, 'R3', '192.168.1.0/24').some((r) => r.gateway === '10.0.13.1' && r['check-gateway'] === 'ping') && pathHas(n, 'PC1', '192.168.3.10', '10.0.13.2'), h: '[R1] /ip route add dst-address=192.168.3.0/24 gateway=10.0.13.2 check-gateway=ping\n[R3] /ip route add dst-address=192.168.1.0/24 gateway=10.0.13.1 check-gateway=ping' },
      { t: T('Backup routes through R2 with distance=2 on R1 and R3 (they stay inactive while the primary works)', 'Резервные маршруты через R2 с distance=2 на R1 и R3 (неактивны, пока работает основной)'), c: (n) => staticTo(n, 'R1', '192.168.3.0/24').some((r) => r.gateway === '10.0.12.2' && Number(r.distance) > 1) && staticTo(n, 'R3', '192.168.1.0/24').some((r) => r.gateway === '10.0.23.1' && Number(r.distance) > 1), h: '[R1] /ip route add dst-address=192.168.3.0/24 gateway=10.0.12.2 distance=2\n[R3] /ip route add dst-address=192.168.1.0/24 gateway=10.0.23.1 distance=2' },
      { t: T('The R1–R3 link fails silently (port up, no traffic): PC1 still reaches PC3 through R2', 'Канал R1–R3 тихо отказывает (порт поднят, трафика нет): PC1 всё равно достигает PC3 через R2'), c: (n) => withLink(n, 1, 'silent', () => pathHas(n, 'PC1', '192.168.3.10', '10.0.12.2')), h: 'Set the R1–R3 link to "silent" in the Links panel and look at /ip route print on R1:\nthe primary route stays in the table but is no longer active.' },
      { t: T('ECMP: R1 reaches 192.168.2.0/24 over two gateways at once (10.0.12.2 and 10.0.13.2) and PC1 reaches PC2', 'ECMP: R1 достигает 192.168.2.0/24 сразу через два шлюза (10.0.12.2 и 10.0.13.2), PC1 достигает PC2'), c: (n) => { const r = sel(n, 'R1', '192.168.2.0/24', 's'); return !!r && r.ecmp && r.nh.length >= 2 && reach(n, 'PC1', '192.168.2.10') }, h: '[R3] /ip route add dst-address=192.168.2.0/24 gateway=10.0.23.1\n[R1] /ip route add dst-address=192.168.2.0/24 gateway=10.0.12.2,10.0.13.2' },
    ],
  },
  {
    id: 're-recursive', module: 're-static', start: 'isp', linkCtl: true,
    title: T('Recursive routes: watch a host behind the ISP', 'Рекурсивные маршруты: следим за хостом за провайдером'),
    intro: T('R1 has two ISPs. check-gateway on the ISP gateway only tells you that the ISP router answers, not that the Internet behind it works. Pin 8.8.8.8 to ISP1 and 1.1.1.1 to ISP2 with host routes, then make both default routes recursive through these hosts with check-gateway, so R1 fails over when ISP1 loses its uplink.', 'У R1 два провайдера. check-gateway на шлюзе провайдера говорит только о том, что отвечает маршрутизатор провайдера, но не о том, работает ли Интернет за ним. Привяжите 8.8.8.8 к ISP1 и 1.1.1.1 к ISP2 хост-маршрутами, затем сделайте оба маршрута по умолчанию рекурсивными через эти хосты с check-gateway, чтобы R1 переключался, когда ISP1 теряет свой канал.'),
    net: () => dualIsp(),
    probes: [['PC1', '93.184.216.34'], ['R1', '8.8.8.8'], ['R1', '1.1.1.1']],
    tasks: [
      { t: T('Host routes: 8.8.8.8/32 via 172.16.1.1 and 1.1.1.1/32 via 172.16.2.1, both with scope=10', 'Хост-маршруты: 8.8.8.8/32 через 172.16.1.1 и 1.1.1.1/32 через 172.16.2.1, оба со scope=10'), c: (n) => staticTo(n, 'R1', '8.8.8.8/32').some((r) => r.gateway === '172.16.1.1' && String(r.scope) === '10') && staticTo(n, 'R1', '1.1.1.1/32').some((r) => r.gateway === '172.16.2.1' && String(r.scope) === '10'), h: '[R1] /ip route add dst-address=8.8.8.8/32 gateway=172.16.1.1 scope=10\n[R1] /ip route add dst-address=1.1.1.1/32 gateway=172.16.2.1 scope=10' },
      { t: T('Primary default route through gateway 8.8.8.8 (target-scope=11, check-gateway=ping) is active', 'Основной маршрут по умолчанию через шлюз 8.8.8.8 (target-scope=11, check-gateway=ping) активен'), c: (n) => { const r = sel(n, 'R1', '0.0.0.0/0', 's'); return staticTo(n, 'R1', '0.0.0.0/0').some((x) => x.gateway === '8.8.8.8' && x['check-gateway'] === 'ping') && !!r && r.item.gateway === '8.8.8.8' }, h: '[R1] /ip route add dst-address=0.0.0.0/0 gateway=8.8.8.8 target-scope=11 check-gateway=ping' },
      { t: T('Backup default route through 1.1.1.1 with distance=2, target-scope=11 and check-gateway=ping', 'Резервный маршрут по умолчанию через 1.1.1.1 с distance=2, target-scope=11 и check-gateway=ping'), c: (n) => staticTo(n, 'R1', '0.0.0.0/0').some((x) => x.gateway === '1.1.1.1' && Number(x.distance) >= 2 && x['check-gateway'] === 'ping'), h: '[R1] /ip route add dst-address=0.0.0.0/0 gateway=1.1.1.1 target-scope=11 distance=2 check-gateway=ping' },
      { t: T('PC1 reaches WEB through ISP1', 'PC1 достигает WEB через ISP1'), c: (n) => pathHas(n, 'PC1', '93.184.216.34', '172.16.1.1'), h: '[R1] /tool traceroute 93.184.216.34 src-address=192.168.1.1' },
      { t: T('ISP1 loses its uplink (ISP1–NET down): PC1 still reaches WEB, now through ISP2', 'ISP1 теряет свой канал (ISP1–NET отключён): PC1 всё равно достигает WEB, теперь через ISP2'), c: (n) => withLink(n, 2, 'down', () => pathHas(n, 'PC1', '93.184.216.34', '172.16.2.1')), h: 'Turn the ISP1–NET link down in the Links panel. 8.8.8.8 stops answering, the route through it\nbecomes inactive and the distance=2 route through 1.1.1.1 takes over.' },
    ],
  },
  {
    id: 're-pbr', module: 're-pbr', start: 'isp', linkCtl: true,
    title: T('Policy routing with two ISPs', 'Маршрутизация по политикам с двумя провайдерами'),
    intro: T('R1 uses ISP1 for everything. The accountant PC2 (192.168.1.20) must go out through ISP2, and connections that arrive on the ISP2 address must be answered through ISP2: the ISPs drop packets with a source address that is not theirs (strict rp-filter).', 'R1 отправляет всё через ISP1. ПК бухгалтера PC2 (192.168.1.20) должен выходить через ISP2, а соединения, пришедшие на адрес ISP2, должны получать ответ через ISP2: провайдеры отбрасывают пакеты с чужим адресом источника (строгий rp-filter).'),
    net: () => dualIsp(['/ip route add gateway=172.16.1.1']),
    probes: [['PC1', '93.184.216.34'], ['PC2', '93.184.216.34'], ['WEB', '172.16.2.2']],
    tasks: [
      { t: T('Routing table to-isp2 with a default route through 172.16.2.1', 'Таблица маршрутизации to-isp2 с маршрутом по умолчанию через 172.16.2.1'), c: (n) => !!sel(n, 'R1', '0.0.0.0/0') && routes(n, 'R1').some((r) => r.table === 'to-isp2' && r.dst === '0.0.0.0/0' && r.selected && r.nh.some((h) => h.gw === '172.16.2.1')), h: '[R1] /routing table add name=to-isp2 fib\n[R1] /ip route add gateway=172.16.2.1 routing-table=to-isp2' },
      { t: T('PC2 goes to the Internet through ISP2, PC1 still through ISP1', 'PC2 выходит в Интернет через ISP2, PC1 по-прежнему через ISP1'), c: (n) => pathHas(n, 'PC2', '93.184.216.34', '172.16.2.1') && pathHas(n, 'PC1', '93.184.216.34', '172.16.1.1'), h: '[R1] /routing rule add src-address=192.168.1.20/32 action=lookup table=to-isp2\nor with mangle:\n[R1] /ip firewall mangle add chain=prerouting src-address=192.168.1.20 dst-address-type=!local action=mark-routing new-routing-mark=to-isp2' },
      { t: T('WEB can ping R1 on its ISP2 address 172.16.2.2 (the reply leaves through ISP2)', 'WEB пингует R1 по адресу ISP2 172.16.2.2 (ответ уходит через ISP2)'), c: (n) => reach(n, 'WEB', '172.16.2.2'), h: '[R1] /routing rule add src-address=172.16.2.2/32 action=lookup table=to-isp2' },
      { t: T('If the cable to ISP2 is cut, PC2 falls back to ISP1 (use action=lookup, not lookup-only-in-table)', 'Если кабель к ISP2 перерезан, PC2 переходит на ISP1 (action=lookup, а не lookup-only-in-table)'), c: (n) => pathHas(n, 'PC2', '93.184.216.34', '172.16.2.1') && withLink(n, 1, 'down', () => pathHas(n, 'PC2', '93.184.216.34', '172.16.1.1')), h: 'With action=lookup an inactive table falls through to main.\n[R1] /routing rule print\n[R1] /routing rule set 0 action=lookup' },
    ],
  },
  {
    id: 're-vlan', module: 're-tunnels', start: 'pair',
    title: T('VLANs and point-to-point addresses', 'VLAN и адресация точка-точка'),
    intro: T('R1 and R2 share one cable (ether1) that carries tagged VLANs. Use VLAN 10 as the transit for the LANs and VLAN 99 for management with /32 point-to-point addresses.', 'R1 и R2 соединены одним кабелем (ether1), по которому идут тегированные VLAN. Используйте VLAN 10 как транзит для LAN и VLAN 99 для управления с адресами /32 точка-точка.'),
    net: () => ({
      h: 200,
      routers: [{ name: 'R1', x: 220, y: 90, cmds: [ip('192.168.1.1/24', 'ether5')] }, { name: 'R2', x: 420, y: 90, cmds: [ip('192.168.2.1/24', 'ether5')] }],
      links: [{ a: 'R1:ether1', b: 'R2:ether1' }],
      hosts: [{ name: 'PC1', ip: '192.168.1.10/24', gw: '192.168.1.1', at: 'R1:ether5', x: 70, y: 160 }, { name: 'PC2', ip: '192.168.2.10/24', gw: '192.168.2.1', at: 'R2:ether5', x: 570, y: 160 }],
    }),
    probes: [['R1', '10.10.10.2'], ['PC1', '192.168.2.10'], ['R1', '10.99.99.2']],
    tasks: [
      { t: T('vlan10 (vlan-id=10 on ether1) on both routers, 10.10.10.1/30 and 10.10.10.2/30; R1 pings R2', 'vlan10 (vlan-id=10 на ether1) на обоих маршрутизаторах, 10.10.10.1/30 и 10.10.10.2/30; R1 пингует R2'), c: (n) => L(n, 'R1', 'interface vlan').some((v) => String(v['vlan-id']) === '10') && reach(n, 'R1', '10.10.10.2'), h: '[R1] /interface vlan add name=vlan10 vlan-id=10 interface=ether1\n[R1] /ip address add address=10.10.10.1/30 interface=vlan10\n[R2] /interface vlan add name=vlan10 vlan-id=10 interface=ether1\n[R2] /ip address add address=10.10.10.2/30 interface=vlan10' },
      { t: T('Static routes over VLAN 10: PC1 reaches PC2', 'Статические маршруты через VLAN 10: PC1 достигает PC2'), c: (n) => reach(n, 'PC1', '192.168.2.10'), h: '[R1] /ip route add dst-address=192.168.2.0/24 gateway=10.10.10.2\n[R2] /ip route add dst-address=192.168.1.0/24 gateway=10.10.10.1' },
      { t: T('vlan99 with point-to-point addressing: R1 10.99.99.1/32 network=10.99.99.2, R2 the other way round; R1 pings 10.99.99.2', 'vlan99 с адресацией точка-точка: R1 10.99.99.1/32 network=10.99.99.2, R2 наоборот; R1 пингует 10.99.99.2'), c: (n) => L(n, 'R1', 'ip address').some((a) => on(a) && a.address === '10.99.99.1/32' && a.network === '10.99.99.2') && reach(n, 'R1', '10.99.99.2'), h: '[R1] /interface vlan add name=vlan99 vlan-id=99 interface=ether1\n[R1] /ip address add address=10.99.99.1/32 network=10.99.99.2 interface=vlan99\n[R2] /interface vlan add name=vlan99 vlan-id=99 interface=ether1\n[R2] /ip address add address=10.99.99.2/32 network=10.99.99.1 interface=vlan99' },
    ],
  },
  {
    id: 're-gre', module: 're-tunnels', start: 'sites',
    title: T('GRE tunnel between two sites', 'GRE-туннель между двумя офисами'),
    intro: T('HQ and the branch BR are online through NET, which knows nothing about the private LANs 192.168.10.0/24 and 192.168.20.0/24. Build a GRE tunnel with keepalive and route the LANs through it.', 'HQ и филиал BR подключены к Интернету через NET, который ничего не знает о частных LAN 192.168.10.0/24 и 192.168.20.0/24. Постройте GRE-туннель с keepalive и направьте LAN через него.'),
    net: () => twoSites([ip('192.168.10.1/24', 'ether5')], [ip('192.168.20.1/24', 'ether5')]),
    probes: [['HQ', '33.1.1.2'], ['HQ', '172.16.0.2'], ['PC-HQ', '192.168.20.10']],
    tasks: [
      { t: T('GRE interfaces on HQ and BR pointing at each other (keepalive on) and running', 'GRE-интерфейсы на HQ и BR указывают друг на друга (keepalive включён) и в состоянии running'), c: (n) => L(n, 'HQ', 'interface gre').some((t) => on(t) && t.keepalive && running(n, 'HQ', t.name)) && L(n, 'BR', 'interface gre').some((t) => on(t) && t.keepalive && running(n, 'BR', t.name)), h: '[HQ] /interface gre add name=gre-br local-address=22.1.1.2 remote-address=33.1.1.2 keepalive=10s,10\n[BR] /interface gre add name=gre-hq local-address=33.1.1.2 remote-address=22.1.1.2 keepalive=10s,10' },
      { t: T('Tunnel addresses 172.16.0.1/30 (HQ) and 172.16.0.2/30 (BR); HQ pings 172.16.0.2', 'Адреса туннеля 172.16.0.1/30 (HQ) и 172.16.0.2/30 (BR); HQ пингует 172.16.0.2'), c: (n) => reach(n, 'HQ', '172.16.0.2'), h: '[HQ] /ip address add address=172.16.0.1/30 interface=gre-br\n[BR] /ip address add address=172.16.0.2/30 interface=gre-hq' },
      { t: T('PC-HQ reaches PC-BR through the tunnel', 'PC-HQ достигает PC-BR через туннель'), c: (n) => viaTunnel(n, 'PC-HQ', '192.168.20.10') && reach(n, 'PC-BR', '192.168.10.10'), h: '[HQ] /ip route add dst-address=192.168.20.0/24 gateway=172.16.0.2\n[BR] /ip route add dst-address=192.168.10.0/24 gateway=172.16.0.1' },
    ],
  },
  {
    id: 're-eoip', module: 're-tunnels', start: 'sites',
    title: T('EoIP: one LAN on two sites', 'EoIP: одна LAN на два офиса'),
    intro: T('The branch must be in the same subnet as HQ (192.168.10.0/24) and use the HQ router as gateway. Build an EoIP tunnel and bridge it with the LAN port on both routers. PC-BR is 192.168.10.20.', 'Филиал должен быть в той же подсети, что HQ (192.168.10.0/24), и использовать маршрутизатор HQ как шлюз. Постройте EoIP-туннель и объедините его в бридж с портом LAN на обоих маршрутизаторах. PC-BR имеет адрес 192.168.10.20.'),
    net: () => twoSites([ip('192.168.10.1/24', 'ether5')], [], '192.168.10.20/24', '192.168.10.1'),
    probes: [['PC-BR', '192.168.10.1'], ['PC-BR', '192.168.10.10']],
    tasks: [
      { t: T('EoIP tunnels on HQ and BR with the same tunnel-id, both running', 'EoIP-туннели на HQ и BR с одинаковым tunnel-id, оба running'), c: (n) => L(n, 'HQ', 'interface eoip').some((t) => on(t) && running(n, 'HQ', t.name)) && L(n, 'BR', 'interface eoip').some((t) => on(t) && running(n, 'BR', t.name)), h: '[HQ] /interface eoip add name=eoip-br local-address=22.1.1.2 remote-address=33.1.1.2 tunnel-id=10\n[BR] /interface eoip add name=eoip-hq local-address=33.1.1.2 remote-address=22.1.1.2 tunnel-id=10' },
      { t: T('HQ: bridge with ether5 and the EoIP tunnel, 192.168.10.1/24 moved to the bridge', 'HQ: бридж с ether5 и EoIP-туннелем, 192.168.10.1/24 перенесён на бридж'), c: (n) => { const b = L(n, 'HQ', 'interface bridge port').filter(on); const a = L(n, 'HQ', 'ip address').find((x) => on(x) && x.address === '192.168.10.1/24'); return b.some((p) => p.interface === 'ether5') && b.some((p) => L(n, 'HQ', 'interface eoip').some((t) => t.name === p.interface)) && !!a && L(n, 'HQ', 'interface bridge').some((x) => x.name === a.interface) }, h: '[HQ] /interface bridge add name=br-lan\n[HQ] /interface bridge port add bridge=br-lan interface=ether5\n[HQ] /interface bridge port add bridge=br-lan interface=eoip-br\n[HQ] /ip address set [find address="192.168.10.1/24"] interface=br-lan' },
      { t: T('BR: bridge with ether5 and the EoIP tunnel', 'BR: бридж с ether5 и EoIP-туннелем'), c: (n) => { const b = L(n, 'BR', 'interface bridge port').filter(on); return b.some((p) => p.interface === 'ether5') && b.some((p) => L(n, 'BR', 'interface eoip').some((t) => t.name === p.interface)) }, h: '[BR] /interface bridge add name=br-lan\n[BR] /interface bridge port add bridge=br-lan interface=ether5\n[BR] /interface bridge port add bridge=br-lan interface=eoip-hq' },
      { t: T('PC-BR reaches its gateway 192.168.10.1 and PC-HQ', 'PC-BR достигает своего шлюза 192.168.10.1 и PC-HQ'), c: (n) => reach(n, 'PC-BR', '192.168.10.1') && reach(n, 'PC-BR', '192.168.10.10'), h: 'Both ends must be bridged and the tunnel-id must match.' },
    ],
  },
  {
    id: 're-wg', module: 're-tunnels', start: 'sites',
    title: T('WireGuard between two sites', 'WireGuard между двумя офисами'),
    intro: T('Connect the LANs with WireGuard. Each router generates its key pair when you create the interface; copy the public key of the other side from /interface wireguard print. allowed-address works like a routing filter: a peer only accepts and sends what is listed there.', 'Соедините LAN через WireGuard. Каждый маршрутизатор создаёт пару ключей при создании интерфейса; скопируйте публичный ключ другой стороны из /interface wireguard print. allowed-address работает как фильтр: пир принимает и отправляет только перечисленное.'),
    net: () => twoSites([ip('192.168.10.1/24', 'ether5')], [ip('192.168.20.1/24', 'ether5')]),
    probes: [['HQ', '10.255.255.2'], ['PC-HQ', '192.168.20.10']],
    tasks: [
      { t: T('WireGuard interface wg1 on both routers (listen-port 13231)', 'Интерфейс WireGuard wg1 на обоих маршрутизаторах (listen-port 13231)'), c: (n) => L(n, 'HQ', 'interface wireguard').some(on) && L(n, 'BR', 'interface wireguard').some(on), h: '[HQ] /interface wireguard add name=wg1 listen-port=13231\n[BR] /interface wireguard add name=wg1 listen-port=13231' },
      { t: T('Peers: each side knows the other public key; HQ has endpoint-address=33.1.1.2 endpoint-port=13231', 'Пиры: каждая сторона знает публичный ключ другой; у HQ endpoint-address=33.1.1.2 endpoint-port=13231'), c: (n) => { const k = (r) => (L(n, r, 'interface wireguard')[0] || {})['public-key']; return L(n, 'HQ', 'interface wireguard peers').some((p) => on(p) && p['public-key'] === k('BR')) && L(n, 'BR', 'interface wireguard peers').some((p) => on(p) && p['public-key'] === k('HQ')) }, h: '[BR] /interface wireguard print      (copy public-key)\n[HQ] /interface wireguard peers add interface=wg1 public-key="<BR key>" endpoint-address=33.1.1.2 endpoint-port=13231 allowed-address=10.255.255.2/32,192.168.20.0/24\n[BR] /interface wireguard peers add interface=wg1 public-key="<HQ key>" allowed-address=10.255.255.1/32,192.168.10.0/24' },
      { t: T('Addresses 10.255.255.1/30 and 10.255.255.2/30 on wg1; HQ pings 10.255.255.2', 'Адреса 10.255.255.1/30 и 10.255.255.2/30 на wg1; HQ пингует 10.255.255.2'), c: (n) => reach(n, 'HQ', '10.255.255.2'), h: '[HQ] /ip address add address=10.255.255.1/30 interface=wg1\n[BR] /ip address add address=10.255.255.2/30 interface=wg1' },
      { t: T('PC-HQ reaches PC-BR through WireGuard (routes plus allowed-address for both LANs)', 'PC-HQ достигает PC-BR через WireGuard (маршруты и allowed-address для обеих LAN)'), c: (n) => viaTunnel(n, 'PC-HQ', '192.168.20.10'), h: '[HQ] /ip route add dst-address=192.168.20.0/24 gateway=10.255.255.2\n[BR] /ip route add dst-address=192.168.10.0/24 gateway=10.255.255.1\nallowed-address on each peer must include the remote LAN.' },
    ],
  },
  {
    id: 're-ospf-single', module: 're-ospf-cfg', start: 'tri', linkCtl: true,
    title: T('OSPF in one area', 'OSPF в одной области'),
    intro: T('Replace static routing in the triangle with OSPF (RouterOS 7). Each router has a loopback 10.255.255.N/32 to use as router ID. The LANs must be advertised but no OSPF hellos may be sent to the PCs.', 'Замените статическую маршрутизацию в треугольнике на OSPF (RouterOS 7). У каждого маршрутизатора есть loopback 10.255.255.N/32 для router ID. LAN должны анонсироваться, но OSPF hello не должны уходить к ПК.'),
    net: () => triangle({}, true),
    probes: [['PC1', '192.168.3.10'], ['PC1', '192.168.2.10'], ['PC2', '192.168.3.10']],
    tasks: [
      { t: T('OSPF instance on every router with router-id = its loopback address', 'Экземпляр OSPF на каждом маршрутизаторе с router-id = его loopback-адрес'), c: (n) => ['R1', 'R2', 'R3'].every((r, i) => L(n, r, 'routing ospf instance').some((x) => on(x) && x['router-id'] === '10.255.255.' + (i + 1))), h: '[R1] /routing ospf instance add name=default-v2 router-id=10.255.255.1\n[R2] /routing ospf instance add name=default-v2 router-id=10.255.255.2\n[R3] /routing ospf instance add name=default-v2 router-id=10.255.255.3' },
      { t: T('Backbone area and interface templates: all three neighbours are Full', 'Магистральная область и шаблоны интерфейсов: все три соседства в Full'), c: (n) => ospfFull(n, 'R1', 'R2') && ospfFull(n, 'R1', 'R3') && ospfFull(n, 'R2', 'R3'), h: '[each] /routing ospf area add name=backbone-v2 area-id=0.0.0.0 instance=default-v2\n[each] /routing ospf interface-template add area=backbone-v2 interfaces=ether1,ether2 type=ptp' },
      { t: T('LANs and loopbacks advertised as passive; every PC reaches every other PC', 'LAN и loopback анонсируются как passive; каждый ПК достигает каждого'), c: (n) => ['R1', 'R2', 'R3'].every((r) => L(n, r, 'routing ospf interface-template').some((t) => on(t) && t.passive === 'yes' && String(t.interfaces || '').split(',').includes('ether5'))) && reach(n, 'PC1', '192.168.3.10') && reach(n, 'PC1', '192.168.2.10') && reach(n, 'PC2', '192.168.3.10'), h: '[each] /routing ospf interface-template add area=backbone-v2 interfaces=ether5,lo passive' },
      { t: T('Cost: R1 sends traffic for LAN3 through R2 while the direct link is up (cost 100 on R1 ether2)', 'Стоимость: R1 отправляет трафик к LAN3 через R2, пока прямой канал работает (cost 100 на ether2 R1)'), c: (n) => pathHas(n, 'PC1', '192.168.3.10', '10.0.12.2'), h: '[R1] /routing ospf interface-template add area=backbone-v2 interfaces=ether2 type=ptp cost=100 place-before=0' },
      { t: T('Cut the R1–R2 link: PC1 still reaches PC2 (OSPF finds the way through R3)', 'Перережьте канал R1–R2: PC1 всё равно достигает PC2 (OSPF находит путь через R3)'), c: (n) => withLink(n, 0, 'down', () => pathHas(n, 'PC1', '192.168.2.10', '10.0.13.2')), h: 'Turn the R1–R2 link down in the Links panel and run /ip route print on R1.' },
    ],
  },
  {
    id: 're-ospf-areas', module: 're-ospf-cfg', start: 'chain',
    title: T('Multi-area OSPF, stub areas and summaries', 'OSPF с несколькими областями, stub и суммирование'),
    intro: T('R1 is already in the backbone and redistributes a static route (172.16.0.0/16) as an external. Make R2 an area border router and put R3 with its LANs 10.1.1.0/24 and 10.1.2.0/24 into area 1. Then make area 1 a stub, then totally stubby, and summarise it on the ABR.', 'R1 уже в магистральной области и перераспределяет статический маршрут (172.16.0.0/16) как внешний. Сделайте R2 пограничным маршрутизатором области (ABR) и поместите R3 с его LAN 10.1.1.0/24 и 10.1.2.0/24 в область 1. Затем сделайте область 1 stub, потом totally stubby и суммируйте её на ABR.'),
    net: () => ({
      h: 210,
      routers: [
        { name: 'R1', x: 150, y: 90, cmds: [ip('10.0.12.1/30', 'ether1'), ip('192.168.1.1/24', 'ether5'), ip('10.255.255.1/32', 'lo'), '/ip route add dst-address=172.16.0.0/16 blackhole',
          '/routing ospf instance add name=default-v2 router-id=10.255.255.1 redistribute=static', '/routing ospf area add name=backbone-v2 area-id=0.0.0.0 instance=default-v2',
          '/routing ospf interface-template add area=backbone-v2 interfaces=ether1 type=ptp', '/routing ospf interface-template add area=backbone-v2 interfaces=ether5,lo passive'] },
        { name: 'R2', x: 320, y: 90, cmds: [ip('10.0.12.2/30', 'ether1'), ip('10.0.23.1/30', 'ether2'), ip('10.255.255.2/32', 'lo')] },
        { name: 'R3', x: 490, y: 90, cmds: [ip('10.0.23.2/30', 'ether2'), ip('10.1.1.1/24', 'ether5'), ip('10.1.2.1/24', 'ether4'), ip('10.255.255.3/32', 'lo')] },
      ],
      links: [{ a: 'R1:ether1', b: 'R2:ether1' }, { a: 'R2:ether2', b: 'R3:ether2' }],
      hosts: [{ name: 'PC1', ip: '192.168.1.10/24', gw: '192.168.1.1', at: 'R1:ether5', x: 50, y: 175 }, { name: 'PC3', ip: '10.1.1.10/24', gw: '10.1.1.1', at: 'R3:ether5', x: 590, y: 175 }, { name: 'PC4', ip: '10.1.2.10/24', gw: '10.1.2.1', at: 'R3:ether4', x: 590, y: 30 }],
    }),
    probes: [['PC1', '10.1.1.10'], ['PC3', '192.168.1.10']],
    tasks: [
      { t: T('R2: backbone on ether1, area1 (0.0.0.1) on ether2; R2 is Full with R1', 'R2: backbone на ether1, area1 (0.0.0.1) на ether2; R2 в Full с R1'), c: (n) => ospfFull(n, 'R2', 'R1') && L(n, 'R2', 'routing ospf area').some((a) => a['area-id'] === '0.0.0.1'), h: '[R2] /routing ospf instance add name=default-v2 router-id=10.255.255.2\n[R2] /routing ospf area add name=backbone-v2 area-id=0.0.0.0 instance=default-v2\n[R2] /routing ospf area add name=area1 area-id=0.0.0.1 instance=default-v2\n[R2] /routing ospf interface-template add area=backbone-v2 interfaces=ether1,lo type=ptp\n[R2] /routing ospf interface-template add area=area1 interfaces=ether2 type=ptp' },
      { t: T('R3 in area1 with its LANs passive; PC1 reaches PC3', 'R3 в area1 со своими LAN как passive; PC1 достигает PC3'), c: (n) => ospfFull(n, 'R2', 'R3') && reach(n, 'PC1', '10.1.1.10'), h: '[R3] /routing ospf instance add name=default-v2 router-id=10.255.255.3\n[R3] /routing ospf area add name=area1 area-id=0.0.0.1 instance=default-v2\n[R3] /routing ospf interface-template add area=area1 interfaces=ether2 type=ptp\n[R3] /routing ospf interface-template add area=area1 interfaces=ether4,ether5,lo passive' },
      { t: T('area1 is a stub on R2 and R3: R3 has no external routes but gets a default route from OSPF', 'area1 типа stub на R2 и R3: у R3 нет внешних маршрутов, но есть маршрут по умолчанию от OSPF'), c: (n) => !!sel(n, 'R3', '0.0.0.0/0', 'o') && !routes(n, 'R3').some((r) => r.dst === '172.16.0.0/16' && r.selected) && reach(n, 'PC3', '192.168.1.10'), h: '[R2] /routing ospf area set area1 type=stub\n[R3] /routing ospf area set area1 type=stub' },
      { t: T('Totally stubby: R3 keeps only the default route from OSPF (no inter-area routes)', 'Totally stubby: у R3 остаётся только маршрут по умолчанию от OSPF (без межобластных)'), c: (n) => !!sel(n, 'R3', '0.0.0.0/0', 'o') && !routes(n, 'R3').some((r) => r.proto === 'o' && r.otype === 'inter' && r.dst !== '0.0.0.0/0' && r.selected), h: '[R2] /routing ospf area set area1 no-summaries=yes' },
      { t: T('Summary on the ABR: R1 sees one route 10.1.0.0/16 instead of the /24s', 'Суммирование на ABR: R1 видит один маршрут 10.1.0.0/16 вместо /24'), c: (n) => !!sel(n, 'R1', '10.1.0.0/16', 'o') && !sel(n, 'R1', '10.1.1.0/24'), h: '[R2] /routing ospf area range add area=area1 prefix=10.1.0.0/16 advertise=yes' },
    ],
  },
  {
    id: 're-ospf-redist', module: 're-ospf-cfg', start: 'tri', linkCtl: true,
    title: T('OSPF defaults, redistribution and filters', 'OSPF: маршрут по умолчанию, перераспределение и фильтры'),
    intro: T('OSPF already runs in the triangle. R1 is the Internet edge (ISP on ether3, with WEB 93.184.216.34 behind it), R3 has a static route to a branch 172.20.0.0/16 behind router BR. Spread the default route and the branch network through OSPF, and mark the branch as an external type 1 route with a routing filter.', 'OSPF уже работает в треугольнике. R1 граничит с Интернетом (ISP на ether3, за ним WEB 93.184.216.34), у R3 есть статический маршрут к филиалу 172.20.0.0/16 за маршрутизатором BR. Распространите маршрут по умолчанию и сеть филиала через OSPF и пометьте филиал как внешний маршрут type 1 с помощью фильтра маршрутизации.'),
    net: () => {
      const ospfCmds = (i) => [`/routing ospf instance add name=default-v2 router-id=10.255.255.${i}`, '/routing ospf area add name=backbone-v2 area-id=0.0.0.0 instance=default-v2',
        '/routing ospf interface-template add area=backbone-v2 interfaces=ether1,ether2 type=ptp', '/routing ospf interface-template add area=backbone-v2 interfaces=ether5,lo passive']
      const t = triangle({ R1: [ip('22.1.1.2/30', 'ether3'), '/ip route add gateway=22.1.1.1', ...ospfCmds(1)], R2: ospfCmds(2), R3: [ip('10.0.34.1/30', 'ether4'), '/ip route add dst-address=172.20.0.0/16 gateway=10.0.34.2', ...ospfCmds(3)] }, true)
      t.h = 340
      t.routers.push({ name: 'ISP', x: 190, y: 290, locked: true, cmds: [ip('22.1.1.1/30', 'ether1'), ip('93.184.216.1/24', 'ether5'), '/ip route add dst-address=192.168.0.0/16 gateway=22.1.1.2', '/ip route add dst-address=172.20.0.0/16 gateway=22.1.1.2', '/ip route add dst-address=10.0.0.0/8 gateway=22.1.1.2'] })
      t.routers.push({ name: 'BR', x: 470, y: 290, locked: true, cmds: [ip('10.0.34.2/30', 'ether1'), ip('172.20.1.1/24', 'ether5'), '/ip route add gateway=10.0.34.1'] })
      t.links.push({ a: 'R1:ether3', b: 'ISP:ether1' }, { a: 'R3:ether4', b: 'BR:ether1' })
      t.hosts = t.hosts.filter((h) => h.name !== 'PC3')
      t.hosts.push({ name: 'WEB', ip: '93.184.216.34/24', gw: '93.184.216.1', at: 'ISP:ether5', x: 60, y: 300 }, { name: 'BR-PC', ip: '172.20.1.10/24', gw: '172.20.1.1', at: 'BR:ether5', x: 590, y: 300 })
      return t
    },
    probes: [['PC2', '93.184.216.34'], ['PC1', '172.20.1.10'], ['PC2', '172.20.1.10']],
    tasks: [
      { t: T('R1 originates a default route only while it has one itself (originate-default=if-installed); PC2 reaches WEB', 'R1 анонсирует маршрут по умолчанию, только пока он есть у него самого (originate-default=if-installed); PC2 достигает WEB'), c: (n) => L(n, 'R1', 'routing ospf instance').some((x) => on(x) && x['originate-default'] === 'if-installed') && !!sel(n, 'R2', '0.0.0.0/0', 'o') && reach(n, 'PC2', '93.184.216.34'), h: '[R1] /routing ospf instance set default-v2 originate-default=if-installed' },
      { t: T('R3 redistributes its static routes: R1 and R2 learn 172.20.0.0/16, PC1 reaches BR-PC', 'R3 перераспределяет статические маршруты: R1 и R2 узнают 172.20.0.0/16, PC1 достигает BR-PC'), c: (n) => !!sel(n, 'R1', '172.20.0.0/16', 'o') && !!sel(n, 'R2', '172.20.0.0/16', 'o') && reach(n, 'PC1', '172.20.1.10'), h: '[R3] /routing ospf instance set default-v2 redistribute=static' },
      { t: T('Routing filter on R3: export 172.20.0.0/16 as external type 1 (R2 shows it as ext1)', 'Фильтр маршрутизации на R3: экспортировать 172.20.0.0/16 как внешний type 1 (R2 показывает его как ext1)'), c: (n) => { const r = sel(n, 'R2', '172.20.0.0/16', 'o'); return !!r && r.otype === 'ext1' }, h: '[R3] /routing filter rule add chain=ospf-out rule="if (dst in 172.20.0.0/16) { set ospf-ext-type type1; accept }"\n[R3] /routing filter rule add chain=ospf-out rule="accept"\n[R3] /routing ospf instance set default-v2 out-filter-chain=ospf-out' },
      { t: T('R1 loses its ISP cable: the default route disappears from R2 instead of pointing into a dead end', 'R1 теряет кабель к ISP: маршрут по умолчанию исчезает с R2, а не ведёт в тупик'), c: (n) => !!sel(n, 'R2', '0.0.0.0/0', 'o') && withLink(n, 3, 'down', () => !sel(n, 'R2', '0.0.0.0/0')), h: 'Turn the R1–ISP link down in the Links panel and run /ip route print on R2.\nWith originate-default=always R2 would keep a default route that leads nowhere.' },
    ],
  },
]

// The free practice terminal: the triangle with loopbacks, every router editable, link controls on.
export const RE_SANDBOX = { id: 're-sandbox', net: () => triangle({}, true), probes: [['PC1', '192.168.2.10'], ['PC1', '192.168.3.10'], ['PC2', '192.168.3.10']], linkCtl: true, tasks: [] }

export const RE_START_LABEL = () => T({ tri: 'triangle R1-R2-R3', isp: 'two ISPs', pair: 'two routers, one cable', sites: 'two sites over the Internet', chain: 'R1-R2-R3 chain' }, { tri: 'треугольник R1-R2-R3', isp: 'два провайдера', pair: 'два маршрутизатора, один кабель', sites: 'два офиса через Интернет', chain: 'цепочка R1-R2-R3' })

export const makeLabNet = (lab) => makeNet(lab.net())
export { hasRoute }
