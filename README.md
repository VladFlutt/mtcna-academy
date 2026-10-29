# Academy MikroTik (Академия MikroTik)

Interactive training platform for MikroTik certification courses. The academy home (`#/`) lists the course sections: **MTCNA** (`#/mtcna`), **MTCSE** (`#/mtcse`) and **MTCRE** (`#/mtcre`) are complete, and MTCSWE, MTCWE, MTCTCE, MTCUME, MTCINE and MTCIPv6E have "coming soon" pages (`js/courses.js`).

- **Glossary** (`#/glossary`, `js/glossary.js`): about 345 networking, RouterOS and security terms in English and Russian, with search and categories. Terms and abbreviations in lessons, labs and simulators are highlighted automatically and show a short explanation on click (`js/terms.js`). Tooltips are off inside a quiz or exam until it is submitted, so they cannot give answers away.

## MTCNA section

- **Theory:** 10 modules and 46 lessons following the MTCNA syllabus (RouterOS intro, first steps, DHCP/ARP/DNS, bridging, routing, wireless, firewall and NAT, QoS, tunnels, tools).
- **Hands-on labs:** a RouterOS CLI simulator in the browser (tab completion, history, `print`/`add`/`set`/`export`) with 13 guided labs that are checked automatically.
- **Simulators:** subnet calculator, route lookup, firewall packet walk, burst and PCQ queues, Wi-Fi channels, RouterBOARD name decoder.
- **Quizzes:** 143 questions with explanations, 80% to pass each module.
- **Final exam:** 25 random questions, 60 minutes, 60% to pass (same format as the real MTCNA exam).
- **AI assistant** (`js/ai.js`, `api/tutor.mjs`):
  - terminal tutor that explains every CLI error and suggests the right command ("did you mean");
  - configuration audit with a security score and copy-ready fixes;
  - troubleshooting lab generator that breaks a working network in random ways (1 to 3 faults);
  - adaptive study plan and an exam readiness estimate from your progress;
  - Claude tutor chat that sees your current router config. It needs `ANTHROPIC_API_KEY` in the Vercel project; without it the built-in offline tutor answers.

The whole course is available in **English and Russian** (EN/RU switch in the header). Progress is saved in the browser (localStorage).

Весь курс доступен на **английском и русском** (переключатель EN/RU в шапке).

## MTCSE section

Routes start with `#/mtcse` (data in `js/mtcse/`, lessons in `content/mtcse/` and `content/ru/mtcse/`). Progress and exam history are kept separately from MTCNA.

- **Theory:** 7 modules and 32 lessons with step-by-step examples for beginners, following every MTCSE slide deck: security basics, threats and types of attack, router hardening, firewall in depth (packet flow, connection tracking, RAW), attacks and prevention (L2 attacks, scans, brute force, DoS), cryptography and certificates, securing the router (port knocking, service ports, SSH tunnels), IPsec (AH, ESP, transport and tunnel mode, IKE phases, site-to-site tunnels and the NAT bypass), secure tunnels for road warriors (L2TP/IPsec, SSTP, IKEv2).
- **Hands-on labs:** 11 labs in the RouterOS simulator, checked automatically. The simulator now also covers `/ip firewall raw`, `/certificate` (sign, import, export), `/ip ipsec` (profile, proposal, peer, identity, mode-config, policy templates), `/ip ssh` and `/ip settings`, and replays timed packet sequences (port knocking, brute-force attempts) through RAW and filter with live address-list timeouts.
- **Simulators:** port knocking, brute-force staging, crypto playground (SHA-256, AES-GCM, toy RSA), VPN handshake stepper, SSH tunnel builder, VPN firewall helper, plus the firewall packet walk.
- **Quizzes:** 126 questions at the level of the real exam, 18 per module, 80% to pass each module.
- **Final exam:** 25 random questions, 60 minutes, 60% to pass.

## MTCRE section

Routes start with `#/mtcre` (data in `js/mtcre/`, lessons in `content/mtcre/` and `content/ru/mtcre/`, diagrams and slide figures in `img/mtcre/`). Lessons teach RouterOS 7, with the RouterOS 6 commands from the course slides as side notes.

- **Theory:** 6 modules and 26 lessons: routing fundamentals (RIB and FIB, distance, longest prefix match, ECMP, gateways), static routing and failover (check-gateway, recursive routes, scope and target-scope), policy routing (routing tables, routing rules, mangle marks, two ISPs), point-to-point addressing, VLANs and tunnels (/32 addresses, GRE, IPIP, EoIP, WireGuard, MTU), OSPF concepts and OSPF configuration in RouterOS 7 (areas, stub and NSSA, summaries, default route, redistribution, routing filters).
- **Network labs:** 11 labs on small multi-router networks (`js/mtcre/network.js`). Every router has its own terminal; a topology view, a reachability panel that follows packets hop by hop (routes, routing rules, mangle, NAT, rp-filter, tunnels, OSPF) and link controls (down or silent failure) show the result after every command.
- **Simulators:** route selection, recursive next hop, policy routing walk, tunnel overhead and MTU, OSPF SPF stepper, DR/BDR election, OSPF area types and LSAs.
- **Figures:** SVG diagrams that follow the light and dark theme, plus crops of course slides marked "(course slide)". Click a figure to enlarge it.
- **Quizzes:** 100 questions, 80% to pass each module.
- **Final exam:** 25 random questions, 60 minutes, 60% to pass.

## Run locally

It is a static site with no build step:

    python3 -m http.server 8000

Then open http://localhost:8000.

## Deploy

Import the repository in Vercel with the "Other" preset; no build command or output directory is needed. To enable the Claude tutor, add the environment variable `ANTHROPIC_API_KEY` in the Vercel project settings and redeploy. Each question is one API request (rate limited to 8 per minute per visitor).

## Sources

Course slides (MTCNA chapters 2 to 9; all MTCSE chapters: Basic Concepts, Security Basic Firewall, Attacks, Cryptography and PKI, Security Router, IPsec, Secure Tunnels; the MTCRE slides on static routing, tunnels and OSPF) and the official MikroTik documentation (help.mikrotik.com). Not affiliated with or endorsed by MikroTik.
