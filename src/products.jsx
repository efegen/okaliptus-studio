import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getProducts,
  getProductCategories,
  createProduct,
  updateProduct,
  archiveProduct,
  unarchiveProduct,
  bulkArchiveProducts,
  bulkUnarchiveProducts,
  bulkSetProductCategory,
  bulkUpdateProductPrice,
  renameProductCategory,
} from './api';
import { queryKeys } from './hooks/queryKeys';
import { Icon } from './layout';

function fmtPrice(raw) {
  if (raw === null || raw === undefined || raw === '') return '—';
  const n = Number(raw);
  if (!Number.isFinite(n)) return '—';
  const hasFraction = Math.abs(n - Math.trunc(n)) > 0.0001;
  return `₺${n.toLocaleString('tr-TR', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

function fmtPriceRange(min, max) {
  if (min === max) return fmtPrice(min);
  return `${fmtPrice(min)}–${fmtPrice(max)}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function ProductImage({ product, size = 44 }) {
  const fallback = (product.name || '?').trim().charAt(0).toUpperCase();
  if (product.image_url) {
    return (
      <img
        src={product.image_url}
        alt=""
        className="prod-thumb"
        style={{ width: size, height: size }}
        loading="lazy"
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
      />
    );
  }
  return (
    <span
      className="prod-thumb prod-thumb-fallback"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {fallback}
    </span>
  );
}

const FILTERS = [
  { key: 'active', label: 'Aktif' },
  { key: 'archived', label: 'Arşivli' },
  { key: 'all', label: 'Tümü' },
];

const SORTS = [
  { key: 'name-asc', label: 'Ad (A→Z)' },
  { key: 'name-desc', label: 'Ad (Z→A)' },
  { key: 'price-desc', label: 'Fiyat (yüksek)' },
  { key: 'price-asc', label: 'Fiyat (düşük)' },
  { key: 'created-desc', label: 'En yeni' },
  { key: 'created-asc', label: 'En eski' },
];

function compareBy(sort) {
  switch (sort) {
    case 'name-desc':
      return (a, b) => (b.displayName || '').localeCompare(a.displayName || '', 'tr-TR');
    case 'price-asc':
      return (a, b) => Number(a.minPrice) - Number(b.minPrice);
    case 'price-desc':
      return (a, b) => Number(b.maxPrice) - Number(a.maxPrice);
    case 'created-asc':
      return (a, b) => new Date(a.firstCreated).getTime() - new Date(b.firstCreated).getTime();
    case 'created-desc':
      return (a, b) => new Date(b.firstCreated).getTime() - new Date(a.firstCreated).getTime();
    case 'name-asc':
    default:
      return (a, b) => (a.displayName || '').localeCompare(b.displayName || '', 'tr-TR');
  }
}

function groupByParent(products) {
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
        firstCreated: p.created_at,
        lastUpdated: p.updated_at,
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
        firstCreated: p.created_at,
        lastUpdated: p.updated_at,
        variants: [],
      });
    }
    const g = groups.get(k);
    g.variants.push(p);
    const price = Number(p.price);
    if (price < g.minPrice) g.minPrice = price;
    if (price > g.maxPrice) g.maxPrice = price;
    if (new Date(p.created_at) < new Date(g.firstCreated)) g.firstCreated = p.created_at;
    if (new Date(p.updated_at) > new Date(g.lastUpdated)) g.lastUpdated = p.updated_at;
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

// ─── Selection helpers ──────────────────────────────────────────────────────

function getEntryProductIds(entry) {
  return entry.variants.map(v => v.id);
}

function entrySelectionState(entry, selected) {
  const ids = getEntryProductIds(entry);
  let sel = 0;
  for (const id of ids) if (selected.has(id)) sel += 1;
  if (sel === 0) return 'none';
  if (sel === ids.length) return 'all';
  return 'partial';
}

// ─── ProductModal ───────────────────────────────────────────────────────────

function ProductModal({ initial, knownCategories, onClose, onSaved }) {
  const isNew = !initial;
  const [form, setForm] = React.useState(() => ({
    name: initial?.name ?? '',
    price: initial ? String(initial.price) : '',
    barcode: initial?.barcode ?? '',
    image_url: initial?.image_url ?? '',
    ty_listing_url: initial?.ty_listing_url ?? '',
    hb_listing_url: initial?.hb_listing_url ?? '',
    notes: initial?.notes ?? '',
    parent_product_code: initial?.parent_product_code ?? '',
    variant_label: initial?.variant_label ?? '',
    category: initial?.category ?? '',
  }));
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState(null);

  function set(key, val) {
    setForm(f => ({ ...f, [key]: val }));
    setErr(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const name = form.name.trim();
    const priceNum = parseFloat(form.price);
    if (!name) { setErr('Ürün adı zorunlu.'); return; }
    if (!Number.isFinite(priceNum) || priceNum <= 0) { setErr('Fiyat sıfırdan büyük olmalı.'); return; }
    setSaving(true);
    setErr(null);
    try {
      const payload = {
        name,
        price: priceNum,
        barcode: form.barcode.trim() || null,
        imageUrl: form.image_url.trim() || null,
        tyListingUrl: form.ty_listing_url.trim() || null,
        hbListingUrl: form.hb_listing_url.trim() || null,
        notes: form.notes.trim() || null,
        parentProductCode: form.parent_product_code.trim() || null,
        variantLabel: form.variant_label.trim() || null,
        category: form.category.trim() || null,
      };
      const saved = isNew
        ? await createProduct(payload)
        : await updateProduct(initial.id, payload);
      onSaved(saved);
    } catch (e) {
      setErr(e.message || 'Kaydedilemedi.');
      setSaving(false);
    }
  }

  async function handleArchive() {
    if (!initial) return;
    setSaving(true);
    setErr(null);
    try {
      const result = initial.archived_at
        ? await unarchiveProduct(initial.id)
        : await archiveProduct(initial.id);
      onSaved(result);
    } catch (e) {
      setErr(e.message || 'İşlem yapılamadı.');
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal prod-modal">
        <div className="lt-modal-head">
          <div className="lt-modal-mark" aria-hidden="true">
            <Icon.Tag width="18" height="18" />
          </div>
          <h3>{isNew ? 'Yeni ürün' : 'Ürünü düzenle'}</h3>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="prod-modal-grid">
            <div className="prod-modal-imgcol">
              <label className="prod-modal-label">Görsel</label>
              <div className="prod-modal-imgbox">
                {form.image_url ? (
                  <img src={form.image_url} alt="" onError={e => e.currentTarget.style.display = 'none'} />
                ) : (
                  <span className="prod-modal-imgbox-fallback" aria-hidden="true">
                    <Icon.Tag width="22" height="22" />
                  </span>
                )}
              </div>
              <input
                className="prod-modal-input"
                value={form.image_url}
                onChange={e => set('image_url', e.target.value)}
                placeholder="https://cdn.dsmcdn.com/…"
              />
              <p className="prod-modal-hint">
                Public URL (Trendyol CDN'i olduğu gibi çalışır).
              </p>
            </div>

            <div className="prod-modal-fields">
              <div className="form-row">
                <label>Ad *</label>
                <input
                  autoFocus
                  className="prod-modal-input"
                  value={form.name}
                  onChange={e => set('name', e.target.value)}
                  placeholder="ör. Lotus Buhurdanlık | Mor Beyaz Çini Desenli"
                />
              </div>

              <div className="form-row-2">
                <div className="form-row" style={{ margin: 0 }}>
                  <label>Fiyat (₺) *</label>
                  <input
                    className="prod-modal-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.price}
                    onChange={e => set('price', e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="form-row" style={{ margin: 0 }}>
                  <label>Barkod</label>
                  <input
                    className="prod-modal-input"
                    value={form.barcode}
                    onChange={e => set('barcode', e.target.value)}
                    placeholder="869…"
                  />
                </div>
              </div>

              <div className="form-row-2">
                <div className="form-row" style={{ margin: 0 }}>
                  <label>Kategori</label>
                  <input
                    className="prod-modal-input"
                    value={form.category}
                    onChange={e => set('category', e.target.value)}
                    placeholder="ör. Tütsü ve Buhurdanlık"
                    list="prod-cat-suggestions"
                  />
                  {knownCategories.length > 0 && (
                    <datalist id="prod-cat-suggestions">
                      {knownCategories.map(c => <option key={c.category} value={c.category} />)}
                    </datalist>
                  )}
                </div>
                <div className="form-row" style={{ margin: 0 }}>
                  <label>Model Kodu</label>
                  <input
                    className="prod-modal-input"
                    value={form.parent_product_code}
                    onChange={e => set('parent_product_code', e.target.value)}
                    placeholder="ör. OKY-BUH"
                  />
                </div>
              </div>

              <div className="form-row">
                <label>Varyant etiketi</label>
                <input
                  className="prod-modal-input"
                  value={form.variant_label}
                  onChange={e => set('variant_label', e.target.value)}
                  placeholder="ör. Mavi · 80x28"
                />
                <span className="prod-modal-hint">
                  Aynı Model Kodu'nu paylaşan ürünler bu etiket ile ayırt edilir.
                </span>
              </div>

              <div className="form-row">
                <label>Trendyol linki</label>
                <input
                  className="prod-modal-input"
                  value={form.ty_listing_url}
                  onChange={e => set('ty_listing_url', e.target.value)}
                  placeholder="https://www.trendyol.com/…"
                />
              </div>

              <div className="form-row">
                <label>Hepsiburada linki</label>
                <input
                  className="prod-modal-input"
                  value={form.hb_listing_url}
                  onChange={e => set('hb_listing_url', e.target.value)}
                  placeholder="https://www.hepsiburada.com/…"
                />
              </div>

              <div className="form-row">
                <label>Not</label>
                <input
                  className="prod-modal-input"
                  value={form.notes}
                  onChange={e => set('notes', e.target.value)}
                  placeholder="İç açıklama"
                />
              </div>
            </div>
          </div>

          {err && <div className="stg-feedback stg-feedback-err" style={{ marginTop: 12 }}>{err}</div>}

          <div className="modal-actions modal-actions-spread">
            {!isNew ? (
              <button
                type="button"
                className={'btn ' + (initial.archived_at ? 'btn-ghost' : 'btn-warn-ghost')}
                onClick={handleArchive}
                disabled={saving}
              >
                {initial.archived_at ? 'Arşivden çıkar' : 'Arşivle'}
              </button>
            ) : <span />}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
                İptal
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Kaydediliyor…' : 'Kaydet'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── User-created categories (localStorage) ────────────────────────────────
//
// Backend'de category bir text kolon olduğu için "henüz ürün atanmamış" kategori
// API'den gelmez. Kullanıcı kategori oluşturup sonra ürün atayabilsin diye boş
// kategorileri yerelde tutuyoruz. Otocomplete önerilerinde + yönetim ekranında
// görünür. Ürün atandığında API zaten count ≥ 1 olarak döndürür.

const USER_CATEGORIES_KEY = 'okaliptus.products.user-categories';

function readUserCategories() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(USER_CATEGORIES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(s => typeof s === 'string') : [];
  } catch { return []; }
}

function writeUserCategories(list) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(USER_CATEGORIES_KEY, JSON.stringify(Array.from(new Set(list))));
  } catch { /* quota / private mode — sessizce geç */ }
}

function mergeUserCategories(apiCats) {
  const userList = readUserCategories();
  const apiNames = new Set(apiCats.map(c => c.category));
  const merged = [...apiCats];
  for (const u of userList) {
    if (!apiNames.has(u)) merged.push({ category: u, count: 0 });
  }
  // Türkçe alphabetik sıralama
  merged.sort((a, b) => a.category.localeCompare(b.category, 'tr-TR'));
  return merged;
}

// ─── Category Manager Modal ─────────────────────────────────────────────────

function CategoryRow({ category, count, isUserOnly, onRename, onClear, onRemoveEmpty }) {
  const [mode, setMode] = React.useState('view'); // 'view' | 'edit' | 'confirm-delete'
  const [value, setValue] = React.useState(category);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (mode !== 'confirm-delete') return;
    const t = setTimeout(() => setMode('view'), 3000);
    return () => clearTimeout(t);
  }, [mode]);

  function startRename() {
    setValue(category);
    setMode('edit');
  }

  function cancelEdit() {
    setMode('view');
    setValue(category);
  }

  async function commitRename() {
    const next = value.trim();
    if (!next || next === category) { setMode('view'); return; }
    setBusy(true);
    try {
      await onRename(category, next);
      setMode('view');
    } finally { setBusy(false); }
  }

  async function commitDelete() {
    setBusy(true);
    try {
      if (isUserOnly) {
        onRemoveEmpty(category);
      } else {
        await onClear(category);
      }
      setMode('view');
    } finally { setBusy(false); }
  }

  return (
    <div className={'cat-card' + (busy ? ' is-busy' : '') + (isUserOnly ? ' is-empty' : '')}>
      <div className="cat-card-icon" aria-hidden="true">
        <Icon.Layers width="14" height="14" />
      </div>

      {mode === 'edit' ? (
        <input
          className="cat-card-input"
          value={value}
          onChange={e => setValue(e.target.value)}
          autoFocus
          disabled={busy}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
            if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
          }}
        />
      ) : (
        <div className="cat-card-body">
          <span className="cat-card-name">{category}</span>
          <span className="cat-card-meta">
            {isUserOnly ? (
              <span className="cat-card-tag">boş</span>
            ) : (
              <>
                <strong>{count}</strong>
                <span className="cat-card-meta-lbl">ürün</span>
              </>
            )}
          </span>
        </div>
      )}

      <div className="cat-card-actions">
        {mode === 'edit' ? (
          <>
            <button type="button" className="btn btn-primary btn-xs" onClick={commitRename} disabled={busy}>Kaydet</button>
            <button type="button" className="btn btn-ghost btn-xs" onClick={cancelEdit} disabled={busy}>İptal</button>
          </>
        ) : mode === 'confirm-delete' ? (
          <>
            <button type="button" className="btn btn-danger btn-xs" onClick={commitDelete} disabled={busy} autoFocus>
              {isUserOnly ? 'Sil' : `${count} üründen kaldır`}
            </button>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setMode('view')} disabled={busy}>Vazgeç</button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="iconbtn cat-card-icon-btn"
              onClick={startRename}
              disabled={busy}
              title="Yeniden adlandır"
              aria-label={`${category} yeniden adlandır`}
            >
              <Icon.Edit width="14" height="14" />
            </button>
            <button
              type="button"
              className="iconbtn cat-card-icon-btn cat-card-icon-btn-danger"
              onClick={() => setMode('confirm-delete')}
              disabled={busy}
              title={isUserOnly ? 'Sil' : 'Ürünlerden kaldır'}
              aria-label={`${category} sil`}
            >
              <span aria-hidden="true">🗑</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function CategoryManagerModal({ categories, onClose, onChanged }) {
  // categories: API'den gelen aktif kategoriler. localStorage'daki "boş"
  // kategorileri buna ekleyip tek liste olarak göstereceğiz.
  const [feedback, setFeedback] = React.useState(null);
  const [search, setSearch] = React.useState('');
  const [newCat, setNewCat] = React.useState('');
  const [refreshTick, setRefreshTick] = React.useState(0);

  const merged = React.useMemo(
    () => mergeUserCategories(categories),
    // refreshTick: localStorage değişimini yakalamak için (yeni kategori eklendiğinde)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [categories, refreshTick],
  );

  const filtered = React.useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR');
    if (!q) return merged;
    return merged.filter(c => c.category.toLocaleLowerCase('tr-TR').includes(q));
  }, [merged, search]);

  async function handleRename(from, to) {
    // API üzerinden ürünleri güncelle (count > 0 olanlar için)
    const apiHas = categories.some(c => c.category === from);
    if (apiHas) {
      const result = await renameProductCategory(from, to);
      setFeedback(`"${from}" → "${to}" · ${result.affected} üründe güncellendi`);
      onChanged();
    } else {
      setFeedback(`"${from}" → "${to}" kaydedildi`);
    }
    // localStorage tarafında da from'u kaldırıp to'yu ekle
    const list = readUserCategories().filter(c => c !== from);
    if (!categories.some(c => c.category === to)) list.push(to);
    writeUserCategories(list);
    setRefreshTick(t => t + 1);
  }

  async function handleClear(category) {
    const result = await renameProductCategory(category, null);
    setFeedback(`"${category}" kaldırıldı · ${result.affected} ürün etkilendi`);
    // Hem API'den hem localStorage'dan temizle
    writeUserCategories(readUserCategories().filter(c => c !== category));
    onChanged();
    setRefreshTick(t => t + 1);
  }

  function handleRemoveEmpty(category) {
    writeUserCategories(readUserCategories().filter(c => c !== category));
    setFeedback(`"${category}" listeden kaldırıldı`);
    setRefreshTick(t => t + 1);
  }

  function handleAddCategory(e) {
    if (e) e.preventDefault();
    const name = newCat.trim();
    if (!name) return;
    if (merged.some(c => c.category.toLocaleLowerCase('tr-TR') === name.toLocaleLowerCase('tr-TR'))) {
      setFeedback(`"${name}" zaten mevcut`);
      setNewCat('');
      return;
    }
    const list = readUserCategories();
    list.push(name);
    writeUserCategories(list);
    setNewCat('');
    setFeedback(`"${name}" eklendi`);
    setRefreshTick(t => t + 1);
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal cat-modal">
        <div className="lt-modal-head">
          <div className="lt-modal-mark" aria-hidden="true">
            <Icon.Layers width="18" height="18" />
          </div>
          <div>
            <h3 style={{ margin: 0 }}>Kategorileri yönet</h3>
            <div className="cat-modal-sub">
              {merged.length} kategori · ürün atanmamış olanlar yerelde saklanır
            </div>
          </div>
        </div>

        <form className="cat-add-form" onSubmit={handleAddCategory}>
          <Icon.Plus width="14" height="14" />
          <input
            className="cat-add-input"
            value={newCat}
            onChange={e => setNewCat(e.target.value)}
            placeholder="Yeni kategori adı (Enter)"
          />
          <button type="submit" className="btn btn-primary btn-xs" disabled={!newCat.trim()}>
            Ekle
          </button>
        </form>

        {merged.length > 6 && (
          <label className="cat-search">
            <Icon.Search width="14" height="14" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Kategori ara..."
            />
          </label>
        )}

        {filtered.length === 0 ? (
          <div className="stu-state-msg" style={{ padding: '20px 0', textAlign: 'center' }}>
            {search ? `"${search}" için sonuç yok.` : 'Henüz kategori yok. Yukarıdan ekle veya Excel import et.'}
          </div>
        ) : (
          <div className="cat-list">
            {filtered.map(c => (
              <CategoryRow
                key={c.category}
                category={c.category}
                count={c.count}
                isUserOnly={c.count === 0}
                onRename={handleRename}
                onClear={handleClear}
                onRemoveEmpty={handleRemoveEmpty}
              />
            ))}
          </div>
        )}

        {feedback && (
          <div className="prod-feedback" onClick={() => setFeedback(null)}>
            {feedback}
            <span className="prod-feedback-close" aria-hidden="true">×</span>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Kapat</button>
        </div>
      </div>
    </div>
  );
}

// ─── Bulk Action Bar ────────────────────────────────────────────────────────

const PRICE_MODES = [
  { key: 'set', label: 'Sabit fiyat', placeholder: 'Yeni fiyat (₺)', suffix: '₺' },
  { key: 'add', label: '₺ ekle/çıkar', placeholder: '+25 veya -10', suffix: '₺' },
  { key: 'multiply', label: '% değişim', placeholder: '+10 veya -5', suffix: '%' },
];

function BulkActionBar({
  count, allArchived, knownCategories,
  onClear, onArchive, onUnarchive, onSetCategory, onSetPrice,
}) {
  const [picker, setPicker] = React.useState(null); // null | 'category' | 'price'
  const [catValue, setCatValue] = React.useState('');
  const [priceMode, setPriceMode] = React.useState('set');
  const [priceValue, setPriceValue] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  function closePicker() { setPicker(null); setCatValue(''); setPriceValue(''); }

  async function handleArchiveOp(op) {
    setBusy(true);
    try { await op(); } finally { setBusy(false); }
  }

  async function handleApplyCategory() {
    setBusy(true);
    try {
      await onSetCategory(catValue.trim() || null);
      closePicker();
    } finally { setBusy(false); }
  }

  async function handleApplyPrice() {
    const v = parseFloat(priceValue);
    if (!Number.isFinite(v)) return;
    if (priceMode === 'set' && v <= 0) return;
    setBusy(true);
    try {
      await onSetPrice(priceMode, v);
      closePicker();
    } finally { setBusy(false); }
  }

  const activeMode = PRICE_MODES.find(m => m.key === priceMode);

  return (
    <div className="prod-bulk-bar">
      <div className="prod-bulk-bar-info">
        <strong>{count}</strong> ürün seçildi
      </div>
      <div className="prod-bulk-bar-actions">
        {picker === 'category' && (
          <div className="prod-bulk-picker">
            <Icon.Layers width="13" height="13" />
            <input
              className="prod-modal-input prod-bulk-picker-input"
              placeholder="Kategori adı (boş = temizle)"
              value={catValue}
              onChange={e => setCatValue(e.target.value)}
              autoFocus
              list="prod-bulk-cat-suggestions"
              disabled={busy}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); handleApplyCategory(); }
                if (e.key === 'Escape') { e.preventDefault(); closePicker(); }
              }}
            />
            {knownCategories.length > 0 && (
              <datalist id="prod-bulk-cat-suggestions">
                {knownCategories.map(c => <option key={c.category} value={c.category} />)}
              </datalist>
            )}
            <button type="button" className="btn btn-primary btn-xs" onClick={handleApplyCategory} disabled={busy}>Uygula</button>
            <button type="button" className="btn btn-ghost btn-xs" onClick={closePicker} disabled={busy}>İptal</button>
          </div>
        )}

        {picker === 'price' && (
          <div className="prod-bulk-picker prod-bulk-picker-price">
            <div className="prod-bulk-mode-seg" role="radiogroup" aria-label="Fiyat modu">
              {PRICE_MODES.map(m => (
                <button
                  key={m.key}
                  type="button"
                  role="radio"
                  aria-checked={priceMode === m.key}
                  className={'prod-bulk-mode-btn' + (priceMode === m.key ? ' is-active' : '')}
                  onClick={() => setPriceMode(m.key)}
                  disabled={busy}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className="prod-bulk-price-input">
              <input
                className="prod-modal-input"
                type="number"
                step="0.01"
                placeholder={activeMode.placeholder}
                value={priceValue}
                onChange={e => setPriceValue(e.target.value)}
                autoFocus
                disabled={busy}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); handleApplyPrice(); }
                  if (e.key === 'Escape') { e.preventDefault(); closePicker(); }
                }}
              />
              <span className="prod-bulk-price-suffix">{activeMode.suffix}</span>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-xs"
              onClick={handleApplyPrice}
              disabled={busy || !priceValue.trim() || !Number.isFinite(parseFloat(priceValue))}
            >
              Uygula
            </button>
            <button type="button" className="btn btn-ghost btn-xs" onClick={closePicker} disabled={busy}>İptal</button>
          </div>
        )}

        {picker === null && (
          <>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setPicker('price')} disabled={busy}>
              <Icon.Tag width="13" height="13" />
              Fiyat değiştir
            </button>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setPicker('category')} disabled={busy}>
              <Icon.Layers width="13" height="13" />
              Kategori değiştir
            </button>
            {allArchived ? (
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => handleArchiveOp(onUnarchive)} disabled={busy}>
                Arşivden çıkar
              </button>
            ) : (
              <button type="button" className="btn btn-warn-ghost btn-xs" onClick={() => handleArchiveOp(onArchive)} disabled={busy}>
                Arşivle
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-xs" onClick={onClear} disabled={busy}>
              Seçimi temizle
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── KPI ───────────────────────────────────────────────────────────────────

function ProductsKpiRow({ products, categories }) {
  const total = products.length;
  const active = products.filter(p => !p.archived_at).length;
  const archived = total - active;

  const activePrices = products.filter(p => !p.archived_at).map(p => Number(p.price)).filter(Number.isFinite);
  const avgPrice = activePrices.length > 0
    ? activePrices.reduce((a, b) => a + b, 0) / activePrices.length
    : 0;
  const maxPrice = activePrices.length > 0 ? Math.max(...activePrices) : 0;
  const minPrice = activePrices.length > 0 ? Math.min(...activePrices) : 0;

  const categoryCount = categories.length;
  const topCategory = categories[0];

  const variantGroups = new Set();
  for (const p of products) {
    if (p.parent_product_code && !p.archived_at) variantGroups.add(p.parent_product_code);
  }
  const groupCount = variantGroups.size;
  const noImageCount = products.filter(p => !p.image_url && !p.archived_at).length;

  return (
    <div className="kpi-row">
      <div className="kpi-card">
        <div className="kpi-card-label">Aktif ürün</div>
        <div className="kpi-card-main">
          <span className="kpi-card-val">{active}</span>
          {archived > 0 && <span className="kpi-card-sep">/</span>}
          {archived > 0 && <span className="kpi-card-val2">{archived} arşivli</span>}
        </div>
        <div className="kpi-card-sub">Toplam <strong>{total}</strong> ürün katalogda</div>
      </div>

      <div className="kpi-card">
        <div className="kpi-card-label">Varyant grubu</div>
        <div className="kpi-card-main">
          <span className="kpi-card-val">{groupCount}</span>
        </div>
        <div className="kpi-card-sub">
          {groupCount > 0 ? <>Aynı modelin renk/beden çeşitleri</> : 'Varyant grupları henüz tanımlı değil'}
        </div>
      </div>

      <div className="kpi-card">
        <div className="kpi-card-label">Kategori</div>
        <div className="kpi-card-main">
          <span className="kpi-card-val">{categoryCount}</span>
        </div>
        <div className="kpi-card-sub">
          {topCategory
            ? <>en kalabalık: <strong>{topCategory.category}</strong> ({topCategory.count})</>
            : 'kategori atanmamış'}
        </div>
      </div>

      <div className={'kpi-card' + (noImageCount > 0 ? ' kpi-card-warn' : '')}>
        <div className="kpi-card-label">Ortalama fiyat</div>
        <div className="kpi-card-main">
          <span className="kpi-card-val">{fmtPrice(avgPrice)}</span>
        </div>
        <div className="kpi-card-sub">
          {active > 0
            ? <>min <strong>{fmtPrice(minPrice)}</strong> · max <strong>{fmtPrice(maxPrice)}</strong></>
            : 'henüz aktif ürün yok'}
          {noImageCount > 0 && <> · <strong>{noImageCount}</strong> görselsiz</>}
        </div>
      </div>
    </div>
  );
}

// ─── Row components ────────────────────────────────────────────────────────

function SelectCheckbox({ state, onChange, label }) {
  // state: 'none' | 'partial' | 'all' | true | false
  const checked = state === 'all' || state === true;
  const indeterminate = state === 'partial';
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="prod-checkbox"
      checked={checked}
      aria-label={label}
      onClick={e => e.stopPropagation()}
      onChange={e => onChange(e.target.checked)}
    />
  );
}

function VariantRow({ variant, isSelected, onToggleSelect, onOpen }) {
  return (
    <tr className={'prod-tr prod-tr-variant' + (isSelected ? ' is-selected' : '')} onClick={() => onOpen(variant)}>
      <td className="prod-td prod-td-checkbox" onClick={e => e.stopPropagation()}>
        <SelectCheckbox
          state={isSelected ? 'all' : 'none'}
          onChange={() => onToggleSelect(variant.id)}
          label={`${variant.name} seç`}
        />
      </td>
      <td className="prod-td">
        <div className="prod-name-cell prod-name-cell-variant">
          <span className="prod-variant-arrow" aria-hidden="true">↳</span>
          <ProductImage product={variant} size={36} />
          <div className="prod-name-block">
            <span className="prod-name prod-name-variant">
              {variant.variant_label || variant.name}
            </span>
            {variant.barcode && (
              <span className="prod-name-sub prod-td-mono">{variant.barcode}</span>
            )}
          </div>
        </div>
      </td>
      <td className="prod-td">
        {variant.category && <span className="prod-cat-badge">{variant.category}</span>}
      </td>
      <td className="prod-td prod-td-num">
        <strong>{fmtPrice(variant.price)}</strong>
      </td>
      <td className="prod-td">
        <div className="prod-channels">
          {variant.ty_listing_url ? (
            <a href={variant.ty_listing_url} target="_blank" rel="noopener noreferrer" className="prod-chip prod-chip-ty" onClick={e => e.stopPropagation()} title={variant.ty_listing_url}>TY</a>
          ) : <span className="prod-chip prod-chip-off">TY</span>}
          {variant.hb_listing_url ? (
            <a href={variant.hb_listing_url} target="_blank" rel="noopener noreferrer" className="prod-chip prod-chip-hb" onClick={e => e.stopPropagation()} title={variant.hb_listing_url}>HB</a>
          ) : <span className="prod-chip prod-chip-off">HB</span>}
        </div>
      </td>
      <td className="prod-td">
        <span className={'prod-status ' + (variant.archived_at ? 'is-archived' : 'is-active')}>
          <span className="prod-status-dot" aria-hidden="true" />
          {variant.archived_at ? 'Arşivli' : 'Aktif'}
        </span>
      </td>
      <td className="prod-td prod-td-num prod-td-muted">{fmtDate(variant.created_at)}</td>
      <td className="prod-td prod-td-num prod-td-muted">{fmtDate(variant.updated_at)}</td>
      <td className="prod-td prod-td-actions">
        <button type="button" className="iconbtn" aria-label={`${variant.name} düzenle`} title="Düzenle" onClick={e => { e.stopPropagation(); onOpen(variant); }}>
          <Icon.Edit width="14" height="14" />
        </button>
      </td>
    </tr>
  );
}

function GroupRow({ group, expanded, selectionState, onToggleSelect, onToggle, onOpen }) {
  const sample = group.variants[0];
  const allArchived = group.variants.every(v => v.archived_at);
  const variantCount = group.variants.length;

  return (
    <tr className={'prod-tr prod-tr-group' + (selectionState === 'all' ? ' is-selected' : '')} onClick={() => onToggle()}>
      <td className="prod-td prod-td-checkbox" onClick={e => e.stopPropagation()}>
        <SelectCheckbox
          state={selectionState}
          onChange={() => onToggleSelect(group)}
          label={`${group.displayName} grup seç`}
        />
      </td>
      <td className="prod-td">
        <div className="prod-name-cell">
          <button
            type="button"
            className="prod-expand-btn"
            aria-label={expanded ? 'Varyantları gizle' : 'Varyantları göster'}
            aria-expanded={expanded}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
          >
            <span className={'prod-expand-icon' + (expanded ? ' is-open' : '')} aria-hidden="true">
              <Icon.ChevronR width="14" height="14" />
            </span>
          </button>
          <ProductImage product={sample} />
          <div className="prod-name-block">
            <span className="prod-name">
              {group.displayName}
              <span className="prod-variant-badge">{variantCount} varyant</span>
            </span>
            {group.parentCode && (
              <span className="prod-name-sub prod-td-mono">{group.parentCode}</span>
            )}
          </div>
        </div>
      </td>
      <td className="prod-td">
        {group.category && <span className="prod-cat-badge">{group.category}</span>}
      </td>
      <td className="prod-td prod-td-num">
        <strong>{fmtPriceRange(group.minPrice, group.maxPrice)}</strong>
      </td>
      <td className="prod-td">
        <span className="prod-muted prod-td-mono">{variantCount} varyant</span>
      </td>
      <td className="prod-td">
        <span className={'prod-status ' + (allArchived ? 'is-archived' : 'is-active')}>
          <span className="prod-status-dot" aria-hidden="true" />
          {allArchived ? 'Hepsi arşivli' : 'Aktif'}
        </span>
      </td>
      <td className="prod-td prod-td-num prod-td-muted">{fmtDate(group.firstCreated)}</td>
      <td className="prod-td prod-td-num prod-td-muted">{fmtDate(group.lastUpdated)}</td>
      <td className="prod-td prod-td-actions" onClick={e => e.stopPropagation()} />
    </tr>
  );
}

function SingleRow({ entry, isSelected, onToggleSelect, onOpen }) {
  const product = entry.variants[0];
  return (
    <tr className={'prod-tr' + (isSelected ? ' is-selected' : '')} onClick={() => onOpen(product)}>
      <td className="prod-td prod-td-checkbox" onClick={e => e.stopPropagation()}>
        <SelectCheckbox
          state={isSelected ? 'all' : 'none'}
          onChange={() => onToggleSelect(product.id)}
          label={`${product.name} seç`}
        />
      </td>
      <td className="prod-td">
        <div className="prod-name-cell">
          <ProductImage product={product} />
          <div className="prod-name-block">
            <span className="prod-name">{product.name}</span>
            {(product.variant_label || product.notes) && (
              <span className="prod-name-sub">
                {product.variant_label || product.notes}
              </span>
            )}
          </div>
        </div>
      </td>
      <td className="prod-td">
        {product.category && <span className="prod-cat-badge">{product.category}</span>}
      </td>
      <td className="prod-td prod-td-num">
        <strong>{fmtPrice(product.price)}</strong>
      </td>
      <td className="prod-td">
        <div className="prod-channels">
          {product.ty_listing_url ? (
            <a href={product.ty_listing_url} target="_blank" rel="noopener noreferrer" className="prod-chip prod-chip-ty" onClick={e => e.stopPropagation()} title={product.ty_listing_url}>TY</a>
          ) : <span className="prod-chip prod-chip-off">TY</span>}
          {product.hb_listing_url ? (
            <a href={product.hb_listing_url} target="_blank" rel="noopener noreferrer" className="prod-chip prod-chip-hb" onClick={e => e.stopPropagation()} title={product.hb_listing_url}>HB</a>
          ) : <span className="prod-chip prod-chip-off">HB</span>}
        </div>
      </td>
      <td className="prod-td">
        <span className={'prod-status ' + (product.archived_at ? 'is-archived' : 'is-active')}>
          <span className="prod-status-dot" aria-hidden="true" />
          {product.archived_at ? 'Arşivli' : 'Aktif'}
        </span>
      </td>
      <td className="prod-td prod-td-num prod-td-muted">{fmtDate(product.created_at)}</td>
      <td className="prod-td prod-td-num prod-td-muted">{fmtDate(product.updated_at)}</td>
      <td className="prod-td prod-td-actions">
        <button type="button" className="iconbtn" aria-label={`${product.name} düzenle`} title="Düzenle" onClick={e => { e.stopPropagation(); onOpen(product); }}>
          <Icon.Edit width="14" height="14" />
        </button>
      </td>
    </tr>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────

export function ProductsPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = React.useState('active');
  const [query, setQuery] = React.useState('');
  const [sort, setSort] = React.useState('name-asc');
  const [categoryFilter, setCategoryFilter] = React.useState('');
  const [modal, setModal] = React.useState(null);
  const [catManagerOpen, setCatManagerOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState(() => new Set());
  const [selected, setSelected] = React.useState(() => new Set());
  const [feedback, setFeedback] = React.useState(null);

  const productsQuery = useQuery({
    queryKey: queryKeys.products({ includeArchived: true }),
    queryFn: () => getProducts({ includeArchived: true }),
    staleTime: 30 * 1000,
  });

  const categoriesQuery = useQuery({
    queryKey: ['products', 'categories'],
    queryFn: getProductCategories,
    staleTime: 60 * 1000,
  });

  const allProducts = productsQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];
  // localStorage'daki user-categories'i her render'da merge et — modal'lar açılıp
  // kapandığında yeni kategoriler hemen autocomplete'e/dropdown'a düşsün diye.
  // refreshTick: modal'lar değişiklik yaparsa yeniden hesapla.
  const [catRefreshTick, setCatRefreshTick] = React.useState(0);
  const mergedCategories = React.useMemo(
    () => mergeUserCategories(categories),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [categories, catRefreshTick],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase('tr-TR');

  const visibleEntries = React.useMemo(() => {
    const rowFiltered = allProducts.filter(p => {
      if (filter === 'active' && p.archived_at) return false;
      if (filter === 'archived' && !p.archived_at) return false;
      if (categoryFilter && p.category !== categoryFilter) return false;
      if (!normalizedQuery) return true;
      const name = (p.name || '').toLocaleLowerCase('tr-TR');
      const barcode = (p.barcode || '').toLocaleLowerCase('tr-TR');
      const notes = (p.notes || '').toLocaleLowerCase('tr-TR');
      const variant = (p.variant_label || '').toLocaleLowerCase('tr-TR');
      const parent = (p.parent_product_code || '').toLocaleLowerCase('tr-TR');
      return (
        name.includes(normalizedQuery) ||
        barcode.includes(normalizedQuery) ||
        notes.includes(normalizedQuery) ||
        variant.includes(normalizedQuery) ||
        parent.includes(normalizedQuery)
      );
    });
    return groupByParent(rowFiltered).sort(compareBy(sort));
  }, [allProducts, filter, categoryFilter, normalizedQuery, sort]);

  // Görünen tüm ürün ID'leri (variant + single, gruptan açık olanlar dahil, kapalı olanlar için
  // zaten ID'ler entry.variants içinden seçim havuzuna alınabilir).
  const visibleProductIds = React.useMemo(() => {
    const ids = [];
    for (const entry of visibleEntries) {
      for (const v of entry.variants) ids.push(v.id);
    }
    return ids;
  }, [visibleEntries]);

  // Selection: tüm seçili ürünlerin nesneleri (allProducts'tan)
  const selectedProducts = React.useMemo(() => {
    return allProducts.filter(p => selected.has(p.id));
  }, [allProducts, selected]);

  const filterCounts = {
    active: allProducts.filter(p => !p.archived_at).length,
    archived: allProducts.filter(p => !!p.archived_at).length,
    all: allProducts.length,
  };

  function handleSaved() {
    setModal(null);
    queryClient.invalidateQueries({ queryKey: ['products'] });
  }

  function toggleGroupExpand(key) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleSelectId(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectGroup(entry) {
    const ids = getEntryProductIds(entry);
    const state = entrySelectionState(entry, selected);
    setSelected(prev => {
      const next = new Set(prev);
      if (state === 'all') for (const id of ids) next.delete(id);
      else for (const id of ids) next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    const allSelected = visibleProductIds.length > 0 && visibleProductIds.every(id => selected.has(id));
    setSelected(prev => {
      const next = new Set(prev);
      if (allSelected) for (const id of visibleProductIds) next.delete(id);
      else for (const id of visibleProductIds) next.add(id);
      return next;
    });
  }

  const headerSelectionState = React.useMemo(() => {
    if (visibleProductIds.length === 0) return 'none';
    let count = 0;
    for (const id of visibleProductIds) if (selected.has(id)) count += 1;
    if (count === 0) return 'none';
    if (count === visibleProductIds.length) return 'all';
    return 'partial';
  }, [visibleProductIds, selected]);

  async function runBulk(fn, successMsg) {
    try {
      const result = await fn(Array.from(selected));
      setFeedback(`${successMsg} • ${result.affected} ürün etkilendi`);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['products'] });
    } catch (e) {
      setFeedback(e.message || 'İşlem başarısız.');
    }
  }

  // Bulk hangi durumda? Hepsi arşivli mi, hepsi aktif mi, mixed mi?
  const allSelectedArchived = selectedProducts.length > 0 && selectedProducts.every(p => p.archived_at);

  return (
    <div className="page prod-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Ürünler</h1>
          <div className="page-subtitle">
            Yoga matı, kıyafet ve aksesuar katalogu — sepet bazlı satışlar bu listeden çalışır.
          </div>
        </div>
        <div className="head-actions">
          <label className="page-search">
            <Icon.Search width="15" height="15" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Ad, model kodu, barkod, varyant, not..."
              aria-label="Ürün ara"
            />
          </label>
          <button className="btn btn-primary" onClick={() => setModal('new')}>
            <Icon.Plus width="14" height="14" />
            Yeni ürün
          </button>
        </div>
      </div>

      <ProductsKpiRow products={allProducts} categories={categories} />

      <div className="prod-toolbar">
        <div className="lt-filters" role="tablist" aria-label="Durum filtresi">
          {FILTERS.map(f => (
            <button
              key={f.key}
              type="button"
              role="tab"
              className={'lt-chip' + (filter === f.key ? ' is-active' : '')}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
            >
              {f.label}
              <span className="lt-chip-count">{filterCounts[f.key]}</span>
            </button>
          ))}
        </div>
        <div className="prod-toolbar-right">
          {categories.length > 0 && (
            <div className="prod-select" role="group">
              <span className="prod-select-icon" aria-hidden="true">
                <Icon.Layers width="14" height="14" />
              </span>
              <select
                value={categoryFilter}
                onChange={e => setCategoryFilter(e.target.value)}
                aria-label="Kategori filtresi"
              >
                <option value="">Tüm kategoriler</option>
                {categories.map(c => (
                  <option key={c.category} value={c.category}>
                    {c.category} ({c.count})
                  </option>
                ))}
              </select>
              <span className="prod-select-caret" aria-hidden="true">
                <Icon.ChevronDown width="12" height="12" />
              </span>
            </div>
          )}
          {categories.length > 0 && (
            <button
              type="button"
              className="prod-text-btn"
              onClick={() => setCatManagerOpen(true)}
              title="Kategorileri yönet"
            >
              Yönet
            </button>
          )}
          <div className="prod-select" role="group">
            <span className="prod-select-icon" aria-hidden="true">
              <Icon.Sort width="14" height="14" />
            </span>
            <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sırala">
              {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <span className="prod-select-caret" aria-hidden="true">
              <Icon.ChevronDown width="12" height="12" />
            </span>
          </div>
        </div>
      </div>

      {feedback && (
        <div className="stg-feedback prod-feedback" onClick={() => setFeedback(null)}>
          {feedback}
          <span className="prod-feedback-close" aria-hidden="true">×</span>
        </div>
      )}

      <div className="card prod-list-card">
        {selected.size > 0 && (
          <BulkActionBar
            count={selected.size}
            allArchived={allSelectedArchived}
            knownCategories={mergedCategories}
            onClear={() => setSelected(new Set())}
            onArchive={() => runBulk(bulkArchiveProducts, 'Arşivlendi')}
            onUnarchive={() => runBulk(bulkUnarchiveProducts, 'Arşivden çıkarıldı')}
            onSetCategory={async (cat) => {
              await runBulk(
                (ids) => bulkSetProductCategory(ids, cat),
                cat ? `Kategori "${cat}" yapıldı` : 'Kategori temizlendi',
              );
            }}
            onSetPrice={async (mode, value) => {
              try {
                const result = await bulkUpdateProductPrice(Array.from(selected), mode, value);
                const modeLbl = mode === 'set' ? `${value}₺ olarak ayarlandı`
                  : mode === 'add' ? `${value > 0 ? '+' : ''}${value}₺ uygulandı`
                  : `${value > 0 ? '+' : ''}${value}% uygulandı`;
                const skipMsg = result.skipped > 0 ? ` · ${result.skipped} atlandı` : '';
                setFeedback(`Fiyat ${modeLbl} • ${result.affected} ürün etkilendi${skipMsg}`);
                setSelected(new Set());
                queryClient.invalidateQueries({ queryKey: ['products'] });
              } catch (e) {
                setFeedback(e.message || 'Fiyat güncellenemedi.');
              }
            }}
          />
        )}

        {productsQuery.isLoading ? (
          <div className="stu-state-msg">Yükleniyor…</div>
        ) : productsQuery.error ? (
          <div className="stg-feedback stg-feedback-err" style={{ margin: 16 }}>
            {productsQuery.error.message || 'Ürünler yüklenemedi.'}
          </div>
        ) : allProducts.length === 0 ? (
          <div className="stu-empty">
            <div className="stu-empty-icon"><Icon.Tag width="28" height="28" /></div>
            <div className="stu-empty-title">Henüz ürün yok</div>
            <div className="stu-empty-sub">
              İlk ürününü ekle ya da terminalden{' '}
              <code>npm run import:trendyol -- export.xlsx</code> ile Trendyol katalogunu yükle.
            </div>
            <button className="btn btn-primary" onClick={() => setModal('new')}>
              <Icon.Plus width="14" height="14" /> İlk ürünü ekle
            </button>
          </div>
        ) : visibleEntries.length === 0 ? (
          <div className="stu-state-msg">Eşleşen ürün bulunamadı.</div>
        ) : (
          <table className="prod-table">
            <thead className="stu-thead">
              <tr>
                <th className="stu-th prod-th-checkbox">
                  <SelectCheckbox
                    state={headerSelectionState}
                    onChange={toggleSelectAllVisible}
                    label="Görünen ürünleri seç"
                  />
                </th>
                <th className="stu-th">Ürün</th>
                <th className="stu-th">Kategori</th>
                <th className="stu-th stu-th-num">Fiyat</th>
                <th className="stu-th">Kanallar</th>
                <th className="stu-th">Durum</th>
                <th className="stu-th stu-th-num">Eklendi</th>
                <th className="stu-th stu-th-num">Güncellendi</th>
                <th className="stu-th stu-th-end" aria-label="İşlemler" />
              </tr>
            </thead>
            <tbody>
              {visibleEntries.map(entry => {
                if (entry.kind === 'group') {
                  const isExpanded = expanded.has(entry.key);
                  const sel = entrySelectionState(entry, selected);
                  return (
                    <React.Fragment key={entry.key}>
                      <GroupRow
                        group={entry}
                        expanded={isExpanded}
                        selectionState={sel}
                        onToggleSelect={toggleSelectGroup}
                        onToggle={() => toggleGroupExpand(entry.key)}
                        onOpen={setModal}
                      />
                      {isExpanded && entry.variants.map(v => (
                        <VariantRow
                          key={`v-${v.id}`}
                          variant={v}
                          isSelected={selected.has(v.id)}
                          onToggleSelect={toggleSelectId}
                          onOpen={setModal}
                        />
                      ))}
                    </React.Fragment>
                  );
                }
                const single = entry.variants[0];
                return (
                  <SingleRow
                    key={entry.key}
                    entry={entry}
                    isSelected={selected.has(single.id)}
                    onToggleSelect={toggleSelectId}
                    onOpen={setModal}
                  />
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <ProductModal
          initial={modal === 'new' ? null : modal}
          knownCategories={mergedCategories}
          onClose={() => setModal(null)}
          onSaved={(saved) => {
            // Kullanıcı yeni kategori adı yazıp ürünü kaydettiyse, o kategori
            // localStorage user-list'inde varsa kalmasına gerek yok (artık API
            // tarafında geleceği için). Pruning: API kategori listesi yenilenince
            // merge zaten doğru sonucu gösterir, ama localStorage'ı temiz tutmak
            // için API'de zaten varsa user list'ten çıkar.
            const cat = saved?.category;
            if (cat) {
              const list = readUserCategories().filter(c => c !== cat);
              writeUserCategories(list);
              setCatRefreshTick(t => t + 1);
            }
            handleSaved();
          }}
        />
      )}

      {catManagerOpen && (
        <CategoryManagerModal
          categories={categories}
          onClose={() => setCatManagerOpen(false)}
          onChanged={() => {
            setCatRefreshTick(t => t + 1);
            queryClient.invalidateQueries({ queryKey: ['products'] });
          }}
        />
      )}
    </div>
  );
}
