# Lesson: Routing basics

A router forwards packets between networks using its **routing table** (**IP > Routes**, `/ip route print`). For each packet, the router finds the route with the **most specific** matching destination (**longest prefix match**). If several routes have the same prefix, the one with the lowest **distance** wins.

### Route flags

| Flag | Meaning |
|---|---|
| **A** | Active (used for forwarding) |
| **D** | Dynamic (created automatically) |
| **C** | Connected: created from an IP address on an interface |
| **S** | Static: added by an administrator |
| **X** | Disabled |
| **I** | Inactive (in v7: e.g. the gateway is unreachable) |

(v6 also shows **R** RIP, **B** BGP, **O** OSPF, **U** unreachable, **b** blackhole.)

### Connected routes

Every IP address added to a running interface creates a **connected route** (DAC) automatically:

    /ip address add address=192.168.88.1/24 interface=bridge
    # creates: 192.168.88.0/24 dst via bridge, flags DAC

# Lesson: Static and default routes

### Default route

`0.0.0.0/0` matches everything; it is the route to the Internet:

    /ip route add dst-address=0.0.0.0/0 gateway=10.0.0.1

The DHCP client and PPPoE client can add the default route automatically (*Add Default Route*).

### Static routes

    /ip route add dst-address=192.168.20.0/24 gateway=10.1.1.2

The **gateway** must be reachable through a connected network (or be an interface name, for point-to-point links such as PPP tunnels).

### Distance

**distance** (1-255) sets preference between routes to the **same** destination: lower is better. Defaults: connected 0, static 1, OSPF 110, eBGP 20, iBGP 200.

### Backup default route (failover)

    /ip route add dst-address=0.0.0.0/0 gateway=10.0.0.1 distance=1 check-gateway=ping
    /ip route add dst-address=0.0.0.0/0 gateway=172.16.0.1 distance=2

**check-gateway=ping** (or arp) checks every 10 s; if the gateway does not answer, the route becomes inactive and the backup route takes over.

### Longest prefix example

Routes: `10.0.0.0/8 via A`, `10.1.0.0/16 via B`, `10.1.1.0/24 via C`. A packet to **10.1.1.5** goes to **C**; to **10.1.2.5** goes to **B**; to **10.9.9.9** goes to **A**.

> Practise in the **Route lookup** simulator.

### Course lab chain (Labs 5.3 to 5.9)

Topology: laptop **192.168.x.2/24** (gateway and DNS 192.168.x.1) connected to **bridgeLAN 192.168.x.1/24**; WAN ether1 **22.1.1.x/24**, ISP gateway and DNS **22.1.1.1**.

1. **Lab 5.3**: on the laptop disable wireless and set IP 192.168.x.2, mask 255.255.255.0, gateway 192.168.x.1, DNS 192.168.x.1.
2. **Lab 5.4**: connect with MAC-Winbox, add **192.168.x.1/24** on the bridge, reconnect by IP.
3. **Lab 5.5**: add **22.1.1.x/24** on ether1. Two **DAC** routes appear. Is there Internet? No: there is no default route.
4. **Lab 5.6**: add the default route **0.0.0.0/0 gateway 22.1.1.1** and DNS server 22.1.1.1.
5. **Lab 5.7**: ping by name from Winbox (Tools > Ping) and from the terminal (`/ping mtcna.lab`, stop with **Ctrl+C**).
6. **Lab 5.8**: traceroute from Winbox and from the terminal.
7. **Lab 5.9**: the laptop still has no Internet: private 192.168.x.0/24 must be translated to the routable 22.1.1.x with a **srcnat masquerade** rule out of ether1. Then ping from the laptop.

**ping** sends ICMP Echo-Request and measures the reply time (RTT) and packet loss. **traceroute** shows every router on the path and helps to find where a problem is.

Routes added automatically by a DHCP or PPP client are flagged **D** (dynamic) because the service created them, not the administrator; routes you add by hand are **S** (static).

# Lesson: Dynamic routing (overview)

Static routes are fine for small networks. Larger networks use **dynamic routing protocols** where routers exchange routes automatically: **OSPF** (link state, inside one organisation), **BGP** (between ISPs), **RIP** (old, distance vector). Dynamic routing is covered in the **MTCRE** and **MTINE** courses.

# Lesson: Subnetting refresher

| Prefix | Mask | Addresses | Usable hosts |
|---|---|---|---|
| /30 | 255.255.255.252 | 4 | 2 (point-to-point links) |
| /29 | 255.255.255.248 | 8 | 6 |
| /28 | 255.255.255.240 | 16 | 14 |
| /27 | 255.255.255.224 | 32 | 30 |
| /26 | 255.255.255.192 | 64 | 62 |
| /25 | 255.255.255.128 | 128 | 126 |
| /24 | 255.255.255.0 | 256 | 254 |
| /16 | 255.255.0.0 | 65536 | 65534 |

Usable hosts = 2^(32-prefix) - 2 (network and broadcast address). /31 (RFC 3021) and /32 are special cases.

**Private ranges (RFC 1918)**: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16. **CGNAT**: 100.64.0.0/10.

> Practise with the **Subnet calculator** and its quiz mode.
