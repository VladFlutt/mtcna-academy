# Lesson: About MikroTik

**MikroTik** (legal name *Mikrotīkls Ltd*) is a Latvian company headquartered in **Riga**, founded in **1996**. Today it employs more than 280 people and sells hardware and software used by ISPs, WISPs, enterprises and home users in almost every country.

### Key dates

| Year | Event |
|------|-------|
| 1996 | Company founded in Riga, Latvia |
| 1997 | **RouterOS** released: turns a standard PC into a router |
| 2002 | **RouterBOARD** hardware released |
| 2006 | First **MUM** (MikroTik User Meeting) held |

### Products

- **RouterOS (ROS)**: the operating system, based on the Linux kernel. The *same* RouterOS runs on every MikroTik router, from a tiny hAP lite to a CCR2216, and on x86 PCs and virtual machines (CHR).
- **SwitchOS (SwOS)**: a lightweight OS for some CRS/CSS switches, configured only from a web browser.
- **RouterBOARD (RB)**: routers and wireless devices for SOHO, WISP and CPE use.
- **CCR** (Cloud Core Router): multi-core high performance routers.
- **CRS** (Cloud Router Switch): switches that can run RouterOS or SwOS.
- **CSS** (Cloud Smart Switch): switches that run SwOS only.
- **CHR** (Cloud Hosted Router): RouterOS as a virtual machine.

### Where to find information

| Resource | Address |
|---|---|
| Main site | mikrotik.com |
| Official documentation | **help.mikrotik.com/docs** (the old wiki.mikrotik.com is being migrated here) |
| Forum | forum.mikrotik.com |
| MUM presentations | mum.mikrotik.com |
| Video | youtube.com/mikrotik |
| Support | support@mikrotik.com (attach a **supout.rif** file) |

> **Tip:** when you ask for help on the forum or from support, always say which RouterOS version and which device you use. Most answers depend on both.

# Lesson: RouterBOARD hardware

### Why RouterBOARD?

- **Wide operating temperature**: typically **-40°C to +70°C** (outdoor models up to +80°C, rackmount -30°C to +70°C, always check the datasheet).
- **One OS everywhere**: what you learn on a hAP works on a CCR.
- **Independent Ethernet ports**: every port can be routed separately, bridged or switched.
- **PoE-in** on almost all models; many models also have PoE-out.
- **Very low power**: an RB750 uses at most 2.5 W, an RB951-2n about 3 W.

![A RouterBOARD with WAN and LAN ports: every Ethernet port is independent, and most devices take PoE in (course slide)](/img/mtcna/na3-05.webp)

### Device families

- **Embedded boards**: a bare board you install into your own enclosure (e.g. RB433, RB912).
- **Integrated devices**: board, enclosure and antenna in one product (e.g. SXT, LHG, hAP).
- **Indoor / rackmount**: hAP, hEX, RB2011, RB4011, CCR, CRS.

![Product classes: embedded boards, integrated solutions, indoor and rackmount devices (course slide)](/img/mtcna/na3-08.webp)

### Decoding product names

A name such as **RB952Ui-5ac2nD-TC** is read in three parts: **board**, **wireless**, **enclosure**.

![Reading a product name: RB, series 4, 9 Ethernet ports, 3 miniPCI slots (course slide)](/img/mtcna/na3-11.webp)

![CCR1036-8g-2s+em: Cloud Core Router, series 1, 36 cores, 8 gigabit ports, 2 SFP+, extra memory (course slide)](/img/mtcna/na3-14.webp)

![CRS326-24g-2s+rm: Cloud Router Switch, series 3, 26 ports, 24 gigabit, 2 SFP+, rackmount (course slide)](/img/mtcna/na3-15.webp)

**Board name**

- **RB** = RouterBOARD, **CCR** = Cloud Core Router, **CRS** = Cloud Router Switch.
- Classic 3-digit numbers: 1st digit = **series**, 2nd digit = **number of Ethernet ports**, 3rd digit = **number of wireless interfaces (miniPCI)**. Example: **RB493** = series 4, 9 Ethernet, 3 miniPCI.
- Exceptions: RB600, RB1000, RB1100AHx4, and the 4-digit RB2011/3011/4011/5009 where the first digit is the series and the last digits are the port count (RB2011 = series 2, 11 ports).
- **CCR1036-8G-2S+EM**: CCR, series 1, **036 = 36 CPU cores**, 8 gigabit ports, 2 SFP+ ports, EM = extended memory.
- **CRS326-24G-2S+RM**: CRS, series 3, **26 ports total**, 24 gigabit, 2 SFP+, rackmount.

**Board features** (letters after the number)

| Letter | Meaning |
|---|---|
| U | USB port |
| P | Power injector with controller (PoE-out) |
| i | Single port power injector without controller |
| A | More memory (and usually a higher license level) |
| H | More powerful CPU |
| G | Gigabit Ethernet |
| L | Light edition |
| S | SFP port |
| + | SFP+ (10 Gbit) port |
| e | PCIe extension |
| x*N* | *N* CPU cores (e.g. x4) |
| R | miniPCI / miniPCIe slot |

**Built-in wireless**: band (**2** = 2.4 GHz, **5** = 5 GHz, **52** = dual band), protocol (**n**, **ac**, **ax**), chains (**S** single, **D** dual, **T** triple, **Q** quad) and power (**H**, **HP**, **SHP**).

**Enclosure**: **C** = desktop case, **IN** = indoor, **OUT** = outdoor, **RM** = rackmount, **TC** = tower case, **BU** = board unit, **EM** = extra memory, **LM** = light memory, **SA** = sector antenna, **HG** = high-gain antenna.

So **RB952Ui-5ac2nD-TC** = RouterBOARD series 9, 5 Ethernet ports, 2 wireless cards, USB, PoE-out on one port, 5 GHz 802.11ac + 2.4 GHz 802.11n dual chain, in a tower case (this is the hAP ac lite).

> Try the **Product name decoder** in the Simulators section.

# Lesson: RouterOS and licensing

### What RouterOS can do

Routing (static, OSPF, BGP, RIP), firewall and NAT, bridging and VLANs, wireless (AP, station, bridge, CAPsMAN), QoS (queues), VPN/tunnels (PPPoE, PPTP, L2TP, SSTP, OpenVPN, IPsec, WireGuard in v7), hotspot, DHCP, DNS, web proxy, scripting, API and much more.

### Licence levels

The licence is tied to the device. On RouterBOARD it is pre-installed and **cannot be upgraded** to a higher level. You can see it in **System > License**.

![What each licence level allows (course slide)](/img/mtcna/na4-48.webp)

| Level | Name | Main limits |
|---|---|---|
| 0 | Trial | 24 hours (x86 without a key stops after 24h) |
| 1 | Free demo | Very limited |
| 3 | WISP CPE | Wireless **station only**, no AP mode (volume purchase only) |
| 4 | WISP | **AP mode allowed**, 200 PPPoE/PPTP/L2TP/OVPN tunnels, 200 hotspot users |
| 5 | WISP | 500 tunnels, 500 hotspot users |
| 6 | Controller | Unlimited |

The **Software ID** is an 8-character identifier of the installation used to generate the key.

### CHR (Cloud Hosted Router) licences

CHR is limited by **interface speed**, not by features:

| Licence | Speed limit per interface |
|---|---|
| free | 1 Mbit/s upload |
| P1 | 1 Gbit/s |
| P10 | 10 Gbit/s |
| P-Unlimited | unlimited |

CHR checks its licence online periodically. Minimum requirements: 64-bit CPU with virtualisation support, 128 MB RAM, 128 MB disk.

# Lesson: Versions, packages and upgrades

### Release channels

RouterOS is published in channels: **long-term**, **stable**, **testing** and **development**. Production devices should stay on *stable* or *long-term*.

### Packages

In RouterOS v6 functions were delivered as separate packages (system, wireless, ppp, dhcp, routing, security...). In v7 the main **routeros** package contains almost everything, and *extra packages* (wifi-qcom, container, iot, user-manager...) are installed separately. You can see installed packages in **System > Packages**.

### Upgrading

1. **System > Packages > Check For Updates**, choose a channel, **Download & Install**. The router reboots.
2. Or download the *.npk* file from mikrotik.com/download, drag it into **Files** in Winbox and reboot.
3. Or use **Netinstall** for a clean reinstall.

> **Important:** the package architecture must match the device CPU (arm, arm64, mipsbe, mmips, smips, tile, x86...).

### RouterBOOT

RouterBOOT is the bootloader (like a PC BIOS). After upgrading RouterOS you should also upgrade the firmware:

    /system routerboard upgrade
    /system reboot

Check versions with `/system routerboard print` (current-firmware vs upgrade-firmware).

### Netinstall

Netinstall is a Windows (and Linux CLI) tool that reinstalls RouterOS over the network. Use it when the router does not boot, when you forgot the password, or to remove a country lock. Netinstall **erases the configuration** unless you choose *Keep old configuration*.

### A short history of versions (from the course)

- 1997 RouterOS appears; versions up to **2.9.x**.
- **3.x, 4.x, 5.x**: a new Linux kernel; each major line ended with many fix releases (3.30, 4.17, 5.26).
- **6.x**: features were added fast and stability suffered, so v6 was split into three **channels**: *long-term*, *stable* and *testing (beta)*.
- **7.x**: current generation, also published as long-term, stable and testing.

![RouterOS versions over the years and their release channels (course slide)](/img/mtcna/x5-39.webp)

### Packages in v6 vs v7

- **v6**: the *main* package (e.g. routeros-mipsbe) is a bundle of sub-packages (system, dhcp, routing, ppp, wireless, security, ipv6, mpls, hotspot...). Inside a bundle you can only **enable/disable** sub-packages, not uninstall them. Separate *extra* packages can be uninstalled.
- **v7**: one main package **routeros** with almost everything; **extra** packages (wifi-qcom, container, user-manager, dude, ups...) are installed separately.

![Packages: many separate packages in v6, one main package plus extras in v7 (course slide)](/img/mtcna/x5-41.webp)

### Manual upgrade or downgrade

1. Download the **main package** for your CPU architecture (and the matching **extra** packages if you need them) from mikrotik.com/download.
2. Upload the *.npk* files to the **root** of Files (Winbox drag and drop, FTP or SFTP).
3. Reboot. During boot the router checks that the .npk is a valid OS package, that the architecture matches and installs it. Extra packages must have **exactly the same version** as the main package.
4. To **downgrade**, upload the older package and use **System > Packages > Downgrade**.

### Upgrading RouterBOOT

After every RouterOS upgrade compare **current-firmware** with **upgrade-firmware** in **System > RouterBOARD**. If upgrade-firmware is newer, click **Upgrade** and reboot (`/system routerboard upgrade`, `/system reboot`).

![Upgrading RouterBOOT after a RouterOS upgrade: compare current and upgrade firmware, then reboot (course slide)](/img/mtcna/x5-52.webp)

### Netinstall in detail

- Use it to install/reinstall RouterOS when the OS does not boot, is missing, or misbehaves. Windows GUI and Linux CLI versions.
- Netinstall **reformats** the system disk: configuration and files are lost (unless *Keep old configuration*). It does **not** erase the **licence key** or RouterBOOT settings.
- It uses **BOOTP** in one broadcast domain: give the PC a static IP (e.g. 192.168.33.100/24), enable the *boot server* and set a client IP for the router.
- Connect the cable to the port labelled **BOOT** (usually **ether1**).
- Make the router boot from Ethernet: set *boot device = try-ethernet-once-then-nand* in System > RouterBOARD > Settings, select it in the RouterBOOT console, or hold the **reset button ~15 s** while powering on.
- Select the router, browse to the .npk files, optionally a **configure script** (.rsc applied as the new default config), then **Install**.

![Netinstall: the PC and the router in one Ethernet segment, the router boots from the network (course slide)](/img/mtcna/x3-09.webp)

### Device-mode (v7)

`/system device-mode` restricts dangerous features (scheduler, fetch, sniffer, containers, bandwidth-test, socks, proxy...) so that a compromised router is harder to abuse. Changing device-mode must be **confirmed physically**: press a button on the device or do a cold reboot within a time window, so it cannot be changed remotely.
