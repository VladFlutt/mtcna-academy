# Lesson: NAT углублённо

**Трансляция сетевых адресов** меняет адреса (и порты) соединения. Отслеживание соединений запоминает трансляцию и применяет обратную к каждому ответу, поэтому через правила NAT проходит только первый пакет соединения.

| Цепочка | Где | Действия | Матчеры |
|---|---|---|---|
| srcnat | postrouting, после маршрутизации | masquerade, src-nat, netmap, same | out-interface (in-interface недоступен) |
| dstnat | prerouting, до маршрутизации | dst-nat, redirect, netmap | in-interface (out-interface ещё неизвестен) |

## src-nat и masquerade

    /ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade
    /ip firewall nat add chain=srcnat out-interface=ether1 action=src-nat to-addresses=22.1.1.33

- **masquerade** берёт адрес выходного интерфейса для каждого нового соединения и сбрасывает соединения, когда интерфейс падает. Используйте его с динамическими адресами (DHCP, PPPoE).
- **src-nat** использует заданный адрес. С фиксированным публичным адресом он дешевле, и соединения переживают короткое падение канала.

## dst-nat и redirect

    /ip firewall nat add chain=dstnat dst-address=22.1.1.33 protocol=tcp dst-port=9999 action=dst-nat to-addresses=192.168.33.10 to-ports=8888

- **dst-nat** отправляет соединение на другой хост (проброс порта); `to-ports` меняет и порт.
- **redirect** отправляет его на сам маршрутизатор (DNS, прокси).

## Правило фильтра за пробросом порта

dstnat работает в prerouting, до цепочки filter forward. Поэтому правило forward видит **частный** адрес сервера и **новый** порт:

    /ip firewall filter add chain=forward src-address=212.0.200.2 dst-address=192.168.33.10 protocol=tcp dst-port=8888 action=drop

Правило с dst-address=22.1.1.33 dst-port=9999 в forward никогда не совпадёт. Безопасное правило forward по умолчанию `drop connection-state=new connection-nat-state=!dstnat in-interface-list=WAN` пропускает проброшенные соединения и отбрасывает всё остальное из WAN.

## Hairpin NAT

Пользователи LAN открывают сервер по публичному адресу 22.1.1.33:9999. Ломаются две вещи:

1. Правило dst-nat с `in-interface=ether1` не совпадает с трафиком из LAN. Сопоставляйте публичный адрес (`dst-address=22.1.1.33` или `dst-address-type=local`).
2. Затем сервер, находящийся в той же LAN, что и клиент, отвечает клиенту **напрямую** со своего частного адреса. Клиент ждёт ответа от 22.1.1.33 и отбрасывает его.

Исправление: masquerade для LAN → сервер, чтобы сервер отвечал маршрутизатору:

    /ip firewall nat add chain=srcnat src-address=192.168.33.0/24 dst-address=192.168.33.10 protocol=tcp dst-port=8888 out-interface=bridgeLAN action=masquerade

## netmap

`netmap` транслирует целую подсеть один к одному в другую подсеть того же размера, например чтобы соединить два офиса, оба использующие 192.168.1.0/24.

Лаба **проброс порта** строит dst-nat, правило forward и hairpin.

# Lesson: Метки: соединения, пакета и маршрутизации

Таблица mangle изменяет пакеты или навешивает **метки**, которые существуют только внутри маршрутизатора:

| Метка | Ставится | Используется |
|---|---|---|
| метка соединения | mark-connection | другими правилами mangle (`connection-mark=`) |
| метка пакета | mark-packet | queue tree и простыми очередями (`packet-mark=`, `packet-marks=`) |
| метка маршрутизации | mark-routing | маршрутизацией по политикам: выбирает таблицу маршрутизации (MTCRE) |

У пакета **не больше одной** метки каждого вида: второй mark-packet заменяет первый.

![Метки соединений ставятся один раз; метки пакетов питают очереди, метки маршрутизации выбирают таблицу маршрутизации](/img/mtctce/marks.svg)

## Сначала маркируйте соединение

Классифицировать пакет может быть дорого (address lists, connection-bytes, layer 7, content). Делайте это один раз на соединение, а затем маркируйте каждый пакет по метке соединения, это дешёвое сравнение:

    /ip firewall mangle add chain=prerouting connection-state=new src-address=192.168.33.50 action=mark-connection new-connection-mark=voip-conn passthrough=yes
    /ip firewall mangle add chain=prerouting connection-mark=voip-conn action=mark-packet new-packet-mark=voip passthrough=no

- Первое правило видит только новые соединения; дальше отслеживание соединений переносит метку на **оба направления**.
- Второе правило маркирует каждый пакет этих соединений и останавливается (`passthrough=no`).

## passthrough

После срабатывания правила mangle пакет идёт к следующим правилам цепочки, только если `passthrough=yes` (по умолчанию). С `passthrough=no` он покидает цепочку. Ставьте `no` на последнее правило, задающее нужную метку, чтобы следующее правило не перезаписало её, а CPU пропустил оставшиеся правила. `action=accept` в mangle делает то же без маркировки: mangle никогда не отбрасывает пакеты.

## Где маркировать

- **Метки маршрутизации** в prerouting (или в output для собственного трафика маршрутизатора): позже уже поздно.
- **Метки пакетов для очередей интерфейса** где угодно до конца postrouting.
- **Метки для глобального дерева** должны различать отдачу и загрузку: используйте `out-interface` в forward или postrouting (выход в WAN = отдача, выход в LAN = загрузка) или `in-interface` в prerouting.

# Lesson: Изменение пакетов: DSCP, TTL, MSS и другое

| Действие | Результат |
|---|---|
| change-dscp new-dscp=46 | задать DSCP (от 0 до 63), например EF для голоса, чтобы провайдер или следующий маршрутизатор дали приоритет |
| change-ttl new-ttl=set:65 / increment:1 / decrement:1 | изменить TTL |
| change-mss new-mss=1360 / clamp-to-pmtu | уменьшить TCP MSS в SYN-пакетах |
| set-priority new-priority=… | задать внутренний приоритет (используется WMM и приоритетом VLAN) |
| strip-ipv4-options | удалить IP-опции |
| sniff-tzsp | отправить копию пакета на приёмник TZSP (Wireshark) |
| add-src/dst-to-address-list | как в filter |

## DSCP для голоса

Лаба курса маркирует голосовой трафик телефона: RTP получает DSCP 46 (EF, TOS 0xB8), сигнализация SIP 26 (AF31, TOS 0x68), всё остальное 0:

    /ip firewall mangle add chain=postrouting packet-mark=voip protocol=udp dst-port=10000-20000 action=change-dscp new-dscp=46
    /ip firewall mangle add chain=postrouting packet-mark=voip protocol=udp dst-port=5060 action=change-dscp new-dscp=26

DSCP помогает только там, где его учитывают: в ваших очередях (матчер `dscp=46`), в сети провайдера, если договорились, и в Wi-Fi WMM.

## Ограничение MSS

Туннели и PPPoE уменьшают MTU. Если ICMP «fragmentation needed» теряется по пути, большие TCP-пакеты пропадают, и страницы зависают. Ограничение MSS в SYN-пакетах заставляет обе стороны с самого начала отправлять достаточно маленькие сегменты:

    /ip firewall mangle add chain=forward protocol=tcp tcp-flags=syn action=change-mss new-mss=clamp-to-pmtu passthrough=yes

## TTL

Каждый маршрутизатор уменьшает TTL на один. Изменение TTL может скрыть маршрутизатор от traceroute или сделать так, чтобы трафик устройств за NAT выглядел как трафик самого маршрутизатора (некоторые провайдеры обнаруживают раздачу подключения по TTL, который на единицу меньше). Знайте технику, но соблюдайте условия провайдера.

## Что маркировать: план из курса

| Класс | Примеры | Матчеры | Приоритет |
|---|---|---|---|
| важное | DNS, ICMP, SSH, короткие запросы HTTP/HTTPS | протокол, порты, `connection-bytes=0-500000` | 1 |
| запросы пользователей | интерактивный веб | порты 80, 443 | 3 |
| связь | VoIP, видеозвонки | порты, DSCP, адрес телефона | 5 |
| загрузки | большие передачи HTTP/HTTPS | `connection-bytes=500000-0` | 7 |
| peer to peer | всё неклассифицированное | остальное | 8 |

`connection-bytes=500000-0` совпадает с соединениями, передавшими больше 500 кБ: веб-страница грузится быстро, а длинная загрузка попадает в низкий класс.

Лаба **метки VoIP** строит метки соединения и пакета, DSCP и ограничение MSS.
