# Lesson: What QoS can and cannot do

**Quality of service** shares a limited link between traffic that needs different treatment: voice needs low delay, a web page needs quick answers, a backup only needs to finish eventually. QoS on a router can:

- **limit** the rate of a user, a service or a direction;
- **guarantee** a minimum rate to important traffic;
- **prioritise**: give spare bandwidth to important traffic first;
- **share fairly** between users.

It cannot create bandwidth, and it only controls what **leaves** the router. Downloads are shaped on the way out to the LAN, after they have crossed the Internet link; TCP senders then slow down because acknowledgements arrive more slowly.

## Shaper and scheduler

- A **shaper** with no queue drops every packet above the rate: no extra delay, but many drops.
- A **scheduler** with an unlimited queue never drops: packets wait, and delay grows without limit.

Real queues are in between: a limited queue absorbs bursts (some delay) and drops when it is full. A big queue under load gives large delays (**bufferbloat**); a small one keeps delay low but drops more.

## CIR and MIR

| Term | RouterOS | Meaning |
|---|---|---|
| CIR, committed information rate | **limit-at** | the guaranteed rate, given in any case |
| MIR, maximum information rate | **max-limit** | the most the queue may get if its parent has bandwidth left |

All RouterOS queues (simple queues and queue trees) are implemented with **HTB**, the hierarchical token bucket, which works with these two rates.

# Lesson: Queue types

The **queue type** decides how packets wait inside one queue: which one leaves next and which one is dropped.

| Kind | Behaviour |
|---|---|
| **pfifo / bfifo** | first in, first out; the queue size is counted in packets (pfifo-limit, 50 by default) or bytes (bfifo-limit) |
| **mq-pfifo** | pfifo with several hardware queues, for multi-queue interfaces |
| **RED** | random early detection: when the average queue length passes **min-threshold**, packets are dropped at random with growing probability, and above **max-threshold** all are dropped. TCP senders slow down early instead of all at once |
| **SFQ** | stochastic fairness queuing: flows are hashed into 1024 sub-queues and served round robin, `sfq-allot` (1514) bytes at a time; the hash changes every `sfq-perturb` (5) seconds. Fair between flows, not between users |
| **PCQ** | per connection queue: sub-streams by a classifier (src or dst address, src or dst port), each with `pcq-rate`; fair between users |
| **fq-codel, codel, cake** | RouterOS 7: active queue management that keeps delay low under load. CAKE also shapes, shares fairly per host and per flow, and handles overhead for DSL or DOCSIS links |

Interfaces have a default queue type (`/queue interface`): usually `only-hardware-queue` or `multi-queue-ethernet-default` on Ethernet, and the default for wireless. Child queues in a tree use `default-small` (pfifo 10) unless you set another `queue=`.

RouterOS 7 detail: the options of CAKE and fq_codel (target, interval, bandwidth, overhead) vary between versions; check `/queue type print detail` on your device before copying values from older guides.

# Lesson: PCQ and burst

## PCQ

One PCQ queue replaces hundreds of per-user queues:

    /queue type add name=pcq-down kind=pcq pcq-classifier=dst-address pcq-rate=0
    /queue type add name=pcq-up kind=pcq pcq-classifier=src-address pcq-rate=0
    /queue simple add name=lan target=192.168.33.0/24 max-limit=10M/10M queue=pcq-up/pcq-down

- **Classifier**: download is addressed to the user, so `dst-address`; upload comes from the user, so `src-address`.
- **pcq-rate = 0**: no cap per sub-stream; the queue's max-limit is shared **equally** between the active users.
- **pcq-rate > 0**: each sub-stream gets **min(pcq-rate, max-limit / users)**.
- `pcq-limit` (50 packets per sub-stream) and `pcq-total-limit` (2000) cap memory; `pcq-dst-address-mask` groups users (for example /24 per customer).

| max-limit 512k | pcq-rate 0 | pcq-rate 128k |
|---|---|---|
| 1 user | 512k | 128k |
| 2 users | 256k each | 128k each (256k unused) |
| 4 users | 128k each | 128k each |
| 7 users | ~73k each | ~73k each |

Inactive users get nothing and take nothing: the share grows as soon as someone stops. Check the numbers in the **PCQ** simulator.

## Burst

Burst lets a queue run above max-limit for a short time, so that short downloads (web pages) are fast while long ones are limited.

| Parameter | Meaning |
|---|---|
| burst-limit | the rate allowed during a burst (higher than max-limit) |
| burst-threshold | the burst is allowed while the **average** rate is below this (lower than max-limit) |
| burst-time | the period over which the average is calculated (in 16 steps) |

Example from the slides: max-limit 256k, burst-limit 512k, burst-threshold 192k, burst-time 8 s. From idle the user gets 512k. The average over the last 8 seconds grows by 64k each second: 64, 128, 192. At 3 seconds it reaches the threshold and the queue falls back to 256k. Only after the user has been quiet long enough for the average to fall below 192k is a new burst allowed.

![Burst: 512k until the 8-second average reaches the 192k threshold, then max-limit](/img/mtctce/burst.svg)

Length of a burst from idle ≈ burst-threshold × burst-time / burst-limit. If burst-threshold is not lower than max-limit, a user at max-limit never reaches it and bursts forever. Since RouterOS 5 PCQ can burst per sub-stream too (`pcq-burst-rate`, `pcq-burst-threshold`, `pcq-burst-time`). Play with it in the **burst** simulator.

# Lesson: Simple queues

    /queue simple add name=user20 target=192.168.33.20/32 max-limit=1M/2M
    /queue simple add name=lan target=192.168.33.0/24 max-limit=10M/10M queue=pcq-up/pcq-down

- **target**: addresses, subnets or an interface; the queue applies to traffic to and from them. `dst=` narrows it to a destination (for example only traffic to 22.1.1.1).
- Two values `upload/download`: upload is traffic **from** the target, download traffic **to** it. The same applies to limit-at, burst-limit, burst-threshold, burst-time and queue.
- Queues are checked **top to bottom**; a packet is handled by the **first** queue it matches. Put single hosts above whole subnets.
- `packet-marks=` restricts a queue to marked packets; `parent=` builds a hierarchy of simple queues; `time=` makes a queue active only at certain times and days.
- `priority` works between simple queues with the same parent, as in a queue tree.

Simple queues are easy to read and good for per-host or per-customer limits. They cost CPU on large lists, because each packet is compared with the queues in order, and they work in both directions at once. For priorities between classes of traffic, use a queue tree.

The course lab: the LAN gets PCQ with 256k per user, web traffic 512k per user, and bandwidth tests to 22.1.1.1 a burst of 700k with max-limit 300k. The **PCQ and burst** lab here does a similar job.

# Lesson: HTB in detail

HTB arranges queues in a tree:

- **leaf** queues have no children; packets wait only in leaves, which have the packet marks and the priorities;
- **inner** queues have children; they only distribute bandwidth.

Rules:

- the sum of the children's limit-at should not exceed the parent's limit-at, and a child's max-limit should not exceed the parent's max-limit;
- **priority** (1 highest, 8 lowest) is used only by **leaves**, and only for bandwidth above limit-at; inner queues ignore it;
- a queue without max-limit is limited by its parent.

## How HTB shares bandwidth

1. **CIR first.** Every leaf gets its limit-at, as much as it wants of it. If the leaves' limit-at values together exceed what the parent can give, they are cut in proportion.
2. **Inner guarantees.** An inner queue whose limit-at is larger than what its leaves took keeps the difference for **its own leaves**, given by their priority.
3. **What is left** goes to the leaves by priority, highest first, each up to its max-limit (and its parents' max-limit). Leaves with the same priority share equally.

Examples from the slides (everybody wants as much as possible):

| Tree | Result |
|---|---|
| A max 5M; B limit-at 2M max 4M priority 1; C limit-at 2M max 4M priority 8 | B 3M, C 2M: both get 2M, the spare 1M goes to B |
| A max 8M; B 2M/4M p1; C 4M/6M with C1 2M/3M p4, C2 2M/3M p8 | B 4M, C1 2M, C2 2M: B has the best priority among the leaves |
| the same with B p2 and C p1 | unchanged: C is an inner queue, its priority is ignored |
| A max 8M; B 2M/4M (B1, B2 1M/2M, p5, p6); C 3M/6M (C1, C2, C3 1M/2M, p2, p3, p4) | B1 1, B2 1, C1 2, C2 2, C3 2: leftover 3M by priority |
| the same with B limit-at 4M | B1 2, B2 2, C1 2, C2 1, C3 1: B guarantees 4M to its own leaves |

The course lab tree, on a 30M link:

![The lab tree and what each leaf gets at full load](/img/mtctce/htb-lab.svg)

Step by step: the leaves' CIR is 7 + 2 + 2 + 2 + 3 = 16M. B's limit-at is 15M but its leaves took only 9M, so B gives 6M more to its own leaves by priority: B1 (priority 7) gets 3M up to its max of 10M, B2 the remaining 3M. That makes 22M. The last 8M go to the leaf with the best priority, C1 (priority 2), up to its 10M. Result: B1 10M, B2 5M, C1 10M, C2 2M, C3 3M.

If C2 stops and B1 needs only 3M, the free bandwidth moves: B2 gets B's whole guarantee (12M), C1 rises to 10M and C3 takes the rest. Rebuild the examples in the **HTB allocator**.

# Lesson: Queue trees

    /queue tree add name=down parent=bridgeLAN max-limit=30M
    /queue tree add name=voip parent=down packet-mark=voip limit-at=2M max-limit=5M priority=1
    /queue tree add name=web parent=down packet-mark=web limit-at=5M max-limit=30M priority=3
    /queue tree add name=other parent=down packet-mark=no-mark limit-at=1M max-limit=30M priority=8

- **parent=<interface>**: the tree shapes packets leaving that interface: download on the LAN interface, upload on the WAN interface.
- **parent=global**: the tree sees both directions on all interfaces; the packet marks must separate upload and download.
- Only **packet marks** select a queue tree leaf; `packet-mark=no-mark` catches unmarked packets.
- Queue trees are one-directional and need mangle for everything, but they scale well and give full control of priorities.
- FastTracked packets are invisible to queue trees.

Winbox colours a queue by its load: green up to 50% of max-limit, yellow 51-75%, red above 75%.

## A branch office plan from the course

A branch with 6 workstations, 10M down and 5M up, VoIP to the head office through a tunnel, RDP/ICA to terminal servers, a remote file server and the Internet:

| Class | Mark | limit-at | Priority |
|---|---|---|---|
| VoIP | voip (DSCP 46) | enough for all calls | 1 |
| RDP / ICA | rdp | 1-2M | 2 |
| file server | files | 1M guaranteed | 5 |
| Internet | no-mark | 2M guaranteed | 8 (lowest) |

1. Mark connections by class in prerouting, then packets by connection mark.
2. One tree per direction, with the real line speed (a little below it, so that the queue forms on the router and not at the provider).
3. limit-at for each class, max-limit at the line speed so that classes can borrow.

The **HTB tree** lab builds the course tree on a simulated router and checks that the allocation is exactly the one above.
