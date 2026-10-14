# Lesson: Simple queues

**Очереди** ограничивают и приоритизируют трафик. Самый простой инструмент это **simple queue** (**Queues > Simple Queues**).

    /queue simple add name=laptop target=192.168.88.254/32 max-limit=1M/1M

- **target**: чей трафик ограничивается: IP, подсеть, несколько адресов или **интерфейс**.
- **max-limit** = upload/download (с точки зрения клиента: `upload/download`). Можно задать для upload, download или общий.
- **dst** (необязательно): ограничивать только трафик к определённому назначению.
- Simple queues обрабатываются **сверху вниз**; трафик забирает **первая** совпавшая очередь. Более конкретная очередь должна быть **выше** общей.

### Пример из курса

Ограничить всех пользователей до 1M, но разрешить 3M к серверу 5.8.63.23:

1. Очередь *server*: target=192.168.88.0/24, dst=5.8.63.23, max-limit=3M/3M
2. Очередь *all*: target=192.168.88.0/24, max-limit=1M/1M

Если порядок обратный, очередь 1M забирает всё, и очередь 3M никогда не срабатывает.

### Лаба 9.1

Ограничьте ноутбук до 1M/1M, затем запустите тест скорости и наблюдайте в **Torch**.

### limit-at, max-limit и priority

- **limit-at** (CIR): гарантированная скорость.
- **max-limit** (MIR): максимальная скорость, если полоса свободна.
- **priority** 1..8: **1 самый высокий**, **8 самый низкий** (по умолчанию 8). Приоритет решает, кто из дочерних очередей одного родителя получит свободную полосу между limit-at и max-limit.
- **parent**: очереди можно вкладывать в дерево; дочерние делят лимит родителя.

# Lesson: Burst

**Burst** позволяет клиенту ненадолго превысить max-limit: веб-страницы открываются быстро, а большие загрузки всё равно ограничены.

Параметры (для каждого направления):

- **burst-limit**: максимальная скорость во время burst (должна быть больше max-limit).
- **burst-threshold**: когда **средняя** скорость **ниже** этого значения, burst разрешён (обычно между limit-at и max-limit).
- **burst-time**: окно (в секундах), за которое считается **средняя** скорость. Это **не** длительность burst.

Среднее пересчитывается каждые **burst-time/16**. Максимальная длительность burst после простоя = burst-threshold × burst-time / burst-limit.

Пример из курса: max-limit=2M, burst-limit=5M, burst-threshold=1M, burst-time=10s. Пользователь после простоя получает 5M примерно на 2 с (1M × 10 с / 5M), затем скорость падает до 2M. После паузы среднее снова опускается ниже 1M, и следующий burst возможен.

> Смотрите график в **Симуляторе burst**.

# Lesson: PCQ

**PCQ** (Per Connection Queue) автоматически создаёт подочередь для каждого пользователя (или соединения) по **классификатору** и делит полосу поровну. Одна очередь обслуживает всю сеть.

- Для **download** используйте классификатор **dst-address**; для **upload** **src-address**.
- **pcq-rate**: максимальная скорость на подпоток. **pcq-rate=0** означает отсутствие ограничения на пользователя: доступная полоса делится **поровну**.

    /queue type add name=pcq-down kind=pcq pcq-classifier=dst-address pcq-rate=0
    /queue type add name=pcq-up kind=pcq pcq-classifier=src-address pcq-rate=0
    /queue simple add name=lan target=192.168.88.0/24 max-limit=10M/10M queue=pcq-up/pcq-down

### Как делится скорость

При max-limit=512k:

| pcq-rate | Пользователей | Каждый получает |
|---|---|---|
| 128k | 1 | 128k |
| 128k | 4 | 128k |
| 128k | 7 | ≈73k (512k / 7) |
| 0 | 1 | 512k |
| 0 | 2 | 256k |
| 0 | 8 | 64k |

Встроенные типы очередей: **default** (pfifo), **default-small**, **ethernet-default**, **wireless-default** (sfq), **synchronous-default** (red), **hotspot-default** (sfq), **pcq-download-default**, **pcq-upload-default**, **only-hardware-queue** и **multi-queue-ethernet-default**.

> Попробуйте **Симулятор PCQ**.

# Lesson: Mangle и метки пакетов

**Mangle** (**IP > Firewall > Mangle**) **маркирует** пакеты, чтобы очереди и маршрутизация могли их распознать.

- Метки **локальны** для маршрутизатора: они никогда не передаются по сети.
- Типы меток: **connection-mark**, **packet-mark**, **routing-mark** (в v7: таблицы маршрутизации). У пакета может быть **по одной** метке каждого типа.
- Mangle может также менять **DSCP (TOS)**, **TTL**, **MSS** и некоторые другие поля заголовка.
- Правила выполняются сверху вниз; **passthrough=yes** означает перейти к следующему правилу после маркировки.

### Оптимальная маркировка

Маркировка каждого пакета по адресам и портам расходует CPU. Пометьте **соединение** один раз, затем маркируйте пакеты по **connection mark**:

    /ip firewall mangle
    add chain=prerouting src-address=192.168.33.0/24 protocol=tcp dst-port=80 \
        connection-state=new action=mark-connection new-connection-mark=web_conn passthrough=yes
    add chain=prerouting connection-mark=web_conn action=mark-packet \
        new-packet-mark=web_packet passthrough=no
    /queue simple add name=WEB_Limit target=192.168.33.0/24 packet-marks=web_packet \
        max-limit=2M/2M queue=pcq-upload-default/pcq-download-default

### Лаба 9.2

1. Ограничьте каждого пользователя LAN до 1M (PCQ).
2. Дайте группе **BOSS** (address list) 3M.
3. Веб-трафик: все получают burst до 5M, затем 2M.

# Lesson: Мониторинг трафика

- **Torch** (**Tools > Torch**): трафик на интерфейсе в реальном времени, с фильтрами и группировкой по src/dst адресу, порту, протоколу, VLAN. Идеально, чтобы найти, «кто забирает мою полосу».
- **Graphing** (**Tools > Graphing**): долговременные графики интерфейсов, очередей и ресурсов, просмотр в браузере по адресу **http://router-ip/graphs/**. Задайте *allow-address*, чтобы ограничить, кто может их смотреть.
- **Bandwidth Test** (**Tools > Bandwidth Test**): измерение пропускной способности между двумя устройствами MikroTik (или с btest.exe для Windows) по TCP или UDP, send/receive/both. На дальнем конце должен быть включён **BTest server** (`/tool bandwidth-server`); он использует TCP 2000 и UDP 2001-2100+, максимум 100 сессий. Тест к самому маршрутизатору измеряет и его CPU: по возможности тестируйте **через** маршрутизатор.
