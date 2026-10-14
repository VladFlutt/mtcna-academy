# Lesson: Принципы файрвола

Файрвол решает, каким пакетам можно пройти. В RouterOS он находится в **IP > Firewall** с вкладками **Filter Rules**, **NAT**, **Mangle**, **Raw**, **Address Lists**, **Connections** и **Layer7 Protocols**.

### Цепочки

**Цепочка (chain)** это список правил для определённого типа трафика:

| Цепочка (filter) | Трафик |
|---|---|
| **input** | Пакеты **на сам маршрутизатор** (Winbox, ping маршрутизатора, DNS к маршрутизатору) |
| **forward** | Пакеты **через** маршрутизатор (из LAN в Интернет) |
| **output** | Пакеты **от самого маршрутизатора** |

NAT использует **srcnat** и **dstnat**; в mangle и raw есть также **prerouting** и **postrouting**. Можно создавать свои цепочки и направлять в них трафик через **action=jump**.

### Обработка правил

- Правила в цепочке проверяются **сверху вниз**. **Первое совпавшее правило** с завершающим действием решает судьбу пакета; следующие правила не проверяются.
- Если ни одно правило не совпало, пакет **принимается** (политика по умолчанию accept). Поэтому защищённый файрвол заканчивается правилом **drop**.
- **Порядок важен**: *accept*, стоящий после *drop all*, никогда не сработает.

> Поэкспериментируйте в симуляторе **Порядок правил файрвола**.

# Lesson: Connection tracking

RouterOS отслеживает соединения (**IP > Firewall > Connections**). Каждый пакет получает **connection-state**:

| Состояние | Значение |
|---|---|
| **new** | Первый пакет нового соединения |
| **established** | Принадлежит соединению, по которому трафик шёл в обе стороны |
| **related** | Новое соединение, связанное с существующим (данные FTP, ICMP-ошибки) |
| **invalid** | Не принадлежит ни одному известному соединению; должен отбрасываться |
| **untracked** | Помечен notrack в raw |

Практическое правило: accept **established,related** **в начале** (с ним совпадает большинство пакетов, поэтому файрвол работает быстро), drop **invalid**, а дальше решать только о **new** соединениях.

**FastTrack** (`action=fasttrack-connection` для established,related в forward) позволяет established-трафику обходить большую часть файрвола и очередей, экономя CPU. Simple queues не работают для fasttrack-трафика.

# Lesson: Действия и условия фильтра

### Действия

| Действие | Результат |
|---|---|
| **accept** | Пропустить пакет; прекратить обработку этой цепочки |
| **drop** | Молча отбросить |
| **reject** | Отбросить и отправить ICMP-ошибку (или TCP reset) |
| **jump** / **return** | Перейти в пользовательскую цепочку / вернуться |
| **add-src-to-address-list** / **add-dst-to-address-list** | Добавить адрес в список (можно с timeout) |
| **log** | Записать в лог и продолжить |
| **passthrough** | Только посчитать и продолжить |
| **tarpit** | Удерживать TCP-соединения открытыми (против сканирования) |
| **fasttrack-connection** | Включить FastTrack для соединения |

### Частые условия (matchers)

src-address, dst-address, protocol (tcp, udp, icmp...), src-port, dst-port, **in-interface**, **out-interface**, in/out-interface-list, connection-state, **src-address-list**, **dst-address-list**, connection-limit, limit, time, layer7-protocol, content.

### Address lists

Группируйте адреса и используйте их в правилах:

    /ip firewall address-list add list=admins address=192.168.88.10
    /ip firewall filter add chain=input src-address-list=admins action=accept

Адреса могут добавляться правилами динамически (port knocking, блокировка перебора паролей SSH).

# Lesson: Защита маршрутизатора

Минимальная безопасная цепочка **input**:

    /ip firewall filter
    add chain=input connection-state=established,related action=accept comment="accept est/rel"
    add chain=input connection-state=invalid action=drop comment="drop invalid"
    add chain=input protocol=icmp action=accept comment="allow ping"
    add chain=input in-interface-list=LAN action=accept comment="allow from LAN"
    add chain=input action=drop comment="drop everything else"

И для клиентов (**forward**):

    add chain=forward connection-state=established,related action=accept
    add chain=forward connection-state=invalid action=drop
    add chain=forward connection-state=new in-interface=ether1 connection-nat-state=!dstnat action=drop \
        comment="drop new from WAN that is not port-forwarded"

> **Перед** добавлением последнего *drop* убедитесь, что есть правило accept для вашего управляющего доступа, или включите **Safe Mode**.

# Lesson: NAT

**NAT** меняет адреса в пакетах. Есть две цепочки:

| Цепочка | Что меняет | Типичное действие |
|---|---|---|
| **srcnat** | Адрес **источника** пакетов, покидающих маршрутизатор (после маршрутизации) | **masquerade**, src-nat |
| **dstnat** | Адрес **назначения** пакетов, приходящих на маршрутизатор (до маршрутизации) | **dst-nat**, redirect |

### Masquerade

Позволяет всей частной LAN использовать публичный адрес маршрутизатора:

    /ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade

Masquerade автоматически использует IP выходного интерфейса; подходит для **динамических** адресов WAN (DHCP, PPPoE). При статическом публичном IP **src-nat to-addresses=** немного эффективнее.

### Проброс портов (dst-nat)

Сделать веб-сервер 192.168.88.10 доступным из Интернета на порту 80:

    /ip firewall nat add chain=dstnat in-interface=ether1 protocol=tcp dst-port=80 \
        action=dst-nat to-addresses=192.168.88.10 to-ports=80

**redirect** это dst-nat на сам маршрутизатор (например прозрачный DNS или прокси).

### Как NAT работает с connection tracking (из курса)

- Без NAT ответ на частный адрес (192.168.1.2) не может вернуться из Интернета: частные адреса там не маршрутизируются, и маршрутизаторы провайдеров их отбрасывают. Источник нужно заменить маршрутизируемым адресом маршрутизатора.
- Чтобы транслировать ответы обратно, маршрутизатор должен помнить, какой внутренний хост открыл какое соединение: это задача **connection tracking** (`/ip firewall connection`). Без него NAT не работает.
- **Правила NAT проверяются только для первого пакета** соединения; остальные пакеты следуют записи conntrack.
- Правила работают как **ЕСЛИ (условия на вкладках General/Advanced/Extra) ТО (вкладка Action)**, сверху вниз; **src-nat** и **masquerade** завершающие: побеждает первое совпавшее правило, поэтому **более конкретные правила ставьте выше**.

Пример из курса: провайдер выдал четыре адреса 22.1.1.2-22.1.1.5. Вся LAN 192.168.33.0/24 выходит как 22.1.1.5, но почтовый сервер 192.168.33.100 должен использовать 22.1.1.4. Правило для 192.168.33.100 должно быть **выше** правила для /24, иначе почтовый сервер первым совпадёт с правилом /24.

Поля **Src/Dst address** принимают подсеть (192.168.1.0/24), один IP или диапазон (192.168.1.10-192.168.1.20). **!** перед значением означает **НЕ**. Для множества несвязанных адресов используйте **address list** (запись может быть и DNS-именем, маршрутизатор его разрешит).

### Действия NAT

| Действие | Цепочка | Результат |
|---|---|---|
| **accept** | обе | Прекратить обработку NAT: пакет **не** транслируется (исключить трафик из нижних правил) |
| **src-nat** | srcnat | Заменить источник на *to-addresses* |
| **masquerade** | srcnat | src-nat на IP выходного интерфейса (динамический WAN) |
| **dst-nat** | dstnat | Заменить назначение на *to-addresses*/*to-ports* |
| **redirect** | dstnat | dst-nat на сам маршрутизатор (адрес входящего интерфейса): прозрачный DNS или прокси |
| **netmap** | обе | Отображение 1:1 диапазона/подсети на другой диапазон/подсеть: заменяет много правил одним |
| **same** | обе | Каждый раз выдавать клиенту один и тот же адрес из пула |
| jump, return, log, passthrough, add-src/dst-to-address-list | обе | Как в filter |

### Лаба SRC-NAT

    /ip firewall nat
    add chain=srcnat out-interface=ether1 src-address=192.168.33.0/24 action=masquerade
    add chain=srcnat out-interface=ether1 src-address-list=internet_users action=masquerade
    add chain=srcnat out-interface=ether1 src-address-list=!BadUsers action=masquerade
    add chain=srcnat src-address=192.168.33.100 dst-address=8.8.8.8 action=masquerade
    add chain=srcnat out-interface=ether1 protocol=tcp dst-port=80,443 src-address=192.168.33.0/24 action=masquerade

Каждая строка решает одну задачу: вся LAN; только список *internet_users*; все, кроме *BadUsers*; один хост только к 8.8.8.8; LAN только к вебу (80/443). Включайте по одному.

### Лаба DST-NAT

Перенаправьте весь DNS из LAN на маршрутизатор и опубликуйте почтовый сервер 192.168.33.100 (TCP 110, 25, 143, 80) на публичном адресе:

    /ip firewall nat
    add chain=dstnat src-address=192.168.33.0/24 protocol=udp dst-port=53 action=redirect
    add chain=dstnat src-address=192.168.33.0/24 protocol=tcp dst-port=53 action=redirect
    add chain=dstnat dst-address=22.1.1.33 protocol=tcp dst-port=110,25,143,80 action=dst-nat to-addresses=192.168.33.100

### Лаба (из главы о туннелях)

После перевода WAN с PPPoE обратно на DHCP Интернет не работает, потому что в правиле masquerade было **out-interface=pppoe-out1**. Решение: задать out-interface **ether1** (или использовать список интерфейсов *WAN*, содержащий оба).

# Lesson: Прохождение пакета и лабы фильтра

### Packet flow

Пакет, входящий в маршрутизатор, проходит **prerouting** (raw, connection tracking, mangle, **dstnat**), затем **решение о маршрутизации**:

- на сам маршрутизатор: **input** (mangle, **filter input**), затем локальный процесс;
- через маршрутизатор: **forward** (mangle, **filter forward**), затем **postrouting** (mangle, **srcnat**), выходной интерфейс;
- от маршрутизатора: локальный процесс, **output** (mangle, **filter output**), postrouting.

Следствие: **dst-nat выполняется до фильтра**, поэтому правило forward для проброса порта видит **новый (внутренний)** адрес назначения. Проброшенный трафик фильтруется в **forward**, а не в input.

### Политика: запрещено всё, что не разрешено

Корпоративные файрволы обычно в конце *запрещают всё*, а выше *разрешают* только нужное. NAT проверяется только для первого пакета, но **фильтр проверяет каждый пакет**, поэтому ставьте **established,related accept** первым; тогда остальные правила проходят только новые соединения.

Минимальный файрвол, защищающий маршрутизатор и LAN от WAN (ether1):

    /ip firewall filter
    add chain=input connection-state=established,related action=accept
    add chain=input in-interface=ether1 action=drop
    add chain=forward connection-state=established,related action=accept
    add chain=forward in-interface=ether1 action=drop

Открыть Winbox снаружи: добавьте `chain=input protocol=tcp dst-port=8291 action=accept` **выше** input drop. Опубликовать проброшенный сервис: добавьте `chain=forward protocol=tcp dst-port=80,3389 action=accept` (или `connection-nat-state=dstnat`) **выше** forward drop.

### Лаба фильтра (из курса)

Удалите все правила, затем:

1. Закройте Winbox (TCP 8291) на маршрутизаторе со стороны WAN (ether1).
2. Заблокируйте Интернет «плохим» пользователям 192.168.x.34, 192.168.x.54, 192.168.x.65-89.
3. Маршрутизатор это VPN-сервер: откройте к нему UDP 1701 и TCP 1723.
4. Запретите пользователям ping (ICMP) на 8.8.8.8.
5. Запретите telnet (TCP 23) на маршрутизатор.
6. Пользователи 192.168.x.24 и .25 не должны достигать сервера 212.0.3.43 на портах 110, 25, 143, 80.
7. Сам маршрутизатор не должен пинговать 212.0.200.1.

Решение:

    /ip firewall filter
    add chain=input in-interface=ether1 protocol=tcp dst-port=8291 action=drop
    add chain=forward out-interface=ether1 src-address-list=BadUsers action=drop
    add chain=input protocol=tcp dst-port=1723 action=accept
    add chain=input protocol=udp dst-port=1701 action=accept
    add chain=forward dst-address=8.8.8.8 protocol=icmp src-address=192.168.33.0/24 action=drop
    add chain=input protocol=tcp dst-port=23 action=drop
    add chain=forward dst-address=212.0.3.43 protocol=tcp dst-port=110,25,143,80 src-address=192.168.33.24/31 action=drop
    add chain=output dst-address=212.0.200.1 action=drop

Обратите внимание на задачу 6: 192.168.33.24/31 покрывает ровно .24 и .25, а задача 7 использует цепочку **output**, потому что трафик начинается на маршрутизаторе.

### Пользовательские цепочки

Кроме input, forward и output можно создавать свои цепочки (в filter, NAT и mangle), чтобы **снизить нагрузку на CPU** и **структурировать** правила. Пример: вместо девяти правил ICMP в input, которые проходит каждый пакет, одно правило `chain=input protocol=icmp action=jump jump-target=ICMP-Filter` отправляет только ICMP в отдельную цепочку; остальные пакеты её пропускают. В конце пользовательской цепочки пакет **возвращается** в вызвавшую цепочку (или используйте action=return раньше).

Действия фильтра: accept, add-dst-to-address-list, add-src-to-address-list, drop, fasttrack-connection, jump, log, passthrough, reject, return, tarpit.
