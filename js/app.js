import { MODULES, EXAM } from './data.js'
import { renderMarkdown, splitLessons } from './md.js'
import { SIMS } from './sims.js'
import { LABS, makeLabState, labProgress } from './labs.js'
import { RouterOS, defaultConfig, laptopState, laptopInternet, routerInternet } from './routeros.js'

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
    const r = await fetch('/content/' + mod.file)
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
  const nav = [['#/', 'Course', 'home'], ['#/labs', 'Labs', 'labs'], ['#/terminal', 'Terminal', 'terminal'], ['#/sims', 'Simulators', 'sims'], ['#/exam', 'Final exam', 'exam'], ['#/cheatsheet', 'Cheat sheet', 'cheat']]
  return `
  <header class="top">
    <a href="#/" class="brand"><span class="logo">M</span><span>MTCNA <b>Academy</b></span></a>
    <nav>${nav.map(([h, t, k]) => `<a href="${h}" class="${active === k ? 'on' : ''}">${t}</a>`).join('')}</nav>
    <button class="theme" id="theme" title="Toggle dark mode" aria-label="Toggle dark mode">◐</button>
  </header>
  <main class="wrap">${inner}</main>
  <footer class="foot">Independent study platform for the MikroTik Certified Network Associate (MTCNA) course. Based on the course slides and the official documentation at help.mikrotik.com. Not affiliated with or endorsed by MikroTik. Progress is stored in this browser only.</footer>`
}

// ---------- pages ----------
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
      <div class="meta"><span>${counts[i]} lessons</span><span>${m.quiz.length} questions</span>${m.labs.length ? `<span>${m.labs.length} lab${m.labs.length > 1 ? 's' : ''}</span>` : ''}</div>
      <div class="prog"><div style="width:${p}%"></div></div>
    </a>`
  }).join('')
  return shell('home', `
  <section class="hero">
    <div>
      <h1>Learn MTCNA by doing</h1>
      <p>Ten modules that follow the official MikroTik Certified Network Associate outline: theory from the course slides and help.mikrotik.com, a RouterOS terminal with guided labs, network simulators, a quiz for every module, and a timed final exam.</p>
      <div class="row wrap"><a class="btn" href="#/module/intro">Start module 1</a><a class="btn ghost" href="#/terminal">Open the terminal</a></div>
    </div>
    <div class="stats">
      <div><b>${doneLessons}/${totalLessons}</b><span>lessons read</span></div>
      <div><b>${labsDone}/${LABS.length}</b><span>labs passed</span></div>
      <div><b>${bestExam ? bestExam + '%' : '–'}</b><span>best exam</span></div>
    </div>
  </section>
  <h2 class="sec">Modules</h2>
  <div class="mods">${cards}</div>
  <section class="card how">
    <h2>How to use it</h2>
    <ol>
      <li><b>Read</b> each lesson and mark it done. Commands in grey boxes can be copied straight into the terminal.</li>
      <li><b>Practise</b> in the module lab: the checklist turns green as your configuration works, including whether the student laptop gets Internet.</li>
      <li><b>Test yourself</b> with the module quiz. 80% or more counts as passed.</li>
      <li><b>Take the final exam</b>: ${EXAM.questions} random questions, ${EXAM.minutes} minutes, ${EXAM.pass}% to pass, like the real MTCNA test.</li>
    </ol>
    <p class="muted">Want a clean start? <button class="link" id="reset-progress">Reset all progress</button></p>
  </section>`)
}

async function modulePage(id, tab, idx) {
  const mod = MODULES.find((m) => m.id === id)
  if (!mod) return notFound()
  let ls = []
  try { ls = await lessons(mod) } catch { ls = [{ title: 'Could not load', body: 'Lesson content failed to load. Check your connection and reload.' }] }
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
    body = `<article class="lesson"><div class="crumb">Module ${mod.num} · Lesson ${idx + 1} of ${ls.length}</div><h1>${esc(l.title)}</h1>${renderMarkdown(l.body)}</article>
      <div class="lesson-nav">
        ${idx > 0 ? `<a class="btn ghost" href="#/module/${id}/lesson/${idx - 1}">← Previous</a>` : '<span></span>'}
        <button class="btn ${done ? 'ghost' : ''}" id="mark" data-k="${id}:${idx}">${done ? '✓ Done' : 'Mark as done'}</button>
        ${idx < ls.length - 1 ? `<a class="btn ghost" href="#/module/${id}/lesson/${idx + 1}">Next →</a>` : `<a class="btn ghost" href="#/module/${id}/quiz">Take the quiz →</a>`}
      </div>`
  } else if (tab === 'quiz') {
    body = `<div id="quiz"></div>`
  }
  const html = shell('home', `
  <div class="module">
    <aside class="side">
      <div class="side-head"><span class="ico">${mod.icon}</span><div><small>Module ${mod.num}</small><b>${esc(mod.title)}</b></div></div>
      <div class="src">Source: ${mod.source === 'slides' ? 'course slides' : 'course slides + MikroTik docs'}</div>
      <h4>Lessons</h4><nav>${side}</nav>
      ${labLinks ? `<h4>Labs</h4><nav>${labLinks}</nav>` : ''}
      ${simLinks ? `<h4>Simulators</h4><nav>${simLinks}</nav>` : ''}
      <h4>Check</h4><nav><a href="#/module/${id}/quiz" class="${tab === 'quiz' ? 'on' : ''}">📝 Module quiz ${q !== undefined ? `<span class="score ${q >= 80 ? 'good' : ''}">${q}%</span>` : ''}</a></nav>
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
    el.innerHTML = `<h1>Quiz: ${esc(mod.title)}</h1><p class="muted">${qs.length} questions. Choose one answer for each, then check. Questions and options are shuffled every time.</p>
      ${qs.map((q, i) => `<div class="qcard ${submitted ? (answers[i] === q.a ? 'ok' : 'no') : ''}">
        <div class="qn">${i + 1}. ${esc(q.q)}</div>
        ${q.o.map((o, k) => `<label class="opt ${submitted && k === q.a ? 'right' : ''} ${submitted && answers[i] === k && k !== q.a ? 'wrong' : ''}"><input type="radio" name="q${i}" value="${k}" ${answers[i] === k ? 'checked' : ''} ${submitted ? 'disabled' : ''}> ${esc(o)}</label>`).join('')}
        ${submitted ? `<div class="explain">${answers[i] === q.a ? '✓' : '✗'} ${esc(q.e)}</div>` : ''}
      </div>`).join('')}
      <div class="row">${submitted ? `<div class="result big ${score >= 80 ? 'good' : 'bad'}">Score ${score}% ${score >= 80 ? '· passed' : '· 80% needed'}</div><button class="btn" id="again">Try again</button>` : `<button class="btn" id="check">Check answers</button><span class="muted" id="left"></span>`}</div>`
    if (submitted) {
      store.data.quiz[mod.id] = Math.max(store.data.quiz[mod.id] || 0, score); store.save()
      el.querySelector('#again').onclick = () => runQuiz(el, mod)
      el.scrollIntoView({ behavior: 'smooth' })
    } else {
      el.querySelector('#check').onclick = () => {
        const missing = answers.filter((a) => a === null).length
        if (missing && !confirm(`${missing} question(s) unanswered. Check anyway?`)) return
        draw(true)
      }
    }
  }
  el.addEventListener('change', (e) => { if (e.target.name) answers[Number(e.target.name.slice(1))] = Number(e.target.value) })
  draw(false)
}

// ---------- terminal widget ----------
function mountTerminal(el, ros, onChange) {
  el.innerHTML = `<div class="term" tabindex="-1"><div class="term-bar"><span></span><span></span><span></span><b>RouterOS terminal (simulated)</b></div><pre class="term-out" aria-live="polite"></pre><div class="term-in"><span class="prompt"></span><input spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="RouterOS command"></div></div>`
  const out = el.querySelector('.term-out'), input = el.querySelector('input'), prompt = el.querySelector('.prompt')
  let hpos = -1, lastTab = 0
  const write = (t, cls = '') => { const s = document.createElement('span'); if (cls) s.className = cls; s.textContent = t + '\n'; out.appendChild(s); out.scrollTop = out.scrollHeight }
  const banner = () => {
    write(`  MMM      MMM       KKK                          TTTTTTTTTTT      KKK\n  MMMM    MMMM       KKK                          TTTTTTTTTTT      KKK\n  MMM MMMM MMM  III  KKK  KKK  RRRRRR     OOOOOO      TTT     III  KKK  KKK\n  MMM  MM  MMM  III  KKKKK     RRR  RRR  OOO  OOO     TTT     III  KKKKK\n  MMM      MMM  III  KKK KKK   RRRRRR    OOO  OOO     TTT     III  KKK KKK\n  MMM      MMM  III  KKK  KKK  RRR  RRR   OOOOOO      TTT     III  KKK  KKK\n\n  MikroTik RouterOS 7.16.2 (simulator)   https://help.mikrotik.com/docs\n\nPress Tab to complete, type /help for the list of simulated menus.`, 'dim')
    const note = ros.st.singletons['system note']
    if (note.note && note['show-at-login'] === 'yes') write(note.note, 'warn')
  }
  const setPrompt = () => { prompt.textContent = ros.prompt() }
  ros.onReset = () => { out.textContent = ''; banner(); setPrompt(); onChange && onChange() }
  banner(); setPrompt()
  const runLine = (line) => {
    write(ros.prompt() + line, 'cmd')
    const res = ros.exec(line)
    if (res) write(res, /^(bad command|expected end|failure|input does not|invalid value|no such)/.test(res) ? 'err' : '')
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
  return { runLine, focus: () => input.focus(), write }
}

function laptopPanel(st) {
  const L = laptopState(st)
  const inet = laptopInternet(st)
  return `<div class="laptop"><h4>💻 Laptop on ${esc(L.port)} ${L.mode === 'dhcp' ? '(DHCP)' : '(static)'}</h4>
    <div class="kv sm"><div><span>IP</span><b>${esc(L.ip || '–')}</b></div><div><span>Gateway</span><b>${esc(L.gw || '–')}</b></div><div><span>DNS</span><b>${esc(L.dns || '–')}</b></div>
    <div><span>Router online</span><b class="${routerInternet(st) ? 'good' : 'bad'}">${routerInternet(st) ? 'yes' : 'no'}</b></div>
    <div><span>Laptop Internet</span><b class="${inet.ok ? 'good' : 'bad'}">${inet.ok ? 'yes' : 'no'}</b></div></div>
    ${!inet.ok ? `<p class="why">Why: ${esc(inet.reason || L.why || '')}</p>` : ''}</div>`
}

function terminalPage() {
  const html = shell('terminal', `
  <div class="lab">
    <section class="lab-main"><div id="term"></div></section>
    <aside class="lab-side card">
      <h3>Free practice</h3>
      <p class="muted">A hAP-style router with the MikroTik <b>default configuration</b>. ether1 is cabled to the ISP (DHCP, PPPoE user class/class, gateway 22.1.1.1), ether2 to a laptop.</p>
      <div id="lp"></div>
      <h4>Try</h4>
      <div class="tries">${['/interface print', '/ip address print', '/ip route print', '/ip firewall filter print', '/ping mikrotik.com count=3', '/system reset-configuration no-defaults=yes', '/export'].map((c) => `<button class="chip mono" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      <button class="btn ghost" id="t-reset">Reset to default config</button>
    </aside>
  </div>`)
  return { html, after: () => {
    let ros = new RouterOS(defaultConfig())
    const upd = () => { document.getElementById('lp').innerHTML = laptopPanel(ros.st) }
    let t = mountTerminal(document.getElementById('term'), ros, upd)
    upd(); t.focus()
    document.querySelector('.tries').onclick = (e) => { if (e.target.dataset.c) { t.runLine(e.target.dataset.c); t.focus() } }
    document.getElementById('t-reset').onclick = () => { ros = new RouterOS(defaultConfig()); t = mountTerminal(document.getElementById('term'), ros, upd); upd(); t.focus() }
  } }
}

function labsPage() {
  const byMod = MODULES.filter((m) => m.labs.length).map((m) => `<div class="lab-group"><h3>${m.icon} Module ${m.num}: ${esc(m.title)}</h3>
    ${m.labs.map((id) => LABS.find((l) => l.id === id)).map((l) => `<a class="lab-card" href="#/lab/${l.id}"><b>${store.data.labs[l.id] ? '✅' : '🧪'} ${esc(l.title)}</b><span>${esc(l.intro)}</span><em>${l.tasks.length} tasks · starts from ${{ default: 'default config', empty: 'empty config', bridged: 'bridgeLAN ready', online: 'router online', onlineDhcp: 'router online with DHCP', dhcpWan: 'DHCP WAN' }[l.start]}</em></a>`).join('')}</div>`).join('')
  return shell('labs', `<h1>Guided labs</h1><p class="lead">Each lab gives you a simulated router in a known state. Type real RouterOS commands; the task list checks your configuration live. The topology follows the course: WAN ether1 to the ISP 22.1.1.0/24 (gateway and DNS 22.1.1.1), LAN bridgeLAN 192.168.33.0/24, laptop on ether2.</p>
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
  <div class="crumb"><a href="#/labs">Labs</a> · <a href="#/module/${mod.id}">Module ${mod.num}</a></div>
  <h1>${esc(lab.title)}</h1><p class="lead">${esc(lab.intro)}</p>
  <div class="lab">
    <section class="lab-main"><div id="term"></div></section>
    <aside class="lab-side card">
      <h3>Tasks <span id="lab-count" class="score"></span></h3>
      <ol class="tasks" id="tasks"></ol>
      <div id="lp"></div>
      <div class="row wrap"><button class="btn ghost" id="l-reset">Restart lab</button><button class="btn ghost" id="l-sol">Show all hints</button></div>
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
      document.getElementById('tasks').innerHTML = lab.tasks.map((t, i) => `<li class="${pr[i] ? 'done' : ''}"><span class="tick">${pr[i] ? '✓' : i + 1}</span><div>${esc(t.t)}<button class="link hint" data-h="${i}">${open.has(i) ? 'hide hint' : 'hint'}</button>${open.has(i) ? `<pre class="code sm"><code>${esc(t.h)}</code></pre>` : ''}</div></li>`).join('')
      document.getElementById('lp').innerHTML = laptopPanel(ros.st)
      if (n === pr.length && !store.data.labs[lab.id]) { store.data.labs[lab.id] = true; store.save(); t.write('\n*** Lab complete! All tasks pass. ***\n', 'good') }
    }
    let t = mountTerminal(document.getElementById('term'), ros, upd)
    upd(); t.focus()
    document.getElementById('tasks').onclick = (e) => { const h = e.target.dataset.h; if (h !== undefined) { open.has(+h) ? open.delete(+h) : open.add(+h); upd() } }
    document.getElementById('l-sol').onclick = () => { lab.tasks.forEach((_, i) => open.add(i)); upd() }
    document.getElementById('l-reset').onclick = () => { ros = new RouterOS(makeLabState(lab)); t = mountTerminal(document.getElementById('term'), ros, upd); upd(); t.focus() }
  } }
}

function simsPage() {
  return shell('sims', `<h1>Simulators</h1><p class="lead">Small interactive tools for the ideas that are easier to see than to read.</p>
  <div class="mods">${SIMS.map((s) => `<a class="mod" href="#/sim/${s.id}"><div class="mod-top"><span class="ico">${s.icon}</span></div><h3>${esc(s.title)}</h3><p>${esc(s.desc)}</p></a>`).join('')}</div>`)
}

function simPage(id) {
  const s = SIMS.find((x) => x.id === id)
  if (!s) return notFound()
  return { html: shell('sims', `<div class="crumb"><a href="#/sims">Simulators</a></div><h1>${s.icon} ${esc(s.title)}</h1><p class="lead">${esc(s.desc)}</p><div id="sim"></div>`), after: () => s.render(document.getElementById('sim')) }
}

// ---------- exam ----------
let examTimer = null
function examPage() {
  const hist = store.data.exams.slice(-5).reverse()
  const html = shell('exam', `<div id="exam"><h1>Final exam</h1>
    <div class="card exam-intro">
      <p>The real MTCNA exam is an online test in English: <b>${EXAM.questions} questions</b>, <b>${EXAM.minutes} minutes</b>, pass mark <b>${EXAM.pass}%</b>. This practice exam draws ${EXAM.questions} random questions from all ${MODULES.reduce((a, m) => a + m.quiz.length, 0)} questions in the course, at least two from every module.</p>
      <ul><li>You can move between questions and change answers until you submit.</li><li>The exam submits itself when time runs out.</li><li>After submitting you see every answer with an explanation and a score per module.</li></ul>
      <button class="btn" id="start">Start the exam</button>
    </div>
    ${hist.length ? `<h3>Previous attempts</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Score</th><th>Result</th><th>Time</th></tr></thead><tbody>${hist.map((h) => `<tr><td>${new Date(h.date).toLocaleString()}</td><td>${h.score}%</td><td class="${h.pass ? 'good' : 'bad'}">${h.pass ? 'Passed' : 'Failed'}</td><td>${Math.round(h.secs / 60)} min</td></tr>`).join('')}</tbody></table></div>` : ''}
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
    el.innerHTML = `<div class="exam-bar"><b>Question ${cur + 1} / ${qs.length}</b><span id="clock" class="clock"></span><button class="btn ghost sm" id="submit">Submit exam</button></div>
      <div class="qgrid">${qs.map((_, i) => `<button class="${i === cur ? 'cur' : ''} ${ans[i] !== null ? 'ans' : ''} ${flagged.has(i) ? 'flag' : ''}" data-go="${i}">${i + 1}</button>`).join('')}</div>
      <div class="qcard big"><div class="qn">${esc(q.q)}</div>
        ${q.o.map((o, k) => `<label class="opt"><input type="radio" name="x" value="${k}" ${ans[cur] === k ? 'checked' : ''}> ${esc(o)}</label>`).join('')}</div>
      <div class="row"><button class="btn ghost" id="prev" ${cur === 0 ? 'disabled' : ''}>← Previous</button><button class="btn ghost" id="flag">${flagged.has(cur) ? 'Unflag' : 'Flag for review'}</button><button class="btn" id="next">${cur === qs.length - 1 ? 'Review' : 'Next →'}</button></div>`
    tick()
  }
  const tick = () => {
    const left = Math.max(0, end - Date.now())
    const c = document.getElementById('clock')
    if (c) { c.textContent = `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')} left`; c.classList.toggle('bad', left < 300000) }
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
    el.innerHTML = `<h1>Exam result</h1>
      <div class="card result-card ${pass ? 'pass' : 'fail'}"><div class="big-score">${score}%</div><div><b>${pass ? 'Passed' : 'Not passed'}</b>${timeout ? ' (time ran out)' : ''}<br>${right.filter(Boolean).length} of ${qs.length} correct in ${Math.floor(secs / 60)} min ${secs % 60} s. Pass mark ${EXAM.pass}%.</div></div>
      <h3>By module</h3><div class="permod">${perMod.map((x) => `<a href="#/module/${x.m.id}" class="pm"><span>${x.m.icon} ${esc(x.m.title)}</span><b class="${x.ok / x.n >= 0.6 ? 'good' : 'bad'}">${x.ok}/${x.n}</b></a>`).join('')}</div>
      <h3>Review</h3>
      ${qs.map((q, i) => `<div class="qcard ${right[i] ? 'ok' : 'no'}"><div class="qn">${i + 1}. ${esc(q.q)}</div>${q.o.map((o, k) => `<div class="opt ${k === q.a ? 'right' : ''} ${ans[i] === k && k !== q.a ? 'wrong' : ''}">${k === q.a ? '✓' : ans[i] === k ? '✗' : '·'} ${esc(o)}</div>`).join('')}<div class="explain">${esc(q.e)}</div></div>`).join('')}
      <div class="row"><a class="btn" href="#/exam">Back to exam page</a></div>`
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
    if (confirm(un ? `${un} question(s) unanswered. Submit anyway?` : 'Submit the exam?')) finish(false)
  }
  clearInterval(examTimer)
  examTimer = setInterval(tick, 1000)
  draw()
}

function cheatPage() {
  return shell('cheat', `<h1>Cheat sheet</h1><div class="cheat">
  <div class="card"><h3>Default ports</h3><table><tbody>${[['FTP', '21'], ['SSH', '22'], ['Telnet', '23'], ['DNS', '53 udp/tcp'], ['DHCP', '67/68 udp'], ['HTTP / WebFig', '80'], ['NTP', '123 udp'], ['SNMP', '161 udp'], ['HTTPS', '443'], ['MNDP', '5678 udp'], ['PPTP', '1723 tcp + GRE (47)'], ['L2TP', '1701 udp'], ['IPsec', '500, 4500 udp + ESP'], ['SSTP', '443 tcp'], ['OpenVPN', '1194'], ['Bandwidth test', '2000 tcp'], ['API / API-SSL', '8728 / 8729'], ['Winbox', '8291']].map(([a, b]) => `<tr><td>${a}</td><td class="mono">${b}</td></tr>`).join('')}</tbody></table></div>
  <div class="card"><h3>CLI keys</h3><table><tbody>${[['Tab / Tab Tab', 'complete / list'], ['? (v6) / F1 (v7)', 'help'], ['Ctrl+X', 'Safe Mode'], ['Ctrl+C', 'interrupt'], ['Ctrl+D', 'logout'], ['Ctrl+K', 'delete to end of line'], ['Ctrl+L / F5', 'clear screen'], ['Ctrl+V', 'hotlock'], ['..  /  /', 'up one level / root']].map(([a, b]) => `<tr><td class="mono">${a}</td><td>${b}</td></tr>`).join('')}</tbody></table></div>
  <div class="card"><h3>Licence levels</h3><table><tbody>${[['L0', 'trial 24 h'], ['L1', 'free demo'], ['L3', 'CPE: station only'], ['L4', 'AP, 200 tunnels/hotspot'], ['L5', '500 tunnels/hotspot'], ['L6', 'unlimited']].map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</tbody></table>
    <h3>Route distance</h3><table><tbody>${[['connected', '0'], ['static', '1'], ['eBGP', '20'], ['OSPF', '110'], ['RIP', '120'], ['iBGP', '200']].map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</tbody></table></div>
  <div class="card"><h3>Firewall in one look</h3><ul><li><b>input</b>: to the router, <b>forward</b>: through, <b>output</b>: from the router</li><li>first match wins, default is accept</li><li>accept established,related first, drop invalid</li><li>NAT: <b>srcnat</b> masquerade out WAN, <b>dstnat</b> dst-nat for port forwards</li><li>NAT rules see only the first packet of a connection</li><li>dstnat happens before filter forward</li></ul>
  <h3>Wireless</h3><ul><li>2.4 GHz non-overlapping: 1, 6, 11</li><li>ch = 2407 + 5·n MHz</li><li>access list = AP side, connect list = station side</li><li>default-forward=no isolates clients</li><li>WPA2-PSK + AES-CCM</li></ul></div>
  <div class="card"><h3>Queues</h3><ul><li>max-limit = upload/download of the target</li><li>first matching simple queue wins</li><li>priority 1 high … 8 low</li><li>burst allowed while average &lt; burst-threshold; burst length ≈ threshold × time / burst-limit</li><li>PCQ download = dst-address, upload = src-address</li></ul>
  <h3>Reset button</h3><ul><li>hold on power-up, release when LED flashes: config reset</li><li>until LED solid: CAPsMAN mode</li><li>until LED off (~15 s): Netinstall</li></ul></div>
  </div>`)
}

function notFound() { return shell('', '<h1>Page not found</h1><p><a href="#/">Back to the course</a></p>') }

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
  else if (parts[0] === 'exam') page = examPage()
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
  const mark = document.getElementById('mark')
  if (mark) mark.onclick = () => {
    const k = mark.dataset.k
    if (store.data.lessons[k]) delete store.data.lessons[k]; else store.data.lessons[k] = true
    store.save(); route()
  }
  const rp = document.getElementById('reset-progress')
  if (rp) rp.onclick = () => { if (confirm('Delete all progress, quiz scores and exam history in this browser?')) { store.data = { lessons: {}, quiz: {}, labs: {}, exams: [], theme: store.data.theme }; store.save(); route() } }
  root.querySelectorAll('pre.code .copy').forEach((b) => b.onclick = () => {
    const txt = b.parentElement.querySelector('code').textContent
    navigator.clipboard && navigator.clipboard.writeText(txt).then(() => { b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Copy', 1200) }).catch(() => {})
  })
}

window.addEventListener('hashchange', route)
route()
