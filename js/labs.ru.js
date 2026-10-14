// Russian translation of lab titles, intros and task texts (same order as labs.js).

export const LABS_RU = {
  basic: {
    title: 'Identity, note и пользователи',
    intro: 'Лабы курса 5.2 и 5.10. Задайте имя маршрутизатору, добавьте баннер входа, создайте свою учётную запись администратора и избавьтесь от admin по умолчанию.',
    tasks: [
      'Задайте identity, отличное от MikroTik (например 33_5_YourName)',
      'Добавьте system note (баннер входа)',
      'Создайте пользователя man с группой full и паролем Man33ioP',
      'Отключите или удалите пользователя admin',
    ],
  },
  harden: {
    title: 'Защита IP-сервисов',
    intro: 'Отключите ненужные сервисы управления, а остальные ограничьте доступом из LAN.',
    tasks: [
      'Отключите telnet и ftp',
      'Отключите www (HTTP), api и api-ssl',
      'Разрешите Winbox только из 192.168.88.0/24',
      'Перенесите SSH на порт 2222',
      'Сохраните бинарный backup с именем before-change',
    ],
  },
  bridge: {
    title: 'Создание bridgeLAN (лаба 5.1)',
    intro: 'Маршрутизатор начинает БЕЗ конфигурации (сброс с no-defaults). ether1 будет WAN, ether2-ether5 объединяются в один бридж bridgeLAN. Ноутбук подключён к ether2.',
    tasks: [
      'Создайте бридж с именем bridgeLAN',
      'Добавьте ether2, ether3, ether4 и ether5 портами bridgeLAN',
      'Оставьте ether1 вне бриджа (это WAN)',
      'Добавьте 192.168.33.1/24 на bridgeLAN (не на порт)',
      'Проверка: bridgeLAN в состоянии running, ноутбук (192.168.33.2) отвечает на ping',
    ],
  },
  routing: {
    title: 'Статический WAN, маршрут по умолчанию и NAT (лабы 5.4-5.9)',
    intro: 'bridgeLAN с 192.168.33.1/24 готов. Провайдер выдал 22.1.1.33/24, шлюз и DNS 22.1.1.1. Выведите в Интернет маршрутизатор и ноутбук (статический 192.168.33.2, шлюз .1, DNS .1).',
    tasks: [
      'Добавьте 22.1.1.33/24 на ether1',
      'Добавьте маршрут по умолчанию через 22.1.1.1',
      'Задайте DNS-сервер 22.1.1.1 и разрешите удалённые запросы',
      'Маршрутизатор разрешает имя и пингует mtcna.lab',
      'Добавьте src-nat masquerade на выход ether1, чтобы у ноутбука был Интернет',
    ],
  },
  gateway: {
    title: 'DHCP-клиент и DHCP-сервер (лабы 5.11-5.12)',
    intro: 'bridgeLAN 192.168.33.1/24 готов. Получите адрес WAN от провайдера по DHCP, затем раздавайте адреса в LAN. Ноутбук настроен получать IP автоматически.',
    tasks: [
      'Добавьте DHCP-клиент на ether1 (статус bound)',
      'Создайте IP pool lan-pool 192.168.33.10-192.168.33.254',
      'Добавьте DHCP-сервер на bridgeLAN с lan-pool (включён)',
      'Добавьте DHCP network 192.168.33.0/24 со шлюзом и DNS 192.168.33.1',
      'Ноутбук получает аренду (проверьте /ip dhcp-server lease print)',
      'Разрешите DNS-запросы и masquerade: ноутбук выходит в Интернет',
      'Бонус: выдайте ноутбуку (E4:5F:01:AA:BB:02) статическую аренду 192.168.33.50',
    ],
  },
  firewall: {
    title: 'Защита маршрутизатора и LAN',
    intro: 'Маршрутизатор в сети (WAN ether1 22.1.1.33, LAN bridgeLAN). Правил фильтра пока нет, поэтому разрешено всё. Постройте stateful-файрвол. Порядок важен!',
    tasks: [
      'Первое правило input: accept established,related',
      'Drop invalid в input',
      'Ping (ICMP) на маршрутизатор из WAN по-прежнему разрешён',
      'Winbox (TCP 8291) из WAN отбрасывается',
      'Winbox и DNS из LAN продолжают работать',
      'Новые соединения из WAN в LAN отбрасываются (forward)',
      'У ноутбука по-прежнему есть Интернет',
    ],
  },
  nat: {
    title: 'Проброс портов и redirect (лаба DST-NAT)',
    intro: 'В LAN находятся веб-сервер 192.168.33.10 и почтовый сервер 192.168.33.100. Опубликуйте их на публичном адресе 22.1.1.33 и перенаправьте все DNS-запросы LAN на маршрутизатор.',
    tasks: [
      'Пробросьте TCP 80, приходящий на ether1, на 192.168.33.10',
      'Пробросьте TCP 25,110,143 на почтовый сервер 192.168.33.100',
      'Перенаправьте UDP 53 из LAN на маршрутизатор',
      'Masquerade остаётся на месте: у ноутбука есть Интернет',
    ],
  },
  queue: {
    title: 'Simple queues и PCQ (лабы 9.1-9.2)',
    intro: 'Ограничьте полосу для вашей LAN. Помните: max-limit=upload/download, а simple queues проверяются сверху вниз.',
    tasks: [
      'Ограничьте ноутбук 192.168.33.2 до 1M/1M (имя очереди laptop)',
      'Разрешите ноутбуку 3M/3M к серверу 5.8.63.23 (dst), ВЫШЕ очереди 1M',
      'Создайте типы PCQ pcq-down (dst-address) и pcq-up (src-address), pcq-rate=0',
      'Очередь lan: target 192.168.33.0/24, max-limit 10M/10M, queue=pcq-up/pcq-down (последней)',
      'Бонус: дайте очереди laptop burst: burst-limit 5M/5M, threshold 1M/1M, time 10s/10s',
    ],
  },
  pppoe: {
    title: 'PPPoE-клиент (лабы 6.1-6.2)',
    intro: 'Сейчас WAN использует DHCP-клиент. Провайдер переводит вас на PPPoE с логином/паролем class/class. Ноутбук (статический 192.168.33.2) должен сохранить Интернет.',
    tasks: [
      'Отключите DHCP-клиент на ether1',
      'Добавьте PPPoE-клиент на ether1 (пользователь class, пароль class)',
      'PPPoE в состоянии running (R) с маршрутом по умолчанию и DNS провайдера',
      'Исправьте NAT: masquerade на выход интерфейса PPPoE; у ноутбука есть Интернет',
    ],
  },
  pppoesrv: {
    title: 'PPPoE-сервер с ограничением скорости',
    intro: 'Запустите PPPoE-сервер для абонентов на ether3. Каждый пользователь получает адрес из пула и ограничение 5M/5M.',
    tasks: [
      'IP pool pppoe-pool 1.1.1.2-1.1.1.200',
      'PPP profile 5mbit: local 1.1.1.1, remote pppoe-pool, rate-limit 5M/5M, only-one',
      'PPP secret user1 / pass1, service pppoe, profile 5mbit',
      'PPPoE-сервер на ether3, default-profile 5mbit, one-session-per-host, включён',
    ],
  },
  pptp: {
    title: 'PPTP site-to-site, сторона Office 1 (лаба 6.6)',
    intro: 'Office 1 (этот маршрутизатор) является PPTP-сервером. Office 2 (LAN 192.168.11.0/24) подключится как пользователь office2. Адреса туннеля: 172.16.1.1 (здесь) и 172.16.1.2 (Office 2).',
    tasks: [
      'Включите PPTP-сервер с mschap2 и профилем default-encryption',
      'Secret office2: service pptp, local 172.16.1.1, remote 172.16.1.2',
      'Статический маршрут на 192.168.11.0/24 через 172.16.1.2',
      'Разрешите PPTP в цепочке input (TCP 1723 и GRE)',
    ],
  },
  wifi: {
    title: 'Защищённая точка доступа с изоляцией',
    intro: 'Превратите wlan1 в точку доступа WPA2 для вашей группы, добавьте её в бридж LAN и изолируйте беспроводных клиентов друг от друга.',
    tasks: [
      'Security profile group33: dynamic-keys, wpa2-psk, aes-ccm, ключ от 12 символов',
      'wlan1: mode ap-bridge, SSID AP_33_1, band 2ghz-b/g/n, profile group33',
      'Используйте неперекрывающийся канал: 2412, 2437 или 2462 МГц',
      'Изолируйте клиентов (default-forward=no)',
      'Добавьте wlan1 в bridgeLAN и включите его (флаг R)',
    ],
  },
  tools: {
    title: 'Время, MAC server и мониторинг',
    intro: 'Финальная настройка: правильное время, доступ по MAC только из LAN и оповещение, когда провайдер недоступен.',
    tasks: [
      'Задайте часовой пояс Europe/Riga',
      'Включите NTP-клиент с сервером pool.ntp.org',
      'Создайте interface list LAN, содержащий bridgeLAN',
      'Ограничьте MAC server и MAC-Winbox списком LAN',
      'Netwatch шлюза провайдера 22.1.1.1 (статус up)',
      'Создайте файл supout.rif',
    ],
  },
}
