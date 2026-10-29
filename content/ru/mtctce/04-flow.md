# Lesson: Пять цепочек

Каждый IP-пакет, касающийся маршрутизатора, идёт по одному из трёх путей:

| Трафик | Пример | Путь |
|---|---|---|
| к маршрутизатору | Winbox, DNS-запрос к маршрутизатору, ping маршрутизатора | prerouting → **input** → локальный процесс |
| через маршрутизатор | пользователь LAN открывает сайт | prerouting → **forward** → postrouting |
| от маршрутизатора | собственный DNS-запрос маршрутизатора, NTP, пакеты VPN | локальный процесс → **output** → postrouting |

Каждый этап это **цепочка**, и у каждой таблицы свои цепочки:

| Таблица | Цепочки |
|---|---|
| raw | prerouting, output |
| mangle | prerouting, input, forward, output, postrouting |
| nat | dstnat (в prerouting), srcnat (в postrouting) |
| filter | input, forward, output |

![Путь пакета в RouterOS: prerouting, решение маршрутизации, затем input, forward или output, и postrouting](/img/mtctce/packet-flow.svg)

## Внутри каждого этапа

- **prerouting**: RAW prerouting, **отслеживание соединений**, mangle prerouting, **dstnat**. Здесь же работает hotspot.
- **решение маршрутизации**: назначение (после dstnat) и routing mark выбирают маршрут. Пакет идёт в input, если он для маршрутизатора, иначе в forward с известным выходным интерфейсом.
- **input**: mangle input, filter input, затем глобальные очереди (queue tree с `parent=global` и простые очереди) для трафика к маршрутизатору.
- **forward**: уменьшается TTL, mangle forward, filter forward. Здесь решается FastTrack.
- **output**: собственный пакет маршрутизатора маршрутизируется, затем RAW output, отслеживание соединений, mangle output, filter output и **routing adjustment**: если mangle output поставил routing mark, маршрут ищется заново.
- **postrouting**: mangle postrouting, **srcnat**, hotspot out, проверка политик IPsec, глобальные и простые очереди и наконец **очередь интерфейса** (queue tree с `parent=<interface>` и тип очереди интерфейса).

Следствия, с которыми сталкиваешься каждый день:

- `out-interface` нельзя использовать в prerouting и dstnat: он ещё неизвестен. `in-interface` нельзя использовать в postrouting и srcnat.
- Правило forward для проброшенного сервера видит **частный** адрес и порт, потому что dstnat уже отработал.
- Routing mark, поставленный в forward или postrouting, уже не может изменить маршрут.

Проведите пакеты через этапы в симуляторе **путь пакета**.

# Lesson: Очереди в пути пакета, от RouterOS 5 до 7

В RouterOS 5 было несколько точек подключения глобальных очередей: **global-in** (после prerouting), **global-out** (после postrouting) и **global-total**. RouterOS 6 заменил их **одним глобальным HTB**, который обрабатывается в конце **input** и **postrouting**, вместе с **простыми очередями**. RouterOS 7 сохраняет эту схему.

| Очередь | Видит |
|---|---|
| queue tree `parent=global` и простые очереди | пакеты в input и postrouting, оба направления вместе |
| queue tree `parent=ether1` (интерфейс) | только пакеты, **выходящие** через этот интерфейс |

Поэтому **загрузку** пользователей LAN ограничивают на LAN-интерфейсе (или глобально с метками по направлениям), а **отдачу** на WAN-интерфейсе. Очередь на WAN-интерфейсе не может ограничить загрузку: когда скачанный пакет туда попадает, он уже прошёл медленный канал.

Практические правила со слайдов:

- Метки соединений ставьте в prerouting, метки пакетов в forward или postrouting, если нужен выходной интерфейс.
- Для глобальных деревьев разделяйте метки отдачи и загрузки через `out-interface` (выход в WAN = отдача, выход в LAN = загрузка).
- Простые очереди удобны для ограничений по хостам; queue tree это инструмент для приоритетов и сложных деревьев.

# Lesson: Бриджи и use-ip-firewall

Трафик между двумя портами **одного бриджа** коммутируется, а не маршрутизируется. Он проходит собственные цепочки бриджа (`/interface bridge filter` и `nat`, работающие с MAC-адресами), но **не** IP-файрвол, mangle и queue tree с IP-метками.

    /interface bridge settings set use-ip-firewall=yes

С **use-ip-firewall=yes** бриджевые IPv4-пакеты тоже проходят IP prerouting, forward и postrouting, так что правила IP-фильтра, метки mangle и очереди применяются к трафику между портами бриджа. Порты сопоставляйте через **in-bridge-port** и **out-bridge-port**: `in-interface` это сам бридж. Настройка стоит производительности и отключает аппаратную разгрузку бриджа, поэтому включайте её, только когда действительно нужен контроль бриджевого трафика на уровне IP (например, на прозрачном ограничителе скорости).

В RouterOS 7 эта опция та же. Схемы пути пакета в документации показывают блоки бриджинга, MPLS и маршрутизации отдельно; слайды разбирают их по шагам для RouterOS 6.

# Lesson: Fast path и FastTrack

Полный путь гибкий, но тратит CPU на каждый пакет. **Fast path** это короткий путь через маршрутизатор для пакетов, которым не нужны функции медленного пути.

**FastTrack** переводит установленные соединения на fast path:

    /ip firewall filter add chain=forward action=fasttrack-connection connection-state=established,related hw-offload=yes
    /ip firewall filter add chain=forward action=accept connection-state=established,related,untracked

- Первые пакеты каждого соединения идут обычным путём; после установления соединения его пакеты идут через FastTrack.
- `fasttrack-connection` не принимает пакет: следующее правило должно принять established и related.
- Пакеты FastTrack **обходят mangle, filter, NAT и все очереди**. Отслеживание соединений их всё ещё знает (в `/ip firewall connection` они помечены `F`).
- На некоторых устройствах `hw-offload=yes` переносит их в чип коммутатора.

Цена: всё, что вы хотите **маркировать, ограничивать или считать**, не должно попадать в FastTrack. Простая очередь пользователя перестаёт ограничивать после включения FastTrack, потому что его пакеты до неё больше не доходят. Исключите такой трафик выше правила fasttrack:

    /ip firewall filter add chain=forward action=accept connection-state=established,related src-address=192.168.33.50 place-before=0

Лаба **FastTrack** включает его и оставляет IP-телефон на медленном пути, готовым для модулей mangle и QoS.
