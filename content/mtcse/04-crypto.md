# Lesson: Cryptography for network engineers

You do not need mathematics to use VPNs, but you need to know which building block does what. Otherwise the many parameters of IPsec and TLS look like magic.

### Symmetric encryption

**One key** encrypts and decrypts. Fast, used for the actual data.

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

### Diffie-Hellman

**Diffie-Hellman (DH)** lets two sides agree on a **shared secret** over an insecure network, without ever sending the secret. Each side sends a public value; from the other side's public value and its own private value, both compute the same secret. An eavesdropper sees only the public values.

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

### Course lab

- **Lab "Build your own PKI on RouterOS"**: create the CA, the server and client certificates, sign them, and export the CA and a PKCS#12 bundle.
