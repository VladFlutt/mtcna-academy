# Lesson: Конфигурация по умолчанию и доступ к управлению

> Этот урок идёт по слайдам курса, глава 2.2 «Security Basic Firewall».

### Что уже есть на новом маршрутизаторе

RouterBOARD приходит не пустым. RouterOS применяет **конфигурацию по умолчанию**, зависящую от модели: обычно ether1 это WAN с DHCP-клиентом, остальные порты собраны в бридж LAN с адресом 192.168.88.1/24, есть DHCP-сервер, src-nat masquerade и небольшой файрвол.

Прочитать эту конфигурацию можно ещё до того, как вы что-то поменяли:

    /system default-configuration print

Вывод показывает скрипт, который RouterOS выполнил при первом запуске. Две вещи стоит знать:

- **`/system reset-configuration`** возвращает её обратно. С `no-defaults=yes` вы получите полностью пустой маршрутизатор.
- **`/system default-configuration print`** показывает и `custom-script` — место, куда вендор или интегратор может добавить свои строки к набору по умолчанию.

> **Почему курс по безопасности начинается отсюда:** конфигурация по умолчанию написана для домашнего пользователя, который должен достучаться до маршрутизатора в первый же день. Это хорошая отправная точка, но не финал. Весь этот модуль о том, как превратить её в то, что не страшно выставить на публичный адрес.

### Топология лаб со слайдов

Слайды используют простую учебную схему, и лабы этого курса повторяют её форму:

- У каждого студенческого маршрутизатора на WAN адрес **22.1.1.x/24**.
- LAN за ним это **192.168.x.1/24**, где `x` это номер студента.
- Пользователь управления `man` с паролем `Man33ioP` заменяет стандартного `admin`.

Держите схему в голове: *одна общая подсеть WAN и своя LAN у каждого*. Это объясняет, почему в правилах со слайдов так часто разрешается один адрес вроде `22.1.1.133`, а не целая сеть.

### Защита сервисов RouterOS

Это самая ценная страница главы. Пошагово:

    /ip service disable telnet,ftp,www,www-ssl,api
    /ip service set winbox port=8288
    /ip service set ssh port=2200 address=10.1.1.0/24
    /ip service set api-ssl port=8729 address=10.1.1.121

Читаем построчно:

1. **Выключите то, чем не пользуетесь.** telnet, ftp и www передают учётные данные открытым текстом. api и www-ssl нужны обычно только там, где маршрутизатор чем-то автоматизируют.
2. **Перенесите порты того, что оставили.** Winbox на 8288 вместо 8291, SSH на 2200 вместо 22. Защищённее сервис от этого не становится, но из логов уходит почти весь автоматический шум.
3. **Ограничьте по адресу.** `address=10.1.1.0/24` означает, что сам сервис отказывает всем другим источникам, даже если правило файрвола написано неверно. `address=10.1.1.121` ограничивает api-ssl одной станцией управления.

Дальше сервисы второго уровня и инструменты:

    /tool mac-server set allowed-interface-list=none
    /tool mac-server mac-winbox set allowed-interface-list=none
    /tool mac-server ping set enabled=no
    /tool bandwidth-server set enabled=no
    /ip proxy set enabled=no
    /ip socks set enabled=no
    /ip upnp set enabled=no
    /ip cloud set ddns-enabled=no update-time=no

`allowed-interface-list=none` строже, чем список `LAN` из прошлого модуля: по MAC до маршрутизатора не достучится никто. Используйте `none` там, где вы всегда ходите по IP, и `LAN` там, где MAC-доступ это ваш аварийный путь.

### Сильная криптография для SSH

    /ip ssh set strong-crypto=yes

Слайды прямо перечисляют, что меняет этот флаг:

- Используются **более стойкие шифры**: `aes-128-ctr`, `aes-192-ctr`, `aes-256-ctr` вместо слабых.
- Отключаются **нулевое шифрование**, **3DES**, **MD5** и старый обмен ключами только по **SHA1**.
- Предпочитается **SHA-256** для кода аутентификации сообщений.
- Используется **2048-битный** ключ хоста вместо 1024-битного.

Старые клиенты после этого могут не подключиться. Обновите клиент, а не ослабляйте маршрутизатор.

### Интерфейсы, которыми вы не пользуетесь

    /interface print
    /interface ethernet disable ether6,ether7,ether8

Включённый неиспользуемый порт в общественном месте это открытая дверь в ваш бридж LAN. Отключите его, а если порт должен работать, дайте ему отдельный изолированный бридж или VLAN.

### Пример бридж-фильтра: только PPPoE

Бридж-фильтры работают с кадрами, до любой обработки IP. Пример со слайда пропускает через бридж только PPPoE и отбрасывает остальное:

    /interface bridge filter
    add chain=forward action=accept mac-protocol=pppoe
    add chain=forward action=accept mac-protocol=pppoe-discovery
    add chain=forward action=drop

Читайте как белый список: два accept, затем один drop, который ловит всё остальное. Та же форма, что и у хорошей цепочки IP-фильтра.

### Лаба со слайдов

> **Лаба:** *Откройте api-ssl и Winbox только с адреса 22.1.1.133.*

    /ip service set api-ssl disabled=no address=22.1.1.133
    /ip service set winbox address=22.1.1.133
    /ip service print

Теперь попробуйте с другого адреса: соединение отклонит сам сервис, а не правило фильтра. В этом и смысл упражнения, и это первый слой эшелонированной защиты.

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

# Lesson: Области безопасности, свои цепочки и фильтрация ICMP

> Этот урок идёт по слайдам курса, глава 2.2 «Security Basic Firewall».

### Stateless и stateful рядом

Прежде чем строить цепочки, слайды сравнивают два способа фильтрации:

| | **Stateless** | **Stateful** |
|---|---|---|
| На что смотрит | На один пакет сам по себе | На пакет **и** на соединение, к которому он относится |
| Нужен connection tracking | Нет | Да |
| Обратный трафик | Правила нужно писать руками | Закрывается одним правилом `established,related` |
| CPU и память | Дешевле всего | Запись в таблице отслеживания на каждое соединение |
| Ловит пакеты `invalid` | Нет | Да |
| Обычное место в RouterOS | Таблица **RAW** | Таблица **filter** |

Ни один не лучше другого, они работают в паре. Приём MTCSE звучит так: **stateful в filter для логики, stateless в RAW против флуда.**

### Области безопасности

**Область безопасности (security area)** это просто группа интерфейсов, которым вы доверяете одинаково. В RouterOS это **списки интерфейсов**, и на слайдах их два: красная область WAN и зелёная LAN.

    /interface list
    add name=WAN
    add name=LAN

    /interface bridge add name=bridge1
    /interface bridge port add bridge=bridge1 interface=ether4
    /interface bridge port add bridge=bridge1 interface=ether5

    /interface list member
    add interface=ether1 list=WAN
    add interface=ether2 list=WAN
    add interface=bridge1 list=LAN
    add interface=ether3 list=LAN

Почему слайды настаивают на этом:

- **Меньше правил.** Одно правило с `in-interface-list=WAN` заменяет по правилу на каждый WAN-порт.
- **Меньше CPU.** Для каждого пакета нужно пройти меньше правил.
- **Ничего не переписывать при изменении сети.** Подключили второго провайдера в ether2, добавили порт в список `WAN`, и все существующие правила уже его учитывают.

Обратите внимание: ether2 в списке, хотя ISP2 только *планируется*. Это сделано осознанно: область определяется ролью порта, а не тем, что в него включено сегодня.

### Свои цепочки

Встроенные цепочки это **input**, **forward** и **output**. Своих можно создать сколько угодно, в filter, NAT и mangle. Причин со слайдов две: **меньше нагрузки на CPU** и **читаемый набор правил**.

Как получается экономия CPU, по шагам. Пусть пришло 100 пакетов, из них только 1 это ICMP, и у вас 5 правил по ICMP плюс drop:

- **Без своей цепочки**: все 6 правил ICMP лежат в `input`. Каждый из 100 пакетов сравнивается со всеми 6. Это 600 сравнений.
- **Со своей цепочкой**: в `input` одно правило, *если ICMP, то jump в ICMP-Filter*. 99 не-ICMP пакетов не проходят эту одну проверку и идут дальше. Только 1 пакет ICMP проходит 6 правил внутри цепочки. Это около 105 сравнений.

Выигрыш в читаемости это та же идея, применённая к направлению трафика. Слайды делят `forward` по областям безопасности:

    /ip firewall filter
    add chain=forward action=accept connection-state=established,related
    add chain=forward action=jump jump-target=WANsToLANs in-interface-list=WAN out-interface-list=LAN
    add chain=forward action=jump jump-target=LANsToWANs in-interface-list=LAN out-interface-list=WAN
    add chain=forward action=jump jump-target=LANsToLANs in-interface-list=LAN out-interface-list=LAN

Теперь каждая цепочка отвечает на один вопрос:

- **WANsToLANs**: какие публичные сервисы доступны из интернета? Заканчивается на `drop`.
- **LANsToWANs**: что моим пользователям нельзя в интернет? Заканчивается на `drop` или `accept`, в зависимости от политики.
- **LANsToLANs**: могут ли мои сети общаться между собой?

Пример `WANsToLANs` со слайдов: публикуем три сервера и отбрасываем остальное:

    add chain=WANsToLANs protocol=tcp dst-address=192.168.33.100 dst-port=3389 src-address-list=GOODGUYS action=accept
    add chain=WANsToLANs protocol=tcp dst-address=192.168.33.220 dst-port=80,110 action=accept
    add chain=WANsToLANs protocol=tcp dst-address=192.168.33.200 dst-port=443 action=accept
    add chain=WANsToLANs action=drop

> **Помните про `return`:** если в своей цепочке ничего не совпало, пакет возвращается в ту цепочку, которая сделала jump, и продолжает *после* правила jump. Поэтому своя цепочка, которая должна быть окончательной, заканчивается собственным `drop`.

### Фильтрация ICMP

**ICMP** переносит сообщения об ошибках и диагностику для IP. В нём **нет аутентификации**, то есть подделать можно что угодно, и именно поэтому файрвол должен решать **по типу и коду**, что он принимает.

Отбросить весь ICMP это классическая ошибка новичка: ломаются `ping`, `traceroute` и, что хуже, **path MTU discovery**, из-за чего большие пакеты начинают молча пропадать.

Рекомендованный набор со слайда, собранный как своя цепочка:

    /ip firewall filter
    add chain=input protocol=icmp action=jump jump-target=icmp
    add chain=icmp protocol=icmp icmp-options=0:0 action=accept comment="echo reply"
    add chain=icmp protocol=icmp icmp-options=3:0 action=accept comment="net unreachable"
    add chain=icmp protocol=icmp icmp-options=3:1 action=accept comment="host unreachable"
    add chain=icmp protocol=icmp icmp-options=3:4 action=accept comment="fragmentation needed"
    add chain=icmp protocol=icmp icmp-options=4:0 action=accept comment="source quench"
    add chain=icmp protocol=icmp icmp-options=8:0 action=accept comment="echo request"
    add chain=icmp protocol=icmp icmp-options=11:0 action=accept comment="time exceeded"
    add chain=icmp protocol=icmp icmp-options=12:0 action=accept comment="parameter problem"
    add chain=icmp protocol=icmp action=drop comment="deny all other types"

Синтаксис это `icmp-options=тип:код`. Восемь типов выше это те, которые действительно нужны:

| Тип:код | Название | Зачем оставляем |
|---|---|---|
| 8:0 | echo request | `ping` в вашу сторону работает |
| 0:0 | echo reply | на ваш собственный `ping` приходят ответы |
| 3:4 | fragmentation needed | **path MTU discovery**; без него большие пакеты пропадают |
| 3:0, 3:1 | net / host unreachable | о недоступности сообщают, а не подвешивают соединение |
| 11:0 | time exceeded | работает `traceroute` |
| 12:0 | parameter problem | сообщается о некорректных заголовках |
| 4:0 | source quench | устаревший сигнал о перегрузке |

> **Где эти опции в Winbox:** New Firewall Rule → вкладка **Advanced** → раздел **ICMP Options**, который появляется только после выбора `protocol=icmp`. Поле `IPv4 Options` чуть выше это совсем другое, и слайды отдельно это подчёркивают, потому что его часто заполняют по ошибке.

Ограничение скорости естественно дополняет этот набор и разбирается в следующем модуле вместе с ping-флудом.

### Лаба со слайдов

> **Лаба:** *Перестройте файрвол так, чтобы логическое движение трафика было разложено по своим цепочкам, и разрешите только нужные типы и коды ICMP в отдельной цепочке.*

Порядок работы, в Safe Mode:

1. Создайте списки интерфейсов `WAN` и `LAN` и положите каждый интерфейс в один из них.
2. Перепишите `forward` как четыре правила: accept established/related, затем три jump.
3. Наполните `WANsToLANs`, `LANsToWANs` и `LANsToLANs`, каждая со своим завершающим действием.
4. Добавьте цепочку `icmp` выше и jump в неё из `input`.
5. Посмотрите счётчики через `/ip firewall filter print stats` и увидите, какие правила реально срабатывают.

### Лаба курса

- **Лаба «Stateful-файрвол с защитой в RAW»**: постройте цепочки input и forward, список адресов `not_in_internet` и правило RAW против поддельных источников, не сломав ноутбуку доступ в Интернет.
