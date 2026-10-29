// MTCRE course structure and question banks (filled in below).
import { T } from '../i18n.js'
const Q = (rows) => rows.map(([qe, qr, oe, or, a, ee, er]) => ({ q: T(qe, qr), o: T(oe, or), a, e: T(ee, er) }))
const stub = [['Q?', 'В?', ['a', 'b'], ['a', 'b'], 0, 'e', 'e']]
export const RE_MODULES = [
  { id: 're-basics', num: 1, file: 'mtcre/01-basics.md', icon: '🧭', title: 'Routing fundamentals', summary: 's', source: 'slides + docs', labs: ['re-static'], sims: ['route-select'], quiz: Q(stub) },
  { id: 're-static', num: 2, file: 'mtcre/02-static.md', icon: '🛣️', title: 'Static routing in depth', summary: 's', source: 'slides + docs', labs: ['re-failover', 're-recursive'], sims: ['recursive'], quiz: Q(stub) },
  { id: 're-pbr', num: 3, file: 'mtcre/03-pbr.md', icon: '🔀', title: 'Policy routing', summary: 's', source: 'slides + docs', labs: ['re-pbr'], sims: ['pbr-walk'], quiz: Q(stub) },
  { id: 're-tunnels', num: 4, file: 'mtcre/04-tunnels.md', icon: '🚇', title: 'Tunnels', summary: 's', source: 'slides + docs', labs: ['re-vlan', 're-gre', 're-eoip', 're-wg'], sims: ['tunnel-mtu'], quiz: Q(stub) },
  { id: 're-ospf', num: 5, file: 'mtcre/05-ospf.md', icon: '🌐', title: 'OSPF', summary: 's', source: 'slides + docs', labs: [], sims: ['spf', 'dr-election', 'area-types'], quiz: Q(stub) },
  { id: 're-ospf-cfg', num: 6, file: 'mtcre/06-ospf-config.md', icon: '⚙️', title: 'OSPF config', summary: 's', source: 'slides + docs', labs: ['re-ospf-single', 're-ospf-areas', 're-ospf-redist'], sims: [], quiz: Q(stub) },
]
export const RE_EXAM = { questions: 25, minutes: 60, pass: 60 }
