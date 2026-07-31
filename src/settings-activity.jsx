import React from 'react';
import { getAuditLogs, getAuditUsers, uncompleteLesson } from './api';

const ACTION_LABELS = {
  lesson_created:          'Ders oluşturuldu',
  lesson_status_change:    'Ders durumu değişti',
  lesson_uncompleted:      'Ders geri alındı',
  lesson_updated:          'Ders güncellendi',
  lesson_deleted:          'Ders silindi',
  lesson_discount_updated: 'İndirim güncellendi',
  bulk_price_update:       'Toplu fiyat güncelleme',
  payment_created:         'Ödeme oluşturuldu',
  payment_updated:         'Ödeme güncellendi',
  payment_deleted:         'Ödeme silindi',
  product_sale_created:    'Ürün satışı oluşturuldu',
  product_sale_updated:    'Ürün satışı güncellendi',
  product_sale_deleted:    'Ürün satışı silindi',
  prepaid_package_created: 'Paket oluşturuldu',
  prepaid_package_deleted: 'Paket silindi',
  student_created:         'Öğrenci oluşturuldu',
  student_updated:         'Öğrenci güncellendi',
  student_deleted:         'Öğrenci silindi',
  lesson_type_created:     'Ders türü oluşturuldu',
  lesson_type_updated:     'Ders türü güncellendi',
  settings_updated:        'Ayarlar güncellendi',
};

const ACTION_GROUPS = {
  Ders:     ['lesson_created', 'lesson_status_change', 'lesson_uncompleted', 'lesson_updated', 'lesson_deleted', 'lesson_discount_updated'],
  Ödeme:    ['payment_created', 'payment_updated', 'payment_deleted'],
  Satış:    ['product_sale_created', 'product_sale_updated', 'product_sale_deleted'],
  Paket:    ['prepaid_package_created', 'prepaid_package_deleted'],
  Öğrenci:  ['student_created', 'student_updated', 'student_deleted'],
  Diğer:    ['lesson_type_created', 'lesson_type_updated', 'settings_updated', 'bulk_price_update'],
};

// action → color category
const BADGE_CAT = {
  lesson_created: 'lesson',  lesson_status_change: 'lesson',  lesson_uncompleted: 'lesson',
  lesson_updated: 'lesson',  lesson_deleted: 'lesson',        lesson_discount_updated: 'lesson',
  bulk_price_update: 'other',
  payment_created: 'payment', payment_updated: 'payment',     payment_deleted: 'payment',
  product_sale_created: 'sale', product_sale_updated: 'sale', product_sale_deleted: 'sale',
  prepaid_package_created: 'package', prepaid_package_deleted: 'package',
  student_created: 'student', student_updated: 'student',     student_deleted: 'student',
  lesson_type_created: 'other', lesson_type_updated: 'other', settings_updated: 'other',
};

function ChevronIcon({ open }) {
  return (
    <svg
      className={'act-chv' + (open ? ' act-chv-open' : '')}
      width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"
    >
      <path d="M3.5 5.25L7 8.75L10.5 5.25"
            stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ActionBadge({ action }) {
  const cat = BADGE_CAT[action] ?? 'other';
  return (
    <span className={`act-badge act-badge-${cat}`}>
      {ACTION_LABELS[action] ?? action}
    </span>
  );
}

function formatTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const time = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `bugün ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `dün ${time}`;
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }) + ' ' + time;
}

function fmtVal(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'evet' : 'hayır';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    return new Date(s).toLocaleString('tr-TR', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }
  return s;
}

function diffObjects(before, after) {
  const b = before && typeof before === 'object' ? before : {};
  const a = after  && typeof after  === 'object' ? after  : {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const result = [];
  for (const k of keys) {
    if (k === 'id') continue;
    const bv = JSON.stringify(b[k] ?? null);
    const av = JSON.stringify(a[k] ?? null);
    if (bv !== av) result.push({ key: k, before: b[k], after: a[k] });
  }
  return result;
}

function DiffView({ before, after }) {
  const changes = diffObjects(before, after);
  if (changes.length === 0) return <p className="act-diff-empty">Değişiklik detayı yok.</p>;
  return (
    <table className="act-diff-table">
      <thead>
        <tr>
          <th>Alan</th>
          <th>Önce</th>
          <th>Sonra</th>
        </tr>
      </thead>
      <tbody>
        {changes.map(({ key, before: bv, after: av }) => (
          <tr key={key}>
            <td className="act-diff-key">{key}</td>
            <td className="act-diff-before">{fmtVal(bv)}</td>
            <td className="act-diff-after">{fmtVal(av)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Bir denetim kaydının "düzeltme" durumu:
//   { available: true }                 → satır içi "Geri al" butonu (ders uncomplete)
//   { available: false, reason: '...' } → geri alınamaz; NEDENİNİ göster
//   null                                → düzeltilebilir bir kayıt değil (bir şey gösterme)
// Amaç: eskiden geri alınamayan kayıtlarda HİÇBİR şey görünmüyordu → sistem
// bozukmuş gibi duruyordu. Artık ya buton ya da açıklayıcı yönlendirme çıkar.
function undoState(entry) {
  if (entry.action === 'lesson_status_change') {
    const after = entry.after;
    if (!after || typeof after !== 'object' || after.status !== 'completed') return null;
    const within24h = new Date(entry.created_at) > new Date(Date.now() - 24 * 60 * 60 * 1000);
    return within24h
      ? { available: true }
      : { available: false, reason: '24 saatten eski tamamlamalar buradan geri alınamaz. Öğrenci profilinden ödemeyi silip dersi yeniden oluşturun.' };
  }
  if (entry.action === 'payment_created' || entry.action === 'product_sale_created') {
    return { available: false, reason: 'Bu kaydı düzeltmek için Hareketler ekranını kullanın: kaydı silip doğrusunu yeniden girebilirsiniz.' };
  }
  return null;
}

function SkeletonRows() {
  const configs = [
    [95, 64, 118, '45%'],
    [88, 72, 135, '55%'],
    [100, 60, 108, '38%'],
    [92, 68, 124, '50%'],
    [96, 56, 112, '42%'],
  ];
  return (
    <>
      {configs.map(([t, a, b, e], i) => (
        <div key={i} className="act-skel-row">
          <span className="act-skel" style={{ width: t }} />
          <span className="act-skel" style={{ width: a }} />
          <span className="act-skel act-skel-pill" style={{ width: b }} />
          <span className="act-skel" style={{ width: e }} />
        </div>
      ))}
    </>
  );
}

function AuditRow({ entry, onUncompleted }) {
  const [expanded, setExpanded] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [reverting, setReverting] = React.useState(false);
  const [revertError, setRevertError] = React.useState(null);
  const undo = undoState(entry);
  const showUndo = undo?.available === true;

  async function handleUndo() {
    setReverting(true);
    setRevertError(null);
    try {
      await uncompleteLesson(entry.entity_id);
      setConfirming(false);
      onUncompleted?.();
    } catch (err) {
      setRevertError(err.message || 'Geri alınamadı.');
    } finally {
      setReverting(false);
    }
  }

  const entityLabel = entry.student_name
    ? entry.student_name
    : entry.entity_type === 'settings'
      ? 'Ayarlar'
      : `${entry.entity_type} #${entry.entity_id}`;

  return (
    <div className={'act-row' + (expanded ? ' act-row-open' : '')}>
      <div className="act-row-main" onClick={() => setExpanded(e => !e)}>
        <span className="act-col-time">{formatTime(entry.created_at)}</span>
        <span className="act-col-actor">{entry.actor_display_name ?? '—'}</span>
        <span className="act-col-badge"><ActionBadge action={entry.action} /></span>
        <span className="act-col-entity">
          {entityLabel}
          {entry.note && <span className="act-row-note"> · {entry.note}</span>}
        </span>
        <ChevronIcon open={expanded} />
      </div>

      {expanded && (
        <div className="act-row-detail">
          <DiffView before={entry.before} after={entry.after} />

          {undo && !undo.available && (
            <p className="act-undo-reason">{undo.reason}</p>
          )}

          {showUndo && !confirming && (
            <button
              type="button"
              className="btn btn-ghost act-undo-btn"
              onClick={e => { e.stopPropagation(); setConfirming(true); }}
            >
              Geri al
            </button>
          )}

          {showUndo && confirming && (
            <div className="act-confirm">
              <p className="act-confirm-msg">
                {entry.student_name && <strong>{entry.student_name} — </strong>}
                Bu ders "planlandı" durumuna çevrilecek. Bağlı borç kaydı silinecek.
              </p>
              <div className="act-confirm-btns">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={reverting}
                  onClick={handleUndo}
                >
                  {reverting ? 'Geri alınıyor…' : 'Evet, geri al'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={reverting}
                  onClick={() => { setConfirming(false); setRevertError(null); }}
                >
                  İptal
                </button>
              </div>
              {revertError && <p className="act-confirm-err">{revertError}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const PRESETS = [['today', 'Bugün'], ['7d', '7 gün'], ['30d', '30 gün'], ['custom', 'Özel']];

export function ActivityPanel() {
  const [preset, setPreset] = React.useState('7d');
  const [customFrom, setCustomFrom] = React.useState('');
  const [customTo, setCustomTo] = React.useState('');
  const [actionsOpen, setActionsOpen] = React.useState(false);
  const [selectedActions, setSelectedActions] = React.useState([]);
  const [actorId, setActorId] = React.useState('');
  const [qInput, setQInput] = React.useState('');
  const [q, setQ] = React.useState('');

  const [users, setUsers] = React.useState([]);
  const [entries, setEntries] = React.useState([]);
  const [page, setPage] = React.useState(1);
  const [hasMore, setHasMore] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [version, setVersion] = React.useState(0);

  // debounce search
  React.useEffect(() => {
    const t = setTimeout(() => setQ(qInput), 400);
    return () => clearTimeout(t);
  }, [qInput]);

  React.useEffect(() => {
    getAuditUsers().then(setUsers).catch(() => {});
  }, []);

  function getDateRange() {
    const now = new Date();
    if (preset === 'today') {
      const s = new Date(now); s.setHours(0, 0, 0, 0);
      const e = new Date(now); e.setHours(23, 59, 59, 999);
      return { from: s.toISOString(), to: e.toISOString() };
    }
    if (preset === '7d') {
      const s = new Date(now); s.setDate(s.getDate() - 6); s.setHours(0, 0, 0, 0);
      const e = new Date(now); e.setHours(23, 59, 59, 999);
      return { from: s.toISOString(), to: e.toISOString() };
    }
    if (preset === '30d') {
      const s = new Date(now); s.setDate(s.getDate() - 29); s.setHours(0, 0, 0, 0);
      const e = new Date(now); e.setHours(23, 59, 59, 999);
      return { from: s.toISOString(), to: e.toISOString() };
    }
    return {
      from: customFrom ? new Date(customFrom + 'T00:00:00').toISOString() : undefined,
      to:   customTo   ? new Date(customTo   + 'T23:59:59').toISOString() : undefined,
    };
  }

  async function loadPage(p) {
    setLoading(true);
    setError(null);
    try {
      const { from, to } = getDateRange();
      const result = await getAuditLogs({
        from, to,
        actions:     selectedActions.length > 0 ? selectedActions : undefined,
        actorUserId: actorId ? Number(actorId) : undefined,
        q:           q.trim() || undefined,
        page: p,
        limit: 50,
      });
      setEntries(p === 1 ? result.data : prev => [...prev, ...result.data]);
      setPage(p);
      setHasMore(result.hasMore);
    } catch (err) {
      setError(err.message || 'Aktivite yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    setEntries([]);
    setPage(1);
    loadPage(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, customFrom, customTo, selectedActions, actorId, q, version]);

  function toggleAction(action) {
    setSelectedActions(prev =>
      prev.includes(action) ? prev.filter(a => a !== action) : [...prev, action]
    );
  }

  const selCount = selectedActions.length;

  return (
    <div className="act-panel">

      {/* ── Filter bar ── */}
      <div className="act-filters">
        <div className="act-filter-top">
          <div className="act-presets">
            {PRESETS.map(([v, label]) => (
              <button
                key={v}
                type="button"
                className={'act-preset-btn' + (preset === v ? ' is-active' : '')}
                onClick={() => setPreset(v)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={'act-actions-toggle' + (actionsOpen || selCount > 0 ? ' is-active' : '')}
            onClick={() => setActionsOpen(o => !o)}
          >
            Eylemler{selCount > 0 ? ` · ${selCount}` : ''}
            <ChevronIcon open={actionsOpen} />
          </button>
        </div>

        {preset === 'custom' && (
          <div className="act-custom-range">
            <input
              type="date"
              className="act-date-input"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
            />
            <span className="act-range-sep">–</span>
            <input
              type="date"
              className="act-date-input"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
            />
          </div>
        )}

        <div className="act-filter-row">
          <select
            className="stg-select act-actor-select"
            value={actorId}
            onChange={e => setActorId(e.target.value)}
          >
            <option value="">Tüm kullanıcılar</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.display_name}</option>
            ))}
          </select>
          <input
            type="text"
            className="act-q-input"
            placeholder="Öğrenci adı..."
            value={qInput}
            onChange={e => setQInput(e.target.value)}
          />
        </div>

        {actionsOpen && (
          <div className="act-action-panel">
            {Object.entries(ACTION_GROUPS).map(([group, actions]) => (
              <div key={group} className="act-action-group">
                <span className="act-action-group-label">{group}</span>
                <div className="act-action-pills">
                  {actions.map(action => (
                    <button
                      key={action}
                      type="button"
                      className={'act-action-pill' + (selectedActions.includes(action) ? ' is-active' : '')}
                      onClick={() => toggleAction(action)}
                    >
                      {ACTION_LABELS[action] ?? action}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {selCount > 0 && (
              <button
                type="button"
                className="act-clear-filters"
                onClick={() => setSelectedActions([])}
              >
                Tümünü temizle
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Error ── */}
      {error && <div className="stg-feedback stg-feedback-err">{error}</div>}

      {/* ── List ── */}
      {!error && (
        <div className="act-list">
          {loading && entries.length === 0 && <SkeletonRows />}

          {!loading && entries.length === 0 && (
            <div className="act-empty">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="act-empty-icon" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.4" />
                <path d="M7 9h10M7 12h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              <span>Bu aralıkta kayıt bulunamadı.</span>
            </div>
          )}

          {entries.map(entry => (
            <AuditRow key={entry.id} entry={entry} onUncompleted={() => setVersion(v => v + 1)} />
          ))}

          {loading && entries.length > 0 && (
            <div className="act-list-loading">Yükleniyor…</div>
          )}
        </div>
      )}

      {hasMore && !loading && (
        <button
          type="button"
          className="btn btn-ghost act-load-more"
          onClick={() => loadPage(page + 1)}
        >
          Daha fazla yükle
        </button>
      )}
    </div>
  );
}
