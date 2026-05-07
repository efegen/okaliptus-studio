// Ürün gruplama yardımcısı. Aynı parent_product_code'a sahip ürünler model
// grubu, geri kalanlar tek ürün. Tek varyantlı grup `single`'a düşürülür.

function deriveGroupName(variants) {
  const names = variants.map(v => v.name || '');
  if (names.length === 0) return '';
  let prefix = names[0];
  for (let i = 1; i < names.length; i++) {
    while (!names[i].startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
      if (!prefix) break;
    }
    if (!prefix) break;
  }
  prefix = prefix.replace(/[\s|·\-—]+$/, '').trim();
  return prefix || names[0];
}

export function groupByParent(products) {
  const groups = new Map();
  const standalone = [];

  for (const p of products) {
    if (!p.parent_product_code) {
      standalone.push({
        kind: 'single',
        key: `s-${p.id}`,
        displayName: p.name,
        category: p.category,
        minPrice: Number(p.price),
        maxPrice: Number(p.price),
        variants: [p],
      });
      continue;
    }
    const k = p.parent_product_code;
    if (!groups.has(k)) {
      groups.set(k, {
        kind: 'group',
        key: `g-${k}`,
        parentCode: k,
        displayName: '',
        category: p.category,
        minPrice: Number(p.price),
        maxPrice: Number(p.price),
        variants: [],
      });
    }
    const g = groups.get(k);
    g.variants.push(p);
    const price = Number(p.price);
    if (price < g.minPrice) g.minPrice = price;
    if (price > g.maxPrice) g.maxPrice = price;
    if (!g.category && p.category) g.category = p.category;
  }

  for (const g of groups.values()) {
    if (g.variants.length === 1) {
      g.kind = 'single';
      g.displayName = g.variants[0].name;
    } else {
      g.displayName = deriveGroupName(g.variants);
    }
  }

  const merged = [...standalone];
  for (const g of groups.values()) merged.push(g);
  return merged;
}
