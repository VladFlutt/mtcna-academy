# Lesson: NAT in depth

**Network address translation** changes the addresses (and ports) of a connection. Connection tracking remembers the translation and applies the reverse to every reply, so only the first packet of a connection goes through the NAT rules.

| Chain | Where | Actions | Matches |
|---|---|---|---|
| srcnat | postrouting, after routing | masquerade, src-nat, netmap, same | out-interface (in-interface is not allowed) |
| dstnat | prerouting, before routing | dst-nat, redirect, netmap | in-interface (out-interface is not known yet) |

## src-nat and masquerade

    /ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade
    /ip firewall nat add chain=srcnat out-interface=ether1 action=src-nat to-addresses=22.1.1.33

- **masquerade** takes the address of the out-interface for each new connection, and drops the connections when the interface goes down. Use it with dynamic addresses (DHCP, PPPoE).
- **src-nat** uses the address you give. With a fixed public address it is cheaper and connections survive a short link flap.

## dst-nat and redirect

    /ip firewall nat add chain=dstnat dst-address=22.1.1.33 protocol=tcp dst-port=9999 action=dst-nat to-addresses=192.168.33.10 to-ports=8888

- **dst-nat** sends the connection to another host (port forwarding); `to-ports` also changes the port.
- **redirect** sends it to the router itself (DNS, proxy).

## The filter rule behind a port forward

dstnat runs in prerouting, before the filter forward chain. A forward rule therefore sees the server's **private** address and **new** port:

    /ip firewall filter add chain=forward src-address=212.0.200.2 dst-address=192.168.33.10 protocol=tcp dst-port=8888 action=drop

A rule with dst-address=22.1.1.33 dst-port=9999 in forward never matches. The safe default forward rule `drop connection-state=new connection-nat-state=!dstnat in-interface-list=WAN` lets the forwarded connections in and drops everything else from the WAN.

## Hairpin NAT

Users in the LAN open the server by its public address, 22.1.1.33:9999. Two things go wrong:

1. A dst-nat rule with `in-interface=ether1` does not match traffic from the LAN. Match the public address instead (`dst-address=22.1.1.33`, or `dst-address-type=local`).
2. Then the server, in the same LAN as the client, answers the client **directly** from its private address. The client expects an answer from 22.1.1.33 and drops it.

The fix is a masquerade for LAN → server, so the server answers the router:

    /ip firewall nat add chain=srcnat src-address=192.168.33.0/24 dst-address=192.168.33.10 protocol=tcp dst-port=8888 out-interface=bridgeLAN action=masquerade

## netmap

`netmap` translates a whole subnet one to one to another subnet of the same size, for example to connect two offices that both use 192.168.1.0/24.

The **port forwarding** lab builds the dst-nat, the forward rule and the hairpin.

# Lesson: Marks: connection, packet and routing

The mangle table changes packets or attaches **marks** that exist only inside the router:

| Mark | Set with | Used by |
|---|---|---|
| connection mark | mark-connection | other mangle rules (`connection-mark=`) |
| packet mark | mark-packet | queue trees and simple queues (`packet-mark=`, `packet-marks=`) |
| routing mark | mark-routing | policy routing: selects a routing table (MTCRE) |

A packet carries **at most one** of each: a second mark-packet replaces the first.

![Connection marks are set once; packet marks feed the queues, routing marks choose a routing table](/img/mtctce/marks.svg)

## Mark the connection first

Classifying a packet can be expensive (address lists, connection-bytes, layer 7, content). Do it once per connection, then mark every packet by the connection mark, which is a cheap comparison:

    /ip firewall mangle add chain=prerouting connection-state=new src-address=192.168.33.50 action=mark-connection new-connection-mark=voip-conn passthrough=yes
    /ip firewall mangle add chain=prerouting connection-mark=voip-conn action=mark-packet new-packet-mark=voip passthrough=no

- The first rule only sees new connections; connection tracking then carries the mark for **both directions**.
- The second rule marks every packet of those connections and stops (`passthrough=no`).

## passthrough

After a mangle rule acts, the packet continues to the next rules of the chain only if `passthrough=yes` (the default). With `passthrough=no` it leaves the chain. Use `no` on the last rule that sets the mark you want, so a later rule cannot overwrite it and the CPU skips the remaining rules. `action=accept` in mangle does the same without marking: mangle never drops packets.

## Where to mark

- **Routing marks** in prerouting (or output for the router's own traffic): later is too late for routing.
- **Packet marks for interface queues** anywhere before postrouting ends.
- **Marks for a global tree** must tell upload from download: use `out-interface` in forward or postrouting (out WAN = upload, out LAN = download), or `in-interface` in prerouting.

# Lesson: Changing packets: DSCP, TTL, MSS and more

| Action | Effect |
|---|---|
| change-dscp new-dscp=46 | set DSCP (0 to 63), for example EF for voice so that the provider or the next router can prioritise it |
| change-ttl new-ttl=set:65 / increment:1 / decrement:1 | change TTL |
| change-mss new-mss=1360 / clamp-to-pmtu | lower the TCP MSS in SYN packets |
| set-priority new-priority=… | set the internal priority (used by WMM and VLAN priority) |
| strip-ipv4-options | remove IP options |
| sniff-tzsp | send a copy of the packet to a TZSP receiver (Wireshark) |
| add-src/dst-to-address-list | as in filter |

## DSCP for voice

The course lab marks the voice traffic of a phone: RTP with DSCP 46 (EF, TOS 0xB8) and SIP signalling with 26 (AF31, TOS 0x68), everything else 0:

    /ip firewall mangle add chain=postrouting packet-mark=voip protocol=udp dst-port=10000-20000 action=change-dscp new-dscp=46
    /ip firewall mangle add chain=postrouting packet-mark=voip protocol=udp dst-port=5060 action=change-dscp new-dscp=26

DSCP only helps where others honour it: your own queues (`dscp=46` matcher), your provider's network if agreed, and Wi-Fi WMM.

## MSS clamping

Tunnels and PPPoE lower the MTU. If ICMP "fragmentation needed" is lost on the way, large TCP packets disappear and pages hang. Clamping the MSS in the SYN packets makes both sides send small enough segments from the start:

    /ip firewall mangle add chain=forward protocol=tcp tcp-flags=syn action=change-mss new-mss=clamp-to-pmtu passthrough=yes

## TTL

Each router decreases the TTL by one. Changing it can hide a router from traceroute, or make traffic of devices behind a NAT look like it comes from the router itself (some providers detect connection sharing by a TTL that is one lower). Know the technique and follow your provider's terms.

## What to mark: a plan from the course

| Class | Examples | Matchers | Priority |
|---|---|---|---|
| essential | DNS, ICMP, SSH, small HTTP/HTTPS requests | protocol, ports, `connection-bytes=0-500000` | 1 |
| user requests | interactive web | ports 80, 443 | 3 |
| communication | VoIP, video calls | ports, DSCP, address of the phone | 5 |
| downloads | big HTTP/HTTPS transfers | `connection-bytes=500000-0` | 7 |
| peer to peer | everything unclassified | the rest | 8 |

`connection-bytes=500000-0` matches connections that have transferred more than 500 kB: a web page loads fast, a long download falls into a low class.

The **VoIP marks** lab builds the connection and packet marks, DSCP and MSS clamping.
