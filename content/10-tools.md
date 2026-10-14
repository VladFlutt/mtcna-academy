# Lesson: Diagnostic tools

| Tool | Menu / command | What it does |
|---|---|---|
| **Ping** | `/ping 8.8.8.8` | ICMP echo; also `arp-ping` (ping by ARP, with interface) and **MAC ping** |
| **Traceroute** | `/tool traceroute 8.8.8.8` | Shows each hop to the destination |
| **Torch** | `/tool torch ether1` | Real-time traffic by address, port, protocol |
| **Packet Sniffer** | `/tool sniffer` | Capture packets to a .pcap file or stream to Wireshark (TZSP) |
| **Profile** | `/tool profile` | CPU usage per process |
| **Bandwidth Test** | `/tool bandwidth-test` | Throughput between MikroTik devices |
| **IP Scan** | `/tool ip-scan` | Discover hosts in a network |
| **MAC Server / MAC Telnet** | `/tool mac-server` | Access other MikroTik devices by MAC |

# Lesson: Monitoring and alerts

- **Netwatch** (`/tool netwatch`): pings a host every interval and runs an **up-script** or **down-script** when its state changes. Example: send e-mail when the ISP gateway goes down.
- **E-mail** (`/tool e-mail`): configure an SMTP server so scripts can send mail (including backup files).
- **SNMP** (`/snmp`): lets monitoring systems (Zabbix, PRTG, The Dude) read counters. Set a community, restrict the addresses, use SNMPv3 where possible.
- **Graphing**: built-in long-term graphs at http://router/graphs/.
- **The Dude**: MikroTik's free network monitoring and map tool (server runs on RouterOS v7 devices with storage; client on Windows).
- **Logging** (`/system logging`): send topics (firewall, wireless, error...) to memory, disk or a **remote syslog** server.

# Lesson: Neighbour discovery and NTP

- **IP > Neighbors** shows MikroTik and other devices found by **MNDP / CDP / LLDP** on the interfaces in the *discover-interface-list*. Disable discovery on WAN interfaces.
- **NTP client** (`/system ntp client set enabled=yes servers=pool.ntp.org`): correct time is essential for logs, certificates and schedulers. Devices without a battery-backed clock lose time on reboot.
- **System > Clock** sets the time zone.

### Clock and NTP (from the course)

- RouterBOARD, CCR and CRS devices have **no battery** for the clock (for reliability in extreme conditions), so time is lost on power off.
- Set the **Time Zone** in System > Clock (or use autodetect).
- To get the correct date and time use **NTP/SNTP** or **IP > Cloud** (*Update Time*: as soon as the router reaches the Internet, the cloud sets the time; it is enabled even in an empty configuration).
- **NTP** (RFC 5905) uses **UDP 123**, client/server model; RouterOS can be a client and a server.
- **SNTP** (RFC 4330) is a simplified NTP for devices that do not need high precision; an SNTP client can query any NTP server. In v6 the menu is **System > SNTP Client**, in v7 **System > NTP Client**.

    /system clock set time-zone-name=Europe/Riga
    /system ntp client set enabled=yes servers=pool.ntp.org

**Lab 5.13**: configure the NTP (SNTP) client, set the correct time zone, check the time is synchronised.

### MAC server

From the same Layer 2 segment, MAC-Winbox and MAC-Telnet **bypass the IP firewall**. Restrict them to LAN interfaces:

    /tool mac-server set allowed-interface-list=LAN
    /tool mac-server mac-winbox set allowed-interface-list=LAN

# Lesson: Support files and scripting

- **supout.rif** (`/system sup-output`): a support file with complete diagnostic information. Send it to **support@mikrotik.com**; you can view it yourself in your mikrotik.com account (Supout viewer).
The **scheduler** (`/system scheduler`) runs scripts on a schedule, e.g. a weekly backup:

    /system script add name=backup source="/system backup save name=weekly"
    /system scheduler add name=weekly-backup interval=7d on-event=backup

- **Cloud** (`/ip cloud set ddns-enabled=yes`): free dynamic DNS name *serial.sn.mynetname.net* and cloud backup.

### Check-list before calling support

1. Upgrade RouterOS and RouterBOOT to the latest stable version.
2. Look at the **log**.
3. Reproduce the problem and create **supout.rif** while it happens.
4. Describe the network, version and the exact steps.
