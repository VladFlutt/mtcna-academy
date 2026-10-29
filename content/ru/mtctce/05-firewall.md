# Lesson: Отслеживание соединений и их состояния

Файрвол RouterOS **stateful**: отслеживание соединений запоминает каждое соединение, проходящее через маршрутизатор, в `/ip firewall connection`. Затем каждый пакет классифицируется:

| Состояние | Смысл |
|---|---|
| new | первый пакет соединения |
| established | пакет соединения, в котором уже был трафик в обе стороны |
| related | новое соединение, принадлежащее существующему: данные FTP, ICMP-ошибка о соединении |
| invalid | не относится ни к одному известному соединению и не является корректным началом (например, случайный TCP ACK) |
| untracked | отслеживание для него пропущено (RAW `notrack`) |

Состояние соединения это **не** состояние TCP. Отслеживание соединений работает и с UDP, и с ICMP, у которых нет рукопожатия: UDP-«соединение» становится established, как только приходит ответ. Состояния TCP (syn-sent, established, fin-wait, time-wait…) показываются в отдельной колонке и определяют таймауты.

Поэтому классические первые правила так дёшевы и безопасны:

    /ip firewall filter add chain=input action=accept connection-state=established,related,untracked
    /ip firewall filter add chain=input action=drop connection-state=invalid

Большинство пакетов established и принимаются первым правилом; остальные правила нужны только новым соединениям.

Отслеживание соединений не бесплатно: память и CPU на каждое соединение. `/ip firewall connection tracking` показывает таймауты (например, `tcp-established-timeout=1d`, `udp-timeout=30s`) и `enabled=auto` (включается, как только оно нужно какому-либо правилу).

# Lesson: Тактики фильтрации и порты сервисов

## Цепочки

- **input**: защищает сам маршрутизатор.
- **forward**: защищает сети за маршрутизатором.
- **output**: контролирует то, что отправляет маршрутизатор; нужна редко.

## Две тактики

1. **Отбросить ненужное, принять остальное**: список известных плохих вещей. Каждый новый сервис или атака требует нового правила, и вы узнаёте о них уже после ущерба.
2. **Принять нужное, отбросить всё остальное**: список разрешённого. Новые сервисы остаются закрытыми, пока вы их не откроете. Слайды рекомендуют эту тактику, особенно для input.

Минимальная безопасная цепочка input:

    /ip firewall filter
    add chain=input action=accept connection-state=established,related,untracked
    add chain=input action=drop connection-state=invalid
    add chain=input action=accept protocol=icmp
    add chain=input action=accept in-interface-list=LAN
    add chain=input action=drop

## Порты сервисов RouterOS

| Сервис | Порт |
|---|---|
| Winbox | TCP 8291 |
| SSH / Telnet / FTP | TCP 22 / 23 / 21 |
| WebFig HTTP / HTTPS | TCP 80 / 443 |
| API / API-SSL | TCP 8728 / 8729 |
| сервер bandwidth test | TCP 2000 (и UDP 2000+) |
| MAC Winbox, обнаружение соседей (MNDP) | UDP 20561, UDP 5678 |
| веб-прокси | TCP 8080 (на ваш выбор), часто 3128 |
| DNS | UDP/TCP 53 |
| DHCP-сервер | UDP 67 |
| NTP | UDP 123 |
| SNMP | UDP 161 |
| PPTP / L2TP / SSTP | TCP 1723 + GRE / UDP 1701 / TCP 443 |
| IPsec | UDP 500, UDP 4500, ESP (IP-протокол 50) |
| WireGuard | UDP 13231 (на ваш выбор) |
| OSPF / VRRP | IP-протокол 89 / 112 |

Всё, на что маршрутизатор должен отвечать из WAN (VPN-сервер, ping), разрешается явно выше финального drop.

# Lesson: Свои цепочки, действия и матчеры

## Свои цепочки

Пакет сравнивается с каждым правилом цепочки, пока одно не совпадёт. При сотнях правил это нагружает CPU. **Свои цепочки** группируют правила так, что пакет встречает только относящиеся к нему:

    /ip firewall filter add chain=input protocol=icmp action=jump jump-target=icmp
    /ip firewall filter add chain=input protocol=tcp action=jump jump-target=tcp-in
    /ip firewall filter add chain=input protocol=udp action=jump jump-target=udp-in

Пакет, дошедший до конца своей цепочки без решения, **возвращается** к правилу после jump. `action=return` делает то же явно.

## Действия

| Действие | Результат |
|---|---|
| accept, drop | окончательное решение |
| reject | отбросить и ответить ICMP-ошибкой или TCP reset (`reject-with`) |
| tarpit | ответить на TCP SYN и удерживать соединение с нулевым окном |
| jump, return | войти в свою цепочку и выйти из неё |
| log | записать в лог и продолжить (`log-prefix`) |
| passthrough | посчитать пакет и продолжить |
| add-src-to-address-list, add-dst-to-address-list | занести адрес в список с `address-list-timeout` и продолжить |
| fasttrack-connection | цепочка forward: перевести соединение на fast path |

## Матчеры

- **Адреса**: одиночный адрес, подсеть, диапазон (`10.0.0.1-10.0.0.50`), отрицание через `!`.
- **Порты**: одиночный, диапазон (`1024-65535`) или список (`22,80,443`); `any-port` совпадает с портом источника или назначения.
- **Интерфейсы**: `in-interface`, `out-interface`, списки интерфейсов и `in-bridge-port`/`out-bridge-port` для бриджевого трафика с use-ip-firewall.
- **Address lists**: `src-address-list`, `dst-address-list`. Запись списка может быть адресом, подсетью, диапазоном или **DNS-именем**, которое маршрутизатор разрешает и поддерживает в актуальном состоянии.
- **Расширенные**: `src-mac-address`, `random` (от 1 до 99 процентов), `nth`, `packet-size`, `connection-bytes`, `connection-rate`, `ttl`, `content`, `tls-host`, `ingress-priority`, `dscp`.

## DSCP

Поле **DSCP** (6 бит старого байта TOS, поэтому DSCP = TOS / 4) говорит маршрутизаторам, как обращаться с пакетом:

| Имя | DSCP | Байт TOS | Типичное применение |
|---|---|---|---|
| CS0 / default | 0 | 0x00 | best effort |
| AF31 | 26 | 0x68 | сигнализация вызовов (SIP) |
| CS5 | 40 | 0xA0 | |
| EF | 46 | 0xB8 | голос (RTP) |
| CS6 | 48 | 0xC0 | управление сетью |

## ICMP

ICMP нужен для работы сети, но не весь. Разрешайте:

| тип:код | Смысл | Нужен для |
|---|---|---|
| 0:0 | echo reply | ping |
| 8:0 | echo request | ping |
| 11:0 | TTL exceeded | traceroute |
| 3:3 | port unreachable | traceroute (UDP), ошибки |
| 3:4 | fragmentation needed | **path MTU discovery** |

а остальное отбрасывайте (redirect 5, timestamp 13 и 14 и так далее). Никогда не отбрасывайте 3:4: тогда большие пакеты молча пропадают на каналах с меньшим MTU, например в PPPoE и туннелях. Лаба **цепочка ICMP** строит именно такую цепочку.

# Lesson: Атаки и как их останавливает файрвол

## Ping flood

    /ip firewall filter add chain=input protocol=icmp limit=50,5:packet action=accept
    /ip firewall filter add chain=input protocol=icmp action=drop

**limit=rate,burst** совпадает с пакетами до этой скорости; пакеты сверх неё проваливаются к правилу drop.

## Сканирование портов: psd

**Port scan detection** суммирует вес каждого нового порта, который пробует источник, в пределах временного окна:

    psd=21,3s,3,1        (weight-threshold, delay-threshold, low-port-weight, high-port-weight)

Порты ниже 1024 весят 3, остальные 1; источник, набравший 21 за 3 секунды, считается сканером: 7 привилегированных или 21 высокий порт за 3 секунды. Повторный порт считается один раз.

    /ip firewall filter add chain=input in-interface-list=WAN protocol=tcp psd=21,3s,3,1 action=add-src-to-address-list address-list=port_scanners address-list-timeout=1d
    /ip firewall raw add chain=prerouting src-address-list=port_scanners action=drop

## SYN flood и флуд соединений

**SYN flood** отправляет TCP SYN, часто с подменённых адресов, быстрее, чем сервер успевает сбросить полуоткрытые соединения.

- **TCP SYN cookies** (`/ip settings set tcp-syncookies=yes`) позволяют маршрутизатору отвечать на SYN к своим сервисам, не храня для них состояния.
- **connection-limit=N,mask** совпадает, когда у источника (посчитанного по блоку адресов этой маски) больше N соединений:

    /ip firewall filter add chain=input protocol=tcp connection-limit=100,32 action=add-src-to-address-list address-list=conn_flood address-list-timeout=1h

## DDoS

**Распределённая** атака идёт с тысяч адресов (ботнет). Файрвол может защитить маршрутизатор и LAN от небольших атак: обнаруживать через psd, connection-limit и connection-rate, собирать источники в address lists и отбрасывать их в **RAW** до отслеживания соединений. Но атаку, забивающую ваш канал в Интернет, на своём маршрутизаторе не остановить: канал уже полон до того, как пакеты дойдут. Тут нужен провайдер (фильтрация или blackhole выше по каналу) или сервис очистки трафика.

## Обнаруживать в filter, отбрасывать в RAW

- psd и connection-limit требуют отслеживания соединений, поэтому работают в filter.
- Отбрасывание в RAW не занимает запись conntrack и стоит намного меньше CPU.

Лаба **сканирование и флуд** воспроизводит настоящее сканирование портов против ваших правил. Симулятор **детектор сканирования портов и флуда соединений** показывает веса psd по шагам.
