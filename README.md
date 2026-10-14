# MTCNA Academy

Interactive training platform for the MikroTik Certified Network Associate (MTCNA) course.

- **Theory:** 10 modules and 46 lessons following the MTCNA syllabus (RouterOS intro, first steps, DHCP/ARP/DNS, bridging, routing, wireless, firewall and NAT, QoS, tunnels, tools).
- **Hands-on labs:** a RouterOS CLI simulator in the browser (tab completion, history, `print`/`add`/`set`/`export`) with 13 guided labs that are checked automatically.
- **Simulators:** subnet calculator, route lookup, firewall packet walk, burst and PCQ queues, Wi-Fi channels, RouterBOARD name decoder.
- **Quizzes:** 143 questions with explanations, 80% to pass each module.
- **Final exam:** 25 random questions, 60 minutes, 60% to pass (same format as the real MTCNA exam).

The whole course is available in **English and Russian** (EN/RU switch in the header). Progress is saved in the browser (localStorage).

Весь курс доступен на **английском и русском** (переключатель EN/RU в шапке).

## Run locally

It is a static site with no build step:

    python3 -m http.server 8000

Then open http://localhost:8000.

## Deploy

Import the repository in Vercel with the "Other" preset; no build command or output directory is needed.

## Sources

Course slides (MTCNA, chapters 2 to 9) and the official MikroTik documentation (help.mikrotik.com). Not affiliated with or endorsed by MikroTik.
