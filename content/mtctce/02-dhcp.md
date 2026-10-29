# Lesson: DORA, leases and timers

The **Dynamic Host Configuration Protocol** gives a device its address and everything it needs to use the network. A client without an address talks to the server with broadcasts: from 0.0.0.0, UDP port 68, to 255.255.255.255, UDP port 67.

![The four messages of DORA and the lease timers](/img/mtctce/dhcp-dora.svg)

1. **DISCOVER**: the client asks every server on the segment for an address.
2. **OFFER**: each server that may answer offers an address and the options.
3. **REQUEST**: the client picks one offer (normally the first) and requests it, again by broadcast, so the other servers learn they were not chosen.
4. **ACK**: the chosen server confirms. The client checks with ARP that nobody else uses the address and starts using it.

Other messages:

| Message | From | Meaning |
|---|---|---|
| NAK | server | "this address is not valid here", the client starts again with DISCOVER |
| DECLINE | client | the offered address is already used by someone (the ARP check answered) |
| RELEASE | client | the client gives the address back |
| INFORM | client | a client with a static address asks only for options |

## Lease timers

An address is **leased** for a time (RouterOS default: 30 minutes in v7, 10 minutes in old v6 defaults; check `lease-time`).

- At **T1 = 50%** of the lease the client **renews**: a unicast REQUEST to its server.
- If the server does not answer, at **T2 = 87.5%** it **rebinds**: a broadcast REQUEST to any server.
- At 100% the lease is gone and the client starts with DISCOVER.

Short leases move addresses faster between devices (cafés, guest Wi-Fi); long ones reduce traffic and survive a short server outage.

## Client identity

The server recognises a client by its **client identifier** (option 61) or, if the client sends none, its MAC address. Option 12 carries the host name; RouterOS sends its system identity by default.

# Lesson: The DHCP client in RouterOS

    /ip dhcp-client add interface=ether1 use-peer-dns=yes use-peer-ntp=yes add-default-route=yes

- **use-peer-dns**, **use-peer-ntp**: take the DNS and NTP servers from the server's answer.
- **add-default-route**: `yes` installs a default route through the received gateway (with `default-route-distance`, 1 by default), `no` does not, and `special-classless` installs both the option 121 routes and the default route from option 3.
- **dhcp-options**: which options the client sends (hostname and clientid by default).
- **script**: runs on every bound and unbound event, with variables such as `$bound`, `$"lease-address"` and `$"gateway-address"`. A typical use is changing a recursive route or a NAT rule when the provider changes the address.

The client asks the server for options 1 (mask), 3 (router), 6 (DNS), 15 (domain), 33 (static routes), 42 (NTP) and 121 (classless routes). When a server sends option 121, a standard client **ignores option 3**, so the server must include the default route in option 121 itself.

# Lesson: Server, networks and options

A DHCP server in RouterOS needs four things:

    /ip address add address=192.168.33.1/24 interface=bridgeLAN
    /ip pool add name=lan-pool ranges=192.168.33.10-192.168.33.254
    /ip dhcp-server add name=dhcp1 interface=bridgeLAN address-pool=lan-pool lease-time=1h
    /ip dhcp-server network add address=192.168.33.0/24 gateway=192.168.33.1 dns-server=192.168.33.1 domain=lab.local ntp-server=192.168.33.1

- **One server per interface** (or per relay). The interface needs an address in the network it serves.
- **Pool**: the dynamic range. `next-pool` chains another pool when this one is full. Static leases (`/ip dhcp-server lease make-static`) may be outside the pool.
- **Network**: the options for the clients of that subnet. The server picks the network entry that contains the address it gives out.

| Option | Code | Field in /ip dhcp-server network |
|---|---|---|
| subnet mask | 1 | netmask (taken from address) |
| router (gateway) | 3 | gateway |
| DNS servers | 6 | dns-server |
| domain name | 15 | domain |
| NTP servers | 42 | ntp-server |
| WINS | 44 | wins-server |
| TFTP / boot file | 66 / 67 | next-server, boot-file-name |

## Custom options

Anything else is defined in `/ip dhcp-server option` and attached to a network:

    /ip dhcp-server option add name=tftp code=66 value="'10.0.0.5'"
    /ip dhcp-server network set [find address=192.168.33.0/24] dhcp-option=tftp

The value is hex (`0x…`), a string in single quotes, or an address; several options are grouped with `/ip dhcp-server option sets` and attached with `dhcp-option-set`.

## Option 121: classless static routes

Option 121 (RFC 3442) hands the client routes. Each route is encoded as:

1. one byte: the prefix length;
2. only the **significant octets** of the destination (a /16 needs 2, a /24 needs 3, a /0 none);
3. four bytes: the gateway.

![How 0x100A270A260101 decodes to 10.39.0.0/16 via 10.38.1.1](/img/mtctce/opt121.svg)

A LAN with a lab network 10.10.0.0/16 behind 192.168.33.254, and the main router 192.168.33.1:

    10.10.0.0/16 via 192.168.33.254  → 10 0A 0A C0 A8 21 FE
    0.0.0.0/0    via 192.168.33.1    → 00 C0 A8 21 01

    /ip dhcp-server option add name=classless code=121 value=0x100A0AC0A821FE00C0A82101
    /ip dhcp-server network set [find address=192.168.33.0/24] dhcp-option=classless

Use the **option 121 encoder** simulator instead of counting bytes by hand. Windows also understands the older Microsoft option 249 with the same format.

# Lesson: Two servers, authoritative and rogue servers

## Primary and backup

Two DHCP servers on one LAN make addresses available when one of them fails, but they must not hand out the same addresses: give each its own part of the range. To make one of them the backup, use **delay-threshold**:

    /ip dhcp-server set dhcp1 delay-threshold=5s

A client writes into each DHCP packet (the *secs* field) how long it has been trying. A server with delay-threshold ignores requests whose secs value is lower. While the primary answers within the first second, the backup stays silent; if the primary is down, the client keeps trying and after 5 seconds the backup answers. On a relay, delay-threshold works the same way.

## authoritative

| Value | Behaviour |
|---|---|
| yes | the server answers clients it has no lease for: a REQUEST for an unknown address gets a NAK, so the client restarts quickly |
| no | requests for unknown leases are ignored; the client waits for its own server |
| after-2sec-delay, after-10sec-delay | the server waits that long before claiming such a client |

`yes` is right when this is the only server, for example after renumbering a network: clients holding old addresses are pushed to new ones at once. With a second server on the LAN, `yes` on both would make them NAK each other's clients; the backup should use `no` or an after-delay value.

## Rogue DHCP servers

A home router plugged in backwards, or an attacker, can start a second DHCP server on your LAN. Clients that take its offer get a wrong gateway and DNS: at best no Internet, at worst a man-in-the-middle. RouterOS detects foreign servers:

    /ip dhcp-server alert add interface=bridgeLAN valid-server=00:0C:42:11:22:33 alert-timeout=1h on-alert=":log warning \"rogue DHCP server\""

- **valid-server**: the MAC addresses of the servers that are allowed; the router's own server is always valid.
- When another server answers on the interface, the router logs "discovered unknown dhcp server" and runs **on-alert** (a script, for example sending an e-mail).
- Detection is not blocking. To block, use DHCP snooping with trusted ports on switches (MTCSWE) or bridge filters that drop UDP 67 from untrusted ports.

The **backup DHCP** lab sets up the backup role and the alert.

# Lesson: DHCP relay

DHCP DISCOVER is a broadcast, and routers do not forward broadcasts. A branch or a VLAN without its own server therefore needs a **relay**: a router that receives the client's broadcast and forwards it as unicast to a server in another network.

![The relay forwards the client's broadcast as unicast and the server chooses the pool by the relay address](/img/mtctce/dhcp-relay.svg)

On the relay:

    /ip dhcp-relay add name=to-hq interface=bridgeLAN dhcp-server=22.1.1.10 local-address=192.168.33.1 disabled=no

- **interface**: where the clients are.
- **dhcp-server**: the server's address (several can be listed).
- **local-address**: the relay's address on the clients' network. It is written into the packet as the *gateway address* (giaddr), and the server answers to it.
- **add-relay-info=yes** adds option 82 (relay agent information) with the circuit and the relay, so the server can tell clients on different ports apart.
- An interface either has a DHCP server or a relay, not both.

On a RouterOS server the relayed network is a server of its own, bound to the relay address:

    /ip pool add name=branch33 ranges=192.168.33.10-192.168.33.254
    /ip dhcp-server add name=branch33 interface=ether1 relay=192.168.33.1 address-pool=branch33 disabled=no
    /ip dhcp-server network add address=192.168.33.0/24 gateway=192.168.33.1 dns-server=192.168.33.1

The server must have a route back to 192.168.33.0/24, and the firewalls in between must pass UDP 67 in both directions. The **DHCP relay** lab configures the branch side.
