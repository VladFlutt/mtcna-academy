# Lesson: Layer 2 attacks

Layer 2 attacks come from **inside** the LAN: a guest laptop, an infected PC, a device someone plugged into a free port. The router's IP firewall does not see most of them, so you need switch and bridge settings.

### MAC flooding

A switch learns which MAC address is behind which port and keeps it in the **MAC (host) table**. The table has a limited size.

How the attack works, step by step:

1. The attacker sends thousands of frames with **random source MAC addresses**.
2. The table fills up with fake entries.
3. Real hosts cannot be learned any more, so the switch **floods** their frames to all ports, like a hub.
4. The attacker now sniffs traffic that was never meant for them.

Protection: limit the number of learned MACs per port (port security on CRS switches), use 802.1X, and do not leave free ports enabled in public places.

### ARP spoofing

ARP maps IP addresses to MAC addresses and has no authentication. An attacker sends fake ARP replies: *"192.168.88.1 is at MY MAC"*. The victims now send their gateway traffic to the attacker (**man-in-the-middle**).

RouterOS protection on the LAN interface:

    /interface bridge set bridgeLAN arp=reply-only
    /ip dhcp-server set dhcp1 add-arp=yes

- **arp=reply-only**: the router does not learn ARP entries from the network; it only uses static entries.
- **add-arp=yes**: the DHCP server adds a static ARP entry for each lease, so DHCP clients still work.

The router then ignores fake ARP replies about the hosts. (Clients can still be fooled about the gateway; on managed switches use DHCP snooping with ARP inspection.)

### Rogue DHCP and DHCP starvation

- **Rogue DHCP server**: someone connects a home router or misconfigures a PC. Clients get a **wrong gateway or DNS**, either by accident or to redirect them.
- **DHCP starvation**: the attacker requests leases with **many fake MAC addresses** until the pool is empty; real clients get nothing (and a rogue server can take over).

Protection:

    /ip dhcp-server alert add interface=bridgeLAN valid-server=D4:CA:6D:00:00:01 on-alert=":log warning rogue"
    /interface bridge set bridgeLAN dhcp-snooping=yes
    /interface bridge port set [find interface=ether2] trusted=yes

- **DHCP alert** logs (and can run a script) when a DHCP server other than the valid one answers.
- **DHCP snooping** on a bridge only lets DHCP offers in through **trusted** ports (the uplink to the real server).

### STP attacks and BPDU guard

A device that sends **BPDUs** with a better priority can become the **root bridge** and change the whole topology. On ports facing end users set:

    /interface bridge port set [find interface=ether5] edge=yes bpdu-guard=yes

**BPDU guard** disables the port when a BPDU arrives there.

# Lesson: Port scans and brute force

### Port scanning

A scanner (for example **nmap**) tries many ports to find open services. A scan is not an attack by itself, but it is almost always the first step of one.

RouterOS detects scans with **PSD** (port scan detection): `psd=WeightThreshold,DelayThreshold,LowPortWeight,HighPortWeight`.

    /ip firewall filter
    add chain=input protocol=tcp psd=21,3s,3,1 action=add-src-to-address-list \
        address-list=port_scanners address-list-timeout=2w comment="detect scan"
    /ip firewall raw
    add chain=prerouting src-address-list=port_scanners action=drop

How PSD counts, step by step, for `psd=21,3s,3,1`:

1. Each new TCP port a source tries within **3 s** of the previous one adds weight.
2. A port **below 1024** adds **3**, a higher port adds **1**.
3. When the sum reaches **21**, the rule matches: for example 7 well-known ports, or 21 high ports.
4. The source goes to `port_scanners` for 2 weeks, and RAW drops all its packets.

### Brute force

The attacker tries many passwords for SSH, Winbox, FTP... Strong passwords help, but you also want to stop the attempts. The classic RouterOS method uses **staged address lists**:

    /ip firewall filter
    add chain=input protocol=tcp dst-port=22 src-address-list=ssh_blacklist action=drop
    add chain=input protocol=tcp dst-port=22 connection-state=new src-address-list=ssh_stage3 \
        action=add-src-to-address-list address-list=ssh_blacklist address-list-timeout=10d
    add chain=input protocol=tcp dst-port=22 connection-state=new src-address-list=ssh_stage2 \
        action=add-src-to-address-list address-list=ssh_stage3 address-list-timeout=1m
    add chain=input protocol=tcp dst-port=22 connection-state=new src-address-list=ssh_stage1 \
        action=add-src-to-address-list address-list=ssh_stage2 address-list-timeout=1m
    add chain=input protocol=tcp dst-port=22 connection-state=new \
        action=add-src-to-address-list address-list=ssh_stage1 address-list-timeout=1m

Follow one attacker, connection by connection (all within a minute):

| Attempt | Lists before | What happens |
|---|---|---|
| 1 | none | Added to stage1, connection allowed |
| 2 | stage1 | Added to stage2, allowed |
| 3 | stage1, 2 | Added to stage3, allowed |
| 4 | stage1, 2, 3 | Added to **blacklist**, still allowed |
| **5** | blacklist | **Dropped** by the first rule, for 10 days |

> **Why is the order "stage3 first, stage1 last"?** `add-src-to-address-list` does **not** stop processing. If stage1 were first, the same packet would be added to stage1, then match stage2, then stage3, then blacklist, all at once. Reverse order makes each packet climb only one step.

An administrator who logs in once or twice never reaches the blacklist, and the stage entries expire after a minute.

# Lesson: Denial of service and spoofing

### DoS and DDoS

- **DoS** (Denial of Service): one source overloads a service or link.
- **DDoS** (Distributed DoS): the traffic comes from **many sources** (often a botnet). Blocking one address does not help.

Common types:

| Attack | How it works | RouterOS help |
|---|---|---|
| **SYN flood** | Many TCP SYNs, the server keeps half-open connections until its table and CPU are exhausted | `/ip settings set tcp-syncookies=yes`, RAW drop of known sources |
| **Amplification** | Small spoofed queries to open DNS/NTP/memcached servers; big answers go to the victim | Do not be an open resolver; drop spoofed sources |
| **Connection exhaustion** | One source opens thousands of connections | `connection-limit=100,32` + address list |
| **Volumetric** | The link is simply full | Only the ISP upstream can help |

**SYN cookies** let the router answer SYNs without storing state for half-open connections: the state is encoded in the sequence number.

Example connection limit rule (per source address `/32`):

    /ip firewall filter add chain=input protocol=tcp connection-limit=100,32 \
        action=add-src-to-address-list address-list=too_many address-list-timeout=1h

### Spoofing and rp-filter

**Reverse path filtering** checks the source address of every packet: would the router send replies to this source out of the **same** interface?

    /ip settings set rp-filter=strict

- **strict**: the packet must arrive on the best interface towards its source.
- **loose**: the source must be reachable through any interface.

Spoofed packets that claim to be from your LAN but arrive on the WAN are dropped.

# Lesson: Neighbour discovery, floods and rate limiting

> This lesson follows the course slides, chapter 3 "Attacks, mechanisms and services".

### Discovery protocols give you away

Before an attacker scans anything, they listen. Three protocols announce a device to its neighbours, and all three are unauthenticated:

| Protocol | Who speaks it | What it leaks |
|---|---|---|
| **MNDP** (MikroTik Neighbor Discovery Protocol) | RouterOS, SwOS | Identity, RouterOS version, board model, interface name, MAC, IP |
| **CDP** (Cisco Discovery Protocol) | Cisco, and RouterOS for compatibility | Device id, platform, port, software version |
| **LLDP** (Link Layer Discovery Protocol) | Almost everything, IEEE 802.1AB | System name, description, port, capabilities, management address |

RouterOS answers all three by default. On a WAN port that means your version number is published to anybody on the segment, and a version number is how an attacker picks an exploit.

Restrict discovery to the interfaces where you actually need it:

    /ip neighbor discovery-settings set discover-interface-list=LAN
    /ip neighbor print

The same `LAN` interface list from the previous module does the job. The slides pair this with two neighbour-level attacks:

- **MNDP/CDP/LLDP flood**: thousands of forged announcements per second. Every one is a small packet the CPU must parse, and neighbour tables fill up. The cure is not to filter them but not to listen: `discover-interface-list=none` on untrusted ports.
- **Information gathering**: one single legitimate-looking announcement is enough to read your version. There is no rate limit that helps here; only turning discovery off does.

> **Do not forget the bridge.** On a bridge, discovery follows the bridge interface, not the physical port. If `bridge1` is in the `LAN` list, every port in that bridge can hear and answer.

### UDP floods and amplification

UDP has no handshake, so a sender never has to prove it exists. That makes it the favourite transport for volumetric attacks:

- **Plain UDP flood**: packets to random ports. Each one makes the router generate an ICMP port-unreachable reply, so the attack costs you twice.
- **Amplification**: a small request with a spoofed source to a service that answers with something much larger. DNS, NTP, SNMP and memcached are the classic ones. A 60-byte DNS query can produce a 3000-byte answer, a fifty-fold amplification, and the answer goes to the victim, not to the attacker.

The RouterOS answers, in order of how much they help:

    /ip firewall raw
    add chain=prerouting action=drop protocol=udp dst-port=53 in-interface-list=WAN comment="no DNS from WAN"

    /ip dns set allow-remote-requests=no

    /ip firewall filter
    add chain=input action=accept protocol=udp dst-port=53 src-address-list=trusted
    add chain=input action=drop protocol=udp dst-port=53

The first rule is the important one: if your router is not a public resolver, it must not answer DNS from the Internet at all. An open resolver is not only your problem, it is a weapon pointed at somebody else.

### Ping floods and the smurf attack

A **ping flood** is simply more ICMP echo requests than the target can answer. A **smurf attack** is the amplified version, and it is worth understanding step by step:

1. The attacker sends an ICMP echo request.
2. The **source address is spoofed** to the victim's address.
3. The **destination is a broadcast address**, for example 192.168.88.255.
4. Every host on that subnet answers.
5. All the answers arrive at the victim, who never sent anything.

One packet in, a hundred packets out, and the attacker's own address never appears. The defences are layered:

    /ip firewall raw
    add chain=prerouting action=drop dst-address-type=broadcast protocol=icmp in-interface-list=WAN

    /ip settings set rp-filter=strict

- Do not route ICMP to broadcast addresses from outside.
- `rp-filter=strict` drops a packet whose source address could not legitimately have arrived on that interface, which kills most spoofing at the door.
- Rate limit what is left, below.

### Rate limiting: limit and burst

Rate limiting is how you accept something and still survive a flood of it. RouterOS writes it as `limit=count/time,burst`:

    /ip firewall filter
    add chain=input protocol=icmp action=accept limit=50/5s,10 comment="50 pings per 5s, burst 10"
    add chain=input protocol=icmp action=drop comment="the rest"

Read the two numbers separately:

- **`50/5s`** is the sustained rate: the bucket refills at fifty packets every five seconds.
- **`10`** is the burst: how much the bucket may hold when it is full, so a short spike of ten packets passes untouched.

The rule after it must be the `drop`, because `limit` only matches *while under the limit*. Once the bucket is empty the rule stops matching and the packet falls through to the next rule, which is why the pair is always accept-then-drop.

### The syn-attack chain

A **SYN flood** sends the first packet of the TCP handshake and never the third. Every half-open connection holds state, and the table fills. The slides build a dedicated chain for it:

    /ip firewall filter
    add chain=forward protocol=tcp tcp-flags=syn connection-state=new action=jump jump-target=SYN-Protect
    add chain=SYN-Protect protocol=tcp tcp-flags=syn limit=400,burst=400 connection-state=new action=return
    add chain=SYN-Protect protocol=tcp tcp-flags=syn connection-state=new action=drop

Why the `return` and not an `accept`: if the packet is under the limit, it goes back to `forward` and continues through the rest of your policy, so the rate limit does not accidentally bypass your other rules. Only the packets over the limit are dropped inside the chain.

RouterOS also has a built-in helper:

    /ip settings set tcp-syncookies=yes

**SYN cookies** let the router answer a handshake without allocating state, and only create the connection when the third packet proves the client is real. Turn it on; it costs a little CPU per handshake and saves the whole table.

### Stealth scans and how to catch them

A scanner does not have to complete a handshake to learn whether a port is open. The slides list the flag combinations `nmap` uses, and each one is an impossible packet that a real stack would never send:

| Scan | Flags | Normal? |
|---|---|---|
| **FIN scan** | `fin` only, no `ack` | No, a FIN always follows a session |
| **NULL scan** | no flags at all | No |
| **XMAS scan** | `fin,psh,urg` together | No |
| **SYN+FIN** | `syn,fin` | Contradictory: open and close at once |
| **SYN+RST** | `syn,rst` | Contradictory |
| **FIN+RST** | `fin,rst` | Contradictory |

Because they are impossible, you can drop them without any risk of false positives:

    /ip firewall filter
    add chain=input protocol=tcp tcp-flags=fin,!ack action=drop comment="FIN scan"
    add chain=input protocol=tcp tcp-flags=!fin,!syn,!rst,!psh,!ack,!urg action=drop comment="NULL scan"
    add chain=input protocol=tcp tcp-flags=fin,psh,urg action=drop comment="XMAS scan"
    add chain=input protocol=tcp tcp-flags=fin,syn action=drop
    add chain=input protocol=tcp tcp-flags=syn,rst action=drop
    add chain=input protocol=tcp tcp-flags=fin,rst action=drop

The syntax deserves a line of its own: inside `tcp-flags` a name means *this flag is set*, and `!name` means *this flag is clear*. So `fin,!ack` is "FIN set and ACK clear", and the NULL scan rule lists all six flags as clear.

For the connect scans that do use normal flags, the PSD matcher and the address-list trick from the port scan lesson are the right tool instead.

### The lab from the slides

> **Lab:** *Turn neighbour discovery off towards the WAN, add rate limiting for ICMP, and drop the impossible TCP flag combinations.*

1. `/ip neighbor discovery-settings set discover-interface-list=LAN` and confirm with `/ip neighbor print` from a classmate's router that you have disappeared.
2. Add the ICMP accept-with-limit and the drop after it. Test with `ping -f` or a flood tool and watch the counters.
3. Add the six stealth-scan rules. Run a FIN or XMAS scan from a neighbour and check that the counters move while the scan reports nothing.
4. Turn on `tcp-syncookies` and `rp-filter=strict`, then verify normal traffic still works.

### Course labs

- **Lab "Stop an SSH brute-force attack"**: build the staged rules; the simulator replays an attacker and an honest admin.
- **Lab "Detect port scans and blunt SYN floods"**: PSD, RAW, SYN cookies, rp-filter and the rogue DHCP alert.
