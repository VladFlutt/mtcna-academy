// MTCSE simulators: port knocking, brute-force staging, crypto playground, VPN handshakes,
// SSH tunnel builder and the VPN firewall rule helper. Each one renders into a container element.

import { T } from '../i18n.js'

const $ = (root, sel) => root.querySelector(sel)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const code = (txt) => `<pre class="code sm"><code>${esc(txt)}</code><button class="copy">${T('Copy', 'Копировать')}</button></pre>`
const bindCopy = (el) => el.querySelectorAll('pre.code .copy').forEach((b) => b.onclick = () => navigator.clipboard && navigator.clipboard.writeText(b.parentElement.querySelector('code').textContent).then(() => { b.textContent = T('Copied', 'Скопировано'); setTimeout(() => b.textContent = T('Copy', 'Копировать'), 1200) }).catch(() => {}))

export const SE_SIMS = [
  { id: 'knock', icon: '🚪', title: T('Port knocking simulator', 'Симулятор port knocking'), desc: T('Knock on ports as an outside host and watch the address lists and timeouts decide whether Winbox opens.', 'Стучите в порты как внешний хост и смотрите, как address lists и таймауты решают, откроется ли Winbox.'), render: knockSim },
  { id: 'brute', icon: '🔨', title: T('Brute-force staging', 'Поэтапная защита от перебора'), desc: T('A bot and an admin log in over SSH; see how stage1, stage2, stage3 and the blacklist separate them.', 'Бот и администратор входят по SSH; посмотрите, как stage1, stage2, stage3 и blacklist отделяют одного от другого.'), render: bruteSim },
  { id: 'crypto', icon: '🔑', title: T('Crypto playground', 'Криптографическая песочница'), desc: T('Hash a text, encrypt with a shared key, then sign and encrypt with a toy RSA key pair, step by step.', 'Захешируйте текст, зашифруйте общим ключом, затем подпишите и зашифруйте игрушечной парой ключей RSA, шаг за шагом.'), render: cryptoSim },
  { id: 'handshake', icon: '🤝', title: T('VPN handshake stepper', 'Пошаговые рукопожатия VPN'), desc: T('Walk through SSTP, L2TP/IPsec, IKEv2 and an SSH tunnel message by message.', 'Пройдите SSTP, L2TP/IPsec, IKEv2 и SSH-туннель сообщение за сообщением.'), render: handshakeSim },
  { id: 'sshtunnel', icon: '🕳️', title: T('SSH tunnel builder', 'Конструктор SSH-туннеля'), desc: T('Fill in the ports and hosts and get the ssh -L / PuTTY command with an explanation of the path.', 'Укажите порты и хосты и получите команду ssh -L / PuTTY с объяснением пути пакетов.'), render: sshSim },
  { id: 'vpnports', icon: '🧱', title: T('VPN firewall helper', 'Файрвол для VPN'), desc: T('Pick the VPN types you run and get the input rules they need, in the right place.', 'Выберите типы VPN, которые вы запускаете, и получите нужные им правила input в правильном месте.'), render: vpnPortsSim },
]

// ---------- port knocking ----------
function knockSim(el) {
  let now = 0
  let lists = []
  const log = []
  el.innerHTML = `
  <div class="sim-grid">
    <div class="card">
      <h3>${T('Router rules', 'Правила маршрутизатора')}</h3>
      <div class="row wrap"><label>${T('Knock 1', 'Стук 1')} <input id="k1" value="11111" size="6"></label><label>${T('Knock 2', 'Стук 2')} <input id="k2" value="22222" size="6"></label><label>${T('Knock 3', 'Стук 3')} <input id="k3" value="33333" size="6"></label><label>${T('Step timeout, s', 'Таймаут шага, с')} <input id="kt" value="10" size="3"></label></div>
      <div id="k-rules"></div>
    </div>
    <div class="card">
      <h3>${T('You are 203.0.113.50 on the Internet', 'Вы 203.0.113.50 в Интернете')}</h3>
      <div class="row wrap"><input id="k-port" value="11111" size="6" aria-label="port"><button class="btn" id="k-send">${T('Send TCP SYN to this port', 'Отправить TCP SYN на этот порт')}</button><button class="btn ghost" id="k-winbox">${T('Open Winbox (8291)', 'Открыть Winbox (8291)')}</button></div>
      <div class="row wrap"><button class="btn ghost sm" id="k-wait5">${T('Wait 5 s', 'Подождать 5 с')}</button><button class="btn ghost sm" id="k-wait60">${T('Wait 1 min', 'Подождать 1 мин')}</button><button class="btn ghost sm" id="k-reset">${T('Reset', 'Сбросить')}</button><span class="muted sm">${T('Clock', 'Время')}: <b id="k-clock">0</b> s</span></div>
      <h4>/ip firewall address-list</h4><div id="k-lists"></div>
      <h4>${T('What happened', 'Что произошло')}</h4><ol id="k-log" class="sm"></ol>
    </div>
  </div>`
  const cfg = () => ({ p: [$(el, '#k1').value, $(el, '#k2').value, $(el, '#k3').value].map(Number), t: Math.max(1, Number($(el, '#kt').value) || 10) })
  const inList = (l) => lists.some((e) => e.list === l && e.until > now)
  const add = (l, sec) => { lists = lists.filter((e) => e.list !== l); lists.push({ list: l, until: now + sec }) }
  const drawRules = () => {
    const { p, t } = cfg()
    $(el, '#k-rules').innerHTML = code(`/ip firewall filter
add chain=input protocol=tcp action=jump jump-target=knock
add chain=knock protocol=tcp dst-port=${p[0]} action=add-src-to-address-list address-list=knock1 address-list-timeout=${t}s
add chain=knock protocol=tcp dst-port=${p[1]} src-address-list=knock1 action=add-src-to-address-list address-list=knock2 address-list-timeout=${t}s
add chain=knock protocol=tcp dst-port=${p[2]} src-address-list=knock2 action=add-src-to-address-list address-list=knock-final address-list-timeout=1d
add chain=input protocol=tcp dst-port=8291 src-address-list=!knock-final action=drop`)
    bindCopy(el)
  }
  const draw = () => {
    $(el, '#k-clock').textContent = now
    const live = lists.filter((e) => e.until > now)
    $(el, '#k-lists').innerHTML = live.length ? `<div class="table-wrap"><table><thead><tr><th>list</th><th>address</th><th>timeout</th></tr></thead><tbody>${live.map((e) => `<tr><td class="mono">${e.list}</td><td class="mono">203.0.113.50</td><td>${e.until - now > 3600 ? '23h59m' : (e.until - now) + 's'}</td></tr>`).join('')}</tbody></table></div>` : `<p class="muted sm">${T('empty', 'пусто')}</p>`
    $(el, '#k-log').innerHTML = log.slice(-8).map((x) => `<li class="${x.c || ''}">${x.s}</li>`).join('')
  }
  const send = (port) => {
    const { p, t } = cfg()
    if (port === 8291) {
      const ok = inList('knock-final')
      log.push({ s: ok ? T('8291: you are in knock-final, the drop rule does not match, Winbox opens ✓', '8291: вы в knock-final, правило drop не срабатывает, Winbox открывается ✓') : T('8291: you are not in knock-final, dropped ✗', '8291: вас нет в knock-final, пакет отброшен ✗'), c: ok ? 'good' : 'bad' })
    } else {
      let msg = T(`${port}: no knock rule matched`, `${port}: ни одно правило стука не совпало`)
      // rules run top to bottom inside one pass, exactly as in the chain above
      if (port === p[0]) { add('knock1', t); msg = T(`${port}: added to knock1 for ${t}s`, `${port}: добавлен в knock1 на ${t}s`) }
      if (port === p[1]) msg = inList('knock1') ? (add('knock2', t), T(`${port}: you were in knock1, added to knock2`, `${port}: вы были в knock1, добавлены в knock2`)) : T(`${port}: not in knock1 (missing or expired), nothing happens`, `${port}: нет в knock1 (не было или истёк), ничего не происходит`)
      if (port === p[2]) msg = inList('knock2') ? (add('knock-final', 86400), T(`${port}: you were in knock2, added to knock-final for 1 day`, `${port}: вы были в knock2, добавлены в knock-final на 1 день`)) : T(`${port}: not in knock2, nothing happens`, `${port}: нет в knock2, ничего не происходит`)
      log.push({ s: msg })
    }
    now += 1
    draw()
  }
  $(el, '#k-send').onclick = () => send(Number($(el, '#k-port').value))
  $(el, '#k-winbox').onclick = () => send(8291)
  $(el, '#k-wait5').onclick = () => { now += 5; draw() }
  $(el, '#k-wait60').onclick = () => { now += 60; draw() }
  $(el, '#k-reset').onclick = () => { now = 0; lists = []; log.length = 0; draw() }
  el.querySelectorAll('#k1,#k2,#k3,#kt').forEach((i) => i.oninput = drawRules)
  drawRules(); draw()
}

// ---------- brute force staging ----------
function bruteSim(el) {
  el.innerHTML = `
  <div class="card">
    <div class="row wrap">
      <label>${T('Bot tries every', 'Бот пробует каждые')} <input id="b-bot" type="range" min="1" max="40" value="5"> <b id="b-botv"></b> s</label>
      <label>${T('Stage timeout', 'Таймаут этапа')} <select id="b-to"><option value="60">1m</option><option value="30">30s</option><option value="300">5m</option></select></label>
      <label><input type="checkbox" id="b-rev"> ${T('Wrong rule order (stage1 rule first)', 'Неверный порядок (правило stage1 первым)')}</label>
    </div>
    <p class="muted sm">${T('The admin logs in at 0 s, mistypes, and logs in again at 40 s and 200 s. The bot starts at 3 s and tries 10 times.', 'Администратор входит в 0 с, ошибается и входит снова в 40 с и 200 с. Бот начинает в 3 с и пробует 10 раз.')}</p>
    <div class="table-wrap"><table><thead><tr><th>${T('Time', 'Время')}</th><th>${T('Who', 'Кто')}</th><th>${T('Lists after the packet', 'Списки после пакета')}</th><th>${T('Result', 'Итог')}</th></tr></thead><tbody id="b-out"></tbody></table></div>
  </div>`
  const draw = () => {
    const step = Number($(el, '#b-bot').value), to = Number($(el, '#b-to').value), rev = $(el, '#b-rev').checked
    $(el, '#b-botv').textContent = step
    const ev = [0, 40, 200].map((t) => ({ t, who: 'admin' })).concat([...Array(10).keys()].map((i) => ({ t: 3 + i * step, who: 'bot' }))).sort((a, b) => a.t - b.t)
    const L = { admin: {}, bot: {} }
    const has = (who, l, t) => (L[who][l] || -1) > t
    const order = rev ? ['stage1', 'stage2', 'stage3', 'blacklist'] : ['blacklist', 'stage3', 'stage2', 'stage1']
    const from = { blacklist: 'stage3', stage3: 'stage2', stage2: 'stage1', stage1: null }
    $(el, '#b-out').innerHTML = ev.map(({ t, who }) => {
      let res
      if (has(who, 'blacklist', t)) res = `<b class="bad">${T('dropped', 'отброшен')}</b>`
      else {
        for (const l of order) if (from[l] === null || has(who, from[l], t)) L[who][l] = t + (l === 'blacklist' ? 864000 : to)
        res = `<span class="good">${T('accepted', 'принят')}</span>`
      }
      const now = ['stage1', 'stage2', 'stage3', 'blacklist'].filter((l) => has(who, l, t)).join(', ')
      return `<tr><td>${t}s</td><td>${who === 'bot' ? '🤖 ' + T('bot', 'бот') : '👤 admin'}</td><td class="mono sm">${now || '-'}</td><td>${res}</td></tr>`
    }).join('')
  }
  el.querySelectorAll('input,select').forEach((i) => i.oninput = draw)
  draw()
}

// ---------- crypto playground ----------
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const modpow = (b, e, m) => { let r = 1n; b = BigInt(b) % BigInt(m); e = BigInt(e); m = BigInt(m); while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n } return Number(r) }
function cryptoSim(el) {
  el.innerHTML = `
  <div class="sim-grid">
    <div class="card">
      <h3>1. ${T('Hash (SHA-256)', 'Хеш (SHA-256)')}</h3>
      <p class="muted sm">${T('Change one letter and compare: the whole hash changes, its length never does, and there is no way back to the text.', 'Измените одну букву и сравните: меняется весь хеш, длина остаётся прежней, а обратно к тексту дороги нет.')}</p>
      <input id="c-h1" value="MikroTik"><div class="mono sm" id="c-o1"></div>
      <input id="c-h2" value="Mikrotik"><div class="mono sm" id="c-o2"></div>
      <p class="sm" id="c-diff"></p>
    </div>
    <div class="card">
      <h3>2. ${T('Symmetric encryption (AES-GCM)', 'Симметричное шифрование (AES-GCM)')}</h3>
      <p class="muted sm">${T('Both sides need the same key. That is fast, but how do you share the key safely? (Answer: Diffie-Hellman or the IPsec/L2TP pre-shared key.)', 'Обеим сторонам нужен один и тот же ключ. Это быстро, но как безопасно передать ключ? (Ответ: Диффи-Хеллман или общий ключ IPsec/L2TP.)')}</p>
      <label>${T('Message', 'Сообщение')} <input id="c-m" value="admin password is Str0ng!"></label>
      <label>${T('Shared key (password)', 'Общий ключ (пароль)')} <input id="c-k" value="L2tp-Shared-Key"></label>
      <div class="row"><button class="btn sm" id="c-enc">${T('Encrypt', 'Зашифровать')}</button></div>
      <div class="mono sm" id="c-ct"></div>
      <label>${T('Key used to decrypt', 'Ключ для расшифровки')} <input id="c-k2" value="L2tp-Shared-Key"></label>
      <div class="row"><button class="btn sm ghost" id="c-dec">${T('Decrypt', 'Расшифровать')}</button></div><p id="c-pt" class="sm"></p>
    </div>
    <div class="card">
      <h3>3. ${T('Asymmetric: toy RSA', 'Асимметричное: игрушечный RSA')}</h3>
      <p class="muted sm">${T('Real keys are 2048+ bits; here p=61, q=53 so you can follow the maths: n = 3233, public e = 17, private d = 2753.', 'Настоящие ключи 2048+ бит; здесь p=61, q=53, чтобы можно было проследить математику: n = 3233, открытый e = 17, закрытый d = 2753.')}</p>
      <label>${T('A number to send (0-3232)', 'Число для отправки (0-3232)')} <input id="c-r" type="number" min="0" max="3232" value="65"></label>
      <div id="c-rsa" class="sm"></div>
    </div>
  </div>`
  const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  const doHash = async () => {
    if (!crypto.subtle) { $(el, '#c-o1').textContent = T('Web Crypto is not available on this page (needs HTTPS).', 'Web Crypto недоступен на этой странице (нужен HTTPS).'); return }
    const [a, b] = await Promise.all([sha($(el, '#c-h1').value), sha($(el, '#c-h2').value)])
    $(el, '#c-o1').textContent = a; $(el, '#c-o2').textContent = b
    let diff = 0
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++
    $(el, '#c-diff').textContent = T(`${diff} of 64 hex digits differ.`, `Отличаются ${diff} из 64 шестнадцатеричных цифр.`)
  }
  let box = null
  const keyFrom = async (pw) => crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw)), 'AES-GCM', false, ['encrypt', 'decrypt'])
  $(el, '#c-enc').onclick = async () => {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom($(el, '#c-k').value), new TextEncoder().encode($(el, '#c-m').value))
    box = { iv, ct }
    $(el, '#c-ct').textContent = T('Ciphertext: ', 'Шифротекст: ') + hex(ct)
    $(el, '#c-pt').textContent = ''
  }
  $(el, '#c-dec').onclick = async () => {
    if (!box) { $(el, '#c-pt').textContent = T('Encrypt something first.', 'Сначала что-нибудь зашифруйте.'); return }
    try {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: box.iv }, await keyFrom($(el, '#c-k2').value), box.ct)
      $(el, '#c-pt').innerHTML = `<span class="good">✓ ${esc(new TextDecoder().decode(pt))}</span>`
    } catch { $(el, '#c-pt').innerHTML = `<span class="bad">✗ ${T('Wrong key: decryption fails. GCM also detects tampering (integrity).', 'Неверный ключ: расшифровка не удалась. GCM ещё и обнаруживает подмену (целостность).')}</span>` }
  }
  const rsa = () => {
    const m = Math.max(0, Math.min(3232, Math.floor(Number($(el, '#c-r').value) || 0)))
    const c = modpow(m, 17, 3233), back = modpow(c, 2753, 3233)
    const sig = modpow(m, 2753, 3233), ver = modpow(sig, 17, 3233)
    $(el, '#c-rsa').innerHTML = `<p><b>${T('Encrypt for Bob', 'Шифрование для Боба')}</b> (${T('with Bob\'s public key', 'открытым ключом Боба')}): c = ${m}<sup>17</sup> mod 3233 = <b>${c}</b></p>
      <p>${T('Bob decrypts with his private key', 'Боб расшифровывает своим закрытым ключом')}: ${c}<sup>2753</sup> mod 3233 = <b class="good">${back}</b></p>
      <p><b>${T('Sign as Bob', 'Подпись от Боба')}</b> (${T('with Bob\'s private key', 'закрытым ключом Боба')}): s = ${m}<sup>2753</sup> mod 3233 = <b>${sig}</b></p>
      <p>${T('Anyone verifies with the public key', 'Любой проверяет открытым ключом')}: ${sig}<sup>17</sup> mod 3233 = <b class="good">${ver}</b> ${ver === m ? '= ' + m + ' ✓' : ''}</p>
      <p class="muted">${T('In real signatures the number m is the hash of the message, and a certificate is the CA\'s signature over your public key and name.', 'В настоящих подписях число m это хеш сообщения, а сертификат это подпись CA над вашим открытым ключом и именем.')}</p>`
  }
  el.querySelectorAll('#c-h1,#c-h2').forEach((i) => i.oninput = doHash)
  $(el, '#c-r').oninput = rsa
  doHash(); rsa()
}

// ---------- handshakes ----------
const FLOWS = {
  sstp: { name: 'SSTP', steps: [
    ['→', 'TCP SYN / SYN-ACK / ACK :443', T('The client opens a normal TCP connection to port 443, like a browser.', 'Клиент открывает обычное TCP-соединение на порт 443, как браузер.')],
    ['⇄', 'SSL/TLS negotiation', T('The server sends its certificate. The client checks the issuer is trusted and the name matches. If not, the connection is torn down here.', 'Сервер присылает сертификат. Клиент проверяет, что издатель доверенный и имя совпадает. Если нет, соединение разрывается здесь.')],
    ['→', 'HTTPS: SSTP_DUPLEX_POST', T('Inside HTTPS the client asks to start SSTP; to a firewall it looks like web traffic.', 'Внутри HTTPS клиент просит начать SSTP; для файрвола это выглядит как веб-трафик.')],
    ['⇄', 'SSTP control + PPP (LCP, MS-CHAPv2)', T('PPP runs inside: the user name and password from /ppp secret are checked (service=sstp).', 'Внутри работает PPP: проверяются имя и пароль из /ppp secret (service=sstp).')],
    ['⇄', 'IP binding (IPCP)', T('PPP gives addresses to both ends: local-address and remote-address from the secret or profile.', 'PPP выдаёт адреса обоим концам: local-address и remote-address из secret или профиля.')],
    ['═', 'SSTP tunnel', T('Data flows inside TLS. On the router a dynamic interface <sstp-user> appears.', 'Данные идут внутри TLS. На маршрутизаторе появляется динамический интерфейс <sstp-user>.')],
  ] },
  l2tp: { name: 'L2TP/IPsec', steps: [
    ['⇄', 'IKEv1 main mode 1-2 (UDP 500)', T('Peers agree on the IKE proposal: encryption, hash, DH group.', 'Пиры согласуют предложение IKE: шифрование, хеш, группу DH.')],
    ['⇄', 'IKEv1 main mode 3-4', T('Diffie-Hellman exchange: both sides compute a shared secret. NAT is detected; if there is NAT they move to UDP 4500.', 'Обмен Диффи-Хеллмана: обе стороны вычисляют общий секрет. Определяется NAT; если он есть, переходят на UDP 4500.')],
    ['⇄', 'IKEv1 main mode 5-6', T('Authentication, encrypted: both prove they know the ipsec-secret (pre-shared key).', 'Аутентификация, уже зашифрованная: обе стороны доказывают знание ipsec-secret (общего ключа).')],
    ['⇄', 'Quick mode 1-3', T('The IPsec SAs for L2TP traffic (UDP 1701) are created.', 'Создаются IPsec SA для трафика L2TP (UDP 1701).')],
    ['⇄', 'L2TP control (UDP 1701 inside ESP)', T('Now L2TP sets up its tunnel and session, already encrypted by ESP.', 'Теперь L2TP поднимает туннель и сессию, уже зашифрованные ESP.')],
    ['⇄', 'PPP: LCP, MS-CHAPv2, IPCP', T('User authentication from /ppp secret (service=l2tp) and IP addresses.', 'Аутентификация пользователя из /ppp secret (service=l2tp) и IP-адреса.')],
    ['═', 'ESP(L2TP(PPP(IP)))', T('Three layers of encapsulation: the reason for MTU 1450 on the L2TP server.', 'Три уровня инкапсуляции: отсюда MTU 1450 на L2TP-сервере.')],
  ] },
  ikev2: { name: 'IKEv2', steps: [
    ['→', 'IKE_SA_INIT request (UDP 500)', T('Client proposes algorithms, sends its DH value and a nonce, plus NAT detection.', 'Клиент предлагает алгоритмы, отправляет своё значение DH и nonce, плюс обнаружение NAT.')],
    ['←', 'IKE_SA_INIT response', T('Server picks a proposal, sends its DH value. From now on everything is encrypted. With NAT they switch to UDP 4500.', 'Сервер выбирает предложение, отправляет своё значение DH. Дальше всё зашифровано. При NAT переходят на UDP 4500.')],
    ['→', 'IKE_AUTH request + CP(CFG_REQUEST)', T('Client proves its identity (certificate signature or EAP) and asks for configuration: address, DNS, split networks.', 'Клиент доказывает свою личность (подпись сертификатом или EAP) и запрашивает конфигурацию: адрес, DNS, сети split.')],
    ['←', 'IKE_AUTH response + CP(CFG_REPLY)', T('Server sends its certificate signature and the mode config: an address from the pool and split-include. The first child SA is created.', 'Сервер отправляет подпись своим сертификатом и mode config: адрес из пула и split-include. Создаётся первая child SA.')],
    ['═', 'ESP child SA', T('Only 4 messages. The policy was generated from the template (generate-policy=port-strict). MOBIKE keeps it alive if the client IP changes.', 'Всего 4 сообщения. Политика создана по шаблону (generate-policy=port-strict). MOBIKE сохраняет её при смене IP клиента.')],
  ] },
  ssh: { name: T('SSH local forward', 'Локальный проброс SSH'), steps: [
    ['→', 'ssh -L 2000:127.0.0.1:80 admin@router', T('Host connects to RouterOS using SSH with the local port forwarding parameter.', 'Хост подключается к RouterOS по SSH с параметром локального проброса порта.')],
    ['←', T('SSH session accepted', 'SSH-сессия принята'), T('RouterOS accepts the SSH connection (forwarding-enabled must allow local forwarding).', 'RouterOS принимает SSH-подключение (forwarding-enabled должен разрешать локальный проброс).')],
    ['→', 'http://127.0.0.1:2000', T('The browser opens the local port; the SSH client carries the unencrypted HTTP inside the encrypted session.', 'Браузер открывает локальный порт; SSH-клиент переносит незашифрованный HTTP внутри зашифрованной сессии.')],
    ['←', 'WebFig', T('RouterOS sends the HTTP request to its own 127.0.0.1:80 and returns WebFig through the tunnel.', 'RouterOS отправляет HTTP-запрос на свой 127.0.0.1:80 и возвращает WebFig через туннель.')],
  ] },
}
function handshakeSim(el) {
  let flow = 'sstp', i = 0
  el.innerHTML = `<div class="card">
    <div class="row wrap" id="h-tabs">${Object.entries(FLOWS).map(([k, f]) => `<button class="chip" data-f="${k}">${esc(f.name)}</button>`).join('')}</div>
    <div class="hs"><div class="hs-end">💻 ${T('Client', 'Клиент')}</div><div class="hs-mid" id="h-steps"></div><div class="hs-end">🖧 RouterOS</div></div>
    <p id="h-text" class="lead sm"></p>
    <div class="row"><button class="btn ghost" id="h-prev">← ${T('Back', 'Назад')}</button><button class="btn" id="h-next">${T('Next step', 'Следующий шаг')} →</button></div>
  </div>`
  const draw = () => {
    const f = FLOWS[flow]
    el.querySelectorAll('#h-tabs .chip').forEach((b) => b.classList.toggle('on', b.dataset.f === flow))
    $(el, '#h-steps').innerHTML = f.steps.map(([d, label], k) => `<div class="hs-step ${k < i ? 'done' : k === i ? 'cur' : ''}"><span class="hs-arrow">${d === '→' ? '────────▶' : d === '←' ? '◀────────' : d === '⇄' ? '◀──────▶' : '═════════'}</span><span class="mono sm">${esc(label)}</span></div>`).join('')
    $(el, '#h-text').textContent = `${i + 1}/${f.steps.length}. ${f.steps[i][2]}`
    $(el, '#h-prev').disabled = i === 0
    $(el, '#h-next').disabled = i === f.steps.length - 1
  }
  $(el, '#h-tabs').onclick = (e) => { if (e.target.dataset.f) { flow = e.target.dataset.f; i = 0; draw() } }
  $(el, '#h-prev').onclick = () => { i--; draw() }
  $(el, '#h-next').onclick = () => { i++; draw() }
  draw()
}

// ---------- SSH tunnel builder ----------
function sshSim(el) {
  el.innerHTML = `<div class="sim-grid"><div class="card">
    <label>${T('Local port on your PC', 'Локальный порт на вашем ПК')} <input id="s-lp" value="2000"></label>
    <label>${T('Target host, as seen from the SSH server', 'Целевой хост с точки зрения SSH-сервера')} <input id="s-th" value="127.0.0.1"></label>
    <label>${T('Target port', 'Целевой порт')} <input id="s-tp" value="80"></label>
    <label>${T('SSH server (router)', 'SSH-сервер (маршрутизатор)')} <input id="s-sh" value="22.1.1.33"></label>
    <label>${T('SSH port', 'Порт SSH')} <input id="s-sp" value="22000"></label>
    <label>${T('User', 'Пользователь')} <input id="s-u" value="secadmin"></label>
  </div><div class="card" id="s-out"></div></div>`
  const draw = () => {
    const v = (id) => $(el, id).value.trim()
    const [lp, th, tp, sh, sp, u] = ['#s-lp', '#s-th', '#s-tp', '#s-sh', '#s-sp', '#s-u'].map(v)
    const local = th === '127.0.0.1' || th === 'localhost'
    $(el, '#s-out').innerHTML = `<h3>${T('Commands', 'Команды')}</h3>
      <p class="sm">Linux / macOS</p>${code(`ssh -p ${sp} -L ${lp}:${th}:${tp} ${u}@${sh}`)}
      <p class="sm">Windows (PuTTY)</p>${code(`putty -P ${sp} -L ${lp}:${th}:${tp} ${u}@${sh}`)}
      <p class="sm">${T('On the router, once', 'На маршрутизаторе, один раз')}</p>${code('/ip ssh set forwarding-enabled=both')}
      <h3>${T('What happens', 'Что происходит')}</h3>
      <ol class="sm"><li>${T(`Your SSH client listens on 127.0.0.1:${lp} on your PC.`, `Ваш SSH-клиент слушает 127.0.0.1:${lp} на вашем ПК.`)}</li>
      <li>${T(`An application connects to 127.0.0.1:${lp}; the data goes encrypted inside the SSH session to ${sh}:${sp}.`, `Приложение подключается к 127.0.0.1:${lp}; данные идут зашифрованными внутри SSH-сессии на ${sh}:${sp}.`)}</li>
      <li>${local ? T(`The router opens ${th}:${tp} on itself: that is its own service (port ${tp}${tp === '80' ? ' = WebFig' : ''}).`, `Маршрутизатор открывает ${th}:${tp} на себе: это его собственный сервис (порт ${tp}${tp === '80' ? ' = WebFig' : ''}).`) : T(`The router opens a new connection to ${th}:${tp}. This last hop is NOT encrypted by SSH.`, `Маршрутизатор открывает новое соединение к ${th}:${tp}. Этот последний участок НЕ шифруется SSH.`)}</li>
      <li>${T(`The firewall only needs to allow TCP ${sp} to the router; port ${tp} can stay closed from outside.`, `Файрволу достаточно разрешить TCP ${sp} к маршрутизатору; порт ${tp} может оставаться закрытым снаружи.`)}</li></ol>
      <p class="sm">${T('Open', 'Откройте')} <span class="mono">http://127.0.0.1:${esc(lp)}</span></p>`
    bindCopy(el)
  }
  el.querySelectorAll('input').forEach((i) => i.oninput = draw)
  draw()
}

// ---------- VPN firewall helper ----------
const VPN_RULES = {
  pptp: { name: 'PPTP', rules: ['protocol=tcp dst-port=1723', 'protocol=gre'], note: T('PPTP is insecure (MS-CHAPv2/MPPE); avoid it.', 'PPTP небезопасен (MS-CHAPv2/MPPE); избегайте его.') },
  l2tp: { name: 'L2TP/IPsec', rules: ['protocol=udp dst-port=500,4500', 'protocol=ipsec-esp', 'protocol=udp dst-port=1701 ipsec-policy=in,ipsec'], note: T('1701 only inside IPsec, so unencrypted L2TP is refused.', '1701 только внутри IPsec, чтобы L2TP без шифрования отвергался.') },
  sstp: { name: 'SSTP', rules: ['protocol=tcp dst-port=443'], note: T('Keep www-ssl off port 443 or move SSTP.', 'Уберите www-ssl с порта 443 или перенесите SSTP.') },
  ikev2: { name: 'IKEv2', rules: ['protocol=udp dst-port=500,4500', 'protocol=ipsec-esp'], note: T('Also accept forward ipsec-policy=in,ipsec so clients reach the LAN.', 'Ещё разрешите forward ipsec-policy=in,ipsec, чтобы клиенты попадали в LAN.') },
  wg: { name: 'WireGuard', rules: ['protocol=udp dst-port=13231'], note: T('Use the listen-port of your WireGuard interface.', 'Используйте listen-port своего интерфейса WireGuard.') },
  ovpn: { name: 'OpenVPN', rules: ['protocol=tcp dst-port=1194'], note: T('RouterOS 7 also supports OpenVPN over UDP.', 'RouterOS 7 также поддерживает OpenVPN поверх UDP.') },
}
function vpnPortsSim(el) {
  el.innerHTML = `<div class="card"><div class="row wrap" id="v-pick">${Object.entries(VPN_RULES).map(([k, v]) => `<label class="chip"><input type="checkbox" value="${k}" ${k === 'l2tp' ? 'checked' : ''}> ${v.name}</label>`).join('')}</div>
    <label>${T('Number of the "drop all not coming from LAN" rule in /ip firewall filter print', 'Номер правила «drop all not coming from LAN» в /ip firewall filter print')} <input id="v-n" type="number" min="0" value="3" style="width:5em"></label>
    <div id="v-out"></div></div>`
  const draw = () => {
    const sel = [...el.querySelectorAll('#v-pick input:checked')].map((i) => i.value)
    const n = $(el, '#v-n').value || 0
    const seen = new Set(), lines = []
    for (const k of sel) for (const r of VPN_RULES[k].rules) if (!seen.has(r)) { seen.add(r); lines.push(`add chain=input in-interface-list=WAN ${r} action=accept comment="${VPN_RULES[k].name}" place-before=${n}`) }
    if (sel.includes('ikev2')) lines.push('add chain=forward ipsec-policy=in,ipsec action=accept comment="IPsec clients to LAN" place-before=<forward drop rule>')
    $(el, '#v-out').innerHTML = sel.length ? code('/ip firewall filter\n' + lines.join('\n')) + `<ul class="sm">${sel.map((k) => `<li><b>${VPN_RULES[k].name}</b>: ${VPN_RULES[k].note}</li>`).join('')}</ul><p class="muted sm">${T('place-before keeps each accept above the final drop; the first match wins.', 'place-before ставит каждое accept выше финального drop; срабатывает первое совпадение.')}</p>` : `<p class="muted">${T('Pick at least one VPN type.', 'Выберите хотя бы один тип VPN.')}</p>`
    bindCopy(el)
  }
  el.addEventListener('input', draw)
  draw()
}
