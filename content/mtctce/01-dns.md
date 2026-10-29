# Lesson: How DNS resolves a name

People remember names, routers need addresses. The **Domain Name System** turns www.example.com into an address. It is a distributed database organised as a tree, read from right to left:

| Part | Example | Who answers for it |
|---|---|---|
| root | `.` (usually not written) | 13 root server names, run by many organisations |
| top-level domain (TLD) | `com`, `org`, `ru`, `lv` | the registry of that TLD |
| domain | `example` | the name servers the owner registered |
| host or subdomain | `www`, `mail`, `vpn` | the same name servers |

A **resolver** that needs www.example.com asks a root server, which refers it to the com servers, which refer it to the example.com servers, which finally give the answer. Every answer has a **TTL** (time to live): how long anyone may keep it in a cache.

Common record types:

| Type | Holds |
|---|---|
| A | an IPv4 address |
| AAAA | an IPv6 address |
| CNAME | another name (an alias) |
| MX | the mail servers of a domain |
| NS | the name servers of a zone |
| PTR | the name for an address (reverse lookup) |
| TXT | free text (SPF, verification) |

DNS uses **UDP port 53** for normal queries and **TCP port 53** for answers that do not fit into one UDP packet and for zone transfers. Firewalls must treat both.

![The router answers from its static entries and its cache, and asks the upstream servers only for what it does not know](/img/mtctce/dns-resolve.svg)

# Lesson: The router as a caching DNS server

RouterOS has a DNS client and a **caching DNS server** in one menu, `/ip dns`.

    /ip dns set servers=1.1.1.1,8.8.8.8 allow-remote-requests=yes
    /ip dns print

- **servers**: the upstream servers the router asks. Servers learned from a DHCP client or PPP connection with `use-peer-dns=yes` are added as **dynamic servers**.
- **allow-remote-requests=yes**: other devices may use the router as their DNS server. Without it, the router resolves names only for itself (ping, NTP, address lists with names).
- **cache-size** (2048 KiB by default) and **cache-max-ttl** (1 week): how much is kept and for how long at most.
- **max-udp-packet-size** (4096): the largest UDP answer the router accepts (EDNS).
- **query-server-timeout** and **query-total-timeout**: how long to wait for one server and for the whole query.
- RouterOS 7 adds **use-doh-server**: the router itself asks an upstream server over DNS over HTTPS.

The cache is in `/ip dns cache`; `/ip dns cache flush` empties it. That is the first thing to do when a changed address on the Internet still resolves to the old one on your network (the clients have their own caches too).

## Open resolvers

With `allow-remote-requests=yes` the router answers anyone who reaches UDP or TCP 53. On a public address without a firewall it becomes an **open resolver**, which attackers use for DNS amplification attacks: a small query with a spoofed source produces a large answer to the victim. Always drop DNS from the WAN:

    /ip firewall filter add chain=input in-interface-list=WAN protocol=udp dst-port=53 action=drop
    /ip firewall filter add chain=input in-interface-list=WAN protocol=tcp dst-port=53 action=drop

The default configuration and a firewall that ends with "drop everything not from the LAN" already cover it.

# Lesson: Static entries and regular expressions

Static entries answer before the cache and before the upstream servers:

    /ip dns static add name=comp1.local address=192.168.33.10
    /ip dns static add name=mail.server address=192.168.33.200
    /ip dns static add name=router.lan address=192.168.33.1

Uses: names for local servers, overriding a public name (send mail.example.com to the internal mail server), and blocking.

- Entries are checked **top to bottom**, and the first match answers.
- A static A record automatically answers the matching reverse (PTR) query.
- RouterOS 7 entries have a **type**: A, AAAA, CNAME, MX, NS, SRV, TXT, **FWD** and **NXDOMAIN**.
- `match-subdomain=yes` makes `name=corp.local` also answer for `pc1.corp.local`.

## Forwarding a domain

    /ip dns static add name=corp.local type=FWD forward-to=10.1.1.53 match-subdomain=yes

Queries for corp.local and everything under it go to the office DNS server, the rest to the normal upstream servers. This is how a branch resolves the head office's internal names through a VPN.

## Regular expressions

Instead of a name an entry can have a **regexp**:

    /ip dns static add regexp="(^|\\.)ads\\.example\\.com\$" address=127.0.0.1

- The expression is a POSIX regular expression matched against the whole query name.
- `.` means any character: escape a real dot as `\.`. Inside double quotes on the CLI the backslash itself must be escaped, so you type `\\.`, and `$` is written `\$` because `$` starts a variable.
- Anchor the expression. Without `^` and `$`, `ads\.example\.com` also matches `ads.example.com.evil.net`.
- Regexp entries are slower than plain names; keep their number small and put them after the exact names.

Blocking a domain: answer 127.0.0.1 or 0.0.0.0, or use `type=NXDOMAIN` so that the client is told the name does not exist. Test your expressions in the **proxy and DNS pattern tester**.

# Lesson: Forcing clients to use the router's DNS

Static entries and blocking only help if the clients actually ask the router. A client with 8.8.8.8 typed in bypasses it. A dstnat rule catches every DNS query from the LAN and sends it to the router itself:

    /ip firewall nat add chain=dstnat in-interface=bridgeLAN protocol=udp dst-port=53 action=redirect to-ports=53
    /ip firewall nat add chain=dstnat in-interface=bridgeLAN protocol=tcp dst-port=53 action=redirect to-ports=53

- **redirect** is a dst-nat to the router's own address on the incoming interface; `to-ports` picks the port.
- The client still thinks it talks to 8.8.8.8, and the answer comes back with 8.8.8.8 as its source, because connection tracking reverses the translation.
- `allow-remote-requests=yes` is needed, and the input chain must accept DNS from the LAN.

## Limits

- **DNS over HTTPS** (DoH) is ordinary HTTPS on TCP 443 to the resolver's address. A redirect of port 53 does not see it. Modern browsers fall back to normal DNS when the DoH resolver is unreachable, so blocking the well-known DoH addresses (an address list) restores control.
- **DNS over TLS** uses TCP 853 and can simply be blocked in forward.

The **DNS** lab builds all of it: the router answers the LAN only, has local names and a regexp block, and forces every query to itself.
