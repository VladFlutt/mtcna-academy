// MTCSE guided labs. Same idea as the MTCNA labs: every task has a live check on the simulated
// router. Security tasks are checked by behaviour where possible: replay() sends real packet
// sequences (an SSH brute force, a port scan, a port knock) through RAW and the filter rules.

import { T } from '../i18n.js'
import { STARTS, run } from '../labs.js'
import { evalChain, laptopInternet, replay } from '../routeros.js'

const on = (x) => x && x.disabled !== 'yes'
const L = (st, p) => st.lists[p] || []
const S = (st, p) => st.singletons[p] || {}
const svc = (st, n) => st.services.find((s) => s.name === n)
const cert = (st, n) => L(st, 'certificate').find((c) => c.name === n)

const WAN_HOST = '203.0.113.50'
const ROUTER_WAN = '22.1.1.33'
const fromWan = (extra) => ({ src: WAN_HOST, dst: ROUTER_WAN, inIf: 'ether1', state: 'new', ...extra })
const fromLan = (extra) => ({ src: '192.168.33.2', dst: '192.168.33.1', inIf: 'bridgeLAN', state: 'new', ...extra })
// A new connection to the router: RAW prerouting first, then filter input
const inputOk = (st, p) => evalChain(st, 'raw', 'prerouting', { ...p }).verdict !== 'drop' && evalChain(st, 'filter', 'input', { ...p }).verdict === 'accept'
const forwardWanToLan = (st) => evalChain(st, 'filter', 'forward', { src: WAN_HOST, dst: '192.168.33.10', protocol: 'tcp', dstPort: 445, inIf: 'ether1', outIf: 'bridgeLAN', state: 'new' }).verdict === 'accept'
const firstInput = (st) => L(st, 'ip firewall filter').filter((r) => on(r) && r.chain === 'input')[0]

const SECURE_FW = [
  '/interface list add name=LAN', '/interface list add name=WAN',
  '/interface list member add list=LAN interface=bridgeLAN', '/interface list member add list=WAN interface=ether1',
  '/ip firewall filter add chain=input action=accept connection-state=established,related,untracked comment="accept established,related,untracked"',
  '/ip firewall filter add chain=input action=drop connection-state=invalid comment="drop invalid"',
  '/ip firewall filter add chain=input action=accept protocol=icmp comment="accept ICMP"',
  '/ip firewall filter add chain=input action=drop in-interface-list=!LAN comment="drop all not coming from LAN"',
  '/ip firewall filter add chain=forward action=accept connection-state=established,related,untracked comment="accept established,related,untracked"',
  '/ip firewall filter add chain=forward action=drop connection-state=invalid comment="drop invalid"',
  '/ip firewall filter add chain=forward action=drop connection-state=new connection-nat-state=!dstnat in-interface-list=WAN comment="drop all from WAN not DSTNATed"',
]
const BRUTE_FW = [
  '/ip firewall filter add chain=input protocol=tcp dst-port=22 src-address-list=ssh_blacklist action=drop comment="drop SSH brute forcers"',
  '/ip firewall filter add chain=input protocol=tcp dst-port=22 connection-state=new src-address-list=ssh_stage3 action=add-src-to-address-list address-list=ssh_blacklist address-list-timeout=10d',
  '/ip firewall filter add chain=input protocol=tcp dst-port=22 connection-state=new src-address-list=ssh_stage2 action=add-src-to-address-list address-list=ssh_stage3 address-list-timeout=1m',
  '/ip firewall filter add chain=input protocol=tcp dst-port=22 connection-state=new src-address-list=ssh_stage1 action=add-src-to-address-list address-list=ssh_stage2 address-list-timeout=1m',
  '/ip firewall filter add chain=input protocol=tcp dst-port=22 connection-state=new action=add-src-to-address-list address-list=ssh_stage1 address-list-timeout=1m',
]
const PKI = [
  '/certificate add name=ca common-name=ca key-usage=key-cert-sign,crl-sign days-valid=3650', '/certificate sign ca',
  '/certificate add name=server common-name=22.1.1.33 subject-alt-name=IP:22.1.1.33 key-usage=tls-server days-valid=3650', '/certificate sign server ca=ca',
  '/certificate add name=client1 common-name=client1 key-usage=tls-client days-valid=3650', '/certificate sign client1 ca=ca',
]
// Files a public CA (for example Let's Encrypt or sslforfree) gives you for vpn.example.com
const CA_FILES = [
  { name: 'certificate.crt', type: '.crt file', cert: { cn: 'vpn.example.com', san: 'DNS:vpn.example.com', ku: 'digital-signature,key-encipherment,tls-server', keyId: 'vpn' } },
  { name: 'ca_bundle.crt', type: '.crt file', cert: { cn: 'R11 (intermediate CA)', ku: 'key-cert-sign,crl-sign', ca: true, fp: '6b7a0d1e2f305c44' } },
  { name: 'private.key', type: '.key file', key: 'vpn' },
]

const SE_STARTS = {
  online: () => STARTS.online(),
  secure: () => run(STARTS.online(), SECURE_FW),
  brute: () => run(STARTS.online(), BRUTE_FW),
  certfiles: () => { const st = run(STARTS.online(), SECURE_FW); st.files.push(...CA_FILES.map((f) => ({ ...f }))); return st },
  pki: () => run(STARTS.online(), [...SECURE_FW, ...PKI]),
}
export const START_LABEL = {
  default: T('default config', 'конфигурация по умолчанию'), online: T('router online, no firewall', 'маршрутизатор в сети, без файрвола'),
  secure: T('online with a strict firewall', 'в сети, строгий файрвол'), brute: T('online with SSH brute-force rules', 'в сети, правила против перебора SSH'),
  certfiles: T('strict firewall + certificate files', 'строгий файрвол + файлы сертификата'), pki: T('strict firewall + CA, server and client certificates', 'строгий файрвол + CA, сертификаты сервера и клиента'),
}

// ---------- behaviour probes ----------
const sshAttack = (st, src = WAN_HOST) => replay(st, [0, 4, 8, 12, 16].map((t) => ({ t, src, dst: ROUTER_WAN, protocol: 'tcp', dstPort: 22, inIf: 'ether1' })))
const knock = (st, ports) => replay(st, ports.map((port, i) => ({ t: i, src: WAN_HOST, dst: ROUTER_WAN, protocol: 'tcp', dstPort: port, inIf: 'ether1' })))
const lastOk = (r) => r.results[r.results.length - 1].verdict === 'accept'
const portScan = (st) => replay(st, [...Array(25).keys()].map((i) => ({ t: i * 0.05, src: '198.51.100.7', dst: ROUTER_WAN, protocol: 'tcp', dstPort: 1000 + i * 7, inIf: 'ether1' })).concat([{ t: 3, src: '198.51.100.7', dst: ROUTER_WAN, protocol: 'icmp', inIf: 'ether1' }]))

export const SE_LABS = [
  {
    id: 'se-harden', module: 'se-intro', start: 'default', init: STARTS.default,
    title: T('Harden a router with the default configuration', 'Защита маршрутизатора с конфигурацией по умолчанию'),
    intro: T('A new hAP straight out of the box. Close everything an attacker could try first: the default user, clear-text services, open management ports and services nobody uses. The LAN is 192.168.88.0/24.', 'Новый hAP прямо из коробки. Закройте всё, что атакующий попробует первым: пользователя по умолчанию, сервисы с открытыми паролями, лишние порты управления и неиспользуемые сервисы. LAN это 192.168.88.0/24.'),
    tasks: [
      { t: T('Create your own user in group full with a password of at least 10 characters', 'Создайте своего пользователя в группе full с паролем не короче 10 символов'), c: (st) => L(st, 'user').some((u) => on(u) && u.name !== 'admin' && u.group === 'full' && (u.password || '').length >= 10), h: '/user add name=secadmin group=full password=Str0ng-Pass-2026' },
      { t: T('Disable or remove the default user admin', 'Отключите или удалите пользователя admin'), c: (st) => !L(st, 'user').some((u) => u.name === 'admin' && on(u)), h: '/user disable admin' },
      { t: T('Disable telnet, ftp, www, api and api-ssl (keep winbox and ssh)', 'Отключите telnet, ftp, www, api и api-ssl (оставьте winbox и ssh)'), c: (st) => ['telnet', 'ftp', 'www', 'api', 'api-ssl'].every((n) => svc(st, n).disabled === 'yes') && on(svc(st, 'winbox')) && on(svc(st, 'ssh')), h: '/ip service disable telnet,ftp,www,api,api-ssl' },
      { t: T('Allow winbox and ssh only from 192.168.88.0/24', 'Разрешите winbox и ssh только из 192.168.88.0/24'), c: (st) => ['winbox', 'ssh'].every((n) => svc(st, n).address === '192.168.88.0/24'), h: '/ip service set winbox,ssh address=192.168.88.0/24' },
      { t: T('Turn off the bandwidth-test server', 'Выключите сервер bandwidth-test'), c: (st) => S(st, 'tool bandwidth-server').enabled === 'no', h: '/tool bandwidth-server set enabled=no' },
      { t: T('Use only strong SSH ciphers (strong-crypto)', 'Используйте только стойкие шифры SSH (strong-crypto)'), c: (st) => S(st, 'ip ssh')['strong-crypto'] === 'yes', h: '/ip ssh set strong-crypto=yes' },
      { t: T('Check: MAC server, MAC-Winbox and neighbor discovery still work only on the LAN list', 'Проверка: MAC-сервер, MAC-Winbox и neighbor discovery по-прежнему работают только на списке LAN'), c: (st) => S(st, 'tool mac-server')['allowed-interface-list'] === 'LAN' && S(st, 'tool mac-server mac-winbox')['allowed-interface-list'] === 'LAN' && S(st, 'ip neighbor discovery-settings')['discover-interface-list'] === 'LAN', h: '/tool mac-server print\n/ip neighbor discovery-settings print' },
    ],
  },
  {
    id: 'se-firewall', module: 'se-firewall', start: 'online', init: SE_STARTS.online,
    title: T('Build a stateful firewall with RAW protection', 'Stateful-файрвол с защитой в RAW'),
    intro: T('The router is online (WAN ether1 22.1.1.33, LAN bridgeLAN 192.168.33.0/24) and has no firewall at all. Build the input and forward chains in the right order, then drop spoofed private sources from the WAN already in RAW. The laptop must keep its Internet access.', 'Маршрутизатор в сети (WAN ether1 22.1.1.33, LAN bridgeLAN 192.168.33.0/24) и вообще без файрвола. Постройте цепочки input и forward в правильном порядке, затем отбрасывайте поддельные частные адреса из WAN уже в RAW. Ноутбук должен сохранить доступ в Интернет.'),
    tasks: [
      { t: T('First input rule: accept established, related (and untracked)', 'Первое правило input: accept established, related (и untracked)'), c: (st) => { const r = firstInput(st); return !!r && (r.action || 'accept') === 'accept' && /established/.test(r['connection-state'] || '') && /related/.test(r['connection-state'] || '') }, h: '/ip firewall filter add chain=input connection-state=established,related,untracked action=accept' },
      { t: T('Drop invalid packets in input and in forward', 'Отбрасывайте invalid в input и в forward'), c: (st) => ['input', 'forward'].every((ch) => L(st, 'ip firewall filter').some((r) => on(r) && r.chain === ch && r.action === 'drop' && r['connection-state'] === 'invalid')), h: '/ip firewall filter add chain=input connection-state=invalid action=drop\n/ip firewall filter add chain=forward connection-state=invalid action=drop' },
      { t: T('Router management: Winbox from the WAN is dropped, from the LAN accepted, ping from the WAN still works', 'Управление: Winbox из WAN отбрасывается, из LAN принимается, ping из WAN работает'), c: (st) => !inputOk(st, fromWan({ protocol: 'tcp', dstPort: 8291 })) && inputOk(st, fromLan({ protocol: 'tcp', dstPort: 8291 })) && inputOk(st, fromWan({ protocol: 'icmp' })), h: '/ip firewall filter add chain=input protocol=icmp action=accept\n/ip firewall filter add chain=input in-interface=ether1 action=drop' },
      { t: T('Forward: accept established,related and drop new connections from the WAN that are not dst-natted', 'Forward: accept established,related и drop новых соединений из WAN без dst-nat'), c: (st) => !forwardWanToLan(st) && L(st, 'ip firewall filter').some((r) => on(r) && r.chain === 'forward' && (r.action || 'accept') === 'accept' && /established/.test(r['connection-state'] || '')), h: '/ip firewall filter add chain=forward connection-state=established,related,untracked action=accept place-before=0\n/ip firewall filter add chain=forward in-interface=ether1 connection-state=new connection-nat-state=!dstnat action=drop' },
      { t: T('Address list not_in_internet with 10.0.0.0/8, 172.16.0.0/12 and 192.168.0.0/16', 'Address list not_in_internet с 10.0.0.0/8, 172.16.0.0/12 и 192.168.0.0/16'), c: (st) => ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'].every((a) => L(st, 'ip firewall address-list').some((x) => on(x) && x.list === 'not_in_internet' && x.address === a)), h: '/ip firewall address-list add list=not_in_internet address=10.0.0.0/8\n/ip firewall address-list add list=not_in_internet address=172.16.0.0/12\n/ip firewall address-list add list=not_in_internet address=192.168.0.0/16' },
      { t: T('RAW prerouting: drop packets from the WAN whose source is in not_in_internet (spoofing). LAN traffic must not be affected', 'RAW prerouting: отбрасывайте пакеты из WAN с источником из not_in_internet (спуфинг). Трафик LAN не должен пострадать'), c: (st) => evalChain(st, 'raw', 'prerouting', { src: '192.168.1.5', dst: ROUTER_WAN, protocol: 'tcp', dstPort: 80, inIf: 'ether1', state: 'new' }).verdict === 'drop' && evalChain(st, 'raw', 'prerouting', { src: WAN_HOST, dst: ROUTER_WAN, protocol: 'icmp', inIf: 'ether1', state: 'new' }).verdict !== 'drop' && laptopInternet(st).ok, h: '/ip firewall raw add chain=prerouting in-interface=ether1 src-address-list=not_in_internet action=drop' },
      { t: T('Check: the laptop still has Internet access', 'Проверка: у ноутбука по-прежнему есть Интернет'), c: (st) => laptopInternet(st).ok && L(st, 'ip firewall filter').length >= 5, h: T('Look at the laptop panel; if it is offline, the reason tells you which chain blocks it', 'Смотрите панель ноутбука; если он не в сети, причина подскажет, какая цепочка блокирует') },
    ],
  },
  {
    id: 'se-bruteforce', module: 'se-attacks', start: 'online', init: SE_STARTS.online,
    title: T('Stop an SSH brute-force attack', 'Защита SSH от подбора пароля'),
    intro: T('Bots on the Internet try thousands of passwords against SSH. Build the classic staged address-list protection: every new SSH connection moves the source one stage up (stage1, stage2, stage3) and the fourth new connection within a minute lands it in ssh_blacklist for 10 days. The checker replays a real attack from 203.0.113.50.', 'Боты в Интернете перебирают тысячи паролей к SSH. Постройте классическую защиту на этапах address list: каждое новое SSH-соединение поднимает источник на этап выше (stage1, stage2, stage3), а четвёртое новое соединение за минуту отправляет его в ssh_blacklist на 10 дней. Проверка воспроизводит настоящую атаку с 203.0.113.50.'),
    tasks: [
      { t: T('Drop SSH (tcp 22) from sources in ssh_blacklist, as the first of the SSH rules', 'Отбрасывайте SSH (tcp 22) от источников из ssh_blacklist, первым из правил SSH'), c: (st) => { const rs = L(st, 'ip firewall filter').filter((r) => on(r) && r.chain === 'input' && r['dst-port'] === '22'); return rs.length > 0 && rs[0].action === 'drop' && rs[0]['src-address-list'] === 'ssh_blacklist' }, h: '/ip firewall filter add chain=input protocol=tcp dst-port=22 src-address-list=ssh_blacklist action=drop' },
      { t: T('Stage rules in order stage3 → blacklist (10d), stage2 → stage3, stage1 → stage2, new → stage1 (1m each), only for connection-state=new', 'Правила этапов по порядку stage3 → blacklist (10d), stage2 → stage3, stage1 → stage2, new → stage1 (по 1m), только для connection-state=new'), c: (st) => { const rs = L(st, 'ip firewall filter').filter((r) => on(r) && r.action === 'add-src-to-address-list' && r['dst-port'] === '22'); const want = ['ssh_blacklist', 'ssh_stage3', 'ssh_stage2', 'ssh_stage1']; return rs.length >= 4 && want.every((w, i) => rs[i] && rs[i]['address-list'] === w && rs[i]['connection-state'] === 'new') && rs[0]['address-list-timeout'] === '10d' }, h: BRUTE_FW.slice(1).join('\n') },
      { t: T('Replay: 5 SSH logins in 16 s from 203.0.113.50: the 5th is dropped and the host is in ssh_blacklist', 'Повтор атаки: 5 входов по SSH за 16 с с 203.0.113.50: 5-й отброшен, хост в ssh_blacklist'), c: (st) => { const r = sshAttack(st); return r.results[4].verdict === 'drop' && (r.lists.ssh_blacklist || []).includes(WAN_HOST) }, h: '/ip firewall filter print\n/ip firewall address-list print' },
      { t: T('An admin who logs in once or twice is not blocked', 'Администратор, вошедший один-два раза, не блокируется'), c: (st) => { const r = replay(st, [0, 30].map((t) => ({ t, src: '198.51.100.20', dst: ROUTER_WAN, protocol: 'tcp', dstPort: 22, inIf: 'ether1' }))); return r.results.every((x) => x.verdict === 'accept') && !(r.lists.ssh_blacklist || []).includes('198.51.100.20') && L(st, 'ip firewall filter').some((r) => r['address-list'] === 'ssh_stage1') }, h: T('Stage timeouts of 1m let normal logins expire from the lists', 'Таймауты этапов 1m позволяют обычным входам «выпадать» из списков') },
    ],
  },
  {
    id: 'se-scan', module: 'se-attacks', start: 'secure', init: SE_STARTS.secure,
    title: T('Detect port scans and blunt SYN floods', 'Обнаружение сканирования портов и защита от SYN flood'),
    intro: T('The router already has a strict stateful firewall. Add attack detection: catch port scanners with PSD and drop them cheaply in RAW, enable SYN cookies, use strict reverse-path filtering and watch the LAN for rogue DHCP servers.', 'У маршрутизатора уже есть строгий stateful-файрвол. Добавьте обнаружение атак: ловите сканеры портов через PSD и дёшево отбрасывайте их в RAW, включите SYN cookies, строгую проверку обратного пути и следите за чужими DHCP-серверами в LAN.'),
    tasks: [
      { t: T('Input rule with psd=21,3s,3,1 that adds TCP scanners to the list port_scanners for 2 weeks (before the final drop)', 'Правило input с psd=21,3s,3,1, которое заносит TCP-сканеры в список port_scanners на 2 недели (до финального drop)'), c: (st) => (portScan(st).lists.port_scanners || []).includes('198.51.100.7') && L(st, 'ip firewall filter').some((r) => r['address-list'] === 'port_scanners' && /^(2w|14d)$/.test(r['address-list-timeout'] || '')), h: '/ip firewall filter add chain=input protocol=tcp psd=21,3s,3,1 action=add-src-to-address-list address-list=port_scanners address-list-timeout=2w place-before=3' },
      { t: T('RAW prerouting: drop everything from port_scanners (a scanner cannot even ping after the scan)', 'RAW prerouting: отбрасывайте всё от port_scanners (после скана сканер не может даже пинговать)'), c: (st) => { const r = portScan(st); return r.results[r.results.length - 1].verdict === 'drop' && r.results[r.results.length - 1].table === 'raw' }, h: '/ip firewall raw add chain=prerouting src-address-list=port_scanners action=drop' },
      { t: T('Enable TCP SYN cookies', 'Включите TCP SYN cookies'), c: (st) => S(st, 'ip settings')['tcp-syncookies'] === 'yes', h: '/ip settings set tcp-syncookies=yes' },
      { t: T('Enable strict reverse-path filtering (anti-spoofing)', 'Включите строгую проверку обратного пути (rp-filter, антиспуфинг)'), c: (st) => S(st, 'ip settings')['rp-filter'] === 'strict', h: '/ip settings set rp-filter=strict' },
      { t: T('Alert on rogue DHCP servers on bridgeLAN', 'Оповещение о чужих DHCP-серверах на bridgeLAN'), c: (st) => L(st, 'ip dhcp-server alert').some((a) => on(a) && a.interface === 'bridgeLAN'), h: '/ip dhcp-server alert add interface=bridgeLAN alert-timeout=1h on-alert=":log warning \\"rogue DHCP\\""' },
      { t: T('Check: normal visitors are not affected (ping from the WAN works, the laptop is online)', 'Проверка: обычный трафик не страдает (ping из WAN работает, ноутбук в сети)'), c: (st) => inputOk(st, fromWan({ protocol: 'icmp' })) && laptopInternet(st).ok, h: '/ping 192.168.33.2' },
    ],
  },
  {
    id: 'se-pki', module: 'se-crypto', start: 'secure', init: SE_STARTS.secure,
    title: T('Build your own PKI on RouterOS', 'Собственная PKI на RouterOS'),
    intro: T('Create a private certificate authority on the router, issue a server certificate for the WAN address 22.1.1.33 and a client certificate, then export what the clients need. (The slides use 2.2.2.2 as the server address; in our lab topology the WAN address is 22.1.1.33.)', 'Создайте на маршрутизаторе собственный центр сертификации, выпустите сертификат сервера для WAN-адреса 22.1.1.33 и сертификат клиента, затем экспортируйте то, что нужно клиентам. (На слайдах адрес сервера 2.2.2.2; в нашей лабораторной топологии WAN-адрес 22.1.1.33.)'),
    tasks: [
      { t: T('CA template: name ca, common-name ca, key-usage key-cert-sign,crl-sign, valid 10 years', 'Шаблон CA: name ca, common-name ca, key-usage key-cert-sign,crl-sign, срок 10 лет'), c: (st) => { const c = cert(st, 'ca'); return !!c && /key-cert-sign/.test(c['key-usage'] || '') && Number(c['days-valid']) >= 3650 }, h: '/certificate add name=ca common-name=ca key-usage=key-cert-sign,crl-sign days-valid=3650' },
      { t: T('Self-sign the CA (flags K, A, T)', 'Подпишите CA самим собой (флаги K, A, T)'), c: (st) => { const c = cert(st, 'ca'); return !!c && c['.signed'] && c['.ca'] && c['.key'] && c.trusted === 'yes' }, h: '/certificate sign ca' },
      { t: T('Server certificate "server": common-name 22.1.1.33, subject-alt-name IP:22.1.1.33, key-usage tls-server, signed by ca', 'Сертификат сервера «server»: common-name 22.1.1.33, subject-alt-name IP:22.1.1.33, key-usage tls-server, подписан ca'), c: (st) => { const c = cert(st, 'server'); return !!c && c['common-name'] === '22.1.1.33' && /IP:22\.1\.1\.33/.test(c['subject-alt-name'] || '') && /tls-server/.test(c['key-usage'] || '') && c['.issuer'] === 'ca' }, h: '/certificate add name=server common-name=22.1.1.33 subject-alt-name=IP:22.1.1.33 key-usage=tls-server days-valid=3650\n/certificate sign server ca=ca' },
      { t: T('Client certificate "client1": key-usage tls-client, signed by ca', 'Сертификат клиента «client1»: key-usage tls-client, подписан ca'), c: (st) => { const c = cert(st, 'client1'); return !!c && /tls-client/.test(c['key-usage'] || '') && c['.issuer'] === 'ca' }, h: '/certificate add name=client1 common-name=client1 key-usage=tls-client days-valid=3650\n/certificate sign client1 ca=ca' },
      { t: T('Export the CA certificate (PEM, without the key) for the clients', 'Экспортируйте сертификат CA (PEM, без ключа) для клиентов'), c: (st) => st.files.some((f) => f.name === 'cert_export_ca.crt') && !st.files.some((f) => f.name === 'cert_export_ca.key'), h: '/certificate export-certificate ca' },
      { t: T('Export client1 as PKCS#12 with a passphrase of 8+ characters', 'Экспортируйте client1 в PKCS#12 с паролем от 8 символов'), c: (st) => st.files.some((f) => f.name === 'cert_export_client1.p12'), h: '/certificate export-certificate client1 type=pkcs12 export-passphrase=Client1-Pass' },
    ],
  },
  {
    id: 'se-ports', module: 'se-router', start: 'online', init: SE_STARTS.online,
    title: T('Move services off default ports (slides, chapter 5)', 'Перенос сервисов с портов по умолчанию (слайды, глава 5)'),
    intro: T('Repeat the IP Service List from the slide: disable what you do not use, move the rest to non-standard ports, give WebFig HTTPS a certificate and allow SSH port forwarding for tunnels. Moving ports only hides services from lazy scanners, so the web services are also limited to the LAN.', 'Повторите IP Service List со слайда: отключите неиспользуемое, перенесите остальное на нестандартные порты, дайте WebFig по HTTPS сертификат и разрешите проброс портов через SSH для туннелей. Смена портов лишь прячет сервисы от ленивых сканеров, поэтому веб-сервисы ещё и ограничены LAN.'),
    tasks: [
      { t: T('Disable telnet, ftp and api', 'Отключите telnet, ftp и api'), c: (st) => ['telnet', 'ftp', 'api'].every((n) => svc(st, n).disabled === 'yes'), h: '/ip service set telnet disabled=yes\n/ip service set ftp disabled=yes\n/ip service set api disabled=yes' },
      { t: T('www on port 8800, ssh on 22000, winbox on 58291', 'www на порт 8800, ssh на 22000, winbox на 58291'), c: (st) => svc(st, 'www').port === '8800' && svc(st, 'ssh').port === '22000' && svc(st, 'winbox').port === '58291', h: '/ip service set www port=8800\n/ip service set ssh port=22000\n/ip service set winbox port=58291' },
      { t: T('Create and self-sign a certificate "webfig" (common-name 192.168.33.1)', 'Создайте и подпишите сертификат «webfig» (common-name 192.168.33.1)'), c: (st) => { const c = cert(st, 'webfig'); return !!c && c['.signed'] && c['.key'] }, h: '/certificate add name=webfig common-name=192.168.33.1 key-usage=tls-server\n/certificate sign webfig' },
      { t: T('Enable www-ssl on port 44300 with the certificate webfig', 'Включите www-ssl на порту 44300 с сертификатом webfig'), c: (st) => { const s = svc(st, 'www-ssl'); return on(s) && s.port === '44300' && s.certificate === 'webfig' }, h: '/ip service set www-ssl disabled=no port=44300 certificate=webfig' },
      { t: T('Limit www and www-ssl to 192.168.33.0/24', 'Ограничьте www и www-ssl сетью 192.168.33.0/24'), c: (st) => ['www', 'www-ssl'].every((n) => svc(st, n).address === '192.168.33.0/24'), h: '/ip service set www,www-ssl address=192.168.33.0/24' },
      { t: T('Allow SSH port forwarding (local and remote) for SSH tunnels', 'Разрешите проброс портов SSH (local и remote) для SSH-туннелей'), c: (st) => S(st, 'ip ssh')['forwarding-enabled'] === 'both', h: '/ip ssh set forwarding-enabled=both' },
    ],
  },
  {
    id: 'se-knock', module: 'se-router', start: 'brute', init: SE_STARTS.brute,
    title: T('Open Winbox with port knocking (slides lab, chapter 5)', 'Доступ к Winbox через port knocking (лаба со слайдов, глава 5)'),
    intro: T('The slide lab: "Open access to the router by Winbox with Port Knocking rules. Do the task in a new chain, and the brute-force password protection must stay." SSH brute-force rules are already loaded. Knock sequence: TCP 11111, then 22222, then 33333; only then Winbox (8291) opens for that source for a day.', 'Лаба со слайдов: «Откройте доступ до роутера по Winbox с помощью правил Port Knocking. Выполнить задачу нужно в новой цепочке, при этом должна сохраниться защита от подбора паролей». Правила против перебора SSH уже загружены. Последовательность стука: TCP 11111, затем 22222, затем 33333; только после этого Winbox (8291) открывается для этого источника на сутки.'),
    tasks: [
      { t: T('Create the knock rules in a new chain called knock: 11111 → knock1 (10s), 22222 from knock1 → knock2 (10s), 33333 from knock2 → knock-final (1d)', 'Создайте правила стука в новой цепочке knock: 11111 → knock1 (10s), 22222 из knock1 → knock2 (10s), 33333 из knock2 → knock-final (1d)'), c: (st) => { const rs = L(st, 'ip firewall filter').filter((r) => on(r) && r.chain === 'knock' && r.action === 'add-src-to-address-list'); return ['knock1', 'knock2', 'knock-final'].every((l) => rs.some((r) => r['address-list'] === l)) && rs.some((r) => r['address-list'] === 'knock-final' && r['address-list-timeout'] === '1d') }, h: '/ip firewall filter add chain=knock protocol=tcp dst-port=11111 action=add-src-to-address-list address-list=knock1 address-list-timeout=10s\n/ip firewall filter add chain=knock protocol=tcp dst-port=22222 src-address-list=knock1 action=add-src-to-address-list address-list=knock2 address-list-timeout=10s\n/ip firewall filter add chain=knock protocol=tcp dst-port=33333 src-address-list=knock2 action=add-src-to-address-list address-list=knock-final address-list-timeout=1d' },
      { t: T('Jump from input to the knock chain', 'Сделайте jump из input в цепочку knock'), c: (st) => L(st, 'ip firewall filter').some((r) => on(r) && r.chain === 'input' && r.action === 'jump' && r['jump-target'] === 'knock'), h: '/ip firewall filter add chain=input protocol=tcp action=jump jump-target=knock' },
      { t: T('Drop Winbox (tcp 8291) for sources not in knock-final', 'Отбрасывайте Winbox (tcp 8291) для источников не из knock-final'), c: (st) => !lastOk(knock(st, [8291])), h: '/ip firewall filter add chain=input protocol=tcp dst-port=8291 src-address-list=!knock-final action=drop' },
      { t: T('Replay: knock 11111, 22222, 33333, then Winbox is accepted', 'Повтор: стук 11111, 22222, 33333, затем Winbox принимается'), c: (st) => lastOk(knock(st, [11111, 22222, 33333, 8291])) && !lastOk(knock(st, [8291])), h: T('Order matters: the knock rules must run before the Winbox drop', 'Порядок важен: правила стука должны срабатывать до drop для Winbox') },
      { t: T('Replay: a wrong order (33333, 22222, 11111) or a skipped knock does not open Winbox', 'Повтор: неверный порядок (33333, 22222, 11111) или пропущенный стук не открывают Winbox'), c: (st) => !lastOk(knock(st, [33333, 22222, 11111, 8291])) && !lastOk(knock(st, [11111, 33333, 8291])) && L(st, 'ip firewall filter').some((r) => r.chain === 'knock'), h: T('Each stage must require the previous list (src-address-list=knock1, knock2)', 'Каждый этап должен требовать предыдущий список (src-address-list=knock1, knock2)') },
      { t: T('The SSH brute-force protection still works (5th fast SSH attempt dropped)', 'Защита SSH от перебора по-прежнему работает (5-я быстрая попытка отброшена)'), c: (st) => sshAttack(st).results[4].verdict === 'drop' && L(st, 'ip firewall filter').some((r) => on(r) && r['jump-target'] === 'knock'), h: '/ip firewall filter print' },
    ],
  },
  {
    id: 'se-l2tp', module: 'se-tunnels', start: 'secure', init: SE_STARTS.secure,
    title: T('L2TP/IPsec server for a laptop (slides lab, chapter 7)', 'Сервер L2TP/IPsec для ноутбука (лаба со слайдов, глава 7)'),
    intro: T('Slide lab: "Set up an L2TP+IPsec server for your laptop and connect the client." The router has a strict firewall that drops everything from the WAN, so you also have to open IKE and NAT-T, ESP, and L2TP only inside IPsec. Insert the accept rules before the final drop (place-before).', 'Лаба со слайдов: «Настройте сервер L2TP+IPsec для своего ноутбука и подключите клиента». У маршрутизатора строгий файрвол, который отбрасывает всё из WAN, поэтому нужно открыть IKE и NAT-T, ESP и L2TP только внутри IPsec. Вставляйте правила accept перед финальным drop (place-before).'),
    tasks: [
      { t: T('Enable the L2TP server with IPsec required, an IPsec secret of 8+ characters, mschap2 only and profile default-encryption', 'Включите L2TP-сервер с обязательным IPsec, IPsec-секретом от 8 символов, только mschap2 и профилем default-encryption'), c: (st) => { const s = S(st, 'interface l2tp-server server'); return s.enabled === 'yes' && ['yes', 'required'].includes(s['use-ipsec']) && (s['ipsec-secret'] || '').length >= 8 && s.authentication === 'mschap2' && s['default-profile'] === 'default-encryption' }, h: '/interface l2tp-server server set enabled=yes use-ipsec=required ipsec-secret=L2tp-Shared-Key authentication=mschap2 default-profile=default-encryption' },
      { t: T('PPP secret test: service l2tp, local-address 10.1.1.1, remote-address 10.1.1.2', 'PPP secret test: service l2tp, local-address 10.1.1.1, remote-address 10.1.1.2'), c: (st) => L(st, 'ppp secret').some((p) => on(p) && p.name === 'test' && p.service === 'l2tp' && p['local-address'] === '10.1.1.1' && p['remote-address'] === '10.1.1.2' && (p.password || '').length > 0), h: '/ppp secret add name=test password=Test-Pass-1 service=l2tp local-address=10.1.1.1 remote-address=10.1.1.2' },
      { t: T('Input accepts IKE and NAT-T from the WAN (UDP 500 and 4500)', 'Input принимает IKE и NAT-T из WAN (UDP 500 и 4500)'), c: (st) => inputOk(st, fromWan({ protocol: 'udp', dstPort: 500 })) && inputOk(st, fromWan({ protocol: 'udp', dstPort: 4500 })), h: '/ip firewall filter print\n/ip firewall filter add chain=input in-interface=ether1 protocol=udp dst-port=500,4500 action=accept place-before=3' },
      { t: T('Input accepts ESP (protocol ipsec-esp)', 'Input принимает ESP (protocol ipsec-esp)'), c: (st) => inputOk(st, fromWan({ protocol: 'ipsec-esp' })), h: '/ip firewall filter add chain=input in-interface=ether1 protocol=ipsec-esp action=accept place-before=3' },
      { t: T('L2TP (UDP 1701) is accepted only when it arrived inside IPsec (ipsec-policy=in,ipsec); plain L2TP is dropped', 'L2TP (UDP 1701) принимается только пришедший внутри IPsec (ipsec-policy=in,ipsec); L2TP без IPsec отбрасывается'), c: (st) => inputOk(st, fromWan({ protocol: 'udp', dstPort: 1701, ipsecIn: true })) && !inputOk(st, fromWan({ protocol: 'udp', dstPort: 1701 })), h: '/ip firewall filter add chain=input in-interface=ether1 protocol=udp dst-port=1701 ipsec-policy=in,ipsec action=accept place-before=3' },
      { t: T('Check: Winbox from the WAN is still dropped and the laptop is online', 'Проверка: Winbox из WAN по-прежнему отбрасывается, ноутбук в сети'), c: (st) => !inputOk(st, fromWan({ protocol: 'tcp', dstPort: 8291 })) && laptopInternet(st).ok, h: '/ip firewall filter print' },
    ],
  },
  {
    id: 'se-sstp', module: 'se-tunnels', start: 'certfiles', init: SE_STARTS.certfiles,
    title: T('SSTP server with a public certificate (slides, chapter 7)', 'SSTP-сервер с публичным сертификатом (слайды, глава 7)'),
    intro: T('As on the slides, a public CA issued certificate.crt, ca_bundle.crt and private.key for vpn.example.com, and you uploaded them to Files. Import them, run the SSTP server on TCP 443 with that certificate and add the user test2. Windows clients check the certificate, so the client must trust the issuer and connect by the name in the certificate.', 'Как на слайдах, публичный CA выпустил certificate.crt, ca_bundle.crt и private.key для vpn.example.com, и вы загрузили их в Files. Импортируйте их, запустите SSTP-сервер на TCP 443 с этим сертификатом и добавьте пользователя test2. Клиенты Windows проверяют сертификат, поэтому клиент должен доверять издателю и подключаться по имени из сертификата.'),
    tasks: [
      { t: T('Import certificate.crt and ca_bundle.crt', 'Импортируйте certificate.crt и ca_bundle.crt'), c: (st) => !!cert(st, 'certificate.crt_0') && !!cert(st, 'ca_bundle.crt_0'), h: '/file print\n/certificate import file-name=certificate.crt passphrase=""\n/certificate import file-name=ca_bundle.crt passphrase=""' },
      { t: T('Import private.key so certificate.crt_0 gets the K (private key) flag', 'Импортируйте private.key, чтобы у certificate.crt_0 появился флаг K (закрытый ключ)'), c: (st) => !!cert(st, 'certificate.crt_0') && cert(st, 'certificate.crt_0')['.key'], h: '/certificate import file-name=private.key passphrase=""\n/certificate print' },
      { t: T('SSTP server: enabled, certificate certificate.crt_0, port 443, mschap2 only, TLS 1.2 only', 'SSTP-сервер: включён, сертификат certificate.crt_0, порт 443, только mschap2, только TLS 1.2'), c: (st) => { const s = S(st, 'interface sstp-server server'); return s.enabled === 'yes' && s.certificate === 'certificate.crt_0' && s.port === '443' && s.authentication === 'mschap2' && s['tls-version'] === 'only-1.2' }, h: '/interface sstp-server server set enabled=yes certificate=certificate.crt_0 authentication=mschap2 tls-version=only-1.2' },
      { t: T('PPP secret test2: service sstp, local-address 10.1.1.1, remote-address 10.1.1.3', 'PPP secret test2: service sstp, local-address 10.1.1.1, remote-address 10.1.1.3'), c: (st) => L(st, 'ppp secret').some((p) => on(p) && p.name === 'test2' && p.service === 'sstp' && p['local-address'] === '10.1.1.1' && p['remote-address'] === '10.1.1.3'), h: '/ppp secret add name=test2 password=Test2-Pass service=sstp local-address=10.1.1.1 remote-address=10.1.1.3' },
      { t: T('Accept TCP 443 from the WAN in input (before the final drop)', 'Разрешите TCP 443 из WAN в input (до финального drop)'), c: (st) => inputOk(st, fromWan({ protocol: 'tcp', dstPort: 443 })) && !inputOk(st, fromWan({ protocol: 'tcp', dstPort: 8291 })), h: '/ip firewall filter add chain=input in-interface=ether1 protocol=tcp dst-port=443 action=accept place-before=3' },
      { t: T('Port 443 belongs to SSTP: www-ssl is disabled or moved to another port', 'Порт 443 принадлежит SSTP: www-ssl выключен или перенесён на другой порт'), c: (st) => { const s = svc(st, 'www-ssl'); return s.disabled === 'yes' || s.port !== '443' }, h: '/ip service print' },
    ],
  },
  {
    id: 'se-ikev2', module: 'se-tunnels', start: 'pki', init: SE_STARTS.pki,
    title: T('IKEv2 road warrior with certificates (slides "Variante 1")', 'IKEv2 road warrior с сертификатами (слайды «Variante 1»)'),
    intro: T('The certificates ca, server (CN 22.1.1.33) and client1 already exist (step 1 of the slides). Do steps 2 to 5: an address pool for the road warriors, a mode config that hands out addresses and the LAN route, a passive IKEv2 peer with a certificate identity, and a policy template, then open the firewall.', 'Сертификаты ca, server (CN 22.1.1.33) и client1 уже созданы (шаг 1 со слайдов). Выполните шаги 2-5: пул адресов для road warrior, mode config, который выдаёт адреса и маршрут до LAN, пассивный IKEv2-пир с идентификацией по сертификату и шаблон политики, затем откройте файрвол.'),
    tasks: [
      { t: T('Pool rw-pool with 10.1.1.2-10.1.1.50', 'Пул rw-pool с 10.1.1.2-10.1.1.50'), c: (st) => L(st, 'ip pool').some((p) => p.name === 'rw-pool' && p.ranges === '10.1.1.2-10.1.1.50'), h: '/ip pool add name=rw-pool ranges=10.1.1.2-10.1.1.50' },
      { t: T('Mode config cfgIKEv2: responder, address-pool rw-pool, prefix length 32, split-include 192.168.33.0/24', 'Mode config cfgIKEv2: responder, address-pool rw-pool, длина префикса 32, split-include 192.168.33.0/24'), c: (st) => L(st, 'ip ipsec mode-config').some((m) => m.name === 'cfgIKEv2' && m.responder !== 'no' && m['address-pool'] === 'rw-pool' && m['address-prefix-length'] === '32' && m['split-include'] === '192.168.33.0/24'), h: '/ip ipsec mode-config add name=cfgIKEv2 responder=yes address-pool=rw-pool address-prefix-length=32 split-include=192.168.33.0/24 system-dns=no' },
      { t: T('Policy group rw and a template policy 0.0.0.0/0 → 10.1.1.0/24 in that group', 'Группа политик rw и шаблон политики 0.0.0.0/0 → 10.1.1.0/24 в этой группе'), c: (st) => L(st, 'ip ipsec policy group').some((g) => g.name === 'rw') && L(st, 'ip ipsec policy').some((p) => on(p) && p.template === 'yes' && p.group === 'rw' && p['src-address'] === '0.0.0.0/0' && p['dst-address'] === '10.1.1.0/24'), h: '/ip ipsec policy group add name=rw\n/ip ipsec policy add src-address=0.0.0.0/0 dst-address=10.1.1.0/24 template=yes group=rw' },
      { t: T('Peer peerIKEv2: exchange-mode ike2, passive (it waits for clients at any address)', 'Пир peerIKEv2: exchange-mode ike2, passive (ждёт клиентов с любого адреса)'), c: (st) => L(st, 'ip ipsec peer').some((p) => on(p) && p.name === 'peerIKEv2' && p['exchange-mode'] === 'ike2' && p.passive === 'yes'), h: '/ip ipsec peer add name=peerIKEv2 exchange-mode=ike2 passive=yes' },
      { t: T('Identity: peer peerIKEv2, digital-signature with certificate server, generate-policy port-strict, mode-config cfgIKEv2, policy-template-group rw', 'Identity: peer peerIKEv2, digital-signature с сертификатом server, generate-policy port-strict, mode-config cfgIKEv2, policy-template-group rw'), c: (st) => L(st, 'ip ipsec identity').some((i) => on(i) && i.peer === 'peerIKEv2' && i['auth-method'] === 'digital-signature' && i.certificate === 'server' && i['generate-policy'] === 'port-strict' && i['mode-config'] === 'cfgIKEv2' && i['policy-template-group'] === 'rw'), h: '/ip ipsec identity add peer=peerIKEv2 auth-method=digital-signature certificate=server generate-policy=port-strict mode-config=cfgIKEv2 policy-template-group=rw' },
      { t: T('Firewall: accept UDP 500 and 4500 from the WAN and let decrypted traffic from the clients into the LAN (forward ipsec-policy=in,ipsec)', 'Файрвол: разрешите UDP 500 и 4500 из WAN и пропустите расшифрованный трафик клиентов в LAN (forward ipsec-policy=in,ipsec)'), c: (st) => inputOk(st, fromWan({ protocol: 'udp', dstPort: 500 })) && inputOk(st, fromWan({ protocol: 'udp', dstPort: 4500 })) && evalChain(st, 'filter', 'forward', { src: '10.1.1.2', dst: '192.168.33.10', protocol: 'tcp', dstPort: 445, inIf: 'ether1', outIf: 'bridgeLAN', state: 'new', ipsecIn: true }).verdict === 'accept' && !forwardWanToLan(st), h: '/ip firewall filter add chain=input in-interface=ether1 protocol=udp dst-port=500,4500 action=accept place-before=3\n/ip firewall filter add chain=forward ipsec-policy=in,ipsec action=accept place-before=6' },
    ],
  },
]

// Free practice terminal of the MTCSE section: online, strict firewall, the certificate files from the SSTP slides in Files
export const seTerminalStart = SE_STARTS.certfiles
