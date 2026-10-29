# Lesson: What a router does with a packet

A router has one job: for every IP packet that arrives, decide where it goes next. It does not care which application sent the packet, and it does not know the whole path to the destination. It only knows the **next hop**: the neighbour router (or the final host) that is one step closer.

To make that decision quickly, RouterOS keeps two different tables.

- The **RIB** (Routing Information Base) holds every route the router knows about, from every source: connected networks, static routes you typed, routes learned from OSPF or BGP, routes added by DHCP or PPP. Several routes to the same destination can sit in the RIB at the same time.
- The **FIB** (Forwarding Information Base) holds only the routes that are actually used. For each destination the RIB picks the best candidate, and that one is copied to the FIB. Packets are forwarded by looking them up in the FIB.

![The RIB collects routes from every source; the best active ones go to the FIB, which forwards packets](/img/mtcre/rib-fib.svg)

This split is why `/ip route print` can show a route that exists but is not used: it is in the RIB, but another route won, or its gateway is unreachable, so it never reached the FIB.

## Where routes come from

| Source | Example | Default distance |
|---|---|---|
| connected | an address on an interface creates a route to its subnet | 0 |
| static | `/ip route add dst-address=10.1.0.0/16 gateway=10.0.12.2` | 1 |
| eBGP | routes from another autonomous system | 20 |
| OSPF | learned from OSPF neighbours | 110 |
| RIP | learned from RIP neighbours | 120 |
| iBGP | routes from BGP peers inside your own AS | 200 |

DHCP client and PPP add dynamic routes too (a default route from the DHCP server, a /32 route to the PPP peer). **Distance** is how much RouterOS trusts a source: lower is better. It only matters when two routes have exactly the same destination prefix.

## Reading /ip route print in RouterOS 7

    [admin@R1] > /ip route print
    Flags: D - DYNAMIC; X - DISABLED, I - INACTIVE, A - ACTIVE; c - CONNECT, s - STATIC, o - OSPF; + - ECMP
    Columns: DST-ADDRESS, GATEWAY, DISTANCE
    #      DST-ADDRESS        GATEWAY        DISTANCE
      DAc  10.0.12.0/30       ether1         0
    0 As   192.168.3.0/24     10.0.13.2      1
    1  s   192.168.3.0/24     10.0.12.2      2
      DAo  192.168.2.0/24     10.0.12.2      110

- **D** dynamic (created by the router itself), **A** active (in the FIB), **X** disabled, **I** inactive.
- The lowercase letter is the source: **c** connected, **s** static, **o** OSPF, **b** blackhole, **d** DHCP, **v** VPN.
- **+** marks ECMP routes (several gateways used together).
- Route 1 above is a static backup: it exists but is not active, because route 0 has a lower distance.

> **RouterOS 6:** the flags were uppercase and in a different order (`DAC`, `AS`, `ADo`), and routes with a routing mark showed a ROUTING-MARK column. The meaning is the same.

## The packet's path through the router

Routing is one step of the packet flow you know from MTCNA. For a packet passing through the router:

1. it arrives on an interface; **prerouting** (RAW, connection tracking, mangle, dst-nat) runs first;
2. the **routing decision** looks up the destination, possibly in a table chosen by policy routing;
3. **forward** (mangle, filter), then **postrouting** (mangle, src-nat) and out of the chosen interface.

So dst-nat happens before routing (the router routes the translated address), while src-nat happens after it. Policy routing (module 3) works by changing which table the routing decision looks in.

## TTL

Each router decreases the packet's **TTL** (time to live) by one. When it reaches zero, the router drops the packet and sends back an ICMP *time exceeded* message. This protects the network from routing loops: a packet that circles between two routers dies after at most 255 hops. Traceroute uses exactly this: it sends packets with TTL 1, 2, 3… and lists who answers with *time exceeded*. RouterOS starts its own packets with TTL 64, and mangle can change the TTL (`action=change-ttl`).

# Lesson: Choosing a route: prefix, distance, ECMP

When a packet arrives, the router compares its destination address with every active route. The rules are always applied in this order.

1. **Longest prefix match.** Among the routes whose network contains the destination, the most specific one wins: a /24 beats a /16, which beats a /8, which beats the default route /0. Distance does not matter here at all.
2. **Lowest distance.** Only when two routes have the same prefix and length does the distance decide. The lower distance wins; the other route stays in the RIB as a backup.
3. **ECMP.** If one route has several gateways, or several routes with the same prefix have the same distance, they are used together: *Equal Cost Multi-Path*.

![RouterOS picks the longest matching prefix first, then the lowest distance, then shares traffic between equal routes](/img/mtcre/route-selection.svg)

Try it in the **Route selection** simulator: change the table and the destination and follow each step.

## Examples

With this table on R1:

    0.0.0.0/0       gateway=172.16.1.1   distance=1
    10.0.0.0/8      gateway=10.0.12.2    distance=1
    10.1.0.0/16     gateway=10.0.13.2    distance=110   (OSPF)
    10.1.0.0/16     gateway=10.0.12.2    distance=1     (static)
    10.1.1.0/24     gateway=10.0.13.2,10.0.12.2

- To 10.1.1.20: the /24 matches and is the longest, so ECMP through both gateways.
- To 10.1.9.9: two /16 routes match. The static one has distance 1 and wins over OSPF (110).
- To 10.200.0.1: only 10.0.0.0/8 and the default route match; /8 wins.
- To 8.8.8.8: only the default route matches.

## Distance values

Distance can be set from 1 to 255 on a static route (connected routes always have 0). A route with **distance 255** is never used: the course slides use this to keep a route in the configuration without it ever becoming active. Usually you just disable such a route.

## ECMP

An ECMP route has several gateways: `gateway=10.0.13.2,10.0.12.2`. The router spreads traffic over them. In RouterOS 7 the choice is made per flow with a hash of the addresses (optionally ports), so the packets of one connection stay on one path and arrive in order. That is good for TCP, but it also means one big download never uses both links at once.

    /ip route add dst-address=192.168.2.0/24 gateway=10.0.12.2,10.0.13.2

> **RouterOS 6:** ECMP also worked per connection. The course slides compare the methods: ECMP and PCC balance per connection, Nth and bonding (balance-rr) per packet.

In RouterOS 6 a common trick was to write a gateway twice (`gateway=10.0.12.2,10.0.12.2,10.0.13.2`) to send it about twice as much traffic. Check on your RouterOS 7 version whether duplicates are kept before relying on it; separate routes with equal distance are the clean way to build ECMP in v7.

## Active, inactive, unreachable

A static route is only active when its gateway can be reached through a connected route (or, for recursive routes, through another route, see module 2). If you add a route with a gateway that is not in any of your subnets, RouterOS accepts it but marks it inactive (*unreachable*). This is the first thing to check when a new route "does nothing".

# Lesson: Gateways and next hops

The gateway of a route tells the router where to send the packet next. RouterOS accepts three forms.

| gateway= | Meaning | Typical use |
|---|---|---|
| an IP address (`10.0.12.2`) | send to this neighbour; RouterOS finds the interface from the connected route that contains it | Ethernet links, most routes |
| an interface (`ether1`, `gre-br`) | send out of this interface | point-to-point links: PPP, GRE, IPIP, WireGuard |
| address%interface (`10.0.12.2%ether1`) | this neighbour, on exactly this interface | the same neighbour address on several interfaces, link-local addresses |

On Ethernet, sending to a next-hop address means: find the interface, resolve the neighbour's MAC address with ARP, and put the original IP packet in a frame addressed to that MAC. The IP header still carries the final destination; only the layer 2 address points to the next hop.

An interface as gateway only makes sense where there is exactly one possible receiver: a PPP, GRE, IPIP or WireGuard tunnel. On an Ethernet segment with an interface gateway, the router would have to ARP for every destination address, and it only works if the neighbour answers proxy ARP.

## Immediate and recursive gateways

A gateway that lies inside a connected network is **immediately reachable**. A gateway that is not directly connected, for example 8.8.8.8, can still be used: RouterOS looks up a route to 8.8.8.8 and uses that route's next hop. This is **recursive next-hop resolution**, and module 2 shows how to use it for failover. In `/ip route print detail` RouterOS 7 shows the result as `immediate-gw`.

## pref-src

A route can carry `pref-src`, the source address the router uses for packets it sends itself through this route (ping, DNS, tunnels). It does not change forwarded traffic.

## Both directions

The most common routing mistake in labs is forgetting the way back. If R1 has a route to LAN3 but R3 has no route to LAN1, the ping request arrives at the PC in LAN3, and the reply dies on R3. A ping from PC1 to PC3 needs:

- on R1: a route to 192.168.3.0/24;
- on R3: a route to 192.168.1.0/24;
- on every router in between: routes in both directions.

Traceroute shows where the forward path stops. The lab simulator also tells you when the reply is the part that fails.

# Lesson: Testing routing: ping, traceroute and the labs

Everything in this course is checked with two tools. Learn their options well; they are also your main tools on a real network.

## ping

    /ping 192.168.3.10 count=3
    /ping 192.168.3.10 src-address=192.168.1.1
    /ping 172.16.2.1 interface=ether2
    /ping 8.8.8.8 routing-table=isp2

- Without `src-address`, the router uses the address of the outgoing interface. That address may not be routed back, so a ping from the router can fail while the PCs work. Ping with `src-address` set to the LAN address to test the path that LAN traffic takes.
- `routing-table=` tests a policy routing table directly.

## traceroute

    /tool traceroute 192.168.3.10
    /tool traceroute 93.184.216.34 src-address=192.168.1.1

Each line is one hop. If the list stops, look at the last router that answered: it either has no route onward, or the next router cannot send its answer back (check that router's routes to your source address).

## How the MTCRE labs work

Every lab is a small network of simulated RouterOS 7 routers:

- one **terminal per router** (tabs above the terminal, or click a router in the picture);
- routers marked *preconfigured* (ISPs, the Internet core) are part of the scenario; you may look but should not need to change them;
- PCs are simple hosts with an address and a default gateway;
- the **Reachability** panel pings between hosts after every command and shows the path or the reason it fails;
- in some labs the **Links** panel lets you cut a cable or make it fail *silently*: the ports stay up but nothing passes, as when a switch between two routers loses power on one side. Only check-gateway, tunnel keepalive or a routing protocol notice such a failure.

The checker follows real packets hop by hop, including the reply, through the routes, routing rules, mangle marks, NAT and reverse-path filters you configured. Some tasks briefly break a link to see whether your failover works.

## A troubleshooting order that works

1. Is the interface running? `/interface print`
2. Is the address and subnet right on both ends? `/ip address print`
3. Can you ping the directly connected neighbour?
4. Is there an active route to the destination? `/ip route print` (look for **A**)
5. Does the next router have a route onward, and every router a route back?
6. Is something filtering? Firewall, rp-filter, NAT.

Start the first lab, **Static routes in a triangle**, and build full reachability with static routes only.
