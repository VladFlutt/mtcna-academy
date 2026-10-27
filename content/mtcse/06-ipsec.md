# Lesson: What IPsec is

> This module follows the MTCSE course slides, chapter 6 "IPsec".

### One sentence first

**IPsec** (Internet Protocol Security) is a set of protocols that protects data sent over IP. It can **authenticate** the sender, check the **integrity** of every packet and **encrypt** it.

Four facts from the slides worth remembering:

- It was designed for **IPv6** and later added to **IPv4**. RouterOS supports both.
- It is a **standard**, described in a family of RFCs: RFC 4301 (architecture), RFC 4302 (AH), RFC 4303 (ESP), RFC 2408 (ISAKMP), RFC 5996 (IKEv2), RFC 4835 (algorithms) and more.
- It works at the **network layer**, on IP itself.
- Because of that, it can protect **any** protocol that runs over IP, TCP and UDP alike, and applications do not even notice it.

### Where it sits compared with other secure channels

| OSI layer | Secure channel protocol |
|---|---|
| Application | S/MIME |
| Presentation | SSL, TLS |
| Session | PPTP |
| Transport | AH, ESP |
| Network | IPsec |
| Data link | PPP |
| Physical | — |

Compare it with TLS: TLS protects one application connection (your browser to one website). IPsec protects **everything** between two IP addresses or two networks, whatever the applications are.

### What it gives you

The three properties on the slides:

- **Confidentiality**: the data is **encrypted**.
- **Integrity**: the routers at each end of the tunnel compute a **checksum or hash** of the data, so any change on the way is detected.
- **Authentication**: the peers prove who they are with **keys, signatures and certificates**.

These are exactly the properties from module 1, and the building blocks from module 4: a symmetric cipher for confidentiality, an HMAC for integrity, a pre-shared key or a certificate for authentication, and Diffie-Hellman to agree on the keys.

### The architecture: one policy, three protocols

The slides draw IPsec as an **IPsec security policy** that uses three protocols:

| Protocol | Full name | Job |
|---|---|---|
| **AH** | Authentication Header | Protects the data: authentication and integrity, **no encryption** |
| **ESP** | Encapsulating Security Payload | Protects the data: encryption **plus** authentication and integrity |
| **IKE** | Internet Key Exchange | Agrees on the keys and parameters, and authenticates the peers |

So there are two groups: **AH and ESP protect the traffic**, **IKE sets up the keys** they use. The **policy** decides which packets get protected at all.

### AH, step by step

- **AH** proves that the packet came from the peer and that **not a single bit** of the protected part changed on the way.
- It was designed **only for integrity**. It does **not** encrypt: anyone on the path can still read the data.
- It is **IP protocol 51**, described in **RFC 4302**.
- RouterOS supports **SHA1, SHA2 and MD5** for AH.

AH also covers parts of the outer IP header. That is why **AH does not work through NAT**: NAT changes the address, and the receiver sees a modified packet.

### ESP, step by step

- **ESP** gives everything AH gives, **plus confidentiality**.
- It encrypts with a **symmetric key**.
- It is **IP protocol 50**, described in **RFC 4303**.
- RouterOS ESP authentication: **MD5, SHA1, SHA2 (256 and 512 bit)**.
- RouterOS ESP encryption: **AES** 128/192/256 (CBC, CTR and GCM), Blowfish, Twofish, Camellia, and the old **DES** and **3DES**.

ESP is the one you will use almost every time. Pick AES with SHA256 (or AES-GCM, which does both at once) and leave DES, 3DES and MD5 alone.

### What each one protects in the packet

Start from a normal packet: `IP | TCP | Data`.

**With AH:** `IP | AH header | TCP | Data`. The whole packet is **authenticated**, nothing is encrypted.

**With ESP:** `IP | ESP header | TCP | Data | ESP trailer | ESP auth`.

- `TCP | Data | ESP trailer` is **encrypted**.
- `ESP header` up to the trailer is **authenticated**.
- The outer `IP` header is **not** protected by ESP, which is exactly why ESP can pass through NAT (wrapped in UDP 4500, see NAT-T).

# Lesson: Transport mode and tunnel mode

### Two ways to use AH or ESP

IPsec runs in one of two modes, and choosing the wrong one is the most common design mistake.

| | **Transport mode** | **Tunnel mode** |
|---|---|---|
| What is protected | Only the **payload** of the IP packet | The **whole original packet**, header included |
| IP header | The **original** header is kept | A **new** outer IP header is added |
| New packet created | No | Yes, the original is encapsulated |
| Typical use | Host to host, or protecting another tunnel (L2TP, GRE, IPIP, EoIP) | Network to network (site to site), remote computers into a VPN |

### Transport mode, layer by layer

1. Transport layer: `TCP | Data`.
2. IPsec adds its header, and `TCP | Data` becomes **encrypted**: `IPsec | TCP | Data`.
3. The network layer puts the **original** IP header in front: `IP | IPsec | TCP | Data`.
4. The link layer frames it: `PPP | IP | IPsec | TCP | Data | PPP`.

Three consequences from the slides:

- The original IP header is used.
- The addresses of the end devices stay unchanged.
- No new packet is created.

### Tunnel mode, layer by layer

1. Network layer: `IP | TCP | Data`, the whole original packet.
2. IPsec encrypts **all of it**, header included: `IPsec | IP | TCP | Data`.
3. A **new IP header** is put in front: `New IP | IPsec | IP | TCP | Data`.
4. The link layer frames it: `PPP | New IP | IPsec | IP | TCP | Data | PPP`.

This is **encapsulation**: the original packet, with its private addresses, travels inside a new packet between the two public addresses.

With ESP the difference looks like this:

    Transport:  IP HDR     | ESP HDR | Data          | ESP Trailer | ESP Auth
    Tunnel:     New IP HDR | ESP HDR | IP HDR | Data | ESP Trailer | ESP Auth

In tunnel mode the original IP header is inside the encrypted part, so nobody on the Internet even sees which hosts are talking.

### Walk the slide example: which mode do two offices need?

The slide topology:

- **Left office**: LAN 192.168.1.0/24, PC 192.168.1.2, router WAN 2.2.2.2/30, default route via 2.2.2.1.
- **Right office**: LAN 192.168.2.0/24, PC 192.168.2.2, router WAN 3.3.3.2/30, default route via 3.3.3.1.

**Step 1: routing without IPsec.** The PC sends `DATA | TCP | IP src 192.168.1.2 dst 192.168.2.2`. The left router has only a default route to the Internet, so it sends the packet there. The Internet has no idea where 192.168.2.0/24 is: private addresses are not routed. **The packet is lost.**

**Step 2: the wrong schema, transport mode.** The slide marks this in red. In transport mode the router keeps the **original** header, so the packet on the Internet is still `IP src 192.168.1.2 dst 192.168.2.2`, only the payload is encrypted. It is still not routable. Transport mode is for traffic **whose source and destination are the peers themselves** (hosts, or the routers talking to each other), not for whole LANs behind them.

**Step 3: tunnel mode, the right answer.** The left router encrypts the whole original packet and adds a **new header `src 2.2.2.2 dst 3.3.3.2`**. That packet crosses the Internet without trouble. The right router removes the outer header, decrypts, and finds the original `192.168.1.2 → 192.168.2.2` packet, which it delivers into its LAN.

**Step 4: when transport mode is right.** If the two routers first build another tunnel between their public addresses (for example L2TP between 2.2.2.2 and 3.3.3.2) and route the LANs over it, then every packet IPsec sees already has the routers' own addresses as source and destination. Transport mode then simply encrypts that tunnel, and no extra header is needed. That is scenario 2 later in this module.

> **The rule of thumb:** LAN to LAN through two routers → **tunnel mode**. Traffic that starts and ends on the IPsec peers themselves (including another tunnel between them) → **transport mode**.

# Lesson: IKE, security associations and the two phases

### Two groups of protocols

- **AH, ESP**: protect the data.
- **IKE** (Internet Key Exchange): manages the keys.

### What IKE does

From the slides, IKE has to let the two peers:

- **authenticate** each other;
- **generate and exchange** shared keys over a public network, without ever sending the key itself;
- agree on **which traffic** to protect (from which sender to which receiver);
- agree on **which protocols** to use for encryption and which for authentication;
- set up the **SAs** (security associations) and define the security parameters.

IKE uses **UDP port 500**. When there is NAT between the peers, it moves to **UDP 4500** (NAT traversal), and ESP is wrapped in the same UDP 4500.

IKEv1 has **two modes** for the first phase and **three authentication methods**:

- Modes: **main mode** (6 messages, identities are protected) and **aggressive mode** (3 messages, faster, but the identity is sent before encryption is up; avoid it with pre-shared keys).
- Authentication: **pre-shared key**, **public key encryption**, **public key signature** (certificates).

### Security association (SA)

**SA** is the IPsec word for a connection. The slides list its properties:

- An SA is **one-directional**. Data must flow both ways, so SAs are always created **in pairs**.
- One pair is created **for each protocol** in use: one pair for AH, one pair for ESP.
- Each SA has a unique number, the **SPI** (Security Parameter Index), so the receiver knows which SA, and therefore which key, a packet belongs to.
- The SAs are stored on **both** peers. **If your router has SAs, the tunnel came up.**
- IKE creates SAs **automatically**.

An SA holds: the SPI, the destination address, the security protocol (AH or ESP), the algorithms, the authentication, key exchange and encryption methods, the mode (transport or tunnel) and timers such as the lifetime.

### Phase 1 and phase 2

IKE works in two phases.

**Phase 1** builds a secure channel **between the two IKE daemons**:

- It creates the **ISAKMP SA**, also called the **IKE SA** or phase 1 SA.
- It uses main mode or aggressive mode.
- It authenticates the peers with certificates or a pre-shared secret.
- Parameters agreed: **authentication method, DH group, encryption algorithm, exchange mode, hash algorithm, NAT-T, DPD and lifetime**.

**Phase 2** uses that channel to agree on the protection for **user traffic**:

- It creates the **IPsec SAs** (phase 2 SAs), one pair per protocol.
- Parameters agreed: **IPsec protocol (ESP or AH), mode (tunnel or transport), authentication algorithm, PFS (DH) group, lifetime**.
- When phase 2 finishes correctly, phase 2 SAs appear, and the tunnel counts as **established**.

### The simple schema in four steps

1. **Traffic that needs protection** arrives at the first peer and matches a policy.
2. **IKE phase 1**: the peers authenticate and build a secure communication channel.
3. **IKE phase 2**: over that channel they negotiate the IPsec SAs, which is the IPsec tunnel.
4. **Secure traffic exchange**: ESP (or AH) packets flow with the keys from phase 2.

### Where each phase lives in RouterOS

| What | Phase | RouterOS menu |
|---|---|---|
| Where the other peer is, exchange mode, passive | 1 | `/ip ipsec peer` |
| How the peer authenticates (PSK, certificate, EAP) | 1 | `/ip ipsec identity` |
| Hash, encryption, DH group, NAT-T, DPD, lifetime | 1 | `/ip ipsec profile` |
| Which traffic is protected, tunnel or transport | 2 | `/ip ipsec policy` |
| ESP algorithms, PFS group, lifetime | 2 | `/ip ipsec proposal` |
| Is phase 1 up? | 1 | `/ip ipsec active-peers` |
| Are the SAs installed? | 2 | `/ip ipsec installed-sa` |

> **Troubleshooting order:** no active peer → phase 1 problem (peer address, identity secret, profile algorithms, firewall on UDP 500/4500). Active peer but no installed SAs → phase 2 problem (policy subnets, proposal algorithms, PFS group). Both sides must offer **matching** algorithms.

# Lesson: IPsec in RouterOS: peers, identities and policies

### Peers

    /ip ipsec peer

The peer settings are used to set up the connection **between the IKE daemons**. That connection is then used to negotiate keys and algorithms for the SAs, and **one peer can have several SAs**.

Fields you will use:

| Field | Meaning |
|---|---|
| `address` | The other side's address. It can be a subnet. |
| `local-address` | Which source address this router uses to talk to that peer |
| `profile` | The phase 1 parameters (`default` unless you change it) |
| `exchange-mode` | `main`, `aggressive` or `ike2` |
| `passive` | Wait for the other side to start IKE; never initiate towards it |
| `send-initial-contact` | Tell the peer to forget old SAs when we start fresh |

**Most specific wins.** If several peers match an incoming address, RouterOS uses the one with the **largest netmask**: with peers 2.2.2.0/24, /25, /26 and /27, a connection from 2.2.2.5 uses the /27.

### Identities

    /ip ipsec identity

The identity says **how** a peer authenticates. The slide pair of routers:

| R2 (2.2.2.2) | R1 (1.1.1.1) |
|---|---|
| `/ip ipsec peer add address=1.1.1.1/32 name=peerR1` | `/ip ipsec peer add address=2.2.2.2/32 name=peerR2` |
| `/ip ipsec identity add peer=peerR1 secret=123123123` | `/ip ipsec identity add peer=peerR2 secret=123123123` |

The default `auth-method` is `pre-shared-key`. The secret must be the same on both sides. In real life use a long random one; `123123123` is only for the classroom.

Two questions the slides ask about this pair, with the answers:

- **Who connects to whom?** Both peers know each other's address, so **either** side can start IKE when it has traffic for the tunnel. To control it, set `passive=yes` on one side: that side only waits.
- **Which ports to open in the firewall?** In the `input` chain, from the peer: **UDP 500** (IKE), **UDP 4500** (NAT-T) and **IP protocol 50** (`ipsec-esp`). Add protocol 51 (`ipsec-ah`) only if you use AH.

### Checking phase 1: active peers

    /ip ipsec active-peers print

The result of phase 1 is an **active peer** with state `established`, the uptime and the number of phase 2 SAs (`PH2 Total`). If nothing appears, check in this order: the peer settings, the identity, the profile (algorithms), then the firewall filter.

### Policies: IF this traffic, THEN this action

    /ip ipsec policy

The policy table decides **whether** security is applied to a packet. Read every policy as **IF (General tab) → THEN (Action tab)**:

**General (IF):**

- `src-address`, `dst-address`, `src-port`, `dst-port`, `protocol`: which packets match.
- `peer`: which peer this policy belongs to.
- `tunnel`: `yes` for tunnel mode, `no` for transport mode.
- `template`: whether this is only a template for dynamically generated policies.

**Action (THEN):**

- `action`: `encrypt` (protect it), `none` (let it pass unprotected), `discard` (drop it).
- `level`: `require` (drop the packet if there is no SA yet), `use` (send it unprotected if there is no SA), `unique` (one SA per policy, needed when several clients share one address).
- `ipsec-protocols`: `esp` or `ah`.
- `proposal`: which `/ip ipsec proposal` gives the phase 2 algorithms.

A new router has one policy already: the template `*T` with `::/0` to `::/0` in group `default`. It is used by road warriors (module 7) and does nothing for site to site.

### Profile and proposal: the algorithms

    /ip ipsec profile set default hash-algorithm=sha256 enc-algorithm=aes-256 dh-group=modp2048
    /ip ipsec proposal set default auth-algorithms=sha256 enc-algorithms=aes-256-cbc pfs-group=modp2048

The profile holds phase 1, the proposal holds phase 2. **Both sides must agree**: if one router insists on SHA256 and the other offers only SHA1, the negotiation fails. On the slides both routers keep the `default` proposal, which is the simplest way to make them match.

### Checking phase 2: installed SAs

    /ip ipsec installed-sa print

You see the SAs with their SPI, source, destination, the auth and encryption algorithms and the key size. For one site-to-site ESP policy you expect **two** SAs on each router: one in each direction.

# Lesson: Site to site, the packet flow and NAT

### Scenario 1: tunnel mode between two offices

The slide topology: **R2** with WAN 2.2.2.2 and LAN 192.168.2.0/24, **R1** with WAN 1.1.1.1 and LAN 192.168.1.0/24.

**On R2:**

    /ip ipsec peer add address=1.1.1.1 name=peer16
    /ip ipsec identity add peer=peer16 secret=1234567890
    /ip ipsec policy add peer=peer16 src-address=192.168.2.0/24 dst-address=192.168.1.0/24 tunnel=yes

**On R1:**

    /ip ipsec peer add address=2.2.2.2 name=peer19
    /ip ipsec identity add peer=peer19 secret=1234567890
    /ip ipsec policy add peer=peer19 src-address=192.168.1.0/24 dst-address=192.168.2.0/24 tunnel=yes

Read the policies as mirror images: R2's `src` is R1's `dst` and the other way round. Each policy names **its own** peer.

> The slide prints `peer=peer16` on R1 as well. That is a typo: R1's peer is called `peer19`, and the policy must reference a peer that exists on that router.

Then answer the slide's three questions:

1. **How many SAs?** Run `/ip ipsec installed-sa print` on each router: **two**, one in, one out.
2. **Does it work?** Ping from 192.168.2.x to 192.168.1.x. Usually **not yet**.
3. **Why? SRC-NAT.** The next section explains it.

### The packet flow with IPsec

IPsec has its own place in the RouterOS packet flow, and it explains every "it does not work" in site-to-site setups.

**Outgoing packet (encryption):**

1. The packet from the LAN goes through prerouting, the routing decision and the **forward** chain as usual.
2. It goes through **postrouting**: mangle postrouting, **SRC-NAT**, queues.
3. Only **now** the router checks the **IPsec policy**.
4. If a policy matches: **IPsec encryption**. The result is a brand-new ESP packet from the router itself.
5. That new packet goes through a **routing decision** and the **output** path (RAW output, connection tracking, mangle output, filter output) and through postrouting **a second time**.
6. Then it leaves through the output interface.

**Incoming packet (decryption):**

1. The ESP packet arrives addressed to the router, so it goes through prerouting and the **input** chain.
2. After input, the router checks the **IPsec policy** and **decrypts** it.
3. The decrypted original packet goes back to the **start** of prerouting, as if it had just arrived, then through routing and **forward** into the LAN.

What that means in practice:

- The **encrypted** packet passes `filter input` (incoming) and `filter output` (outgoing). That is where UDP 500/4500 and ESP must be allowed.
- The **decrypted** packet passes `filter forward`. That is where traffic from the remote LAN must be allowed: `ipsec-policy=in,ipsec` matches exactly the packets that arrived through IPsec.

### Why NAT breaks the tunnel

Look again at step 2 and 3 of the outgoing path: **SRC-NAT happens before the IPsec policy check.**

Both routers normally have:

    /ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade

So, step by step:

1. 192.168.2.10 sends to 192.168.1.10.
2. Masquerade rewrites the source to **2.2.2.2**.
3. The policy says `src-address=192.168.2.0/24`. The packet now comes from 2.2.2.2, so it **does not match**.
4. The packet is not encrypted. It goes to the Internet with destination 192.168.1.10 and is **lost**.

**The fix from the slides**, a NAT bypass rule placed **above** the masquerade:

    R2: /ip firewall nat add chain=srcnat action=accept place-before=0 src-address=192.168.2.0/24 dst-address=192.168.1.0/24
    R1: /ip firewall nat add chain=srcnat action=accept place-before=0 src-address=192.168.1.0/24 dst-address=192.168.2.0/24

`action=accept` in srcnat means "do not translate". `place-before=0` puts it first, because NAT rules are also checked top to bottom.

**The more flexible way**, also on the slides: use the **IPsec Policy** matcher, available in filter, NAT, mangle and RAW. The RouterOS default configuration already does this:

    /ip firewall nat add chain=srcnat out-interface-list=WAN ipsec-policy=out,none action=masquerade

`out,none` means "only packets that will **not** leave through an IPsec policy". Anything that will be encrypted is skipped automatically, for every tunnel you add later.

> **FastTrack too.** Fasttracked packets skip the IPsec policy check. If your forward chain fasttracks established connections, accept `ipsec-policy=in,ipsec` and `ipsec-policy=out,ipsec` **before** the fasttrack rule, as the RouterOS default configuration does.

### Scenario 2: transport mode protecting an L2TP tunnel

The second slide scenario protects a tunnel that already exists:

- R2 (2.2.2.2) and R1 (1.1.1.1) build an **L2TP tunnel** with addresses 10.1.1.2 and 10.1.1.1.
- R2 routes the remote LAN through it: `/ip route add dst-address=192.168.1.0/24 gateway=10.1.1.1`.
- R1 does the same: `/ip route add dst-address=192.168.2.0/24 gateway=10.1.1.2`.

Every L2TP packet on the Internet already goes from 2.2.2.2 to 1.1.1.1, the peers themselves. So **transport mode** is enough:

    R2: /ip ipsec policy add peer=peer16 src-address=2.2.2.2 dst-address=1.1.1.1 tunnel=no
    R1: /ip ipsec policy add peer=peer19 src-address=1.1.1.1 dst-address=2.2.2.2 tunnel=no

(The slide writes only `dst-address`; giving the source explicitly makes the policy match only the traffic between the two peers.)

Ask the same three questions:

1. **How many SAs?** Again **two** per router.
2. **Does it work?** Yes.
3. **SRC-NAT?** No problem here: the LAN traffic is routed into the L2TP interface, not out of ether1, so masquerade never touches it, and the L2TP packets already carry the public addresses.

This is the same idea as **L2TP/IPsec** for road warriors in module 7, only between two routers.

### The lab from the slides

> **Lab 5-1:** *Two sites are joined by an L2TP tunnel with BCP, so they share one broadcast network 192.168.x.0/24. Secure that distributed broadcast network with IPsec, and between the LAN2 networks raise an IPsec tunnel.*

That is both scenarios at once: transport mode for the L2TP/BCP tunnel, tunnel mode for the second pair of LANs. Then try the simulator lab **"Site-to-site IPsec tunnel with a NAT bypass"**, which builds one side of scenario 1 and checks the firewall, the NAT bypass and the forward rule by sending packets through them.

### Course lab

- **Lab "Site-to-site IPsec tunnel with a NAT bypass"**: peer, identity and tunnel-mode policy to the head office, matching phase 1 and phase 2 algorithms, the NAT bypass, and the firewall for IKE, NAT-T, ESP and the decrypted traffic.
