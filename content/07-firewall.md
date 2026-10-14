# Lesson: Firewall principles

The firewall decides which packets may pass. In RouterOS it lives in **IP > Firewall** with the tabs **Filter Rules**, **NAT**, **Mangle**, **Raw**, **Address Lists**, **Connections** and **Layer7 Protocols**.

### Chains

A **chain** is a list of rules applied to a type of traffic:

| Chain (filter) | Traffic |
|---|---|
| **input** | Packets **to the router itself** (Winbox, ping to the router, DNS to the router) |
| **forward** | Packets **through** the router (LAN to Internet) |
| **output** | Packets **from the router itself** |

NAT uses **srcnat** and **dstnat**; mangle and raw also have **prerouting** and **postrouting**. You can create your own chains and send traffic to them with **action=jump**.

### Rule processing

- Rules in a chain are checked **top to bottom**. The **first matching rule** with a terminating action decides the packet; later rules are not checked.
- If no rule matches, the packet is **accepted** (default policy is accept). That is why a secure firewall ends with a **drop** rule.
- **Order matters**: an *accept* placed after a *drop all* is never reached.

> Experiment in the **Firewall rule order** simulator.

# Lesson: Connection tracking

RouterOS tracks connections (**IP > Firewall > Connections**). Each packet gets a **connection-state**:

| State | Meaning |
|---|---|
| **new** | First packet of a new connection |
| **established** | Belongs to a connection that has seen traffic in both directions |
| **related** | New connection related to an existing one (FTP data, ICMP errors) |
| **invalid** | Does not belong to any known connection; should be dropped |
| **untracked** | Marked notrack in raw |

Rule of thumb: accept **established,related** at the **top** (most packets match it, so the firewall is fast), drop **invalid**, then decide only about **new** connections.

**FastTrack** (`action=fasttrack-connection` for established,related in forward) lets established traffic bypass most of the firewall and queues, saving CPU. Simple queues do not work for fasttracked traffic.

# Lesson: Filter actions and matchers

### Actions

| Action | Effect |
|---|---|
| **accept** | Allow the packet; stop processing this chain |
| **drop** | Silently discard |
| **reject** | Discard and send an ICMP error (or TCP reset) |
| **jump** / **return** | Go to a custom chain / come back |
| **add-src-to-address-list** / **add-dst-to-address-list** | Put the address into a list (optionally with timeout) |
| **log** | Write to the log and continue |
| **passthrough** | Count only and continue |
| **tarpit** | Hold TCP connections open (anti-scan) |
| **fasttrack-connection** | FastTrack the connection |

### Common matchers

src-address, dst-address, protocol (tcp, udp, icmp...), src-port, dst-port, **in-interface**, **out-interface**, in/out-interface-list, connection-state, **src-address-list**, **dst-address-list**, connection-limit, limit, time, layer7-protocol, content.

### Address lists

Group addresses and reuse them in rules:

    /ip firewall address-list add list=admins address=192.168.88.10
    /ip firewall filter add chain=input src-address-list=admins action=accept

Addresses can be added dynamically by rules (port knocking, blocking SSH brute force).

# Lesson: Protecting the router

A minimal, safe **input** chain:

    /ip firewall filter
    add chain=input connection-state=established,related action=accept comment="accept est/rel"
    add chain=input connection-state=invalid action=drop comment="drop invalid"
    add chain=input protocol=icmp action=accept comment="allow ping"
    add chain=input in-interface-list=LAN action=accept comment="allow from LAN"
    add chain=input action=drop comment="drop everything else"

And for clients (**forward**):

    add chain=forward connection-state=established,related action=accept
    add chain=forward connection-state=invalid action=drop
    add chain=forward connection-state=new in-interface=ether1 connection-nat-state=!dstnat action=drop \
        comment="drop new from WAN that is not port-forwarded"

> **Before** adding the final *drop*, make sure there is an accept rule for your management access, or turn on **Safe Mode**.

# Lesson: NAT

**NAT** changes addresses in packets. There are two chains:

| Chain | Changes | Typical action |
|---|---|---|
| **srcnat** | **Source** address of packets leaving the router (applied after routing) | **masquerade**, src-nat |
| **dstnat** | **Destination** address of packets arriving at the router (before routing) | **dst-nat**, redirect |

### Masquerade

Lets the whole private LAN share the router's public address:

    /ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade

Masquerade automatically uses the IP of the out-interface; good for **dynamic** WAN addresses (DHCP, PPPoE). With a static public IP, **src-nat to-addresses=** is slightly more efficient.

### Port forwarding (dst-nat)

Make a web server 192.168.88.10 reachable from the Internet on port 80:

    /ip firewall nat add chain=dstnat in-interface=ether1 protocol=tcp dst-port=80 \
        action=dst-nat to-addresses=192.168.88.10 to-ports=80

**redirect** is dst-nat to the router itself (e.g. transparent DNS or proxy).

### How NAT works with connection tracking (from the course)

- Without NAT a reply to a private address (192.168.1.2) cannot come back from the Internet: private addresses are not routed there, and ISP routers drop them. The source must be replaced by the router's routable address.
- To translate replies back, the router must remember which inside host opened which connection: that is the job of **connection tracking** (`/ip firewall connection`). NAT does not work without it.
- **NAT rules are checked only for the first packet** of a connection; the rest of the connection follows the conntrack entry.
- Rules work as **IF (conditions on General/Advanced/Extra tabs) THEN (Action tab)**, top to bottom; **src-nat** and **masquerade** are terminating: the first matching rule wins, so put **more specific rules higher**.

Example from the course: the ISP gave four addresses 22.1.1.2-22.1.1.5. The whole LAN 192.168.33.0/24 goes out as 22.1.1.5, but the mail server 192.168.33.100 must use 22.1.1.4. The rule for 192.168.33.100 must be **above** the rule for the /24, otherwise the mail server matches the /24 rule first.

**Src/Dst address** fields accept a subnet (192.168.1.0/24), a single IP, or a range (192.168.1.10-192.168.1.20). **!** in front of a value means **NOT**. For many unrelated addresses use an **address list** (an entry can also be a DNS name, the router resolves it).

### NAT actions

| Action | Chain | Effect |
|---|---|---|
| **accept** | both | Stop NAT processing: the packet is **not** translated (exclude traffic from lower rules) |
| **src-nat** | srcnat | Replace source with *to-addresses* |
| **masquerade** | srcnat | src-nat to the out-interface IP (dynamic WAN) |
| **dst-nat** | dstnat | Replace destination with *to-addresses*/*to-ports* |
| **redirect** | dstnat | dst-nat to the router itself (address of the incoming interface): transparent DNS or proxy |
| **netmap** | both | 1:1 mapping of a range/subnet to another range/subnet: replaces many rules with one |
| **same** | both | Give a client the same address from a pool every time |
| jump, return, log, passthrough, add-src/dst-to-address-list | both | Same as in filter |

### SRC-NAT lab

    /ip firewall nat
    add chain=srcnat out-interface=ether1 src-address=192.168.33.0/24 action=masquerade
    add chain=srcnat out-interface=ether1 src-address-list=internet_users action=masquerade
    add chain=srcnat out-interface=ether1 src-address-list=!BadUsers action=masquerade
    add chain=srcnat src-address=192.168.33.100 dst-address=8.8.8.8 action=masquerade
    add chain=srcnat out-interface=ether1 protocol=tcp dst-port=80,443 src-address=192.168.33.0/24 action=masquerade

Each line solves one task: the whole LAN; only the list *internet_users*; everyone except *BadUsers*; one host only to 8.8.8.8; the LAN only to web (80/443). Enable one at a time.

### DST-NAT lab

Redirect all DNS from the LAN to the router, and publish the mail server 192.168.33.100 (TCP 110, 25, 143, 80) on the public address:

    /ip firewall nat
    add chain=dstnat src-address=192.168.33.0/24 protocol=udp dst-port=53 action=redirect
    add chain=dstnat src-address=192.168.33.0/24 protocol=tcp dst-port=53 action=redirect
    add chain=dstnat dst-address=22.1.1.33 protocol=tcp dst-port=110,25,143,80 action=dst-nat to-addresses=192.168.33.100

### Lab (from the tunnels chapter)

After switching the WAN from PPPoE back to DHCP, Internet does not work because the masquerade rule had **out-interface=pppoe-out1**. Fix: set out-interface to **ether1** (or use an interface list *WAN* containing both).

# Lesson: Packet flow and filter labs

### Packet flow

A packet entering the router passes **prerouting** (raw, connection tracking, mangle, **dstnat**), then a **routing decision**:

- to the router itself: **input** (mangle, **filter input**) and then the local process;
- through the router: **forward** (mangle, **filter forward**), then **postrouting** (mangle, **srcnat**), out interface;
- from the router: local process, **output** (mangle, **filter output**), postrouting.

Consequence: **dst-nat happens before the filter**, so a forward rule for a port-forward sees the **new (internal)** destination address. Port-forwarded traffic is filtered in **forward**, not input.

### Policy: deny everything that is not allowed

Corporate firewalls normally *deny all* at the end and *allow* only what is needed above it. NAT is checked for the first packet only, but **filter checks every packet**, so put **established,related accept** first; then only new connections walk through the rest of the rules.

A minimal firewall that protects the router and the LAN from the WAN (ether1):

    /ip firewall filter
    add chain=input connection-state=established,related action=accept
    add chain=input in-interface=ether1 action=drop
    add chain=forward connection-state=established,related action=accept
    add chain=forward in-interface=ether1 action=drop

Open Winbox from outside: add `chain=input protocol=tcp dst-port=8291 action=accept` **above** the input drop. Publish a port-forwarded service: add `chain=forward protocol=tcp dst-port=80,3389 action=accept` (or `connection-nat-state=dstnat`) **above** the forward drop.

### Filter lab (from the course)

Delete all rules, then:

1. Close Winbox (TCP 8291) on the router from the WAN (ether1).
2. Block Internet for "bad" users 192.168.x.34, 192.168.x.54, 192.168.x.65-89.
3. The router is a VPN server: open UDP 1701 and TCP 1723 to it.
4. Block ping (ICMP) from users to 8.8.8.8.
5. Block telnet (TCP 23) to the router.
6. Users 192.168.x.24 and .25 must not reach server 212.0.3.43 on ports 110, 25, 143, 80.
7. The router itself must not ping 212.0.200.1.

Solution:

    /ip firewall filter
    add chain=input in-interface=ether1 protocol=tcp dst-port=8291 action=drop
    add chain=forward out-interface=ether1 src-address-list=BadUsers action=drop
    add chain=input protocol=tcp dst-port=1723 action=accept
    add chain=input protocol=udp dst-port=1701 action=accept
    add chain=forward dst-address=8.8.8.8 protocol=icmp src-address=192.168.33.0/24 action=drop
    add chain=input protocol=tcp dst-port=23 action=drop
    add chain=forward dst-address=212.0.3.43 protocol=tcp dst-port=110,25,143,80 src-address=192.168.33.24/31 action=drop
    add chain=output dst-address=212.0.200.1 action=drop

Note task 6: 192.168.33.24/31 covers exactly .24 and .25, and task 7 uses the **output** chain because the traffic starts on the router.

### Custom chains

Besides input, forward and output you can create your own chains (in filter, NAT and mangle) to **reduce CPU load** and keep the rules **structured**. Example: instead of nine ICMP rules in input that every packet must pass, one rule `chain=input protocol=icmp action=jump jump-target=ICMP-Filter` sends only ICMP into a separate chain; non-ICMP packets skip it. At the end of a custom chain the packet **returns** to the calling chain (or use action=return earlier).

Filter actions: accept, add-dst-to-address-list, add-src-to-address-list, drop, fasttrack-connection, jump, log, passthrough, reject, return, tarpit.
