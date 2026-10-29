# Lesson: OSPF in RouterOS 7: instance, area, template

RouterOS 7 rebuilt OSPF around three objects.

1. **Instance**: one OSPF process with its router ID and global settings (redistribution, default route, filters).
2. **Area**: belongs to an instance; has an area ID and a type.
3. **Interface template**: says which interfaces (or which networks) take part in OSPF, in which area, and with which settings (type, cost, priority, passive, timers).

The minimum configuration for one router in the backbone:

    /routing ospf instance add name=default-v2 router-id=10.255.255.1
    /routing ospf area add name=backbone-v2 area-id=0.0.0.0 instance=default-v2
    /routing ospf interface-template add area=backbone-v2 interfaces=ether1,ether2 type=ptp
    /routing ospf interface-template add area=backbone-v2 interfaces=ether5,lo passive

## Interface templates

A template matches interfaces in one of two ways:

- `interfaces=ether1,ether2` (or an interface list): those interfaces;
- `networks=10.0.0.0/16`: every interface that has an address inside this prefix.

Templates are checked **in order**, and an interface uses the first template that matches it. To give one interface a special cost, add a more specific template **above** the general one (`place-before=0`). The interfaces that OSPF actually runs on, with the settings they got, appear in `/routing ospf interface print`; that list is dynamic and read-only.

## Router ID

Set it explicitly. If you leave `router-id` at its default (`main`), RouterOS picks an address of the router (preferring loopbacks), and the ID can change when addresses change, which restarts OSPF. A good habit: a /32 address on a loopback interface for every router, and use it as router ID.

    /interface bridge add name=lo           (RouterOS 6 style loopback)
    /ip address add address=10.255.255.1/32 interface=lo

RouterOS 7 has a built-in `lo` interface you can put the address on.

## RouterOS 6 versus 7

| | RouterOS 6 | RouterOS 7 |
|---|---|---|
| process | `/routing ospf instance` (default exists) | `/routing ospf instance add` |
| areas | `/routing ospf area` (backbone exists) | `/routing ospf area add` (nothing exists) |
| enable on interfaces | `/routing ospf network add network=10.0.12.0/30 area=backbone` | `/routing ospf interface-template add networks=… area=…` |
| per-interface settings | `/routing ospf interface add interface=ether1 network-type=point-to-point cost=10` | in the template: `type=ptp cost=10` |
| redistribution | `redistribute-connected=as-type-1` | `redistribute=connected` + routing filter for the type |
| default route | `distribute-default=if-installed-as-type-2` | `originate-default=if-installed` |
| stub without summaries | `inject-summary-lsas=no` | `no-summaries` |
| filters | `/routing filter` chains ospf-in / ospf-out with matchers | `/routing filter rule` with a small script language |
| neighbours | `/routing ospf neighbor print` | `/routing ospf neighbor print` |

The course slides are written for RouterOS 6; the labs here use RouterOS 7.

# Lesson: Checking OSPF

    /routing ospf neighbor print
    /routing ospf interface print
    /routing ospf lsa print
    /ip route print

- **neighbor**: every neighbour with its router ID, address, state and (on broadcast networks) whether it is DR or BDR. You want `Full` (or `2-Way` between DROthers).
- **interface**: the interfaces OSPF runs on, with their type, cost, state (DR, BDR, DROther, ptp, passive) and priority.
- **lsa**: the link-state database: type, originator, ID, sequence number, age.
- **routes**: OSPF routes have the flag **o** and distance 110.

## When neighbours do not come up

1. Do the two routers ping each other on that link? OSPF needs IP connectivity first.
2. Same area on both ends? Same subnet?
3. Same hello and dead intervals, authentication?
4. Area type the same on both ends (stub, NSSA)?
5. Is one side passive? A passive interface sends no hellos at all.
6. Stuck in ExStart or Exchange: compare the MTU on both interfaces.
7. Firewall: OSPF is IP protocol 89 to 224.0.0.5 and 224.0.0.6. A strict input chain must accept it (`protocol=ospf`).
8. Two routers with the same router ID: OSPF logs a duplicate router ID.

RouterOS writes OSPF problems to the log (`/log print where topics~"ospf"`).

![What neighbor print should show on a broadcast segment: Full with the DR and BDR, 2-Way with the other DROthers (course slide)](/img/mtcre/re-ospf-dr.webp)

# Lesson: Cost, passive interfaces, network types

## Passive interfaces

A LAN with only PCs on it must be advertised, but OSPF should not talk there: hellos to a user network are useless and a security risk (anyone could start an OSPF router and inject routes). Make the interface **passive**: its network is advertised, but no hellos are sent and no neighbours are accepted.

    /routing ospf interface-template add area=backbone-v2 interfaces=ether5,lo passive

Loopback addresses are advertised the same way.

## Cost

    /routing ospf interface-template add area=backbone-v2 interfaces=ether2 type=ptp cost=100 place-before=0

Remember that the cost is set on the **outgoing** interface and is added up along the path. To make R1 avoid its direct link to R3, raise R1's cost on that interface; the reverse direction (R3 to R1) only changes if R3's cost changes too. Different costs in the two directions lead to asymmetric paths, which work but are confusing to troubleshoot. With equal total costs OSPF installs ECMP routes.

## Network type

    /routing ospf interface-template add area=backbone-v2 interfaces=ether1 type=ptp

On a link with exactly two routers, `type=ptp` skips the DR election and the 40-second wait, so the adjacency comes up faster and recovers faster. Leave `broadcast` on segments with more routers, and set **priority** there if a specific router should be DR (a strong central router, not a small CPE). `priority=0` keeps a router out of the election.

| type | DR | use |
|---|---|---|
| broadcast | yes | Ethernet with several routers |
| ptp | no | router-to-router cable, tunnels |
| ptmp | no | hub and spokes over one medium (wireless) |
| nbma | yes | no multicast: add `/routing ospf static-neighbor` |

## Timers and BFD

hello-interval 10 s and dead-interval 40 s are the defaults; both sides must match. For faster failure detection than 40 seconds use **BFD** (`use-bfd=yes` on the template and a BFD configuration), which can notice a dead link in well under a second.

# Lesson: Multiple areas, stub areas and summaries

The ABR has interfaces in area 0 and in another area. Create both areas on it and put each interface in the right one:

    /routing ospf area add name=area1 area-id=0.0.0.1 instance=default-v2
    /routing ospf interface-template add area=backbone-v2 interfaces=ether1 type=ptp
    /routing ospf interface-template add area=area1 interfaces=ether2 type=ptp

Routers inside area 1 only need area 1:

    /routing ospf area add name=area1 area-id=0.0.0.1 instance=default-v2
    /routing ospf interface-template add area=area1 interfaces=ether2 type=ptp
    /routing ospf interface-template add area=area1 interfaces=ether4,ether5,lo passive

The area's **name** is local to each router; the **area-id** is what must match.

## Stub and totally stubby

    /routing ospf area set area1 type=stub                  (on every router in area 1)
    /routing ospf area set area1 no-summaries=yes           (on the ABR: totally stubby)

In a stub area the ABR automatically injects a default route; you do not configure `originate-default` for it. `no-summaries` only matters on the ABR, because only the ABR generates the summaries. For NSSA use `type=nssa`; a default route into an NSSA is not automatic.

## Area ranges (summarisation)

Without summarisation the ABR sends one type 3 LSA per network into the backbone. If area 1 uses 10.1.0.0/16 for all its networks, one range replaces them:

    /routing ospf area range add area=area1 prefix=10.1.0.0/16 advertise=yes

- Ranges are configured on the ABR, for the area the networks are in.
- `advertise=no` suppresses the networks completely (a way to hide an area's networks).
- Summarisation also stabilises the network: a link flapping inside area 1 no longer changes anything outside it.
- Plan your addressing so that areas can be summarised: a contiguous block per area.

![Without ranges every network of area 1 is advertised; with a range the backbone sees one summary (course slide)](/img/mtcre/re-ospf-range.webp)

The **multi-area** lab builds exactly this: an ABR, a stub, then totally stubby area, and a range.

# Lesson: Default route, redistribution and routing filters

## Originating a default route

The router with the Internet connection tells everyone else about it:

    /routing ospf instance set default-v2 originate-default=if-installed

| originate-default | Meaning |
|---|---|
| never | default; no default route is advertised |
| if-installed | advertise a default route only while this router has an active default route of its own |
| always | always advertise one, even without an uplink |

`if-installed` is the safe choice: if the edge router loses its ISP, its own default route disappears, it stops advertising one, and the other routers can use another exit. With `always`, the routers keep sending traffic to an edge router that has nowhere to send it.

## Redistribution

Routes that are not OSPF (connected networks without OSPF on them, static routes, BGP) can be injected as externals. The router becomes an ASBR.

    /routing ospf instance set default-v2 redistribute=static
    /routing ospf instance set default-v2 redistribute=connected,static

Redistributed routes are external type 2 with metric 20 unless a filter changes them.

## External type 1 and type 2

- **type 2** (default): every router sees the same cost, the external metric. With two ASBRs advertising the same route with the same metric, the one closer inside OSPF wins only as a tie breaker.
- **type 1**: the cost is the external metric plus the internal OSPF cost to the ASBR. Each router picks the exit that is really closest to it.

![Type 1: the total cost includes the path to each ASBR, so every router uses its nearest exit (course slide)](/img/mtcre/re-ospf-type1.webp)

![Type 2: only the external metric counts, so all routers use the exit with the lower metric (course slide)](/img/mtcre/re-ospf-type2.webp)

Use type 1 when you have several exits and want each router to use the nearest one; type 2 when one exit should be preferred by everyone.

## Routing filters (RouterOS 7)

RouterOS 7 routing filters are small programs in `/routing filter rule`. Rules with the same `chain` run in order; the first `accept` or `reject` ends the chain. **A chain that ends without a decision rejects the route**, so finish with an explicit `accept` when you only want to change some routes.

    /routing filter rule add chain=ospf-out rule="if (dst in 172.20.0.0/16) { set ospf-ext-type type1; accept }"
    /routing filter rule add chain=ospf-out rule="accept"
    /routing ospf instance set default-v2 out-filter-chain=ospf-out

- **out-filter-chain**: applied to routes this router redistributes (externals).
- **in-filter-chain**: applied to OSPF routes before they are installed in the routing table. It does not change the LSDB, only what this router installs.

Useful pieces of the syntax:

| Matcher / action | Example |
|---|---|
| exact prefix | `dst == 192.168.2.0/24` |
| inside a prefix | `dst in 192.168.0.0/16` |
| prefix length | `dst-len > 24`, `dst-len in 16-32` |
| protocol | `protocol static` |
| decisions | `accept`, `reject`, `jump other-chain`, `return` |
| changes | `set ospf-ext-type type1`, `set ospf-ext-metric 50`, `set distance 120` |

    rule="if (dst in 192.168.0.0/16 && dst-len in 16-32) { reject } else { accept }"

> **RouterOS 6:** `/routing filter add chain=ospf-in prefix=192.168.0.0/16 prefix-length=16-32 action=discard`. Matchers were fields, and there was no script syntax.

![RouterOS 6 routing filters in Winbox: drop exactly 192.168.0.0/16, or everything inside it with a length of 16 to 32 (course slide)](/img/mtcre/re-ospf-filter-v6.webp)

## Redistribution pitfalls

- Redistributing **connected** on an edge router also advertises the ISP's link network, and on a router with tunnels the tunnels' public networks; then other routers may route tunnel traffic into OSPF and break the tunnels. Filter with an out chain that only accepts what you mean.
- Redistributing a **default route** as static plus `originate-default` gives two sources; use `originate-default` only.
- Two routers redistributing each other's routes between two protocols can create loops; filter in both directions.

The **redistribution** lab puts all of this together: a default route with `if-installed`, a redistributed static branch route, and a filter that turns it into type 1.

## Recommendations from the course

- Use authentication keys on OSPF interfaces in shared segments.
- Choose the DR yourself with priorities.
- Use the correct network type (ptp on router-to-router links).
- Use area types and summarisation to keep the LSDB small.
- Keep user LANs passive.
