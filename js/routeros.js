// A small RouterOS CLI simulator. It models enough of RouterOS to practise
// the MTCNA labs: interfaces, bridge, IP, routes, DHCP, DNS, firewall, NAT,
// queues, PPP, wireless, users, services and a few tools.

import { ipToInt, intToIp, parseCidr, inSubnet, matchAddr } from './net.js'
import { checkFilterRule } from './rfilter.js'

// WireGuard keys are 32 random bytes in base64; the simulator derives them from a seed so that a
// lab is repeatable, and the public key is a function of the private key as in real WireGuard.
export function wgKey(kind, seed) {
  let h = 2166136261 >>> 0
  const src = kind + ':' + seed
  const bytes = []
  for (let i = 0; i < 32; i++) {
    for (const ch of src + i) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
    bytes.push(h & 255)
  }
  const b64 = typeof btoa === 'function' ? btoa(String.fromCharCode(...bytes)) : Buffer.from(bytes).toString('base64')
  return b64
}

// Queue rates: 512k, 10M, 1.5M, 1G or a plain number of bits per second. 0 and unlimited mean no limit.
// Returns bits per second (0 for no limit) or null when the value is not a rate.
export function parseRate(v) {
  if (v === undefined || v === null) return null
  v = String(v).trim()
  if (v === 'unlimited' || v === '0') return 0
  const m = /^(\d+(?:\.\d+)?)([kKMG]?)$/.exec(v)
  return m ? Math.round(Number(m[1]) * { '': 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9 }[m[2]]) : null
}

// ---------- simulated world ----------
// ether1 is cabled to the ISP (22.1.1.0/24, gateway/DNS 22.1.1.1, DHCP and PPPoE),
// ether2 is cabled to the student laptop.
export const WORLD = {
  ispNet: '22.1.1.0/24', ispGw: '22.1.1.1', dhcpLease: '22.1.1.100/24',
  pppoeUser: 'class', pppoePass: 'class', pppoeLocal: '10.10.10.50', pppoeRemote: '10.10.10.1',
  names: { 'mikrotik.com': '159.148.147.196', 'google.com': '142.250.74.46', 'mtcna.lab': '5.8.63.23', 'help.mikrotik.com': '159.148.172.251' },
}

const BOOL = ['yes', 'no']
const CHAINS_FILTER = ['input', 'forward', 'output']
const ACT_FILTER = ['accept', 'drop', 'reject', 'jump', 'return', 'log', 'passthrough', 'add-src-to-address-list', 'add-dst-to-address-list', 'fasttrack-connection', 'tarpit']
const ACT_NAT = ['accept', 'masquerade', 'src-nat', 'dst-nat', 'redirect', 'netmap', 'same', 'jump', 'return', 'log', 'passthrough']
const ACT_RAW = ['accept', 'drop', 'notrack', 'jump', 'return', 'log', 'passthrough', 'add-src-to-address-list', 'add-dst-to-address-list']
const ACT_MANGLE = ['mark-connection', 'mark-packet', 'mark-routing', 'change-dscp', 'change-ttl', 'change-mss', 'set-priority', 'strip-ipv4-options', 'sniff-tzsp', 'add-src-to-address-list', 'add-dst-to-address-list', 'accept', 'jump', 'return', 'log', 'passthrough']
const PROXY_RULE = ['src-address', 'dst-address', 'dst-port', 'local-port', 'dst-host', 'path', 'method', 'action', 'redirect-to', 'comment', 'disabled', 'place-before']
const QUEUE_KINDS = ['pfifo', 'bfifo', 'mq-pfifo', 'red', 'sfq', 'pcq', 'none', 'fq-codel', 'codel', 'cake']
const FW_MATCH = ['chain', 'action', 'protocol', 'src-address', 'dst-address', 'src-port', 'dst-port', 'in-interface', 'out-interface',
  'in-interface-list', 'out-interface-list', 'connection-state', 'connection-nat-state', 'src-address-list', 'dst-address-list',
  'jump-target', 'address-list', 'address-list-timeout', 'log-prefix', 'comment', 'disabled', 'place-before', 'connection-mark',
  'packet-mark', 'ipsec-policy', 'hw-offload', 'limit', 'connection-limit', 'psd', 'tcp-flags', 'dst-limit', 'src-address-type',
  'dst-address-type', 'icmp-options', 'in-bridge-port', 'routing-mark', 'out-bridge-port', 'dscp', 'packet-size', 'connection-bytes', 'src-mac-address',
  'random', 'connection-type', 'connection-rate', 'layer7-protocol', 'content', 'tls-host', 'ttl']
const KEY_USAGE = ['digital-signature', 'content-commitment', 'key-encipherment', 'data-encipherment', 'key-agreement', 'key-cert-sign', 'crl-sign',
  'encipher-only', 'decipher-only', 'tls-server', 'tls-client', 'code-sign', 'email-protect', 'timestamp', 'ocsp-sign', 'ipsec-end-system', 'ipsec-tunnel', 'ipsec-user', 'ipsec-ike']

// Menu definitions. kind: list | singleton | fixed (list without add/remove)
const MENUS = {
  'interface': { kind: 'fixed', fields: ['name', 'comment', 'disabled', 'mtu', 'arp'], cols: ['name', 'type', 'actual-mtu', 'mac-address'] },
  'interface bridge': { kind: 'list', fields: ['name', 'comment', 'disabled', 'protocol-mode', 'arp', 'vlan-filtering', 'priority'], req: ['name'], cols: ['name', 'protocol-mode', 'arp'], iface: 'bridge', defaults: { 'protocol-mode': 'rstp', arp: 'enabled' } },
  'interface bridge port': { kind: 'list', fields: ['bridge', 'interface', 'comment', 'disabled', 'edge', 'pvid', 'horizon'], req: ['bridge', 'interface'], cols: ['interface', 'bridge', 'hw'] },
  'interface vlan': { kind: 'list', fields: ['name', 'vlan-id', 'interface', 'comment', 'disabled'], req: ['name', 'vlan-id', 'interface'], cols: ['name', 'vlan-id', 'interface'], iface: 'vlan' },
  'interface list': { kind: 'list', fields: ['name', 'comment'], req: ['name'], cols: ['name'] },
  'interface list member': { kind: 'list', fields: ['list', 'interface', 'comment', 'disabled'], req: ['list', 'interface'], cols: ['list', 'interface'] },
  'interface wireless': { kind: 'fixed', fields: ['name', 'mode', 'ssid', 'band', 'frequency', 'channel-width', 'security-profile', 'default-forward', 'default-authenticate', 'disabled', 'radio-name', 'country', 'frequency-mode', 'wireless-protocol', 'hide-ssid', 'comment', 'master-interface', 'antenna-gain'], cols: ['name', 'mode', 'ssid', 'band', 'frequency', 'security-profile'] },
  'interface wireless security-profiles': { kind: 'list', fields: ['name', 'mode', 'authentication-types', 'unicast-ciphers', 'group-ciphers', 'wpa-pre-shared-key', 'wpa2-pre-shared-key', 'comment'], req: ['name'], cols: ['name', 'mode', 'authentication-types', 'unicast-ciphers'], defaults: { mode: 'none' } },
  'interface wireless access-list': { kind: 'list', fields: ['mac-address', 'interface', 'authentication', 'forwarding', 'signal-range', 'comment', 'disabled'], req: [], cols: ['mac-address', 'interface', 'authentication', 'forwarding'], defaults: { authentication: 'yes', forwarding: 'yes', interface: 'any' } },
  'interface wireless connect-list': { kind: 'list', fields: ['interface', 'ssid', 'mac-address', 'connect', 'signal-range', 'security-profile', 'comment', 'disabled'], req: ['interface'], cols: ['interface', 'ssid', 'mac-address', 'connect'], defaults: { connect: 'yes' } },
  'interface pppoe-client': { kind: 'list', fields: ['name', 'interface', 'user', 'password', 'add-default-route', 'use-peer-dns', 'service-name', 'comment', 'disabled', 'default-route-distance'], req: ['interface'], cols: ['name', 'interface', 'user', 'status'], iface: 'pppoe-out', defaults: { 'add-default-route': 'no', 'use-peer-dns': 'no', disabled: 'yes' } },
  'interface pppoe-server server': { kind: 'list', fields: ['service-name', 'interface', 'default-profile', 'one-session-per-host', 'max-sessions', 'keepalive-timeout', 'authentication', 'disabled'], req: ['interface'], cols: ['service-name', 'interface', 'default-profile', 'one-session-per-host'], defaults: { 'default-profile': 'default', 'one-session-per-host': 'no', 'keepalive-timeout': '10', disabled: 'yes', 'service-name': 'service1' } },
  'interface pptp-server server': { kind: 'singleton', fields: ['enabled', 'authentication', 'default-profile', 'max-mtu'], defaults: { enabled: 'no', authentication: 'mschap1,mschap2', 'default-profile': 'default-encryption' } },
  'interface l2tp-server server': { kind: 'singleton', fields: ['enabled', 'authentication', 'default-profile', 'use-ipsec', 'ipsec-secret', 'max-mtu', 'max-mru', 'keepalive-timeout', 'max-sessions', 'caller-id-type', 'one-session-per-host', 'allow-fast-path'], defaults: { enabled: 'no', 'use-ipsec': 'no', 'ipsec-secret': '', 'default-profile': 'default-encryption', authentication: 'pap,chap,mschap1,mschap2', 'max-mtu': '1450', 'max-mru': '1450', 'keepalive-timeout': '30' } },
  'interface sstp-server server': { kind: 'singleton', fields: ['enabled', 'authentication', 'default-profile', 'certificate', 'port', 'max-mtu', 'max-mru', 'keepalive-timeout', 'tls-version', 'verify-client-certificate', 'force-aes', 'pfs', 'ciphers'], defaults: { enabled: 'no', port: '443', 'default-profile': 'default', certificate: 'none', authentication: 'pap,chap,mschap1,mschap2', 'tls-version': 'any', 'verify-client-certificate': 'no', 'keepalive-timeout': '60', 'max-mtu': '1500', 'max-mru': '1500' } },
  'interface pptp-client': { kind: 'list', fields: ['name', 'connect-to', 'user', 'password', 'profile', 'add-default-route', 'comment', 'disabled'], req: ['connect-to'], cols: ['name', 'connect-to', 'user', 'status'], iface: 'pptp-out', defaults: { profile: 'default-encryption', 'add-default-route': 'no', disabled: 'yes' } },
  'interface l2tp-client': { kind: 'list', fields: ['name', 'connect-to', 'user', 'password', 'profile', 'use-ipsec', 'ipsec-secret', 'add-default-route', 'comment', 'disabled'], req: ['connect-to'], cols: ['name', 'connect-to', 'user', 'status'], iface: 'l2tp-out', defaults: { profile: 'default-encryption', disabled: 'yes' } },
  'ip address': { kind: 'list', fields: ['address', 'interface', 'network', 'comment', 'disabled'], req: ['address', 'interface'], cols: ['address', 'network', 'interface'] },
  'ip route': { kind: 'list', fields: ['dst-address', 'gateway', 'distance', 'check-gateway', 'comment', 'disabled', 'routing-table', 'routing-mark', 'type', 'scope', 'target-scope', 'pref-src', 'blackhole'], flags: ['blackhole'], req: [], cols: ['dst-address', 'gateway', 'distance'], defaults: { 'dst-address': '0.0.0.0/0', distance: '1' } },
  'routing table': { kind: 'list', fields: ['name', 'fib', 'comment', 'disabled'], flags: ['fib'], req: ['name'], cols: ['name', 'fib'] },
  'routing rule': { kind: 'list', fields: ['src-address', 'dst-address', 'routing-mark', 'interface', 'action', 'table', 'comment', 'disabled', 'place-before'], req: [], cols: ['src-address', 'dst-address', 'routing-mark', 'interface', 'action', 'table'], defaults: { action: 'lookup' }, ordered: true },
  'routing filter rule': { kind: 'list', fields: ['chain', 'rule', 'comment', 'disabled', 'place-before'], req: ['chain', 'rule'], cols: ['chain', 'rule'], ordered: true },
  'routing ospf instance': { kind: 'list', fields: ['name', 'version', 'router-id', 'redistribute', 'originate-default', 'in-filter-chain', 'out-filter-chain', 'comment', 'disabled'], req: ['name'], cols: ['name', 'version', 'router-id', 'redistribute', 'originate-default'], defaults: { version: '2', 'router-id': 'main', 'originate-default': 'never' } },
  'routing ospf area': { kind: 'list', fields: ['name', 'instance', 'area-id', 'type', 'no-summaries', 'default-cost', 'comment', 'disabled'], flags: ['no-summaries'], req: ['name', 'instance'], cols: ['name', 'instance', 'area-id', 'type'], defaults: { 'area-id': '0.0.0.0', type: 'default' } },
  'routing ospf area range': { kind: 'list', fields: ['area', 'prefix', 'advertise', 'cost', 'comment', 'disabled'], req: ['area', 'prefix'], cols: ['area', 'prefix', 'advertise'], defaults: { advertise: 'yes' } },
  'routing ospf interface-template': { kind: 'list', fields: ['interfaces', 'networks', 'area', 'type', 'cost', 'priority', 'passive', 'hello-interval', 'dead-interval', 'auth', 'auth-key', 'auth-id', 'comment', 'disabled', 'place-before'], flags: ['passive'], ordered: true, req: ['area'], cols: ['area', 'interfaces', 'networks', 'type', 'cost', 'passive'], defaults: { type: 'broadcast', cost: '1', priority: '128', 'hello-interval': '10s', 'dead-interval': '40s' } },
  'routing ospf static-neighbor': { kind: 'list', fields: ['address', 'area', 'poll-interval', 'comment', 'disabled'], req: ['address', 'area'], cols: ['address', 'area'] },
  'routing ospf neighbor': { kind: 'fixed', fields: [], cols: [] },
  'routing ospf interface': { kind: 'fixed', fields: [], cols: [] },
  'routing ospf lsa': { kind: 'fixed', fields: [], cols: [] },
  'routing': { kind: 'none' }, 'routing ospf': { kind: 'none' }, 'routing filter': { kind: 'none' },
  'interface gre': { kind: 'list', fields: ['name', 'local-address', 'remote-address', 'keepalive', 'mtu', 'ipsec-secret', 'allow-fast-path', 'comment', 'disabled'], req: ['remote-address'], cols: ['name', 'local-address', 'remote-address', 'keepalive'], iface: 'gre-tunnel', mtu: '1476', defaults: { 'local-address': '0.0.0.0', keepalive: '10s,10' } },
  'interface ipip': { kind: 'list', fields: ['name', 'local-address', 'remote-address', 'keepalive', 'mtu', 'ipsec-secret', 'allow-fast-path', 'comment', 'disabled'], req: ['remote-address'], cols: ['name', 'local-address', 'remote-address', 'keepalive'], iface: 'ipip-tunnel', mtu: '1480', defaults: { 'local-address': '0.0.0.0', keepalive: '10s,10' } },
  'interface eoip': { kind: 'list', fields: ['name', 'local-address', 'remote-address', 'tunnel-id', 'keepalive', 'mtu', 'mac-address', 'ipsec-secret', 'allow-fast-path', 'comment', 'disabled'], req: ['remote-address', 'tunnel-id'], cols: ['name', 'local-address', 'remote-address', 'tunnel-id'], iface: 'eoip-tunnel', mtu: '1458', defaults: { 'local-address': '0.0.0.0', keepalive: '10s,10' } },
  'interface wireguard': { kind: 'list', fields: ['name', 'listen-port', 'mtu', 'private-key', 'comment', 'disabled'], req: [], cols: ['name', 'listen-port', 'public-key'], iface: 'wg', mtu: '1420', defaults: { 'listen-port': '13231' } },
  'interface wireguard peers': { kind: 'list', fields: ['name', 'interface', 'public-key', 'endpoint-address', 'endpoint-port', 'allowed-address', 'persistent-keepalive', 'preshared-key', 'comment', 'disabled'], req: ['interface', 'public-key'], cols: ['interface', 'endpoint-address', 'endpoint-port', 'allowed-address'] },
  'ip dhcp-client': { kind: 'list', fields: ['interface', 'use-peer-dns', 'use-peer-ntp', 'add-default-route', 'default-route-distance', 'dhcp-options', 'script', 'comment', 'disabled'], req: ['interface'], cols: ['interface', 'use-peer-dns', 'add-default-route', 'status', 'address'], defaults: { 'use-peer-dns': 'yes', 'use-peer-ntp': 'yes', 'add-default-route': 'yes', 'default-route-distance': '1', disabled: 'yes' } },
  'ip dhcp-server': { kind: 'list', fields: ['name', 'interface', 'relay', 'address-pool', 'lease-time', 'src-address', 'delay-threshold', 'authoritative', 'add-arp', 'always-broadcast', 'bootp-support', 'lease-script', 'dhcp-option-set', 'conflict-detection', 'use-radius', 'comment', 'disabled'], req: ['interface'], cols: ['name', 'interface', 'relay', 'address-pool', 'lease-time'], defaults: { 'address-pool': 'static-only', 'lease-time': '30m', authoritative: 'yes', 'delay-threshold': 'none', disabled: 'yes' }, autoName: 'dhcp' },
  'ip dhcp-server network': { kind: 'list', fields: ['address', 'gateway', 'netmask', 'dns-server', 'domain', 'ntp-server', 'wins-server', 'next-server', 'boot-file-name', 'dhcp-option', 'dhcp-option-set', 'comment'], req: ['address'], cols: ['address', 'gateway', 'dns-server', 'dhcp-option'] },
  'ip dhcp-server option': { kind: 'list', fields: ['name', 'code', 'value', 'comment'], req: ['name', 'code', 'value'], cols: ['name', 'code', 'value'] },
  'ip dhcp-server option sets': { kind: 'list', fields: ['name', 'options', 'comment'], req: ['name', 'options'], cols: ['name', 'options'] },
  'ip dhcp-relay': { kind: 'list', fields: ['name', 'interface', 'dhcp-server', 'local-address', 'delay-threshold', 'add-relay-info', 'comment', 'disabled'], req: ['interface', 'dhcp-server'], cols: ['name', 'interface', 'dhcp-server', 'local-address'], defaults: { 'local-address': '0.0.0.0', 'delay-threshold': 'none', 'add-relay-info': 'no' }, autoName: 'relay' },
  'ip dhcp-server lease': { kind: 'list', fields: ['address', 'mac-address', 'server', 'comment', 'disabled', 'block-access'], req: ['address', 'mac-address'], cols: ['address', 'mac-address', 'server', 'status'] },
  'ip pool': { kind: 'list', fields: ['name', 'ranges', 'next-pool', 'comment'], req: ['name', 'ranges'], cols: ['name', 'ranges'] },
  'ip dns': { kind: 'singleton', fields: ['servers', 'allow-remote-requests', 'max-udp-packet-size', 'query-server-timeout', 'query-total-timeout', 'max-concurrent-queries', 'cache-size', 'cache-max-ttl', 'use-doh-server', 'verify-doh-cert'], defaults: { servers: '', 'allow-remote-requests': 'no', 'max-udp-packet-size': '4096', 'query-server-timeout': '2s', 'query-total-timeout': '10s', 'max-concurrent-queries': '100', 'cache-size': '2048KiB', 'cache-max-ttl': '1w', 'use-doh-server': '', 'verify-doh-cert': 'no' } },
  'ip dns static': { kind: 'list', fields: ['name', 'regexp', 'type', 'address', 'cname', 'forward-to', 'text', 'match-subdomain', 'ttl', 'comment', 'disabled', 'place-before'], req: [], cols: ['name', 'regexp', 'type', 'address', 'ttl'], defaults: { ttl: '1d' }, ordered: true },
  'ip dns cache': { kind: 'fixed', fields: [], cols: ['name', 'type', 'data', 'ttl'] },
  'ip proxy': { kind: 'singleton', fields: ['enabled', 'src-address', 'port', 'anonymous', 'parent-proxy', 'parent-proxy-port', 'cache-administrator', 'max-cache-size', 'max-cache-object-size', 'cache-on-disk', 'max-client-connections', 'max-server-connections', 'max-fresh-time', 'serialize-connections', 'always-from-cache', 'cache-hit-dscp', 'cache-path'], defaults: { enabled: 'no', 'src-address': '::', port: '8080', anonymous: 'no', 'parent-proxy': '::', 'parent-proxy-port': '0', 'cache-administrator': 'webmaster', 'max-cache-size': 'unlimited', 'max-cache-object-size': '2048KiB', 'cache-on-disk': 'no', 'max-client-connections': '600', 'max-server-connections': '600', 'max-fresh-time': '3d', 'serialize-connections': 'no', 'always-from-cache': 'no', 'cache-hit-dscp': '4', 'cache-path': 'web-proxy' } },
  'ip proxy access': { kind: 'list', fields: PROXY_RULE, req: [], cols: ['src-address', 'dst-host', 'path', 'method', 'action', 'redirect-to'], defaults: { action: 'allow' }, ordered: true },
  'ip proxy cache': { kind: 'list', fields: PROXY_RULE, req: [], cols: ['src-address', 'dst-host', 'path', 'action'], defaults: { action: 'allow' }, ordered: true },
  'ip proxy direct': { kind: 'list', fields: PROXY_RULE, req: [], cols: ['src-address', 'dst-host', 'path', 'action'], defaults: { action: 'allow' }, ordered: true },
  'ip arp': { kind: 'list', fields: ['address', 'mac-address', 'interface', 'comment', 'disabled'], req: ['address', 'mac-address', 'interface'], cols: ['address', 'mac-address', 'interface'] },
  'ip firewall filter': { kind: 'list', fields: FW_MATCH, req: ['chain'], cols: ['chain', 'action', 'match'], defaults: { action: 'accept' }, ordered: true },
  'ip firewall nat': { kind: 'list', fields: [...FW_MATCH, 'to-addresses', 'to-ports'], req: ['chain'], cols: ['chain', 'action', 'match'], defaults: { action: 'accept' }, ordered: true },
  'ip firewall mangle': { kind: 'list', fields: [...FW_MATCH, 'new-connection-mark', 'new-packet-mark', 'new-routing-mark', 'new-dscp', 'new-ttl', 'new-mss', 'new-priority', 'passthrough'], req: ['chain'], cols: ['chain', 'action', 'match'], defaults: { action: 'accept' }, ordered: true },
  'ip firewall raw': { kind: 'list', fields: FW_MATCH, req: ['chain'], cols: ['chain', 'action', 'match'], defaults: { action: 'accept' }, ordered: true },
  'ip firewall connection tracking': { kind: 'singleton', fields: ['enabled', 'tcp-syn-sent-timeout', 'tcp-established-timeout', 'udp-timeout', 'loose-tcp-tracking'], defaults: { enabled: 'auto', 'tcp-established-timeout': '1d', 'udp-timeout': '30s', 'loose-tcp-tracking': 'yes' } },
  'ip firewall address-list': { kind: 'list', fields: ['list', 'address', 'timeout', 'comment', 'disabled'], req: ['list', 'address'], cols: ['list', 'address'] },
  'ip firewall connection': { kind: 'fixed', fields: [], cols: ['protocol', 'src-address', 'dst-address', 'state'] },
  'ip ssh': { kind: 'singleton', fields: ['forwarding-enabled', 'strong-crypto', 'always-allow-password-login', 'host-key-size', 'host-key-type'], defaults: { 'forwarding-enabled': 'no', 'strong-crypto': 'no', 'always-allow-password-login': 'no', 'host-key-size': '2048', 'host-key-type': 'rsa' } },
  'ip settings': { kind: 'singleton', fields: ['ip-forward', 'rp-filter', 'tcp-syncookies', 'accept-redirects', 'send-redirects', 'secure-redirects', 'accept-source-route'], defaults: { 'ip-forward': 'yes', 'rp-filter': 'no', 'tcp-syncookies': 'no', 'accept-redirects': 'no', 'send-redirects': 'yes', 'secure-redirects': 'yes', 'accept-source-route': 'no' } },
  'ip dhcp-server alert': { kind: 'list', fields: ['interface', 'valid-server', 'alert-timeout', 'on-alert', 'comment', 'disabled'], req: ['interface'], cols: ['interface', 'valid-server', 'alert-timeout'] },
  'certificate': { kind: 'list', fields: ['name', 'common-name', 'subject-alt-name', 'key-usage', 'key-size', 'days-valid', 'country', 'state', 'locality', 'organization', 'unit', 'trusted', 'comment'], req: ['name'], cols: ['name', 'common-name', 'subject-alt-name'], defaults: { 'key-size': '2048', 'days-valid': '365', trusted: 'no' } },
  'ip ipsec profile': { kind: 'list', fields: ['name', 'hash-algorithm', 'enc-algorithm', 'dh-group', 'lifetime', 'nat-traversal', 'dpd-interval', 'dpd-maximum-failures', 'proposal-check'], req: ['name'], cols: ['name', 'hash-algorithm', 'enc-algorithm', 'dh-group'], defaults: { 'hash-algorithm': 'sha1', 'enc-algorithm': 'aes-128,3des', 'dh-group': 'modp2048,modp1024', lifetime: '1d', 'nat-traversal': 'yes', 'dpd-interval': '2m', 'proposal-check': 'obey' } },
  'ip ipsec proposal': { kind: 'list', fields: ['name', 'auth-algorithms', 'enc-algorithms', 'pfs-group', 'lifetime', 'comment', 'disabled'], req: ['name'], cols: ['name', 'auth-algorithms', 'enc-algorithms', 'pfs-group'], defaults: { 'auth-algorithms': 'sha1', 'enc-algorithms': 'aes-256-cbc,aes-192-cbc,aes-128-cbc', 'pfs-group': 'modp1024', lifetime: '30m' } },
  'ip ipsec policy group': { kind: 'list', fields: ['name', 'comment'], req: ['name'], cols: ['name'] },
  'ip ipsec policy': { kind: 'list', fields: ['src-address', 'dst-address', 'src-port', 'dst-port', 'protocol', 'template', 'group', 'proposal', 'action', 'level', 'tunnel', 'peer', 'sa-src-address', 'sa-dst-address', 'comment', 'disabled'], req: [], cols: ['peer', 'tunnel', 'src-address', 'dst-address', 'template', 'group'], defaults: { 'src-address': '0.0.0.0/0', 'dst-address': '0.0.0.0/0', proposal: 'default', action: 'encrypt', level: 'require', tunnel: 'no', template: 'no' } },
  'ip ipsec peer': { kind: 'list', fields: ['name', 'address', 'local-address', 'port', 'profile', 'exchange-mode', 'passive', 'send-initial-contact', 'comment', 'disabled'], req: ['name'], cols: ['name', 'address', 'profile', 'exchange-mode', 'passive'], defaults: { profile: 'default', 'exchange-mode': 'main', passive: 'no', 'send-initial-contact': 'yes' } },
  'ip ipsec identity': { kind: 'list', fields: ['peer', 'auth-method', 'secret', 'certificate', 'remote-certificate', 'generate-policy', 'policy-template-group', 'mode-config', 'my-id', 'remote-id', 'match-by', 'username', 'password', 'eap-methods', 'notrack-chain', 'comment', 'disabled'], req: ['peer'], cols: ['peer', 'auth-method', 'certificate', 'generate-policy', 'mode-config'], defaults: { 'auth-method': 'pre-shared-key', 'generate-policy': 'no', 'policy-template-group': 'default', 'match-by': 'remote-id', 'my-id': 'auto', 'remote-id': 'auto' } },
  'ip ipsec mode-config': { kind: 'list', fields: ['name', 'responder', 'address-pool', 'address', 'address-prefix-length', 'split-include', 'system-dns', 'static-dns', 'comment'], req: ['name'], cols: ['name', 'responder', 'address-pool', 'split-include'], defaults: { responder: 'yes', 'system-dns': 'yes' } },
  'ip ipsec active-peers': { kind: 'fixed', fields: [], cols: ['id', 'state', 'uptime', 'remote-address'] },
  'ip ipsec installed-sa': { kind: 'fixed', fields: [], cols: ['spi', 'src-address', 'dst-address', 'state'] },
  'ip ipsec': { kind: 'none' },
  'ip service': { kind: 'fixed', fields: ['port', 'address', 'disabled', 'certificate'], cols: ['name', 'port', 'address'] },
  'ip cloud': { kind: 'singleton', fields: ['ddns-enabled', 'update-time'], defaults: { 'ddns-enabled': 'no', 'update-time': 'yes' } },
  'ip neighbor discovery-settings': { kind: 'singleton', fields: ['discover-interface-list'], defaults: { 'discover-interface-list': 'all' } },
  'queue simple': { kind: 'list', fields: ['name', 'target', 'dst', 'max-limit', 'limit-at', 'burst-limit', 'burst-threshold', 'burst-time', 'priority', 'queue', 'packet-marks', 'parent', 'time', 'bucket-size', 'comment', 'disabled', 'place-before'], req: ['target'], cols: ['name', 'target', 'max-limit', 'queue'], defaults: { 'max-limit': '0/0', queue: 'default-small/default-small', priority: '8/8' }, autoName: 'queue', ordered: true },
  'queue type': { kind: 'list', fields: ['name', 'kind', 'pfifo-limit', 'bfifo-limit', 'mq-pfifo-limit', 'red-limit', 'red-min-threshold', 'red-max-threshold', 'red-burst', 'red-avg-packet', 'sfq-perturb', 'sfq-allot', 'pcq-rate', 'pcq-classifier', 'pcq-limit', 'pcq-total-limit', 'pcq-burst-rate', 'pcq-burst-threshold', 'pcq-burst-time', 'pcq-src-address-mask', 'pcq-dst-address-mask'], req: ['name', 'kind'], cols: ['name', 'kind', 'pcq-rate', 'pcq-classifier'] },
  'queue tree': { kind: 'list', fields: ['name', 'parent', 'packet-mark', 'limit-at', 'max-limit', 'priority', 'queue', 'burst-limit', 'burst-threshold', 'burst-time', 'bucket-size', 'comment', 'disabled'], req: ['name', 'parent'], cols: ['name', 'parent', 'packet-mark', 'limit-at', 'max-limit', 'priority', 'queue'], defaults: { priority: '8', queue: 'default-small' } },
  'ppp profile': { kind: 'list', fields: ['name', 'local-address', 'remote-address', 'rate-limit', 'only-one', 'dns-server', 'use-encryption', 'comment'], req: ['name'], cols: ['name', 'local-address', 'remote-address', 'rate-limit'] },
  'ppp secret': { kind: 'list', fields: ['name', 'password', 'service', 'profile', 'local-address', 'remote-address', 'comment', 'disabled'], req: ['name'], cols: ['name', 'service', 'profile', 'remote-address'], defaults: { service: 'any', profile: 'default' } },
  'ppp active': { kind: 'fixed', fields: [], cols: ['name', 'service', 'address', 'uptime'] },
  'user': { kind: 'list', fields: ['name', 'group', 'password', 'address', 'comment', 'disabled'], req: ['name', 'group'], cols: ['name', 'group', 'address'] },
  'user group': { kind: 'list', fields: ['name', 'policy', 'comment'], req: ['name'], cols: ['name', 'policy'] },
  'system identity': { kind: 'singleton', fields: ['name'], defaults: { name: 'MikroTik' } },
  'system note': { kind: 'singleton', fields: ['note', 'show-at-login'], defaults: { note: '', 'show-at-login': 'yes' } },
  'system clock': { kind: 'singleton', fields: ['time-zone-name', 'time-zone-autodetect', 'time', 'date'], defaults: { 'time-zone-name': 'manual', 'time-zone-autodetect': 'yes' } },
  'system ntp client': { kind: 'singleton', fields: ['enabled', 'servers', 'mode'], defaults: { enabled: 'no', servers: '', mode: 'unicast' } },
  'system ntp server': { kind: 'singleton', fields: ['enabled', 'broadcast', 'multicast'], defaults: { enabled: 'no' } },
  'system resource': { kind: 'info' },
  'system routerboard': { kind: 'info' },
  'system routerboard settings': { kind: 'singleton', fields: ['boot-device', 'protected-routerboot'], defaults: { 'boot-device': 'nand-if-fail-then-ethernet' } },
  'system package': { kind: 'info' },
  'system license': { kind: 'info' },
  'system backup': { kind: 'none' },
  'system logging': { kind: 'list', fields: ['topics', 'action', 'prefix', 'disabled'], req: ['topics'], cols: ['topics', 'action', 'prefix'] },
  'system scheduler': { kind: 'list', fields: ['name', 'interval', 'on-event', 'start-time', 'comment', 'disabled'], req: ['name'], cols: ['name', 'interval', 'on-event'] },
  'system script': { kind: 'list', fields: ['name', 'source', 'comment'], req: ['name'], cols: ['name', 'source'] },
  'tool netwatch': { kind: 'list', fields: ['host', 'interval', 'timeout', 'up-script', 'down-script', 'comment', 'disabled'], req: ['host'], cols: ['host', 'interval', 'status'], defaults: { interval: '10s' } },
  'tool mac-server': { kind: 'singleton', fields: ['allowed-interface-list'], defaults: { 'allowed-interface-list': 'all' } },
  'tool mac-server mac-winbox': { kind: 'singleton', fields: ['allowed-interface-list'], defaults: { 'allowed-interface-list': 'all' } },
  'tool bandwidth-server': { kind: 'singleton', fields: ['enabled', 'authenticate', 'max-sessions'], defaults: { enabled: 'yes', authenticate: 'yes', 'max-sessions': '100' } },
  'tool graphing interface': { kind: 'list', fields: ['interface', 'allow-address', 'store-on-disk'], req: [], cols: ['interface', 'allow-address'], defaults: { interface: 'all', 'allow-address': '0.0.0.0/0' } },
  'tool e-mail': { kind: 'singleton', fields: ['server', 'port', 'from', 'user', 'password', 'tls'], defaults: { port: '25' } },
  'snmp': { kind: 'singleton', fields: ['enabled', 'contact', 'location', 'trap-version'], defaults: { enabled: 'no' } },
  'snmp community': { kind: 'list', fields: ['name', 'addresses', 'security', 'read-access', 'write-access'], req: ['name'], cols: ['name', 'addresses', 'security'] },
  'tool': { kind: 'none' }, 'system': { kind: 'none' }, 'ip': { kind: 'none' }, 'ip firewall': { kind: 'none' },
  'queue': { kind: 'none' }, 'ppp': { kind: 'none' }, 'interface pppoe-server': { kind: 'none' }, 'interface pptp-server': { kind: 'none' },
  'interface l2tp-server': { kind: 'none' }, 'interface sstp-server': { kind: 'none' }, 'ip neighbor': { kind: 'fixed', fields: [], cols: ['interface', 'address', 'mac-address', 'identity', 'platform'] },
  'system ntp': { kind: 'none' }, 'tool graphing': { kind: 'none' },
}

const PATHS = Object.keys(MENUS)
const LIST_CMDS = ['add', 'set', 'remove', 'print', 'enable', 'disable', 'export', 'find', 'comment', 'move']
const GLOBAL_CMDS = ['ping', 'traceroute', 'export', 'quit', 'help', 'import']
const EXTRA_CMDS = {
  'tool': ['ping', 'traceroute', 'torch', 'profile', 'bandwidth-test', 'sniffer'],
  'system': ['reboot', 'reset-configuration', 'sup-output', 'shutdown'],
  'system routerboard': ['print', 'upgrade'],
  'system backup': ['save', 'load'],
  'system resource': ['print'],
  'system package': ['print', 'update'],
  'system license': ['print'],
  'interface wireless': ['scan', 'print', 'set', 'enable', 'disable', 'export'],
  'ip dhcp-server': ['setup'],
  'ip dhcp-server lease': ['make-static'],
  'certificate': ['sign', 'import', 'export-certificate'],
  'ip': [],
}

function childMenus(path) {
  const pre = path ? path + ' ' : ''
  const out = new Set()
  for (const p of PATHS) {
    if (p.startsWith(pre) && p !== path) {
      const rest = p.slice(pre.length).split(' ')[0]
      out.add(rest)
    }
  }
  return [...out]
}

function commandsFor(path) {
  const m = MENUS[path]
  let c = []
  if (m) {
    if (m.kind === 'list') c = LIST_CMDS
    else if (m.kind === 'fixed') c = ['set', 'print', 'enable', 'disable', 'export', 'find', 'comment']
    else if (m.kind === 'singleton') c = ['set', 'print', 'export']
    else if (m.kind === 'info') c = ['print']
  }
  return [...new Set([...c, ...(EXTRA_CMDS[path] || [])])]
}

// ---------- initial configurations ----------
let MACSEQ = 0x10
const mac = () => '48:A9:8A:4C:2E:' + (MACSEQ++).toString(16).toUpperCase().padStart(2, '0')

function baseState() {
  MACSEQ = 0x10
  const ifs = ['ether1', 'ether2', 'ether3', 'ether4', 'ether5'].map((n) => ({ name: n, type: 'ether', mtu: '1500', disabled: 'no', 'mac-address': mac(), comment: '' }))
  ifs.push({ name: 'wlan1', type: 'wlan', mtu: '1500', disabled: 'yes', 'mac-address': mac(), comment: '' })
  const st = {
    seq: 1, lists: {}, singletons: {}, interfaces: ifs, lastPrint: {},
    wireless: { wlan1: { mode: 'station', ssid: 'MikroTik', band: '2ghz-b/g/n', frequency: 'auto', 'channel-width': '20mhz', 'security-profile': 'default', 'default-forward': 'yes', 'default-authenticate': 'yes', 'radio-name': '48A98A4C2E15', country: 'etsi', 'frequency-mode': 'regulatory-domain', 'wireless-protocol': 'any', 'hide-ssid': 'no', 'antenna-gain': '2' } },
    services: [
      ['telnet', '23'], ['ftp', '21'], ['www', '80'], ['ssh', '22'], ['www-ssl', '443'], ['api', '8728'], ['winbox', '8291'], ['api-ssl', '8729'],
    ].map(([name, port]) => ({ name, port, address: '', disabled: name === 'www-ssl' ? 'yes' : 'no' })),
    laptop: { mode: 'static', ip: '192.168.33.2/24', gw: '192.168.33.1', dns: '192.168.33.1', port: 'ether2', mac: 'E4:5F:01:AA:BB:02' },
    files: [],
    loggedOut: false,
    cabled: ['ether1', 'ether2'],
  }
  for (const p of PATHS) if (MENUS[p] && MENUS[p].kind === 'list') st.lists[p] = []
  for (const p of PATHS) if (MENUS[p] && MENUS[p].kind === 'singleton') st.singletons[p] = { ...(MENUS[p].defaults || {}) }
  addItem(st, 'user', { name: 'admin', group: 'full', password: '', address: '', comment: 'system default user' })
  for (const g of ['read', 'write', 'full']) addItem(st, 'user group', { name: g, policy: g === 'read' ? 'local,telnet,ssh,reboot,read,test,winbox,web' : 'local,telnet,ssh,reboot,read,write,test,winbox,web' + (g === 'full' ? ',policy,sensitive' : '') })
  addItem(st, 'interface wireless security-profiles', { name: 'default', mode: 'none' }, true)
  addItem(st, 'ppp profile', { name: 'default' }, true)
  addItem(st, 'ppp profile', { name: 'default-encryption', 'use-encryption': 'yes' }, true)
  addItem(st, 'ip ipsec profile', { name: 'default' }, true)
  addItem(st, 'ip ipsec proposal', { name: 'default' }, true)
  addItem(st, 'ip ipsec policy group', { name: 'default' }, true)
  addItem(st, 'ip ipsec policy', { 'src-address': '::/0', 'dst-address': '::/0', group: 'default', proposal: 'default', template: 'yes' }, true)
  addItem(st, 'ip ipsec mode-config', { name: 'request-only', responder: 'no' }, true)
  addItem(st, 'routing table', { name: 'main', fib: 'yes' }, true)
  for (const [n, k] of [['default', 'pfifo'], ['default-small', 'pfifo'], ['ethernet-default', 'pfifo'], ['wireless-default', 'sfq'], ['synchronous-default', 'red'], ['hotspot-default', 'sfq'], ['pcq-upload-default', 'pcq'], ['pcq-download-default', 'pcq'], ['only-hardware-queue', 'none'], ['multi-queue-ethernet-default', 'mq-pfifo']])
    addItem(st, 'queue type', { name: n, kind: k, ...(k === 'pcq' ? { 'pcq-rate': '0', 'pcq-classifier': n.includes('upload') ? 'src-address' : 'dst-address' } : {}) }, true)
  return st
}

function addItem(st, path, obj, builtin = false) {
  const it = { '.id': st.seq++, disabled: 'no', ...(MENUS[path].defaults || {}), ...obj }
  if (builtin) it['.builtin'] = true
  st.lists[path].push(it)
  return it
}

export function emptyConfig() {
  return baseState()
}

export function defaultConfig() {
  const st = baseState()
  st.interfaces.find((i) => i.name === 'wlan1').disabled = 'no'
  Object.assign(st.wireless.wlan1, { mode: 'ap-bridge', ssid: 'MikroTik-4C2E15', frequency: 'auto', band: '2ghz-b/g/n' })
  addItem(st, 'interface bridge', { name: 'bridge', comment: 'defconf', 'protocol-mode': 'rstp' })
  for (const p of ['ether2', 'ether3', 'ether4', 'ether5', 'wlan1']) addItem(st, 'interface bridge port', { bridge: 'bridge', interface: p, comment: 'defconf' })
  addItem(st, 'interface list', { name: 'WAN', comment: 'defconf' })
  addItem(st, 'interface list', { name: 'LAN', comment: 'defconf' })
  addItem(st, 'interface list member', { list: 'LAN', interface: 'bridge', comment: 'defconf' })
  addItem(st, 'interface list member', { list: 'WAN', interface: 'ether1', comment: 'defconf' })
  addItem(st, 'ip address', { address: '192.168.88.1/24', interface: 'bridge', network: '192.168.88.0', comment: 'defconf' })
  addItem(st, 'ip dhcp-client', { interface: 'ether1', disabled: 'no', comment: 'defconf' })
  addItem(st, 'ip pool', { name: 'default-dhcp', ranges: '192.168.88.10-192.168.88.254' })
  addItem(st, 'ip dhcp-server', { name: 'defconf', interface: 'bridge', 'address-pool': 'default-dhcp', disabled: 'no' })
  addItem(st, 'ip dhcp-server network', { address: '192.168.88.0/24', gateway: '192.168.88.1', 'dns-server': '192.168.88.1', comment: 'defconf' })
  st.singletons['ip dns']['allow-remote-requests'] = 'yes'
  addItem(st, 'ip dns static', { name: 'router.lan', address: '192.168.88.1', comment: 'defconf' })
  const f = (o) => addItem(st, 'ip firewall filter', o)
  f({ chain: 'input', action: 'accept', 'connection-state': 'established,related,untracked', comment: 'defconf: accept established,related,untracked' })
  f({ chain: 'input', action: 'drop', 'connection-state': 'invalid', comment: 'defconf: drop invalid' })
  f({ chain: 'input', action: 'accept', protocol: 'icmp', comment: 'defconf: accept ICMP' })
  f({ chain: 'input', action: 'accept', 'dst-address': '127.0.0.1', comment: 'defconf: accept to local loopback (for CAPsMAN)' })
  f({ chain: 'input', action: 'drop', 'in-interface-list': '!LAN', comment: 'defconf: drop all not coming from LAN' })
  f({ chain: 'forward', action: 'fasttrack-connection', 'connection-state': 'established,related', 'hw-offload': 'yes', comment: 'defconf: fasttrack' })
  f({ chain: 'forward', action: 'accept', 'connection-state': 'established,related,untracked', comment: 'defconf: accept established,related, untracked' })
  f({ chain: 'forward', action: 'drop', 'connection-state': 'invalid', comment: 'defconf: drop invalid' })
  f({ chain: 'forward', action: 'drop', 'connection-state': 'new', 'connection-nat-state': '!dstnat', 'in-interface-list': 'WAN', comment: 'defconf: drop all from WAN not DSTNATed' })
  addItem(st, 'ip firewall nat', { chain: 'srcnat', action: 'masquerade', 'out-interface-list': 'WAN', 'ipsec-policy': 'out,none', comment: 'defconf: masquerade' })
  st.singletons['tool mac-server']['allowed-interface-list'] = 'LAN'
  st.singletons['tool mac-server mac-winbox']['allowed-interface-list'] = 'LAN'
  st.singletons['ip neighbor discovery-settings']['discover-interface-list'] = 'LAN'
  st.laptop = { mode: 'dhcp', port: 'ether2', mac: 'E4:5F:01:AA:BB:02' }
  return st
}

// ---------- derived network state ----------
const yes = (v) => v === 'yes' || v === true || v === 'true'
const on = (it) => !yes(it.disabled)

export function bridgeOf(st, ifname) {
  const p = st.lists['interface bridge port'].find((x) => x.interface === ifname && on(x))
  if (!p) return null
  const br = st.lists['interface bridge'].find((b) => b.name === p.bridge)
  return br ? br.name : null
}

export function allInterfaces(st) {
  const res = []
  for (const i of st.interfaces) res.push({ ...i, dynamic: false })
  for (const [path, m] of Object.entries(MENUS)) {
    if (!m || !m.iface) continue
    for (const it of st.lists[path]) res.push({ name: it.name, type: m.iface, mtu: it.mtu && it.mtu !== 'auto' ? it.mtu : m.mtu || (path.includes('pp') ? '1480' : '1500'), disabled: it.disabled, 'mac-address': it['.mac'] || '', comment: it.comment || '', dynamic: false, '.path': path })
  }
  return res
}

export function interfaceExists(st, name) {
  return allInterfaces(st).some((i) => i.name === name)
}

function pppoeStatus(st, it) {
  if (!on(it)) return 'disabled'
  if (!isRunning(st, it.interface)) return 'disconnected'
  if (bridgeOf(st, it.interface)) return 'disconnected'
  if (it.interface !== 'ether1') return 'disconnected'
  if (it.user !== WORLD.pppoeUser || it.password !== WORLD.pppoePass) return 'authentication failed'
  return 'connected'
}

function dhcpClientStatus(st, it) {
  if (!on(it)) return 'stopped'
  if (it.interface !== 'ether1' || bridgeOf(st, 'ether1') || !isRunning(st, 'ether1')) return 'searching...'
  return 'bound'
}

export function isRunning(st, name, depth = 0) {
  if (depth > 5) return false
  if (st.net) return st.net.isRunning(st, name)
  const phys = st.interfaces.find((i) => i.name === name)
  if (phys) {
    if (yes(phys.disabled)) return false
    if (phys.type === 'wlan') {
      const w = st.wireless[name]
      return w.mode.startsWith('ap') || w.mode === 'bridge' || (w.mode.startsWith('station') && w.ssid === 'QTraining')
    }
    return st.cabled.includes(name)
  }
  const br = st.lists['interface bridge'].find((b) => b.name === name)
  if (br) return on(br) && st.lists['interface bridge port'].some((p) => p.bridge === name && on(p) && isRunning(st, p.interface, depth + 1))
  const vl = st.lists['interface vlan'].find((v) => v.name === name)
  if (vl) return on(vl) && isRunning(st, vl.interface, depth + 1)
  const pc = st.lists['interface pppoe-client'].find((v) => v.name === name)
  if (pc) return pppoeStatus(st, pc) === 'connected'
  // tunnels on a single router: GRE/IPIP/EoIP without keepalive always look running, WireGuard is running when enabled
  for (const p of ['interface gre', 'interface ipip', 'interface eoip']) {
    const t = st.lists[p].find((v) => v.name === name)
    if (t) return on(t) && !t.keepalive
  }
  const wg = st.lists['interface wireguard'].find((v) => v.name === name)
  if (wg) return on(wg)
  return false
}

// all effective addresses incl. dynamic ones
export function addresses(st) {
  const res = []
  for (const a of st.lists['ip address']) {
    if (!on(a)) continue
    const c = parseCidr(a.address)
    if (!c) continue
    res.push({ address: a.address, interface: a.interface, c, dynamic: false, invalid: !!bridgeOf(st, a.interface) })
  }
  for (const d of st.lists['ip dhcp-client']) {
    if (dhcpClientStatus(st, d) === 'bound') res.push({ address: WORLD.dhcpLease, interface: d.interface, c: parseCidr(WORLD.dhcpLease), dynamic: true })
  }
  for (const p of st.lists['interface pppoe-client']) {
    if (pppoeStatus(st, p) === 'connected') res.push({ address: WORLD.pppoeLocal + '/32', interface: p.name, c: parseCidr(WORLD.pppoeLocal + '/32'), dynamic: true, peer: WORLD.pppoeRemote })
  }
  return res
}

export function routes(st) {
  if (st.net) return st.net.routes(st)
  const rs = []
  const addrs = addresses(st)
  for (const a of addrs) {
    if (a.invalid) continue
    const run = isRunning(st, a.interface)
    if (a.peer) {
      rs.push({ dst: a.peer + '/32', gateway: a.interface, distance: 0, type: 'C', dynamic: true, active: run, iface: a.interface })
    } else {
      rs.push({ dst: intToIp(a.c.net) + '/' + a.c.prefix, gateway: a.interface, distance: 0, type: 'C', dynamic: true, active: run, iface: a.interface })
    }
  }
  for (const r of st.lists['ip route']) {
    if (!on(r)) continue
    rs.push({ dst: r['dst-address'] || '0.0.0.0/0', gateway: r.gateway || '', distance: Number(r.distance || 1), type: 'S', dynamic: false, item: r })
  }
  for (const d of st.lists['ip dhcp-client']) {
    if (dhcpClientStatus(st, d) === 'bound' && yes(d['add-default-route'])) rs.push({ dst: '0.0.0.0/0', gateway: WORLD.ispGw, distance: Number(d['default-route-distance'] || 1), type: 'S', dynamic: true })
  }
  for (const p of st.lists['interface pppoe-client']) {
    if (pppoeStatus(st, p) === 'connected' && yes(p['add-default-route'])) rs.push({ dst: '0.0.0.0/0', gateway: p.name, distance: Number(p['default-route-distance'] || 1), type: 'S', dynamic: true })
  }
  // resolve gateways for non-connected routes
  const connected = rs.filter((r) => r.type === 'C' && r.active)
  for (const r of rs) {
    if (r.type === 'C') continue
    const gw = r.gateway
    if (!gw) { r.active = false; continue }
    if (ipToInt(gw) === null) {
      r.iface = gw; r.active = isRunning(st, gw)
    } else {
      const c = connected.filter((x) => inSubnet(gw, x.dst)).sort((a, b) => parseCidr(b.dst).prefix - parseCidr(a.dst).prefix)[0]
      r.iface = c ? c.iface : null
      r.active = !!c
    }
  }
  // among same dst keep best distance as active
  const best = {}
  for (const r of rs) {
    if (!r.active) continue
    if (!best[r.dst] || r.distance < best[r.dst].distance) best[r.dst] = r
  }
  for (const r of rs) r.selected = best[r.dst] === r
  return rs
}

export function lookup(st, ip) {
  const rs = routes(st).filter((r) => r.selected && inSubnet(ip, r.dst))
  rs.sort((a, b) => parseCidr(b.dst).prefix - parseCidr(a.dst).prefix)
  return rs[0] || null
}

function ifaceInList(st, ifname, list) {
  if (list === 'all') return true
  if (list === 'none') return false
  const mem = st.lists['interface list member'].filter((m) => m.list === list && on(m)).map((m) => m.interface)
  if (mem.includes(ifname)) return true
  if (list === 'dynamic') return false
  return false
}

function neg(spec) {
  if (typeof spec === 'string' && spec.startsWith('!')) return [true, spec.slice(1)]
  return [false, spec]
}

function portMatch(spec, port) {
  if (!spec) return true
  if (port === undefined || port === null) return false
  return spec.split(',').some((p) => {
    if (p.includes('-')) { const [a, b] = p.split('-').map(Number); return port >= a && port <= b }
    return Number(p) === port
  })
}

function addrInList(st, list, ip) {
  return st.lists['ip firewall address-list'].some((a) => a.list === list && on(a) && matchAddr(a.address, ip))
}

const tcpFlags = (p) => p.flags ? p.flags.split(',') : p.state === 'new' ? ['syn'] : ['ack']

// Does one firewall rule match packet p?
export function ruleMatches(st, r, p) {
  const chk = (key, fn) => {
    const v = r[key]
    if (v === undefined || v === '') return true
    const [n, val] = neg(v)
    const res = fn(val)
    return n ? !res : res
  }
  return chk('protocol', (v) => v === p.protocol || (v === '6' && p.protocol === 'tcp') || (v === '17' && p.protocol === 'udp') || (v === '1' && p.protocol === 'icmp'))
    && chk('src-address', (v) => matchAddr(v, p.src))
    && chk('dst-address', (v) => matchAddr(v, p.dst))
    && chk('src-port', (v) => portMatch(v, p.srcPort))
    && chk('dst-port', (v) => portMatch(v, p.dstPort))
    && chk('in-interface', (v) => v === p.inIf || (p.inBridgePort && v === p.inBridgePort))
    && chk('out-interface', (v) => v === p.outIf)
    && chk('in-interface-list', (v) => !!p.inIf && ifaceInList(st, p.inIf, v))
    && chk('out-interface-list', (v) => !!p.outIf && ifaceInList(st, p.outIf, v))
    && chk('connection-state', (v) => v.split(',').includes(p.state || 'new'))
    && chk('connection-nat-state', (v) => v.split(',').includes(p.natState || ''))
    && chk('src-address-list', (v) => p.inList ? p.inList(v, p.src) : addrInList(st, v, p.src))
    && chk('dst-address-list', (v) => p.inList ? p.inList(v, p.dst) : addrInList(st, v, p.dst))
    && chk('ipsec-policy', (v) => { const [dir, pol] = v.split(','); return (dir === 'in' ? !!p.ipsecIn : !!p.ipsecOut) === (pol === 'ipsec') })
    && chk('tcp-flags', (v) => p.protocol === 'tcp' && v.split(',').every((f) => f.startsWith('!') ? !tcpFlags(p).includes(f.slice(1)) : tcpFlags(p).includes(f)))
    && chk('psd', (v) => !!p.psd && p.psd(v))
    && chk('connection-limit', (v) => p.connCount !== undefined && p.connCount > Number(v.split(',')[0]))
    && chk('packet-mark', (v) => v === (p.packetMark || ''))
    && chk('connection-mark', (v) => v === (p.connMark || ''))
    && chk('routing-mark', (v) => v === (p.routingMark || ''))
    && chk('in-bridge-port', (v) => v === p.inBridgePort)
    && chk('out-bridge-port', (v) => v === p.outBridgePort)
    && chk('src-mac-address', (v) => !!p.srcMac && v.toUpperCase() === p.srcMac.toUpperCase())
    && chk('icmp-options', (v) => { const [t, c] = v.split(':'); return p.protocol === 'icmp' && Number(t) === (p.icmpType ?? 8) && (c === undefined || rangeHas(c, p.icmpCode ?? 0)) })
    && chk('dscp', (v) => rangeHas(v, p.dscp ?? 0))
    && chk('ttl', (v) => { const [op, n] = v.split(':'); const t = p.ttl ?? 64; return op === 'equal' ? t === +n : op === 'less-than' ? t < +n : op === 'greater-than' ? t > +n : op === 'not-equal' ? t !== +n : false })
    && chk('packet-size', (v) => rangeHas(v, p.size ?? 64))
    && chk('connection-bytes', (v) => { const [lo, hi] = v.split('-').map(Number); const b = p.connBytes ?? 0; return b >= lo && (!hi || b <= hi) })
    && chk('connection-type', (v) => v === (p.connType || ''))
    && chk('layer7-protocol', (v) => !!p.l7 && p.l7 === v)
    && chk('content', (v) => !!p.content && p.content.includes(v))
    && chk('tls-host', (v) => !!p.tlsHost && globMatch(v, p.tlsHost))
    && chk('limit', (v) => p.overLimit === undefined ? true : !p.overLimit)
}

// "5" or "5-10"
const rangeHas = (spec, n) => { const [lo, hi] = String(spec).split('-').map(Number); return hi === undefined || isNaN(hi) ? n === lo : n >= lo && n <= hi }
// *.example.com style wildcards (tls-host, proxy dst-host)
export const globMatch = (pat, s) => new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i').test(s)

// Walk a chain. Returns { verdict, rule, trace }
export function evalChain(st, table, chain, p, depth = 0) {
  const rules = st.lists['ip firewall ' + table].filter((r) => on(r) && r.chain === chain)
  const trace = []
  if (depth > 8) return { verdict: 'accept', trace }
  for (const r of rules) {
    if (!ruleMatches(st, r, p)) continue
    trace.push(r)
    const a = r.action || 'accept'
    if (a === 'jump') {
      const sub = evalChain(st, table, r['jump-target'], p, depth + 1)
      trace.push(...sub.trace)
      if (sub.verdict !== 'return') return { verdict: sub.verdict, rule: sub.rule, trace }
      continue
    }
    if (a === 'return') return { verdict: depth ? 'return' : 'accept', rule: r, trace }
    if (['add-src-to-address-list', 'add-dst-to-address-list'].includes(a) && p.addToList) { p.addToList(r['address-list'], a === 'add-src-to-address-list' ? p.src : p.dst, r['address-list-timeout']); continue }
    if (['log', 'passthrough', 'add-src-to-address-list', 'add-dst-to-address-list', 'fasttrack-connection'].includes(a)) continue
    if (a === 'notrack') return { verdict: 'accept', rule: r, trace, notrack: true }
    if (table === 'mangle') {
      if (a === 'mark-connection') p.connMark = r['new-connection-mark']
      if (a === 'mark-packet') p.packetMark = r['new-packet-mark']
      if (a === 'mark-routing') p.routingMark = r['new-routing-mark']
      if (a === 'change-dscp') p.dscp = r['new-dscp'] === 'from-priority' ? p.priority ?? 0 : Number(r['new-dscp'])
      if (a === 'change-ttl') { const [op, n] = String(r['new-ttl']).split(':'); p.ttl = op === 'set' ? +n : op === 'increment' ? (p.ttl ?? 64) + +n : op === 'decrement' ? (p.ttl ?? 64) - +n : p.ttl }
      if (a === 'change-mss') p.mss = r['new-mss']
      if (a === 'set-priority') p.priority = r['new-priority']
      if (r.passthrough === 'no' || a === 'accept') return { verdict: 'accept', rule: r, trace }
      continue
    }
    return { verdict: a === 'tarpit' ? 'drop' : a, rule: r, trace }
  }
  return { verdict: depth ? 'return' : (table === 'nat' ? 'none' : 'accept'), trace }
}

// Replay a timed sequence of packets to the router (raw prerouting, then filter input) with live
// address lists: add-src-to-address-list rules take effect at once and entries expire by timeout.
// packets: [{ t (seconds), src, dst, protocol, dstPort, inIf, state }]. Returns { results, lists }.
const secs = (v) => {
  if (!v) return Infinity
  let n = 0
  for (const [, x, u] of String(v).matchAll(/(\d+)([wdhms]?)/g)) n += Number(x) * ({ w: 604800, d: 86400, h: 3600, m: 60, s: 1, '': 1 }[u])
  return n || Infinity
}
export function replay(st, packets) {
  const dyn = st.lists['ip firewall address-list'].filter(on).map((a) => ({ list: a.list, address: a.address, until: secs(a.timeout) }))
  const seen = {}
  const results = []
  for (const pk of packets) {
    const now = pk.t || 0
    const p = { state: 'new', ...pk }
    p.inList = (list, ip) => dyn.some((e) => e.list === list && e.until > now && matchAddr(e.address, ip))
    p.addToList = (list, ip, timeout) => {
      const e = dyn.find((x) => x.list === list && x.address === ip)
      const until = now + secs(timeout)
      if (e) e.until = until; else dyn.push({ list, address: ip, until })
    }
    const hist = (seen[p.src] = (seen[p.src] || []).concat(p.protocol === 'tcp' && p.state === 'new' ? [{ t: now, port: p.dstPort }] : []))
    p.psd = (spec) => {
      const [w, d, lo, hi] = spec.split(',')
      const win = hist.filter((h) => now - h.t <= secs(d))
      const ports = new Map(win.map((h) => [h.port, h.port < 1024 ? Number(lo) : Number(hi)]))
      return [...ports.values()].reduce((a, b) => a + b, 0) >= Number(w)
    }
    const raw = evalChain(st, 'raw', 'prerouting', p)
    if (raw.verdict === 'drop') { results.push({ verdict: 'drop', table: 'raw', rule: raw.rule }); continue }
    if (!raw.notrack && p.connCount === undefined) p.connCount = 0
    const f = evalChain(st, 'filter', 'input', p)
    results.push({ verdict: f.verdict === 'return' ? 'accept' : f.verdict, table: 'filter', rule: f.rule })
  }
  const end = packets.length ? packets[packets.length - 1].t || 0 : 0
  const lists = {}
  for (const e of dyn) if (e.until > end) (lists[e.list] = lists[e.list] || []).push(e.address)
  return { results, lists }
}

export function routerIps(st) {
  return addresses(st).filter((a) => !a.invalid).map((a) => intToIp(a.c.ip))
}

// ---------- laptop simulation ----------
export function laptopState(st) {
  const L = st.laptop
  const port = L.port
  const l3 = bridgeOf(st, port) || port
  const res = { port, l3, linked: isRunning(st, port) }
  if (!res.linked) return { ...res, ip: null, why: 'cable/port down' }
  if (L.mode === 'static') {
    res.ip = L.ip; res.gw = L.gw; res.dns = L.dns; res.mode = 'static'
  } else {
    res.mode = 'dhcp'
    const srv = st.lists['ip dhcp-server'].find((s) => on(s) && s.interface === l3)
    if (!srv) return { ...res, ip: null, why: 'no DHCP server on ' + l3 }
    const ra = addresses(st).find((a) => a.interface === l3 && !a.invalid)
    if (!ra) return { ...res, ip: null, why: 'DHCP server interface has no IP address' }
    let ip = null
    const lease = st.lists['ip dhcp-server lease'].find((l) => on(l) && l['mac-address'] && l['mac-address'].toUpperCase() === L.mac)
    if (lease) ip = lease.address
    else {
      const pool = st.lists['ip pool'].find((pl) => pl.name === srv['address-pool'])
      if (!pool) return { ...res, ip: null, why: 'DHCP server has no address pool' }
      const last = String(pool.ranges).split(',').pop()
      const [a, b] = last.includes('-') ? last.split('-') : [last.split('/')[0], last.split('/')[0]]
      ip = b || a
      if (ipToInt(ip) === null) return { ...res, ip: null, why: 'bad pool range' }
    }
    const net = st.lists['ip dhcp-server network'].find((n) => inSubnet(ip, n.address))
    if (!net) return { ...res, ip: null, why: 'no DHCP network for ' + ip }
    res.ip = ip + '/' + parseCidr(net.address).prefix
    res.gw = net.gateway || ''
    res.dns = net['dns-server'] || (st.singletons['ip dns'].servers || '').split(',')[0] || ''
    res.server = srv.name
  }
  const lc = parseCidr(res.ip)
  const ra = addresses(st).find((a) => a.interface === l3 && !a.invalid && inSubnet(lc.ip, intToIp(a.c.net) + '/' + a.c.prefix))
  res.routerIp = ra ? intToIp(ra.c.ip) : null
  res.gwOk = !!ra && res.gw === res.routerIp
  return res
}

// Simulate a new connection from the laptop to dst. Returns { ok, reason }
export function laptopReach(st, dst, protocol = 'icmp', dstPort) {
  const L = laptopState(st)
  if (!L.ip) return { ok: false, reason: 'laptop has no IP address (' + (L.why || '') + ')' }
  const lc = parseCidr(L.ip)
  if (!L.routerIp) return { ok: false, reason: 'laptop is not in the same subnet as the router' }
  const src = intToIp(lc.ip)
  if (evalChain(st, 'raw', 'prerouting', { src, dst, protocol, dstPort, inIf: L.l3, inBridgePort: L.port, state: 'new' }).verdict === 'drop') return { ok: false, reason: 'dropped by firewall raw' }
  if (dst === L.routerIp || routerIps(st).includes(dst)) {
    const p = { src, dst, protocol, dstPort, inIf: L.l3, inBridgePort: L.port, state: 'new' }
    const v = evalChain(st, 'filter', 'input', p)
    return v.verdict === 'accept' ? { ok: true } : { ok: false, reason: 'blocked by filter input' }
  }
  if (!L.gwOk) return { ok: false, reason: 'laptop gateway is wrong or missing' }
  const p = { src, dst, protocol, dstPort, srcPort: 51000, inIf: L.l3, inBridgePort: L.port, state: 'new' }
  const dn = evalChain(st, 'nat', 'dstnat', { ...p })
  if (dn.verdict === 'redirect') {
    const v = evalChain(st, 'filter', 'input', p)
    return v.verdict === 'accept' ? { ok: true, via: 'redirect' } : { ok: false, reason: 'redirected but blocked by filter input' }
  }
  const rt = lookup(st, dst)
  if (!rt) return { ok: false, reason: 'router has no route to ' + dst }
  p.outIf = rt.iface
  const fw = evalChain(st, 'filter', 'forward', p)
  if (fw.verdict !== 'accept') return { ok: false, reason: 'blocked by filter forward' }
  const internet = !isLocal(st, dst)
  if (internet) {
    if (!routerInternetVia(st, rt)) return { ok: false, reason: 'router WAN is not connected to the ISP' }
    const sn = evalChain(st, 'nat', 'srcnat', { ...p })
    if (!['masquerade', 'src-nat', 'netmap', 'same'].includes(sn.verdict)) return { ok: false, reason: 'no srcnat: private source address is not translated' }
    const back = { src: dst, dst: src, protocol, inIf: p.outIf, outIf: p.inIf, state: 'established' }
    const fb = evalChain(st, 'filter', 'forward', back)
    if (fb.verdict !== 'accept') return { ok: false, reason: 'replies blocked by filter forward' }
  }
  return { ok: true }
}

function isLocal(st, ip) {
  return addresses(st).some((a) => !a.peer && inSubnet(ip, intToIp(a.c.net) + '/' + a.c.prefix))
}

function routerInternetVia(st, rt) {
  if (!rt) return false
  if (rt.iface && rt.iface.startsWith('pppoe')) return true
  if (rt.iface === 'ether1' && rt.type !== 'C') {
    const gw = rt.gateway
    if (gw !== WORLD.ispGw) return false
    const a = addresses(st).find((x) => x.interface === 'ether1' && inSubnet(x.c.ip, WORLD.ispNet))
    return !!a && intToIp(a.c.ip) !== WORLD.ispGw
  }
  return false
}

export function routerInternet(st) {
  const rt = lookup(st, '8.8.8.8')
  if (!routerInternetVia(st, rt)) return false
  const v = evalChain(st, 'filter', 'output', { src: '0.0.0.0', dst: '8.8.8.8', protocol: 'icmp', outIf: rt.iface, state: 'new' })
  return v.verdict === 'accept'
}

export function dnsServers(st) {
  const s = (st.singletons['ip dns'].servers || '').split(',').filter(Boolean)
  for (const d of st.lists['ip dhcp-client']) if (dhcpClientStatus(st, d) === 'bound' && yes(d['use-peer-dns'])) s.push(WORLD.ispGw)
  for (const p of st.lists['interface pppoe-client']) if (pppoeStatus(st, p) === 'connected' && yes(p['use-peer-dns'])) s.push(WORLD.pppoeRemote)
  return [...new Set(s)]
}

export function routerResolve(st, name) {
  if (ipToInt(name) !== null) return name
  const stat = st.lists['ip dns static'].find((d) => on(d) && d.name === name)
  if (stat) return stat.address
  if (!dnsServers(st).length || !routerInternet(st)) return null
  return WORLD.names[name] || null
}

export function laptopInternet(st) {
  const r = laptopReach(st, '8.8.8.8', 'icmp')
  if (!r.ok) return r
  const L = laptopState(st)
  if (!L.dns) return { ok: false, reason: 'laptop has no DNS server' }
  if (L.dns === L.routerIp) {
    if (!yes(st.singletons['ip dns']['allow-remote-requests'])) return { ok: false, reason: 'router DNS: allow-remote-requests=no' }
    const d = laptopReach(st, L.dns, 'udp', 53)
    if (!d.ok) return { ok: false, reason: 'DNS to router blocked' }
    if (!routerResolve(st, 'mikrotik.com')) return { ok: false, reason: 'router cannot resolve names (no DNS servers?)' }
  } else {
    const d = laptopReach(st, L.dns, 'udp', 53)
    if (!d.ok) return { ok: false, reason: 'DNS server ' + L.dns + ' unreachable: ' + d.reason }
  }
  return { ok: true }
}

// ---------- CLI ----------
function tokenize(line) {
  const out = []
  let cur = '', q = false, started = false, br = 0
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { q = !q; started = true; continue }
    // [find ...] stays one token
    if (!q && ch === '[') br++
    if (!q && ch === ']' && br) br--
    if (!q && !br && /\s/.test(ch)) { if (started) { out.push(cur); cur = ''; started = false } continue }
    if (!q && ch === '\\' && i === line.length - 1) continue
    cur += ch; started = true
  }
  if (started) out.push(cur)
  return out
}

function splitPathTokens(tokens) {
  // support /ip/address/print style
  const res = []
  tokens.forEach((t, i) => {
    if (t.includes('=') || t === '/' || t === '..' || t.startsWith('[')) { res.push(t); return }
    if (t.includes('/') && !/^\d/.test(t)) {
      const parts = t.split('/')
      if (t.startsWith('/')) res.push('/')
      parts.filter(Boolean).forEach((p) => res.push(p))
    } else res.push(t)
  })
  return res
}

const pad = (s, n) => { s = String(s ?? ''); return s.length >= n ? s + ' ' : s + ' '.repeat(n - s.length) }

export class RouterOS {
  constructor(st) {
    this.st = st || defaultConfig()
    this.cwd = ''
    this.history = []
  }

  get identity() { return this.st.singletons['system identity'].name }
  prompt() { return `[admin@${this.identity}] ${this.cwd ? '/' + this.cwd.replace(/ /g, ' ') + '' : ''}> ` }

  exec(line) {
    line = line.trim()
    if (!line) return ''
    this.history.push(line)
    if (line.startsWith('#')) return ''
    try {
      return this._exec(line)
    } catch (e) {
      return e.cliError ? e.message : 'failure: ' + e.message
    }
  }

  _err(msg) { const e = new Error(msg); e.cliError = true; throw e }

  _exec(line) {
    let tokens = splitPathTokens(tokenize(line))
    let path = this.cwd
    let i = 0
    if (tokens[0] === '/') { path = ''; i = 1 }
    else if (tokens[0] && tokens[0].startsWith('/')) { path = ''; tokens[0] = tokens[0].slice(1) }
    for (; i < tokens.length; i++) {
      const t = tokens[i]
      if (t === '..') { path = path.split(' ').slice(0, -1).join(' '); continue }
      if (t === '/') { path = ''; continue }
      const cand = path ? path + ' ' + t : t
      if (MENUS[cand] !== undefined || PATHS.some((p) => p.startsWith(cand + ' '))) { path = cand; continue }
      // abbreviations: unique prefix of a child menu
      const kids = childMenus(path).filter((k) => k.startsWith(t))
      if (kids.length === 1 && !commandsFor(path).includes(t) && !t.includes('=')) { path = path ? path + ' ' + kids[0] : kids[0]; continue }
      break
    }
    if (i >= tokens.length) { this.cwd = path; return '' }
    const cmd = tokens[i]
    const args = tokens.slice(i + 1)
    return this.run(path, cmd, args, line)
  }

  parseArgs(args, line) {
    const kv = {}, pos = []
    for (const a of args) {
      const k = a.indexOf('=')
      if (k > 0 && !a.startsWith('[')) kv[a.slice(0, k)] = a.slice(k + 1)
      else pos.push(a)
    }
    return { kv, pos }
  }

  colErr(line, word) {
    const col = Math.max(1, line.indexOf(word) + 1)
    return `expected end of command (line 1 column ${col})`
  }

  run(path, cmd, args, line) {
    const st = this.st
    const { kv, pos } = this.parseArgs(args, line)
    // global commands
    if (cmd === 'traceroute' && path === '') return this.traceroute(pos[0] || kv.address, kv)
    if (cmd === 'ping' && (path === '' || path === 'tool')) return this.ping(pos[0] || kv.address, Number(kv.count || 4), kv)
    if (cmd === 'traceroute' && (path === '' || path === 'tool')) return this.traceroute(pos[0] || kv.address, kv)
    if (cmd === 'quit' || cmd === 'exit') { st.loggedOut = true; return 'interrupted\nwelcome back!' }
    if (cmd === 'help' && path === '') return HELP
    if (cmd === 'export' && path === '') return this.exportAll(kv)
    if (cmd === 'import' && path === '') return 'Script file loaded and executed successfully'
    if (path === '' && cmd !== 'export') {
      const kids = childMenus('').filter((k) => k.startsWith(cmd))
      return `bad command name ${cmd} (line 1 column ${line.indexOf(cmd) + 1})` + (kids.length ? '' : '')
    }
    const m = MENUS[path]
    const cmds = commandsFor(path)
    if (!cmds.includes(cmd)) {
      const abbr = cmds.filter((c) => c.startsWith(cmd))
      if (abbr.length === 1) cmd = abbr[0]
      else return `bad command name ${cmd} (line 1 column ${line.indexOf(cmd) + 1})`
    }
    // special commands
    if (path === 'system' && cmd === 'reboot') return 'Reboot, yes? [y/N]: y\nsystem will reboot shortly (simulated: configuration kept)'
    if (path === 'system' && cmd === 'shutdown') return 'Shutdown, yes? [y/N]: y\n(simulated: nothing happens)'
    if (path === 'system' && cmd === 'sup-output') { st.files.push({ name: 'supout.rif', type: '.rif file' }); return '  creating supout.rif file, might take a while\n  Accomplished!' }
    if (path === 'system' && cmd === 'reset-configuration') {
      const nd = yes(kv['no-defaults'])
      const fresh = nd ? emptyConfig() : defaultConfig()
      if (yes(kv['keep-users'])) fresh.lists.user = st.lists.user
      this.st = fresh; this.cwd = ''
      if (this.onReset) this.onReset(fresh)
      return 'Dangerous! Reset anyway? [y/N]: y\nsystem configuration will be reset' + (nd ? ' (no default configuration)' : ' (default configuration loaded)')
    }
    if (path === 'system backup' && cmd === 'save') {
      const name = (kv.name || `${this.identity}-20261014-1200`) + '.backup'
      st.files.push({ name, type: 'backup' })
      return `Saving system configuration\nConfiguration backup saved (${name})`
    }
    if (path === 'system backup' && cmd === 'load') return 'Restore and reboot? [y/N]: n\n(simulated)'
    if (path === 'system routerboard' && cmd === 'upgrade') return 'Do you really want to upgrade firmware? [y/n]\ny\necho: system,info,critical Firmware upgraded successfully, please reboot for changes to take effect!'
    if (path === 'system package' && cmd === 'update') return 'use: /system package update check-for-updates  (simulated: you are on the latest stable 7.16.2)'
    if (path === 'interface wireless' && cmd === 'scan') return this.scan(pos[0] || kv.interface)
    if (path === 'ip dhcp-server' && cmd === 'setup') return 'The interactive DHCP setup wizard is not simulated.\nCreate it manually:\n  /ip pool add name=pool1 ranges=192.168.33.10-192.168.33.254\n  /ip dhcp-server add interface=bridgeLAN address-pool=pool1 disabled=no\n  /ip dhcp-server network add address=192.168.33.0/24 gateway=192.168.33.1 dns-server=192.168.33.1'
    if (path === 'ip dhcp-server lease' && cmd === 'make-static') return 'ok (simulated)'
    if (path === 'tool' && ['torch', 'profile', 'bandwidth-test', 'sniffer'].includes(cmd)) return this.toolSim(cmd, pos, kv)
    if (path === 'certificate' && ['sign', 'import', 'export-certificate'].includes(cmd)) return this.certCmd(cmd, pos, kv)
    if (cmd === 'export') return this.exportMenu(path, kv)
    if (m.kind === 'info') return this.info(path)
    if (cmd === 'print') return this.print(path, kv, pos)
    if (cmd === 'find') return ''
    if (m.kind === 'singleton') {
      if (cmd !== 'set') return `bad command name ${cmd}`
      for (const k of Object.keys(kv)) if (!m.fields.includes(k)) return this.colErr(line, k + '=')
      if (path === 'system identity' && kv.name !== undefined && kv.name.length > 64) return 'failure: identity name too long (max 64)'
      const allowed = { 'ip ssh': { 'forwarding-enabled': ['no', 'local', 'remote', 'both'], 'strong-crypto': BOOL, 'always-allow-password-login': BOOL }, 'ip settings': { 'rp-filter': ['no', 'strict', 'loose'], 'tcp-syncookies': BOOL, 'accept-redirects': BOOL, 'send-redirects': BOOL, 'secure-redirects': BOOL, 'accept-source-route': BOOL, 'ip-forward': BOOL },
        'interface l2tp-server server': { 'use-ipsec': ['no', 'yes', 'required'], enabled: BOOL }, 'interface sstp-server server': { 'tls-version': ['any', 'only-1.2', 'only-1.3'], enabled: BOOL, 'verify-client-certificate': BOOL, 'force-aes': BOOL, pfs: BOOL } }[path] || {}
      for (const [k, v] of Object.entries(kv)) if (allowed[k] && !allowed[k].includes(v)) return `invalid value ${v} for argument ${k}`
      if (path === 'interface sstp-server server' && kv.certificate && kv.certificate !== 'none' && !st.lists.certificate.some((c) => c.name === kv.certificate)) return 'input does not match any value of certificate'
      Object.assign(st.singletons[path], kv)
      return ''
    }
    // flag properties written without a value (v7 style: passive, fib, blackhole, no-summaries)
    for (const f of m.flags || []) { const k = pos.indexOf(f); if (k >= 0) { pos.splice(k, 1); kv[f] = 'yes' } }
    if (cmd === 'add') return this.add(path, kv, line)
    if (['set', 'remove', 'enable', 'disable', 'comment', 'move'].includes(cmd)) return this.modify(path, cmd, pos, kv, line)
    return `bad command name ${cmd}`
  }

  items(path) {
    const st = this.st
    if (path === 'interface') return allInterfaces(st)
    if (path === 'interface wireless') return st.interfaces.filter((i) => i.type === 'wlan').map((i) => ({ ...st.wireless[i.name], name: i.name, disabled: i.disabled }))
    if (path === 'ip service') return st.services
    if (path === 'ip dns cache') {
      // statics answer from the cache; names the router looked up upstream stay for their TTL
      const stat = st.lists['ip dns static'].filter((d) => on(d) && d.name && (d.address || d.cname)).map((d) => ({ name: d.name, type: d.type || (d.cname ? 'CNAME' : 'A'), data: d.address || d.cname, ttl: d.ttl || '1d' }))
      const up = dnsServers(st).length && routerInternet(st) ? Object.entries(WORLD.names).map(([name, ip]) => ({ name, type: 'A', data: ip, ttl: '4m59s' })) : []
      return [...stat, ...up]
    }
    return st.lists[path] || []
  }

  resolveRefs(path, refs) {
    const list = this.items(path)
    const lp = this.st.lastPrint[path] || list.map((x, n) => x['.id'] ?? x.name)
    const out = []
    for (const ref of refs.flatMap((r) => r.startsWith('[') ? [r] : r.split(','))) {
      if (/^\d+$/.test(ref)) {
        const id = lp[Number(ref)]
        const it = list.find((x) => (x['.id'] ?? x.name) === id)
        if (!it) this._err(`no such item`)
        out.push(it)
      } else if (/^\[find/.test(ref)) {
        // [find], [find key=value ...] and [find where key=value ...]: every condition must match
        const conds = ref.replace(/^\[find\s*(where\s+)?|\]$/g, '').trim().split(/\s+/).filter(Boolean).map((c) => {
          const i = c.indexOf('=')
          if (i < 1) this._err('only key=value conditions are simulated inside [find ...]')
          return [c.slice(0, i), c.slice(i + 1)]
        })
        const defs = (MENUS[path] && MENUS[path].defaults) || {}
        const val = (x, k) => String(x[k] ?? (k === 'dst-address' && path === 'ip route' ? '0.0.0.0/0' : defs[k] ?? ''))
        out.push(...list.filter((x) => conds.every(([k, v]) => val(x, k) === v)))
      } else {
        const it = list.find((x) => x.name === ref || x.interface === ref && !('name' in x) || x.address === ref || x['mac-address'] === ref)
        if (!it) this._err(`no such item (4)`)
        out.push(it)
      }
    }
    return out
  }

  validate(path, kv, line, existing) {
    const st = this.st
    const m = MENUS[path]
    for (const k of Object.keys(kv)) if (!m.fields.includes(k)) this._err(this.colErr(line, k + '='))
    const ifKeys = ['interface', 'in-interface', 'out-interface', 'bridge', 'master-interface']
    for (const k of ifKeys) {
      if (kv[k] === undefined || kv[k] === '') continue
      const v = kv[k].replace(/^!/, '')
      if (k === 'interface' && (v === 'any' || v === 'all') && path.includes('wireless')) continue
      if (k === 'bridge') { if (!st.lists['interface bridge'].some((b) => b.name === v)) this._err('input does not match any value of bridge'); continue }
      if (!interfaceExists(st, v)) this._err(`input does not match any value of ${k}`)
    }
    for (const k of ['in-interface-list', 'out-interface-list', 'list', 'allowed-interface-list', 'discover-interface-list']) {
      if (kv[k] === undefined) continue
      if (path === 'ip firewall address-list' || path === 'interface list member' && k !== 'list') continue
      const v = kv[k].replace(/^!/, '')
      if (path === 'interface list member' && k === 'list' || k.endsWith('interface-list')) {
        if (!['all', 'none', 'dynamic'].includes(v) && !st.lists['interface list'].some((l) => l.name === v)) this._err(`input does not match any value of ${k}`)
      }
    }
    for (const k of ['address', 'dst-address', 'src-address', 'network', 'gateway', 'to-addresses', 'target', 'dst']) {
      const v = kv[k]
      if (v === undefined || v === '') continue
      if (path === 'ip dns static' && k === 'address') {
        const ty = kv.type || (existing && existing.type) || 'A'
        if (ty === 'AAAA' ? !/^[0-9a-fA-F:]+$/.test(v) || !v.includes(':') : ipToInt(v) === null) this._err('invalid value for argument address')
        continue
      }
      if (k === 'gateway') {
        for (const g of v.split(',')) { const [ip, ifc] = g.split('%'); if (ipToInt(ip) === null && !interfaceExists(st, ip) || ifc && !interfaceExists(st, ifc)) this._err('invalid value for argument gateway') }
        continue
      }
      if (k === 'target' || k === 'dst') {
        for (const x of v.split(',')) if (!parseCidr(x) && !interfaceExists(st, x)) this._err(`invalid value for argument ${k}`)
        continue
      }
      if (path === 'ip firewall address-list' && k === 'address') continue
      if (path.startsWith('ip ipsec') && v.includes(':')) continue
      const vals = v.replace(/^!/, '').split(',')
      for (const x of vals) {
        const ok = x.includes('-') ? x.split('-').every((y) => ipToInt(y) !== null) : !!parseCidr(x)
        if (!ok) this._err(`invalid value for argument ${k}`)
      }
    }
    if (kv.chain && path === 'ip firewall nat' && !['srcnat', 'dstnat'].includes(kv.chain) && !st.lists[path].some((r) => r['jump-target'] === kv.chain) && !kv['jump-target']) {
      // custom chains are allowed, but warn on common mistakes
      if (['input', 'forward', 'output'].includes(kv.chain)) this._err('invalid value for argument chain (NAT chains are srcnat and dstnat)')
    }
    if (kv.chain && path === 'ip firewall raw' && ['input', 'forward', 'postrouting', 'srcnat', 'dstnat'].includes(kv.chain)) this._err('invalid value for argument chain (RAW chains are prerouting and output)')
    const acts = path === 'ip firewall filter' ? ACT_FILTER : path === 'ip firewall nat' ? ACT_NAT : path === 'ip firewall mangle' ? ACT_MANGLE : path === 'ip firewall raw' ? ACT_RAW : null
    if (acts && kv.action && !acts.includes(kv.action)) this._err(`invalid value ${kv.action} for argument action`)
    if (acts && kv.action === 'jump' && !kv['jump-target'] && !(existing && existing['jump-target'])) this._err('failure: jump-target not specified')
    if (path === 'interface bridge port' && kv.interface) {
      const t = kv.interface
      if (st.lists['interface bridge port'].some((p) => p.interface === t && p !== existing)) this._err('failure: device already added as bridge port')
      if (st.lists['interface bridge'].some((b) => b.name === t)) this._err('failure: bridge cannot be added to itself')
    }
    if (path === 'interface wireless' && kv.mode) {
      const modes = ['station', 'station-bridge', 'station-pseudobridge', 'station-wds', 'ap-bridge', 'bridge', 'wds-slave', 'alignment-only', 'nstreme-dual-slave']
      if (!modes.includes(kv.mode)) this._err(`invalid value ${kv.mode} for argument mode`)
    }
    if (path === 'interface wireless' && kv.frequency && kv.frequency !== 'auto') {
      const f = Number(kv.frequency)
      if (!(f >= 2412 && f <= 2484) && !(f >= 5150 && f <= 5900)) this._err('invalid value for argument frequency')
    }
    if (path === 'certificate' && kv['key-usage']) for (const u of kv['key-usage'].split(',')) if (!KEY_USAGE.includes(u)) this._err(`invalid value ${u} for argument key-usage`)
    if (path === 'ip ipsec peer' && kv['exchange-mode'] && !['main', 'aggressive', 'ike2', 'base'].includes(kv['exchange-mode'])) this._err(`invalid value ${kv['exchange-mode']} for argument exchange-mode`)
    if (path === 'ip ipsec identity') {
      if (kv['auth-method'] && !['pre-shared-key', 'pre-shared-key-xauth', 'digital-signature', 'rsa-key', 'eap', 'eap-radius'].includes(kv['auth-method'])) this._err(`invalid value ${kv['auth-method']} for argument auth-method`)
      if (kv['generate-policy'] && !['no', 'port-override', 'port-strict'].includes(kv['generate-policy'])) this._err(`invalid value ${kv['generate-policy']} for argument generate-policy`)
      if (kv.peer && !st.lists['ip ipsec peer'].some((x) => x.name === kv.peer)) this._err('input does not match any value of peer')
      if (kv['mode-config'] && !st.lists['ip ipsec mode-config'].some((x) => x.name === kv['mode-config'])) this._err('input does not match any value of mode-config')
      if (kv['policy-template-group'] && !st.lists['ip ipsec policy group'].some((x) => x.name === kv['policy-template-group'])) this._err('input does not match any value of policy-template-group')
      for (const k of ['certificate', 'remote-certificate']) if (kv[k] && kv[k] !== 'none' && !st.lists.certificate.some((c) => c.name === kv[k])) this._err(`input does not match any value of ${k}`)
    }
    if (path === 'ip ipsec peer' && kv.profile && !st.lists['ip ipsec profile'].some((x) => x.name === kv.profile)) this._err('input does not match any value of profile')
    if (path === 'ip ipsec policy') {
      if (kv.group && !st.lists['ip ipsec policy group'].some((x) => x.name === kv.group)) this._err('input does not match any value of group')
      if (kv.proposal && !st.lists['ip ipsec proposal'].some((x) => x.name === kv.proposal)) this._err('input does not match any value of proposal')
    }
    if (path === 'ip ipsec mode-config' && kv['address-pool'] && !st.lists['ip pool'].some((x) => x.name === kv['address-pool'])) this._err('input does not match any value of address-pool')
    const tables = st.lists['routing table'].map((x) => x.name)
    if (kv['routing-table'] && !tables.includes(kv['routing-table'])) this._err('input does not match any value of routing-table (create it in /routing table first)')
    if (path === 'routing rule' && kv.table && !tables.includes(kv.table)) this._err('input does not match any value of table')
    if (path === 'routing rule' && kv.action && !['lookup', 'lookup-only-in-table', 'drop', 'unreachable'].includes(kv.action)) this._err(`invalid value ${kv.action} for argument action`)
    if (path === 'routing rule' && kv.interface && !interfaceExists(st, kv.interface)) this._err('input does not match any value of interface')
    if (path === 'routing ospf area' && kv.instance && !st.lists['routing ospf instance'].some((x) => x.name === kv.instance)) this._err('input does not match any value of instance')
    if (path === 'routing ospf area' && kv.type && !['default', 'stub', 'nssa'].includes(kv.type)) this._err(`invalid value ${kv.type} for argument type`)
    if (['routing ospf interface-template', 'routing ospf area range', 'routing ospf static-neighbor'].includes(path) && kv.area && !st.lists['routing ospf area'].some((x) => x.name === kv.area)) this._err('input does not match any value of area')
    if (path === 'routing ospf interface-template') {
      if (kv.interfaces) for (const x of kv.interfaces.split(',')) if (!interfaceExists(st, x) && !st.lists['interface list'].some((l) => l.name === x)) this._err('input does not match any value of interfaces')
      if (kv.networks) for (const x of kv.networks.split(',')) if (!parseCidr(x)) this._err('invalid value for argument networks')
      if (kv.type && !['broadcast', 'nbma', 'ptp', 'ptmp', 'ptp-unnumbered', 'virtual-link'].includes(kv.type)) this._err(`invalid value ${kv.type} for argument type`)
      if (kv.cost && !(Number(kv.cost) >= 0 && Number(kv.cost) <= 65535)) this._err('invalid value for argument cost')
      if (kv.priority && !(Number(kv.priority) >= 0 && Number(kv.priority) <= 255)) this._err('invalid value for argument priority')
    }
    if (path === 'routing ospf instance') {
      if (kv['router-id'] && kv['router-id'] !== 'main' && ipToInt(kv['router-id']) === null) this._err('invalid value for argument router-id')
      if (kv['originate-default'] && !['never', 'if-installed', 'always'].includes(kv['originate-default'])) this._err(`invalid value ${kv['originate-default']} for argument originate-default`)
      if (kv.redistribute) for (const x of kv.redistribute.split(',')) if (!['connected', 'static', 'rip', 'bgp', 'ospf', 'dhcp', 'vpn', 'modem', 'copy', 'fantasy', ''].includes(x)) this._err(`invalid value ${x} for argument redistribute`)
    }
    if (path === 'routing ospf area range' && kv.prefix && !parseCidr(kv.prefix)) this._err('invalid value for argument prefix')
    if (path === 'routing filter rule' && kv.rule !== undefined) { const e = checkFilterRule(kv.rule); if (e) this._err('syntax error: ' + e) }
    if (['interface gre', 'interface ipip', 'interface eoip', 'interface wireguard peers'].includes(path)) for (const k of ['local-address', 'remote-address', 'endpoint-address']) if (kv[k] && ipToInt(kv[k]) === null) this._err(`invalid value for argument ${k}`)
    if (path === 'interface eoip' && kv['tunnel-id'] !== undefined && !(Number(kv['tunnel-id']) >= 0 && Number(kv['tunnel-id']) <= 65535)) this._err('invalid value for argument tunnel-id')
    if (path === 'interface wireguard peers' && kv['allowed-address']) for (const x of kv['allowed-address'].split(',')) if (!parseCidr(x)) this._err('invalid value for argument allowed-address')
    if (path === 'ip route' && kv.scope && !(Number(kv.scope) >= 0 && Number(kv.scope) <= 255)) this._err('invalid value for argument scope')
    if (path === 'ip route' && kv['target-scope'] && !(Number(kv['target-scope']) >= 0 && Number(kv['target-scope']) <= 255)) this._err('invalid value for argument target-scope')
    if (path === 'ip route' && kv.type && !['unicast', 'blackhole', 'prohibit', 'unreachable'].includes(kv.type)) this._err(`invalid value ${kv.type} for argument type`)
    if (path === 'ip route' && kv['check-gateway'] && !['ping', 'arp', 'bfd', 'none'].includes(kv['check-gateway'])) this._err(`invalid value ${kv['check-gateway']} for argument check-gateway`)
    if (path === 'ip dns static') {
      if (kv.type && !['A', 'AAAA', 'CNAME', 'FWD', 'MX', 'NS', 'NXDOMAIN', 'SRV', 'TXT'].includes(kv.type)) this._err(`invalid value ${kv.type} for argument type`)
      if (kv.regexp !== undefined) { try { new RegExp(kv.regexp) } catch { this._err('invalid value for argument regexp') } }
      if (kv['forward-to'] && kv['forward-to'].split(',').some((x) => ipToInt(x) === null)) this._err('invalid value for argument forward-to')
    }
    if (path === 'ip dhcp-server') {
      if (kv.authoritative && !['yes', 'no', 'after-2sec-delay', 'after-10sec-delay'].includes(kv.authoritative)) this._err(`invalid value ${kv.authoritative} for argument authoritative`)
      if (kv['address-pool'] && kv['address-pool'] !== 'static-only' && !st.lists['ip pool'].some((x) => x.name === kv['address-pool'])) this._err('input does not match any value of address-pool')
      for (const k of ['relay', 'src-address']) if (kv[k] && ipToInt(kv[k]) === null) this._err(`invalid value for argument ${k}`)
      if (kv['delay-threshold'] && kv['delay-threshold'] !== 'none' && !/^\d+[smh]?$/.test(kv['delay-threshold'])) this._err('invalid value for argument delay-threshold')
      if (kv['dhcp-option-set'] && !st.lists['ip dhcp-server option sets'].some((x) => x.name === kv['dhcp-option-set'])) this._err('input does not match any value of dhcp-option-set')
    }
    if (path === 'ip dhcp-server option') {
      if (kv.code !== undefined && !(Number(kv.code) >= 1 && Number(kv.code) <= 254)) this._err('invalid value for argument code')
      if (kv.value !== undefined && !/^(0x[0-9a-fA-F]+|'.*'|s'.*'|\$\(.+\)|\d+)$/.test(kv.value)) this._err('invalid value for argument value (use 0x... hex, \'text\' or a number)')
    }
    for (const k of ['dhcp-option', 'options']) if (kv[k] && ['ip dhcp-server network', 'ip dhcp-server option sets'].includes(path)) for (const x of kv[k].split(',')) if (!st.lists['ip dhcp-server option'].some((o) => o.name === x)) this._err(`input does not match any value of ${k}`)
    if (path === 'ip dhcp-server network' && kv['dhcp-option-set'] && !st.lists['ip dhcp-server option sets'].some((x) => x.name === kv['dhcp-option-set'])) this._err('input does not match any value of dhcp-option-set')
    if (path === 'ip dhcp-relay') for (const k of ['dhcp-server', 'local-address']) if (kv[k] && kv[k].split(',').some((x) => ipToInt(x) === null)) this._err(`invalid value for argument ${k}`)
    if (path.startsWith('ip proxy ') && kv.action && !['allow', 'deny'].includes(kv.action)) this._err(`invalid value ${kv.action} for argument action`)
    if (path === 'ip proxy' && kv.port && !(Number(kv.port) >= 1 && Number(kv.port) <= 65535)) this._err('invalid value for argument port')
    if (path === 'queue type' && kv.kind && !QUEUE_KINDS.includes(kv.kind)) this._err(`invalid value ${kv.kind} for argument kind`)
    if (path === 'queue type' && kv['pcq-classifier']) for (const x of kv['pcq-classifier'].split(',')) if (!['src-address', 'dst-address', 'src-port', 'dst-port', 'src-address6', 'dst-address6'].includes(x)) this._err(`invalid value ${x} for argument pcq-classifier`)
    if (path === 'queue tree' || path === 'queue simple') {
      if (kv.queue) for (const x of kv.queue.split('/')) if (!st.lists['queue type'].some((q) => q.name === x)) this._err('input does not match any value of queue')
      if (kv.priority && kv.priority.split('/').some((x) => !(Number(x) >= 1 && Number(x) <= 8))) this._err('invalid value for argument priority (1..8)')
      for (const k of ['max-limit', 'limit-at', 'burst-limit', 'burst-threshold']) if (kv[k] && kv[k].split('/').some((x) => parseRate(x) === null)) this._err(`invalid value for argument ${k}`)
    }
    if (path === 'queue tree' && kv.parent && kv.parent !== 'global' && !interfaceExists(st, kv.parent) && !st.lists['queue tree'].some((q) => q.name === kv.parent && q !== existing)) this._err('input does not match any value of parent')
    if (path === 'ip firewall mangle') {
      if (kv['new-dscp'] !== undefined && !(Number(kv['new-dscp']) >= 0 && Number(kv['new-dscp']) <= 63)) this._err('invalid value for argument new-dscp (0..63)')
      if (kv['new-ttl'] !== undefined && !/^(set|increment|decrement):\d+$/.test(kv['new-ttl'])) this._err('invalid value for argument new-ttl (set:N, increment:N or decrement:N)')
      if (kv.action === 'change-dscp' && kv['new-dscp'] === undefined && !(existing && existing['new-dscp'] !== undefined)) this._err('failure: new-dscp not specified')
    }
    if (path.startsWith('ip firewall') && kv['icmp-options'] && !/^\d+(:\d+(-\d+)?)?$/.test(kv['icmp-options'])) this._err('invalid value for argument icmp-options (type:code)')
    if (path.startsWith('ip firewall') && kv.dscp && !(Number(kv.dscp.replace(/^!/, '')) >= 0 && Number(kv.dscp.replace(/^!/, '')) <= 63)) this._err('invalid value for argument dscp')
    for (const k of ['disabled', 'add-default-route', 'use-peer-dns', 'allow-remote-requests', 'default-forward', 'default-authenticate', 'only-one', 'one-session-per-host', 'enabled', 'passthrough', 'template', 'passive', 'responder', 'system-dns', 'send-initial-contact', 'trusted', 'fib', 'blackhole', 'no-summaries', 'advertise']) {
      if (kv[k] !== undefined && !BOOL.includes(kv[k]) && !(k === 'only-one' && kv[k] === 'default') && !(k === 'add-default-route' && kv[k] === 'special-classless')) this._err(`invalid value ${kv[k]} for argument ${k}`)
    }
  }

  add(path, kv, line) {
    const st = this.st
    const m = MENUS[path]
    this.validate(path, kv, line)
    for (const r of m.req || []) if (kv[r] === undefined || kv[r] === '') {
      if (r === 'name' && m.iface) continue
      return `failure: ${r} not specified`
    }
    if (m.iface && !kv.name) {
      let n = 1
      const base = { wg: 'wireguard' }[m.iface] || m.iface
      while (interfaceExists(st, base + n)) n++
      kv.name = base + n
    }
    if (m.autoName && !kv.name) {
      let n = 1
      while (st.lists[path].some((x) => x.name === m.autoName + n)) n++
      kv.name = m.autoName + n
    }
    if (kv.name && (m.iface ? interfaceExists(st, kv.name) : st.lists[path].some((x) => x.name === kv.name))) return 'failure: item with such name already exists'
    if (path === 'certificate' && !kv['common-name']) return 'failure: common-name not specified'
    if (path === 'ip address' && kv.address && !kv.address.includes('/')) kv.address += '/32'
    if (path === 'ip address' && kv.address) {
      const c = parseCidr(kv.address)
      if (!(c.prefix === 32 && kv.network && ipToInt(kv.network) !== null)) kv.network = intToIp(c.net)
    }
    if (path === 'interface bridge' || path === 'interface eoip') kv['.mac'] = mac()
    if (path === 'interface wireguard') {
      if (!kv['private-key']) kv['private-key'] = wgKey('priv', st.seq + (this.identity || ''))
      kv['public-key'] = wgKey('pub', kv['private-key'])
    }
    const before = kv['place-before']
    delete kv['place-before']
    const it = { '.id': st.seq++, disabled: 'no', ...(m.defaults || {}), ...kv }
    if (kv.disabled === undefined && m.defaults && m.defaults.disabled) it.disabled = m.defaults.disabled
    if (before !== undefined && m.ordered) {
      const lp = st.lastPrint[path] || st.lists[path].map((x) => x['.id'])
      const id = lp[Number(before)]
      const idx = st.lists[path].findIndex((x) => x['.id'] === id)
      if (idx < 0) return 'failure: no such item'
      st.lists[path].splice(idx, 0, it)
    } else st.lists[path].push(it)
    return ''
  }

  modify(path, cmd, pos, kv, line) {
    const st = this.st
    const m = MENUS[path]
    if (!pos.length && !kv.numbers) return 'failure: numbers not specified (use print to see item numbers)'
    const refs = pos.length ? [pos[0]] : [kv.numbers]
    delete kv.numbers
    const its = this.resolveRefs(path, refs)
    if (cmd === 'remove') {
      if (m.kind === 'fixed') return 'failure: can not remove ' + path.split(' ').pop()
      for (const it of its) {
        if (it['.builtin']) return 'failure: can not remove default item'
        if (path === 'user' && it.name === 'admin' && st.lists.user.filter((u) => u.group === 'full' && u !== it && on(u)).length === 0) return 'failure: can not remove last full user'
        st.lists[path] = st.lists[path].filter((x) => x !== it)
        if (path === 'interface bridge') st.lists['interface bridge port'] = st.lists['interface bridge port'].filter((p) => p.bridge !== it.name)
      }
      return ''
    }
    if (cmd === 'move') {
      const to = pos[1] ?? kv.destination
      const list = st.lists[path]
      const it = its[0]
      const lp = st.lastPrint[path] || list.map((x) => x['.id'])
      const target = list.find((x) => x['.id'] === lp[Number(to)])
      st.lists[path] = list.filter((x) => x !== it)
      const idx = target ? st.lists[path].indexOf(target) : st.lists[path].length
      st.lists[path].splice(idx, 0, it)
      return ''
    }
    if (cmd === 'enable' || cmd === 'disable') kv = { disabled: cmd === 'disable' ? 'yes' : 'no' }
    if (cmd === 'comment') kv = { comment: pos[1] ?? kv.comment ?? '' }
    for (const it of its) {
      if (path === 'interface') {
        for (const k of Object.keys(kv)) if (!m.fields.includes(k)) return this.colErr(line, k + '=')
        if (it.dynamic) return 'failure: can not change dynamic'
        const target = it['.path'] ? st.lists[it['.path']].find((x) => x.name === it.name) : st.interfaces.find((x) => x.name === it.name)
        if (kv.name && kv.name !== it.name) {
          if (interfaceExists(st, kv.name)) return 'failure: interface with such name exists'
          this.renameIface(it.name, kv.name)
        }
        if (kv.arp && it['.path'] === 'interface bridge') target.arp = kv.arp
        Object.assign(target, kv)
        continue
      }
      if (path === 'interface wireless') {
        this.validate(path, kv, line)
        const w = st.wireless[it.name]
        if (kv.disabled !== undefined) st.interfaces.find((x) => x.name === it.name).disabled = kv.disabled
        const rest = { ...kv }; delete rest.disabled; delete rest.name
        if (rest['security-profile'] && !st.lists['interface wireless security-profiles'].some((s) => s.name === rest['security-profile'])) return 'input does not match any value of security-profile'
        Object.assign(w, rest)
        continue
      }
      if (path === 'ip service') {
        for (const k of Object.keys(kv)) if (!m.fields.includes(k)) return this.colErr(line, k + '=')
        Object.assign(it, kv)
        continue
      }
      this.validate(path, kv, line, it)
      if (path === 'ip address' && kv.address) {
        if (!kv.address.includes('/')) kv.address += '/32'
        const c = parseCidr(kv.address)
        if (!(c.prefix === 32 && kv.network)) kv.network = intToIp(c.net)
      }
      if (path === 'interface wireguard' && kv['private-key']) kv['public-key'] = wgKey('pub', kv['private-key'])
      if (kv.name && MENUS[path].iface && kv.name !== it.name) this.renameIface(it.name, kv.name)
      Object.assign(it, kv)
    }
    return ''
  }

  renameIface(oldN, newN) {
    const st = this.st
    for (const list of Object.values(st.lists)) for (const it of list) {
      for (const k of ['interface', 'in-interface', 'out-interface', 'bridge', 'gateway', 'master-interface']) {
        if (it[k] === oldN) it[k] = newN
        if (it[k] === '!' + oldN) it[k] = '!' + newN
      }
    }
    if (st.wireless[oldN]) { st.wireless[newN] = st.wireless[oldN]; delete st.wireless[oldN] }
    if (st.laptop.port === oldN) st.laptop.port = newN
    const i = st.cabled.indexOf(oldN)
    if (i >= 0) st.cabled[i] = newN
  }

  // ---------- certificates ----------
  certCmd(cmd, pos, kv) {
    const st = this.st
    const certs = st.lists.certificate
    const lp = st.lastPrint.certificate || certs.map((c) => c['.id'])
    const find = (n) => /^\d+$/.test(String(n)) ? certs.find((c) => c['.id'] === lp[Number(n)]) : certs.find((c) => c.name === n)
    if (cmd === 'sign') {
      const c = find(pos[0] || kv.numbers)
      if (!c) return 'no such item'
      if (c['.signed']) return 'failure: certificate already signed'
      if (!c['common-name']) return 'failure: common-name not set'
      if (kv.ca) {
        const ca = find(kv.ca)
        if (!ca) return 'input does not match any value of ca'
        if (!ca['.signed'] || !ca['.key']) return 'failure: CA certificate must be signed and have a private key'
        if (ca['key-usage'] && !ca['key-usage'].split(',').includes('key-cert-sign')) return 'failure: CA certificate has no key-cert-sign key usage'
        c['.issuer'] = ca.name
      } else c['.issuer'] = c.name
      c['.signed'] = true; c['.key'] = true
      c['.ca'] = c['key-usage'] ? c['key-usage'].split(',').includes('key-cert-sign') : c['.issuer'] === c.name
      if (c['.issuer'] === c.name) c.trusted = 'yes'
      c['.fingerprint'] = Array.from({ length: 8 }, (_, i) => ((c['.id'] * 37 + i * 11) % 256).toString(16).padStart(2, '0')).join('')
      return '  progress: done'
    }
    if (cmd === 'import') {
      const fn = kv['file-name']
      if (!fn) return 'failure: file-name not specified'
      const f = st.files.find((x) => x.name === fn)
      if (!f) return 'failure: no such file'
      let certsN = 0, keys = 0
      if (f.cert) {
        if (find(fn + '_0')) return 'failure: certificate with the same name already exists'
        const it = { '.id': st.seq++, name: fn + '_0', 'common-name': f.cert.cn, 'subject-alt-name': f.cert.san || '', 'key-usage': f.cert.ku || '', trusted: f.cert.ca ? 'yes' : 'no', disabled: 'no', '.signed': true, '.ca': !!f.cert.ca, '.issuer': f.cert.ca ? fn + '_0' : 'external CA', '.keyId': f.cert.keyId, '.fingerprint': f.cert.fp || '9f3c51d2a07be844' }
        certs.push(it); certsN = 1
      }
      if (f.key) {
        const c = certs.find((x) => x['.keyId'] === f.key)
        if (c) { c['.key'] = true; keys = 1 }
      }
      return `     certificates-imported: ${certsN}\n     private-keys-imported: ${keys}\n            files-imported: 1\n       decryption-failures: 0\n  keys-with-no-certificate: ${f.key && !keys ? 1 : 0}`
    }
    if (cmd === 'export-certificate') {
      const c = find(pos[0] || kv.numbers)
      if (!c) return 'no such item'
      if (!c['.signed']) return 'failure: certificate is not signed'
      const type = kv.type || 'pem'
      if (type === 'pkcs12' && (kv['export-passphrase'] || '').length < 8) return 'failure: export-passphrase must be at least 8 characters for pkcs12'
      const files = type === 'pkcs12' ? [`cert_export_${c.name}.p12`] : [`cert_export_${c.name}.crt`, ...(kv['export-passphrase'] ? [`cert_export_${c.name}.key`] : [])]
      for (const n of files) if (!st.files.some((x) => x.name === n)) st.files.push({ name: n, type: '.' + n.split('.').pop() + ' file', of: c.name, passphrase: !!kv['export-passphrase'] })
      return ''
    }
    return ''
  }

  printCerts() {
    const st = this.st
    const list = st.lists.certificate
    st.lastPrint.certificate = list.map((x) => x['.id'])
    const out = ['Flags: K - PRIVATE-KEY; A - AUTHORITY; I - ISSUED, R - REVOKED; T - TRUSTED', 'Columns: NAME, COMMON-NAME, SUBJECT-ALT-NAME, ISSUER, FINGERPRINT', '#      NAME              COMMON-NAME        SUBJECT-ALT-NAME     ISSUER        FINGERPRINT']
    list.forEach((c, n) => {
      const f = (c['.key'] ? 'K' : ' ') + (c['.signed'] && c['.ca'] ? 'A' : ' ') + (c['.signed'] && c['.issuer'] !== c.name ? 'I' : ' ') + (c.trusted === 'yes' ? 'T' : ' ')
      out.push(pad(String(n), 2) + f + ' ' + pad(c.name, 18) + pad(c['common-name'] || '', 19) + pad(c['subject-alt-name'] || '', 21) + pad(c['.signed'] ? (c['.issuer'] === c.name ? 'self' : c['.issuer']) : '(unsigned)', 14) + (c['.fingerprint'] || ''))
    })
    return out.join('\n')
  }

  // ---------- printing ----------
  print(path, kv, pos) {
    const st = this.st
    const m = MENUS[path]
    if (m.kind === 'singleton') {
      const o = st.singletons[path]
      const w = Math.max(...m.fields.map((f) => f.length)) + 2
      const extra = path === 'ip dns' ? { 'dynamic-servers': dnsServers(st).filter((s) => !(o.servers || '').split(',').includes(s)).join(',') } : path === 'interface pptp-server server' ? {} : {}
      return Object.entries({ ...o, ...extra }).map(([k, v]) => ' '.repeat(Math.max(0, w - k.length)) + k + ': ' + v).join('\n')
    }
    if (path === 'ip route') return this.printRoutes(kv)
    if (['routing ospf neighbor', 'routing ospf interface', 'routing ospf lsa'].includes(path)) return st.net ? st.net.printOspf(st, path) : 'Flags: (OSPF needs neighbours: this router is not connected to other routers in this terminal)'
    if (path === 'interface') return this.printInterfaces()
    if (path === 'ip address') return this.printAddresses()
    if (path === 'certificate') return this.printCerts()
    if (path === 'ip firewall connection') return 'Flags: E - expected, S - seen-reply, A - assured, C - confirmed, D - dying, F - fasttrack, s - srcnat, d - dstnat\n #          PROTOCOL SRC-ADDRESS           DST-ADDRESS           TCP-STATE\n 0  SAC  s  tcp      192.168.33.2:51000   142.250.74.46:443     established\n 1  SAC     udp      192.168.33.2:53211   192.168.33.1:53'
    if (path === 'ip neighbor') return ' # INTERFACE   ADDRESS        MAC-ADDRESS        IDENTITY     PLATFORM\n 0 ether1      22.1.1.1       48:A9:8A:00:00:01  ISP-GW       MikroTik'
    if (path === 'ppp active') {
      return ' #   NAME      SERVICE  CALLER-ID          ADDRESS     UPTIME\n' + (st.lists['interface pppoe-server server'].some((s) => on(s)) && st.lists['ppp secret'].length ? ` 0   ${pad(st.lists['ppp secret'][0].name, 9)} pppoe    E4:5F:01:AA:BB:07  1.1.1.199   3m12s` : '')
    }
    let list = this.items(path)
    const ids = list.map((x) => x['.id'] ?? x.name)
    st.lastPrint[path] = ids
    let flags = 'Flags: X - disabled'
    const rows = list.map((it, n) => {
      let f = yes(it.disabled) ? 'X' : ' '
      if (path === 'interface bridge port') f += isRunning(st, it.interface) && !yes(it.disabled) ? ' ' : 'I'
      if (path === 'interface bridge port' && !yes(it.disabled) && it.interface.startsWith('ether')) it.hw = 'yes'
      if (it['.builtin'] || it.dynamic) f = f.trim() + '*'
      return { n, f, it }
    })
    if (path === 'interface bridge port') flags = 'Flags: X - disabled, I - inactive, H - hw-offload'
    if (path.startsWith('ip firewall')) {
      const out = ['Flags: X - disabled, I - invalid, D - dynamic']
      rows.forEach(({ n, f, it }) => {
        const c = it.comment ? `     ;;; ${it.comment}\n` : ''
        const ent = Object.entries(it).filter(([k]) => !k.startsWith('.') && !['disabled', 'comment', 'hw'].includes(k))
        ent.sort((a, b) => (a[0] === 'chain' ? -2 : a[0] === 'action' ? -1 : 0) - (b[0] === 'chain' ? -2 : b[0] === 'action' ? -1 : 0))
        const parts = ent.map(([k, v]) => `${k}=${v}`)
        out.push(c + pad(String(n), 3) + pad(f, 2) + parts.join(' '))
      })
      return out.join('\n')
    }
    if (path === 'interface pppoe-client') rows.forEach((r) => r.it.status = pppoeStatus(st, r.it))
    if (path === 'ip dhcp-client') rows.forEach((r) => { r.it.status = dhcpClientStatus(st, r.it); r.it.address = r.it.status === 'bound' ? WORLD.dhcpLease : '' })
    if (path === 'interface pptp-client' || path === 'interface l2tp-client') rows.forEach((r) => r.it.status = on(r.it) ? 'connecting...' : 'disabled')
    if (path === 'tool netwatch') rows.forEach((r) => r.it.status = routerInternet(st) || isLocal(st, r.it.host) ? 'up' : 'down')
    if (path === 'ip dhcp-server lease') {
      const L = laptopState(st)
      const extra = []
      if (L.mode === 'dhcp' && L.ip && !list.some((l) => l['mac-address'] && l['mac-address'].toUpperCase() === st.laptop.mac)) extra.push({ n: rows.length, f: 'D', it: { address: L.ip.split('/')[0], 'mac-address': st.laptop.mac, server: L.server, status: 'bound', 'host-name': 'laptop' } })
      rows.push(...extra)
      rows.forEach((r) => { if (!r.it.status) r.it.status = 'waiting' })
      flags = 'Flags: X - disabled, R - radius, D - dynamic, B - blocked'
    }
    const cols = m.cols
    const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r.it[c] ?? '').length)) + 1)
    const head = ' #   ' + cols.map((c, k) => pad(c.toUpperCase(), widths[k])).join('')
    const out = [flags, head]
    for (const { n, f, it } of rows) {
      if (it.comment && path !== 'user') out.push(`     ;;; ${it.comment}`)
      out.push(' ' + pad(String(n), 2) + pad(f, 2) + cols.map((c, k) => pad(c === 'password' ? '' : it[c], widths[k])).join(''))
    }
    return out.join('\n')
  }

  printInterfaces() {
    const st = this.st
    const list = allInterfaces(st)
    st.lastPrint.interface = list.map((x) => x.name)
    const out = ['Flags: D - dynamic, X - disabled, R - running, S - slave', ' #     NAME                TYPE       ACTUAL-MTU  MAC-ADDRESS']
    list.forEach((it, n) => {
      const f = (it.dynamic ? 'D' : ' ') + (yes(it.disabled) ? 'X' : ' ') + (isRunning(st, it.name) ? 'R' : ' ') + (bridgeOf(st, it.name) ? 'S' : ' ')
      if (it.comment) out.push(`      ;;; ${it.comment}`)
      out.push(' ' + pad(n, 2) + f + ' ' + pad(it.name, 20) + pad(it.type, 11) + pad(it.mtu, 12) + (it['mac-address'] || ''))
    })
    return out.join('\n')
  }

  printAddresses() {
    const st = this.st
    const all = []
    st.lists['ip address'].forEach((a) => all.push({ ...a, f: (yes(a.disabled) ? 'X' : ' ') + (bridgeOf(st, a.interface) ? 'I' : ' ') + ' ', id: a['.id'] }))
    addresses(st).filter((a) => a.dynamic).forEach((a) => all.push({ address: a.address, network: intToIp(a.c.net), interface: a.interface, f: ' D ', id: 'dyn' + a.interface }))
    st.lastPrint['ip address'] = all.map((a) => a.id)
    const out = ['Flags: X - disabled, I - invalid, D - dynamic', ' #   ADDRESS            NETWORK         INTERFACE']
    all.forEach((a, n) => {
      if (a.comment) out.push(`     ;;; ${a.comment}`)
      out.push(' ' + pad(n, 2) + a.f + pad(a.address, 19) + pad(a.network, 16) + a.interface)
    })
    return out.join('\n')
  }

  printRoutes(kv = {}) {
    const st = this.st
    let rs = routes(st)
    if (kv.where) {
      const m = String(kv.where).match(/routing-table=(\S+)/)
      if (m) rs = rs.filter((r) => (r.table || 'main') === m[1])
    }
    const anyTable = rs.some((r) => (r.table || 'main') !== 'main') || st.lists['ip route'].some((r) => (r['routing-table'] || r['routing-mark'] || 'main') !== 'main')
    const out = ['Flags: D - DYNAMIC; X - DISABLED, I - INACTIVE, A - ACTIVE; c - CONNECT, s - STATIC, d - DHCP, o - OSPF, v - VPN, b - BLACKHOLE; H - HW-OFFLOADED; + - ECMP',
      'Columns: DST-ADDRESS, GATEWAY, DISTANCE' + (anyTable ? ', ROUTING-TABLE' : ''),
      '#      DST-ADDRESS        GATEWAY                         DISTANCE' + (anyTable ? '  ROUTING-TABLE' : '')]
    const ids = []
    let n = 0
    const disabled = st.lists['ip route'].filter((r) => !on(r))
    for (const r of rs) {
      const proto = r.proto || (r.type === 'C' ? 'c' : 's')
      const f = (r.dynamic ? 'D' : '') + (r.selected ? 'A' : r.active ? '' : 'I') + proto + (r.ecmp && r.selected ? '+' : '')
      const gw = r.blackhole ? '' : r.gwText || r.gateway
      const idx = r.item ? String(n++) : ''
      if (r.item) ids.push(r.item['.id'])
      if (r.item && r.item.comment) out.push(`   ;;; ${r.item.comment}`)
      out.push(pad(idx, 2) + pad(f, 5) + pad(r.dst, 19) + pad(gw, 32) + pad(r.distance, 10) + (anyTable ? (r.table || 'main') : ''))
    }
    for (const r of disabled) { ids.push(r['.id']); out.push(pad(String(n++), 2) + pad('Xs', 5) + pad(r['dst-address'] || '0.0.0.0/0', 19) + pad(r.gateway || '', 32) + pad(r.distance || 1, 10) + (anyTable ? (r['routing-table'] || r['routing-mark'] || 'main') : '')) }
    st.lastPrint['ip route'] = ids
    return out.join('\n')
  }

  info(path) {
    const st = this.st
    if (path === 'system resource') return '                   uptime: 1h12m33s\n                  version: 7.16.2 (stable)\n               build-time: 2024-11-26 12:09:40\n              free-memory: 41.3MiB\n             total-memory: 64.0MiB\n                      cpu: MIPS 24Kc V7.4\n                cpu-count: 1\n            cpu-frequency: 650MHz\n                 cpu-load: 3%\n           free-hdd-space: 2264.0KiB\n          total-hdd-space: 16.0MiB\n              architecture-name: mipsbe\n               board-name: hAP lite\n                 platform: MikroTik'
    if (path === 'system routerboard') return '       routerboard: yes\n        board-name: hAP lite\n             model: RB941-2nD\n     serial-number: HCQ08XYZ123\n     firmware-type: qca9500L\n  factory-firmware: 3.41\n  current-firmware: 7.15.3\n  upgrade-firmware: 7.16.2'
    if (path === 'system package') return 'Columns: NAME, VERSION, BUILD-TIME, SIZE\n# NAME      VERSION  BUILD-TIME           SIZE\n0 routeros  7.16.2   2024-11-26 12:09:40  11.1MiB\n1 wireless  7.16.2   2024-11-26 12:09:40  1920.1KiB'
    if (path === 'system license') return '  software-id: 7XYZ-AB12\n       nlevel: 4\n     features:'
    return ''
  }

  // ---------- export ----------
  exportMenu(path, kv) {
    const st = this.st
    const m = MENUS[path]
    if (!m) return ''
    const hide = !yes(kv['show-sensitive'])
    const val = (k, v) => (hide && k.includes('password') || hide && k.includes('pre-shared-key') || hide && k === 'private-key' || hide && k === 'preshared-key') ? null : (/[\s;]/.test(v) || v === '' ? `"${v}"` : v)
    const fmt = (it, defs = {}) => Object.entries(it).filter(([k, v]) => !k.startsWith('.') && v !== '' && v !== undefined && defs[k] !== v && !(k === 'disabled' && v === 'no') && !['status', 'hw'].includes(k) && !(k === 'public-key' && path === 'interface wireguard') && !(k === 'network' && !(path === 'ip address' && /\/32$/.test(it.address || '') && it.network !== (it.address || '').split('/')[0])) && !(path === 'ip dhcp-client' && k === 'address')).map(([k, v]) => { const x = val(k, v); return x === null ? null : `${k}=${x}` }).filter(Boolean).join(' ')
    if (m.kind === 'singleton') {
      const diff = Object.fromEntries(Object.entries(st.singletons[path]).filter(([k, v]) => (m.defaults || {})[k] !== v))
      return Object.keys(diff).length ? `/${path}\nset ${fmt(diff)}` : ''
    }
    if (path === 'interface') {
      const lines = st.interfaces.filter((i) => i.comment || yes(i.disabled) && i.type !== 'wlan').map((i) => `set [ find default-name=${i.name} ]${i.comment ? ' comment=' + val('c', i.comment) : ''}${yes(i.disabled) ? ' disabled=yes' : ''}`)
      return lines.length ? '/interface ethernet\n' + lines.join('\n') : ''
    }
    if (path === 'interface wireless') {
      const w = st.wireless.wlan1
      const i = st.interfaces.find((x) => x.name === 'wlan1')
      return `/interface wireless\nset [ find default-name=wlan1 ] ${fmt({ ...w, disabled: i.disabled }, { 'radio-name': w['radio-name'], country: 'etsi', 'frequency-mode': 'regulatory-domain', 'wireless-protocol': 'any', 'hide-ssid': 'no', 'antenna-gain': '2', 'default-forward': 'yes', 'default-authenticate': 'yes', 'channel-width': '20mhz' })}`
    }
    if (path === 'ip service') {
      const lines = st.services.filter((s) => (s.name === 'www-ssl' ? s.disabled !== 'yes' : s.disabled === 'yes') || s.address || s.port !== { telnet: '23', ftp: '21', www: '80', ssh: '22', 'www-ssl': '443', api: '8728', winbox: '8291', 'api-ssl': '8729' }[s.name]).map((s) => `set ${s.name}${s.disabled !== (s.name === 'www-ssl' ? 'yes' : 'no') ? ' disabled=' + s.disabled : ''}${s.address ? ' address=' + s.address : ''}${s.port !== { telnet: '23', ftp: '21', www: '80', ssh: '22', 'www-ssl': '443', api: '8728', winbox: '8291', 'api-ssl': '8729' }[s.name] ? ' port=' + s.port : ''}`)
      return lines.length ? '/ip service\n' + lines.join('\n') : ''
    }
    if (m.kind !== 'list' || path === 'certificate') return ''
    const items = st.lists[path].filter((x) => !x['.builtin'] && !(path === 'user'))
    if (!items.length) return ''
    return `/${path}\n` + items.map((it) => 'add ' + fmt(it, m.defaults || {})).join('\n')
  }

  exportAll(kv) {
    const order = ['interface bridge', 'interface wireless', 'interface', 'interface eoip', 'interface gre', 'interface ipip', 'interface wireguard', 'interface vlan', 'interface pppoe-client', 'interface pptp-client', 'interface l2tp-client', 'interface list', 'interface wireless security-profiles', 'interface wireless access-list', 'interface wireless connect-list', 'ip pool', 'ip dhcp-server', 'interface pppoe-server server', 'ppp profile', 'queue type', 'queue simple', 'interface bridge port', 'ip neighbor discovery-settings', 'interface list member', 'interface pptp-server server', 'interface l2tp-server server', 'interface sstp-server server', 'ip ipsec mode-config', 'ip ipsec policy group', 'ip ipsec profile', 'ip ipsec peer', 'ip ipsec proposal', 'ip address', 'ip cloud', 'ip dhcp-client', 'ip dhcp-server lease', 'ip dhcp-server option', 'ip dhcp-server option sets', 'ip dhcp-server network', 'ip dhcp-relay', 'ip dns', 'ip dhcp-server alert', 'ip dns static', 'ip proxy', 'ip proxy access', 'ip proxy cache', 'ip proxy direct', 'queue tree', 'ip arp', 'ip firewall address-list', 'ip firewall filter', 'ip firewall mangle', 'ip firewall nat', 'ip firewall raw', 'ip firewall connection tracking', 'ip ipsec identity', 'ip ipsec policy', 'routing table', 'interface wireguard peers', 'ip route', 'routing filter rule', 'routing ospf instance', 'routing ospf area', 'routing ospf area range', 'routing ospf interface-template', 'routing ospf static-neighbor', 'routing rule', 'ip service', 'ip settings', 'ip ssh', 'ppp secret', 'snmp', 'snmp community', 'system clock', 'system identity', 'system note', 'system ntp client', 'system ntp server', 'system logging', 'system scheduler', 'system script', 'tool mac-server', 'tool mac-server mac-winbox', 'tool bandwidth-server', 'tool netwatch', 'tool graphing interface', 'tool e-mail']
    const parts = order.map((p) => this.exportMenu(p, kv)).filter(Boolean)
    return `# 2026-10-14 12:00:00 by RouterOS 7.16.2\n# software id = 7XYZ-AB12\n#\n# model = RB941-2nD\n# serial number = HCQ08XYZ123\n` + parts.join('\n')
  }

  // ---------- tools ----------
  ping(target, count, kv) {
    const st = this.st
    if (!target) return 'failure: address not specified'
    if (st.net) return st.net.ping(st, target, Math.min(Math.max(count || 4, 1), 10), kv)
    count = Math.min(Math.max(count || 4, 1), 10)
    const ip = routerResolve(st, target)
    if (!ip) return `failure: could not resolve name ${target} (check /ip dns servers and the default route)`
    const lines = ['  SEQ HOST                                     SIZE TTL TIME       STATUS']
    let ok = false, reason = 'timeout'
    const rt = lookup(st, ip)
    if (routerIps(st).includes(ip) || ip.startsWith('127.')) ok = true
    else if (!rt) reason = 'no route to host'
    else if (rt.type === 'C') {
      const L = laptopState(st)
      if (L.ip && L.ip.split('/')[0] === ip && L.l3 === rt.iface) {
        ok = true
      } else if (ip === WORLD.ispGw && rt.iface === 'ether1') ok = true
      else if (ip === WORLD.pppoeRemote && rt.iface.startsWith('pppoe')) ok = true
    } else {
      ok = routerInternetVia(st, rt)
      if (ok) {
        const v = evalChain(st, 'filter', 'output', { src: '', dst: ip, protocol: 'icmp', outIf: rt.iface, state: 'new' })
        if (v.verdict !== 'accept') { ok = false; reason = 'timeout' }
      }
    }
    if (ok && rt && rt.type !== 'C' && !routerIps(st).includes(ip)) {
      const v = evalChain(st, 'filter', 'output', { src: '', dst: ip, protocol: 'icmp', outIf: rt.iface, state: 'new' })
      if (v.verdict !== 'accept') ok = false
    }
    const base = rt && rt.type === 'C' ? 0.4 : 12 + (ipToInt(ip) % 30)
    let rec = 0, sum = 0
    for (let n = 0; n < count; n++) {
      if (ok) {
        const t = (base + Math.random() * 2).toFixed(3)
        sum += Number(t); rec++
        lines.push(`    ${n} ${pad(ip, 40)} 56  ${pad(rt && rt.type === 'C' ? 64 : 117, 3)} ${pad(t.replace('.', 'ms') + 'us', 10)}`)
      } else lines.push(`    ${n} ${pad(ip, 40)}                     ${reason}`)
    }
    lines.push(`    sent=${count} received=${rec} packet-loss=${Math.round((1 - rec / count) * 100)}%` + (rec ? ` avg-rtt=${(sum / rec).toFixed(1)}ms` : ''))
    return lines.join('\n')
  }

  traceroute(target, kv = {}) {
    const st = this.st
    if (!target) return 'failure: address not specified'
    if (st.net) return st.net.traceroute(st, target, kv)
    const ip = routerResolve(st, target)
    if (!ip) return `failure: could not resolve name ${target}`
    const rt = lookup(st, ip)
    const out = ['Columns: ADDRESS, LOSS, SENT, LAST, AVG, BEST, WORST']
    if (!rt) return out.concat(['#  ADDRESS  LOSS  SENT', '1           100%  3   timeout (no route)']).join('\n')
    if (rt.type === 'C') return out.concat([`#  ADDRESS        LOSS  SENT  LAST`, `1  ${pad(ip, 15)}0%    3     0.5ms`]).join('\n')
    if (!routerInternetVia(st, rt)) return out.concat(['#  ADDRESS  LOSS  SENT', '1           100%  3   timeout']).join('\n')
    const hops = [rt.iface.startsWith('pppoe') ? WORLD.pppoeRemote : WORLD.ispGw, '81.198.3.1', '62.85.19.142', '195.122.0.81', ip]
    return out.concat(['#  ADDRESS          LOSS  SENT  LAST    AVG     BEST    WORST'], hops.map((h, n) => `${n + 1}  ${pad(h, 17)}0%    3     ${pad((n * 3 + 1.2).toFixed(1) + 'ms', 8)}${pad((n * 3 + 1.4).toFixed(1), 8)}${pad((n * 3 + 1).toFixed(1), 8)}${(n * 3 + 2).toFixed(1)}`)).join('\n')
  }

  scan(iface) {
    const st = this.st
    if (!st.wireless[iface || 'wlan1']) return 'failure: no such interface'
    if (yes(st.interfaces.find((x) => x.name === 'wlan1').disabled)) return 'failure: interface is disabled (enable it first)'
    return 'Flags: A - active, P - privacy, R - routeros-network\nColumns: ADDRESS, SSID, CHANNEL, SIG, NF, SNR, RADIO-NAME\n   ADDRESS            SSID           CHANNEL               SIG  NF   SNR  RADIO-NAME\nAPR 4C:5E:0C:11:22:33  QTraining      2412/20-Ce/gn(20dBm) -52  -110 58   Classroom-AP\nAP  64:D1:54:A1:B2:C3  QTraining33XXL 2437/20/gn(20dBm)    -61  -108 47   Room33\nAP  E8:48:B8:01:02:03  Neighbor-5G    2462/20/gn(20dBm)    -78  -104 26\n-- scan stops the wireless connection while it runs (use background-scan where possible)'
  }

  toolSim(cmd, pos, kv) {
    if (cmd === 'torch') {
      const ifc = pos[0] || kv.interface || 'ether1'
      return ` interface: ${ifc}\n  SRC-ADDRESS       DST-ADDRESS        TX        RX       TX-PACKETS  RX-PACKETS\n  192.168.33.2      142.250.74.46      312.4kbps 8.9Mbps  402         781\n  192.168.33.2      159.148.147.196    12.1kbps  44.3kbps 21          19\n                                       324.5kbps 8.94Mbps 423         800\n(simulated snapshot, press Ctrl+C in real RouterOS to stop)`
    }
    if (cmd === 'profile') return 'NAME            CPU  USAGE\nethernet        0    1.5%\nnetworking      0    2%\nwinbox          0    0.5%\nmanagement      0    1%\nidle            0    95%\ntotal           0    5%'
    if (cmd === 'bandwidth-test') return `                status: running\n              duration: 10s\n            tx-current: 94.3Mbps\n  tx-10-second-average: 93.9Mbps\n                random-data: no\n             direction: ${kv.direction || 'receive'}\n              protocol: ${kv.protocol || 'udp'}`
    if (cmd === 'sniffer') return 'use: /tool sniffer quick  (simulated)\n INTERFACE  TIME   NUM  DIR  SRC-MAC            DST-MAC            SRC-ADDRESS     DST-ADDRESS\n ether2     1.21   1    <-   E4:5F:01:AA:BB:02  48:A9:8A:4C:2E:11  192.168.33.2    8.8.8.8'
    return ''
  }

  // ---------- completion ----------
  complete(line) {
    const tokens = tokenize(line)
    const endsSpace = /\s$/.test(line)
    const last = endsSpace ? '' : (tokens.pop() || '')
    let path = this.cwd
    let i = 0
    if (tokens[0] && tokens[0].startsWith('/')) { path = ''; tokens[0] = tokens[0].slice(1); if (!tokens[0]) i = 1 }
    let cmd = null
    for (; i < tokens.length; i++) {
      const t = tokens[i]
      if (t === '..') { path = path.split(' ').slice(0, -1).join(' '); continue }
      const cand = path ? path + ' ' + t : t
      if (MENUS[cand] !== undefined || PATHS.some((p) => p.startsWith(cand + ' '))) { path = cand; continue }
      cmd = t; break
    }
    let options
    let lastStem = last.replace(/^\//, '')
    if (!cmd) {
      options = [...childMenus(path), ...commandsFor(path), ...(path === '' ? GLOBAL_CMDS : [])]
    } else if (lastStem.includes('=')) {
      const [k, v] = lastStem.split('=')
      const vals = this.valuesFor(path, k)
      options = vals.map((x) => k + '=' + x)
    } else {
      const m = MENUS[path]
      options = (m && m.fields ? m.fields : []).map((f) => f + '=')
      if (cmd === 'set' || cmd === 'remove' || cmd === 'enable' || cmd === 'disable') options.push(...this.items(path).map((x) => x.name).filter(Boolean))
      if (cmd === 'ping') options.push('count=', ...Object.keys(WORLD.names))
    }
    const matches = [...new Set(options)].filter((o) => o.startsWith(lastStem)).sort()
    if (!matches.length) return { line, list: [] }
    let common = matches[0]
    for (const mm of matches) while (!mm.startsWith(common)) common = common.slice(0, -1)
    const prefix = line.slice(0, line.length - last.length) + (last.startsWith('/') ? '/' : '')
    let newLine = prefix + common
    if (matches.length === 1 && !common.endsWith('=')) newLine += ' '
    return { line: newLine, list: matches.length > 1 ? matches : [] }
  }

  valuesFor(path, k) {
    const st = this.st
    if (['interface', 'in-interface', 'out-interface', 'master-interface'].includes(k)) return allInterfaces(st).map((i) => i.name)
    if (k === 'bridge') return st.lists['interface bridge'].map((b) => b.name)
    if (k.endsWith('interface-list') || (k === 'list' && path === 'interface list member')) return st.lists['interface list'].map((l) => l.name)
    if (k === 'chain' && path === 'routing filter rule') return [...new Set(st.lists['routing filter rule'].map((x) => x.chain))]
    if (k === 'chain') return path === 'ip firewall nat' ? ['srcnat', 'dstnat'] : path === 'ip firewall mangle' ? ['prerouting', 'input', 'forward', 'output', 'postrouting'] : path === 'ip firewall raw' ? ['prerouting', 'output'] : CHAINS_FILTER
    if (k === 'action' && path === 'routing rule') return ['lookup', 'lookup-only-in-table', 'drop', 'unreachable']
    if (k === 'action') return path === 'ip firewall nat' ? ACT_NAT : path === 'ip firewall mangle' ? ACT_MANGLE : path === 'ip firewall raw' ? ACT_RAW : path === 'ip ipsec policy' ? ['encrypt', 'none', 'discard'] : ACT_FILTER
    if (k === 'protocol') return ['tcp', 'udp', 'icmp', 'gre', 'ipsec-esp', 'ipsec-ah']
    if (k === 'certificate' || k === 'remote-certificate' || k === 'ca') return st.lists.certificate.map((c) => c.name)
    if (k === 'key-usage') return KEY_USAGE
    if (k === 'use-ipsec') return ['no', 'yes', 'required']
    if (k === 'tls-version') return ['any', 'only-1.2', 'only-1.3']
    if (k === 'forwarding-enabled') return ['no', 'local', 'remote', 'both']
    if (k === 'rp-filter') return ['no', 'strict', 'loose']
    if (k === 'exchange-mode') return ['ike2', 'main', 'aggressive']
    if (k === 'auth-method') return ['pre-shared-key', 'digital-signature', 'eap', 'eap-radius']
    if (k === 'generate-policy') return ['no', 'port-override', 'port-strict']
    if (k === 'peer') return st.lists['ip ipsec peer'].map((x) => x.name)
    if (k === 'mode-config') return st.lists['ip ipsec mode-config'].map((x) => x.name)
    if (k === 'policy-template-group' || (k === 'group' && path === 'ip ipsec policy')) return st.lists['ip ipsec policy group'].map((x) => x.name)
    if (k === 'proposal') return st.lists['ip ipsec proposal'].map((x) => x.name)
    if (k === 'type' && path === 'certificate') return ['pem', 'pkcs12']
    if (k === 'file-name') return st.files.map((f) => f.name)
    if (k === 'connection-state') return ['new', 'established', 'related', 'invalid', 'established,related']
    if (k === 'mode') return path.includes('security') ? ['none', 'dynamic-keys', 'static-keys-required'] : ['station', 'station-bridge', 'ap-bridge', 'bridge']
    if (k === 'group') return st.lists['user group'].map((g) => g.name)
    if (k === 'address-pool') return st.lists['ip pool'].map((p) => p.name)
    if (k === 'profile' && path === 'ip ipsec peer') return st.lists['ip ipsec profile'].map((x) => x.name)
    if (k === 'profile' || k === 'default-profile') return st.lists['ppp profile'].map((p) => p.name)
    if (k === 'security-profile') return st.lists['interface wireless security-profiles'].map((p) => p.name)
    if (k === 'kind') return ['pcq', 'pfifo', 'bfifo', 'sfq', 'red']
    if (k === 'routing-table' || (k === 'table' && path === 'routing rule')) return st.lists['routing table'].map((x) => x.name)
    if (k === 'instance') return st.lists['routing ospf instance'].map((x) => x.name)
    if (k === 'area') return st.lists['routing ospf area'].map((x) => x.name)
    if (k === 'interfaces') return allInterfaces(st).map((i) => i.name)
    if (k === 'type' && path === 'routing ospf area') return ['default', 'stub', 'nssa']
    if (k === 'type' && path === 'routing ospf interface-template') return ['broadcast', 'ptp', 'nbma', 'ptmp']
    if (k === 'type' && path === 'ip route') return ['unicast', 'blackhole', 'prohibit', 'unreachable']
    if (k === 'redistribute') return ['connected', 'static', 'connected,static', 'dhcp', 'vpn']
    if (k === 'originate-default') return ['never', 'if-installed', 'always']
    if (k === 'check-gateway') return ['ping', 'arp', 'bfd', 'none']
    if (k === 'action' && path === 'routing rule') return ['lookup', 'lookup-only-in-table', 'drop', 'unreachable']
    if (k === 'interface' && path === 'interface wireguard peers') return st.lists['interface wireguard'].map((x) => x.name)
    if (k === 'chain' && path === 'routing filter rule') return [...new Set(st.lists['routing filter rule'].map((x) => x.chain))]
    if (k === 'pcq-classifier') return ['dst-address', 'src-address', 'dst-port', 'src-port']
    if (k === 'band') return ['2ghz-b/g/n', '2ghz-onlyn', '2ghz-g/n', '5ghz-a/n/ac', '5ghz-onlyac']
    if (k === 'service') return ['any', 'pppoe', 'pptp', 'l2tp', 'sstp', 'ovpn']
    if (k === 'authentication-types') return ['wpa2-psk', 'wpa-psk', 'wpa2-eap']
    if (k === 'unicast-ciphers' || k === 'group-ciphers') return ['aes-ccm', 'tkip']
    return BOOL
  }
}

const HELP = `RouterOS simulator: supported menus
  /interface  /interface bridge [port]  /interface vlan  /interface list [member]
  /interface wireless [security-profiles access-list connect-list]
  /interface pppoe-client  /interface pppoe-server server  /interface pptp-server server  /interface pptp-client
  /ip address  /ip route  /ip dhcp-client  /ip dhcp-server [network lease]  /ip pool
  /ip dns [static]  /ip arp  /ip firewall filter|nat|mangle|raw|address-list  /ip service  /ip ssh  /ip settings  /ip cloud
  /certificate (add, sign, import, export-certificate)  /interface l2tp-server server  /interface sstp-server server
  /ip ipsec profile|proposal|policy [group]|peer|identity|mode-config|active-peers|installed-sa  /ip dhcp-server alert
  /routing table  /routing rule  /routing filter rule  /routing ospf instance|area|area range|interface-template|neighbor|interface|lsa
  /interface gre|ipip|eoip|wireguard [peers]  /ip route (distance, check-gateway, scope, target-scope, routing-table, blackhole)
  /queue simple  /queue type  /ppp profile  /ppp secret  /user
  /system identity|note|clock|ntp client|resource|routerboard|package|backup|reboot|reset-configuration
  /tool netwatch|mac-server|bandwidth-server|torch|profile  /snmp
Commands: print add set remove enable disable export   Global: /ping /traceroute /export
Keys: Tab completes, double Tab lists, Up/Down history, Ctrl+L clears, ".." up, "/" root`
