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

### Course labs

- **Lab "Stop an SSH brute-force attack"**: build the staged rules; the simulator replays an attacker and an honest admin.
- **Lab "Detect port scans and blunt SYN floods"**: PSD, RAW, SYN cookies, rp-filter and the rogue DHCP alert.
