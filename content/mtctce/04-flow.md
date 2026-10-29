# Lesson: The five chains

Every IP packet that touches the router follows one of three paths:

| Traffic | Example | Path |
|---|---|---|
| to the router | Winbox, DNS query to the router, ping to the router | prerouting → **input** → local process |
| through the router | a LAN user browsing the web | prerouting → **forward** → postrouting |
| from the router | the router's own DNS query, NTP, VPN packets | local process → **output** → postrouting |

Each stage is a **chain**, and each table has its own chains:

| Table | Chains |
|---|---|
| raw | prerouting, output |
| mangle | prerouting, input, forward, output, postrouting |
| nat | dstnat (in prerouting), srcnat (in postrouting) |
| filter | input, forward, output |

![The RouterOS packet flow: prerouting, routing decision, then input, forward or output, and postrouting](/img/mtctce/packet-flow.svg)

## Inside each stage

- **prerouting**: RAW prerouting, **connection tracking**, mangle prerouting, **dstnat**. Hotspot runs here too.
- **routing decision**: the destination (after dstnat) and any routing mark choose the route. The packet goes to input if it is for the router, otherwise to forward with a known out-interface.
- **input**: mangle input, filter input, then the global queues (queue trees with `parent=global` and simple queues) for traffic to the router.
- **forward**: TTL is decreased, mangle forward, filter forward. FastTrack is decided here.
- **output**: the router's own packet is routed, then RAW output, connection tracking, mangle output, filter output, and **routing adjustment**: if mangle output set a routing mark, the route is looked up again.
- **postrouting**: mangle postrouting, **srcnat**, hotspot out, the IPsec policy check, the global queues and simple queues, and finally the **interface queue** (queue trees with `parent=<interface>` and the interface's queue type).

Consequences you meet every day:

- `out-interface` cannot be used in prerouting or dstnat: it is not known yet. `in-interface` cannot be used in postrouting or srcnat.
- A forward rule for a port-forwarded server sees the **private** address and port, because dstnat already ran.
- A routing mark set in forward or postrouting is too late to change the route.

Walk packets through the stages in the **packet flow** simulator.

# Lesson: Queues in the packet flow, RouterOS 5 to 7

RouterOS 5 had several attach points for global queues: **global-in** (after prerouting), **global-out** (after postrouting) and **global-total**. RouterOS 6 replaced them with **one global HTB**, processed at the end of **input** and of **postrouting**, together with the **simple queues**. RouterOS 7 keeps this design.

| Queue | Sees |
|---|---|
| queue tree `parent=global` and simple queues | packets in input and postrouting, both directions together |
| queue tree `parent=ether1` (an interface) | only packets **leaving** that interface |

So: **download** to the LAN users is shaped on the LAN interface (or globally with marks per direction), **upload** on the WAN interface. A queue on the WAN interface cannot shape downloads: by the time a downloaded packet arrives there, it has already crossed the slow link.

Practical rules from the slides:

- Mark with connection marks in prerouting, packet marks in forward or postrouting, when you need the out-interface.
- For global trees, separate upload and download marks with `out-interface` (out WAN = upload, out LAN = download).
- Simple queues are easy for per-host limits; queue trees are the tool for priorities and complex trees.

# Lesson: Bridging and use-ip-firewall

Traffic between two ports of the **same bridge** is switched, not routed. It passes the bridge's own chains (`/interface bridge filter` and `nat`, working with MAC addresses), but **not** the IP firewall, mangle or queue trees with IP marks.

    /interface bridge settings set use-ip-firewall=yes

With **use-ip-firewall=yes**, bridged IPv4 packets also go through IP prerouting, forward and postrouting, so IP filter rules, mangle marks and queues apply to traffic between bridge ports. Match the ports with **in-bridge-port** and **out-bridge-port**: `in-interface` is the bridge itself. The setting costs performance and turns off hardware offloading for the bridge, so enable it only when you really need IP-level control of bridged traffic (for example on a transparent bandwidth limiter).

RouterOS 7 has the same option. The packet flow diagrams in the documentation show the bridging, MPLS and routing blocks separately; the slides go through them step by step for RouterOS 6.

# Lesson: Fast path and FastTrack

The full path is flexible but costs CPU on every packet. The **fast path** is a shortcut through the router for packets that need none of the slow-path features.

**FastTrack** puts established connections on the fast path:

    /ip firewall filter add chain=forward action=fasttrack-connection connection-state=established,related hw-offload=yes
    /ip firewall filter add chain=forward action=accept connection-state=established,related,untracked

- The first packets of each connection go through the normal path; after the connection is established, its packets are fasttracked.
- `fasttrack-connection` does not accept the packet: the next rule must accept established and related.
- Fasttracked packets **skip mangle, filter, NAT and all queues**. Connection tracking still knows them (they are marked `F` in `/ip firewall connection`).
- On some devices `hw-offload=yes` moves them into the switch chip.

The price: anything you want to **mark, shape or count** must not be fasttracked. A simple queue for one user stops limiting after FastTrack is enabled, because that user's packets no longer reach it. Exclude such traffic above the fasttrack rule:

    /ip firewall filter add chain=forward action=accept connection-state=established,related src-address=192.168.33.50 place-before=0

The **FastTrack** lab enables it and keeps an IP phone on the slow path, ready for the mangle and QoS modules.
