# Lesson: Connection tracking and connection states

The firewall of RouterOS is **stateful**: connection tracking remembers every connection that passes the router, in `/ip firewall connection`. Each packet is then classified:

| State | Meaning |
|---|---|
| new | the first packet of a connection |
| established | a packet of a connection that has seen traffic in both directions |
| related | a new connection that belongs to an existing one: FTP data, an ICMP error about a connection |
| invalid | does not belong to any known connection and is not a valid start (for example a stray TCP ACK) |
| untracked | connection tracking was skipped for it (RAW `notrack`) |

The connection state is **not** the TCP state. Connection tracking also follows UDP and ICMP, which have no handshake: a UDP "connection" is established as soon as a reply comes back. TCP states (syn-sent, established, fin-wait, time-wait…) appear in a separate column and decide the timeouts.

This is what makes the classic first rules so cheap and safe:

    /ip firewall filter add chain=input action=accept connection-state=established,related,untracked
    /ip firewall filter add chain=input action=drop connection-state=invalid

Most packets are established and are accepted by the first rule; only new connections need the rest of the rules.

Connection tracking has a cost: memory and CPU per connection. `/ip firewall connection tracking` shows the timeouts (for example `tcp-established-timeout=1d`, `udp-timeout=30s`) and `enabled=auto` (on as soon as a rule needs it).

# Lesson: Filter tactics and service ports

## Chains

- **input**: protects the router itself.
- **forward**: protects the networks behind the router.
- **output**: controls what the router sends; rarely needed.

## Two tactics

1. **Drop what is not needed, accept the rest**: a list of known bad things. Every new service or attack needs a new rule, and you only learn about it after the damage.
2. **Accept what is needed, drop everything else**: a list of what is allowed. New services stay closed until you open them. The slides recommend this one, especially for input.

A minimal secure input chain:

    /ip firewall filter
    add chain=input action=accept connection-state=established,related,untracked
    add chain=input action=drop connection-state=invalid
    add chain=input action=accept protocol=icmp
    add chain=input action=accept in-interface-list=LAN
    add chain=input action=drop

## RouterOS service ports

| Service | Port |
|---|---|
| Winbox | TCP 8291 |
| SSH / Telnet / FTP | TCP 22 / 23 / 21 |
| WebFig HTTP / HTTPS | TCP 80 / 443 |
| API / API-SSL | TCP 8728 / 8729 |
| bandwidth test server | TCP 2000 (and UDP 2000+) |
| MAC Winbox, neighbour discovery (MNDP) | UDP 20561, UDP 5678 |
| web proxy | TCP 8080 (your choice), 3128 is common |
| DNS | UDP/TCP 53 |
| DHCP server | UDP 67 |
| NTP | UDP 123 |
| SNMP | UDP 161 |
| PPTP / L2TP / SSTP | TCP 1723 + GRE / UDP 1701 / TCP 443 |
| IPsec | UDP 500, UDP 4500, ESP (IP protocol 50) |
| WireGuard | UDP 13231 (your choice) |
| OSPF / VRRP | IP protocol 89 / 112 |

Anything the router must answer from the WAN (a VPN server, ping) is accepted explicitly above the final drop.

# Lesson: Custom chains, actions and matchers

## Custom chains

A packet is compared with every rule of a chain until one matches. With hundreds of rules this costs CPU. **Custom chains** group rules so that a packet only meets the rules that concern it:

    /ip firewall filter add chain=input protocol=icmp action=jump jump-target=icmp
    /ip firewall filter add chain=input protocol=tcp action=jump jump-target=tcp-in
    /ip firewall filter add chain=input protocol=udp action=jump jump-target=udp-in

A packet that reaches the end of a custom chain without a decision **returns** to the rule after the jump. `action=return` does the same explicitly.

## Actions

| Action | Effect |
|---|---|
| accept, drop | final decision |
| reject | drop and answer with an ICMP error or TCP reset (`reject-with`) |
| tarpit | answer TCP SYN and hold the connection with a zero window |
| jump, return | enter and leave custom chains |
| log | write to the log and continue (`log-prefix`) |
| passthrough | count the packet and continue |
| add-src-to-address-list, add-dst-to-address-list | put the address into a list, with `address-list-timeout`, and continue |
| fasttrack-connection | forward chain: put the connection on the fast path |

## Matchers

- **Addresses**: a single address, a subnet, a range (`10.0.0.1-10.0.0.50`), negated with `!`.
- **Ports**: single, range (`1024-65535`) or list (`22,80,443`); `any-port` matches source or destination.
- **Interfaces**: `in-interface`, `out-interface`, interface lists, and `in-bridge-port`/`out-bridge-port` for bridged traffic with use-ip-firewall.
- **Address lists**: `src-address-list`, `dst-address-list`. A list entry can be an address, a subnet, a range or a **DNS name** that the router resolves and keeps up to date.
- **Advanced**: `src-mac-address`, `random` (1 to 99 percent), `nth`, `packet-size`, `connection-bytes`, `connection-rate`, `ttl`, `content`, `tls-host`, `ingress-priority`, `dscp`.

## DSCP

The **DSCP** field (6 bits of the old TOS byte, so DSCP = TOS / 4) tells routers how to treat a packet:

| Name | DSCP | TOS byte | Typical use |
|---|---|---|---|
| CS0 / default | 0 | 0x00 | best effort |
| AF31 | 26 | 0x68 | call signalling (SIP) |
| CS5 | 40 | 0xA0 | |
| EF | 46 | 0xB8 | voice (RTP) |
| CS6 | 48 | 0xC0 | network control |

## ICMP

ICMP is needed for the network to work, but not all of it. Allow:

| type:code | Meaning | Needed for |
|---|---|---|
| 0:0 | echo reply | ping |
| 8:0 | echo request | ping |
| 11:0 | TTL exceeded | traceroute |
| 3:3 | port unreachable | traceroute (UDP), errors |
| 3:4 | fragmentation needed | **path MTU discovery** |

and drop the rest (redirects 5, timestamps 13 and 14, and so on). Never drop 3:4: large packets then silently disappear on links with a smaller MTU, such as PPPoE and tunnels. The **ICMP chain** lab builds exactly this custom chain.

# Lesson: Attacks and how the firewall stops them

## Ping flood

    /ip firewall filter add chain=input protocol=icmp limit=50,5:packet action=accept
    /ip firewall filter add chain=input protocol=icmp action=drop

**limit=rate,burst** matches packets up to the rate; packets over it fall through to the drop rule.

## Port scans: psd

**Port scan detection** adds up a weight for every new port a source tries, within a time window:

    psd=21,3s,3,1        (weight-threshold, delay-threshold, low-port-weight, high-port-weight)

Ports below 1024 weigh 3, others 1; a source that reaches 21 within 3 seconds is a scanner: 7 privileged ports or 21 high ports in 3 seconds. A repeated port counts once.

    /ip firewall filter add chain=input in-interface-list=WAN protocol=tcp psd=21,3s,3,1 action=add-src-to-address-list address-list=port_scanners address-list-timeout=1d
    /ip firewall raw add chain=prerouting src-address-list=port_scanners action=drop

## SYN flood and connection floods

A **SYN flood** sends TCP SYN packets, often from spoofed addresses, faster than the server can time out the half-open connections.

- **TCP SYN cookies** (`/ip settings set tcp-syncookies=yes`) let the router answer SYNs to its own services without keeping state for them.
- **connection-limit=N,mask** matches when a source (counted per address block of that mask) has more than N connections:

    /ip firewall filter add chain=input protocol=tcp connection-limit=100,32 action=add-src-to-address-list address-list=conn_flood address-list-timeout=1h

## DDoS

A **distributed** attack comes from thousands of addresses (a botnet). The firewall can protect the router and the LAN from small attacks: detect with psd, connection-limit and connection-rate, collect the sources in address lists, and drop them in **RAW** before connection tracking. An attack that fills your Internet link, however, cannot be stopped on your router: the link is full before the packets arrive. That needs the provider (filtering or blackholing upstream) or a scrubbing service.

## Detect in filter, drop in RAW

- psd and connection-limit need connection tracking, so they work in filter.
- Dropping in RAW costs no connection tracking entry and much less CPU.

The **scans and floods** lab replays a real port scan against your rules. The **port scan and connection flood detector** simulator shows the psd weights step by step.
