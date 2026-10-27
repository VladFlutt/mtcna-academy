# Lesson: Road warriors and VPN choices

> This module follows the MTCSE course slides, chapter 7 "Secure Tunnels", with extra explanations from the MikroTik documentation.

A **road warrior** is a user who connects to the office from anywhere: a hotel, a phone network, home. The address of the client is **unknown in advance** and often behind NAT. The VPN server is your router with a public address.

| Protocol | Transport | Encryption | Built into | Notes |
|---|---|---|---|---|
| PPTP | TCP 1723 + GRE | Broken (MPPE) | Old Windows | Do not use |
| **L2TP/IPsec** | UDP 1701 inside IPsec (UDP 500/4500, ESP) | IPsec | Windows, macOS, iOS, Android | Classic, widely supported |
| **SSTP** | TCP 443 (HTTPS) | TLS | Windows | Passes almost any firewall |
| **IKEv2** | UDP 500/4500, ESP | IPsec | Windows, macOS, iOS, Android | Modern, fast, MOBIKE |
| OpenVPN | TCP/UDP 1194 | TLS | Needs a client app | Flexible |
| WireGuard | UDP | Modern crypto | App or built in (v7) | Simple, very fast |

The labs in this module use the slide examples: the client gets 10.1.1.2 or 10.1.1.3, the router's tunnel address is 10.1.1.1. The slides use the public address 2.2.2.2; in our lab topology the router's WAN address is **22.1.1.33**.

# Lesson: L2TP and L2TP/IPsec

### L2TP from the slides

- **L2TP** = Layer 2 Tunneling Protocol, standardized in **1999**.
- It is an **update of L2F (Cisco) and PPTP (Microsoft)**.
- It works over **UDP port 1701**.
- L2TP **does not provide encryption** itself, so it is **used together with IPsec**.

Inside, L2TP carries **PPP**, so you get everything you know from MTCNA: PPP secrets, profiles, pools, authentication (pap, chap, mschap1, mschap2).

### Server configuration from the slides

    /interface l2tp-server server
    set enabled=yes max-mtu=1450 max-mru=1450 default-profile=default-encryption \
        authentication=mschap1,mschap2 use-ipsec=yes ipsec-secret=SuperSecret123
    /ppp secret
    add name=test password=test service=l2tp local-address=10.1.1.1 remote-address=10.1.1.2

What each setting does:

- **max-mtu=1450**: IPsec and L2TP headers make packets bigger; a lower MTU prevents fragmentation.
- **default-profile=default-encryption**: the built-in profile that requires encryption.
- **authentication=mschap1,mschap2**: only MS-CHAP; better use only **mschap2**.
- **use-ipsec=yes**: RouterOS creates a dynamic IPsec peer and identity with **ipsec-secret** as the pre-shared key. With **yes**, clients **without** IPsec can still connect with plain L2TP. With **required**, L2TP without IPsec is refused. For security use **required**.
- The secret **test** gets the fixed addresses 10.1.1.1 (router) and 10.1.1.2 (client).

### Firewall for L2TP/IPsec

The client is usually behind NAT, so IPsec uses **NAT-T** (UDP 4500).

    /ip firewall filter
    add chain=input protocol=udp dst-port=500,4500 action=accept comment="IKE, NAT-T"
    add chain=input protocol=ipsec-esp action=accept comment="ESP without NAT"
    add chain=input protocol=udp dst-port=1701 ipsec-policy=in,ipsec action=accept comment="L2TP only inside IPsec"

The last rule is the important one: **ipsec-policy=in,ipsec** matches only packets that arrived **decrypted from IPsec**. Plain L2TP from the Internet is not accepted. Put these rules **before** your final drop.

### The Windows client, step by step

1. Settings → Network → VPN → Add a VPN connection.
2. VPN type: **L2TP/IPsec with pre-shared key**, enter the pre-shared key (ipsec-secret).
3. Server: the router's public address, user name and password: test / test.
4. If the router is behind NAT, Windows needs the registry value `AssumeUDPEncapsulationContextOnSendRule=2` (Microsoft KB 926179).
5. Connect. On the router `/ppp active print` shows the session, `/ip ipsec active-peers print` shows the IPsec peer.

> **Slide lab:** *Set up an L2TP+IPsec server for your laptop and connect the client.* Do it in the lab **"L2TP/IPsec server for a laptop"**.

# Lesson: SSTP

### SSTP from the slides

- **SSTP** (Secure Socket Tunneling Protocol) was developed by **Microsoft**.
- It transports PPP over **SSL/TLS**, carried in **HTTPS on TCP 443**.
- Built into Windows since **Windows Server 2008** and **Windows Vista SP1**.
- Because it looks like normal HTTPS, it passes firewalls and proxies that block everything else.

### Connection stages

1. **TCP connection** to port 443.
2. **SSL negotiation**: the client checks the server certificate.
3. **SSTP over HTTPS**: the SSTP control messages.
4. **IP binding**: PPP authentication and address assignment.
5. **SSTP tunnel**: data flows.

Two RouterOS devices **can build SSTP even without certificates**; this is **not in line with the Microsoft standard**, and Windows clients always need a certificate they trust.

### Certificates for SSTP (slides)

The slides use a certificate from a public CA, which every Windows client trusts. You get three files and import them:

    /certificate import file-name=ca_bundle.crt passphrase=""
    /certificate import file-name=certificate.crt passphrase=""
    /certificate import file-name=private.key passphrase=""
    /certificate print

The server certificate (`certificate.crt_0`) must have the **K** flag (private key imported).

### SSTP server from the slides

    /interface sstp-server server
    set enabled=yes port=443 certificate=certificate.crt_0 default-profile=default-encryption \
        authentication=mschap2 tls-version=only-1.2 force-aes=yes pfs=yes
    /ppp secret
    add name=test2 password=test2 service=sstp local-address=10.1.1.1 remote-address=10.1.1.3
    /ip firewall filter
    add chain=input protocol=tcp dst-port=443 action=accept comment="SSTP" place-before=0

- **force-aes=yes**: only AES ciphers.
- **pfs=yes**: Perfect Forward Secrecy (fresh keys per session).
- **tls-version**: the slide shows *any*; *only-1.2* is stricter.
- Port **443** is now used by SSTP, so **www-ssl** must be disabled or moved (for example to 44300 as in module 5).

On the client side the connection status shows the cipher, for example **AES256-CBC**.

### Troubleshooting SSTP

| Symptom | Likely cause |
|---|---|
| Fails at **SSL negotiation** | The client does not trust the issuer, or connects by a name/IP that is not in the certificate |
| Error about revocation check | Windows cannot reach the CRL of the CA (self-made CA) |
| Connects, no traffic | Missing route or firewall forward rule for 10.1.1.0/24 |

> Practise in the lab **"SSTP server with a public certificate"**.

# Lesson: IPsec recap for road warriors

IKEv2 is configured with the RouterOS **IPsec** menus. Module 6 explains IPsec in depth (AH and ESP, modes, IKE phases, site to site); this is the short recap you need for road warriors.

| Term | Meaning |
|---|---|
| **IKE** | Internet Key Exchange: the protocol that authenticates the peers and creates the keys (UDP 500) |
| **SA** (Security Association) | One direction of an agreed encryption with its keys |
| **ESP** | Encapsulating Security Payload (IP protocol 50): **encrypts and authenticates** the data |
| **AH** | Authentication Header (IP protocol 51): **only authenticates**, no encryption, does **not** work through NAT |
| **NAT-T** | NAT traversal: ESP is wrapped in **UDP 4500** so IPsec works through NAT |
| **DPD** | Dead Peer Detection: notices when the other side is gone |

### RouterOS IPsec menus

| Menu | What it holds |
|---|---|
| /ip ipsec **profile** | Phase 1 (IKE) parameters: hash, encryption, DH group, NAT-T, DPD |
| /ip ipsec **peer** | Where the other side is (address, exchange-mode ike2, passive) |
| /ip ipsec **identity** | How the peer authenticates (PSK, certificate, EAP) and which policies it may create |
| /ip ipsec **proposal** | Phase 2 (ESP) parameters: auth and enc algorithms, PFS group |
| /ip ipsec **policy** | **Which traffic** is encrypted (src/dst subnets) |
| /ip ipsec **mode-config** | Address, DNS and routes pushed to road warriors |

### Policies and templates

A normal **policy** names fixed subnets and the peer. Road warriors have **unknown addresses**, so the server uses a **policy template** (`template=yes`) in a **policy group**. When a client connects, the identity with **generate-policy=port-strict** creates a real policy from the template.

**level=unique** makes each client get its own SAs. Several IKEv2 clients **behind the same public IP** then all work.

# Lesson: IKEv2 road warrior with certificates

### IKEv2 features from the slides

- The initial exchange takes **4 messages** (IKEv1 needed 6 or 9).
- Authentication with **PSK** or **RSA signatures**, and **asymmetric authentication**: each side may use a different method.
- **NAT traversal** is built in.
- **DPD** (dead peer detection) is built in.
- **EAP** and **configuration payload** for road warriors (user name + password, addresses from the server).
- **MOBIKE**: the session survives a change of the client address (Wi-Fi → LTE) without a new connection.
- Better **resistance to DoS** attacks (cookies).
- With **level=unique**, several clients behind one IP work.

### Variante 1 from the slides, step by step

**Step 1. Certificates** (self-signed CA, server and client, as in module 4). The slides use CN 2.2.2.2 and note that a **DNS name is better**. The server certificate must contain the address or name the clients use in **subject-alt-name**; Windows checks it.

    /certificate
    add name=ca common-name=ca key-usage=key-cert-sign,crl-sign
    sign ca
    add name=serverIKEv2 common-name=22.1.1.33 subject-alt-name=IP:22.1.1.33 key-usage=tls-server
    sign serverIKEv2 ca=ca
    add name=client1 common-name=client1 key-usage=tls-client
    sign client1 ca=ca

**Step 2. Address pool and mode config.**

    /ip pool add name=pool1 ranges=10.1.1.2-10.1.1.50
    /ip ipsec mode-config
    add name=cfgIKEv2 responder=yes address-pool=pool1 address-prefix-length=32 \
        split-include=192.168.33.0/24 system-dns=no static-dns=192.168.33.1

- **responder=yes**: this configuration works as the **server** and hands out the parameters.
- **split-include**: the subnets the client must send **through the tunnel**; everything else goes directly to the Internet. It is delivered with the **Cisco Unity** extension.

**Step 3. Policy group and template.**

    /ip ipsec policy group add name=rw
    /ip ipsec policy add group=rw template=yes src-address=0.0.0.0/0 dst-address=10.1.1.0/24

(The slide shows 12.1.1.0/24 here, a typo: the template must cover the pool addresses.)

**Step 4. Peer.**

    /ip ipsec peer add name=peerIKEv2 exchange-mode=ike2 passive=yes send-initial-contact=yes

- No address (or `::/0`): accept clients from anywhere.
- **passive=yes**: the router only **responds**, it never initiates to this peer.

**Step 5. Identity.**

    /ip ipsec identity add peer=peerIKEv2 auth-method=digital-signature certificate=serverIKEv2 \
        generate-policy=port-strict mode-config=cfgIKEv2 policy-template-group=rw

**Step 6. Firewall.**

    /ip firewall filter
    add chain=input protocol=udp dst-port=500,4500 action=accept place-before=0
    add chain=forward ipsec-policy=in,ipsec action=accept place-before=0

**Step 7. Client.** Export the CA (PEM) and client1 (PKCS#12 with a passphrase), import them on the laptop or phone, create an IKEv2 VPN with the server address 22.1.1.33 and certificate authentication.

**Step 8. Check.**

    /ip ipsec active-peers print
    /ip ipsec installed-sa print
    /ip ipsec policy print

### Troubleshooting IKEv2

| Symptom | Check |
|---|---|
| No answer at all | UDP 500/4500 allowed in input? |
| "IKE authentication credentials are unacceptable" (Windows) | SAN does not contain the server name/IP, or the CA is not in the computer's trusted root store |
| Connected, no traffic to the LAN | Forward rule for ipsec-policy=in,ipsec; split-include covers the LAN; policy template covers the pool |
| Second user behind the same NAT breaks the first | Use level=unique in the template |

> See the **VPN handshake stepper** and **VPN firewall helper** simulators, then build it in the lab **"IKEv2 road warrior with certificates"**.
