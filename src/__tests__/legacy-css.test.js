import { describe, it, expect, afterEach } from 'vitest'
import {
  buildLegacyCss,
  legacyColor,
  loaderScript,
  stylesheetHrefs,
} from '../../scripts/legacy-css.mjs'

const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',')

describe('legacyColor', () => {
  it('oklch → aynı sRGB rengi', () => {
    expect(legacyColor('oklch(0.627955 0.257683 29.2339)')).toBe('#ff0000')
    expect(legacyColor('oklch(0.519975 0.176858 142.495)')).toBe('#008000')
    expect(legacyColor('oklch(1 0 0)')).toBe('#ffffff')
    expect(legacyColor('oklch(0 0 0)')).toBe('#000000')
    expect(legacyColor('oklch(.5 .08 145 / .5)')).toMatch(/^rgba\(\d+,\d+,\d+,0\.5\)$/)
  })

  it('sRGB dışındaki rengi Chrome gibi kırpar', () => {
    // Chrome 2D canvas ölçümü: oklch(.52 .24 60) → 194,37,0
    expect(legacyColor('oklch(.52 .24 60)')).toBe('#c22500')
  })

  it('calc içeren bileşeni hesaplar', () => {
    expect(legacyColor('oklch(.5 calc(.04 * 2) 145)')).toBe(legacyColor('oklch(.5 .08 145)'))
  })

  it('color-mix yüzdeleri ve saydamlık', () => {
    expect(legacyColor('color-mix(in srgb, #ff0000 50%, #0000ff)')).toBe('#800080')
    // Yüzdeler toplamı 100'ün altındaysa fark saydamlığa gider.
    expect(legacyColor('color-mix(in srgb, #ff0000 30%, #0000ff 20%)')).toBe('rgba(153,0,102,0.5)')
  })

  it('transparent ile karışım rengi korur, yalnız saydamlığı düşürür', () => {
    const base = legacyColor('oklch(0.5 0.08 145)')
    expect(legacyColor('color-mix(in oklch, oklch(0.5 0.08 145) 20%, transparent)'))
      .toBe(`rgba(${rgbOf(base)},0.2)`)
  })

  it('beyaz/siyahın tonu yok: oklch karışımı rengin tonunu kullanır', () => {
    // Değerler Chrome'dan ölçüldü (2D canvas).
    expect(legacyColor('color-mix(in oklch, oklch(.5 .08 145) 50%, white)')).toBe('#9fb59f')
    expect(legacyColor('color-mix(in oklch, oklch(.5 .08 145) 50%, black)')).toBe('#152715')
    expect(legacyColor('color-mix(in oklch, oklch(.5 .08 145) 50%, oklch(1 0 none))')).toBe('#9fb59f')
  })

  it('açıkça yazılmış ton (oklch(1 0 0)) karışıma girer', () => {
    expect(legacyColor('color-mix(in oklch, oklch(.5 .08 145) 50%, oklch(1 0 0))')).toBe('#beaa93')
  })
})

describe('buildLegacyCss', () => {
  const css =
    ':root{--accent:oklch(.5 .08 145);--surface:#ffffff;--deep:color-mix(in oklch,var(--accent) 50%,black)}' +
    '.palette-x{--accent:oklch(.52 .14 40)}' +
    '.btn{background:color-mix(in oklch,var(--accent) 20%,var(--surface));min-height:100dvh;color:oklch(.18 .015 60)}' +
    '.code{font-family:"Geist Mono",monospace}' +
    '.x{color:color-mix(in oklch,var(--nope) 20%,white)}'

  it('statik renkleri yerinde çevirir', () => {
    const { css: out } = buildLegacyCss(css)
    expect(out).toContain(`--accent:${legacyColor('oklch(.5 .08 145)')}`)
    expect(out).toContain(`color:${legacyColor('oklch(.18 .015 60)')}`)
    // Özel değişken tanımlandığı yerde çözülür.
    expect(out).toContain(`--deep:${legacyColor('color-mix(in oklch,oklch(.5 .08 145) 50%,black)')}`)
  })

  it('değişkenli karışım her kapsamda ayrı hesaplanır', () => {
    const { css: out, stats } = buildLegacyCss(css)
    expect(out).toContain('background:var(--legacy-mix-0)')
    const rootValue = legacyColor('color-mix(in oklch,oklch(.5 .08 145) 20%,#ffffff)')
    const paletteValue = legacyColor('color-mix(in oklch,oklch(.52 .14 40) 20%,#ffffff)')
    // :root değeri en başta: <html> üstündeki .palette-x sonra gelip ezer.
    expect(out.startsWith(`:root{--legacy-mix-0:${rootValue}}`)).toBe(true)
    expect(out).toContain(`.palette-x{--accent:${legacyColor('oklch(.52 .14 40)')};--legacy-mix-0:${paletteValue}}`)
    expect(stats.dynamic).toBe(1)
  })

  it('dvh → vh, monospace yedeği Menlo', () => {
    const { css: out } = buildLegacyCss(css)
    expect(out).toContain('min-height:100vh')
    expect(out).toContain('font-family:"Geist Mono",ui-monospace,Menlo,monospace')
  })

  it('çözülemeyen karışımı olduğu gibi bırakır ve raporlar', () => {
    const { css: out, stats } = buildLegacyCss(css)
    expect(out).toContain('.x{color:color-mix(in oklch,var(--nope) 20%,white)}')
    expect(stats.unresolved).toHaveLength(1)
  })
})

describe('index.html yükleyicisi', () => {
  const originalCSS = window.CSS

  afterEach(() => {
    window.CSS = originalCSS
    document.head.innerHTML = ''
  })

  it('yalnız yerel stil dosyalarını alır', () => {
    const html =
      '<link href="https://fonts.googleapis.com/css2?family=Geist" rel="stylesheet">' +
      '<link rel="stylesheet" crossorigin href="/assets/index-abc.css">' +
      '<link rel="manifest" href="/manifest.webmanifest">'
    expect(stylesheetHrefs(html)).toEqual(['/assets/index-abc.css'])
  })

  const run = (supports) => {
    window.CSS = { supports: (_prop, value) => supports(value) }
    document.head.innerHTML = '<link rel="stylesheet" href="/assets/index-abc.css">'
    const code = loaderScript({ '/assets/index-abc.css': '/assets/index-abc.legacy-x.css' })
      .replace(/^<script>/, '')
      .replace(/<\/script>$/, '')
    new Function(code)()
    return document.head.querySelector('link').getAttribute('href')
  }

  it('yeni tarayıcıda hiçbir şeye dokunmaz', () => {
    expect(run(() => true)).toBe('/assets/index-abc.css')
  })

  it('oklch ya da color-mix yoksa eski kopyaya geçer', () => {
    expect(run(() => false)).toBe('/assets/index-abc.legacy-x.css')
    expect(run((v) => !v.startsWith('color-mix'))).toBe('/assets/index-abc.legacy-x.css')
  })
})
