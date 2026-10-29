# Lesson: How DHCP works

**DHCP** (Dynamic Host Configuration Protocol) gives clients an IP address, mask, gateway, DNS servers and other options automatically. It uses **UDP 67** (server) and **UDP 68** (client).

### DORA

1. **Discover**: the client broadcasts "is there a DHCP server?"
2. **Offer**: the server offers an address.
3. **Request**: the client requests the offered address.
4. **Acknowledge**: the server confirms; the lease starts.

![DORA: discover, offer, request, acknowledge](/img/mtctce/dhcp-dora.svg)

The client renews the lease at half of the **lease time**.

> A DHCP server only answers on the interface it is configured on. If the interface is a **bridge port**, the server must be on the **bridge**, not on the port.

# Lesson: DHCP client

The DHCP client is used on the WAN side, typically on ether1:

    /ip dhcp-client add interface=ether1 disabled=no

![A DHCP client on ether1 receives the address, the gateway and DNS from the ISP (course slide)](/img/mtcna/x1-38.webp)

Important options:

- **use-peer-dns** (default yes): accept DNS servers from the server.
- **use-peer-ntp**: accept NTP servers.
- **add-default-route** (default yes): add a default route via the received gateway; **default-route-distance** (default 1).

Check it: `/ip dhcp-client print` shows **status=bound** and the received address. The address appears in `/ip address` with the **D** (dynamic) flag.

# Lesson: DHCP server

### Quick setup

The easiest way is the setup wizard: **IP > DHCP Server > DHCP Setup** or `/ip dhcp-server setup`. It asks for the interface, network, gateway, pool, DNS and lease time.

### What the wizard creates

A DHCP server needs **three** things:

1. An **IP pool**: `/ip pool add name=lan-pool ranges=192.168.88.10-192.168.88.254`
2. A **DHCP server** bound to an interface and the pool: `/ip dhcp-server add name=dhcp1 interface=bridge address-pool=lan-pool disabled=no`
3. A **DHCP network** with the options to hand out: `/ip dhcp-server network add address=192.168.88.0/24 gateway=192.168.88.1 dns-server=192.168.88.1`

And the interface itself must have an IP address in that network (192.168.88.1/24).

### Leases

**IP > DHCP Server > Leases** shows every client. Flags: **D** dynamic, **B** blocked. Click **Make Static** to always give the same address to that MAC, or add one by hand:

    /ip dhcp-server lease add address=192.168.88.50 mac-address=AA:BB:CC:DD:EE:FF

![IP > DHCP Server > Leases: D marks dynamic leases (course slide)](/img/mtcna/x1-52.webp)

Lease **lease-time** default is 30 minutes in v7 (10 minutes in some v6 versions).

### DHCP and ARP

The DHCP server option **add-arp=yes** adds a static ARP entry for each lease. Combined with interface **arp=reply-only**, only hosts that received an address from DHCP can communicate: a simple protection against users configuring static IPs by hand.

### Course labs

**Lab 5.11 (DHCP client)**

1. Remove the static IP from the WAN (ether1) and the default route 0.0.0.0/0.
2. Only the LAN IP on the bridge and one DAC route to your LAN should remain.
3. Add a DHCP client on ether1 and check the received **IP**, **default route** and **DNS**.
4. Check Internet on the laptop.

**Lab 5.12 (DHCP server)**

1. Run the DHCP server on your **bridge** (the LAN interface) with the setup wizard.
2. Set the laptop to *obtain an IP automatically*.
3. Check **Leases**.

The wizard asks in this order: interface, address space, gateway, addresses to give out, DNS servers, lease time. In RouterOS v6 the default lease time is **10 minutes** (v7: 30 minutes). Short leases suit busy guest networks; office networks can use hours or days.

Questions to think about: is more than one DHCP server allowed in one broadcast domain? (No, clients will get random answers: a rogue DHCP server is a classic problem.) At which OSI layer does DHCP work? (Application layer, carried over UDP 67/68.)

# Lesson: ARP

**ARP** maps IP addresses to MAC addresses. See it in **IP > ARP** (`/ip arp print`).

![IP > ARP: the table of IP address, MAC address and interface (course slide)](/img/mtcna/x1-31.webp)

![ARP mode reply-only on an interface: only static ARP entries can talk to the router (course slide)](/img/mtcna/x1-33.webp)

Interface ARP modes:

| Mode | Behaviour |
|---|---|
| **enabled** (default) | Learns and answers ARP normally |
| **disabled** | Does not use ARP; neighbours must have static entries for the router |
| **reply-only** | Answers only for addresses that have **static** ARP entries; new entries are not learned |
| **proxy-arp** | Answers ARP on behalf of hosts in other networks |
| **local-proxy-arp** | Proxy ARP between hosts on the same interface |

    /ip arp add address=192.168.88.20 mac-address=11:22:33:44:55:66 interface=bridge
    /interface bridge set bridge arp=reply-only

From the course:

- An ARP entry holds **IP address, MAC address and interface**.
- Right click a dynamic entry and choose **Make Static** to pin it.
- The maximum number of ARP entries is **8192** by default (IP > Settings, *max-arp-entries* in v7).
- With **arp=reply-only** the router only answers ARP and does not add entries to its table; neighbours must be added as static entries in /ip arp. With **arp=disabled** you also have to add the router's MAC to the ARP tables of the other hosts.

# Lesson: DNS on the router

RouterOS has a caching DNS server:

    /ip dns set servers=8.8.8.8,1.1.1.1 allow-remote-requests=yes

![IP > DNS: with allow-remote-requests the router answers DNS on UDP and TCP 53, so filter it from the WAN (course slide)](/img/mtcna/x1-11.webp)

- **allow-remote-requests=yes** lets LAN clients use the router as DNS (give the router IP as DNS in DHCP).
- If you enable it, **block** UDP/TCP 53 from the WAN in the firewall input chain, or the router becomes an open resolver.
- Static entries: `/ip dns static add name=router.lan address=192.168.88.1`
