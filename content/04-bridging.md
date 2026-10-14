# Lesson: Bridge concepts

A **bridge** joins several interfaces into one **Layer 2 broadcast domain**, like a switch. Devices on bridged ports are in the same network and can talk without routing.

- On MikroTik, Ethernet ports are **independent** by default (each is its own interface). Grouping them is done with a bridge.
- The default configuration puts **ether2-ether5** (and wlan) in a bridge called **bridge**; **ether1** stays separate as WAN.
- Once a port is in a bridge, configure IP addresses, DHCP servers and so on **on the bridge interface**, not on the port.

### Hardware offloading

On devices with a switch chip, bridge ports can be switched by hardware: the **H** flag in `/interface bridge port print`. Traffic between them does not use the CPU. Only one bridge per device can be hardware offloaded (on most switch chips).

# Lesson: Creating a bridge

    /interface bridge add name=bridge-lan
    /interface bridge port add bridge=bridge-lan interface=ether2
    /interface bridge port add bridge=bridge-lan interface=ether3
    /interface bridge port add bridge=bridge-lan interface=wlan1
    /ip address add address=192.168.10.1/24 interface=bridge-lan

> **Watch out:** if you are connected through ether2 by IP and move ether2 into a bridge, the IP address that was on ether2 stops working and you lose the connection. Use **MAC-Winbox** or **Safe Mode** when changing bridge ports.

### Wireless in a bridge

An AP in **ap-bridge** mode can be put into the bridge so that wireless and wired clients share one network. A station in **station** mode **cannot** be bridged (802.11 only allows one MAC per station). For transparent bridging on the client side, use **station-bridge** (MikroTik-to-MikroTik), **station-pseudobridge** or **WDS**.

### Course view: you decide what is WAN and LAN

After a reset to an **empty** configuration ("no defaults") all ports are independent: you decide how many WAN and LAN ports you have and which ones. Since **v6.41** joining interfaces into one Layer 2 domain is done the same way on every device (with a **bridge**), regardless of whether a switch chip exists. The typical layout:

- **ether1 = WAN**: all WAN L2/L3 configuration goes on ether1.
- **ether2-ether5 (+ wlan1) = bridgeLAN**: all LAN L2/L3 configuration goes on **bridgeLAN**.
- Ports with the **S** (slave) flag get **no** L2/L3 configuration of their own (only L1: speed, duplex...).

The switch chip forwards frames between bridge ports at wire speed (**hardware offload**), otherwise the CPU does it. Look at the device **block diagram** (on mikrotik.com) to see which ports share a switch chip.

### Interface flags

| Flag | Meaning |
|---|---|
| **R** | Running (link up, L1) |
| **S** | Slave: the interface is a bridge port |
| **D** | Dynamic |
| **X** | Disabled |
| **H** | (bridge port) hardware offloading is active |

### Lab 5.1

1. Reset the router to an **empty** configuration (no default config).
2. Create **bridgeLAN** and add ether2-ether4 (and wlan1); ether1 (or wlan1) is the WAN.
3. Give the interfaces meaningful names/comments.
4. Make the physical connection and check the running status (**R** flag).

# Lesson: Spanning tree

Two bridged links between the same switches create a **loop**: broadcasts circulate forever and the network stops. **(R)STP** blocks redundant paths.

- RouterOS bridges use **RSTP** by default (`protocol-mode=rstp`). MSTP is also available.
- The bridge with the lowest **priority** (and then lowest MAC) becomes the **root bridge**.
- Port roles: **root port**, **designated port**, **alternate/backup** (blocked).
- Edge ports (to PCs) can be set `edge=yes` to skip the listening/learning delay.

# Lesson: VLAN basics

A **VLAN** (802.1Q) splits one physical network into several logical ones with a 4-byte tag (VLAN ID 1-4094).

    /interface vlan add name=vlan10 vlan-id=10 interface=ether2
    /ip address add address=10.10.10.1/24 interface=vlan10

For MTCNA you need to know what a VLAN is and how to create a VLAN interface. VLAN filtering in the bridge is covered in MTCSWE.
