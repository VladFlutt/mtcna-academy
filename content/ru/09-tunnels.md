# Lesson: Основы VPN и PPP

**VPN** (Virtual Private Network) безопасно соединяет частные сети или пользователей через публичную сеть (Интернет, арендованный канал, беспроводной канал). RouterOS поддерживает много типов туннелей; MTCNA рассматривает семейство **PPP**: **PPPoE**, **PPTP**, **L2TP** и **SSTP** (и упоминает OpenVPN).

### Составные части PPP

| Элемент | Меню | Назначение |
|---|---|---|
| **IP pool** | /ip pool | Диапазон адресов для клиентов (используется также DHCP и HotSpot) |
| **PPP profile** | /ppp profile | Общие настройки: local-address, remote-address (пул), DNS, **rate-limit**, only-one, шифрование |
| **PPP secret** | /ppp secret | Имя пользователя, пароль, сервис, профиль, при необходимости статические local/remote адреса |
| **Сервер** | /interface pppoe-server server, /interface pptp-server server... | Принимает подключения |
| **Клиент** | /interface pppoe-client, pptp-client, l2tp-client, sstp-client | Подключается наружу |

Встроенные профили: **default** и **default-encryption**.

    /ip pool add name=ppp-pool ranges=1.1.1.2-1.1.1.200
    /ppp profile add name=5mbit local-address=1.1.1.1 remote-address=ppp-pool \
        rate-limit=5M/5M only-one=yes
    /ppp secret add name=user1 password=pass1 service=pppoe profile=5mbit

Каждый подключённый клиент появляется как динамический интерфейс и в **PPP > Active Connections**.

# Lesson: PPPoE

**PPPoE** (PPP over Ethernet) работает поверх Ethernet на **уровне 2**. Это классический способ подключения абонентов DSL и Ethernet у провайдеров: у каждого пользователя отдельная сессия с **аутентификацией**, **учётом (accounting)**, а сервер передаёт **IP, шлюз и DNS**.

### PPPoE-клиент

    /interface pppoe-client add name=pppoe-out1 interface=ether1 user=class password=class \
        add-default-route=yes use-peer-dns=yes disabled=no

Аутентификация: pap, chap, mschap1, mschap2. После подключения интерфейс показывает флаг **R** (running).

### PPPoE-сервер

    /interface pppoe-server server add service-name=isp interface=ether2 \
        default-profile=5mbit one-session-per-host=yes max-sessions=100 disabled=no

- Работает на интерфейсе, и IP-адрес для клиентов на нём **не** нужен.
- **keepalive-timeout** (по умолчанию 10 с) обнаруживает пропавших клиентов.
- **one-session-per-host** не даёт хосту открыть несколько сессий.

### Лабы курса

- **Лаба 6.1**: отключите DHCP-клиент на ether1, создайте PPPoE-клиент (логин/пароль *class/class*), проверьте флаг R и доступ в Интернет. Помните, что теперь NAT должен делать masquerade на выход **pppoe-out1**.
- **Лаба 6.2**: отключите PPPoE, снова включите DHCP-клиент и исправьте правило NAT.

# Lesson: PPTP, L2TP и SSTP

### PPTP

- Использует **TCP 1723** для управления и **GRE (IP-протокол 47)** для данных.
- Легко настраивается и поддерживается везде, но его защита MS-CHAPv2/MPPE **взломана**; используйте только там, где безопасность не важна.

### L2TP

- Использует **UDP 1701**. Сам L2TP **не шифрует**; на практике его комбинируют с **IPsec** (UDP 500, 4500, ESP). RouterOS умеет делать это автоматически: `use-ipsec=yes ipsec-secret=...`.

### SSTP

- PPP поверх **TLS на TCP 443**: проходит почти через любой файрвол. На сервере нужны сертификаты.

### Пример site-to-site (из курса)

Office 1: WAN 77.77.77.77/24, LAN 192.168.10.0/24. Office 2: WAN 88.88.88.88/24, LAN 192.168.11.0/24. Адреса туннеля 172.16.1.1 и 172.16.1.2.

Office 1 (сервер):

    /interface pptp-server server set enabled=yes authentication=mschap2 default-profile=default-encryption
    /ppp secret add name=office2 password=secret service=pptp local-address=172.16.1.1 remote-address=172.16.1.2
    /ip route add dst-address=192.168.11.0/24 gateway=172.16.1.2

Office 2 (клиент):

    /interface pptp-client add name=to-office1 connect-to=77.77.77.77 user=office2 password=secret \
        profile=default-encryption disabled=no
    /ip route add dst-address=192.168.10.0/24 gateway=172.16.1.1

**Не** включайте *add-default-route* для site-to-site: вместо этого добавьте **статические маршруты** к удалённой LAN.

**Лаба 6.6**: в парах постройте PPTP-туннель между вашими маршрутизаторами, добавьте статические маршруты и пропингуйте LAN партнёра.

### Сравнение

| Туннель | Транспорт | Шифрование | Примечания |
|---|---|---|---|
| PPPoE | Ethernet (L2) | Необязательно | Только в одном широковещательном домене |
| PPTP | TCP 1723 + GRE | MPPE (слабое) | Быстрый, небезопасный |
| L2TP | UDP 1701 | через IPsec | Распространён на телефонах/Windows |
| SSTP | TCP 443 (TLS) | TLS | Проходит файрволы |
| OpenVPN | TCP/UDP 1194 | TLS | UDP начиная с v7 |
| WireGuard | UDP (v7) | Современная криптография | Не PPP, очень быстрый |
