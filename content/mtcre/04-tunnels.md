# Lesson: Point-to-point addressing

A link between two routers needs addresses on both ends. The usual choice is a /30: four addresses, of which two are usable (network, router A, router B, broadcast).

    R1: /ip address add address=10.0.12.1/30 interface=ether1
    R2: /ip address add address=10.0.12.2/30 interface=ether1

Half of the addresses are wasted, which matters with public addresses and with hundreds of tunnels.

## /32 addresses with network=

RouterOS can put a /32 address on a point-to-point interface and name the other end with `network=`:

    R1: /ip address add address=10.1.1.1/32 network=10.1.1.2 interface=ipip1
    R2: /ip address add address=10.1.1.2/32 network=10.1.1.1 interface=ipip1

RouterOS creates a connected route to the single address 10.1.1.2/32 through that interface. Only one address per side is used, and a hub router can even use **the same address** on all its tunnels: each tunnel has its own `network=` (the spoke's address).

![The same hub address 10.1.1.1/32 on three tunnels, each pointing at a different spoke (course slide)](/img/mtcre/re-p2p-32.webp)

This is exactly how PPP works: a PPP server gives its side a local address and the client a remote address, and both appear as /32 addresses with the peer's address as the network. The course lab asks you to replace the /30 tunnel addresses with /32 addresses and check that routing still works.

Also possible: **unnumbered** links (an interface as gateway, the router uses its loopback address as source). And VLANs, next lesson, let one cable carry many such links.

> RouterOS 6 and 7 use the same syntax for `network=`.

# Lesson: VLANs between routers

A VLAN splits one physical link into several logical ones. Each Ethernet frame gets a 4-byte **802.1Q tag** with a 12-bit **VLAN ID** (1 to 4094; 0 and 4095 are reserved). Both ends must use the same VLAN ID on the same cable.

    /interface vlan add name=vlan10 vlan-id=10 interface=ether1
    /ip address add address=10.10.10.1/30 interface=vlan10

The VLAN interface behaves like a normal Ethernet interface: it gets addresses, routes and firewall rules. Between routers it is the cheapest way to get several separated links (transit, management, customer) over one cable, or to connect to a provider that hands over services on different VLANs.

- The tag uses 4 bytes of the **L2 MTU**. RouterBOARD Ethernet ports have an L2 MTU larger than 1500, so a VLAN interface keeps an IP MTU of 1500.
- A VLAN interface is put on the physical port, or on a bridge if the bridge carries tagged traffic (bridge VLAN filtering is a switching topic, covered in MTCSWE).
- VLAN 1 is often the untagged default on switches; avoid using it for tagged links.

In the **VLAN** lab you carry two VLANs between two routers over a single cable: VLAN 10 with a /30 for the transit route, VLAN 99 with /32 point-to-point addresses for management.

# Lesson: IPIP and GRE tunnels

A tunnel puts a packet inside another packet so that it can cross a network that does not know its addresses. Two offices with private LANs (192.168.10.0/24, 192.168.20.0/24) connected over the Internet are the classic case: the Internet routers have no routes to private networks, but they do route between the offices' public addresses.

The tunnels in this module are **stateless**: the endpoints do not negotiate anything, they just encapsulate. That makes them simple and fast, but also unencrypted and unauthenticated.

| | IPIP | GRE | EoIP |
|---|---|---|---|
| Carries | IPv4 only | any L3 protocol (IP, multicast for OSPF) | Ethernet frames (layer 2) |
| Protocol | IP protocol 4 (RFC 2003) | IP protocol 47 (RFC 1701/2784) | GRE (MikroTik proprietary) |
| Overhead | 20 bytes | 24 bytes | 42 bytes |
| Default MTU in RouterOS | 1480 | 1476 | 1458 (actual MTU) |
| Can be bridged | no | no | yes |

## Configuration

Both ends point at each other's public address:

    HQ: /interface gre add name=gre-br local-address=22.1.1.2 remote-address=33.1.1.2
    BR: /interface gre add name=gre-hq local-address=33.1.1.2 remote-address=22.1.1.2
    HQ: /ip address add address=172.16.0.1/30 interface=gre-br
    BR: /ip address add address=172.16.0.2/30 interface=gre-hq
    HQ: /ip route add dst-address=192.168.20.0/24 gateway=172.16.0.2
    BR: /ip route add dst-address=192.168.10.0/24 gateway=172.16.0.1

IPIP is identical with `/interface ipip`.

![GRE between two sites in Winbox; with an IPsec secret on both sides RouterOS adds transport-mode IPsec automatically (course slide)](/img/mtcre/re-gre-winbox.webp)

## keepalive

Without keepalive a stateless tunnel is always *running*, even when the other end is gone, so routes through it stay active. With `keepalive=10s,10` the router sends a keepalive every 10 seconds and sets the tunnel down after 10 missed answers. Then routes through the tunnel become inactive, and a backup route (or OSPF) can take over. RouterOS adds a keepalive by default on new GRE and IPIP tunnels; check that the far end answers it.

## Security

GRE and IPIP are not encrypted. `ipsec-secret=` on both ends makes RouterOS build a transport-mode IPsec policy for the tunnel automatically (dynamic peer and policy, pre-shared key). For anything over the Internet, use it, or use WireGuard.

## MTU and fragmentation

The tunnel adds a header, so a full-size 1500-byte packet from the LAN no longer fits into a 1500-byte Internet link. It must be fragmented, or dropped if the *don't fragment* bit is set; then large downloads stall while small pages work. Clamp TCP MSS for traffic into the tunnel:

    /ip firewall mangle add chain=forward protocol=tcp tcp-flags=syn out-interface=gre-br \
        action=change-mss new-mss=clamp-to-pmtu passthrough=yes

![Header overhead per tunnel type](/img/mtcre/tunnel-encap.svg)

Use the **Tunnel overhead and MTU** simulator to stack encapsulations (for example GRE over PPPoE with IPsec) and see the MTU that is left.

## The recursive routing trap

The tunnel's remote address must be reached **outside** the tunnel. If you add a route to the remote public address through the tunnel itself (often by accident, with a summary or a default route through the tunnel), the tunnel packets try to go through the tunnel, the tunnel goes down, the route disappears, the tunnel comes up… RouterOS logs this as a recursive routing problem. Keep a specific route to the far end's public address through the real uplink.

# Lesson: EoIP: layer 2 over IP

**Ethernet over IP** is MikroTik's own tunnel. It carries whole Ethernet frames, so the tunnel interface can be added to a bridge: both sites share one broadcast domain, one subnet, even one DHCP server.

    HQ: /interface eoip add name=eoip-br local-address=22.1.1.2 remote-address=33.1.1.2 tunnel-id=10
    BR: /interface eoip add name=eoip-hq local-address=33.1.1.2 remote-address=22.1.1.2 tunnel-id=10
    both: /interface bridge add name=br-lan
          /interface bridge port add bridge=br-lan interface=ether5
          /interface bridge port add bridge=br-lan interface=eoip-...

- **tunnel-id** must be the same on both ends and unique between the same pair of addresses; it lets several EoIP tunnels run between the same two routers.
- EoIP interfaces have a MAC address (generated); keep them unique if you clone configurations.
- MTU: 1500-byte Ethernet frames plus 42 bytes of headers do not fit a 1500-byte uplink; RouterOS fragments the outer packets. That works but costs performance; clamp MSS where you can.
- Layer 2 over a WAN carries broadcasts and ARP across the link, and a second bridged path can create a loop. Bridge only where you really need one subnet on two sites (legacy devices, moving virtual machines); otherwise route.

![EoIP with the tunnel bridged to the LAN on both routers: one subnet 192.168.1.0/24 on two sites (course slide)](/img/mtcre/re-eoip-winbox.webp)

Like GRE, EoIP supports `keepalive` and `ipsec-secret`.

# Lesson: WireGuard (RouterOS 7)

WireGuard is a modern encrypted tunnel built into RouterOS 7. It uses UDP, fixed modern cryptography (Curve25519, ChaCha20-Poly1305, BLAKE2s) and a very small code base. There is nothing to negotiate: each side has a key pair, and each side knows the other's public key.

    HQ: /interface wireguard add name=wg1 listen-port=13231
    BR: /interface wireguard add name=wg1 listen-port=13231
        /interface wireguard print          (shows the public-key to copy)

Creating the interface generates the private and public key. Then each router gets a **peer** for the other:

    HQ: /interface wireguard peers add interface=wg1 public-key="<BR public key>" \
            endpoint-address=33.1.1.2 endpoint-port=13231 allowed-address=10.255.255.2/32,192.168.20.0/24
    BR: /interface wireguard peers add interface=wg1 public-key="<HQ public key>" \
            allowed-address=10.255.255.1/32,192.168.10.0/24

![Each router's public key goes into the peer on the other router (course slide)](/img/mtcre/re-wg-keys.webp)

## allowed-address

`allowed-address` is the heart of WireGuard. For a peer it lists the addresses that may be **sent to** that peer and **accepted from** it. A packet from the tunnel with a source outside the list is dropped; a packet routed into wg1 with a destination outside every peer's list is dropped too. With several peers on one interface, allowed-address decides which peer gets which packet.

You still need routes: allowed-address does not create routes in RouterOS. Route the remote LAN into the WireGuard interface:

    HQ: /ip address add address=10.255.255.1/30 interface=wg1
    HQ: /ip route add dst-address=192.168.20.0/24 gateway=10.255.255.2

## endpoint and persistent-keepalive

At least one side needs `endpoint-address` (where to send). The other side learns the endpoint from the first valid packet, which is how a branch behind NAT with a dynamic address connects to a fixed HQ. Set `persistent-keepalive=25s` on the side behind NAT so that the NAT mapping stays open.

## MTU

WireGuard adds 60 bytes over IPv4 (80 over IPv6); the default interface MTU is 1420.

> **RouterOS 6** has no WireGuard. Use IPsec, or GRE/IPIP/EoIP with ipsec-secret.

Build all three tunnel types in the labs. Then compare: GRE needs a public address on both ends and is unencrypted; WireGuard works behind NAT and is encrypted; EoIP is the only one that gives you layer 2.
