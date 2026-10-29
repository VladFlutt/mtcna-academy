# Lesson: Routing tables

Normal routing looks only at the **destination** address. Sometimes the decision must depend on something else:

- the accountant's PC must use the second ISP;
- VoIP goes over the fibre, everything else over LTE;
- a connection that came in through ISP2 must be answered through ISP2;
- guests and staff use different uplinks.

**Policy based routing** (PBR) solves this with several routing tables. Each table is a complete set of routes; a policy decides which table a packet is looked up in.

## Creating a table (RouterOS 7)

    /routing table add name=isp2 fib
    /ip route add gateway=172.16.2.1 routing-table=isp2

- `fib` means that the table is pushed to the forwarding engine. A table without `fib` exists only for routing protocols and can not be used to forward packets.
- The table **main** always exists. Routes without `routing-table=` go there.
- A routing table only needs the routes that should be different. Here isp2 holds just a default route.

Print one table:

    /ip route print where routing-table=isp2

> **RouterOS 6:** there were no table objects. A route got `routing-mark=isp2`, and the mark name was the table. The same idea, a different syntax: `/ip route add gateway=172.16.2.1 routing-mark=isp2`.

## Two ways to choose a table

1. **Routing rules** (`/routing rule`): match on source and destination address, incoming interface, or a routing mark, and say which table to use.
2. **Mangle** (`action=mark-routing`): mark packets with any firewall matcher (ports, protocols, address lists, connection marks) and the mark selects the table.

![Mangle marks and routing rules decide which table a packet is looked up in](/img/mtcre/pbr-flow.svg)

Use rules when source or destination addresses are enough; they are cheaper and easier to read. Use mangle when you need ports, protocols or connection state. Try both in the **Policy routing walk** simulator.

# Lesson: Routing rules

    /routing rule add src-address=192.168.1.20/32 action=lookup table=isp2
    /routing rule add dst-address=10.0.0.0/8 action=lookup-only-in-table table=main
    /routing rule add src-address=172.16.2.2/32 action=lookup table=isp2

Rules are checked **top to bottom**; the first rule that matches decides. If none matches, the main table is used.

## Matchers

| Matcher | Example |
|---|---|
| src-address | `src-address=192.168.1.0/24` |
| dst-address | `dst-address=10.0.0.0/8` |
| interface | `interface=ether5` (incoming interface) |
| routing-mark | `routing-mark=isp2` (mark set by mangle) |

## Actions

| Action | Meaning |
|---|---|
| lookup | look in this table; **if it has no matching active route, continue with main** |
| lookup-only-in-table | look in this table only; no route means the packet is dropped |
| drop | drop silently |
| unreachable | drop and send ICMP unreachable |

The difference between `lookup` and `lookup-only-in-table` is the difference between "prefer ISP2" and "only ever ISP2". With `lookup`, if the ISP2 cable is cut, the default route in table isp2 becomes inactive, the table is empty and the packet falls back to main (ISP1). With `lookup-only-in-table` the user is offline until ISP2 is back, which is what you want when traffic must never leave through another ISP (a VPN that must use a specific line, for example).

## Order matters

Put exceptions first. A typical layout:

1. traffic between your own LANs → main (so that local traffic does not go to an ISP);
2. specific users or servers → their ISP table;
3. everything else → main (no rule needed).

    /routing rule add dst-address=192.168.0.0/16 action=lookup-only-in-table table=main
    /routing rule add src-address=192.168.1.20/32 action=lookup table=isp2

> **RouterOS 6:** `/ip route rule add src-address=192.168.1.20/32 action=lookup table=isp2`. Same matchers and actions.

# Lesson: Mangle and routing marks

Mangle can set a routing mark on a packet in the **prerouting** chain (traffic through the router) or the **output** chain (traffic from the router). The routing decision then looks in the table with that name first.

    /ip firewall mangle add chain=prerouting src-address=192.168.1.0/24 protocol=tcp dst-port=443 \
        dst-address-type=!local action=mark-routing new-routing-mark=isp2 passthrough=no

- `dst-address-type=!local` keeps traffic to the router itself (DNS, Winbox) out of the mark.
- In RouterOS 7 the routing mark must be the name of an existing routing table.
- A marked packet is looked up in that table; if the table has no matching route, it falls back to main (like `action=lookup`).
- Only one routing mark per packet: a later rule overwrites the mark of an earlier one, so use `passthrough=no` once the decision is made.

## Mark connections, then route them

Marking every packet with many matchers is expensive and, worse, can split one connection: the first packet of a connection matches `dst-port=443`, but later packets of related flows might not. The robust pattern marks the **connection** once and derives the routing mark from it:

    /ip firewall mangle
    add chain=prerouting src-address=192.168.1.0/24 dst-port=443 protocol=tcp \
        connection-state=new action=mark-connection new-connection-mark=via-isp2
    add chain=prerouting connection-mark=via-isp2 in-interface=bridgeLAN \
        action=mark-routing new-routing-mark=isp2 passthrough=no

## FastTrack

Packets that are FastTracked skip mangle, so they never get a routing mark. If you use the default firewall with a FastTrack rule, exclude marked connections from it (add `connection-mark=no-mark` to the fasttrack rule) or PBR will work only for the first packets of each connection.

> **RouterOS 6:** the same mangle rules. The table was simply the routing mark of the route.

# Lesson: Two ISPs: answering on the right line

A router with two Internet connections, each with its own public address (172.16.1.2 from ISP1, 172.16.2.2 from ISP2), and a default route through ISP1.

Someone on the Internet connects to 172.16.2.2 (a VPN, Winbox, a port forward). The request arrives through ISP2. The router answers from 172.16.2.2… and looks up the default route in main, which points to ISP1. ISP1 receives a packet whose source address belongs to ISP2's network. A well-run ISP drops it (*reverse-path filtering*, BCP 38). The connection never works, and nothing in your logs says why.

## Fix 1: a rule by source address

Packets the router itself sends from 172.16.2.2 must leave through ISP2:

    /routing table add name=isp2 fib
    /ip route add gateway=172.16.2.1 routing-table=isp2
    /routing rule add src-address=172.16.2.2/32 action=lookup table=isp2

This covers traffic to and from the router itself. The **PBR** lab checks exactly this: WEB on the Internet must be able to ping 172.16.2.2.

## Fix 2: port forwards (connection marks)

For a port forward to a LAN server, the reply comes from the server's private address and is translated back to 172.16.2.2 only after the routing decision. A rule by source address can not see it, so mark the connection by the interface it came in on and route its replies with that mark:

    /ip firewall mangle
    add chain=prerouting in-interface=ether2 connection-state=new \
        action=mark-connection new-connection-mark=from-isp2
    add chain=prerouting in-interface=bridgeLAN connection-mark=from-isp2 \
        action=mark-routing new-routing-mark=isp2 passthrough=no
    add chain=output connection-mark=from-isp2 action=mark-routing new-routing-mark=isp2 passthrough=no

## NAT with two ISPs

Masquerade separately on each WAN interface:

    /ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade
    /ip firewall nat add chain=srcnat out-interface=ether2 action=masquerade

Since src-nat happens after routing, the packet gets the address of whatever interface the routing decision chose.

## Failover for the policy

If PC2 uses ISP2 through a `lookup` rule and ISP2's cable is cut, table isp2 becomes empty and PC2 falls back to main. To also catch silent failures, put `check-gateway=ping` on the route in table isp2. The lab's last task cuts the cable to ISP2 and checks that PC2 still gets out.

## rp-filter on your own router

RouterOS has the same protection: `/ip settings set rp-filter=strict` drops packets whose source address would not be routed back out of the interface they came in on. With two ISPs and policy routing, strict mode can drop legitimate traffic; use `loose` (the source must be routable through any interface) or leave it off on multi-homed routers.
