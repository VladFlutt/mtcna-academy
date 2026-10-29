# Lesson: Static routes, summaries and blackholes

A static route is a line you add by hand: *to reach this network, send packets to that gateway*.

    /ip route add dst-address=192.168.3.0/24 gateway=10.0.13.2
    /ip route add dst-address=0.0.0.0/0 gateway=172.16.1.1
    /ip route add gateway=172.16.1.1          (dst-address defaults to 0.0.0.0/0)

Static routing is simple, predictable and costs no CPU or bandwidth. Its weakness: nothing changes by itself. If a link fails, the route stays until you (or check-gateway, below) do something.

## Default route, summary, host route

- **Default route** `0.0.0.0/0`: everything not covered by a more specific route. Typical for a branch that has one way out.
- **Summary route**: one route that covers several networks, for example `192.168.0.0/22` for 192.168.0.0/24 to 192.168.3.0/24. Fewer routes, but only if the networks really sit behind the same gateway and are numbered so that they can be summarised.
- **Host route** `/32`: exactly one address. Used for loopbacks, PPP peers and, in recursive routing, to pin a monitoring host to one ISP.

Because of longest-prefix match, a more specific route always beats a summary. You can send 192.168.0.0/16 one way and still send 192.168.5.0/24 another way.

## Blackhole, unreachable, prohibit

A route can also discard traffic on purpose.

    /ip route add dst-address=10.0.0.0/8 blackhole

| Type | What happens to the packet |
|---|---|
| blackhole | silently dropped |
| unreachable | dropped, the sender gets ICMP *host unreachable* |
| prohibit | dropped, the sender gets ICMP *administratively prohibited* |

Why drop on purpose? A router that owns a summary (say 10.0.0.0/8 for all your sites) should not send traffic for unused parts of it to its default route, where it would loop between you and the ISP until the TTL runs out. A blackhole for the summary, plus more specific routes for the networks that exist, stops that loop. A blackhole is also a cheap way to drop traffic to a bad network.

> **RouterOS 6:** `type=blackhole|unreachable|prohibit` on the route. RouterOS 7 uses `blackhole` as a flag in `/ip route`; check `/ip route add ?` on your version for the other types.

## Lab 1: the triangle

In the first lab three routers each have a LAN. With only static routes, each router needs a route to the two foreign LANs: six routes in total. Add the R1–R2 link failure and it is clear why static routing becomes painful as networks grow: every alternative path is something you have to configure and maintain by hand.

# Lesson: Failover with distance and check-gateway

With two paths to the same network, give the preferred one the lower distance:

    /ip route add dst-address=192.168.3.0/24 gateway=10.0.13.2 distance=1
    /ip route add dst-address=192.168.3.0/24 gateway=10.0.12.2 distance=2

Only the distance=1 route is active. If **interface ether2 goes down** (cable unplugged), the connected route 10.0.13.0/30 disappears, gateway 10.0.13.2 becomes unreachable, the first route becomes inactive and the distance=2 route takes over. No extra configuration is needed.

## When the link stays up

In most real networks the failure you care about does not take your port down: there is a switch, a media converter or a radio link in between, or the neighbour router crashed with its port still lit. Your interface stays *running*, the connected route stays, and the router keeps sending traffic into a dead link.

**check-gateway** fixes this:

    /ip route add dst-address=192.168.3.0/24 gateway=10.0.13.2 check-gateway=ping

- `ping`: the router sends ICMP echo requests to the gateway; `arp`: it sends ARP requests (works even if the neighbour blocks ICMP, but only on Ethernet-like links).
- The course slides describe the timing: a check every 10 seconds, a check times out after 10 seconds, and after two timeouts in a row the gateway is considered unreachable; one successful answer makes it reachable again. So a failover takes roughly 20 to 30 seconds.
- When the gateway fails the check, every route using that gateway becomes inactive and the backup route takes over.

Put check-gateway on the primary route. On the backup route it is optional; it helps when the backup can fail silently too.

## Symmetry

Failover must work in both directions. In the lab, R1 has a primary and a backup route to LAN3, and R3 needs the same for LAN1, otherwise the replies keep going into the dead link. The course slides call this the clockwise and anticlockwise routes: if R1 sends clockwise but R3 still answers anticlockwise through the dead link, nothing works.

Try it in the **Failover** lab: set the R1–R3 link to *silent failure* and look at `/ip route print` on R1 before and after you add check-gateway.

> **RouterOS 6:** the same options: `check-gateway=ping|arp`, `distance=`.

## Netwatch as an alternative

`/tool netwatch` pings any host and runs a script on up and down. It can enable and disable routes, which gives full control, but scripts are harder to maintain. Recursive routes (next lesson) solve the most common case without scripts.

# Lesson: ECMP and load sharing

Equal Cost Multi-Path uses several next hops for one destination at the same time.

    /ip route add dst-address=0.0.0.0/0 gateway=172.16.1.1,172.16.2.1

or, in RouterOS 7, two routes with the same prefix and the same distance:

    /ip route add dst-address=0.0.0.0/0 gateway=172.16.1.1 distance=1
    /ip route add dst-address=0.0.0.0/0 gateway=172.16.2.1 distance=1

In `/ip route print` both are active and carry the **+** flag.

## How traffic is shared

RouterOS 7 chooses the next hop per flow with a hash of the packet's addresses (and optionally the ports; look for the multipath hash policy in `/ip settings` on your version). All packets of one connection take the same path, so TCP sees no reordering. The cost: sharing is statistical, not exact. A single large flow uses only one link.

| Method | Per connection | Per packet |
|---|---|---|
| ECMP | yes | no |
| PCC (mangle, per-connection-classifier) | yes | no |
| Nth (mangle) | yes | yes |
| Bonding balance-rr | no | yes |
| OSPF (equal cost paths) | yes | no |

## ECMP and NAT, two ISPs

ECMP across two ISPs with masquerade works only if the replies come back the same way and every connection keeps its path. Because the hash is per flow, a connection stays on one ISP. But some services (online banking, games) dislike users whose different connections come from two public addresses. For dual-ISP sharing with full control, the course uses policy routing with mangle (module 3).

## ECMP with check-gateway

With `check-gateway=ping` on an ECMP route, a failed gateway is removed from the set and the remaining ones carry all traffic.

# Lesson: Recursive routes, scope and target-scope

A gateway does not have to be directly connected. RouterOS can resolve it through another route: this is **recursive next-hop resolution**.

    /ip route add dst-address=8.8.8.8/32 gateway=172.16.1.1 scope=10
    /ip route add dst-address=0.0.0.0/0 gateway=8.8.8.8 target-scope=11 check-gateway=ping

The default route's gateway is 8.8.8.8, a host on the Internet. RouterOS finds the route to 8.8.8.8 (the /32 through 172.16.1.1) and forwards default traffic to 172.16.1.1. Nothing changes for the packets; the difference is what check-gateway now tests.

## Why it matters: checking the real Internet

With `gateway=172.16.1.1 check-gateway=ping`, the router only learns that the ISP's router answers. If the ISP loses its own uplink, 172.16.1.1 still answers and your default route stays active while nothing works.

With the recursive route, check-gateway pings **8.8.8.8 through ISP1** (the /32 route pins it there). When the Internet behind ISP1 fails, 8.8.8.8 stops answering, the default route becomes inactive, and a backup default route takes over:

    /ip route add dst-address=1.1.1.1/32 gateway=172.16.2.1 scope=10
    /ip route add dst-address=0.0.0.0/0 gateway=1.1.1.1 target-scope=11 check-gateway=ping distance=2

![Each ISP gets its own monitoring host, pinned with a /32 route; the default routes use those hosts as gateways](/img/mtcre/recursive.svg)

Two details to remember:

- Traffic to the monitoring host itself always goes through its ISP because of the /32 route. Pick hosts your users do not depend on, and use a different one per ISP.
- If the monitoring host goes down (it happens), you fail over for no reason. Large networks check two hosts per ISP.

## scope and target-scope

Which routes may be used to resolve a gateway? RouterOS uses two numbers.

- **scope** of a route: how "far" it is. Connected routes have scope 10, static routes 30 by default.
- **target-scope** of a route: the highest scope a route may have to be used to resolve *this* route's gateway. Default 10 for static routes.

A gateway is resolved through a route whose scope is less than or equal to the target-scope.

![Default scope and target-scope values per route type, as shown in the course slides](/img/mtcre/scope.svg)

With the defaults, a static route (target-scope 10) can only use connected routes (scope 10) to reach its gateway: that is normal, non-recursive routing. For recursion, give the route to the monitoring host `scope=10` and the default route `target-scope=11` (or higher, as long as it is ≥ the other route's scope). With the default scope of 30 on the /32 route, the default route would stay unreachable.

Try different values in the **Recursive next hop** simulator, then do the lab.

## Things that break recursion

- Recursion only works in the **main** routing table (RouterOS 6 says so explicitly; in RouterOS 7 keep monitoring routes in main as well).
- A route cannot resolve through itself. If 8.8.8.8 could also be reached through the default route, the router would happily use the default route to resolve its own gateway; the /32 prevents this.
- In RouterOS 7 `/ip route print detail` shows `immediate-gw` (the real next hop) for every route; use it to check what a recursive route resolved to.

> **RouterOS 6:** identical syntax. RouterOS 6 printed `gateway-status=8.8.8.8 recursive via 172.16.1.1 ether1` in `print detail`.
