# Lesson: Packet flow

In MTCNA you learned three filter chains: **input**, **forward**, **output**. For security work you need the full picture: a packet passes several **tables** (RAW, mangle, NAT, filter) in a fixed order, and the place where you stop an attack decides how much CPU it costs.

### The order of processing

A packet that **arrives** at the router goes through:

1. **RAW prerouting**: the very first place. Connection tracking has not seen the packet yet.
2. **Connection tracking**: the router finds or creates the connection entry and sets **connection-state**.
3. **Mangle prerouting**, **NAT dstnat**.
4. **Routing decision**: is the packet for the router (input) or through it (forward)?
5. **Mangle input → filter input** (to the router itself), or **mangle forward → filter forward** (through the router).
6. For forwarded packets: **mangle postrouting**, **NAT srcnat**, then out.

A packet **created by the router** (its own ping, DNS query, VPN packet) goes: **RAW output → connection tracking → mangle output → filter output → postrouting**.

| Table | Chains | Typical use |
|---|---|---|
| **raw** | prerouting, output | Cheap early drop, notrack |
| **mangle** | prerouting, input, forward, output, postrouting | Marks, TTL, MSS |
| **nat** | dstnat, srcnat | Port forwarding, masquerade |
| **filter** | input, forward, output | Allow or deny |

> **Beginner example:** someone on the Internet pings your router. The packet passes RAW prerouting, connection tracking (state new), dstnat (no rule), routing (destination is the router) and finally **filter input**. A ping that the router itself sends starts in **output**.

Try the packet flow in the **Firewall rule order** simulator.

# Lesson: Connection tracking in depth

**Connection tracking** remembers every connection the router sees. With it the firewall knows whether a packet starts something new or belongs to a conversation that was already allowed.

### Connection states

| State | Meaning | Example |
|---|---|---|
| **new** | First packet of a connection | A TCP SYN |
| **established** | Packet of a known connection (traffic in both directions seen) | The rest of a web page |
| **related** | New connection that belongs to an existing one | ICMP "destination unreachable" about a TCP session, FTP data channel |
| **invalid** | Does not belong to anything and does not start anything valid | A TCP ACK without a known connection |
| **untracked** | Packet marked **notrack** in RAW | Trusted bulk traffic |

### Settings

    /ip firewall connection tracking print
    /ip firewall connection tracking set enabled=auto

- **enabled=auto** (default): tracking becomes active **as soon as there is at least one firewall rule**.
- **enabled=yes / no**: always on / off. Without tracking, stateful rules and NAT do not work.
- Timeouts (`tcp-established-timeout=1d`, `udp-timeout=10s`...) say how long an idle entry is kept.
- `/ip firewall connection print` shows the table; the **max-entries** value tells you the limit.

### Why the state matters for security

A good firewall answers 99% of packets with one cheap rule: **accept established, related**. Only **new** packets go further down the rule list where the expensive checks are. Packets in state **invalid** are dropped immediately: they often come from scans or spoofing.

### FastTrack

`action=fasttrack-connection` lets **established** packets of a connection skip most of the firewall, mangle and queues. It saves a lot of CPU, but those packets are not seen by later rules or queues. Only use it for traffic you trust.

# Lesson: RAW and notrack

The **RAW** table runs **before connection tracking**. This makes it the best place to drop traffic you never want: the router does not create a connection entry, does not spend memory, and checks very few rules.

### RAW chains and actions

- Chains: **prerouting** (packets arriving) and **output** (packets of the router).
- Actions: **accept**, **drop**, **notrack**, **jump**, **return**, **log**, **passthrough**, **add-src-to-address-list**, **add-dst-to-address-list**.
- There is **no reject**, no NAT, no connection-state matching (there is no state yet).

### Example 1: drop spoofed sources

Packets from the Internet should never have a private source address. If they do, the source is forged.

    /ip firewall address-list
    add list=not_in_internet address=10.0.0.0/8
    add list=not_in_internet address=172.16.0.0/12
    add list=not_in_internet address=192.168.0.0/16
    /ip firewall raw
    add chain=prerouting in-interface-list=WAN src-address-list=not_in_internet action=drop \
        comment="drop spoofed private sources from the WAN"

Step by step, why `in-interface-list=WAN` is important: your LAN *does* use 192.168.0.0/16. Without the interface condition, the rule would drop your own laptop.

### Example 2: block a known attacker cheaply

    /ip firewall raw add chain=prerouting src-address-list=blacklist action=drop

The same rule in filter would work too, but every packet would first go through connection tracking. During an attack with thousands of packets per second, RAW keeps the CPU free.

### notrack

`action=notrack` lets a packet bypass connection tracking. In filter it is seen with **connection-state=untracked**. Use it for large trusted flows (for example traffic between two of your own servers) where tracking is just overhead. If you use notrack, your "accept established,related" rule must also accept **untracked**:

    /ip firewall filter add chain=input connection-state=established,related,untracked action=accept

# Lesson: Building a secure filter

### Actions that stop and actions that continue

| Action | Stops processing? |
|---|---|
| accept, drop, reject, tarpit, fasttrack-connection | **Yes** |
| return | Returns to the calling chain |
| jump | Goes to another chain; if nothing matches there, comes back and continues after the jump |
| **log, passthrough, add-src-to-address-list, add-dst-to-address-list** | **No**, the packet continues to the next rule |

**drop** discards the packet silently. **reject** discards it and sends back an ICMP error or a TCP reset (`reject-with=`). For the Internet, drop is preferred: it gives the attacker less information and costs nothing.

If no rule matches, the packet is **accepted**. That is why every secure chain ends with a drop rule.

### A secure input chain, step by step

    /ip firewall filter
    add chain=input action=accept connection-state=established,related,untracked comment="1. known traffic"
    add chain=input action=drop connection-state=invalid comment="2. invalid"
    add chain=input action=accept protocol=icmp comment="3. ping and ICMP errors"
    add chain=input action=accept in-interface-list=LAN comment="4. management from the LAN"
    add chain=input action=drop in-interface-list=!LAN comment="5. everything else from outside"

Read it as a story: known conversations pass quickly; broken packets die; ICMP is useful for troubleshooting; the LAN may manage the router; everyone else is dropped.

### A secure forward chain

    add chain=forward action=fasttrack-connection connection-state=established,related hw-offload=yes
    add chain=forward action=accept connection-state=established,related,untracked
    add chain=forward action=drop connection-state=invalid
    add chain=forward action=drop connection-state=new connection-nat-state=!dstnat in-interface-list=WAN \
        comment="drop new from WAN that is not port-forwarded"

The last rule drops every **new** connection from the Internet **unless** it was port-forwarded by a dst-nat rule. `connection-nat-state=!dstnat` keeps your port forwards working.

### Custom chains

Keep the rule list readable with your own chains:

    add chain=input protocol=tcp dst-port=22 action=jump jump-target=ssh-check
    add chain=ssh-check src-address-list=ssh_blacklist action=drop
    add chain=ssh-check action=return

If no rule in `ssh-check` matches, the packet returns and continues after the jump.

### Course lab

- **Lab "Build a stateful firewall with RAW protection"**: build the input and forward chains, an address list `not_in_internet` and a RAW rule against spoofed sources, without breaking the laptop's Internet access.
