# Lesson: Путь пакета

В MTCNA вы изучили три цепочки фильтра: **input**, **forward**, **output**. Для работы с безопасностью нужна полная картина: пакет проходит несколько **таблиц** (RAW, mangle, NAT, filter) в строгом порядке, и от места, где вы остановите атаку, зависит, сколько CPU она съест.

### Порядок обработки

Пакет, который **пришёл** на маршрутизатор, проходит:

1. **RAW prerouting**: самое первое место. Connection tracking ещё не видел пакет.
2. **Connection tracking**: маршрутизатор находит или создаёт запись о соединении и выставляет **connection-state**.
3. **Mangle prerouting**, **NAT dstnat**.
4. **Решение о маршрутизации**: пакет для самого маршрутизатора (input) или проходит через него (forward)?
5. **Mangle input → filter input** (к самому маршрутизатору) или **mangle forward → filter forward** (через маршрутизатор).
6. Для транзитных пакетов: **mangle postrouting**, **NAT srcnat**, затем наружу.

Пакет, **созданный самим маршрутизатором** (его ping, DNS-запрос, VPN-пакет), идёт так: **RAW output → connection tracking → mangle output → filter output → postrouting**.

| Таблица | Цепочки | Типичное применение |
|---|---|---|
| **raw** | prerouting, output | Дешёвое раннее отбрасывание, notrack |
| **mangle** | prerouting, input, forward, output, postrouting | Метки, TTL, MSS |
| **nat** | dstnat, srcnat | Проброс портов, masquerade |
| **filter** | input, forward, output | Разрешить или запретить |

> **Пример для новичка:** кто-то из Интернета пингует ваш маршрутизатор. Пакет проходит RAW prerouting, connection tracking (состояние new), dstnat (правил нет), маршрутизацию (адресат сам маршрутизатор) и наконец **filter input**. Ping, который отправляет сам маршрутизатор, начинается в **output**.

Попробуйте путь пакета в симуляторе **Порядок правил файрвола**.

# Lesson: Connection tracking подробно

**Connection tracking** запоминает каждое соединение, которое видит маршрутизатор. Благодаря этому файрвол знает, начинает ли пакет что-то новое или относится к уже разрешённому разговору.

### Состояния соединений

| Состояние | Значение | Пример |
|---|---|---|
| **new** | Первый пакет соединения | TCP SYN |
| **established** | Пакет известного соединения (трафик был в обе стороны) | Остальная часть веб-страницы |
| **related** | Новое соединение, связанное с существующим | ICMP «destination unreachable» о TCP-сессии, канал данных FTP |
| **invalid** | Ни к чему не относится и ничего корректного не начинает | TCP ACK без известного соединения |
| **untracked** | Пакет помечен **notrack** в RAW | Доверенный объёмный трафик |

### Настройки

    /ip firewall connection tracking print
    /ip firewall connection tracking set enabled=auto

- **enabled=auto** (по умолчанию): отслеживание включается, **как только появляется хотя бы одно правило файрвола**.
- **enabled=yes / no**: всегда вкл / выкл. Без отслеживания не работают stateful-правила и NAT.
- Таймауты (`tcp-established-timeout=1d`, `udp-timeout=10s`...) задают, сколько хранится неактивная запись.
- `/ip firewall connection print` показывает таблицу; **max-entries** показывает предел.

### Почему состояние важно для безопасности

Хороший файрвол отвечает на 99% пакетов одним дешёвым правилом: **accept established, related**. Дальше вниз по списку, где стоят дорогие проверки, идут только пакеты **new**. Пакеты в состоянии **invalid** отбрасываются сразу: они часто появляются при сканировании или подмене адресов.

### FastTrack

`action=fasttrack-connection` позволяет пакетам **established**-соединения пропускать большую часть файрвола, mangle и очередей. Это сильно экономит CPU, но эти пакеты не видят следующие правила и очереди. Используйте только для трафика, которому доверяете.

# Lesson: RAW и notrack

Таблица **RAW** работает **до connection tracking**. Поэтому это лучшее место, чтобы отбрасывать заведомо ненужный трафик: маршрутизатор не создаёт запись о соединении, не тратит память и проверяет очень мало правил.

### Цепочки и действия RAW

- Цепочки: **prerouting** (входящие пакеты) и **output** (пакеты самого маршрутизатора).
- Действия: **accept**, **drop**, **notrack**, **jump**, **return**, **log**, **passthrough**, **add-src-to-address-list**, **add-dst-to-address-list**.
- **Нет reject**, нет NAT, нет проверки connection-state (состояния ещё нет).

### Пример 1: отбрасываем поддельные источники

Пакеты из Интернета никогда не должны иметь частный адрес источника. Если имеют, адрес подделан.

    /ip firewall address-list
    add list=not_in_internet address=10.0.0.0/8
    add list=not_in_internet address=172.16.0.0/12
    add list=not_in_internet address=192.168.0.0/16
    /ip firewall raw
    add chain=prerouting in-interface-list=WAN src-address-list=not_in_internet action=drop \
        comment="drop spoofed private sources from the WAN"

Пошагово, почему важен `in-interface-list=WAN`: ваша LAN *использует* 192.168.0.0/16. Без условия по интерфейсу правило отбросило бы ваш собственный ноутбук.

### Пример 2: дёшево блокируем известного атакующего

    /ip firewall raw add chain=prerouting src-address-list=blacklist action=drop

То же правило в filter тоже сработает, но каждый пакет сначала пройдёт connection tracking. При атаке в тысячи пакетов в секунду RAW оставляет CPU свободным.

### notrack

`action=notrack` позволяет пакету миновать connection tracking. В filter он виден с **connection-state=untracked**. Используйте для больших доверенных потоков (например, трафик между двумя вашими серверами), где отслеживание лишь нагрузка. Если вы используете notrack, правило «accept established,related» должно принимать и **untracked**:

    /ip firewall filter add chain=input connection-state=established,related,untracked action=accept

# Lesson: Строим защищённый фильтр

### Действия, которые останавливают обработку, и которые нет

| Действие | Останавливает обработку? |
|---|---|
| accept, drop, reject, tarpit, fasttrack-connection | **Да** |
| return | Возврат в вызвавшую цепочку |
| jump | Переход в другую цепочку; если там ничего не совпало, возврат и продолжение после jump |
| **log, passthrough, add-src-to-address-list, add-dst-to-address-list** | **Нет**, пакет идёт к следующему правилу |

**drop** молча отбрасывает пакет. **reject** отбрасывает и отправляет обратно ICMP-ошибку или TCP reset (`reject-with=`). Для Интернета лучше drop: атакующий получает меньше информации, и это ничего не стоит.

Если ни одно правило не совпало, пакет **принимается**. Поэтому каждая защищённая цепочка заканчивается правилом drop.

### Защищённая цепочка input, пошагово

    /ip firewall filter
    add chain=input action=accept connection-state=established,related,untracked comment="1. known traffic"
    add chain=input action=drop connection-state=invalid comment="2. invalid"
    add chain=input action=accept protocol=icmp comment="3. ping and ICMP errors"
    add chain=input action=accept in-interface-list=LAN comment="4. management from the LAN"
    add chain=input action=drop in-interface-list=!LAN comment="5. everything else from outside"

Читайте как историю: известные разговоры проходят быстро; сломанные пакеты погибают; ICMP полезен для диагностики; LAN может управлять маршрутизатором; всех остальных отбрасываем.

### Защищённая цепочка forward

    add chain=forward action=fasttrack-connection connection-state=established,related hw-offload=yes
    add chain=forward action=accept connection-state=established,related,untracked
    add chain=forward action=drop connection-state=invalid
    add chain=forward action=drop connection-state=new connection-nat-state=!dstnat in-interface-list=WAN \
        comment="drop new from WAN that is not port-forwarded"

Последнее правило отбрасывает все **новые** соединения из Интернета, **кроме** проброшенных правилом dst-nat. `connection-nat-state=!dstnat` сохраняет работу ваших пробросов портов.

### Свои цепочки

Делайте список правил читаемым с помощью своих цепочек:

    add chain=input protocol=tcp dst-port=22 action=jump jump-target=ssh-check
    add chain=ssh-check src-address-list=ssh_blacklist action=drop
    add chain=ssh-check action=return

Если в `ssh-check` ничего не совпало, пакет возвращается и продолжает путь после jump.

### Лаба курса

- **Лаба «Stateful-файрвол с защитой в RAW»**: постройте цепочки input и forward, список адресов `not_in_internet` и правило RAW против поддельных источников, не сломав ноутбуку доступ в Интернет.
