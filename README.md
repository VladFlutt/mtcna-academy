# Academy MikroTik (Академия MikroTik)

Interactive training platform for MikroTik certification courses. The academy home (`#/`) lists the course sections: **MTCNA** (`#/mtcna`) and **MTCSE** (`#/mtcse`) are complete, and MTCRE, MTCSWE, MTCWE, MTCTCE, MTCUME, MTCINE and MTCIPv6E have "coming soon" pages (`js/courses.js`).

- **Glossary** (`#/glossary`, `js/glossary.js`): about 310 networking, RouterOS and security terms in English and Russian, with search and categories. Terms and abbreviations in lessons, labs and simulators are highlighted automatically and show a short explanation on click (`js/terms.js`). Tooltips are off inside a quiz or exam until it is submitted, so they cannot give answers away.

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

- **Theory:** 6 modules and 27 lessons with step-by-step examples for beginners, following every MTCSE slide deck: security basics, threats and types of attack, router hardening, firewall in depth (packet flow, connection tracking, RAW), attacks and prevention (L2 attacks, scans, brute force, DoS), cryptography and certificates, securing the router (port knocking, service ports, SSH tunnels), secure tunnels (L2TP/IPsec, SSTP, IKEv2).
- **Hands-on labs:** 10 labs in the RouterOS simulator, checked automatically. The simulator now also covers `/ip firewall raw`, `/certificate` (sign, import, export), `/ip ipsec` (profile, proposal, peer, identity, mode-config, policy templates), `/ip ssh` and `/ip settings`, and replays timed packet sequences (port knocking, brute-force attempts) through RAW and filter with live address-list timeouts.
- **Simulators:** port knocking, brute-force staging, crypto playground (SHA-256, AES-GCM, toy RSA), VPN handshake stepper, SSH tunnel builder, VPN firewall helper, plus the firewall packet walk.
- **Quizzes:** 108 questions at the level of the real exam, 18 per module, 80% to pass each module.
- **Final exam:** 25 random questions, 60 minutes, 60% to pass.

## Run locally

It is a static site with no build step:

    python3 -m http.server 8000

Then open http://localhost:8000.

## Deploy

Import the repository in Vercel with the "Other" preset; no build command or output directory is needed. To enable the Claude tutor, add the environment variable `ANTHROPIC_API_KEY` in the Vercel project settings and redeploy. Each question is one API request (rate limited to 8 per minute per visitor).

## Sources

Course slides (MTCNA chapters 2 to 9; all MTCSE chapters: Basic Concepts, Security Basic Firewall, Attacks, Cryptography and PKI, Security Router, Secure Tunnels) and the official MikroTik documentation (help.mikrotik.com). Not affiliated with or endorsed by MikroTik.
