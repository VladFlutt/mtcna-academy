// Guided labs for the RouterOS terminal. Each task has a live check on the
// simulated router state, so the checklist turns green as the student works.

import {
  RouterOS, emptyConfig, defaultConfig, laptopState, laptopInternet, laptopReach, routerInternet,
  routerResolve, evalChain, isRunning, bridgeOf, lookup, dnsServers,
} from './routeros.js'
import { inSubnet, parseCidr } from './net.js'

const on = (x) => x && x.disabled !== 'yes'
const L = (st, p) => st.lists[p] || []
const S = (st, p) => st.singletons[p] || {}
const svc = (st, n) => st.services.find((s) => s.name === n)

function run(st, cmds) {
  const r = new RouterOS(st)
  for (const c of cmds) r.exec(c)
  return r.st
}

const BRIDGE_CMDS = [
  '/interface bridge add name=bridgeLAN',
  '/interface bridge port add bridge=bridgeLAN interface=ether2',
  '/interface bridge port add bridge=bridgeLAN interface=ether3',
  '/interface bridge port add bridge=bridgeLAN interface=ether4',
  '/interface bridge port add bridge=bridgeLAN interface=ether5',
  '/ip address add address=192.168.33.1/24 interface=bridgeLAN',
]
const WAN_CMDS = [
  '/ip address add address=22.1.1.33/24 interface=ether1',
  '/ip route add dst-address=0.0.0.0/0 gateway=22.1.1.1',
  '/ip dns set servers=22.1.1.1 allow-remote-requests=yes',
  '/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade',
]

export const STARTS = {
  default: () => defaultConfig(),
  empty: () => emptyConfig(),
  bridged: () => run(emptyConfig(), BRIDGE_CMDS),
  online: () => run(emptyConfig(), [...BRIDGE_CMDS, ...WAN_CMDS]),
  onlineDhcp: () => {
    const st = run(emptyConfig(), [...BRIDGE_CMDS, ...WAN_CMDS,
      '/ip pool add name=lan-pool ranges=192.168.33.10-192.168.33.254',
      '/ip dhcp-server add name=dhcp1 interface=bridgeLAN address-pool=lan-pool disabled=no',
      '/ip dhcp-server network add address=192.168.33.0/24 gateway=192.168.33.1 dns-server=192.168.33.1'])
    st.laptop = { mode: 'dhcp', port: 'ether2', mac: 'E4:5F:01:AA:BB:02' }
    return st
  },
  dhcpWan: () => {
    const st = run(emptyConfig(), [...BRIDGE_CMDS, '/ip dhcp-client add interface=ether1 disabled=no',
      '/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade', '/ip dns set allow-remote-requests=yes'])
    return st
  },
}

// firewall probes (new connection unless stated)
const WAN_IP = '203.0.113.50'
function probeInput(st, fromWan, protocol, port) {
  const lan = bridgeOf(st, 'ether2') || 'ether2'
  return evalChain(st, 'filter', 'input', { src: fromWan ? WAN_IP : '192.168.33.2', dst: fromWan ? '22.1.1.33' : '192.168.33.1', protocol, dstPort: port, inIf: fromWan ? 'ether1' : lan, state: 'new' }).verdict === 'accept'
}
function probeForwardWanToLan(st, natState = '') {
  const lan = bridgeOf(st, 'ether2') || 'ether2'
  return evalChain(st, 'filter', 'forward', { src: WAN_IP, dst: '192.168.33.10', protocol: 'tcp', dstPort: 80, inIf: 'ether1', outIf: lan, state: 'new', natState }).verdict === 'accept'
}
function firstInputRuleIsEstablished(st) {
  const r = L(st, 'ip firewall filter').filter((x) => on(x) && x.chain === 'input')[0]
  return !!r && r.action === 'accept' && /established/.test(r['connection-state'] || '') && /related/.test(r['connection-state'] || '')
}

export const LABS = [
  {
    id: 'basic', module: 'first', title: 'Identity, note and users', start: 'default',
    intro: 'Course labs 5.2 and 5.10. Name your router, add a login banner, create your own admin account and get rid of the default admin.',
    tasks: [
      { t: 'Set the identity to something other than MikroTik (e.g. 33_5_YourName)', c: (st) => S(st, 'system identity').name !== 'MikroTik' && S(st, 'system identity').name.length > 0, h: '/system identity set name=33_5_Oleg' },
      { t: 'Add a system note (login banner)', c: (st) => (S(st, 'system note').note || '').length > 0, h: '/system note set note="Authorized access only" show-at-login=yes' },
      { t: 'Create user man with group full and password Man33ioP', c: (st) => L(st, 'user').some((u) => u.name === 'man' && u.group === 'full' && u.password === 'Man33ioP' && on(u)), h: '/user add name=man group=full password=Man33ioP' },
      { t: 'Disable or remove the user admin', c: (st) => !L(st, 'user').some((u) => u.name === 'admin' && on(u)), h: '/user disable admin   (or /user remove admin)' },
    ],
  },
  {
    id: 'harden', module: 'first', title: 'Harden IP services', start: 'default',
    intro: 'Turn off management services you do not need and restrict the rest to the LAN.',
    tasks: [
      { t: 'Disable telnet and ftp', c: (st) => svc(st, 'telnet').disabled === 'yes' && svc(st, 'ftp').disabled === 'yes', h: '/ip service disable telnet,ftp' },
      { t: 'Disable www (HTTP), api and api-ssl', c: (st) => ['www', 'api', 'api-ssl'].every((n) => svc(st, n).disabled === 'yes'), h: '/ip service disable www,api,api-ssl' },
      { t: 'Allow Winbox only from 192.168.88.0/24', c: (st) => svc(st, 'winbox').disabled !== 'yes' && svc(st, 'winbox').address === '192.168.88.0/24', h: '/ip service set winbox address=192.168.88.0/24' },
      { t: 'Move SSH to port 2222', c: (st) => svc(st, 'ssh').port === '2222', h: '/ip service set ssh port=2222' },
      { t: 'Save a binary backup called before-change', c: (st) => st.files.some((f) => f.name === 'before-change.backup'), h: '/system backup save name=before-change' },
    ],
  },
  {
    id: 'bridge', module: 'bridge', title: 'Build bridgeLAN (Lab 5.1)', start: 'empty',
    intro: 'The router starts with NO configuration (reset with no-defaults). ether1 will be the WAN, ether2-ether5 go into one bridge called bridgeLAN. The laptop is cabled to ether2.',
    tasks: [
      { t: 'Create a bridge named bridgeLAN', c: (st) => L(st, 'interface bridge').some((b) => b.name === 'bridgeLAN'), h: '/interface bridge add name=bridgeLAN' },
      { t: 'Add ether2, ether3, ether4 and ether5 as ports of bridgeLAN', c: (st) => ['ether2', 'ether3', 'ether4', 'ether5'].every((p) => bridgeOf(st, p) === 'bridgeLAN'), h: '/interface bridge port add bridge=bridgeLAN interface=ether2   (repeat for ether3-ether5)' },
      { t: 'Keep ether1 out of the bridge (it is the WAN)', c: (st) => !bridgeOf(st, 'ether1') && L(st, 'interface bridge').length > 0, h: 'Do not add ether1 to the bridge' },
      { t: 'Add 192.168.33.1/24 to bridgeLAN (not to a port)', c: (st) => L(st, 'ip address').some((a) => on(a) && a.address === '192.168.33.1/24' && a.interface === 'bridgeLAN'), h: '/ip address add address=192.168.33.1/24 interface=bridgeLAN' },
      { t: 'Check: bridgeLAN is running and the laptop (192.168.33.2) answers ping', c: (st) => isRunning(st, 'bridgeLAN') && laptopReach(st, '192.168.33.1').ok, h: '/interface print  then  /ping 192.168.33.2' },
    ],
  },
  {
    id: 'routing', module: 'routing', title: 'Static WAN, default route and NAT (Labs 5.4-5.9)', start: 'bridged',
    intro: 'bridgeLAN with 192.168.33.1/24 is ready. The ISP gave you 22.1.1.33/24 with gateway and DNS 22.1.1.1. Bring the router and the laptop (static 192.168.33.2, gw .1, dns .1) online.',
    tasks: [
      { t: 'Add 22.1.1.33/24 on ether1', c: (st) => L(st, 'ip address').some((a) => on(a) && a.address === '22.1.1.33/24' && a.interface === 'ether1'), h: '/ip address add address=22.1.1.33/24 interface=ether1' },
      { t: 'Add a default route via 22.1.1.1', c: (st) => { const r = lookup(st, '8.8.8.8'); return !!r && r.gateway === '22.1.1.1' }, h: '/ip route add dst-address=0.0.0.0/0 gateway=22.1.1.1' },
      { t: 'Set DNS server 22.1.1.1 and allow remote requests', c: (st) => dnsServers(st).includes('22.1.1.1') && S(st, 'ip dns')['allow-remote-requests'] === 'yes', h: '/ip dns set servers=22.1.1.1 allow-remote-requests=yes' },
      { t: 'The router resolves and pings mtcna.lab', c: (st) => routerInternet(st) && !!routerResolve(st, 'mtcna.lab'), h: '/ping mtcna.lab' },
      { t: 'Add src-nat masquerade out of ether1 so the laptop gets Internet', c: (st) => laptopInternet(st).ok, h: '/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade' },
    ],
  },
  {
    id: 'gateway', module: 'dhcp', title: 'DHCP client and DHCP server (Labs 5.11-5.12)', start: 'bridged',
    intro: 'bridgeLAN 192.168.33.1/24 is ready. Get the WAN address from the ISP by DHCP, then hand out addresses to the LAN. The laptop is set to obtain an IP automatically.',
    setup: (st) => { st.laptop = { mode: 'dhcp', port: 'ether2', mac: 'E4:5F:01:AA:BB:02' } },
    tasks: [
      { t: 'Add a DHCP client on ether1 (status bound)', c: (st) => L(st, 'ip dhcp-client').some((d) => on(d) && d.interface === 'ether1') && routerInternet(st), h: '/ip dhcp-client add interface=ether1 disabled=no' },
      { t: 'Create IP pool lan-pool 192.168.33.10-192.168.33.254', c: (st) => L(st, 'ip pool').some((p) => p.name === 'lan-pool' && p.ranges === '192.168.33.10-192.168.33.254'), h: '/ip pool add name=lan-pool ranges=192.168.33.10-192.168.33.254' },
      { t: 'Add a DHCP server on bridgeLAN using lan-pool (enabled)', c: (st) => L(st, 'ip dhcp-server').some((s) => on(s) && s.interface === 'bridgeLAN' && s['address-pool'] === 'lan-pool'), h: '/ip dhcp-server add name=dhcp1 interface=bridgeLAN address-pool=lan-pool disabled=no' },
      { t: 'Add DHCP network 192.168.33.0/24 with gateway and DNS 192.168.33.1', c: (st) => L(st, 'ip dhcp-server network').some((n) => n.address === '192.168.33.0/24' && n.gateway === '192.168.33.1' && n['dns-server'] === '192.168.33.1'), h: '/ip dhcp-server network add address=192.168.33.0/24 gateway=192.168.33.1 dns-server=192.168.33.1' },
      { t: 'The laptop receives a lease (check /ip dhcp-server lease print)', c: (st) => !!laptopState(st).ip, h: '/ip dhcp-server lease print' },
      { t: 'Allow DNS requests and masquerade: the laptop browses the Internet', c: (st) => laptopInternet(st).ok, h: '/ip dns set allow-remote-requests=yes\n/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade' },
      { t: 'Bonus: give the laptop (E4:5F:01:AA:BB:02) a static lease 192.168.33.50', c: (st) => L(st, 'ip dhcp-server lease').some((l) => l.address === '192.168.33.50' && (l['mac-address'] || '').toUpperCase() === 'E4:5F:01:AA:BB:02'), h: '/ip dhcp-server lease add address=192.168.33.50 mac-address=E4:5F:01:AA:BB:02' },
    ],
  },
  {
    id: 'firewall', module: 'firewall', title: 'Protect the router and the LAN', start: 'online',
    intro: 'The router is online (WAN ether1 22.1.1.33, LAN bridgeLAN). There are no filter rules yet, so everything is allowed. Build a stateful firewall. Order matters!',
    tasks: [
      { t: 'First input rule: accept established,related', c: firstInputRuleIsEstablished, h: '/ip firewall filter add chain=input connection-state=established,related action=accept' },
      { t: 'Drop invalid in input', c: (st) => L(st, 'ip firewall filter').some((r) => on(r) && r.chain === 'input' && r['connection-state'] === 'invalid' && r.action === 'drop'), h: '/ip firewall filter add chain=input connection-state=invalid action=drop' },
      { t: 'Ping (ICMP) to the router is still allowed from the WAN', c: (st) => probeInput(st, true, 'icmp') && !probeInput(st, true, 'tcp', 8291), h: '/ip firewall filter add chain=input protocol=icmp action=accept' },
      { t: 'Winbox (TCP 8291) from the WAN is dropped', c: (st) => !probeInput(st, true, 'tcp', 8291), h: '/ip firewall filter add chain=input in-interface=ether1 action=drop   (place it last)' },
      { t: 'Winbox and DNS from the LAN still work', c: (st) => probeInput(st, false, 'tcp', 8291) && probeInput(st, false, 'udp', 53), h: 'Do not drop everything in input: limit the drop to in-interface=ether1' },
      { t: 'New connections from the WAN to the LAN are dropped (forward)', c: (st) => !probeForwardWanToLan(st), h: '/ip firewall filter add chain=forward connection-state=established,related action=accept\n/ip firewall filter add chain=forward in-interface=ether1 connection-nat-state=!dstnat action=drop' },
      { t: 'The laptop still has Internet', c: (st) => laptopInternet(st).ok && !probeForwardWanToLan(st), h: 'Make sure established,related is accepted in forward' },
    ],
  },
  {
    id: 'nat', module: 'firewall', title: 'Port forwarding and redirect (DST-NAT lab)', start: 'online',
    intro: 'A web server 192.168.33.10 and a mail server 192.168.33.100 live in the LAN. Publish them on the public address 22.1.1.33 and redirect all LAN DNS queries to the router.',
    tasks: [
      { t: 'Forward TCP 80 arriving on ether1 to 192.168.33.10', c: (st) => { const v = evalChain(st, 'nat', 'dstnat', { src: WAN_IP, dst: '22.1.1.33', protocol: 'tcp', dstPort: 80, inIf: 'ether1', state: 'new' }); return v.verdict === 'dst-nat' && v.rule['to-addresses'] === '192.168.33.10' }, h: '/ip firewall nat add chain=dstnat in-interface=ether1 protocol=tcp dst-port=80 action=dst-nat to-addresses=192.168.33.10' },
      { t: 'Forward TCP 25,110,143 to the mail server 192.168.33.100', c: (st) => [25, 110, 143].every((p) => { const v = evalChain(st, 'nat', 'dstnat', { src: WAN_IP, dst: '22.1.1.33', protocol: 'tcp', dstPort: p, inIf: 'ether1', state: 'new' }); return v.verdict === 'dst-nat' && v.rule['to-addresses'] === '192.168.33.100' }), h: '/ip firewall nat add chain=dstnat dst-address=22.1.1.33 protocol=tcp dst-port=25,110,143 action=dst-nat to-addresses=192.168.33.100' },
      { t: 'Redirect UDP 53 from the LAN to the router', c: (st) => evalChain(st, 'nat', 'dstnat', { src: '192.168.33.2', dst: '8.8.8.8', protocol: 'udp', dstPort: 53, inIf: 'bridgeLAN', state: 'new' }).verdict === 'redirect', h: '/ip firewall nat add chain=dstnat src-address=192.168.33.0/24 protocol=udp dst-port=53 action=redirect' },
      { t: 'Masquerade stays in place: laptop has Internet', c: (st) => laptopInternet(st).ok, h: 'Do not remove the srcnat rule' },
    ],
  },
  {
    id: 'queue', module: 'qos', title: 'Simple queues and PCQ (Labs 9.1-9.2)', start: 'online',
    intro: 'Limit bandwidth for your LAN. Remember: max-limit=upload/download, and simple queues are matched top to bottom.',
    tasks: [
      { t: 'Limit the laptop 192.168.33.2 to 1M/1M (queue name laptop)', c: (st) => L(st, 'queue simple').some((q) => q.name === 'laptop' && /^192\.168\.33\.2(\/32)?$/.test(q.target) && q['max-limit'] === '1M/1M'), h: '/queue simple add name=laptop target=192.168.33.2/32 max-limit=1M/1M' },
      { t: 'Allow 3M/3M to server 5.8.63.23 (dst) for the laptop, ABOVE the 1M queue', c: (st) => { const q = L(st, 'queue simple'); const a = q.findIndex((x) => x.dst && x.dst.startsWith('5.8.63.23') && x['max-limit'] === '3M/3M'); const b = q.findIndex((x) => x.name === 'laptop'); return a >= 0 && b >= 0 && a < b }, h: '/queue simple add name=server target=192.168.33.2/32 dst=5.8.63.23/32 max-limit=3M/3M place-before=0' },
      { t: 'Create PCQ types pcq-down (dst-address) and pcq-up (src-address), pcq-rate=0', c: (st) => { const t = L(st, 'queue type'); return t.some((x) => x.name === 'pcq-down' && x.kind === 'pcq' && x['pcq-classifier'] === 'dst-address') && t.some((x) => x.name === 'pcq-up' && x.kind === 'pcq' && x['pcq-classifier'] === 'src-address') }, h: '/queue type add name=pcq-down kind=pcq pcq-classifier=dst-address pcq-rate=0\n/queue type add name=pcq-up kind=pcq pcq-classifier=src-address pcq-rate=0' },
      { t: 'Queue lan: target 192.168.33.0/24, max-limit 10M/10M, queue=pcq-up/pcq-down (last)', c: (st) => { const q = L(st, 'queue simple'); const i = q.findIndex((x) => x.target === '192.168.33.0/24' && x['max-limit'] === '10M/10M' && x.queue === 'pcq-up/pcq-down'); return i >= 0 && i === q.length - 1 }, h: '/queue simple add name=lan target=192.168.33.0/24 max-limit=10M/10M queue=pcq-up/pcq-down' },
      { t: 'Bonus: give queue laptop a burst: burst-limit 5M/5M, threshold 1M/1M, time 10s/10s', c: (st) => L(st, 'queue simple').some((q) => q.name === 'laptop' && q['burst-limit'] === '5M/5M' && q['burst-threshold'] === '1M/1M' && /^10s?\/10s?$/.test(q['burst-time'] || '')), h: '/queue simple set laptop burst-limit=5M/5M burst-threshold=1M/1M burst-time=10s/10s' },
    ],
  },
  {
    id: 'pppoe', module: 'tunnels', title: 'PPPoE client (Labs 6.1-6.2)', start: 'dhcpWan',
    intro: 'Your WAN currently uses a DHCP client. The ISP switches you to PPPoE with user/password class/class. The laptop (static 192.168.33.2) must keep Internet.',
    tasks: [
      { t: 'Disable the DHCP client on ether1', c: (st) => !L(st, 'ip dhcp-client').some((d) => on(d)), h: '/ip dhcp-client disable 0' },
      { t: 'Add a PPPoE client on ether1 (user class, password class)', c: (st) => L(st, 'interface pppoe-client').some((p) => p.interface === 'ether1' && p.user === 'class' && p.password === 'class'), h: '/interface pppoe-client add name=pppoe-out1 interface=ether1 user=class password=class add-default-route=yes use-peer-dns=yes disabled=no' },
      { t: 'PPPoE is running (R) with a default route and peer DNS', c: (st) => L(st, 'interface pppoe-client').some((p) => isRunning(st, p.name) && p['add-default-route'] === 'yes' && p['use-peer-dns'] === 'yes') && routerInternet(st), h: '/interface pppoe-client set pppoe-out1 add-default-route=yes use-peer-dns=yes disabled=no' },
      { t: 'Fix NAT: masquerade out of the PPPoE interface; the laptop has Internet', c: (st) => laptopInternet(st).ok && L(st, 'interface pppoe-client').some((p) => isRunning(st, p.name)) && !L(st, 'ip dhcp-client').some((d) => on(d)), h: '/ip firewall nat set 0 out-interface=pppoe-out1' },
    ],
  },
  {
    id: 'pppoesrv', module: 'tunnels', title: 'PPPoE server with rate limit', start: 'online',
    intro: 'Run a PPPoE server for subscribers on ether3. Each user gets an address from a pool and a 5M/5M rate limit.',
    tasks: [
      { t: 'IP pool pppoe-pool 1.1.1.2-1.1.1.200', c: (st) => L(st, 'ip pool').some((p) => p.name === 'pppoe-pool' && p.ranges === '1.1.1.2-1.1.1.200'), h: '/ip pool add name=pppoe-pool ranges=1.1.1.2-1.1.1.200' },
      { t: 'PPP profile 5mbit: local 1.1.1.1, remote pppoe-pool, rate-limit 5M/5M, only-one', c: (st) => L(st, 'ppp profile').some((p) => p.name === '5mbit' && p['local-address'] === '1.1.1.1' && p['remote-address'] === 'pppoe-pool' && /^5M\/5M$/i.test(p['rate-limit'] || '') && p['only-one'] === 'yes'), h: '/ppp profile add name=5mbit local-address=1.1.1.1 remote-address=pppoe-pool rate-limit=5M/5M only-one=yes' },
      { t: 'PPP secret user1 / pass1, service pppoe, profile 5mbit', c: (st) => L(st, 'ppp secret').some((p) => p.name === 'user1' && p.password === 'pass1' && p.service === 'pppoe' && p.profile === '5mbit'), h: '/ppp secret add name=user1 password=pass1 service=pppoe profile=5mbit' },
      { t: 'PPPoE server on ether3, default-profile 5mbit, one-session-per-host, enabled', c: (st) => L(st, 'interface pppoe-server server').some((s) => on(s) && s.interface === 'ether3' && s['default-profile'] === '5mbit' && s['one-session-per-host'] === 'yes'), h: '/interface pppoe-server server add service-name=isp interface=ether3 default-profile=5mbit one-session-per-host=yes disabled=no' },
    ],
  },
  {
    id: 'pptp', module: 'tunnels', title: 'PPTP site-to-site, Office 1 side (Lab 6.6)', start: 'online',
    intro: 'Office 1 (this router) is the PPTP server. Office 2 (LAN 192.168.11.0/24) will connect as user office2. Tunnel addresses: 172.16.1.1 (here) and 172.16.1.2 (Office 2).',
    tasks: [
      { t: 'Enable the PPTP server with mschap2 and profile default-encryption', c: (st) => S(st, 'interface pptp-server server').enabled === 'yes' && /mschap2/.test(S(st, 'interface pptp-server server').authentication || ''), h: '/interface pptp-server server set enabled=yes authentication=mschap2 default-profile=default-encryption' },
      { t: 'Secret office2: service pptp, local 172.16.1.1, remote 172.16.1.2', c: (st) => L(st, 'ppp secret').some((p) => p.name === 'office2' && p.service === 'pptp' && p['local-address'] === '172.16.1.1' && p['remote-address'] === '172.16.1.2' && (p.password || '').length > 0), h: '/ppp secret add name=office2 password=secret service=pptp local-address=172.16.1.1 remote-address=172.16.1.2' },
      { t: 'Static route to 192.168.11.0/24 via 172.16.1.2', c: (st) => L(st, 'ip route').some((r) => on(r) && r['dst-address'] === '192.168.11.0/24' && r.gateway === '172.16.1.2'), h: '/ip route add dst-address=192.168.11.0/24 gateway=172.16.1.2' },
      { t: 'Allow PPTP in the input chain (TCP 1723 and GRE)', c: (st) => L(st, 'ip firewall filter').some((r) => on(r) && r.chain === 'input' && r.action === 'accept' && r.protocol === 'tcp' && r['dst-port'] === '1723') && L(st, 'ip firewall filter').some((r) => on(r) && r.chain === 'input' && r.action === 'accept' && (r.protocol === 'gre' || r.protocol === '47')), h: '/ip firewall filter add chain=input protocol=tcp dst-port=1723 action=accept\n/ip firewall filter add chain=input protocol=gre action=accept' },
    ],
  },
  {
    id: 'wifi', module: 'wireless', title: 'Secure access point with isolation', start: 'bridged',
    intro: 'Turn wlan1 into a WPA2 access point for your group, bridge it into the LAN and isolate wireless clients from each other.',
    tasks: [
      { t: 'Security profile group33: dynamic-keys, wpa2-psk, aes-ccm, key 12+ characters', c: (st) => L(st, 'interface wireless security-profiles').some((p) => p.name === 'group33' && p.mode === 'dynamic-keys' && /wpa2-psk/.test(p['authentication-types'] || '') && /aes-ccm/.test(p['unicast-ciphers'] || '') && (p['wpa2-pre-shared-key'] || '').length >= 12), h: '/interface wireless security-profiles add name=group33 mode=dynamic-keys authentication-types=wpa2-psk unicast-ciphers=aes-ccm group-ciphers=aes-ccm wpa2-pre-shared-key=MTCNA-Lab-2026' },
      { t: 'wlan1: mode ap-bridge, SSID AP_33_1, band 2ghz-b/g/n, profile group33', c: (st) => { const w = st.wireless.wlan1; return w && w.mode === 'ap-bridge' && w.ssid === 'AP_33_1' && w.band === '2ghz-b/g/n' && w['security-profile'] === 'group33' }, h: '/interface wireless set wlan1 mode=ap-bridge ssid=AP_33_1 band=2ghz-b/g/n security-profile=group33' },
      { t: 'Use a non-overlapping channel: 2412, 2437 or 2462 MHz', c: (st) => ['2412', '2437', '2462'].includes(String(st.wireless.wlan1.frequency)), h: '/interface wireless set wlan1 frequency=2437' },
      { t: 'Isolate clients (default-forward=no)', c: (st) => st.wireless.wlan1['default-forward'] === 'no', h: '/interface wireless set wlan1 default-forward=no' },
      { t: 'Add wlan1 to bridgeLAN and enable it (R flag)', c: (st) => bridgeOf(st, 'wlan1') === 'bridgeLAN' && isRunning(st, 'wlan1'), h: '/interface bridge port add bridge=bridgeLAN interface=wlan1\n/interface wireless enable wlan1' },
    ],
  },
  {
    id: 'tools', module: 'tools', title: 'Time, MAC server and monitoring', start: 'online',
    intro: 'Final housekeeping: correct time, lock down MAC access to the LAN and alert when the ISP goes down.',
    tasks: [
      { t: 'Set time zone Europe/Riga', c: (st) => S(st, 'system clock')['time-zone-name'] === 'Europe/Riga', h: '/system clock set time-zone-name=Europe/Riga' },
      { t: 'Enable the NTP client with server pool.ntp.org', c: (st) => S(st, 'system ntp client').enabled === 'yes' && /pool\.ntp\.org/.test(S(st, 'system ntp client').servers || ''), h: '/system ntp client set enabled=yes servers=pool.ntp.org' },
      { t: 'Create interface list LAN containing bridgeLAN', c: (st) => L(st, 'interface list member').some((m) => m.list === 'LAN' && m.interface === 'bridgeLAN'), h: '/interface list add name=LAN\n/interface list member add list=LAN interface=bridgeLAN' },
      { t: 'Restrict MAC server and MAC-Winbox to the LAN list', c: (st) => S(st, 'tool mac-server')['allowed-interface-list'] === 'LAN' && S(st, 'tool mac-server mac-winbox')['allowed-interface-list'] === 'LAN', h: '/tool mac-server set allowed-interface-list=LAN\n/tool mac-server mac-winbox set allowed-interface-list=LAN' },
      { t: 'Netwatch the ISP gateway 22.1.1.1 (status up)', c: (st) => L(st, 'tool netwatch').some((n) => n.host === '22.1.1.1' && on(n)), h: '/tool netwatch add host=22.1.1.1 interval=10s down-script=":log warning ISP-down"' },
      { t: 'Create a supout.rif file', c: (st) => st.files.some((f) => f.name === 'supout.rif'), h: '/system sup-output' },
    ],
  },
]

export function makeLabState(lab) {
  const st = STARTS[lab.start]()
  if (lab.setup) lab.setup(st)
  return st
}

export function labProgress(lab, st) {
  return lab.tasks.map((t) => { try { return !!t.c(st) } catch { return false } })
}
