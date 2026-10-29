# Lesson: Default configuration and management access

> This lesson follows the course slides, chapter 2.2 "Security Basic Firewall".

### What is already on a new router

A RouterBOARD does not arrive empty. RouterOS applies a **default configuration** that depends on the model: usually ether1 is the WAN with a DHCP client, the other ports are bridged as the LAN with 192.168.88.1/24, a DHCP server, src-nat masquerade and a small firewall.

You can read that configuration before you touch anything:

    /system default-configuration print

The output shows the script RouterOS ran at the first boot. Two things are worth knowing:

- **`/system reset-configuration`** puts it back. With `no-defaults=yes` you get a completely empty router instead.
- **`/system default-configuration print`** also shows `custom-script`, the place where a vendor or an integrator can add their own lines to the default set.

> **Why a security course starts here:** the default configuration is written for a home user who must be able to reach the router on day one. It is a good starting point, not a finished one. Everything in this module is about turning it into something you are willing to put on a public address.

### The lab topology of the slides

The slides use a simple classroom layout, and the labs in this course follow the same shape:

- Each student router has a public-side address **22.1.1.x/24** on the WAN interface.
- The LAN behind it is **192.168.x.1/24**, where `x` is the student number.
- A management user called `man` with the password `Man33ioP` replaces the default `admin`.

Keep the pattern in your head: *one WAN subnet everybody shares, one LAN each.* It explains why the slide rules so often allow a single address like `22.1.1.133` instead of a whole network.

### Hardening the RouterOS services

This is the single most valuable page of the chapter. Step by step:

    /ip service disable telnet,ftp,www,www-ssl,api
    /ip service set winbox port=8288
    /ip service set ssh port=2200 address=10.1.1.0/24
    /ip service set api-ssl port=8729 address=10.1.1.121

Reading it line by line:

1. **Disable what you do not use.** telnet, ftp and www send credentials in clear text. api and www-ssl are usually only needed if something automates the router.
2. **Move the ports you keep.** Winbox on 8288 instead of 8291, SSH on 2200 instead of 22. This does not make the service secure, but it removes most of the automated noise from your logs.
3. **Restrict by address.** `address=10.1.1.0/24` means the service itself refuses anything from another source, even if a firewall rule is wrong. `address=10.1.1.121` restricts api-ssl to one management station.

Then the layer-2 and tool services:

    /tool mac-server set allowed-interface-list=none
    /tool mac-server mac-winbox set allowed-interface-list=none
    /tool mac-server ping set enabled=no
    /tool bandwidth-server set enabled=no
    /ip proxy set enabled=no
    /ip socks set enabled=no
    /ip upnp set enabled=no
    /ip cloud set ddns-enabled=no update-time=no

`allowed-interface-list=none` is stricter than the `LAN` list used in the previous module: nobody can reach the router by MAC at all. Use `none` on routers you always reach by IP, and `LAN` on routers where MAC access is your rescue path.

### Strong crypto for SSH

    /ip ssh set strong-crypto=yes

The slides spell out what the flag actually changes:

- Uses **stronger ciphers**: `aes-128-ctr`, `aes-192-ctr`, `aes-256-ctr` instead of the weak ones.
- Disables **null encryption**, **3DES**, **MD5** and old **SHA1**-only key exchange.
- Prefers **SHA-256** for the message authentication code.
- Uses a **2048-bit** host key instead of 1024-bit.

Old clients may refuse to connect after this. Update the client; do not weaken the router.

### Interfaces you do not use

    /interface print
    /interface ethernet disable ether6,ether7,ether8

An enabled, unused port in a public place is an open door into your LAN bridge. Disable it, and if the port must stay up, give it its own isolated bridge or VLAN.

### A bridge filter example: only PPPoE

Bridge filters work on frames, before any IP processing. The slide example lets only PPPoE through a bridge and drops the rest:

    /interface bridge filter
    add chain=forward action=accept mac-protocol=pppoe
    add chain=forward action=accept mac-protocol=pppoe-discovery
    add chain=forward action=drop

Read it as a whitelist: two accepts, then one drop that catches everything else. The same shape as a good IP filter chain.

### The lab from the slides

> **Lab:** *Open api-ssl and Winbox only from 22.1.1.133.*

    /ip service set api-ssl disabled=no address=22.1.1.133
    /ip service set winbox address=22.1.1.133
    /ip service print

Then try from another address: the connection is refused by the service, not by a filter rule. That is the point of the exercise, and it is the first layer of defence in depth.

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

![The packet flow: prerouting, routing decision, input or forward or output, postrouting](/img/mtctce/packet-flow.svg)

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

# Lesson: Security areas, custom chains and ICMP filtering

> This lesson follows the course slides, chapter 2.2 "Security Basic Firewall".

### Stateless and stateful, side by side

Before the slides build the chains, they compare two ways of filtering:

| | **Stateless** | **Stateful** |
|---|---|---|
| What it looks at | One packet, on its own | The packet **and** the connection it belongs to |
| Needs connection tracking | No | Yes |
| Return traffic | You must write rules for it by hand | Covered by one `established,related` rule |
| CPU and memory | Cheapest | Costs a tracking table entry per connection |
| Catches `invalid` packets | No | Yes |
| Typical place in RouterOS | **RAW** table | **filter** table |

Neither is better; they are a pair. The MTCSE pattern is **stateful in filter for the logic, stateless in RAW for the flood.**

### Security areas

A **security area** is simply a group of interfaces that you trust the same way. RouterOS expresses it with **interface lists**, and the slides draw two: a red WAN area and a green LAN area.

![Security areas: WAN and LAN interface lists (course slide)](/img/mtcse/se22-40.webp)

    /interface list
    add name=WAN
    add name=LAN

    /interface bridge add name=bridge1
    /interface bridge port add bridge=bridge1 interface=ether4
    /interface bridge port add bridge=bridge1 interface=ether5

    /interface list member
    add interface=ether1 list=WAN
    add interface=ether2 list=WAN
    add interface=bridge1 list=LAN
    add interface=ether3 list=LAN

Why the slides insist on this:

- **Fewer rules.** One rule with `in-interface-list=WAN` replaces one rule per WAN port.
- **Less CPU.** Fewer rules to walk through for every packet.
- **No rework when the network changes.** Plug a second ISP into ether2, add it to the `WAN` list, and every existing rule already covers it.

Note that ether2 is in the list even though ISP2 is only *planned*. That is deliberate: the area is defined by the role of the port, not by what is plugged in today.

### Custom chains

The built-in chains are **input**, **forward** and **output**. You may create as many of your own as you like, in filter, NAT and mangle. Two reasons, both from the slides: **lower CPU load** and **a readable rule set**.

How the CPU saving works, step by step. Suppose 100 packets arrive, of which only 1 is ICMP, and you have 5 ICMP rules plus a drop:

- **Without a custom chain**: all 6 ICMP rules sit in `input`. Every one of the 100 packets is compared against all 6. That is 600 comparisons.
- **With a custom chain**: `input` holds one rule, *if ICMP then jump to ICMP-Filter*. The 99 non-ICMP packets fail that one test and move on. Only the 1 ICMP packet walks the 6 rules inside the chain. That is about 105 comparisons.

The readability saving is the same idea applied to traffic direction. The slides split `forward` by security area:

    /ip firewall filter
    add chain=forward action=accept connection-state=established,related
    add chain=forward action=jump jump-target=WANsToLANs in-interface-list=WAN out-interface-list=LAN
    add chain=forward action=jump jump-target=LANsToWANs in-interface-list=LAN out-interface-list=WAN
    add chain=forward action=jump jump-target=LANsToLANs in-interface-list=LAN out-interface-list=LAN

Now each chain answers one question:

- **WANsToLANs**: which public services may be reached from the Internet? Ends with `drop`.
- **LANsToWANs**: what may my users not do towards the Internet? Ends with `drop` or `accept` depending on your policy.
- **LANsToLANs**: may my networks talk to each other?

An example of `WANsToLANs` from the slides, publishing three servers and dropping the rest:

    add chain=WANsToLANs protocol=tcp dst-address=192.168.33.100 dst-port=3389 src-address-list=GOODGUYS action=accept
    add chain=WANsToLANs protocol=tcp dst-address=192.168.33.220 dst-port=80,110 action=accept
    add chain=WANsToLANs protocol=tcp dst-address=192.168.33.200 dst-port=443 action=accept
    add chain=WANsToLANs action=drop

> **Remember `return`:** if nothing in a custom chain matches, the packet goes back to the chain that jumped, and continues *after* the jump rule. A custom chain that must be final therefore ends with its own `drop`.

### ICMP filtering

**ICMP** carries error messages and diagnostics for IP. It has **no authentication**, so an attacker can forge any of it, which is why a firewall should decide **per type and code** what it accepts.

Dropping all ICMP is a classic beginner mistake: it breaks `ping`, `traceroute` and, worse, **path MTU discovery**, which makes large packets disappear silently.

The slide's recommended set, built as a custom chain:

    /ip firewall filter
    add chain=input protocol=icmp action=jump jump-target=icmp
    add chain=icmp protocol=icmp icmp-options=0:0 action=accept comment="echo reply"
    add chain=icmp protocol=icmp icmp-options=3:0 action=accept comment="net unreachable"
    add chain=icmp protocol=icmp icmp-options=3:1 action=accept comment="host unreachable"
    add chain=icmp protocol=icmp icmp-options=3:4 action=accept comment="fragmentation needed"
    add chain=icmp protocol=icmp icmp-options=4:0 action=accept comment="source quench"
    add chain=icmp protocol=icmp icmp-options=8:0 action=accept comment="echo request"
    add chain=icmp protocol=icmp icmp-options=11:0 action=accept comment="time exceeded"
    add chain=icmp protocol=icmp icmp-options=12:0 action=accept comment="parameter problem"
    add chain=icmp protocol=icmp action=drop comment="deny all other types"

The syntax is `icmp-options=type:code`. The eight types above are the ones you actually need:

| Type:code | Name | Why you keep it |
|---|---|---|
| 8:0 | echo request | `ping` towards you works |
| 0:0 | echo reply | your own `ping` gets answers |
| 3:4 | fragmentation needed | **path MTU discovery**; without it big packets die |
| 3:0, 3:1 | net / host unreachable | a dead destination is reported instead of hanging |
| 11:0 | time exceeded | `traceroute` works |
| 12:0 | parameter problem | malformed headers are reported |
| 4:0 | source quench | legacy congestion signal |

> **Where the ICMP options live in Winbox:** New Firewall Rule → **Advanced** tab → the **ICMP Options** section, which only appears once `protocol=icmp` is selected. The `IPv4 Options` box right above it is a different field; the slides call that out specifically because people fill it in by mistake.

Rate limiting pairs naturally with this, and is covered in the next module together with ping floods.

### The lab from the slides

> **Lab:** *Rebuild the firewall so that the logical movement of traffic is split across custom chains, and allow only the necessary ICMP types and codes, in a custom chain.*

Work in this order, in Safe Mode:

1. Create the `WAN` and `LAN` interface lists and put every interface in one of them.
2. Rewrite `forward` as four rules: accept established/related, then three jumps.
3. Fill `WANsToLANs`, `LANsToWANs` and `LANsToLANs`, each ending with its own action.
4. Add the `icmp` chain above, and jump to it from `input`.
5. Check the counters with `/ip firewall filter print stats` to see which rules actually match.

### Course lab

- **Lab "Build a stateful firewall with RAW protection"**: build the input and forward chains, an address list `not_in_internet` and a RAW rule against spoofed sources, without breaking the laptop's Internet access.
