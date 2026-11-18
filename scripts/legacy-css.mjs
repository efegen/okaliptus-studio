/**
 * Eski tarayıcılar için ayrı CSS (yalnız build).
 *
 * Panelin renk paleti oklch() ve color-mix() ile yazılı. Safari oklch'yi
 * iOS 15.4'te, color-mix'i iOS 16.2'de öğrendi (Chrome 111, Firefox 113).
 * Daha eski tarayıcı bu değerleri tanımayınca renkler boşa düşüyor: zemin
 * beyaz kalıyor, butonlar iOS'un varsayılan mavisine dönüyor.
 *
 * Bu eklenti build sonunda sayfaların bağladığı her CSS dosyasının yanına
 * bir `.legacy-<hash>.css` kopyası üretir:
 *   - her oklch()/oklab()/color-mix() build sırasında hesaplanıp #hex ya da
 *     rgba() olarak yazılır,
 *   - değişken kullanan karışımlar (color-mix(in oklch, var(--accent) 20%, …))
 *     `var(--legacy-mix-N)` olur; bu değişkenin değeri :root'ta ve o
 *     değişkenleri yeniden tanımlayan her kuralda (ör. .palette-terracotta, .fax) ayrı hesaplanır,
 *     böylece değişkenler tarayıcıdaki gibi kalıtılır,
 *   - dvh/svh/lvh → vh, monospace yedeği Courier yerine Menlo.
 *
 * index.html'e eklenen küçük kontrol yalnız oklch ya da color-mix'i
 * tanımayan tarayıcıda stil bağlantısını bu kopyaya çevirir. Yeni
 * tarayıcılarda hiçbir şey değişmez: ana CSS aynı, kopya hiç indirilmez
 * (PWA ön belleğinin dışında, bkz. vite.config.js globIgnores).
 */
import { createHash } from 'node:crypto'
import postcss from 'postcss'

export class Unresolvable extends Error {}

// ---------------------------------------------------------------------------
// Metin yardımcıları
// ---------------------------------------------------------------------------

function matchParen(str, open) {
  let depth = 0
  for (let i = open; i < str.length; i++) {
    const ch = str[i]
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function splitTopLevel(str, sep, limit = Infinity) {
  const out = []
  let depth = 0
  let start = 0
  for (let i = 0; i < str.length && out.length < limit - 1; i++) {
    const ch = str[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === sep && depth === 0) {
      out.push(str.slice(start, i))
      start = i + 1
    }
  }
  out.push(str.slice(start))
  return out.map((s) => s.trim())
}

function splitSpaces(str) {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of str) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur) out.push(cur)
  return out
}

const COLOR_CALL = /(?<![\w-])(oklch|oklab|color-mix)\(/gi
const HAS_COLOR_CALL = /(?<![\w-])(oklch|oklab|color-mix)\(/i
const HAS_VAR = /(?<![\w-])var\(/i

/** Değerdeki en dıştaki renk fonksiyonu çağrılarını `fn(call)` ile değiştirir. */
export function replaceColorCalls(value, fn) {
  let out = ''
  let last = 0
  const re = new RegExp(COLOR_CALL.source, 'gi')
  let m
  while ((m = re.exec(value))) {
    const open = m.index + m[0].length - 1
    const close = matchParen(value, open)
    if (close < 0) break
    out += value.slice(last, m.index) + fn(value.slice(m.index, close + 1))
    last = close + 1
    re.lastIndex = close + 1
  }
  return out + value.slice(last)
}

/** Değerin doğrudan başvurduğu değişken adları (yedek değerler dahil). */
export function varNames(value) {
  return new Set([...value.matchAll(/(?<![\w-])var\(\s*(--[\w-]+)/gi)].map((m) => m[1]))
}

/** var(--x[, yedek]) başvurularını `lookup` ile özyinelemeli çözer. */
export function substituteVars(text, lookup, depth = 0) {
  if (depth > 20) throw new Unresolvable('var döngüsü')
  let out = ''
  let last = 0
  const re = /(?<![\w-])var\(/gi
  let m
  while ((m = re.exec(text))) {
    const open = m.index + m[0].length - 1
    const close = matchParen(text, open)
    if (close < 0) throw new Unresolvable(`kapanmayan var(): ${text}`)
    const [name, fallback] = splitTopLevel(text.slice(open + 1, close), ',', 2)
    let value = lookup(name)
    if (value === undefined) {
      if (fallback === undefined) throw new Unresolvable(`${name} tanımsız`)
      value = fallback
    }
    out += text.slice(last, m.index) + substituteVars(value, lookup, depth + 1)
    last = close + 1
    re.lastIndex = close + 1
  }
  return out + text.slice(last)
}

// ---------------------------------------------------------------------------
// calc() — yalnız sayı (ve tek tip %) içeren ifadeler
// ---------------------------------------------------------------------------

function evalCalc(token) {
  const src = token.replace(/^calc\(/i, '(').replace(/calc\(/gi, '(')
  let usesPct = false
  const tokens = []
  const re = /\s*(?:([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%)?|([()*/+-]))/gy
  let m
  let pos = 0
  while (pos < src.length) {
    re.lastIndex = pos
    m = re.exec(src)
    if (!m || m[0].length === 0) {
      if (/^\s*$/.test(src.slice(pos))) break
      throw new Unresolvable(`calc çözülemedi: ${token}`)
    }
    pos = re.lastIndex
    if (m[1] !== undefined) {
      // "a -1" gibi işaretli sayı, önceki öğe sayı ya da ')' ise çıkarma demektir.
      const prev = tokens[tokens.length - 1]
      if (/^[+-]/.test(m[1]) && prev && (typeof prev === 'number' || prev === ')')) {
        tokens.push(m[1][0], parseFloat(m[1].slice(1)))
      } else {
        tokens.push(parseFloat(m[1]))
      }
      if (m[2]) usesPct = true
    } else {
      tokens.push(m[3])
    }
  }
  let i = 0
  const peek = () => tokens[i]
  const expr = () => {
    let v = term()
    while (peek() === '+' || peek() === '-') v = tokens[i++] === '+' ? v + term() : v - term()
    return v
  }
  const term = () => {
    let v = factor()
    while (peek() === '*' || peek() === '/') v = tokens[i++] === '*' ? v * factor() : v / factor()
    return v
  }
  const factor = () => {
    const t = tokens[i++]
    if (typeof t === 'number') return t
    if (t === '-') return -factor()
    if (t === '(') {
      const v = expr()
      if (tokens[i++] !== ')') throw new Unresolvable(`calc çözülemedi: ${token}`)
      return v
    }
    throw new Unresolvable(`calc çözülemedi: ${token}`)
  }
  const value = expr()
  if (i !== tokens.length || !Number.isFinite(value)) throw new Unresolvable(`calc çözülemedi: ${token}`)
  return `${value}${usesPct ? '%' : ''}`
}

/** Sayı / yüzde / açı. `pct`: %100'ün karşılığı. 'none' → NaN (eksik bileşen). */
function num(token, pct = 1) {
  let t = token.trim().toLowerCase()
  if (t.startsWith('calc(')) t = evalCalc(t)
  if (t === 'none') return NaN
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|rad|grad|turn)?$/.exec(t)
  if (!m) throw new Unresolvable(`sayı değil: ${token}`)
  const v = parseFloat(m[1])
  switch (m[2]) {
    case '%': return (v / 100) * pct
    case 'rad': return (v * 180) / Math.PI
    case 'grad': return v * 0.9
    case 'turn': return v * 360
    default: return v
  }
}

// ---------------------------------------------------------------------------
// Renk uzayları: { space: 'srgb'|'srgb-linear'|'oklab'|'oklch', c: [x,y,z], alpha }
// ---------------------------------------------------------------------------

const ACHROMATIC = 1e-4
const SPACES = new Set(['srgb', 'srgb-linear', 'oklab', 'oklch'])
const z = (v) => (Number.isNaN(v) ? 0 : v)

function toLinear(v) {
  const a = Math.abs(v)
  return a <= 0.04045 ? v / 12.92 : Math.sign(v) * Math.pow((a + 0.055) / 1.055, 2.4)
}

function fromLinear(v) {
  const a = Math.abs(v)
  return a <= 0.0031308 ? v * 12.92 : Math.sign(v) * (1.055 * Math.pow(a, 1 / 2.4) - 0.055)
}

function linearToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function oklabToLinear([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

function lchToLab([L, C, H]) {
  const h = (z(H) * Math.PI) / 180
  return [z(L), z(C) * Math.cos(h), z(C) * Math.sin(h)]
}

function toOklab(color) {
  const c = color.c.map(z)
  switch (color.space) {
    case 'oklab': return c
    case 'oklch': return lchToLab(color.c)
    case 'srgb': return linearToOklab(c.map(toLinear))
    case 'srgb-linear': return linearToOklab(c)
    default: throw new Unresolvable(`desteklenmeyen uzay: ${color.space}`)
  }
}

function convert(color, space) {
  if (color.space === space) return { space, c: [...color.c], alpha: color.alpha }
  const lab = toOklab(color)
  switch (space) {
    case 'oklab': return { space, c: lab, alpha: color.alpha }
    case 'oklch': {
      const C = Math.hypot(lab[1], lab[2])
      let H = (Math.atan2(lab[2], lab[1]) * 180) / Math.PI
      if (H < 0) H += 360
      // Akromatik renkte (beyaz, siyah, gri, transparent) ton anlamsız → eksik.
      return { space, c: [lab[0], C, C < ACHROMATIC ? NaN : H], alpha: color.alpha }
    }
    case 'srgb-linear': return { space, c: oklabToLinear(lab), alpha: color.alpha }
    case 'srgb': return { space, c: oklabToLinear(lab).map(fromLinear), alpha: color.alpha }
    default: throw new Unresolvable(`desteklenmeyen uzay: ${space}`)
  }
}

// ---------------------------------------------------------------------------
// Ayrıştırma
// ---------------------------------------------------------------------------

const NAMED = {
  transparent: [0, 0, 0, 0],
  black: [0, 0, 0, 1],
  white: [1, 1, 1, 1],
}

function parseHex(hex) {
  let h = hex.slice(1)
  if (!/^[0-9a-f]+$/i.test(h) || ![3, 4, 6, 8].includes(h.length)) throw new Unresolvable(`hex değil: ${hex}`)
  if (h.length <= 4) h = [...h].map((ch) => ch + ch).join('')
  const n = (i) => parseInt(h.slice(i, i + 2), 16) / 255
  return { space: 'srgb', c: [n(0), n(2), n(4)], alpha: h.length === 8 ? n(6) : 1 }
}

function parseAlpha(token) {
  if (token === undefined) return 1
  const a = num(token, 1)
  return Number.isNaN(a) ? 0 : Math.min(1, Math.max(0, a))
}

function parseStop(text) {
  const parts = splitSpaces(text)
  const isPct = (t) => /%$/.test(t) || /^calc\(.*%.*\)$/i.test(t)
  if (parts.length > 1 && isPct(parts[0])) return [parts.slice(1).join(' '), num(parts[0], 1)]
  if (parts.length > 1 && isPct(parts[parts.length - 1])) {
    return [parts.slice(0, -1).join(' '), num(parts[parts.length - 1], 1)]
  }
  return [text, undefined]
}

function parseColorMix(body) {
  const args = splitTopLevel(body, ',')
  if (args.length !== 3) throw new Unresolvable(`color-mix bağımsız değişkenleri: ${body}`)
  const head = splitSpaces(args[0].toLowerCase())
  if (head[0] !== 'in' || !SPACES.has(head[1])) throw new Unresolvable(`color-mix uzayı: ${args[0]}`)
  let hue = 'shorter'
  if (head.length === 4 && head[3] === 'hue') hue = head[2]
  else if (head.length !== 2) throw new Unresolvable(`color-mix uzayı: ${args[0]}`)
  const [t1, p1] = parseStop(args[1])
  const [t2, p2] = parseStop(args[2])
  return mixColors(head[1], hue, parseColor(t1), p1, parseColor(t2), p2)
}

/** Statik bir CSS rengini ayrıştırır (var() önceden çözülmüş olmalı). */
export function parseColor(input) {
  const text = input.trim()
  const lower = text.toLowerCase()
  if (NAMED[lower]) {
    const [r, g, b, alpha] = NAMED[lower]
    return { space: 'srgb', c: [r, g, b], alpha }
  }
  if (lower.startsWith('#')) return parseHex(lower)
  const m = /^([a-z-]+)\(([\s\S]*)\)$/i.exec(text)
  if (!m) throw new Unresolvable(`renk değil: ${input}`)
  const name = m[1].toLowerCase()
  const body = m[2]
  switch (name) {
    case 'color-mix':
      return parseColorMix(body)
    case 'oklch':
    case 'oklab': {
      const [main, alpha] = splitTopLevel(body, '/')
      const p = splitSpaces(main)
      if (p.length !== 3) throw new Unresolvable(`${name} bileşenleri: ${input}`)
      const c = name === 'oklch'
        ? [num(p[0], 1), num(p[1], 0.4), num(p[2])]
        : [num(p[0], 1), num(p[1], 0.4), num(p[2], 0.4)]
      return { space: name, c, alpha: parseAlpha(alpha) }
    }
    case 'rgb':
    case 'rgba': {
      let parts
      let alpha
      if (body.includes(',')) {
        parts = splitTopLevel(body, ',')
        alpha = parts[3]
        parts = parts.slice(0, 3)
      } else {
        const [main, a] = splitTopLevel(body, '/')
        parts = splitSpaces(main)
        alpha = a
      }
      if (parts.length !== 3) throw new Unresolvable(`rgb bileşenleri: ${input}`)
      return { space: 'srgb', c: parts.map((t) => z(num(t, 255)) / 255), alpha: parseAlpha(alpha) }
    }
    default:
      throw new Unresolvable(`desteklenmeyen renk: ${input}`)
  }
}

// ---------------------------------------------------------------------------
// Karıştırma (CSS Color 5 color-mix)
// ---------------------------------------------------------------------------

function fixHues(h1, h2, method) {
  const d = h2 - h1
  switch (method) {
    case 'shorter':
      if (d > 180) h1 += 360
      else if (d < -180) h2 += 360
      break
    case 'longer':
      if (d > 0 && d < 180) h1 += 360
      else if (d > -180 && d <= 0) h2 += 360
      break
    case 'increasing':
      if (d < 0) h2 += 360
      break
    case 'decreasing':
      if (d > 0) h1 += 360
      break
    default:
      throw new Unresolvable(`ton yöntemi: ${method}`)
  }
  return [h1, h2]
}

export function mixColors(space, hueMethod, colorA, pa, colorB, pb) {
  if (pa === undefined && pb === undefined) pa = pb = 0.5
  else if (pa === undefined) pa = 1 - pb
  else if (pb === undefined) pb = 1 - pa
  if (pa < 0 || pb < 0 || pa > 1 || pb > 1) throw new Unresolvable('color-mix yüzdesi aralık dışı')
  const sum = pa + pb
  if (sum === 0) throw new Unresolvable('color-mix yüzdeleri sıfır')
  const alphaMult = Math.min(sum, 1)
  pa /= sum
  pb /= sum

  const A = convert(colorA, space)
  const B = convert(colorB, space)
  // Eksik bileşen yalnız 'none' ve dönüşümde tonu anlamsızlaşan renkler
  // (beyaz, siyah, gri, transparent) — Chrome gibi: açıkça yazılmış
  // oklch(1 0 0)'ın tonu (0) karışıma girer.
  const hueIdx = space === 'oklch' ? 2 : -1
  for (let i = 0; i < 3; i++) {
    if (Number.isNaN(A.c[i]) && !Number.isNaN(B.c[i])) A.c[i] = B.c[i]
    else if (Number.isNaN(B.c[i]) && !Number.isNaN(A.c[i])) B.c[i] = A.c[i]
  }
  const pre = (X) => X.c.map((v, i) => (i === hueIdx ? v : v * X.alpha))
  const ca = pre(A)
  const cb = pre(B)
  if (hueIdx >= 0 && !Number.isNaN(ca[2])) [ca[2], cb[2]] = fixHues(ca[2], cb[2], hueMethod)
  const alpha = A.alpha * pa + B.alpha * pb
  const c = ca.map((v, i) => {
    const mixed = v * pa + cb[i] * pb
    return i === hueIdx || alpha === 0 ? mixed : mixed / alpha
  })
  if (hueIdx >= 0 && !Number.isNaN(c[2])) c[2] = ((c[2] % 360) + 360) % 360
  return { space, c, alpha: alpha * alphaMult }
}

// ---------------------------------------------------------------------------
// Çıktı: sRGB + #hex / rgba()
// ---------------------------------------------------------------------------

// sRGB dışına taşan renk kırpılır: Chrome da sRGB ekranda böyle çiziyor
// (CSS Color 4'ün kroma azaltan eşlemesi tarayıcılarda uygulanmıyor).
const clip = (rgb) => rgb.map((v) => Math.min(1, Math.max(0, v)))

export function toCss(color) {
  const rgb = clip(convert(color, 'srgb').c.map(z))
  const [r, g, b] = rgb.map((v) => Math.round(v * 255))
  const alpha = Math.round(Math.min(1, Math.max(0, color.alpha)) * 1000) / 1000
  if (alpha >= 1) return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
  return `rgba(${r},${g},${b},${alpha})`
}

/** Statik renk metnini eski tarayıcının anladığı yazıma çevirir. */
export function legacyColor(text) {
  return toCss(parseColor(text))
}

// ---------------------------------------------------------------------------
// Stil dosyası dönüşümü
// ---------------------------------------------------------------------------

const ROOT_SELECTORS = new Set([':root', 'html'])

function isRootRule(rule) {
  return rule.parent?.type === 'root' && rule.selectors.every((s) => ROOT_SELECTORS.has(s.trim()))
}

function customDefs(rule) {
  let defs = null
  rule.each((node) => {
    if (node.type === 'decl' && node.prop.startsWith('--')) (defs ??= new Map()).set(node.prop, node.value)
  })
  return defs
}

function insertionPoint(root) {
  let index = 0
  root.each((node, i) => {
    if (node.type === 'atrule' && ['charset', 'import', 'layer'].includes(node.name.toLowerCase()) && !node.nodes) {
      index = i + 1
    } else if (node.type !== 'comment') {
      return false
    }
  })
  return index
}

/**
 * CSS metninden eski tarayıcı kopyasını üretir.
 * @returns {{ css: string, stats: { colors: number, dynamic: number, unresolved: string[] } }}
 */
export function buildLegacyCss(css) {
  const root = postcss.parse(css)
  const stats = { colors: 0, dynamic: 0, unresolved: [] }

  // 1) Değişken tanımları (değiştirmeden önceki ham değerler).
  const ruleDefs = new Map()
  const scopes = []
  const rootDefs = new Map()
  root.walkRules((rule) => {
    const defs = customDefs(rule)
    if (!defs) return
    ruleDefs.set(rule, defs)
    if (isRootRule(rule)) for (const [k, v] of defs) rootDefs.set(k, v)
    else scopes.push({ rule, defs })
  })
  const lookupIn = (defs) => (name) => (defs?.has(name) ? defs.get(name) : rootDefs.get(name))

  const resolve = (call, defs) => toCss(parseColor(substituteVars(call, lookupIn(defs))))
  const fail = (where, call, err) => {
    if (!(err instanceof Unresolvable)) throw err
    stats.unresolved.push(`${where}: ${call} (${err.message})`)
  }

  // 2) Değişkenli karışımları topla: her biri bir --legacy-mix-N olacak.
  const dynamic = new Map()
  root.walkDecls((decl) => {
    if (decl.prop.startsWith('--') || !HAS_COLOR_CALL.test(decl.value)) return
    replaceColorCalls(decl.value, (call) => {
      if (HAS_VAR.test(call) && !dynamic.has(call)) {
        dynamic.set(call, { name: `--legacy-mix-${dynamic.size}`, deps: varNames(call), defined: false })
      }
      return call
    })
  })

  const rootLg = []
  for (const [call, entry] of dynamic) {
    try {
      rootLg.push(postcss.decl({ prop: entry.name, value: resolve(call, null) }))
      entry.defined = true
    } catch (err) {
      if (!(err instanceof Unresolvable)) throw err
    }
    for (const { rule, defs } of scopes) {
      if (![...entry.deps].some((d) => defs.has(d))) continue
      try {
        rule.append(postcss.decl({ prop: entry.name, value: resolve(call, defs) }))
        entry.defined = true
      } catch (err) {
        // Kapsam karışımın değişkenlerinden yalnız birini tanımlıyor olabilir
        // (diğeri başka bir kapsamda); o kapsamı atla. Hiçbir yerde
        // çözülemeyen karışım aşağıda raporlanır.
        if (!(err instanceof Unresolvable)) throw err
      }
    }
    if (!entry.defined) fail('karışım', call, new Unresolvable('hiçbir kapsamda çözülemedi'))
  }

  // 3) Bildirimleri yeniden yaz.
  root.walkDecls((decl) => {
    if (/^--legacy-mix-\d+$/.test(decl.prop)) return
    let value = decl.value
    if (HAS_COLOR_CALL.test(value)) {
      const isCustom = decl.prop.startsWith('--')
      const defs = decl.parent?.type === 'rule' ? ruleDefs.get(decl.parent) : undefined
      value = replaceColorCalls(value, (call) => {
        if (HAS_VAR.test(call) && !isCustom) {
          const entry = dynamic.get(call)
          if (!entry?.defined) return call
          stats.dynamic++
          return `var(${entry.name})`
        }
        try {
          // Özel değişken, tanımlandığı öğede çözülür: kendi kuralı + :root.
          const out = resolve(call, defs)
          stats.colors++
          return out
        } catch (err) {
          fail(decl.prop, call, err)
          return call
        }
      })
    }
    value = value.replace(/(\d)(?:dvh|svh|lvh)\b/gi, '$1vh')
    if (/,\s*monospace\s*$/i.test(value) && !/ui-monospace/i.test(value)) {
      value = value.replace(/,\s*monospace\s*$/i, ',ui-monospace,Menlo,monospace')
    }
    if (value !== decl.value) decl.value = value
  })

  if (rootLg.length) {
    // En başa: aynı öğeye uyan sonraki kurallar (ör. <html> üstündeki
    // .palette-terracotta) kendi değerleriyle bunu ezsin.
    const rule = postcss.rule({ selector: ':root', nodes: rootLg })
    const index = insertionPoint(root)
    if (index >= root.nodes.length) root.append(rule)
    else root.insertBefore(root.nodes[index], rule)
  }

  return { css: root.toString(), stats }
}

// ---------------------------------------------------------------------------
// index.html yükleyicisi
// ---------------------------------------------------------------------------

/**
 * Yalnız oklch ya da color-mix'i tanımayan tarayıcıda stil bağlantılarını
 * eski kopyaya çevirir. Yeni tarayıcıda ilk kontrolde çıkar; hata olursa
 * hiçbir şeye dokunmaz.
 */
export function loaderScript(map) {
  return (
    '<script>(function(){try{var c=window.CSS;' +
    "if(c&&c.supports&&c.supports('color','oklch(0 0 0)')&&c.supports('color','color-mix(in srgb,red,red)'))return;" +
    `var m=${JSON.stringify(map)},l=document.querySelectorAll('link[rel="stylesheet"]'),i,h;` +
    "for(i=0;i<l.length;i++){h=l[i].getAttribute('href');if(m.hasOwnProperty(h))l[i].setAttribute('href',m[h])}" +
    '}catch(e){}})()</script>'
  )
}

/** HTML'deki yerel stil bağlantılarının href'leri. */
export function stylesheetHrefs(html) {
  const hrefs = []
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel=["']?stylesheet["']?/i.test(tag)) continue
    const href = /\bhref=["']([^"']+)["']/i.exec(tag)?.[1]
    if (href && /\.css$/i.test(href) && !/^([a-z]+:)?\/\//i.test(href)) hrefs.push(href)
  }
  return hrefs
}

export function legacyCssPlugin() {
  const legacy = new Map() // CSS dosya adı → { fileName, css, stats }
  let base = '/'
  let logger = console

  return {
    name: 'okaliptus:legacy-css',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      base = config.base || '/'
      logger = config.logger
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle) return html
        const map = {}
        for (const href of stylesheetHrefs(html)) {
          if (!href.startsWith(base)) continue
          const fileName = href.slice(base.length)
          const asset = ctx.bundle[fileName]
          if (!asset || asset.type !== 'asset') continue
          if (!legacy.has(fileName)) {
            const { css, stats } = buildLegacyCss(String(asset.source))
            const hash = createHash('sha256').update(css).digest('base64url').slice(0, 8)
            legacy.set(fileName, { fileName: fileName.replace(/\.css$/i, `.legacy-${hash}.css`), css, stats })
          }
          map[href] = base + legacy.get(fileName).fileName
        }
        if (!Object.keys(map).length) return html
        return html.replace(/<\/head>/i, `${loaderScript(map)}</head>`)
      },
    },
    generateBundle() {
      for (const [source, { fileName, css, stats }] of legacy) {
        this.emitFile({ type: 'asset', fileName, source: css })
        logger.info(
          `legacy-css: ${fileName} ← ${source} (${stats.colors} renk, ${stats.dynamic} değişkenli karışım` +
            `${stats.unresolved.length ? `, ${stats.unresolved.length} çözülemedi` : ''})`,
        )
        for (const line of stats.unresolved) logger.warn(`  legacy-css çözülemedi → ${line}`)
      }
    },
  }
}
