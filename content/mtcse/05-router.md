# Lesson: Port knocking

> This module follows the MTCSE course slides, chapter 5 "Security Router".

### What is port knocking

**Port knocking** is a method of **externally opening ports** on a firewall by generating a **connection attempt on a set of pre-specified closed ports**. Once the correct sequence of connection attempts is received, the firewall rules are **dynamically modified** to allow the host which sent the attempts to connect over specific ports.

A "knock" can be any number of **TCP, UDP or even ICMP and other protocol packets** to numbered ports on the destination machine. The ports used for knocking stay **closed**: nobody answers, so a scanner sees nothing.

Think of a secret knock on a door: the door is locked and silent, but if you knock *three, then two, then one*, somebody opens it, only for you.

### How RouterOS does it

There is no special "knock" feature. You build it from **address lists with timeouts**:

1. A packet to the first port puts the source into list **knock1** for a short time.
2. A packet to the second port, **only from a source already in knock1**, puts it into **knock2**.
3. A packet to the third port from a source in knock2 puts it into **knock-final** for a long time.
4. The protected service is dropped for every source **not** in knock-final.

### The slide rules

    /ip firewall filter
    add action=add-src-to-address-list address-list=knock1 address-list-timeout=10s \
        chain=input dst-port=11111 protocol=tcp
    add action=add-src-to-address-list address-list=knock2 address-list-timeout=10s \
        chain=input dst-port=22222 protocol=tcp src-address-list=knock1
    add action=add-src-to-address-list address-list=knock-final address-list-timeout=1d \
        chain=input dst-port=33333 protocol=tcp src-address-list=knock2
    add action=drop chain=input dst-port=8291 protocol=tcp src-address-list=!knock-final

![Port knocking rules from the slides (course slide)](/img/mtcse/se5-04.webp)

The `!` in `src-address-list=!knock-final` means **NOT**: the rule matches sources that are **not** in the list.

### Follow the knocks step by step

| Time | The client sends | Lists after the packet | Winbox? |
|---|---|---|---|
| 0 s | TCP to 11111 | knock1 (expires at 10 s) | Dropped |
| 3 s | TCP to 22222 | knock1, knock2 (expires at 13 s) | Dropped |
| 5 s | TCP to 33333 | knock1, knock2, **knock-final (1 day)** | Dropped |
| 6 s | TCP to 8291 | knock-final | **Accepted** |

And three ways to fail:

- **Too slow**: knock 11111, wait 15 s, then 22222 and 33333. knock1 already expired, so 22222 does not add the source to knock2, and 33333 does nothing either. Winbox stays closed.
- **Wrong order** (33333, 22222, 11111): the 33333 rule needs knock2, the 22222 rule needs knock1. Nothing opens.
- **Skipped knock** (11111, 33333): 33333 requires knock2, which was never reached.

### Knock clients

Any tool that sends a packet to a port works (even a browser or telnet). The slides list:

- **Linux**: install with `apt-get install knockd` (the package contains the `knock` client).
- Usage: `knock host 12345:tcp 54321:udp`. This sends TCP to 12345, then UDP to 54321.
- Windows and Android have knock apps too.

Example for our rules:

    knock 22.1.1.33 11111 22222 33333
    # now connect with Winbox to 22.1.1.33 within one day

### Weaknesses

Port knocking is an **extra layer**, not a replacement for passwords and encryption. The knocks are sent in clear text: someone who can **sniff** your traffic can see and **replay** the sequence. Combine it with limited services, strong users and the brute-force protection.

### Slide lab

> **Lab:** *Open Winbox access with port knocking. Create rules in a new chain. Make sure the brute-force protection still works.*

Step by step:

1. Create the three knock rules in a chain called **knock** instead of input.
2. In input, add `action=jump jump-target=knock` (for TCP) **before** the final drop.
3. Add the drop rule for TCP 8291 from sources **not** in knock-final.
4. Keep the SSH brute-force rules from module 3 working.

    /ip firewall filter
    add chain=knock protocol=tcp dst-port=11111 action=add-src-to-address-list \
        address-list=knock1 address-list-timeout=10s
    add chain=knock protocol=tcp dst-port=22222 src-address-list=knock1 \
        action=add-src-to-address-list address-list=knock2 address-list-timeout=10s
    add chain=knock protocol=tcp dst-port=33333 src-address-list=knock2 \
        action=add-src-to-address-list address-list=knock-final address-list-timeout=1d
    add chain=input protocol=tcp action=jump jump-target=knock place-before=0
    add chain=input protocol=tcp dst-port=8291 src-address-list=!knock-final action=drop place-before=1

The packets to 11111, 22222 and 33333 are still dropped at the end of input: the knock only has to **reach** the router, it does not need an answer.

Try it in the **Port knocking simulator** and in the lab **"Open Winbox with port knocking"**.

# Lesson: Default ports of services

### Port numbers

- A port is a 16-bit number: **0-65535**.
- **IANA** (Internet Assigned Numbers Authority) assigns them. The old list was published in **RFC 1700**.
- **0-1023**: **well-known ports** (system services: 22 SSH, 80 HTTP, 443 HTTPS...).
- 1024-49151: registered ports; 49152-65535: dynamic (client) ports.

### RouterOS services and their default ports

| Service | Default port |
|---|---|
| telnet | 23 |
| ftp | 21 |
| www | 80 |
| ssh | 22 |
| www-ssl | 443 |
| api | 8728 |
| winbox | 8291 |
| api-ssl | 8729 |

Bots scan exactly these ports first. Moving a service to an unusual port does not make it secure, but it removes most of the automated noise from your logs.

### The slide configuration

    /ip service
    set telnet disabled=yes
    set ftp disabled=yes
    set www port=8800
    set ssh port=22000
    set api disabled=yes
    set www-ssl certificate=webfig disabled=no port=44300
    set winbox port=58291

After this:

- **ssh** is reached with `ssh -p 22000 admin@router`.
- **Winbox** with the address `router:58291`.
- **WebFig** with `http://router:8800` or `https://router:44300`.

**www-ssl** needs a certificate. For a quick test create and self-sign one:

    /certificate add name=webfig common-name=192.168.33.1 key-usage=tls-server
    /certificate sign webfig

> The slide's last line: **"also use firewall rules"**. A changed port is found by a full port scan within minutes. Limit the services with `address=` and drop management from the WAN in the input chain.

Practise in the lab **"Move services off default ports"**.

# Lesson: SSH tunneling

### What it is

An **SSH tunnel** (port forwarding) carries other TCP connections **inside an encrypted SSH session**. The slides describe it as a way to *encapsulate unencrypted traffic and carry it through an encrypted channel*. Typical use: reach a service that is **not open to the Internet** (WebFig, a database, Winbox) when only SSH is open.

### Local forwarding: ssh -L

    ssh -L 9999:localhost:5432 host2

Read it from left to right:

1. **9999**: your computer starts listening on local port 9999.
2. **host2**: you open an SSH session to host2.
3. **localhost:5432**: connections that arrive at your local 9999 are carried through SSH and delivered to `localhost:5432` **as seen from host2**. "localhost" here is **host2 itself**, not your PC.

So your PostgreSQL client connects to `127.0.0.1:9999` on your PC and actually talks to the database on host2, which accepts only local connections.

### The Blue and Red server example from the slides

- The **Blue server** is reachable over SSH.
- The **Red server** is behind it, not reachable from your PC.
- `ssh -L 8080:red:80 user@blue` makes `http://127.0.0.1:8080` on your PC show the web page of Red. The SSH server (Blue) opens the connection to Red for you.

![An SSH tunnel carries an unencrypted service through the firewall (course slide)](/img/mtcse/se5-09.webp)

### RouterOS as the SSH server

The router must allow forwarding first:

    /ip ssh set forwarding-enabled=both

![Local forwarding through RouterOS step by step (course slide)](/img/mtcse/se5-10.webp)

Values: **no** (default), **local** (`-L` from clients), **remote** (`-R`), **both**.

### Example: WebFig through SSH with PuTTY

Only SSH is open on the router. You want WebFig without opening HTTP.

**Linux/macOS:**

    ssh -L 2000:127.0.0.1:80 admin@router

Then open `http://127.0.0.1:2000` in your browser: you see the router's **WebFig**, carried encrypted inside SSH.

**Windows (PuTTY)**: Connection → SSH → Tunnels, *Source port* 80 (or 2000), *Destination* `127.0.0.1:80`, click Add, then connect. The slide's command line form is `putty -L 80:127.0.0.1:80 router`.

Note in both cases: **127.0.0.1 is interpreted by the SSH server** (the router), so it means the router's own WebFig.

### Remote forwarding: ssh -R

The opposite direction: `ssh -R 8080:localhost:80 server` makes port 8080 on the **server** forward back to port 80 on **your** machine. Useful to give support temporary access through a jump host.

> See the **SSH tunnel builder** simulator, which draws where each address in the `-L` string is interpreted.
