# Lesson: Accessing the router

### Management methods

| Method | Transport | Notes |
|---|---|---|
| **Winbox** | IP (TCP 8291) or **MAC** (Layer 2) | Main GUI tool. v3 is Windows only (Wine on Linux/macOS). **Winbox 4** runs natively on Windows, Linux and macOS |
| **WebFig** | HTTP 80 / HTTPS 443 | Browser GUI, almost the same as Winbox |
| **MikroTik mobile app** | IP or MAC | Android / iOS |
| **CLI** | Telnet 23, SSH 22, serial console, local monitor/keyboard | Also available from Winbox: *New Terminal* |
| **API** | TCP 8728 / API-SSL 8729 | For programs and scripts |
| **REST API** | HTTP/HTTPS (v7 only) | JSON over the www/www-ssl service |

### First login

- Default user **admin**. Older devices: empty password. Newer devices (since 2021-ish): the password is printed on the **sticker** on the device.
- The default configuration on a home router: **ether1 = WAN** (DHCP client), other ports in a **bridge** with **192.168.88.1/24**, a DHCP server, NAT masquerade and a basic firewall.
- **MAC-Winbox** works even when the router has no IP address. The **Neighbors** tab in Winbox discovers devices using **MNDP** (MikroTik Neighbor Discovery Protocol), **CDP** and **LLDP** (UDP 5678 for MNDP).

![Winbox login: connect to the MAC address or to the IP address of the router (course slide)](/img/mtcna/na4-12.webp)

![The Neighbors tab lists routers found by MNDP, CDP and LLDP (course slide)](/img/mtcna/na4-13.webp)

### Lab 2.1 (from the course)

1. Reset the router to default configuration.
2. Connect the laptop to one of the ports **ether2-ether5**.
3. Open Winbox, go to Neighbors and connect using the **MAC address**.

![QuickSet: the basic settings in one window (course slide)](/img/mtcna/na4-19.webp)

### Resetting the router

The password **cannot** be reset on its own. Your options are:

1. **Reset the configuration** using the reset button.
2. **Netinstall** (reinstall RouterOS).

![Reset with the button: hold RES while powering on, release when the ACT LED starts blinking (course slide)](/img/mtcna/na4-07.webp)

![System > Reset Configuration with its options (course slide)](/img/mtcna/na4-42.webp)

**Reset button (RES)** behaviour when held while powering on:

| Hold time | Result |
|---|---|
| Released before LED starts flashing (≈ 3 s after power) | Load **backup RouterBOOT** |
| Until the **ACT LED starts flashing** (≈ 5 s), then release | **Reset configuration** to defaults |
| Keep holding until the LED turns **solid** (≈ 10 s) | Reset and start in **CAPsMAN client** mode |
| Keep holding until the LED turns off (≈ 15 s) | Look for a **Netinstall** server |

You can also reset in software: **System > Reset Configuration** with options *Keep User Configuration*, *No Default Configuration*, *Do Not Backup*, *Run After Reset* (a script to run). From the CLI:

    /system reset-configuration no-defaults=yes skip-backup=yes

# Lesson: Working in the CLI

### Structure

The CLI is organised as a tree of **menus**: `/interface`, `/ip address`, `/ip route`, `/system identity`... Each menu has **commands**: `print`, `add`, `set`, `remove`, `enable`, `disable`, `export`, `find`...

![The terminal inside Winbox (course slide)](/img/mtcna/na4-23.webp)

    [admin@MikroTik] > /ip address
    [admin@MikroTik] /ip address> add address=192.168.88.1/24 interface=bridge
    [admin@MikroTik] /ip address> print
    [admin@MikroTik] /ip address> ..
    [admin@MikroTik] /ip>

- `/` at the start = absolute path from the root. `..` = up one level.
- Items are referenced by the number shown in the last `print` (e.g. `set 0 disabled=yes`) or by name (`/interface set ether1 name=WAN`).

### Keys you must know

| Key | Action |
|---|---|
| **Tab** | Complete the word; **double Tab** lists possible values |
| **?** (v6) / **F1** (v7) | Help for the current position |
| **↑ / ↓** | Command history |
| **Ctrl+C** | Interrupt the running command |
| **Ctrl+D** | Log out (on an empty line) |
| **Ctrl+K** | Delete from cursor to end of line |
| **Ctrl+X** (also F4 in v7) | Toggle **Safe Mode** |
| **Ctrl+V** | Toggle hotlock (instant completion) |
| **Ctrl+L / F5** | Clear screen |

### Safe Mode

Turn Safe Mode on before risky changes on a remote router. If the management connection is lost, RouterOS **automatically reverts** all changes made in Safe Mode. Winbox has a **Safe Mode** button in the top left.

> Practise in the **RouterOS Terminal** simulator: try `/system identity set name=R1`, then `/ip address print`.

# Lesson: Users, services and identity

### Identity

    /system identity set name=Office-R1

The identity appears in the prompt, in Winbox Neighbors and in the default backup file name.

### Users and groups

Default groups: **full**, **write**, **read**. You can create your own groups with a custom set of policies (ssh, winbox, ftp, reboot, write, policy, test, sensitive...).

    /user add name=john group=read password=Str0ng!
    /user set admin password=NewSecret

A good practice: create your own *full* user, then **disable or remove admin**. You can also restrict each user with **allowed-address**.

> Winbox *Settings > Hide Passwords* hides passwords in Winbox windows, but **not** on the System > Users list.

### IP services

| Service | Default port | Default |
|---|---|---|
| telnet | 23 | enabled |
| ftp | 21 | enabled |
| www | 80 | enabled |
| ssh | 22 | enabled |
| www-ssl | 443 | disabled (needs a certificate) |
| api | 8728 | enabled |
| winbox | 8291 | enabled |
| api-ssl | 8729 | enabled |

![IP > Services: the management services and their ports (course slide)](/img/mtcna/na4-31.webp)

(Defaults vary slightly between versions.) Hardening checklist:

1. **Disable** services you do not use: `/ip service disable telnet,ftp,www,api,api-ssl`
2. Set **available-from** (`address=`) for the rest: `/ip service set winbox address=192.168.88.0/24`
3. Optionally change default ports: `/ip service set ssh port=2222`

### Course notes on identity and note

- Identity is **MikroTik** by default, up to **64 characters**, and makes devices easy to tell apart. **Lab 5.2**: set the identity to *X_Y_YourName* (e.g. 33_5_Oleg).
- **System > Note** (`/system note set note="..."`, show-at-login=yes) displays a banner at login: a legal warning or a reminder for your colleagues ("do not forget Safe Mode!").

### Course notes on users

- The user database is stored locally. A **.backup** contains users and passwords; an **export** does **not** contain system users.
- Rename or delete the default **admin** (you need another *full* user first).
- Passwords: more than 8 characters with upper/lower case letters, digits and symbols, changed periodically.
- With many administrators, use central authentication (**RADIUS**) instead of local users.

**Lab 5.10**: create a new user **man** with password **Man33ioP** in group **full**, log in with it, then disable or remove **admin**.

# Lesson: Monitoring the router

- **System > Resources**: uptime, free memory, CPU load, free HDD, board name, architecture and RouterOS version. CLI: `/system resource print`.
- **Tools > Profile**: which process uses the CPU. CLI: `/tool profile cpu=all`.
- **Dashboard** (Winbox 4 / WebFig) gives a quick overview.
- **Log**: `/log print`.

![System > Resources: CPU, memory, uptime and storage (course slide)](/img/mtcna/na4-26.webp)

![Interface flags: R running, S slave in a bridge, D dynamic, X disabled (course slide)](/img/mtcna/na5-35.webp)

# Lesson: Backup, export and files

### Two kinds of backup

| | **Binary backup** (.backup) | **Export** (.rsc) |
|---|---|---|
| Format | Binary, not human-readable | Plain text script |
| Editable | No | Yes |
| Contains users and passwords | **Yes** | **No** (system users are not exported) |
| Partial | No, whole configuration | Yes, any menu (e.g. only `/ip address`) |
| Restore | Same device (or identical model) | Any device, by `import` |
| Where | Files > Backup, `/system backup save` | **CLI only**: `export` |

![Files > Backup creates a binary backup of the configuration (course slide)](/img/mtcna/na4-38.webp)

Default backup name: **identity-date-time.backup**.

    /system backup save name=before-change
    /export file=allconfig
    /ip address export file=ipaddresses
    /import file-name=ipaddresses.rsc

Use `export show-sensitive` (v7) or `export hide-sensitive` (v6) to control whether passwords and keys appear.

### Storage

If a device has a **/flash** folder, the root of the filesystem is in RAM and is **lost on reboot**; save files you want to keep inside `/flash`. If there is no /flash folder, the root itself is non-volatile.

### Backing up many routers

Use scripts with **scheduler** + **/tool e-mail** or **/tool fetch** to send backups off the router, or a central tool (The Dude, Ansible, Oxidized, etc.).
