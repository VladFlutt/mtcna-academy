# Lesson: Simple queues

**Queues** limit and prioritise traffic. The easiest tool is the **simple queue** (**Queues > Simple Queues**).

    /queue simple add name=laptop target=192.168.88.254/32 max-limit=1M/1M

- **target**: whose traffic is limited: an IP, subnet, several addresses or an **interface**.
- **max-limit** = upload/download (from the client's point of view: `upload/download`). It can be set for upload, download, or as a total.
- **dst** (optional): limit only traffic going to a specific destination.
- Simple queues are processed **top to bottom**; the **first** matching queue takes the traffic. A more specific queue must be **above** the general one.

### Example from the course

Limit all users to 1M, but allow 3M to the server 5.8.63.23:

1. Queue *server*: target=192.168.88.0/24, dst=5.8.63.23, max-limit=3M/3M
2. Queue *all*: target=192.168.88.0/24, max-limit=1M/1M

If the order is reversed, the 1M queue catches everything and the 3M queue never matches.

### Lab 9.1

Limit your laptop to 1M/1M, then run a speed test and watch with **Torch**.

### limit-at, max-limit and priority

- **limit-at** (CIR): guaranteed rate.
- **max-limit** (MIR): maximum rate if bandwidth is available.
- **priority** 1..8: **1 is highest**, **8 is lowest** (default 8). Priority decides who gets the spare bandwidth between limit-at and max-limit among child queues of the same parent.
- **parent**: queues can be nested in a tree; children share the parent's limit.

# Lesson: Burst

**Burst** lets a client exceed max-limit for a short time, which makes browsing feel fast while large downloads are still limited.

Parameters (per direction):

- **burst-limit**: maximum rate during burst (must be higher than max-limit).
- **burst-threshold**: when the **average** rate is **below** this value, burst is allowed (usually between limit-at and max-limit).
- **burst-time**: the window (seconds) over which the **average** rate is calculated. It is **not** how long the burst lasts.

The average is recalculated every **burst-time/16**. Maximum burst duration from idle = burst-threshold × burst-time / burst-limit.

Example from the course: max-limit=2M, burst-limit=5M, burst-threshold=1M, burst-time=10s. A user who was idle gets 5M for about 2 s (1M × 10 s / 5M), then drops to 2M. After a pause the average falls below 1M again and the next burst is possible.

> Watch the graph in the **Burst simulator**.

# Lesson: PCQ

**PCQ** (Per Connection Queue) automatically creates a sub-queue for each user (or connection) based on a **classifier**, and divides bandwidth equally. One queue serves the whole network.

- For **download** use classifier **dst-address**; for **upload** use **src-address**.
- **pcq-rate**: the maximum rate per sub-stream. **pcq-rate=0** means no per-user limit: the available bandwidth is shared **equally**.

    /queue type add name=pcq-down kind=pcq pcq-classifier=dst-address pcq-rate=0
    /queue type add name=pcq-up kind=pcq pcq-classifier=src-address pcq-rate=0
    /queue simple add name=lan target=192.168.88.0/24 max-limit=10M/10M queue=pcq-up/pcq-down

### How the rate is shared

With max-limit=512k:

| pcq-rate | Users | Each user gets |
|---|---|---|
| 128k | 1 | 128k |
| 128k | 4 | 128k |
| 128k | 7 | ≈73k (512k / 7) |
| 0 | 1 | 512k |
| 0 | 2 | 256k |
| 0 | 8 | 64k |

Built-in queue types include **default** (pfifo), **default-small**, **ethernet-default**, **wireless-default** (sfq), **synchronous-default** (red), **hotspot-default** (sfq), **pcq-download-default**, **pcq-upload-default**, **only-hardware-queue** and **multi-queue-ethernet-default**.

> Try the **PCQ simulator**.

# Lesson: Mangle and packet marks

**Mangle** (**IP > Firewall > Mangle**) **marks** packets so queues and routing can recognise them.

- Marks are **local** to the router: they are never sent on the wire.
- Mark types: **connection-mark**, **packet-mark**, **routing-mark** (in v7: routing tables). A packet can carry **one** of each.
- Mangle can also change **DSCP (TOS)**, **TTL**, **MSS** and a few other header fields.
- Rules run top to bottom; **passthrough=yes** means continue to the next rule after marking.

### Optimal marking

Marking every packet by its addresses and ports costs CPU. Mark the **connection** once, then mark packets by the **connection mark**:

    /ip firewall mangle
    add chain=prerouting src-address=192.168.33.0/24 protocol=tcp dst-port=80 \
        connection-state=new action=mark-connection new-connection-mark=web_conn passthrough=yes
    add chain=prerouting connection-mark=web_conn action=mark-packet \
        new-packet-mark=web_packet passthrough=no
    /queue simple add name=WEB_Limit target=192.168.33.0/24 packet-marks=web_packet \
        max-limit=2M/2M queue=pcq-upload-default/pcq-download-default

### Lab 9.2

1. Limit every LAN user to 1M (PCQ).
2. Give the **BOSS** group (address list) 3M.
3. Web traffic: everyone gets burst up to 5M, then 2M.

# Lesson: Monitoring traffic

- **Torch** (**Tools > Torch**): real-time traffic on an interface, filtered and grouped by src/dst address, port, protocol, VLAN. Perfect to find "who is using my bandwidth".
- **Graphing** (**Tools > Graphing**): long-term graphs of interfaces, queues and resources, viewed in a browser at **http://router-ip/graphs/**. Set *allow-address* to control who may view them.
- **Bandwidth Test** (**Tools > Bandwidth Test**): measure throughput between two MikroTik devices (or with the Windows btest.exe) using TCP or UDP, send/receive/both. The **BTest server** (`/tool bandwidth-server`) must be enabled on the far end; it uses TCP 2000 and UDP 2001-2100+, max sessions 100. Testing to the router itself measures its CPU too: test **through** the router when possible.
