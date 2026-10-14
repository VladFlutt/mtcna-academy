// IPv4 helpers shared by the simulators.

export function ipToInt(ip) {
  const p = String(ip).trim().split('.')
  if (p.length !== 4) return null
  let n = 0
  for (const x of p) {
    if (!/^\d{1,3}$/.test(x)) return null
    const v = Number(x)
    if (v > 255) return null
    n = n * 256 + v
  }
  return n >>> 0
}

export function intToIp(n) {
  n = n >>> 0
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
}

export function maskOf(prefix) {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
}

// "192.168.1.5/24" -> { ip, prefix, net, bcast }
export function parseCidr(s, defPrefix = 32) {
  if (!s) return null
  const [a, b] = String(s).split('/')
  const ip = ipToInt(a)
  if (ip === null) return null
  const prefix = b === undefined ? defPrefix : Number(b)
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null
  const m = maskOf(prefix)
  const net = (ip & m) >>> 0
  const bcast = (net | (~m >>> 0)) >>> 0
  return { ip, prefix, net, bcast, mask: m }
}

export function inSubnet(ip, cidr) {
  const c = typeof cidr === 'string' ? parseCidr(cidr) : cidr
  const i = typeof ip === 'number' ? ip : ipToInt(ip)
  if (!c || i === null) return false
  return ((i & c.mask) >>> 0) === c.net
}

// Matches RouterOS address matcher syntax: IP, subnet or range a-b.
export function matchAddr(spec, ip) {
  if (!spec) return true
  const i = typeof ip === 'number' ? ip : ipToInt(ip)
  if (i === null) return false
  if (spec.includes('-')) {
    const [a, b] = spec.split('-').map(ipToInt)
    return a !== null && b !== null && i >= a && i <= b
  }
  return inSubnet(i, spec.includes('/') ? spec : spec + '/32')
}

export function subnetInfo(s) {
  const c = parseCidr(s, 24)
  if (!c) return null
  const size = 2 ** (32 - c.prefix)
  const hosts = c.prefix >= 31 ? (c.prefix === 32 ? 1 : 2) : size - 2
  const first = c.prefix >= 31 ? c.net : c.net + 1
  const last = c.prefix >= 31 ? c.bcast : c.bcast - 1
  return {
    address: intToIp(c.ip), prefix: c.prefix, mask: intToIp(c.mask),
    wildcard: intToIp(~c.mask >>> 0), network: intToIp(c.net), broadcast: intToIp(c.bcast),
    first: intToIp(first), last: intToIp(last), hosts, size,
    private: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'].some((n) => inSubnet(c.ip, n)),
  }
}

// RouterOS rate strings: 512k, 2M, 1G, 1000
export function parseRate(s) {
  if (s === undefined || s === null || s === '') return 0
  const m = String(s).trim().match(/^(\d+(?:\.\d+)?)([kKmMgG]?)$/)
  if (!m) return NaN
  const mult = { '': 1, k: 1e3, m: 1e6, g: 1e9 }[m[2].toLowerCase()]
  return Number(m[1]) * mult
}

export function fmtRate(bps) {
  if (bps >= 1e9) return +(bps / 1e9).toFixed(2) + 'G'
  if (bps >= 1e6) return +(bps / 1e6).toFixed(2) + 'M'
  if (bps >= 1e3) return +(bps / 1e3).toFixed(1) + 'k'
  return Math.round(bps) + ''
}
