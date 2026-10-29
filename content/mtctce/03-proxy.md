# Lesson: The web proxy, regular and transparent

A **web proxy** fetches web pages on behalf of the clients. RouterOS has one built in (`/ip proxy`). It can:

- filter requests by client, host, path and method (`/ip proxy access`);
- cache answers and serve repeated requests locally (`/ip proxy cache`);
- pass requests to a **parent proxy**, with exceptions (`/ip proxy direct`).

    /ip proxy set enabled=yes port=8080 max-cache-size=unlimited cache-on-disk=no

## Regular proxy

In a regular (explicit) proxy setup every browser is configured with the proxy address and port. The browser then sends its requests to the proxy, including HTTPS requests as a `CONNECT` tunnel. It works, but every device has to be configured, and a user can simply remove the setting.

## Transparent proxy

In a transparent setup the router redirects plain HTTP to the proxy itself, and the clients know nothing about it:

    /ip firewall nat add chain=dstnat in-interface=bridgeLAN protocol=tcp dst-port=80 action=redirect to-ports=8080

![A transparent proxy: HTTP is redirected to the proxy, which allows or denies, answers from the cache or fetches the page](/img/mtctce/proxy-transparent.svg)

- The redirected connection ends on the router, so it passes the **input** chain; the proxy's own connection to the web server goes through **output**.
- Devices that break behind a proxy can be excluded with an `action=accept` rule in dstnat above the redirect, matching their address.

## HTTPS

Today nearly all web traffic is HTTPS. A transparent proxy cannot see inside it: the URL, the path and the page are encrypted end to end, and redirecting TCP 443 to the proxy only breaks the connections. HTTPS is filtered in other ways:

- by **DNS** (static entries that block a domain, module 1);
- by **address lists** of the servers' addresses;
- by the server name the client sends in the TLS handshake: the firewall matcher `tls-host` (for example `tls-host=*.example.com`).

## Never leave the proxy open

An enabled proxy listens on all interfaces. Reachable from the Internet, it becomes an **open proxy**: spammers and attackers use it to hide their source, and your address ends up on block lists within hours. Drop the proxy port from the WAN in the input chain, or keep a firewall that drops everything not from the LAN, and add an allow rule for your own clients only:

    /ip proxy access add src-address=192.168.33.0/24 action=allow
    /ip proxy access add action=deny

# Lesson: Access rules, wildcards and regular expressions

`/ip proxy access` rules are checked **top to bottom**; the first rule that matches decides, and a request that matches no rule is allowed.

| Field | Matches |
|---|---|
| src-address | the client |
| dst-address, dst-port | the web server's address and port |
| local-port | the proxy port the client used (if the proxy listens on several) |
| dst-host | the host name in the request |
| path | the part of the URL after the host, for example /files/setup.exe |
| method | GET, POST, CONNECT… |
| action | allow or deny |
| redirect-to | for deny: send the browser to this URL instead of an error page |

    /ip proxy access add dst-host=*mikrotik.com action=deny redirect-to=mt.lv
    /ip proxy access add path=*.exe action=deny
    /ip proxy access add dst-host=":(torrent|piratebay)" action=deny

## Wildcards

- `*` matches any number of characters, `?` exactly one.
- A wildcard must match the **whole** value: `*mikrotik.com` matches www.mikrotik.com and mikrotik.com, but not mikrotik.com.evil.net.
- `!` in front negates the match.

## Regular expressions

A value that starts with `:` is a **regular expression**, and it matches anywhere unless anchored.

| Pattern | Matches |
|---|---|
| `:torrent` | any host containing "torrent" |
| `:^www\.` | hosts starting with "www." |
| `:\.ru$` | hosts ending with ".ru" |
| `:^[0-9.]+$` | a bare IPv4 address used as host |

The course lab blocks torrent sites with one rule like `dst-host=":(torrent|thepiratebay|rutracker)"` and sends users of one site to another with `redirect-to`. Try your patterns in the **proxy and DNS pattern tester**.

# Lesson: Cache, direct access and monitoring

## Cache

    /ip proxy set max-cache-size=unlimited max-cache-object-size=2048KiB cache-on-disk=yes max-fresh-time=3d

- **max-cache-size** and **cache-on-disk**: the cache lives in RAM unless `cache-on-disk=yes` (on a device with real storage).
- **max-fresh-time** (3 days by default): the longest time an object is considered fresh when the server gave no expiry.
- `/ip proxy cache` rules decide **what may be cached** (allow or deny by host, path…); dynamic pages or a sensitive intranet are typical deny entries.
- **cache-hit-dscp** (4 by default) marks answers served from the cache with that DSCP value. They did not use the Internet link, so queues can leave them unlimited by matching `dscp=4` in mangle.

## Parent proxy and direct access

    /ip proxy set parent-proxy=10.0.0.3 parent-proxy-port=3128
    /ip proxy direct add dst-host=*.local action=allow

With a parent proxy, requests go to the parent; `/ip proxy direct` rules with `action=allow` send matching requests directly to the server instead.

## Monitoring

- `/ip proxy connections print`: the requests in progress.
- `/ip proxy print stats`: hits and misses.
- `/ip proxy cache-contents print`: what is cached.
- The `web-proxy` logging topic records requests.

The **transparent proxy** lab redirects HTTP, adds a redirect and a regex block, and checks that the proxy is closed to the WAN.
