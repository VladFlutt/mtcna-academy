# Lesson: Road warrior и выбор VPN

> Этот модуль идёт по слайдам курса MTCSE, глава 7 «Secure Tunnels», с дополнительными пояснениями из документации MikroTik.

**Road warrior** («воин дорог») это пользователь, который подключается к офису откуда угодно: из гостиницы, через мобильную сеть, из дома. Адрес клиента **заранее неизвестен** и часто находится за NAT. VPN-сервером служит ваш маршрутизатор с публичным адресом.

| Протокол | Транспорт | Шифрование | Встроен в | Заметки |
|---|---|---|---|---|
| PPTP | TCP 1723 + GRE | Взломано (MPPE) | Старые Windows | Не использовать |
| **L2TP/IPsec** | UDP 1701 внутри IPsec (UDP 500/4500, ESP) | IPsec | Windows, macOS, iOS, Android | Классика, поддерживается везде |
| **SSTP** | TCP 443 (HTTPS) | TLS | Windows | Проходит почти любой файрвол |
| **IKEv2** | UDP 500/4500, ESP | IPsec | Windows, macOS, iOS, Android | Современный, быстрый, MOBIKE |
| OpenVPN | TCP/UDP 1194 | TLS | Нужно приложение | Гибкий |
| WireGuard | UDP | Современная криптография | Приложение или встроен (v7) | Простой, очень быстрый |

Лабы этого модуля используют примеры со слайдов: клиент получает 10.1.1.2 или 10.1.1.3, адрес маршрутизатора в туннеле 10.1.1.1. На слайдах публичный адрес 2.2.2.2; в нашей лабораторной топологии WAN-адрес маршрутизатора **22.1.1.33**.

# Lesson: L2TP и L2TP/IPsec

### L2TP по слайдам

- **L2TP** = Layer 2 Tunneling Protocol, стандартизирован в **1999** году.
- Это **развитие L2F (Cisco) и PPTP (Microsoft)**.
- Работает поверх **UDP порт 1701**.
- L2TP сам **не обеспечивает шифрования**, поэтому его **используют вместе с IPsec**.

Внутри L2TP передаётся **PPP**, поэтому вы получаете всё знакомое по MTCNA: PPP secrets, профили, пулы, аутентификацию (pap, chap, mschap1, mschap2).

### Настройка сервера по слайдам

    /interface l2tp-server server
    set enabled=yes max-mtu=1450 max-mru=1450 default-profile=default-encryption \
        authentication=mschap1,mschap2 use-ipsec=yes ipsec-secret=SuperSecret123
    /ppp secret
    add name=test password=test service=l2tp local-address=10.1.1.1 remote-address=10.1.1.2

Что делает каждая настройка:

- **max-mtu=1450**: заголовки IPsec и L2TP увеличивают пакеты; меньший MTU предотвращает фрагментацию.
- **default-profile=default-encryption**: встроенный профиль, требующий шифрования.
- **authentication=mschap1,mschap2**: только MS-CHAP; лучше использовать только **mschap2**.
- **use-ipsec=yes**: RouterOS создаёт динамический IPsec peer и identity с **ipsec-secret** в качестве общего ключа. При **yes** клиенты **без** IPsec всё ещё могут подключиться обычным L2TP. При **required** L2TP без IPsec отклоняется. Для безопасности используйте **required**.
- Secret **test** получает фиксированные адреса 10.1.1.1 (маршрутизатор) и 10.1.1.2 (клиент).

### Файрвол для L2TP/IPsec

Клиент обычно за NAT, поэтому IPsec использует **NAT-T** (UDP 4500).

    /ip firewall filter
    add chain=input protocol=udp dst-port=500,4500 action=accept comment="IKE, NAT-T"
    add chain=input protocol=ipsec-esp action=accept comment="ESP without NAT"
    add chain=input protocol=udp dst-port=1701 ipsec-policy=in,ipsec action=accept comment="L2TP only inside IPsec"

Важнее всего последнее правило: **ipsec-policy=in,ipsec** совпадает только с пакетами, пришедшими **расшифрованными из IPsec**. Обычный L2TP из Интернета не принимается. Поставьте эти правила **перед** финальным drop.

### Клиент Windows, пошагово

1. Параметры → Сеть → VPN → Добавить VPN-подключение.
2. Тип VPN: **L2TP/IPsec с предварительным ключом**, введите ключ (ipsec-secret).
3. Сервер: публичный адрес маршрутизатора, имя и пароль: test / test.
4. Если маршрутизатор за NAT, Windows нужен параметр реестра `AssumeUDPEncapsulationContextOnSendRule=2` (Microsoft KB 926179).
5. Подключитесь. На маршрутизаторе `/ppp active print` показывает сессию, `/ip ipsec active-peers print` показывает IPsec peer.

> **Лаба со слайда:** *Настройте сервер L2TP+IPsec для своего ноутбука и подключите клиента.* Выполните в лабе **«Сервер L2TP/IPsec для ноутбука»**.

# Lesson: SSTP

### SSTP по слайдам

- **SSTP** (Secure Socket Tunneling Protocol) разработан **Microsoft**.
- Передаёт PPP поверх **SSL/TLS**, внутри **HTTPS на TCP 443**.
- Встроен в Windows начиная с **Windows Server 2008** и **Windows Vista SP1**.
- Поскольку он выглядит как обычный HTTPS, он проходит через файрволы и прокси, которые блокируют всё остальное.

### Этапы подключения

1. **TCP-соединение** на порт 443.
2. **SSL negotiation** (согласование SSL): клиент проверяет сертификат сервера.
3. **SSTP over HTTPS**: управляющие сообщения SSTP.
4. **IP binding**: аутентификация PPP и назначение адресов.
5. **SSTP tunnel**: передаются данные.

Два устройства RouterOS **могут построить SSTP даже без сертификатов**; это **не соответствует стандарту Microsoft**, а клиентам Windows всегда нужен сертификат, которому они доверяют.

### Сертификаты для SSTP (слайды)

На слайдах используется сертификат публичного CA, которому доверяет любой клиент Windows. Вы получаете три файла и импортируете их:

    /certificate import file-name=ca_bundle.crt passphrase=""
    /certificate import file-name=certificate.crt passphrase=""
    /certificate import file-name=private.key passphrase=""
    /certificate print

Серверный сертификат (`certificate.crt_0`) должен иметь флаг **K** (закрытый ключ импортирован).

### Сервер SSTP по слайдам

    /interface sstp-server server
    set enabled=yes port=443 certificate=certificate.crt_0 default-profile=default-encryption \
        authentication=mschap2 tls-version=only-1.2 force-aes=yes pfs=yes
    /ppp secret
    add name=test2 password=test2 service=sstp local-address=10.1.1.1 remote-address=10.1.1.3
    /ip firewall filter
    add chain=input protocol=tcp dst-port=443 action=accept comment="SSTP" place-before=0

- **force-aes=yes**: только шифры AES.
- **pfs=yes**: Perfect Forward Secrecy (новые ключи на каждый сеанс).
- **tls-version**: на слайде *any*; *only-1.2* строже.
- Порт **443** теперь занят SSTP, поэтому **www-ssl** нужно отключить или перенести (например, на 44300, как в модуле 5).

На стороне клиента в статусе подключения виден шифр, например **AES256-CBC**.

### Диагностика SSTP

| Симптом | Вероятная причина |
|---|---|
| Ошибка на **SSL negotiation** | Клиент не доверяет издателю или подключается по имени/IP, которого нет в сертификате |
| Ошибка проверки отзыва | Windows не может получить CRL этого CA (свой CA) |
| Подключается, но трафика нет | Нет маршрута или правила forward для 10.1.1.0/24 |

> Практика в лабе **«SSTP-сервер с публичным сертификатом»**.

# Lesson: Строительные блоки IPsec

IKEv2 настраивается в меню **IPsec** RouterOS, поэтому сначала разберём детали.

| Термин | Значение |
|---|---|
| **IKE** | Internet Key Exchange: протокол, который проверяет подлинность сторон и создаёт ключи (UDP 500) |
| **SA** (Security Association) | Одно направление согласованного шифрования со своими ключами |
| **ESP** | Encapsulating Security Payload (IP-протокол 50): **шифрует и проверяет подлинность** данных |
| **AH** | Authentication Header (IP-протокол 51): **только проверяет подлинность**, без шифрования, **не** работает через NAT |
| **NAT-T** | NAT traversal: ESP заворачивается в **UDP 4500**, чтобы IPsec работал через NAT |
| **DPD** | Dead Peer Detection: замечает, что другой стороны больше нет |

### Меню IPsec в RouterOS

| Меню | Что в нём |
|---|---|
| /ip ipsec **profile** | Параметры фазы 1 (IKE): хеш, шифрование, группа DH, NAT-T, DPD |
| /ip ipsec **peer** | Где находится другая сторона (адрес, exchange-mode ike2, passive) |
| /ip ipsec **identity** | Как сторона аутентифицируется (PSK, сертификат, EAP) и какие политики может создавать |
| /ip ipsec **proposal** | Параметры фазы 2 (ESP): алгоритмы auth и enc, группа PFS |
| /ip ipsec **policy** | **Какой трафик** шифруется (подсети src/dst) |
| /ip ipsec **mode-config** | Адрес, DNS и маршруты, которые выдаются road warrior |

### Политики и шаблоны

Обычная **политика** указывает фиксированные подсети и peer. У road warrior **адреса неизвестны**, поэтому сервер использует **шаблон политики** (`template=yes`) в **группе политик**. Когда клиент подключается, identity с **generate-policy=port-strict** создаёт настоящую политику по шаблону.

**level=unique** даёт каждому клиенту свои SA. Тогда несколько клиентов IKEv2 **за одним публичным IP** работают одновременно.

# Lesson: IKEv2 road warrior с сертификатами

### Возможности IKEv2 по слайдам

- Начальный обмен занимает **4 сообщения** (IKEv1 нужно было 6 или 9).
- Аутентификация через **PSK** или **подписи RSA**, а также **асимметричная аутентификация**: каждая сторона может использовать свой метод.
- **NAT traversal** встроен.
- **DPD** (обнаружение мёртвого peer) встроен.
- **EAP** и **configuration payload** для road warrior (имя и пароль, адреса от сервера).
- **MOBIKE**: сеанс переживает смену адреса клиента (Wi-Fi → LTE) без нового подключения.
- Лучшая **устойчивость к DoS**-атакам (cookies).
- С **level=unique** работают несколько клиентов за одним IP.

### Вариант 1 со слайдов, пошагово

**Шаг 1. Сертификаты** (самоподписанный CA, сервер и клиент, как в модуле 4). На слайдах CN 2.2.2.2 и замечание, что **DNS-имя лучше**. Серверный сертификат должен содержать адрес или имя, которое используют клиенты, в **subject-alt-name**; Windows это проверяет.

    /certificate
    add name=ca common-name=ca key-usage=key-cert-sign,crl-sign
    sign ca
    add name=serverIKEv2 common-name=22.1.1.33 subject-alt-name=IP:22.1.1.33 key-usage=tls-server
    sign serverIKEv2 ca=ca
    add name=client1 common-name=client1 key-usage=tls-client
    sign client1 ca=ca

**Шаг 2. Пул адресов и mode config.**

    /ip pool add name=pool1 ranges=10.1.1.2-10.1.1.50
    /ip ipsec mode-config
    add name=cfgIKEv2 responder=yes address-pool=pool1 address-prefix-length=32 \
        split-include=192.168.33.0/24 system-dns=no static-dns=192.168.33.1

- **responder=yes**: эта конфигурация работает как **сервер** и выдаёт параметры.
- **split-include**: подсети, которые клиент должен отправлять **через туннель**; всё остальное идёт напрямую в Интернет. Передаётся с расширением **Cisco Unity**.

**Шаг 3. Группа политик и шаблон.**

    /ip ipsec policy group add name=rw
    /ip ipsec policy add group=rw template=yes src-address=0.0.0.0/0 dst-address=10.1.1.0/24

(На слайде здесь 12.1.1.0/24, это опечатка: шаблон должен покрывать адреса пула.)

**Шаг 4. Peer.**

    /ip ipsec peer add name=peerIKEv2 exchange-mode=ike2 passive=yes send-initial-contact=yes

- Без адреса (или `::/0`): принимать клиентов откуда угодно.
- **passive=yes**: маршрутизатор только **отвечает** и никогда не инициирует подключение к этому peer.

**Шаг 5. Identity.**

    /ip ipsec identity add peer=peerIKEv2 auth-method=digital-signature certificate=serverIKEv2 \
        generate-policy=port-strict mode-config=cfgIKEv2 policy-template-group=rw

**Шаг 6. Файрвол.**

    /ip firewall filter
    add chain=input protocol=udp dst-port=500,4500 action=accept place-before=0
    add chain=forward ipsec-policy=in,ipsec action=accept place-before=0

**Шаг 7. Клиент.** Экспортируйте CA (PEM) и client1 (PKCS#12 с паролем), импортируйте их на ноутбук или телефон, создайте IKEv2 VPN с адресом сервера 22.1.1.33 и аутентификацией по сертификату.

**Шаг 8. Проверка.**

    /ip ipsec active-peers print
    /ip ipsec installed-sa print
    /ip ipsec policy print

### Диагностика IKEv2

| Симптом | Что проверить |
|---|---|
| Нет ответа вообще | Разрешены ли UDP 500/4500 в input? |
| «IKE authentication credentials are unacceptable» (Windows) | SAN не содержит имя/IP сервера, или CA нет в доверенных корневых сертификатах компьютера |
| Подключено, но нет трафика в LAN | Правило forward для ipsec-policy=in,ipsec; split-include покрывает LAN; шаблон политики покрывает пул |
| Второй пользователь за тем же NAT ломает первого | Используйте level=unique в шаблоне |

> Посмотрите симуляторы **Пошаговые рукопожатия VPN** и **Файрвол для VPN**, затем постройте всё в лабе **«IKEv2 road warrior с сертификатами»**.
