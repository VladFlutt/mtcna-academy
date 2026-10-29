// RouterOS v7 routing filters (/routing filter rule). Each rule is a small program such as
//   if (dst in 192.168.0.0/16 && dst-len in 16-32) { reject }
//   if (protocol connected) { set ospf-ext-type type1; set ospf-ext-metric 20; accept }
// This module parses that syntax and runs a chain against a route. A chain that ends without
// accept or reject rejects the route, so a filter chain normally ends with an explicit accept.

import { parseCidr, inSubnet } from './net.js'

const SYM = ['==', '!=', '<=', '>=', '&&', '||', '(', ')', '{', '}', ';', '<', '>', '!']

function tokenize(src) {
  const out = []
  let i = 0
  src = String(src)
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) { i++; continue }
    const sym = SYM.find((s) => src.startsWith(s, i))
    if (sym) { out.push(sym); i += sym.length; continue }
    let j = i
    while (j < src.length && !/\s/.test(src[j]) && !SYM.some((s) => src.startsWith(s, j))) j++
    out.push(src.slice(i, j))
    i = j
  }
  return out
}

const PROPS = ['distance', 'ospf-ext-type', 'ospf-ext-metric', 'ospf-ext-tag', 'gw', 'pref-src', 'scope', 'target-scope', 'comment']

function parse(src) {
  const t = tokenize(src)
  let p = 0
  const peek = () => t[p]
  const next = () => t[p++]
  const want = (x) => { if (t[p] !== x) throw new Error(`expected "${x}"${t[p] ? ' near "' + t[p] + '"' : ' at the end'}`); p++ }
  function stmts(stop) {
    const list = []
    while (p < t.length && peek() !== stop) {
      if (peek() === ';') { p++; continue }
      list.push(stmt())
    }
    return list
  }
  function block() { want('{'); const b = stmts('}'); want('}'); return b }
  function stmt() {
    const w = next()
    if (w === 'if') {
      want('(')
      const cond = expr()
      want(')')
      const then = block()
      let other = []
      if (peek() === 'else') { p++; other = peek() === 'if' ? [stmt()] : block() }
      return { k: 'if', cond, then, other }
    }
    if (w === 'accept' || w === 'reject' || w === 'return') return { k: w }
    if (w === 'jump') { const c = next(); if (!c || SYM.includes(c)) throw new Error('jump needs a chain name'); return { k: 'jump', chain: c } }
    if (w === 'set') {
      const prop = next(); const val = next()
      if (!PROPS.includes(prop)) throw new Error(`unknown property "${prop}"`)
      if (val === undefined || SYM.includes(val)) throw new Error(`set ${prop} needs a value`)
      return { k: 'set', prop, val }
    }
    throw new Error(`unexpected "${w}"`)
  }
  function expr() {
    let a = and()
    while (peek() === '||') { p++; const b = and(); const x = a; a = { k: 'or', a: x, b } }
    return a
  }
  function and() {
    let a = not()
    while (peek() === '&&') { p++; const b = not(); const x = a; a = { k: 'and', a: x, b } }
    return a
  }
  function not() {
    if (peek() === '!') { p++; return { k: 'not', a: not() } }
    if (peek() === '(') { p++; const e = expr(); want(')'); return e }
    return cmp()
  }
  function cmp() {
    const prop = next()
    if (prop === 'dst' || prop === 'gw') {
      const op = next()
      const v = next()
      if (!['==', '!=', 'in'].includes(op)) throw new Error(`use ==, != or in after ${prop}`)
      if (!parseCidr(v)) throw new Error(`"${v}" is not an address or prefix`)
      return { k: 'cmp', prop, op, v }
    }
    if (prop === 'dst-len' || prop === 'distance' || prop === 'ospf-ext-metric') {
      const op = next()
      const v = next()
      if (op === 'in') {
        if (!/^\d+-\d+$/.test(v || '')) throw new Error(`${prop} in needs a range such as 16-32`)
        return { k: 'cmp', prop, op, v }
      }
      if (!['==', '!=', '<', '>', '<=', '>='].includes(op) || !/^\d+$/.test(v || '')) throw new Error(`compare ${prop} with a number, e.g. ${prop}>24`)
      return { k: 'cmp', prop, op, v: Number(v) }
    }
    if (prop === 'protocol') {
      const v = next()
      if (!v || SYM.includes(v)) throw new Error('protocol needs a name: connected, static, ospf')
      return { k: 'proto', v }
    }
    throw new Error(`unknown matcher "${prop}" (use dst, dst-len, protocol, gw, distance)`)
  }
  const prog = stmts(undefined)
  if (p < t.length) throw new Error(`unexpected "${t[p]}"`)
  return prog
}

export function checkFilterRule(src) {
  try { parse(src); return '' } catch (e) { return e.message }
}

function test(c, r) {
  if (c.k === 'or') return test(c.a, r) || test(c.b, r)
  if (c.k === 'and') return test(c.a, r) && test(c.b, r)
  if (c.k === 'not') return !test(c.a, r)
  if (c.k === 'proto') return (r.proto || '') === c.v
  const cur = { dst: r.dst, gw: r.gw, 'dst-len': parseCidr(r.dst).prefix, distance: r.distance, 'ospf-ext-metric': r.metric }[c.prop]
  if (c.prop === 'dst' || c.prop === 'gw') {
    if (cur === undefined || cur === null) return c.op === '!='
    if (c.op === 'in') { const a = parseCidr(cur), b = parseCidr(c.v); return !!a && a.prefix >= b.prefix && inSubnet(a.net, b) }
    const a = parseCidr(cur), b = parseCidr(c.v)
    const eq = !!a && a.net === b.net && a.prefix === b.prefix
    return c.op === '==' ? eq : !eq
  }
  if (c.op === 'in') { const [lo, hi] = c.v.split('-').map(Number); return cur >= lo && cur <= hi }
  return { '==': cur === c.v, '!=': cur !== c.v, '<': cur < c.v, '>': cur > c.v, '<=': cur <= c.v, '>=': cur >= c.v }[c.op]
}

// Run chain `chain` from the /routing filter rule list on route r ({ dst, proto, distance, gw, metric }).
// Returns { verdict: 'accept' | 'reject', set: { prop: value }, rule } where rule is the deciding rule.
export function runFilter(rules, chain, r, depth = 0) {
  const set = {}
  const list = rules.filter((x) => x.chain === chain && x.disabled !== 'yes')
  if (depth > 8) return { verdict: 'reject', set }
  let decided = null
  const exec = (stmts, rule) => {
    for (const s of stmts) {
      if (decided) return
      if (s.k === 'if') exec(test(s.cond, { ...r, ...set }) ? s.then : s.other, rule)
      else if (s.k === 'accept' || s.k === 'reject') decided = { verdict: s.k, rule }
      else if (s.k === 'return') { decided = { verdict: 'return', rule }; return }
      else if (s.k === 'set') set[s.prop] = s.val
      else if (s.k === 'jump') {
        const sub = runFilter(rules, s.chain, { ...r, ...set }, depth + 1)
        Object.assign(set, sub.set)
        if (sub.verdict !== 'return' && sub.verdict !== 'end') decided = { verdict: sub.verdict, rule: sub.rule }
      }
    }
  }
  for (const rule of list) {
    let prog
    try { prog = parse(rule.rule) } catch { continue }
    exec(prog, rule)
    if (decided) break
  }
  if (decided && decided.verdict === 'return') return { verdict: depth ? 'return' : 'reject', set, rule: decided.rule }
  if (decided) return { ...decided, set }
  return { verdict: depth ? 'end' : 'reject', set }
}
