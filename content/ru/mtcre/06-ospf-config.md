# Lesson: OSPF в RouterOS 7: instance, area, template

В RouterOS 7 OSPF перестроен вокруг трёх объектов.

1. **Instance**: один процесс OSPF с его router ID и глобальными настройками (перераспределение, маршрут по умолчанию, фильтры).
2. **Area**: принадлежит instance; у неё есть area ID и тип.
3. **Interface template**: говорит, какие интерфейсы (или какие сети) участвуют в OSPF, в какой области и с какими настройками (тип, стоимость, приоритет, passive, таймеры).

Минимальная конфигурация одного маршрутизатора в магистрали:

    /routing ospf instance add name=default-v2 router-id=10.255.255.1
    /routing ospf area add name=backbone-v2 area-id=0.0.0.0 instance=default-v2
    /routing ospf interface-template add area=backbone-v2 interfaces=ether1,ether2 type=ptp
    /routing ospf interface-template add area=backbone-v2 interfaces=ether5,lo passive

## Interface template

Шаблон выбирает интерфейсы одним из двух способов:

- `interfaces=ether1,ether2` (или interface list): эти интерфейсы;
- `networks=10.0.0.0/16`: все интерфейсы, у которых есть адрес внутри этого префикса.

Шаблоны проверяются **по порядку**, и интерфейс получает первый подходящий. Чтобы дать одному интерфейсу особую стоимость, добавьте более точный шаблон **выше** общего (`place-before=0`). Интерфейсы, на которых OSPF реально работает, с полученными настройками видны в `/routing ospf interface print`; этот список динамический и только для чтения.

## Router ID

Задавайте его явно. Если оставить `router-id` по умолчанию (`main`), RouterOS выберет один из адресов маршрутизатора (предпочитая loopback), и ID может смениться при изменении адресов, а это перезапускает OSPF. Хорошая привычка: адрес /32 на loopback-интерфейсе каждого маршрутизатора, и он же router ID.

    /interface bridge add name=lo           (loopback в стиле RouterOS 6)
    /ip address add address=10.255.255.1/32 interface=lo

В RouterOS 7 есть встроенный интерфейс `lo`, на который можно поставить адрес.

## RouterOS 6 и 7

| | RouterOS 6 | RouterOS 7 |
|---|---|---|
| процесс | `/routing ospf instance` (default уже есть) | `/routing ospf instance add` |
| области | `/routing ospf area` (backbone уже есть) | `/routing ospf area add` (ничего нет) |
| включение на интерфейсах | `/routing ospf network add network=10.0.12.0/30 area=backbone` | `/routing ospf interface-template add networks=… area=…` |
| настройки интерфейса | `/routing ospf interface add interface=ether1 network-type=point-to-point cost=10` | в шаблоне: `type=ptp cost=10` |
| перераспределение | `redistribute-connected=as-type-1` | `redistribute=connected` + routing filter для типа |
| маршрут по умолчанию | `distribute-default=if-installed-as-type-2` | `originate-default=if-installed` |
| stub без summary | `inject-summary-lsas=no` | `no-summaries` |
| фильтры | `/routing filter`, цепочки ospf-in / ospf-out с условиями | `/routing filter rule` с небольшим языком скриптов |
| соседи | `/routing ospf neighbor print` | `/routing ospf neighbor print` |

Слайды курса написаны для RouterOS 6; лабы здесь используют RouterOS 7.

# Lesson: Проверка OSPF

    /routing ospf neighbor print
    /routing ospf interface print
    /routing ospf lsa print
    /ip route print

- **neighbor**: каждый сосед с его router ID, адресом, состоянием и (в broadcast-сетях) тем, DR он или BDR. Нужно `Full` (или `2-Way` между DROther).
- **interface**: интерфейсы, на которых работает OSPF, с их типом, стоимостью, состоянием (DR, BDR, DROther, ptp, passive) и приоритетом.
- **lsa**: база состояния каналов: тип, создатель, ID, номер последовательности, возраст.
- **routes**: у маршрутов OSPF флаг **o** и distance 110.

## Когда соседи не поднимаются

1. Пингуют ли два маршрутизатора друг друга по этому каналу? OSPF сначала нужна IP-связность.
2. Одна и та же область на обоих концах? Одна подсеть?
3. Одинаковые интервалы hello и dead, аутентификация?
4. Одинаковый тип области на обоих концах (stub, NSSA)?
5. Не passive ли одна из сторон? Passive-интерфейс вообще не отправляет hello.
6. Зависли в ExStart или Exchange: сравните MTU интерфейсов на обоих концах.
7. Firewall: OSPF является IP-протоколом 89 на 224.0.0.5 и 224.0.0.6. Строгая цепочка input должна его пропускать (`protocol=ospf`).
8. Два маршрутизатора с одинаковым router ID: OSPF пишет в лог о дублирующемся router ID.

RouterOS пишет проблемы OSPF в лог (`/log print where topics~"ospf"`).

![Что должен показывать neighbor print в broadcast-сегменте: Full с DR и BDR, 2-Way с остальными DROther (слайд курса)](/img/mtcre/re-ospf-dr.webp)

# Lesson: Стоимость, passive-интерфейсы, типы сетей

## Passive-интерфейсы

LAN, в которой только компьютеры, нужно анонсировать, но говорить там OSPF не должен: hello в пользовательскую сеть бесполезны и опасны (кто угодно может запустить OSPF-маршрутизатор и подсунуть маршруты). Сделайте интерфейс **passive**: его сеть анонсируется, но hello не отправляются и соседи не принимаются.

    /routing ospf interface-template add area=backbone-v2 interfaces=ether5,lo passive

Loopback-адреса анонсируются так же.

## Стоимость

    /routing ospf interface-template add area=backbone-v2 interfaces=ether2 type=ptp cost=100 place-before=0

Помните, что стоимость задаётся на **исходящем** интерфейсе и суммируется вдоль пути. Чтобы R1 обходил свой прямой канал к R3, поднимите стоимость R1 на этом интерфейсе; обратное направление (от R3 к R1) изменится, только если изменить стоимость и на R3. Разные стоимости в двух направлениях дают асимметричные пути, которые работают, но запутывают поиск неисправностей. При равных суммарных стоимостях OSPF ставит маршруты ECMP.

## Тип сети

    /routing ospf interface-template add area=backbone-v2 interfaces=ether1 type=ptp

На канале ровно с двумя маршрутизаторами `type=ptp` пропускает выборы DR и 40-секундное ожидание, поэтому смежность поднимается и восстанавливается быстрее. В сегментах с большим числом маршрутизаторов оставьте `broadcast` и задайте там **priority**, если DR должен стать определённый маршрутизатор (мощный центральный, а не маленький CPE). `priority=0` исключает маршрутизатор из выборов.

| type | DR | применение |
|---|---|---|
| broadcast | да | Ethernet с несколькими маршрутизаторами |
| ptp | нет | кабель между маршрутизаторами, туннели |
| ptmp | нет | хаб и филиалы через одну среду (беспроводная) |
| nbma | да | нет multicast: добавьте `/routing ospf static-neighbor` |

## Таймеры и BFD

По умолчанию hello-interval 10 с и dead-interval 40 с; на обеих сторонах они должны совпадать. Чтобы обнаруживать отказ быстрее 40 секунд, используйте **BFD** (`use-bfd=yes` в шаблоне и настройка BFD): он замечает мёртвый канал гораздо быстрее секунды.

# Lesson: Несколько областей, stub-области и суммирование

У ABR есть интерфейсы в области 0 и в другой области. Создайте на нём обе области и поместите каждый интерфейс в нужную:

    /routing ospf area add name=area1 area-id=0.0.0.1 instance=default-v2
    /routing ospf interface-template add area=backbone-v2 interfaces=ether1 type=ptp
    /routing ospf interface-template add area=area1 interfaces=ether2 type=ptp

Маршрутизаторам внутри области 1 нужна только область 1:

    /routing ospf area add name=area1 area-id=0.0.0.1 instance=default-v2
    /routing ospf interface-template add area=area1 interfaces=ether2 type=ptp
    /routing ospf interface-template add area=area1 interfaces=ether4,ether5,lo passive

**Имя** области локально для каждого маршрутизатора; совпадать должен **area-id**.

## Stub и totally stubby

    /routing ospf area set area1 type=stub                  (на каждом маршрутизаторе области 1)
    /routing ospf area set area1 no-summaries=yes           (на ABR: totally stubby)

В stub-области ABR автоматически добавляет маршрут по умолчанию; `originate-default` для этого не нужен. `no-summaries` имеет значение только на ABR, потому что summary создаёт только ABR. Для NSSA используйте `type=nssa`; маршрут по умолчанию в NSSA не появляется автоматически.

## Area range (суммирование)

Без суммирования ABR отправляет в магистраль по одному LSA типа 3 на каждую сеть. Если область 1 использует для всех своих сетей 10.1.0.0/16, их заменяет один range:

    /routing ospf area range add area=area1 prefix=10.1.0.0/16 advertise=yes

- Range настраиваются на ABR, для той области, в которой находятся сети.
- `advertise=no` полностью подавляет сети (способ скрыть сети области).
- Суммирование ещё и стабилизирует сеть: мигающий канал внутри области 1 больше ничего не меняет за её пределами.
- Планируйте адресацию так, чтобы области можно было суммировать: непрерывный блок на область.

![Без range анонсируется каждая сеть области 1; с range магистраль видит один суммарный маршрут (слайд курса)](/img/mtcre/re-ospf-range.webp)

Лаба **OSPF с несколькими областями, stub и суммирование** строит именно это: ABR, stub-область, затем totally stubby, и range.

# Lesson: Маршрут по умолчанию, перераспределение и фильтры маршрутов

## Создание маршрута по умолчанию

Маршрутизатор с подключением к Интернету сообщает об этом всем остальным:

    /routing ospf instance set default-v2 originate-default=if-installed

| originate-default | Значение |
|---|---|
| never | по умолчанию; маршрут по умолчанию не анонсируется |
| if-installed | анонсировать маршрут по умолчанию, только пока у этого маршрутизатора есть свой активный маршрут по умолчанию |
| always | анонсировать всегда, даже без аплинка |

`if-installed` является безопасным выбором: если пограничный маршрутизатор теряет провайдера, его собственный маршрут по умолчанию исчезает, он перестаёт его анонсировать, и другие маршрутизаторы могут использовать другой выход. С `always` маршрутизаторы продолжают отправлять трафик на пограничный маршрутизатор, которому некуда его деть.

## Перераспределение

Маршруты не из OSPF (connected-сети без OSPF на них, статические маршруты, BGP) можно добавить как внешние. Маршрутизатор становится ASBR.

    /routing ospf instance set default-v2 redistribute=static
    /routing ospf instance set default-v2 redistribute=connected,static

Перераспределённые маршруты являются внешними типа 2 с метрикой 20, если фильтр их не меняет.

## Внешние типа 1 и типа 2

- **type 2** (по умолчанию): все маршрутизаторы видят одну и ту же стоимость, внешнюю метрику. Если два ASBR анонсируют один маршрут с одинаковой метрикой, более близкий внутри OSPF выигрывает только как разрешение ничьей.
- **type 1**: стоимость равна внешней метрике плюс внутренней стоимости OSPF до ASBR. Каждый маршрутизатор выбирает действительно ближайший к нему выход.

![Type 1: в итоговую стоимость входит путь до каждого ASBR, поэтому каждый маршрутизатор использует ближайший выход (слайд курса)](/img/mtcre/re-ospf-type1.webp)

![Type 2: считается только внешняя метрика, поэтому все маршрутизаторы используют выход с меньшей метрикой (слайд курса)](/img/mtcre/re-ospf-type2.webp)

Используйте type 1, когда выходов несколько и каждый маршрутизатор должен использовать ближайший; type 2, когда один выход должны предпочитать все.

## Фильтры маршрутов (RouterOS 7)

Фильтры маршрутов RouterOS 7 являются небольшими программами в `/routing filter rule`. Правила с одним `chain` выполняются по порядку; первое `accept` или `reject` завершает цепочку. **Цепочка, закончившаяся без решения, отклоняет маршрут**, поэтому, если вы хотите изменить лишь некоторые маршруты, заканчивайте явным `accept`.

    /routing filter rule add chain=ospf-out rule="if (dst in 172.20.0.0/16) { set ospf-ext-type type1; accept }"
    /routing filter rule add chain=ospf-out rule="accept"
    /routing ospf instance set default-v2 out-filter-chain=ospf-out

- **out-filter-chain**: применяется к маршрутам, которые этот маршрутизатор перераспределяет (внешним).
- **in-filter-chain**: применяется к маршрутам OSPF перед установкой в таблицу маршрутизации. LSDB он не меняет, только то, что ставит этот маршрутизатор.

Полезные элементы синтаксиса:

| Условие / действие | Пример |
|---|---|
| точный префикс | `dst == 192.168.2.0/24` |
| внутри префикса | `dst in 192.168.0.0/16` |
| длина префикса | `dst-len > 24`, `dst-len in 16-32` |
| протокол | `protocol static` |
| решения | `accept`, `reject`, `jump other-chain`, `return` |
| изменения | `set ospf-ext-type type1`, `set ospf-ext-metric 50`, `set distance 120` |

    rule="if (dst in 192.168.0.0/16 && dst-len in 16-32) { reject } else { accept }"

> **RouterOS 6:** `/routing filter add chain=ospf-in prefix=192.168.0.0/16 prefix-length=16-32 action=discard`. Условия были полями, синтаксиса скриптов не было.

![Фильтры маршрутов RouterOS 6 в Winbox: отбросить ровно 192.168.0.0/16 или всё внутри неё с длиной от 16 до 32 (слайд курса)](/img/mtcre/re-ospf-filter-v6.webp)

## Подводные камни перераспределения

- Перераспределение **connected** на пограничном маршрутизаторе анонсирует и сеть канала провайдера, а на маршрутизаторе с туннелями и публичные сети туннелей; тогда другие маршрутизаторы могут направить трафик туннеля в OSPF и сломать туннели. Фильтруйте out-цепочкой, которая пропускает только то, что вы задумали.
- Перераспределение **маршрута по умолчанию** как статического плюс `originate-default` дают два источника; используйте только `originate-default`.
- Два маршрутизатора, перераспределяющие маршруты друг друга между двумя протоколами, могут создать петли; фильтруйте в обе стороны.

Лаба **OSPF: маршрут по умолчанию, перераспределение и фильтры** собирает всё это вместе: маршрут по умолчанию с `if-installed`, перераспределённый статический маршрут филиала и фильтр, который делает его type 1.

## Рекомендации курса

- Используйте ключи аутентификации на интерфейсах OSPF в общих сегментах.
- Выбирайте DR сами с помощью приоритетов.
- Используйте правильный тип сети (ptp на каналах между маршрутизаторами).
- Используйте типы областей и суммирование, чтобы LSDB оставалась небольшой.
- Держите пользовательские LAN в режиме passive.
