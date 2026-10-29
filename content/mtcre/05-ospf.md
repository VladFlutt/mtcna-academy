# Lesson: Dynamic routing and OSPF

Static routing needs a person for every change. With three routers in a triangle you already need six routes, plus backups and check-gateway for failover. With twenty routers it is unmanageable.

A **dynamic routing protocol** lets routers tell each other what they can reach and recalculate the routes when something changes. The gains: fault tolerance without scripts, load sharing over equal paths, and a network that grows without editing every router.

## IGP and EGP

- **Interior gateway protocols** (IGP) route inside one organisation's network, an *autonomous system* (AS): RIP, OSPF, IS-IS, EIGRP.
- **Exterior gateway protocols** (EGP) route between autonomous systems: BGP, the protocol of the Internet.

## Distance vector and link state

- **Distance vector** (RIP): each router tells its neighbours "I can reach X at distance N". Nobody sees the whole network. Simple, but slow to converge, limited to 15 hops, and it counts hops, not bandwidth.
- **Link state** (OSPF, IS-IS): each router describes its own links, and that description is flooded to every router in the area. Every router has the same map (the *link-state database*) and calculates the shortest paths itself with Dijkstra's algorithm. Fast convergence, no hop limit, paths chosen by cost.

## OSPF in short

**Open Shortest Path First** is an open standard link-state IGP.

- OSPFv2 (RFC 2328) routes IPv4; OSPFv3 (RFC 5340) routes IPv6 (RouterOS 7 can also run v3 for IPv4).
- OSPF packets are carried directly in IP, **protocol 89** (no TCP or UDP).
- Neighbours are found with multicast **hello** packets to **224.0.0.5** (all OSPF routers). On broadcast networks, updates to the designated routers go to **224.0.0.6**.
- Updates are sent when something changes, not periodically (except a refresh every 30 minutes).
- Every router has a 32-bit **router ID** written like an IP address. It must be unique.
- Large networks are split into **areas** (lesson 4).
- Distance in RouterOS: 110.

# Lesson: Neighbours and adjacencies

Before routers exchange routes, they must become neighbours. Every OSPF interface sends a hello every **hello-interval** (10 s by default). If no hello arrives from a neighbour for the **dead-interval** (40 s, four hellos), the neighbour is declared dead.

Two routers become neighbours only if these match:

- the **area ID** of the interfaces;
- the **subnet and mask** of the interfaces (on broadcast and NBMA networks);
- **hello and dead intervals**;
- **authentication** type and key;
- the **area type flags** (stub, NSSA) in the hello;
- for a full adjacency also the interface **MTU** (checked during the database exchange).

And the router IDs must differ.

## Neighbour states

![The states a neighbour goes through until the link-state databases are synchronised](/img/mtcre/ospf-states.svg)

| State | Meaning |
|---|---|
| Down | no hello received (recently) |
| Attempt | NBMA only: the router is trying to contact a configured neighbour |
| Init | a hello was received, but our router ID is not in it yet (one-way) |
| 2-Way | both see each other in the hellos. On broadcast networks the DR/BDR election happens here |
| ExStart | the two decide who is master for the database exchange |
| Exchange | they send each other database descriptions (DD): a list of the LSAs they have |
| Loading | each requests the LSAs it is missing |
| Full | databases are identical: the adjacency is complete |

Useful symptoms: **stuck in Init** means hellos go only one way (filtering, wrong multicast); **stuck in ExStart or Exchange** usually means an MTU mismatch.

## Network types

OSPF behaves differently depending on the type of link.

| Type | Example | DR/BDR | Neighbours found by |
|---|---|---|---|
| broadcast | Ethernet with several routers | yes | multicast hellos |
| point-to-point (ptp) | two routers on a cable, PPP, GRE | no | multicast hellos |
| point-to-multipoint (ptmp) | hub and spokes over a shared medium | no | multicast hellos |
| NBMA | a medium without multicast | yes | manually configured neighbours |

Ethernet defaults to broadcast. If only two routers share an Ethernet link, set the interface type to **ptp**: no DR election and faster convergence. The course slides recommend this for every router-to-router cable.

## DR and BDR

On a broadcast segment with n routers, a full mesh would mean n(n−1)/2 adjacencies, each exchanging the same LSAs. Instead the routers elect a **designated router** (DR) and a **backup designated router** (BDR). Every router forms a full adjacency only with the DR and BDR; the other routers (**DROther**) stay in 2-Way with each other.

![Six routers on one segment: everyone is Full with the DR and BDR, DROthers stay 2-Way with each other](/img/mtcre/ospf-dr.svg)

- Routers send their updates to 224.0.0.6 (DR and BDR); the DR floods them to everyone on 224.0.0.5.
- The DR also originates the **network LSA** (type 2) for the segment.
- If the DR fails, the BDR takes over immediately and a new BDR is elected.

**Election:** the highest interface **priority** wins (0 to 255; the default is 128 in RouterOS 7 and 1 in RouterOS 6); with equal priority the highest **router ID** wins. Priority 0 means the router never becomes DR or BDR.

The election is **not preemptive**. A router that joins later with a higher priority does not take over; it waits until the DR fails. In practice the first routers to come up become DR and BDR. To control the result, set priorities and restart OSPF on the segment. Count the adjacencies yourself in the **DR/BDR election** simulator.

# Lesson: LSAs and the shortest path

A **link-state advertisement** (LSA) is a piece of the network map. Each router keeps all LSAs of its area in the **link-state database** (LSDB). Routers in the same area have identical LSDBs.

| Type | Name | Originated by | Describes | Flooded |
|---|---|---|---|---|
| 1 | Router | every router | its links in the area and their costs | inside the area |
| 2 | Network | the DR | the routers on a broadcast segment | inside the area |
| 3 | Summary | ABR | networks of other areas | into an area |
| 4 | ASBR summary | ABR | how to reach an ASBR in another area | into an area |
| 5 | External | ASBR | routes redistributed from outside OSPF | whole AS (not stub areas) |
| 7 | NSSA external | ASBR in an NSSA | external routes inside an NSSA | inside the NSSA; the ABR translates them to type 5 |

Types 6 and 8 to 11 exist (multicast, attributes, opaque) but are not part of this course.

Each LSA has a sequence number and an age. A newer sequence number replaces the old copy; an LSA is refreshed every 30 minutes and expires at 60 minutes (MaxAge).

## Cost

Each OSPF interface has a **cost**. The cost of a path is the sum of the outgoing interface costs along it, and the lowest total wins. The standard formula is *reference bandwidth / interface bandwidth* (100 Mbit/s reference gives a 10 Mbit/s link cost 10). RouterOS does not calculate cost from the link speed: every interface gets the same default cost (1 in RouterOS 7, 10 in RouterOS 6), and you set costs yourself where you want to steer traffic.

## SPF

Every router runs Dijkstra's **shortest path first** algorithm on the LSDB with itself as the root:

1. the root is in the tree with cost 0;
2. look at the neighbours of the router just added and note the total cost to each (keep the lower if one is already noted);
3. move the candidate with the lowest total cost into the tree;
4. repeat until every router is in the tree.

The result is a tree of shortest paths from this router to every destination. Two paths with the same total cost are both kept: OSPF does ECMP.

![Paths with their total cost: R1 reaches 192.168.2.0/24 with cost 40 instead of 70 through the cost-50 link (course slide)](/img/mtcre/re-ospf-cost.webp)

Run the **OSPF SPF stepper**: change costs, step through the algorithm, and watch the tree move.

# Lesson: Areas and router roles

In one big area every router stores every LSA, and every link change triggers SPF on every router. The course slides put the comfortable size of a single area at less than about 80 routers. **Areas** split the network: details stay inside an area, other areas see only summaries.

- Areas have a 32-bit ID, written as an address: 0.0.0.0, 0.0.0.1…
- **Area 0** (0.0.0.0) is the **backbone**. Every other area must be connected to it, directly or through a *virtual link*. Traffic between two non-backbone areas always crosses the backbone.

![Backbone, areas and router roles (course slide)](/img/mtcre/re-ospf-areas-cloud.webp)

## Router roles

| Role | Definition |
|---|---|
| Internal router (IR) | all interfaces in one area |
| Backbone router | at least one interface in area 0 |
| ABR (area border router) | interfaces in two or more areas, one of them area 0; summarises (LSA 3) |
| ASBR (AS boundary router) | redistributes routes from outside OSPF (static, connected, BGP) as LSA 5 or 7 |

## Route types

OSPF prefers routes in this order, regardless of cost:

1. **intra-area** (from LSA 1 and 2);
2. **inter-area** (LSA 3);
3. **external type 1** (E1): cost = external metric + internal cost to the ASBR;
4. **external type 2** (E2): cost = external metric only; the internal cost is just a tie breaker.

E2 is the default for redistributed routes. Module 6 shows when E1 is the better choice.

## Area types

| Area type | LSA 3 | LSA 4/5 | LSA 7 | Default route |
|---|---|---|---|---|
| backbone, normal | yes | yes | no | only if someone originates one |
| stub | yes | no | no | ABR injects 0.0.0.0/0 (LSA 3) |
| totally stubby | only the default | no | no | ABR injects 0.0.0.0/0 |
| NSSA | yes | no | yes | not automatic |
| totally NSSA | only the default | no | yes | ABR injects 0.0.0.0/0 |

- A **stub** area cannot contain an ASBR. Its routers do not need the external routes because every exit goes through the ABR anyway: a default route is enough.
- A **totally stubby** area also drops the inter-area summaries. Its routers know their own area plus a default route.
- An **NSSA** (not-so-stubby area) is a stub area that may contain an ASBR. Its external routes travel as LSA 7 and the ABR translates them to LSA 5 for the rest of the network.

![A stub area: the routers in area 1 lose the external routes and get a default route from the ABR instead (course slide, RouterOS 6 syntax)](/img/mtcre/re-ospf-stub.webp)

![Totally stubby: inter-area routes are replaced by the default route too (course slide)](/img/mtcre/re-ospf-totally-stubby.webp)

All routers in an area must agree on its type: the stub flag is carried in the hellos, and a mismatch prevents the neighbourship. Compare the types in the **OSPF area types and LSAs** simulator.

![Areas, ABRs and ASBRs, and which LSAs enter which area type](/img/mtcre/ospf-areas.svg)
