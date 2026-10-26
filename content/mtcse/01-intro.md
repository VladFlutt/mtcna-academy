# Lesson: What security means

**MTCSE** (MikroTik Certified Security Engineer) is the MikroTik course about protecting networks and the routers themselves. It assumes you know MTCNA: interfaces, IP addresses, the firewall basics, NAT and PPP tunnels. Here we go deeper: how attacks actually work, how to stop them with RouterOS, and how to build encrypted tunnels for people who work from outside the office.

### Who attacks and why

Before you protect something you should know who is on the other side:

| Attacker | Typical goal | Typical method |
|---|---|---|
| **Bots** (automated scanners) | Any vulnerable device they can use | Scan the whole Internet for open ports, try default passwords |
| **Script kiddies** | Fun, reputation | Ready-made tools against well-known holes |
| **Criminals** | Money: ransom, stolen data, a botnet to rent | Phishing, brute force, exploits |
| **Insiders** | Revenge, curiosity, money | They are already inside the LAN |

> **Beginner tip:** a router with a public IP address is attacked within **minutes** after it goes online. Nobody has to "find" you: bots try every address one by one. Security is not optional even for a home router.

### The CIA triad

Every security problem damages at least one of three properties:

- **Confidentiality**: only authorized people can read the data. Broken by sniffing, stolen passwords, unencrypted protocols (telnet, ftp, http).
- **Integrity**: the data is not changed on the way. Broken by man-in-the-middle attacks, ARP spoofing, forged DNS answers.
- **Availability**: the service works when it is needed. Broken by **DoS** and **DDoS** attacks, but also by a misconfigured firewall that locks out the administrator.

Example: an attacker floods a web shop with traffic. Nobody can read or change the data, but customers cannot buy anything. This is an attack on **availability**.

### Authentication, authorization, accounting

- **Authentication**: *who are you?* (user name + password, key, certificate).
- **Authorization**: *what are you allowed to do?* (user groups and policies in RouterOS).
- **Accounting**: *what did you do?* (logs, RADIUS accounting).

You will meet these words again in PPP, IPsec and RADIUS.

### Defense in depth

One protection is never enough, because one mistake is always possible. **Defense in depth** means several independent layers, so an attacker has to break all of them:

1. The service listens only where it is needed (`/ip service ... address=`).
2. The firewall drops management traffic from the Internet.
3. Users have strong passwords or keys, the default **admin** is gone.
4. RouterOS is up to date.
5. Logs show what happens.

If you forget layer 2, layer 1 still protects you, and so on.

# Lesson: Threats and types of attack

> This lesson follows the course slides, chapter 1 "Basic Concepts".

### Prevention, detection, reaction

Security work is never only about blocking things. The slides split it into three jobs, and you need all three:

- **Prevention**: stop the attack before it happens (firewall rules, closed services, strong users, updates).
- **Detection**: notice that something is happening (logs, address lists, DHCP alerts, graphs, `tool profile`).
- **Reaction**: do something about it (drop the source, disable a port, restore a backup, call the ISP).

A router with a perfect filter but no logging has prevention and nothing else. When something does slip through, you will not even know.

### Identification, authentication, authorization

Three words that sound alike and are asked about in the exam:

| Step | Question it answers | Example |
|---|---|---|
| **Identification** | *Who do you claim to be?* | You type the user name `vlad` |
| **Authentication** | *Can you prove it?* | You send the password, key or certificate |
| **Authorization** | *What may you do now?* | RouterOS applies the group policies of `vlad` |

Accounting (*what did you do?*) is the fourth step: logs and RADIUS accounting.

### Four classes of attack

Every attack changes the normal flow "sender → receiver" in one of four ways:

| Class | What happens | Property attacked | Example |
|---|---|---|---|
| **Interception** | Someone else reads the traffic as well | Confidentiality | Sniffing telnet, ARP spoofing |
| **Interruption** | The traffic never arrives | Availability | DoS, DDoS, cut cable |
| **Modification** | The traffic arrives changed | Integrity | Man-in-the-middle rewriting a page |
| **Fabrication** | Traffic appears that nobody sent | Authenticity | Spoofed DHCP offers, forged e-mail |

> **How to use this:** when you read about a new attack, first ask which of the four it is. That immediately tells you which defence family to reach for: encryption against interception, filtering and capacity against interruption, signatures and hashes against modification, authentication against fabrication.

### The threat catalogue from the slides

**Botnet.** A network of infected machines (bots) controlled by a **bot herder** through **command and control (CnC)** servers. The slides show three shapes:

- **Client-server, star**: every bot talks to one CnC server. Simple, but take down the server and the botnet is dead.
- **Client-server, multi-server / hierarchical**: several CnC servers, or layers of them, so losing one does not stop the rest.
- **Peer-to-peer**: no fixed server at all; bots pass commands to each other. Hardest to kill.

**DDoS.** A distributed denial of service, usually run from a botnet. Three families:

- **Volumetric**: fill the link (UDP flood, amplification). Measured in bits per second.
- **Protocol**: exhaust a table or state (SYN flood, ping of death). Measured in packets per second.
- **Application**: exhaust the server itself with valid-looking requests (HTTP flood, slow requests).

**Malware and friends:**

| Threat | What it is |
|---|---|
| **Virus** | Code that attaches itself to a file and needs a user to run it |
| **Worm** | Spreads by itself over the network, no user needed |
| **Trojan** | Looks like useful software, carries something else inside |
| **Ransomware** | Encrypts your data and asks for payment |
| **Spyware** | Collects what you type and where you go |
| **Adware** | Injects advertising, often as a side effect of spyware |
| **Spam** | Unwanted bulk mail, the delivery van for phishing and malware |

**Phishing** is the social part, and the slides name four flavours:

- **Deceptive phishing**: mass mail pretending to be a bank or a service.
- **Spear phishing**: written for one person, using details about them.
- **Whaling**: spear phishing aimed at a director or an owner.
- **Pharming**: no mail at all; the DNS answer or the hosts file is poisoned, so the right address takes you to the wrong server.

**Spoofing** means pretending to be someone else at the protocol level:

- **IP spoofing**: a fake source address (used in DDoS and smurf attacks). Answer: `rp-filter` and RAW rules.
- **DNS spoofing**: a fake DNS answer. Answer: trusted resolvers, DNS over HTTPS/TLS, static entries.
- **E-mail spoofing**: a fake `From:`. Answer: SPF, DKIM, DMARC on the mail side.

### Where to put the firewall

The slides compare four deployment options. There is no single right answer; there is a trade-off:

| Option | Plus | Minus |
|---|---|---|
| **Global firewall router** (one router filters everything) | One place to configure, cheapest | Single point of failure, all the CPU load lands on it |
| **Firewall on each specific router** | Rules live next to the network they protect, load is spread | Many places to keep in sync, easy to forget one |
| **Dedicated IPS/IDS appliance** | Deep inspection, signatures, reporting | Expensive, another device to run, can become a bottleneck |
| **MikroTik plus an IDS as a trigger** | The IDS only detects and tells RouterOS which address to drop; RouterOS does the cheap blocking | You must build and maintain the glue (scripts, API, address lists) |

The last option is the one the MTCSE course keeps coming back to: **detect in software, block in an address list, drop in RAW.** You will build exactly that pattern in the port scan and brute force labs.

# Lesson: Attack surface of a RouterOS device

The **attack surface** is everything an attacker can talk to. On a router it is the list of open services plus every protocol the router answers on the LAN.

### Management services

Open **IP > Services** (`/ip service print`):

| Service | Port | Encrypted? | Recommendation |
|---|---|---|---|
| telnet | TCP 23 | **No**, password in clear text | Disable |
| ftp | TCP 21 | **No** | Disable (use SFTP over SSH or Winbox files) |
| www | TCP 80 | **No** | Disable or limit to the LAN; prefer www-ssl |
| www-ssl | TCP 443 | Yes (TLS), needs a certificate | Only with a certificate |
| ssh | TCP 22 | Yes | Keep, limit by address |
| winbox | TCP 8291 | Yes | Keep, limit by address |
| api | TCP 8728 | **No** | Disable unless you need it |
| api-ssl | TCP 8729 | Yes (TLS) | Disable unless you need it |

Step by step: reduce the services on a fresh router.

    /ip service disable telnet,ftp,www,api,api-ssl
    /ip service set winbox address=192.168.88.0/24
    /ip service set ssh address=192.168.88.0/24
    /ip service print

After this, a Winbox or SSH connection from any other address is refused **by the service itself**, even if the firewall had a mistake.

### Layer 2 services

These work without an IP address, so the firewall does not see them:

- **MAC-Telnet** and **MAC-Winbox** (`/tool mac-server`): connect to the router by its MAC address.
- **Neighbor discovery** (MNDP, CDP, LLDP, `/ip neighbor discovery-settings`): the router announces its **identity, RouterOS version, board model, MAC and IP**. An attacker on the same segment learns exactly which exploit to try.
- **Bandwidth-test server** (`/tool bandwidth-server`): anyone with a valid login can make the router generate a lot of traffic.

Limit all of them to the LAN interface list:

    /interface list member print
    /tool mac-server set allowed-interface-list=LAN
    /tool mac-server mac-winbox set allowed-interface-list=LAN
    /tool mac-server ping set enabled=no
    /ip neighbor discovery-settings set discover-interface-list=LAN
    /tool bandwidth-server set enabled=no

### Other services that answer from the WAN

- **DNS**: with `allow-remote-requests=yes` the router answers DNS queries. If UDP/TCP 53 is open on the WAN, the router becomes an **open resolver** and is abused for **DNS amplification** attacks. Allow DNS only from the LAN in the input chain.
- **Socks, web proxy, UPnP**: disable when you do not use them.
- **RoMON**, **IP cloud**, **SNMP**: check that they are off or limited.

> **Rule of thumb:** for every service ask: *do I need it?* If not, turn it off. If yes, *who needs it?* Limit it to them.

# Lesson: Users, passwords and SSH keys

### The default admin

Every RouterOS has the user **admin** in group **full**. Bots know this name and try it first. The safe way to replace it:

1. Create your own user with a strong password.
2. Log out and log in **as the new user** (check that it really works).
3. Disable or remove admin.

    /user add name=vlad group=full password="Long-Unique-Pass-2024"
    # log in again as vlad, then:
    /user disable admin

> **Why not just change the admin password?** Then the attacker still knows half of the login (the user name). With your own user name they have to guess both.

### Groups and policies

A **group** is a set of **policies** (rights). Built-in groups: **full**, **write**, **read**. Important policies:

| Policy | Allows |
|---|---|
| local, telnet, ssh, ftp, web, winbox, api | Logging in through that way |
| read / write | Reading / changing the configuration |
| **policy** | Managing **users and groups** |
| reboot, test, sniff, sensitive, romon | Reboot, ping/traceroute, packet sniffer, viewing secrets, RoMON |

Example: a support engineer who may look at the configuration but not change it or see passwords:

    /user group add name=support policy=local,ssh,winbox,read,test,!write,!policy,!sensitive
    /user add name=helpdesk group=support password="Another-Strong-Pass"

You can also limit **where** a user may log in from: `/user set helpdesk address=192.168.88.0/24`.

### SSH keys

A key pair is safer than a password: the private key never leaves your computer and cannot be guessed.

Step by step (Linux/macOS):

1. On your PC: `ssh-keygen -t ed25519` (or `-t rsa -b 4096`). This creates `id_ed25519` (private, keep secret) and `id_ed25519.pub` (public).
2. Upload the `.pub` file to the router (Winbox Files, drag and drop, or `scp`).
3. Import it for your user:

    /user ssh-keys import public-key-file=id_ed25519.pub user=vlad

Then connect with `ssh vlad@192.168.88.1`. No password is asked.

### Strong SSH settings

    /ip ssh set strong-crypto=yes

**strong-crypto** disables weak ciphers and hashes (null, 3DES, MD5, SHA1) and prefers stronger ones (AES-CTR/GCM, SHA256). Old clients may fail to connect; update them instead of weakening the router.

# Lesson: Hardening checklist

### Safe Mode first

When you change the firewall or services **remotely**, one wrong rule can cut you off. Press **Safe Mode** in Winbox (or **Ctrl+X** in the terminal) before you start. If the connection is lost, RouterOS **undoes** all changes made in Safe Mode. When you are sure, press Safe Mode again to keep them.

### Step-by-step hardening of a new router

1. **Upgrade** RouterOS and the RouterBOOT firmware (`/system package update install`, then `/system routerboard upgrade` and reboot). Many past attacks, like the **2018 Winbox vulnerability** (CVE-2018-14847), worked only on routers that were never upgraded.
2. **Users**: your own user, disable admin, SSH keys, `strong-crypto=yes`.
3. **Services**: disable telnet, ftp, www, api, api-ssl; limit winbox and ssh with `address=`.
4. **Layer 2**: MAC server, MAC-Winbox and neighbor discovery only on the LAN list; MAC ping off.
5. **Extras**: bandwidth-test server off, DNS remote requests only from the LAN, UPnP/socks/proxy off.
6. **Firewall**: input chain accepts established/related, drops invalid, accepts management only from the LAN, drops the rest from the WAN (next module).
7. **Logging and backup**: send logs to a remote syslog, keep an encrypted backup (`/system backup save password=...`) and an export (`/export file=cfg`).
8. **Check** from outside: scan your WAN address with `nmap` and confirm that nothing unexpected is open.

### Quick check commands

    /ip service print
    /user print
    /tool mac-server print
    /ip neighbor discovery-settings print
    /ip ssh print
    /ip dns print

### Course lab

- **Lab "Harden a router with the default configuration"**: start from the default configuration and make it pass the checklist above. The checker verifies the users, services, address limits, MAC server and SSH settings.
