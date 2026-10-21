import { MODULES, EXAM } from './data.js'
import { renderMarkdown, splitLessons } from './md.js'
import { SIMS } from './sims.js'
import { LABS, makeLabState, labProgress } from './labs.js'
import { RouterOS, defaultConfig, laptopState, laptopInternet, routerInternet } from './routeros.js'
import { LANG, T } from './i18n.js'
import { MODULES_RU } from './data.ru.js'
import { LABS_RU } from './labs.ru.js'
import { explainError, auditConfig, auditScore, askTutor, makeTroubleshoot, troubleshootSolved, studyPlan, readiness } from './ai.js'

// ---------- translation overlay ----------
if (LANG === 'ru') {
  for (const m of MODULES) {
    const r = MODULES_RU[m.id]
    if (!r) continue
    m.title = r.title; m.summary = r.summary
    m.quiz = m.quiz.map((q, i) => r.quiz[i] ? { ...q, q: r.quiz[i][0], o: r.quiz[i][1], e: r.quiz[i][2] } : q)
  }
  for (const l of LABS) {
    const r = LABS_RU[l.id]
    if (!r) continue
    l.title = r.title; l.intro = r.intro
    l.tasks = l.tasks.map((t, i) => r.tasks[i] ? { ...t, t: r.tasks[i] } : t)
  }
}

const REASONS_RU = [
  ['cable/port down', 'кабель/порт не подключён'], ['no DHCP server on ', 'нет DHCP-сервера на '], ['DHCP server interface has no IP address', 'у интерфейса DHCP-сервера нет IP-адреса'],
  ['DHCP server has no address pool', 'у DHCP-сервера нет пула адресов'], ['bad pool range', 'неверный диапазон пула'], ['no DHCP network for ', 'нет DHCP network для '],
  ['laptop has no IP address', 'у ноутбука нет IP-адреса'], ['laptop is not in the same subnet as the router', 'ноутбук не в одной подсети с маршрутизатором'],
  ['redirected but blocked by filter input', 'перенаправлено, но заблокировано filter input'], ['replies blocked by filter forward', 'ответы заблокированы filter forward'],
  ['blocked by filter input', 'заблокировано filter input'], ['blocked by filter forward', 'заблокировано filter forward'],
  ['laptop gateway is wrong or missing', 'шлюз ноутбука неверный или не задан'], ['router has no route to ', 'у маршрутизатора нет маршрута до '],
  ['router WAN is not connected to the ISP', 'WAN маршрутизатора не подключён к провайдеру'], ['no srcnat: private source address is not translated', 'нет srcnat: частный адрес источника не транслируется'],
  ['laptop has no DNS server', 'у ноутбука нет DNS-сервера'], ['router DNS: allow-remote-requests=no', 'DNS маршрутизатора: allow-remote-requests=no'],
  ['DNS to router blocked', 'DNS к маршрутизатору заблокирован'], ['router cannot resolve names (no DNS servers?)', 'маршрутизатор не разрешает имена (нет DNS-серверов?)'],
  [' unreachable: ', ' недоступен: '], ['DNS server ', 'DNS-сервер '],
]
const trReason = (s) => LANG === 'ru' ? REASONS_RU.reduce((a, [en, ru]) => a.split(en).join(ru), String(s || '')) : s

const root = document.getElementById('root')
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// ---------- progress store ----------
const KEY = 'mtcna-academy-v1'
const store = {
  data: { lessons: {}, quiz: {}, labs: {}, exams: [], theme: null },
  load() { try { Object.assign(this.data, JSON.parse(localStorage.getItem(KEY) || '{}')) } catch {} },
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)) } catch {} },
}
store.load()

function applyTheme() {
  const t = store.data.theme
  if (t) document.documentElement.dataset.theme = t
  else delete document.documentElement.dataset.theme
}
applyTheme()

// ---------- content loading ----------
const lessonCache = {}
async function lessons(mod) {
  if (!lessonCache[mod.id]) {
    const r = await fetch('/content/' + (LANG === 'ru' ? 'ru/' : '') + mod.file)
    if (!r.ok) throw new Error('load failed')
    lessonCache[mod.id] = splitLessons(await r.text())
  }
  return lessonCache[mod.id]
}

function moduleProgress(mod, count) {
  const done = Object.keys(store.data.lessons).filter((k) => k.startsWith(mod.id + ':')).length
  const labsDone = mod.labs.filter((l) => store.data.labs[l]).length
  const q = store.data.quiz[mod.id] || 0
  const parts = [count ? done / count : 0, q >= 80 ? 1 : q / 80]
  if (mod.labs.length) parts.push(labsDone / mod.labs.length)
  return Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100)
}

// ---------- layout ----------
function shell(active, inner) {
  const nav = [['#/', T('Course', 'Курс'), 'home'], ['#/labs', T('Labs', 'Лабы'), 'labs'], ['#/terminal', T('Terminal', 'Терминал'), 'terminal'], ['#/troubleshoot', T('Troubleshoot', 'Неисправности'), 'trouble'], ['#/sims', T('Simulators', 'Симуляторы'), 'sims'], ['#/exam', T('Final exam', 'Экзамен'), 'exam'], ['#/cheatsheet', T('Cheat sheet', 'Шпаргалка'), 'cheat']]
  return `
  <header class="top">
    <a href="#/" class="brand"><span class="logo">M</span><span>MTCNA <b>Academy</b></span></a>
    <nav>${nav.map(([h, t, k]) => `<a href="${h}" class="${active === k ? 'on' : ''}">${t}</a>`).join('')}</nav>
    <button class="theme lang" id="lang" title="${T('Русский язык', 'English language')}" aria-label="${T('Switch to Russian', 'Switch to English')}">${T('RU', 'EN')}</button>
    <button class="theme" id="theme" title="${T('Toggle dark mode', 'Тёмная тема')}" aria-label="${T('Toggle dark mode', 'Тёмная тема')}">◐</button>
  </header>
  <main class="wrap">${inner}</main>
  <footer class="foot">${T('Independent study platform for the MikroTik Certified Network Associate (MTCNA) course. Based on the course slides and the official documentation at help.mikrotik.com. Not affiliated with or endorsed by MikroTik. Progress is stored in this browser only.', 'Независимая учебная платформа по курсу MikroTik Certified Network Associate (MTCNA). Основана на слайдах курса и официальной документации help.mikrotik.com. Не связана с MikroTik и не одобрена ею. Прогресс хранится только в этом браузере.')}</footer>`
}

// ---------- pages ----------
function readinessHtml(rd) {
  const p = rd.parts
  return `<div class="ready"><div class="ready-ring" style="--p:${rd.score}"><b>${rd.score}</b><span>/100</span></div><div><b>${T('Exam readiness', 'Готовность к экзамену')}</b><p>${esc(rd.verdict)}</p>
    <p class="muted sm">${T('Quizzes', 'Тесты')} ${p.quiz}% · ${T('labs', 'лабы')} ${p.labs}% · ${T('lessons', 'уроки')} ${p.read}%${p.exam !== null ? ` · ${T('last exams', 'последние экзамены')} ${p.exam}%` : ''}</p>
    ${rd.weak.length && rd.score > 0 ? `<p class="sm">${T('Weakest', 'Слабее всего')}: ${rd.weak.map((w) => `<a href="#/module/${w.m.id}">${esc(w.m.title)}</a>`).join(', ')}</p>` : ''}</div></div>`
}
function aiHomeCard(counts) {
  const plan = studyPlan(MODULES, LABS, store.data, counts)
  const rd = readiness(MODULES, LABS, store.data, counts)
  return `<section class="card ai-home"><div><h2>🤖 ${T('Your next steps', 'Ваши следующие шаги')}</h2><p class="muted sm">${T('The study plan adapts to your lessons, quiz scores, labs and exam results in this browser.', 'План подстраивается под ваши уроки, результаты тестов, лабы и экзамены в этом браузере.')}</p>
    <ol class="plan">${plan.steps.map((x) => `<li><a href="${x.href}">${x.icon} ${esc(x.text)}</a><span class="muted sm">${esc(x.why)}</span></li>`).join('')}</ol></div>${readinessHtml(rd)}</section>`
}
async function lessonCounts() { return Promise.all(MODULES.map((m) => lessons(m).then((l) => l.length).catch(() => 0))) }

function troublePage() {
  const level = Math.min(3, Math.max(1, Number(sessionStorage.getItem('ts-level')) || 1))
  const html = shell('trouble', `
  <h1>🛠️ ${T('Troubleshooting lab', 'Поиск неисправностей')}</h1>
  <p class="lead">${T('The AI lab generator breaks a working office network in a random way. The laptop has no Internet; find the cause with print, ping and the tutor, and fix it without resetting the router. Every new lab is different.', 'Генератор лаб ломает рабочую офисную сеть случайным образом. У ноутбука нет Интернета: найдите причину через print, ping и тьютора и исправьте её без сброса маршрутизатора. Каждая новая лаба отличается.')}</p>
  <div class="row wrap ts-bar"><span>${T('Difficulty', 'Сложность')}:</span>${[1, 2, 3].map((n) => `<button class="chip ${n === level ? 'on' : ''}" data-lv="${n}">${n} ${T(n > 1 ? 'faults' : 'fault', n === 1 ? 'поломка' : 'поломки')}</button>`).join('')}<button class="btn sm" id="ts-new">${T('Generate a new fault', 'Сгенерировать новую поломку')}</button></div>
  <div class="lab">
    <section class="lab-main"><div id="term"></div></section>
    <aside class="lab-side card">
      <h3>${T('Task', 'Задание')} <span id="lab-count" class="score"></span></h3>
      <ol class="tasks" id="tasks"></ol>
      <div id="lp"></div>
      ${tutorPanel()}
      <div class="row wrap"><button class="btn ghost" id="ts-hint">${T('Hint', 'Подсказка')}</button><button class="btn ghost" id="ts-give">${T('Show the cause', 'Показать причину')}</button></div>
      <div id="ts-info"></div>
    </aside>
  </div>`)
  return { html, after: () => {
    let ros, t, gen, hints, solvedShown
    const start = () => {
      gen = makeTroubleshoot((Date.now() ^ (Math.random() * 1e9)) >>> 0, level)
      ros = new RouterOS(gen.st); hints = 0; solvedShown = false
      t = mountTerminal(document.getElementById('term'), ros, upd)
      document.getElementById('ts-info').innerHTML = ''
      upd(); t.focus()
    }
    const upd = () => {
      const ok = troubleshootSolved(ros.st)
      document.getElementById('lab-count').textContent = ok ? '1/1' : '0/1'
      document.getElementById('lab-count').className = 'score' + (ok ? ' good' : '')
      document.getElementById('tasks').innerHTML = `<li class="${ok ? 'done' : ''}"><span class="tick">${ok ? '✓' : 1}</span><div>${T(`Bring the laptop back online (${gen.faults.length} fault${gen.faults.length > 1 ? 's' : ''} hidden). Keep bridgeLAN and the default route; no reset.`, `Верните ноутбуку Интернет (спрятано поломок: ${gen.faults.length}). Сохраните bridgeLAN и маршрут по умолчанию, без сброса.`)}</div></li>`
      document.getElementById('lp').innerHTML = laptopPanel(ros.st)
      if (ok && !solvedShown) {
        solvedShown = true
        store.data.trouble = (store.data.trouble || 0) + 1; store.save()
        t.write(T('\n*** Fixed! The laptop is online again. ***\n', '\n*** Исправлено! Ноутбук снова в сети. ***\n'), 'good')
        reveal(true)
      }
    }
    const reveal = (won) => { document.getElementById('ts-info').innerHTML = `<div class="ts-cause ${won ? 'good' : ''}"><b>${won ? T('What was broken', 'Что было сломано') : T('The cause', 'Причина')}</b><ul>${gen.faults.map((f) => `<li>${esc(f.explain())}</li>`).join('')}</ul></div>` }
    document.getElementById('ts-hint').onclick = () => {
      const f = gen.faults[Math.min(hints, gen.faults.length - 1)]
      hints++
      document.getElementById('ts-info').innerHTML = `<div class="ts-cause"><b>${T('Hint', 'Подсказка')} ${hints}</b><p>${esc(f.hint())}</p><pre class="code sm"><code>${esc(f.diag)}</code><button class="copy">${T('Copy', 'Копировать')}</button></pre></div>`
      bindCopy(document.getElementById('ts-info'))
    }
    document.getElementById('ts-give').onclick = () => reveal(false)
    document.getElementById('ts-new').onclick = start
    document.querySelector('.ts-bar').addEventListener('click', (e) => { const lv = e.target.dataset.lv; if (lv) { sessionStorage.setItem('ts-level', lv); route() } })
    start()
    bindTutor(document.querySelector('.ai'), () => ({ st: ros.st, lastError: t.lastError }))
  } }
}

async function homePage() {
  const counts = await Promise.all(MODULES.map((m) => lessons(m).then((l) => l.length).catch(() => 0)))
  const totalLessons = counts.reduce((a, b) => a + b, 0)
  const doneLessons = Object.keys(store.data.lessons).length
  const labsDone = Object.keys(store.data.labs).filter((k) => store.data.labs[k]).length
  const bestExam = Math.max(0, ...store.data.exams.map((e) => e.score))
  const cards = MODULES.map((m, i) => {
    const p = moduleProgress(m, counts[i])
    return `<a class="mod" href="#/module/${m.id}">
      <div class="mod-top"><span class="num">${m.num}</span><span class="ico">${m.icon}</span></div>
      <h3>${esc(m.title)}</h3><p>${esc(m.summary)}</p>
      <div class="meta"><span>${counts[i]} ${T('lessons', 'уроков')}</span><span>${m.quiz.length} ${T('questions', 'вопросов')}</span>${m.labs.length ? `<span>${m.labs.length} ${T('lab' + (m.labs.length > 1 ? 's' : ''), m.labs.length > 1 ? 'лабы' : 'лаба')}</span>` : ''}</div>
      <div class="prog"><div style="width:${p}%"></div></div>
    </a>`
  }).join('')
  return shell('home', `
  <section class="hero">
    <div>
      <h1>${T('Learn MTCNA by doing', 'Изучайте MTCNA на практике')}</h1>
      <p>${T('Ten modules that follow the official MikroTik Certified Network Associate outline: theory from the course slides and help.mikrotik.com, a RouterOS terminal with guided labs, network simulators, a quiz for every module, and a timed final exam.', 'Десять модулей по официальной программе MikroTik Certified Network Associate: теория из слайдов курса и help.mikrotik.com, терминал RouterOS с лабораторными работами, сетевые симуляторы, тест к каждому модулю и финальный экзамен на время.')}</p>
      <div class="row wrap"><a class="btn" href="#/module/intro">${T('Start module 1', 'Начать модуль 1')}</a><a class="btn ghost" href="#/terminal">${T('Open the terminal', 'Открыть терминал')}</a></div>
    </div>
    <div class="stats">
      <div><b>${doneLessons}/${totalLessons}</b><span>${T('lessons read', 'уроков прочитано')}</span></div>
      <div><b>${labsDone}/${LABS.length}</b><span>${T('labs passed', 'лаб пройдено')}</span></div>
      <div><b>${bestExam ? bestExam + '%' : '–'}</b><span>${T('best exam', 'лучший экзамен')}</span></div>
    </div>
  </section>
  ${aiHomeCard(counts)}
  <h2 class="sec">${T('Modules', 'Модули')}</h2>
  <div class="mods">${cards}</div>
  <section class="card how">
    <h2>${T('How to use it', 'Как заниматься')}</h2>
    <ol>${T(`
      <li><b>Read</b> each lesson and mark it done. Commands in grey boxes can be copied straight into the terminal.</li>
      <li><b>Practise</b> in the module lab: the checklist turns green as your configuration works, including whether the student laptop gets Internet.</li>
      <li><b>Test yourself</b> with the module quiz. 80% or more counts as passed.</li>
      <li><b>Take the final exam</b>: ${EXAM.questions} random questions, ${EXAM.minutes} minutes, ${EXAM.pass}% to pass, like the real MTCNA test.</li>`, `
      <li><b>Читайте</b> каждый урок и отмечайте его пройденным. Команды в серых блоках можно сразу копировать в терминал.</li>
      <li><b>Практикуйтесь</b> в лабе модуля: пункты загораются зелёным, когда конфигурация работает, включая выход ноутбука студента в Интернет.</li>
      <li><b>Проверяйте себя</b> тестом модуля. 80% и выше считается сдачей.</li>
      <li><b>Сдайте финальный экзамен</b>: ${EXAM.questions} случайных вопросов, ${EXAM.minutes} минут, ${EXAM.pass}% для сдачи, как на настоящем тесте MTCNA.</li>`)}
    </ol>
    <p class="muted">${T('Want a clean start?', 'Хотите начать заново?')} <button class="link" id="reset-progress">${T('Reset all progress', 'Сбросить весь прогресс')}</button></p>
  </section>`)
}

async function modulePage(id, tab, idx) {
  const mod = MODULES.find((m) => m.id === id)
  if (!mod) return notFound()
  let ls = []
  try { ls = await lessons(mod) } catch { ls = [{ title: T('Could not load', 'Не удалось загрузить'), body: T('Lesson content failed to load. Check your connection and reload.', 'Не удалось загрузить урок. Проверьте подключение и обновите страницу.') }] }
  tab = tab || 'lesson'
  idx = Number(idx || 0)
  const side = ls.map((l, i) => `<a href="#/module/${id}/lesson/${i}" class="${tab === 'lesson' && i === idx ? 'on' : ''}">${store.data.lessons[id + ':' + i] ? '✓' : `<span class="dot">${i + 1}</span>`} ${esc(l.title)}</a>`).join('')
  const labLinks = mod.labs.map((l) => LABS.find((x) => x.id === l)).map((l) => `<a href="#/lab/${l.id}">${store.data.labs[l.id] ? '✓' : '🧪'} ${esc(l.title)}</a>`).join('')
  const simLinks = mod.sims.map((s) => SIMS.find((x) => x.id === s)).map((s) => `<a href="#/sim/${s.id}">${s.icon} ${esc(s.title)}</a>`).join('')
  const q = store.data.quiz[id]
  let body = ''
  if (tab === 'lesson') {
    const l = ls[idx] || ls[0]
    const done = !!store.data.lessons[id + ':' + idx]
    body = `<article class="lesson"><div class="crumb">${T('Module', 'Модуль')} ${mod.num} · ${T(`Lesson ${idx + 1} of ${ls.length}`, `Урок ${idx + 1} из ${ls.length}`)}</div><h1>${esc(l.title)}</h1>${renderMarkdown(l.body)}</article>
      <div class="lesson-nav">
        ${idx > 0 ? `<a class="btn ghost" href="#/module/${id}/lesson/${idx - 1}">← ${T('Previous', 'Назад')}</a>` : '<span></span>'}
        <button class="btn ${done ? 'ghost' : ''}" id="mark" data-k="${id}:${idx}">${done ? T('✓ Done', '✓ Пройдено') : T('Mark as done', 'Отметить пройденным')}</button>
        ${idx < ls.length - 1 ? `<a class="btn ghost" href="#/module/${id}/lesson/${idx + 1}">${T('Next', 'Далее')} →</a>` : `<a class="btn ghost" href="#/module/${id}/quiz">${T('Take the quiz', 'Пройти тест')} →</a>`}
      </div>`
  } else if (tab === 'quiz') {
    body = `<div id="quiz"></div>`
  }
  const html = shell('home', `
  <div class="module">
    <aside class="side">
      <div class="side-head"><span class="ico">${mod.icon}</span><div><small>${T('Module', 'Модуль')} ${mod.num}</small><b>${esc(mod.title)}</b></div></div>
      <div class="src">${T('Source', 'Источник')}: ${mod.source === 'slides' ? T('course slides', 'слайды курса') : T('course slides + MikroTik docs', 'слайды курса + документация MikroTik')}</div>
      <h4>${T('Lessons', 'Уроки')}</h4><nav>${side}</nav>
      ${labLinks ? `<h4>${T('Labs', 'Лабы')}</h4><nav>${labLinks}</nav>` : ''}
      ${simLinks ? `<h4>${T('Simulators', 'Симуляторы')}</h4><nav>${simLinks}</nav>` : ''}
      <h4>${T('Check', 'Проверка')}</h4><nav><a href="#/module/${id}/quiz" class="${tab === 'quiz' ? 'on' : ''}">📝 ${T('Module quiz', 'Тест модуля')} ${q !== undefined ? `<span class="score ${q >= 80 ? 'good' : ''}">${q}%</span>` : ''}</a></nav>
    </aside>
    <section class="content">${body}</section>
  </div>`)
  return { html, after: () => { if (tab === 'quiz') runQuiz(document.getElementById('quiz'), mod) } }
}

function shuffle(a) { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }

function shuffledQuestion(q) {
  const order = shuffle(q.o.map((_, i) => i))
  return { ...q, o: order.map((i) => q.o[i]), a: order.indexOf(q.a) }
}

function runQuiz(el, mod) {
  const qs = shuffle(mod.quiz).map(shuffledQuestion)
  const answers = new Array(qs.length).fill(null)
  const draw = (submitted) => {
    const score = Math.round((answers.filter((a, i) => a === qs[i].a).length / qs.length) * 100)
    el.innerHTML = `<h1>${T('Quiz', 'Тест')}: ${esc(mod.title)}</h1><p class="muted">${T(`${qs.length} questions. Choose one answer for each, then check. Questions and options are shuffled every time.`, `${qs.length} вопросов. Выберите по одному ответу и проверьте. Вопросы и варианты каждый раз перемешиваются.`)}</p>
      ${qs.map((q, i) => `<div class="qcard ${submitted ? (answers[i] === q.a ? 'ok' : 'no') : ''}">
        <div class="qn">${i + 1}. ${esc(q.q)}</div>
        ${q.o.map((o, k) => `<label class="opt ${submitted && k === q.a ? 'right' : ''} ${submitted && answers[i] === k && k !== q.a ? 'wrong' : ''}"><input type="radio" name="q${i}" value="${k}" ${answers[i] === k ? 'checked' : ''} ${submitted ? 'disabled' : ''}> ${esc(o)}</label>`).join('')}
        ${submitted ? `<div class="explain">${answers[i] === q.a ? '✓' : '✗'} ${esc(q.e)}</div>` : ''}
      </div>`).join('')}
      <div class="row">${submitted ? `<div class="result big ${score >= 80 ? 'good' : 'bad'}">${T('Score', 'Результат')} ${score}% ${score >= 80 ? T('· passed', '· сдано') : T('· 80% needed', '· нужно 80%')}</div><button class="btn" id="again">${T('Try again', 'Ещё раз')}</button>` : `<button class="btn" id="check">${T('Check answers', 'Проверить ответы')}</button><span class="muted" id="left"></span>`}</div>`
    if (submitted) {
      store.data.quiz[mod.id] = Math.max(store.data.quiz[mod.id] || 0, score); store.save()
      el.querySelector('#again').onclick = () => runQuiz(el, mod)
      el.scrollIntoView({ behavior: 'smooth' })
    } else {
      el.querySelector('#check').onclick = () => {
        const missing = answers.filter((a) => a === null).length
        if (missing && !confirm(T(`${missing} question(s) unanswered. Check anyway?`, `Без ответа вопросов: ${missing}. Всё равно проверить?`))) return
        draw(true)
      }
    }
  }
  el.addEventListener('change', (e) => { if (e.target.name) answers[Number(e.target.name.slice(1))] = Number(e.target.value) })
  draw(false)
}

// ---------- terminal widget ----------
function mountTerminal(el, ros, onChange) {
  el.innerHTML = `<div class="term" tabindex="-1"><div class="term-bar"><span></span><span></span><span></span><b>${T('RouterOS terminal (simulated)', 'Терминал RouterOS (симуляция)')}</b></div><pre class="term-out" aria-live="polite"></pre><div class="term-in"><span class="prompt"></span><input spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="RouterOS command"></div></div>`
  const out = el.querySelector('.term-out'), input = el.querySelector('input'), prompt = el.querySelector('.prompt')
  let hpos = -1, lastTab = 0
  const write = (t, cls = '') => { const s = document.createElement('span'); if (cls) s.className = cls; s.textContent = t + '\n'; out.appendChild(s); out.scrollTop = out.scrollHeight }
  const banner = () => {
    write(`  MMM      MMM       KKK                          TTTTTTTTTTT      KKK\n  MMMM    MMMM       KKK                          TTTTTTTTTTT      KKK\n  MMM MMMM MMM  III  KKK  KKK  RRRRRR     OOOOOO      TTT     III  KKK  KKK\n  MMM  MM  MMM  III  KKKKK     RRR  RRR  OOO  OOO     TTT     III  KKKKK\n  MMM      MMM  III  KKK KKK   RRRRRR    OOO  OOO     TTT     III  KKK KKK\n  MMM      MMM  III  KKK  KKK  RRR  RRR   OOOOOO      TTT     III  KKK  KKK\n\n  MikroTik RouterOS 7.16.2 (simulator)   https://help.mikrotik.com/docs\n\n${T('Press Tab to complete, type /help for the list of simulated menus.', 'Tab дополняет команду, /help показывает список симулируемых меню.')}`, 'dim')
    const note = ros.st.singletons['system note']
    if (note.note && note['show-at-login'] === 'yes') write(note.note, 'warn')
  }
  const setPrompt = () => { prompt.textContent = ros.prompt() }
  ros.onReset = () => { out.textContent = ''; banner(); setPrompt(); onChange && onChange() }
  banner(); setPrompt()
  const api = { lastError: '' }
  const runLine = (line) => {
    write(ros.prompt() + line, 'cmd')
    const res = ros.exec(line)
    const isErr = res && /^(bad command|expected end|failure|input does not|invalid value|no such)/.test(res)
    if (res) write(res, isErr ? 'err' : '')
    if (isErr) {
      api.lastError = line + '\n' + res
      const hint = explainError(ros, line, res)
      if (hint) write('🤖 ' + hint, 'tutor')
    }
    setPrompt()
    onChange && onChange()
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const v = input.value; input.value = ''; hpos = -1; runLine(v); e.preventDefault() }
    else if (e.key === 'Tab') {
      e.preventDefault()
      const now = Date.now()
      const r = ros.complete(input.value)
      input.value = r.line
      if (r.list.length && now - lastTab < 600) write(r.list.join('  '), 'dim')
      lastTab = now
    } else if (e.key === 'ArrowUp') { const h = ros.history; if (!h.length) return; hpos = hpos < 0 ? h.length - 1 : Math.max(0, hpos - 1); input.value = h[hpos]; e.preventDefault() }
    else if (e.key === 'ArrowDown') { const h = ros.history; if (hpos < 0) return; hpos = Math.min(h.length, hpos + 1); input.value = h[hpos] || ''; if (hpos >= h.length) hpos = -1; e.preventDefault() }
    else if ((e.key === 'l' && e.ctrlKey) || e.key === 'F5') { out.textContent = ''; e.preventDefault() }
    else if (e.key === 'c' && e.ctrlKey && !window.getSelection().toString()) { write(ros.prompt() + input.value + '^C', 'dim'); input.value = ''; e.preventDefault() }
    else if (e.key === 'k' && e.ctrlKey) { input.value = input.value.slice(0, input.selectionStart); e.preventDefault() }
  })
  el.querySelector('.term').addEventListener('click', () => { if (!window.getSelection().toString()) input.focus() })
  return Object.assign(api, { runLine, focus: () => input.focus(), write })
}

function laptopPanel(st) {
  const L = laptopState(st)
  const inet = laptopInternet(st)
  return `<div class="laptop"><h4>💻 ${T('Laptop on', 'Ноутбук на')} ${esc(L.port)} ${L.mode === 'dhcp' ? '(DHCP)' : T('(static)', '(статика)')}</h4>
    <div class="kv sm"><div><span>IP</span><b>${esc(L.ip || '–')}</b></div><div><span>${T('Gateway', 'Шлюз')}</span><b>${esc(L.gw || '–')}</b></div><div><span>DNS</span><b>${esc(L.dns || '–')}</b></div>
    <div><span>${T('Router online', 'Маршрутизатор в сети')}</span><b class="${routerInternet(st) ? 'good' : 'bad'}">${routerInternet(st) ? T('yes', 'да') : T('no', 'нет')}</b></div>
    <div><span>${T('Laptop Internet', 'Интернет на ноутбуке')}</span><b class="${inet.ok ? 'good' : 'bad'}">${inet.ok ? T('yes', 'да') : T('no', 'нет')}</b></div></div>
    ${!inet.ok ? `<p class="why">${T('Why', 'Причина')}: ${esc(trReason(inet.reason || L.why || ''))}</p>` : ''}</div>`
}

// ---------- AI tutor panel ----------
// ctx() returns { st, lab, lastError } for the current terminal
function tutorPanel() {
  return `<div class="ai card-in"><h4>🤖 ${T('AI tutor', 'ИИ-тьютор')}</h4>
    <div class="row wrap"><button class="btn ghost sm" data-ai="audit">${T('Audit my config', 'Аудит конфигурации')}</button><button class="btn ghost sm" data-ai="why">${T('Why no Internet?', 'Почему нет Интернета?')}</button></div>
    <form class="ai-ask"><input name="q" maxlength="1000" placeholder="${T('Ask about RouterOS or your config', 'Вопрос о RouterOS или вашей конфигурации')}" aria-label="${T('Question for the AI tutor', 'Вопрос ИИ-тьютору')}"><button class="btn sm">${T('Ask', 'Спросить')}</button></form>
    <div class="ai-out" aria-live="polite"></div></div>`
}
const fences = (t) => String(t).replace(/```[\w-]*\n([\s\S]*?)```/g, (_, c) => '\n' + c.replace(/\n$/, '').split('\n').map((l) => '    ' + l).join('\n') + '\n')
const cmdBlocks = (t) => String(t).split('\n').map((l) => /^\/[a-z]/.test(l) ? '    ' + l : l).join('\n').replace(/\n( {4}\/)/g, '\n\n$1')
function bindTutor(el, ctx) {
  const out = el.querySelector('.ai-out')
  const show = (html) => { out.innerHTML = html; bindCopy(out) }
  el.querySelector('[data-ai="audit"]').onclick = () => {
    const f = auditConfig(ctx().st)
    const sc = auditScore(f)
    const lab = { high: T('high', 'высокий'), med: T('medium', 'средний'), low: T('low', 'низкий') }
    show(`<div class="audit-head"><b class="${sc >= 80 ? 'good' : sc >= 50 ? '' : 'bad'}">${sc}/100</b><span>${f.length ? T(`${f.length} finding(s), most important first`, `Замечаний: ${f.length}, сначала важные`) : T('No issues found. Nice work.', 'Замечаний нет. Отличная работа.')}</span></div>` +
      f.map((x) => `<details class="finding ${x.sev}"><summary><span class="sev">${lab[x.sev]}</span> ${esc(x.title)}</summary><p>${esc(trReason(x.why))}</p>${x.fix ? `<pre class="code sm"><code>${esc(x.fix)}</code><button class="copy">${T('Copy', 'Копировать')}</button></pre>` : ''}</details>`).join(''))
  }
  el.querySelector('[data-ai="why"]').onclick = () => ask(T('Why does the laptop have no Internet? Give me a hint, not the full answer.', 'Почему у ноутбука нет Интернета? Дай подсказку, а не готовый ответ.'))
  el.querySelector('.ai-ask').onsubmit = (e) => { e.preventDefault(); const q = e.target.q.value.trim(); if (q) { ask(q); e.target.q.value = '' } }
  const ask = async (q) => {
    show(`<p class="ai-q">${esc(q)}</p><p class="muted">${T('Thinking…', 'Думаю…')}</p>`)
    const c = ctx()
    const r = await askTutor(q, c)
    const body = r.source === 'claude' ? fences(r.text) : cmdBlocks(trReason(r.text))
    show(`<p class="ai-q">${esc(q)}</p><div class="ai-a">${renderMarkdown(body)}</div><p class="ai-src">${r.source === 'claude' ? T('Answer by Claude, based on your current config. Check it in the terminal.', 'Ответ Claude на основе вашей текущей конфигурации. Проверьте его в терминале.') : T('Built-in tutor (offline rules). The Claude tutor answers when the site has an API key configured.', 'Встроенный тьютор (правила, без сети). Claude отвечает, когда на сайте настроен ключ API.')}</p>`)
  }
}
function bindCopy(scope) {
  scope.querySelectorAll('pre.code .copy').forEach((b) => b.onclick = () => {
    const txt = b.parentElement.querySelector('code').textContent
    navigator.clipboard && navigator.clipboard.writeText(txt).then(() => { b.textContent = T('Copied', 'Скопировано'); setTimeout(() => b.textContent = T('Copy', 'Копировать'), 1200) }).catch(() => {})
  })
}

function terminalPage() {
  const html = shell('terminal', `
  <div class="lab">
    <section class="lab-main"><div id="term"></div></section>
    <aside class="lab-side card">
      <h3>${T('Free practice', 'Свободная практика')}</h3>
      <p class="muted">${T('A hAP-style router with the MikroTik <b>default configuration</b>. ether1 is cabled to the ISP (DHCP, PPPoE user class/class, gateway 22.1.1.1), ether2 to a laptop.', 'Маршрутизатор типа hAP с <b>конфигурацией MikroTik по умолчанию</b>. ether1 подключён к провайдеру (DHCP, PPPoE пользователь class/class, шлюз 22.1.1.1), ether2 к ноутбуку.')}</p>
      <div id="lp"></div>
      ${tutorPanel()}
      <h4>${T('Try', 'Попробуйте')}</h4>
      <div class="tries">${['/interface print', '/ip address print', '/ip route print', '/ip firewall filter print', '/ping mikrotik.com count=3', '/system reset-configuration no-defaults=yes', '/export'].map((c) => `<button class="chip mono" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      <button class="btn ghost" id="t-reset">${T('Reset to default config', 'Сбросить к конфигурации по умолчанию')}</button>
    </aside>
  </div>`)
  return { html, after: () => {
    let ros = new RouterOS(defaultConfig())
    const upd = () => { document.getElementById('lp').innerHTML = laptopPanel(ros.st) }
    let t = mountTerminal(document.getElementById('term'), ros, upd)
    upd(); t.focus()
    document.querySelector('.tries').onclick = (e) => { if (e.target.dataset.c) { t.runLine(e.target.dataset.c); t.focus() } }
    document.getElementById('t-reset').onclick = () => { ros = new RouterOS(defaultConfig()); t = mountTerminal(document.getElementById('term'), ros, upd); upd(); t.focus() }
    bindTutor(document.querySelector('.ai'), () => ({ st: ros.st, lastError: t.lastError }))
  } }
}

function labsPage() {
  const byMod = MODULES.filter((m) => m.labs.length).map((m) => `<div class="lab-group"><h3>${m.icon} ${T('Module', 'Модуль')} ${m.num}: ${esc(m.title)}</h3>
    ${m.labs.map((id) => LABS.find((l) => l.id === id)).map((l) => `<a class="lab-card" href="#/lab/${l.id}"><b>${store.data.labs[l.id] ? '✅' : '🧪'} ${esc(l.title)}</b><span>${esc(l.intro)}</span><em>${l.tasks.length} ${T('tasks · starts from', 'заданий · старт:')} ${(LANG === 'ru' ? { default: 'конфигурация по умолчанию', empty: 'пустая конфигурация', bridged: 'bridgeLAN готов', online: 'маршрутизатор в сети', onlineDhcp: 'в сети с DHCP', dhcpWan: 'DHCP на WAN' } : { default: 'default config', empty: 'empty config', bridged: 'bridgeLAN ready', online: 'router online', onlineDhcp: 'router online with DHCP', dhcpWan: 'DHCP WAN' })[l.start]}</em></a>`).join('')}</div>`).join('')
  return shell('labs', `<h1>${T('Guided labs', 'Лабораторные работы')}</h1><p class="lead">${T('Each lab gives you a simulated router in a known state. Type real RouterOS commands; the task list checks your configuration live. The topology follows the course: WAN ether1 to the ISP 22.1.1.0/24 (gateway and DNS 22.1.1.1), LAN bridgeLAN 192.168.33.0/24, laptop on ether2.', 'В каждой лабе у вас симулированный маршрутизатор в известном состоянии. Вводите настоящие команды RouterOS, а список заданий проверяет конфигурацию на лету. Топология как в курсе: WAN ether1 к провайдеру 22.1.1.0/24 (шлюз и DNS 22.1.1.1), LAN bridgeLAN 192.168.33.0/24, ноутбук на ether2.')}</p>
  <div class="topo card">${TOPO_SVG}</div>${byMod}`)
}

const TOPO_SVG = `<svg viewBox="0 0 640 150" class="topo-svg" role="img" aria-label="Lab topology: laptop to router to ISP">
  <rect x="10" y="50" width="110" height="50" rx="8" class="n"/><text x="65" y="72" text-anchor="middle" class="t">Laptop</text><text x="65" y="90" text-anchor="middle" class="s">192.168.33.2</text>
  <line x1="120" y1="75" x2="250" y2="75" class="w"/><text x="185" y="66" text-anchor="middle" class="s">ether2 / bridgeLAN</text><text x="185" y="96" text-anchor="middle" class="s">192.168.33.1/24</text>
  <rect x="250" y="40" width="140" height="70" rx="10" class="r"/><text x="320" y="72" text-anchor="middle" class="t">RouterOS</text><text x="320" y="92" text-anchor="middle" class="s">your router</text>
  <line x1="390" y1="75" x2="510" y2="75" class="w"/><text x="450" y="66" text-anchor="middle" class="s">ether1 (WAN)</text><text x="450" y="96" text-anchor="middle" class="s">22.1.1.x/24</text>
  <ellipse cx="570" cy="75" rx="62" ry="38" class="n"/><text x="570" y="72" text-anchor="middle" class="t">ISP</text><text x="570" y="90" text-anchor="middle" class="s">gw/DNS 22.1.1.1</text></svg>`

function labPage(id) {
  const lab = LABS.find((l) => l.id === id)
  if (!lab) return notFound()
  const mod = MODULES.find((m) => m.id === lab.module)
  const html = shell('labs', `
  <div class="crumb"><a href="#/labs">${T('Labs', 'Лабы')}</a> · <a href="#/module/${mod.id}">${T('Module', 'Модуль')} ${mod.num}</a></div>
  <h1>${esc(lab.title)}</h1><p class="lead">${esc(lab.intro)}</p>
  <div class="lab">
    <section class="lab-main"><div id="term"></div></section>
    <aside class="lab-side card">
      <h3>${T('Tasks', 'Задания')} <span id="lab-count" class="score"></span></h3>
      <ol class="tasks" id="tasks"></ol>
      <div id="lp"></div>
      ${tutorPanel()}
      <div class="row wrap"><button class="btn ghost" id="l-reset">${T('Restart lab', 'Начать заново')}</button><button class="btn ghost" id="l-sol">${T('Show all hints', 'Показать все подсказки')}</button></div>
    </aside>
  </div>`)
  return { html, after: () => {
    let ros = new RouterOS(makeLabState(lab))
    const open = new Set()
    const upd = () => {
      const pr = labProgress(lab, ros.st)
      const n = pr.filter(Boolean).length
      document.getElementById('lab-count').textContent = `${n}/${pr.length}`
      document.getElementById('lab-count').className = 'score' + (n === pr.length ? ' good' : '')
      document.getElementById('tasks').innerHTML = lab.tasks.map((t, i) => `<li class="${pr[i] ? 'done' : ''}"><span class="tick">${pr[i] ? '✓' : i + 1}</span><div>${esc(t.t)}<button class="link hint" data-h="${i}">${open.has(i) ? T('hide hint', 'скрыть подсказку') : T('hint', 'подсказка')}</button>${open.has(i) ? `<pre class="code sm"><code>${esc(t.h)}</code></pre>` : ''}</div></li>`).join('')
      document.getElementById('lp').innerHTML = laptopPanel(ros.st)
      if (n === pr.length && !store.data.labs[lab.id]) { store.data.labs[lab.id] = true; store.save(); t.write(T('\n*** Lab complete! All tasks pass. ***\n', '\n*** Лаба пройдена! Все задания выполнены. ***\n'), 'good') }
    }
    let t = mountTerminal(document.getElementById('term'), ros, upd)
    upd(); t.focus()
    document.getElementById('tasks').onclick = (e) => { const h = e.target.dataset.h; if (h !== undefined) { open.has(+h) ? open.delete(+h) : open.add(+h); upd() } }
    document.getElementById('l-sol').onclick = () => { lab.tasks.forEach((_, i) => open.add(i)); upd() }
    document.getElementById('l-reset').onclick = () => { ros = new RouterOS(makeLabState(lab)); t = mountTerminal(document.getElementById('term'), ros, upd); upd(); t.focus() }
    bindTutor(document.querySelector('.ai'), () => ({ st: ros.st, lab: { ...lab, done: labProgress(lab, ros.st) }, lastError: t.lastError }))
  } }
}

function simsPage() {
  return shell('sims', `<h1>${T('Simulators', 'Симуляторы')}</h1><p class="lead">${T('Small interactive tools for the ideas that are easier to see than to read.', 'Небольшие интерактивные инструменты для идей, которые проще увидеть, чем прочитать.')}</p>
  <div class="mods">${SIMS.map((s) => `<a class="mod" href="#/sim/${s.id}"><div class="mod-top"><span class="ico">${s.icon}</span></div><h3>${esc(s.title)}</h3><p>${esc(s.desc)}</p></a>`).join('')}</div>`)
}

function simPage(id) {
  const s = SIMS.find((x) => x.id === id)
  if (!s) return notFound()
  return { html: shell('sims', `<div class="crumb"><a href="#/sims">${T('Simulators', 'Симуляторы')}</a></div><h1>${s.icon} ${esc(s.title)}</h1><p class="lead">${esc(s.desc)}</p><div id="sim"></div>`), after: () => s.render(document.getElementById('sim')) }
}

// ---------- exam ----------
let examTimer = null
async function examPage() {
  const rd = readiness(MODULES, LABS, store.data, await lessonCounts())
  const hist = store.data.exams.slice(-5).reverse()
  const html = shell('exam', `<div id="exam"><h1>${T('Final exam', 'Финальный экзамен')}</h1>
    <div class="card exam-intro">
      ${T(`<p>The real MTCNA exam is an online test in English: <b>${EXAM.questions} questions</b>, <b>${EXAM.minutes} minutes</b>, pass mark <b>${EXAM.pass}%</b>. This practice exam draws ${EXAM.questions} random questions from all ${MODULES.reduce((a, m) => a + m.quiz.length, 0)} questions in the course, at least two from every module.</p>
      <ul><li>You can move between questions and change answers until you submit.</li><li>The exam submits itself when time runs out.</li><li>After submitting you see every answer with an explanation and a score per module.</li></ul>`, `<p>Настоящий экзамен MTCNA это онлайн-тест на английском: <b>${EXAM.questions} вопросов</b>, <b>${EXAM.minutes} минут</b>, проходной балл <b>${EXAM.pass}%</b>. Этот пробный экзамен выбирает ${EXAM.questions} случайных вопросов из всех ${MODULES.reduce((a, m) => a + m.quiz.length, 0)} вопросов курса, минимум по два из каждого модуля.</p>
      <ul><li>Можно переходить между вопросами и менять ответы до отправки.</li><li>Когда время закончится, экзамен отправится сам.</li><li>После отправки вы увидите все ответы с объяснениями и результат по каждому модулю.</li><li>Совет: переключите язык на EN, чтобы потренироваться на английских формулировках, как на настоящем экзамене.</li></ul>`)}
      <button class="btn" id="start">${T('Start the exam', 'Начать экзамен')}</button>
    </div>
    <div class="card">${readinessHtml(rd)}</div>
    ${hist.length ? `<h3>${T('Previous attempts', 'Предыдущие попытки')}</h3><div class="table-wrap"><table><thead><tr><th>${T('Date', 'Дата')}</th><th>${T('Score', 'Результат')}</th><th>${T('Result', 'Итог')}</th><th>${T('Time', 'Время')}</th></tr></thead><tbody>${hist.map((h) => `<tr><td>${new Date(h.date).toLocaleString()}</td><td>${h.score}%</td><td class="${h.pass ? 'good' : 'bad'}">${h.pass ? T('Passed', 'Сдан') : T('Failed', 'Не сдан')}</td><td>${Math.round(h.secs / 60)} ${T('min', 'мин')}</td></tr>`).join('')}</tbody></table></div>` : ''}
  </div>`)
  return { html, after: () => { document.getElementById('start').onclick = () => startExam(document.getElementById('exam')) } }
}

function pickExam() {
  const picked = []
  for (const m of MODULES) for (const q of shuffle(m.quiz).slice(0, 2)) picked.push({ ...q, mod: m.id })
  const rest = shuffle(MODULES.flatMap((m) => m.quiz.map((q) => ({ ...q, mod: m.id }))).filter((q) => !picked.some((p) => p.q === q.q)))
  return shuffle([...picked, ...rest.slice(0, EXAM.questions - picked.length)]).map(shuffledQuestion)
}

function startExam(el) {
  const qs = pickExam()
  const ans = new Array(qs.length).fill(null)
  const flagged = new Set()
  const t0 = Date.now()
  const end = t0 + EXAM.minutes * 60000
  let cur = 0
  const draw = () => {
    const q = qs[cur]
    el.innerHTML = `<div class="exam-bar"><b>${T('Question', 'Вопрос')} ${cur + 1} / ${qs.length}</b><span id="clock" class="clock"></span><button class="btn ghost sm" id="submit">${T('Submit exam', 'Завершить экзамен')}</button></div>
      <div class="qgrid">${qs.map((_, i) => `<button class="${i === cur ? 'cur' : ''} ${ans[i] !== null ? 'ans' : ''} ${flagged.has(i) ? 'flag' : ''}" data-go="${i}">${i + 1}</button>`).join('')}</div>
      <div class="qcard big"><div class="qn">${esc(q.q)}</div>
        ${q.o.map((o, k) => `<label class="opt"><input type="radio" name="x" value="${k}" ${ans[cur] === k ? 'checked' : ''}> ${esc(o)}</label>`).join('')}</div>
      <div class="row"><button class="btn ghost" id="prev" ${cur === 0 ? 'disabled' : ''}>← ${T('Previous', 'Назад')}</button><button class="btn ghost" id="flag">${flagged.has(cur) ? T('Unflag', 'Снять отметку') : T('Flag for review', 'Отметить')}</button><button class="btn" id="next">${cur === qs.length - 1 ? T('Review', 'Завершить') : T('Next →', 'Далее →')}</button></div>`
    tick()
  }
  const tick = () => {
    const left = Math.max(0, end - Date.now())
    const c = document.getElementById('clock')
    if (c) { c.textContent = `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}${T(' left', ' осталось')}`; c.classList.toggle('bad', left < 300000) }
    if (left <= 0) finish(true)
  }
  const finish = (timeout) => {
    clearInterval(examTimer); examTimer = null
    const right = qs.map((q, i) => ans[i] === q.a)
    const score = Math.round((right.filter(Boolean).length / qs.length) * 100)
    const pass = score >= EXAM.pass
    const secs = Math.round((Date.now() - t0) / 1000)
    store.data.exams.push({ date: Date.now(), score, pass, secs }); store.save()
    const perMod = MODULES.map((m) => { const idx = qs.map((q, i) => q.mod === m.id ? i : -1).filter((i) => i >= 0); return { m, n: idx.length, ok: idx.filter((i) => right[i]).length } }).filter((x) => x.n)
    store.data.examMods = Object.fromEntries(perMod.map((x) => [x.m.id, { ok: x.ok, n: x.n }])); store.save()
    el.innerHTML = `<h1>${T('Exam result', 'Результат экзамена')}</h1>
      <div class="card result-card ${pass ? 'pass' : 'fail'}"><div class="big-score">${score}%</div><div><b>${pass ? T('Passed', 'Сдан') : T('Not passed', 'Не сдан')}</b>${timeout ? T(' (time ran out)', ' (время вышло)') : ''}<br>${T(`${right.filter(Boolean).length} of ${qs.length} correct in ${Math.floor(secs / 60)} min ${secs % 60} s. Pass mark ${EXAM.pass}%.`, `Верно ${right.filter(Boolean).length} из ${qs.length} за ${Math.floor(secs / 60)} мин ${secs % 60} с. Проходной балл ${EXAM.pass}%.`)}</div></div>
      <h3>${T('By module', 'По модулям')}</h3><div class="permod">${perMod.map((x) => `<a href="#/module/${x.m.id}" class="pm"><span>${x.m.icon} ${esc(x.m.title)}</span><b class="${x.ok / x.n >= 0.6 ? 'good' : 'bad'}">${x.ok}/${x.n}</b></a>`).join('')}</div>
      <h3>${T('Review', 'Разбор')}</h3>
      ${qs.map((q, i) => `<div class="qcard ${right[i] ? 'ok' : 'no'}"><div class="qn">${i + 1}. ${esc(q.q)}</div>${q.o.map((o, k) => `<div class="opt ${k === q.a ? 'right' : ''} ${ans[i] === k && k !== q.a ? 'wrong' : ''}">${k === q.a ? '✓' : ans[i] === k ? '✗' : '·'} ${esc(o)}</div>`).join('')}<div class="explain">${esc(q.e)}</div></div>`).join('')}
      <div class="row"><a class="btn" href="#/exam">${T('Back to exam page', 'К странице экзамена')}</a></div>`
    window.scrollTo(0, 0)
  }
  el.onclick = (e) => {
    const d = e.target.dataset
    if (d.go !== undefined) { cur = Number(d.go); draw() }
    if (e.target.id === 'prev') { cur--; draw() }
    if (e.target.id === 'next') { if (cur < qs.length - 1) { cur++; draw() } else confirmSubmit() }
    if (e.target.id === 'flag') { flagged.has(cur) ? flagged.delete(cur) : flagged.add(cur); draw() }
    if (e.target.id === 'submit') confirmSubmit()
  }
  el.onchange = (e) => { if (e.target.name === 'x') { ans[cur] = Number(e.target.value); el.querySelectorAll('.qgrid button')[cur].classList.add('ans') } }
  const confirmSubmit = () => {
    const un = ans.filter((a) => a === null).length
    if (confirm(un ? T(`${un} question(s) unanswered. Submit anyway?`, `Без ответа вопросов: ${un}. Всё равно отправить?`) : T('Submit the exam?', 'Отправить экзамен?'))) finish(false)
  }
  clearInterval(examTimer)
  examTimer = setInterval(tick, 1000)
  draw()
}

function cheatPage() {
  return shell('cheat', `<h1>${T('Cheat sheet', 'Шпаргалка')}</h1><div class="cheat">
  <div class="card"><h3>${T('Default ports', 'Порты по умолчанию')}</h3><table><tbody>${[['FTP', '21'], ['SSH', '22'], ['Telnet', '23'], ['DNS', '53 udp/tcp'], ['DHCP', '67/68 udp'], ['HTTP / WebFig', '80'], ['NTP', '123 udp'], ['SNMP', '161 udp'], ['HTTPS', '443'], ['MNDP', '5678 udp'], ['PPTP', '1723 tcp + GRE (47)'], ['L2TP', '1701 udp'], ['IPsec', '500, 4500 udp + ESP'], ['SSTP', '443 tcp'], ['OpenVPN', '1194'], [T('Bandwidth test', 'Bandwidth test'), '2000 tcp'], ['API / API-SSL', '8728 / 8729'], ['Winbox', '8291']].map(([a, b]) => `<tr><td>${a}</td><td class="mono">${b}</td></tr>`).join('')}</tbody></table></div>
  <div class="card"><h3>${T('CLI keys', 'Клавиши CLI')}</h3><table><tbody>${[['Tab / Tab Tab', T('complete / list', 'дополнить / список')], ['? (v6) / F1 (v7)', T('help', 'справка')], ['Ctrl+X', 'Safe Mode'], ['Ctrl+C', T('interrupt', 'прервать')], ['Ctrl+D', T('logout', 'выход')], ['Ctrl+K', T('delete to end of line', 'удалить до конца строки')], ['Ctrl+L / F5', T('clear screen', 'очистить экран')], ['Ctrl+V', 'hotlock'], ['..  /  /', T('up one level / root', 'на уровень выше / в корень')]].map(([a, b]) => `<tr><td class="mono">${a}</td><td>${b}</td></tr>`).join('')}</tbody></table></div>
  <div class="card"><h3>${T('Licence levels', 'Уровни лицензий')}</h3><table><tbody>${[['L0', T('trial 24 h', 'пробная 24 ч')], ['L1', T('free demo', 'бесплатная демо')], ['L3', T('CPE: station only', 'CPE: только клиент')], ['L4', T('AP, 200 tunnels/hotspot', 'AP, 200 туннелей/hotspot')], ['L5', T('500 tunnels/hotspot', '500 туннелей/hotspot')], ['L6', T('unlimited', 'без ограничений')]].map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</tbody></table>
    <h3>${T('Route distance', 'Distance маршрутов')}</h3><table><tbody>${[['connected', '0'], ['static', '1'], ['eBGP', '20'], ['OSPF', '110'], ['RIP', '120'], ['iBGP', '200']].map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</tbody></table></div>
  <div class="card">${T(`<h3>Firewall in one look</h3><ul><li><b>input</b>: to the router, <b>forward</b>: through, <b>output</b>: from the router</li><li>first match wins, default is accept</li><li>accept established,related first, drop invalid</li><li>NAT: <b>srcnat</b> masquerade out WAN, <b>dstnat</b> dst-nat for port forwards</li><li>NAT rules see only the first packet of a connection</li><li>dstnat happens before filter forward</li></ul>
  <h3>Wireless</h3><ul><li>2.4 GHz non-overlapping: 1, 6, 11</li><li>ch = 2407 + 5·n MHz</li><li>access list = AP side, connect list = station side</li><li>default-forward=no isolates clients</li><li>WPA2-PSK + AES-CCM</li></ul>`, `<h3>Файрвол коротко</h3><ul><li><b>input</b>: на маршрутизатор, <b>forward</b>: через него, <b>output</b>: от маршрутизатора</li><li>побеждает первое совпадение, по умолчанию accept</li><li>первым accept established,related, затем drop invalid</li><li>NAT: <b>srcnat</b> masquerade на выход WAN, <b>dstnat</b> dst-nat для проброса портов</li><li>NAT видит только первый пакет соединения</li><li>dstnat выполняется до filter forward</li></ul>
  <h3>Беспроводные сети</h3><ul><li>неперекрывающиеся в 2,4 ГГц: 1, 6, 11</li><li>канал = 2407 + 5·n МГц</li><li>access list на стороне AP, connect list на стороне клиента</li><li>default-forward=no изолирует клиентов</li><li>WPA2-PSK + AES-CCM</li></ul>`)}</div>
  <div class="card">${T(`<h3>Queues</h3><ul><li>max-limit = upload/download of the target</li><li>first matching simple queue wins</li><li>priority 1 high … 8 low</li><li>burst allowed while average &lt; burst-threshold; burst length ≈ threshold × time / burst-limit</li><li>PCQ download = dst-address, upload = src-address</li></ul>
  <h3>Reset button</h3><ul><li>hold on power-up, release when LED flashes: config reset</li><li>until LED solid: CAPsMAN mode</li><li>until LED off (~15 s): Netinstall</li></ul>`, `<h3>Очереди</h3><ul><li>max-limit = upload/download цели</li><li>побеждает первая совпавшая simple queue</li><li>priority 1 высокий … 8 низкий</li><li>burst разрешён, пока среднее &lt; burst-threshold; длина burst ≈ threshold × time / burst-limit</li><li>PCQ download = dst-address, upload = src-address</li></ul>
  <h3>Кнопка reset</h3><ul><li>держать при включении, отпустить, когда мигает LED: сброс конфигурации</li><li>до постоянного свечения LED: режим CAPsMAN</li><li>до погасания LED (~15 с): Netinstall</li></ul>`)}</div>
  </div>`)
}

function notFound() { return shell('', `<h1>${T('Page not found', 'Страница не найдена')}</h1><p><a href="#/">${T('Back to the course', 'Вернуться к курсу')}</a></p>`) }

// ---------- router ----------
async function route() {
  if (examTimer && !location.hash.startsWith('#/exam')) { clearInterval(examTimer); examTimer = null }
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  let page
  if (!parts.length) page = await homePage()
  else if (parts[0] === 'module') page = await modulePage(parts[1], parts[2], parts[3])
  else if (parts[0] === 'labs') page = labsPage()
  else if (parts[0] === 'lab') page = labPage(parts[1])
  else if (parts[0] === 'terminal') page = terminalPage()
  else if (parts[0] === 'sims') page = simsPage()
  else if (parts[0] === 'sim') page = simPage(parts[1])
  else if (parts[0] === 'exam') page = await examPage()
  else if (parts[0] === 'troubleshoot') page = troublePage()
  else if (parts[0] === 'cheatsheet') page = cheatPage()
  else page = notFound()
  const { html, after } = typeof page === 'string' ? { html: page } : page
  root.innerHTML = html
  window.scrollTo(0, 0)
  after && after()
  bindCommon()
}

function bindCommon() {
  const th = document.getElementById('theme')
  if (th) th.onclick = () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
    store.data.theme = dark ? 'light' : 'dark'; store.save(); applyTheme()
  }
  const lg = document.getElementById('lang')
  if (lg) lg.onclick = () => { store.data.lang = LANG === 'ru' ? 'en' : 'ru'; store.save(); location.reload() }
  const mark = document.getElementById('mark')
  if (mark) mark.onclick = () => {
    const k = mark.dataset.k
    if (store.data.lessons[k]) delete store.data.lessons[k]; else store.data.lessons[k] = true
    store.save(); route()
  }
  const rp = document.getElementById('reset-progress')
  if (rp) rp.onclick = () => { if (confirm(T('Delete all progress, quiz scores and exam history in this browser?', 'Удалить весь прогресс, результаты тестов и историю экзаменов в этом браузере?'))) { store.data = { lessons: {}, quiz: {}, labs: {}, exams: [], theme: store.data.theme, lang: store.data.lang }; store.save(); route() } }
  bindCopy(root)
}

window.addEventListener('hashchange', route)
route()
