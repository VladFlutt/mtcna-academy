# Lesson: Инструменты диагностики

| Инструмент | Меню / команда | Что делает |
|---|---|---|
| **Ping** | `/ping 8.8.8.8` | ICMP echo; также `arp-ping` (ping через ARP, с интерфейсом) и **MAC ping** |
| **Traceroute** | `/tool traceroute 8.8.8.8` | Показывает каждый узел на пути к назначению |
| **Torch** | `/tool torch ether1` | Трафик в реальном времени по адресу, порту, протоколу |
| **Packet Sniffer** | `/tool sniffer` | Захват пакетов в файл .pcap или поток в Wireshark (TZSP) |
| **Profile** | `/tool profile` | Загрузка CPU по процессам |
| **Bandwidth Test** | `/tool bandwidth-test` | Пропускная способность между устройствами MikroTik |
| **IP Scan** | `/tool ip-scan` | Поиск хостов в сети |
| **MAC Server / MAC Telnet** | `/tool mac-server` | Доступ к другим устройствам MikroTik по MAC |

# Lesson: Мониторинг и оповещения

- **Netwatch** (`/tool netwatch`): пингует хост с заданным интервалом и запускает **up-script** или **down-script** при смене состояния. Пример: отправить e-mail, когда шлюз провайдера недоступен.
- **E-mail** (`/tool e-mail`): настройте SMTP-сервер, чтобы скрипты могли отправлять почту (в том числе файлы backup).
- **SNMP** (`/snmp`): позволяет системам мониторинга (Zabbix, PRTG, The Dude) читать счётчики. Задайте community, ограничьте адреса, по возможности используйте SNMPv3.
- **Graphing**: встроенные долговременные графики по адресу http://router/graphs/.
- **The Dude**: бесплатный инструмент MikroTik для мониторинга сети и карт (сервер работает на устройствах RouterOS v7 с накопителем; клиент для Windows).
- **Logging** (`/system logging`): отправка тем (firewall, wireless, error...) в память, на диск или на **удалённый syslog**-сервер.

# Lesson: Обнаружение соседей и NTP

- **IP > Neighbors** показывает устройства MikroTik и другие, найденные через **MNDP / CDP / LLDP** на интерфейсах из *discover-interface-list*. Отключите обнаружение на интерфейсах WAN.
- **NTP-клиент** (`/system ntp client set enabled=yes servers=pool.ntp.org`): правильное время необходимо для логов, сертификатов и планировщика. Устройства без часов с батарейкой теряют время при перезагрузке.
- **System > Clock** задаёт часовой пояс.

### Часы и NTP (из курса)

- У RouterBOARD, CCR и CRS **нет батарейки** для часов (для надёжности в экстремальных условиях), поэтому время теряется при выключении.
- Задайте **Time Zone** в System > Clock (или используйте автоопределение).
- Для правильной даты и времени используйте **NTP/SNTP** или **IP > Cloud** (*Update Time*: как только маршрутизатор выходит в Интернет, облако устанавливает время; это включено даже в пустой конфигурации).
- **NTP** (RFC 5905) использует **UDP 123**, модель клиент/сервер; RouterOS может быть и клиентом, и сервером.
- **SNTP** (RFC 4330) это упрощённый NTP для устройств, которым не нужна высокая точность; SNTP-клиент может обращаться к любому NTP-серверу. В v6 меню **System > SNTP Client**, в v7 **System > NTP Client**.

    /system clock set time-zone-name=Europe/Riga
    /system ntp client set enabled=yes servers=pool.ntp.org

**Лаба 5.13**: настройте NTP (SNTP) клиент, задайте правильный часовой пояс, проверьте, что время синхронизировано.

### MAC server

Из того же сегмента уровня 2 MAC-Winbox и MAC-Telnet **обходят IP-файрвол**. Ограничьте их интерфейсами LAN:

    /tool mac-server set allowed-interface-list=LAN
    /tool mac-server mac-winbox set allowed-interface-list=LAN

# Lesson: Файлы поддержки и скрипты

- **supout.rif** (`/system sup-output`): файл поддержки с полной диагностической информацией. Отправьте его на **support@mikrotik.com**; посмотреть его можно и самому в аккаунте mikrotik.com (Supout viewer).
**Scheduler** (`/system scheduler`) запускает скрипты по расписанию, например еженедельный backup:

    /system script add name=backup source="/system backup save name=weekly"
    /system scheduler add name=weekly-backup interval=7d on-event=backup

- **Cloud** (`/ip cloud set ddns-enabled=yes`): бесплатное динамическое DNS-имя *serial.sn.mynetname.net* и облачный backup.

### Чек-лист перед обращением в поддержку

1. Обновите RouterOS и RouterBOOT до последней стабильной версии.
2. Посмотрите **log**.
3. Воспроизведите проблему и создайте **supout.rif**, пока она происходит.
4. Опишите сеть, версию и точные шаги.
