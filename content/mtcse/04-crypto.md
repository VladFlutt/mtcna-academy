# Lesson: Cryptography for network engineers

You do not need mathematics to use VPNs, but you need to know which building block does what. Otherwise the many parameters of IPsec and TLS look like magic.

![Early ciphers: the Polybius square, the Caesar cipher and the Spartan scytale (course slide)](/img/mtcse/se4-03.webp)

### Symmetric encryption

**One key** encrypts and decrypts. Fast, used for the actual data.

![AES key sizes and the time to crack them (course slide)](/img/mtcse/se4-08.webp)

- Algorithms: **AES** (128/192/256 bit keys), ChaCha20; old: DES, 3DES, Blowfish.
- Modes: **CBC** (classic), **GCM** (encrypts **and** authenticates in one step, preferred today).
- Problem: how do both sides get the same key safely? That is solved by the next two blocks.

### Asymmetric (public key) cryptography

Each side has a **key pair**: a **public key** you can give to everybody and a **private key** you never share.

| You want to... | Use |
|---|---|
| Send a secret only Bob can read | Encrypt with **Bob's public key**; only his private key decrypts it |
| Prove that you wrote something | **Sign** with **your private key**; anyone checks with your public key |

Algorithms: **RSA** (2048 bit or more), **ECDSA** / Ed25519 (elliptic curves, shorter keys with the same strength). Asymmetric crypto is slow, so it is used for small things: keys and signatures.

### Hash functions

A **hash** turns any data into a fixed-size fingerprint: **SHA-256** gives 256 bits.

- Same input → same hash; a one-bit change → a completely different hash (the **avalanche effect**).
- **One-way**: you cannot get the data back from the hash. A hash is **not encryption**, there is no key to "decrypt" it.
- Hard to find two inputs with the same hash (collisions). **MD5** and **SHA-1** are broken for this.

**HMAC** is a **keyed hash**: hash(key + message). The receiver, who knows the key, recalculates it. It proves **integrity** and that the sender knows the key. IPsec and TLS use HMAC-SHA256 and similar.

### Digital signatures

1. Alice calculates the hash of the message.
2. She encrypts (signs) the hash with **her private key**.
3. Bob calculates the hash himself and checks the signature with **Alice's public key**.
4. If both match, the message is from Alice and was not changed.

![A digital signature combines a hash and asymmetric encryption (course slide)](/img/mtcse/se4-13.webp)

### Diffie-Hellman

**Diffie-Hellman (DH)** lets two sides agree on a **shared secret** over an insecure network, without ever sending the secret. Each side sends a public value; from the other side's public value and its own private value, both compute the same secret. An eavesdropper sees only the public values.

![Asymmetric cryptography exchanges a session key, symmetric cryptography carries the data (course slide)](/img/mtcse/se4-14.webp)

IPsec and TLS use DH to create session keys. DH **groups** (modp2048, ecp256, ecp384...) choose the size and the type of the math.

**PFS** (Perfect Forward Secrecy): every session uses a **fresh** DH exchange. If a long-term key is stolen later, traffic recorded earlier still cannot be decrypted.

> Play with hashes, AES and a toy RSA in the **Crypto playground** simulator.

# Lesson: PKI and certificates

A public key alone does not say **whose** key it is. An attacker could give you their own key and claim it belongs to your bank. A **certificate** solves this: it is a document that binds a public key to a name and is **signed** by someone you trust.

### What is in an X.509 certificate

| Field | Example | Meaning |
|---|---|---|
| Subject / **common-name (CN)** | vpn.example.com | Who the certificate belongs to |
| **subject-alt-name (SAN)** | DNS:vpn.example.com, IP:22.1.1.33 | Other names and addresses; clients check this |
| Issuer | CN=example-ca | Who signed it |
| Validity | not-before / not-after | Dates |
| Public key | RSA 2048 | The key |
| **key-usage** | tls-server, digital-signature | What the key may be used for |
| Signature | ... | The issuer's signature over all of it |

### The chain of trust

- A **CA** (Certificate Authority) signs certificates. Its own certificate is **self-signed** (issuer = subject).
- Clients keep a list of **trusted root CAs** (browsers and operating systems ship hundreds).
- A certificate is trusted when its signature chain ends in a trusted root. Public CAs often use an **intermediate** CA in between, which is why you get a **ca_bundle** file with the certificate.

![Components of a PKI: CA, VA, RA and the central directory (course slide)](/img/mtcse/se4-18.webp)

**PKI** (Public Key Infrastructure) is the whole system: CAs, certificates, revocation and the rules around them.

### Revocation

If a private key is stolen, the certificate must be cancelled before it expires. The CA publishes a **CRL** (Certificate Revocation List) or answers **OCSP** queries. RouterOS can check CRLs: `/certificate settings set crl-use=yes`.

### Where certificates come from

1. **Public CA** (paid, or free **Let's Encrypt**): trusted by every client automatically. Good for SSTP and HTTPS to arbitrary users.
2. **Your own CA on RouterOS**: free and fully under your control, but you must install the CA certificate on every client. Good for IKEv2 road warriors and your own devices.
3. **Self-signed single certificate**: quick for tests, every client warns.

# Lesson: Certificates on RouterOS

### Build your own CA, step by step

**Step 1. Templates.** `add` only creates a template; nothing is signed yet.

![Self-signed certificates: each router needs the CA certificate of the other side (course slide)](/img/mtcse/se4-34.webp)

    /certificate
    add name=ca common-name=ca key-usage=key-cert-sign,crl-sign days-valid=3650
    add name=server common-name=22.1.1.33 subject-alt-name=IP:22.1.1.33 key-usage=tls-server
    add name=client1 common-name=client1 key-usage=tls-client

- **key-cert-sign** allows the CA to sign other certificates, **crl-sign** to sign the CRL.
- **tls-server** / **tls-client** are the extended key usages for servers and clients.
- For a server reached by a DNS name, use `common-name=vpn.example.com subject-alt-name=DNS:vpn.example.com`. A name is better than an IP: the address can change.

**Step 2. Sign the CA itself** (this makes it self-signed):

    sign ca

**Step 3. Sign the others with the CA:**

    sign server ca=ca
    sign client1 ca=ca

**Step 4. Check the flags:**

    print

| Flag | Meaning |
|---|---|
| **K** | The router has the **private key** |
| **A** | Authority (it is a CA) |
| **T** | Trusted |
| **I** | Invalid |
| **R** | Revoked |
| **E** | Expired |

**Step 5. Export for the clients:**

    export-certificate ca
    export-certificate client1 type=pkcs12 export-passphrase=ClientPass123

- The CA certificate is exported **without** a key (PEM). Clients only need it to trust the server.
- A client certificate **with** its private key needs an **export-passphrase**. **PKCS#12** (.p12) packs certificate + key in one file that Windows, macOS, iOS and Android import directly.

The files appear in **Files** (`cert_export_ca.crt`, `cert_export_client1.p12`).

### Import a certificate from a public CA

You usually get three files: `certificate.crt`, `private.key` and `ca_bundle.crt`.

    /certificate import file-name=certificate.crt passphrase=""
    /certificate import file-name=private.key passphrase=""
    /certificate import file-name=ca_bundle.crt passphrase=""
    /certificate print

After the key import, the certificate (named like `certificate.crt_0`) gets the **K** flag. Without K the router cannot use it for a server.

### Let's Encrypt on RouterOS v7

    /certificate enable-ssl-certificate dns-name=router.example.com

The router requests and renews a free certificate automatically. TCP 80 must be reachable from the Internet during the check and the DNS name must point to the router.

# Lesson: Certificate names, revocation and VPN certificates

> This lesson follows the course slides, chapter 4 "Cryptography and PKI".

### The X.500 name inside a certificate

A certificate is a public key plus a name, signed by somebody. The name is written in **X.500** form, and each component has a two-letter code:

| Code | Name | RouterOS parameter | Example |
|---|---|---|---|
| `CN` | Common Name, the identity itself | `common-name` | `vpn.example.com` |
| `O` | Organization | `organization` | `Example Ltd` |
| `OU` | Organizational Unit | `unit` | `IT` |
| `L` | Locality, the city | `locality` | `Riga` |
| `ST` | State or province | `state` | `Riga` |
| `C` | Country, two letters | `country` | `LV` |

Keep three words apart: **X.509** is the format of the certificate, **X.500** is the naming scheme used inside it, and a **CSR** (certificate signing request) is the same information *before* a CA has signed it.

> **The Common Name matters more than the rest.** A VPN client checks the CN, or a `subject-alt-name`, against the name it dialled. `O` and `L` are decoration; a wrong CN breaks the connection with a name-mismatch error.

### Revoking a certificate: CRL

A certificate stays valid until it expires, unless you revoke it. The CA publishes a **CRL** (certificate revocation list) of the serial numbers it no longer honours, and the other side checks that list.

    /certificate issued-revoke client1
    /certificate crl print

    /certificate settings set crl-download=yes crl-use=yes crl-store=ram

- **`crl-download`** fetches the CRLs named in the certificates you verify.
- **`crl-use`** actually rejects a revoked certificate. Downloading without using it changes nothing.
- **`crl-store=ram`** keeps the list in memory, which is what you want on a router with flash you would rather not wear out.

For your own CA to publish a CRL it needs a **CRL host**, the address where the list can be fetched, and it must be set **before you sign anything**:

    /certificate set ca crl-host=192.168.88.1

That address is written inside every certificate the CA issues, as the place to look. Change it afterwards and the certificates you already issued still point at the old address. This is the single most common mistake with a home-made CA.

### SCEP, when you have hundreds of devices

**SCEP** (Simple Certificate Enrollment Protocol) automates enrolment: a device asks the CA for a certificate over HTTP, and the CA either grants it automatically or holds it for an operator to approve. RouterOS can be both a SCEP server and a SCEP client.

It is the right answer for a fleet and the wrong answer for three routers, where `export-certificate` and `import` are faster than setting up the service.

### Certificates in the VPN services

Where the certificates actually get used, with the parameter names the slides show:

    /interface sstp-server server set certificate=server verify-client-certificate=yes enabled=yes

    /interface ovpn-server server set certificate=server require-client-certificate=yes auth=sha1 cipher=aes256 enabled=yes

    /ip ipsec identity set 0 auth-method=digital-signature certificate=server remote-certificate=client1

Three patterns to keep apart:

- **Server certificate only.** The client checks the server, the server checks a username and password. This is the usual SSTP and L2TP/IPsec mode, and what a Windows client does with no extra setup.
- **Mutual certificates.** `verify-client-certificate=yes` (SSTP) or `require-client-certificate=yes` (OVPN). Nobody connects without a certificate your CA issued, so a stolen password alone is useless. This is the MTCSE answer for road warriors.
- **IPsec with digital signatures.** The identity references both sides' certificates instead of a pre-shared key. That is how the IKEv2 road warrior in module 7 authenticates.

### The Windows client workflow

The slides walk through it, and this is the part students get wrong:

1. Export the CA as a `.crt` and the client as a `.p12`.
2. Copy both files to the Windows machine.
3. Install the **CA certificate into "Trusted Root Certification Authorities"**, for the *Local Machine*, not the current user. In the wrong store Windows will not trust your server.
4. Install the `.p12`; it lands in **Personal** together with its private key.
5. Create the VPN connection and, for IKEv2 or SSTP, choose certificate authentication.

Two error messages worth memorising:

- *"The connection was prevented because of a policy"* — the CA is almost always in the user store instead of the machine store.
- *A name mismatch* — the CN of the server certificate is not the name you typed into the connection.

### The lab from the slides

> **Lab:** *Set a CRL host on your CA, issue a client certificate, use it on SSTP with client verification, then revoke it.*

1. `/certificate set ca crl-host=<your LAN address>` **before** signing anything new.
2. Issue a fresh `client2` certificate and export it as a `.p12`.
3. Set `verify-client-certificate=yes` on the SSTP server and connect with the certificate.
4. `/certificate issued-revoke client2`, check `/certificate crl print`, turn on `crl-use=yes` on the server side, and try again.

### Course lab

- **Lab "Build your own PKI on RouterOS"**: create the CA, the server and client certificates, sign them, and export the CA and a PKCS#12 bundle.
