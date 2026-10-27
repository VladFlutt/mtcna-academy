# Lesson: 802.11 standards

Wireless is used by ISPs (WISP last mile and backhaul links), offices, homes and public hotspots.

| Standard | Year | Band | Max rate | Name |
|---|---|---|---|---|
| 802.11 | 1997 | 2.4 GHz | 2 Mbit/s | |
| 802.11b | 1999 | 2.4 GHz | 11 Mbit/s | |
| 802.11a | 1999 | 5 GHz | 54 Mbit/s | |
| 802.11g | 2003 | 2.4 GHz | 54 Mbit/s | |
| 802.11n | 2009 | 2.4 + 5 GHz | 600 Mbit/s | Wi-Fi 4 |
| 802.11ac | 2014 | 5 GHz | 6.9 Gbit/s | Wi-Fi 5 |
| 802.11ax | 2019 | 2.4 + 5 (+6) GHz | 9.6 Gbit/s | Wi-Fi 6 / 6E |
| 802.11be | 2024 | 2.4 + 5 + 6 GHz | 46 Gbit/s | Wi-Fi 7 |

- Newer standards are **backward compatible** (band setting 2GHz-B/G/N allows all three). Old clients slow down the cell, so use *only-N* or *G/N* if you can.
- Real TCP throughput is roughly **half** of the data rate shown.

### Why 802.11n is faster

Same modulation as 802.11g (64-QAM), but: about 10% from MAC improvements (frame aggregation, short guard interval), **40 MHz channels** (double width) and above all **MIMO**: several spatial streams (chains). Example hAP/RB941 family: 1 chain 150 Mbit/s, **2nD** dual chain 300, **2nT** triple chain 450, **2nQ** quad chain 600 Mbit/s.

# Lesson: Frequencies and regulation

### 2.4 GHz

- 13 channels in Europe (ETSI), 11 in the USA (FCC), channel 14 only in Japan (802.11b only).
- Channel 1 = **2412 MHz**, then +5 MHz each: ch 6 = 2437, ch 11 = 2462, ch 13 = 2472.
- Each channel is **22 MHz** wide (20 MHz for OFDM), so neighbouring channels overlap. The only **non-overlapping** channels are **1, 6 and 11**.
- In the EU the limit is **100 mW EIRP** (20 dBm) in 2400-2483.5 MHz (ERC Recommendation 70-03).

### 5 GHz

More channels and less interference; split into **UNII** bands. Some channels require **DFS** (Dynamic Frequency Selection): the device must listen for radar and leave the channel if radar is detected.

### Frequency mode and country

| frequency-mode | Behaviour |
|---|---|
| **regulatory-domain** | Only channels allowed in the selected **country**, tx-power is limited and **antenna-gain** is subtracted automatically (e.g. 20 dBm EIRP - 2 dBi antenna = 18 dBm tx) |
| **manual-txpower** | Channels from the country list, but tx-power is your responsibility |
| **superchannel** | No restrictions (testing only, needs a licence level that allows it) |

If the only option offered is regulatory-domain and you cannot change the country, the device is a **country-locked** version (e.g. US models). Use the correct country setting; it is the law.

> Try the **2.4 GHz channel planner** in Simulators.

# Lesson: Station mode

    /interface wireless set wlan1 mode=station band=2ghz-b/g/n ssid=QTraining disabled=no

- **mode=station**: a standard 802.11 client; it can connect to any vendor's AP.
- Frequency is not required: the station scans the channels from the **scan-list**.
- A plain station **cannot be bridged** (use station-bridge or WDS between MikroTik devices).
- **Radio name** identifies the device in the AP's registration table (lab: set it to *X_YourName*).

### Scan

**Scan** shows nearby APs (SSID, frequency, signal, MAC). Normal scanning **disconnects** the interface while it runs. Since v6.37 a **background scan** is possible on 802.11 that does not drop the connection.

    /interface wireless scan wlan1

### Connect list

The **connect list** (station side) decides which APs the station may connect to. Rules match MAC, SSID, signal range and security profile and are checked **top to bottom**; *connect=yes/no*. Example: only connect to your AP's MAC when signal is better than -75 dBm.

# Lesson: Access point mode

    /interface wireless set wlan1 mode=ap-bridge band=2ghz-b/g/n channel-width=20mhz \
        frequency=2412 ssid=MY-AP disabled=no

- **mode=ap-bridge** needs licence **level 4** or higher (level 3 is station only). Up to **2007** clients in theory.
- **bridge** mode: an AP that accepts only **one** client (licence level 3 is enough), used for point-to-point links.
- **Freq. Usage** shows how busy each frequency is; pick the least used one (see below).

### Choosing a channel with Freq. Usage

Before you fix `frequency=` on an AP, look at what the air around it already carries. In Winbox open the wlan interface and press **Freq. Usage** (in the CLI: `/interface wireless frequency-monitor`):

    /interface wireless frequency-monitor wlan1

Step by step:

1. The tool switches the radio into monitor mode, so **connected clients drop** while it runs. Do it before the AP goes live, or in a maintenance window.
2. Each line is one frequency (2412, 2417, ... for 2.4 GHz) with **Usage %** (how much of the time the channel is busy) and **Noise floor** (dBm).
3. Let it run for a minute, then stop it with **Ctrl+C** (or *Stop* in Winbox).
4. Pick the channel with the lowest usage and a low noise floor. On 2.4 GHz stay on the non-overlapping 1, 6 or 11 (2412, 2437, 2462).
5. Set it: `/interface wireless set wlan1 frequency=2462`.

> **Freq. Usage vs Scan.** Scan lists *networks* (SSIDs, signal) that it hears. Freq. Usage measures *how busy* each frequency is, including non-Wi-Fi noise (microwave ovens, cameras) that Scan never shows.

### Registration table

Shows the connected peers on **both** AP and station: MAC, radio name, uptime, signal strength, **tx/rx rate**, **signal-to-noise**, **CCQ** (Client Connection Quality, %). On the AP you see all clients, on a station you see the AP it is connected to.

### Access list (AP side)

The **access list** decides which clients may connect to the AP. Rules (MAC, interface, signal-strength range, time) are processed **top to bottom**.

- **default-authenticate=yes** (interface setting): clients **not** in the access list are allowed.
- **default-authenticate=no**: only clients in the access list with *authentication=yes* can connect.

Examples:

- Allow everyone but two devices: default-authenticate=yes, two rules with authentication=no.
- Allow only two devices: default-authenticate=**no**, two rules with authentication=yes.

### Client isolation

**default-forward=yes** lets clients of the same AP talk to each other. **default-forward=no** isolates them (they can still reach the router and the Internet). The access list *forwarding* setting has priority over default-forward. With two isolated wlans in one bridge, clients of wlan1 can still talk to clients of wlan2 through the bridge, unless you also use bridge filters or horizon.

### Virtual AP

A **Virtual AP** adds another SSID on the same radio: a fully independent interface (own SSID, security profile, IP network: e.g. guests on 192.168.5.0/24 without WPA). Layer 1 settings (channel, width, band) are **inherited** from the master interface.

# Lesson: Wireless security

Most security settings live in a **security profile** (**Wireless > Security Profiles**), which is assigned to the interface.

    /interface wireless security-profiles add name=office mode=dynamic-keys \
        authentication-types=wpa2-psk unicast-ciphers=aes-ccm group-ciphers=aes-ccm \
        wpa2-pre-shared-key=SuperSecret123
    /interface wireless set wlan1 security-profile=office

- **mode=none**: open network; **static-keys-required**: WEP (do not use); **dynamic-keys**: WPA/WPA2.
- Use **WPA2-PSK** (or WPA3 in the v7 *wifi* package) with **AES-CCM**. TKIP and WEP are broken.
- **WPA-EAP / WPA2-EAP** use a RADIUS server (enterprise).
- Hiding the SSID and MAC filtering alone are **not** security: both are easy to bypass.
- **WPS** can be abused; disable it if not needed (WPS mode in the interface).

# Lesson: Point-to-point links and tools

### Wireless protocols

| Protocol | Notes |
|---|---|
| **802.11** | Standard, works with any vendor |
| **NV2** | MikroTik TDMA protocol: better for PtMP with many clients and long distance. MikroTik only |
| **nstreme** | Older MikroTik polling protocol |
| **nstreme dual** | Nstreme over two radios: one transmits, one receives (full duplex) |
| **any** | Station tries all |

### Why Nstreme existed: 802.11a vs Nstreme

The slides compare the same pair of 5 GHz dishes, back in 1999 with 802.11a:

| | 20 MHz channel | 40 MHz channel (turbo) | Distance |
|---|---|---|---|
| **802.11a** channel rate | 54 Mbps | 108 Mbps | — |
| **802.11a** real TCP throughput | ≈ 24.4 Mbps | ≈ 44 Mbps | **limited**: ACK timeouts of the standard break long links |
| **Nstreme** real TCP throughput | ≈ 30 Mbps | ≈ 60 Mbps | **no distance limit** |

Two lessons from the table:

- The channel rate is never the TCP speed. Standard 802.11 is half duplex and waits for an ACK after every frame (CSMA/CA), so roughly half the air time is overhead.
- **Nstreme** is a MikroTik **proprietary polling** protocol: the AP polls the clients in turn instead of letting them contend for the air. Less overhead and no 802.11 ACK timing, so it is faster and works on long links. It works **only between MikroTik devices** (PtP or PtMP).

**Nstreme Dual** goes further: each side uses **two radios**, one only transmits and one only receives (in the slide 60 Mbps TX and 60 Mbps RX at the same time). This makes a **full duplex** wireless bridge, at the cost of two radios and two antennas per side.

**NV2** (Nstreme version 2) replaced Nstreme: it uses **TDMA** (time slots) instead of polling, solves the hidden node problem and gives lower latency. In a modern PtP link you choose NV2; Nstreme and Nstreme Dual remain for older installations and for the exam.

    /interface wireless set wlan1 wireless-protocol=nv2
    /interface wireless nstreme set wlan1 enable-nstreme=yes

### Point-to-point bridge

On side A: mode=**bridge** (or ap-bridge), on side B: **station-bridge**, both in a local bridge with Ethernet. Now both LANs are one Layer 2 network. Alternatives: **WDS** (wds-mode=dynamic) or station-pseudobridge.

### Wireless tools

- **Snooper**: shows all networks and clients on all channels (disconnects the interface).
- **Sniffer**: captures 802.11 frames to a file or streams them to Wireshark.
- **Freq. Usage**, **Scan**, **Align** (antenna alignment with sound).

### RouterOS v7 note

Newer 802.11ac/ax devices use the new **wifi** package (`/interface wifi`) instead of the legacy `/interface wireless` menu. The concepts are the same (AP, station, security, access list, channels), with WPA3 and better performance. The MTCNA exam still explains concepts with the classic wireless menu.
