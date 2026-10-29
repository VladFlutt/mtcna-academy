# Lesson: VPN and PPP basics

A **VPN** (Virtual Private Network) connects private networks or users securely over a public network (Internet, leased line, wireless). RouterOS supports many tunnel types; MTCNA covers the **PPP** family: **PPPoE**, **PPTP**, **L2TP** and **SSTP** (and mentions OpenVPN).

### PPP building blocks

| Item | Menu | Purpose |
|---|---|---|
| **IP pool** | /ip pool | Range of addresses handed to clients (also used by DHCP and HotSpot) |
| **PPP profile** | /ppp profile | Shared settings: local-address, remote-address (pool), DNS, **rate-limit**, only-one, encryption |
| **PPP secret** | /ppp secret | Username, password, service, profile, optional static local/remote address |
| **Server** | /interface pppoe-server server, /interface pptp-server server... | Accepts connections |
| **Client** | /interface pppoe-client, pptp-client, l2tp-client, sstp-client | Connects out |

![A PPP secret: name, password, service, profile and addresses (course slide)](/img/mtcna/na7-15.webp)

Built-in profiles: **default** and **default-encryption**.

    /ip pool add name=ppp-pool ranges=1.1.1.2-1.1.1.200
    /ppp profile add name=5mbit local-address=1.1.1.1 remote-address=ppp-pool \
        rate-limit=5M/5M only-one=yes
    /ppp secret add name=user1 password=pass1 service=pppoe profile=5mbit

Each connected client appears as a dynamic interface and in **PPP > Active Connections**.

# Lesson: PPPoE

**PPPoE** (PPP over Ethernet) runs PPP at **Layer 2** over Ethernet. It is the classic way ISPs connect DSL and Ethernet subscribers: every user has a separate session with **authentication**, **accounting** and the server pushes **IP, gateway and DNS**.

### PPPoE client

    /interface pppoe-client add name=pppoe-out1 interface=ether1 user=class password=class \
        add-default-route=yes use-peer-dns=yes disabled=no

![Laptop, your router as a PPPoE client and the classroom router as the server (course slide)](/img/mtcna/na7-10.webp)

Authentication: pap, chap, mschap1, mschap2. When it is connected the interface shows the **R** (running) flag.

### PPPoE server

    /interface pppoe-server server add service-name=isp interface=ether2 \
        default-profile=5mbit one-session-per-host=yes max-sessions=100 disabled=no

![PPPoE server settings in Winbox (course slide)](/img/mtcna/na7-14.webp)

- Runs on an interface **without** an IP address being needed for clients.
- **keepalive-timeout** (default 10 s) detects dead clients.
- **one-session-per-host** prevents a host from opening several sessions.

### Course labs

- **Lab 6.1**: disable the DHCP client on ether1, create a PPPoE client (user/password *class/class*), check the R flag and Internet access. Remember NAT now has to masquerade out of **pppoe-out1**.
- **Lab 6.2**: disable PPPoE, enable DHCP client again and fix the NAT rule.

# Lesson: PPTP, L2TP and SSTP

### PPTP

- Uses **TCP 1723** for control and **GRE (IP protocol 47)** for data.
- Easy to set up, supported everywhere, but its MS-CHAPv2/MPPE security is **broken**; use only where security is not important.

### L2TP

- Uses **UDP 1701**. L2TP itself has **no encryption**; in practice it is combined with **IPsec** (UDP 500, 4500, ESP). RouterOS can do this automatically: `use-ipsec=yes ipsec-secret=...`.

### SSTP

- PPP over **TLS on TCP 443**: works through almost any firewall. Needs certificates on the server.

### Site-to-site example (from the course)

Office 1: WAN 77.77.77.77/24, LAN 192.168.10.0/24. Office 2: WAN 88.88.88.88/24, LAN 192.168.11.0/24. Tunnel addresses 172.16.1.1 and 172.16.1.2.

![A PPTP tunnel between two offices (course slide)](/img/mtcna/na7-23.webp)

Office 1 (server):

    /interface pptp-server server set enabled=yes authentication=mschap2 default-profile=default-encryption
    /ppp secret add name=office2 password=secret service=pptp local-address=172.16.1.1 remote-address=172.16.1.2
    /ip route add dst-address=192.168.11.0/24 gateway=172.16.1.2

Office 2 (client):

    /interface pptp-client add name=to-office1 connect-to=77.77.77.77 user=office2 password=secret \
        profile=default-encryption disabled=no
    /ip route add dst-address=192.168.10.0/24 gateway=172.16.1.1

Do **not** enable *add-default-route* for site-to-site: add **static routes** to the remote LAN instead.

**Lab 6.6**: in pairs, build a PPTP tunnel between your routers, add the static routes and ping the partner's LAN.

### Comparison

| Tunnel | Transport | Encryption | Notes |
|---|---|---|---|
| PPPoE | Ethernet (L2) | Optional | Same broadcast domain only |
| PPTP | TCP 1723 + GRE | MPPE (weak) | Fast, insecure |
| L2TP | UDP 1701 | via IPsec | Common with phones/Windows |
| SSTP | TCP 443 (TLS) | TLS | Passes firewalls |
| OpenVPN | TCP/UDP 1194 | TLS | UDP since v7 |
| WireGuard | UDP (v7) | Modern crypto | Not PPP, very fast |
