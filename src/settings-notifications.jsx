import React from 'react';
import {
  getNotificationSettings,
  updateNotificationSettingApi,
  sendTestNotificationApi,
  getUsers,
} from './api';
import { Toggle } from './settings';
import { roleLabel } from './permissions';

// Ayarlar → Bildirimler sekmesi (owner-only). Backend: /notification-settings.
// Her tür için: aç/kapa, KİŞİ-bazlı alıcılar, zamanlama, metin şablonu, test
// gönder. Ayrıca genel "sessiz saatler" kartı. settings-users.jsx gibi kendi
// kendine yeten (plain useState/useEffect) — TanStack Query kullanmaz.

const NOTIF_META = {
  lesson_reminder: {
    title: 'Ders başlıyor',
    desc: 'Ders başlamadan önce hatırlatma. İki yuva: erken ve geç.',
    vars: ['{student}', '{minutes}'],
    kind: 'reminder',
  },
  stale_lesson: {
    title: 'Ders durumu bekliyor',
    desc: 'Üzerinden süre geçmiş ama hâlâ "planlandı" duran ders için dürtme.',
    vars: ['{student}', '{time}'],
    kind: 'stale',
  },
  new_order: {
    title: 'Yeni sipariş',
    desc: 'Trendyol’dan yeni sipariş geldiğinde.',
    vars: ['{customer}', '{order}'],
    kind: 'event',
  },
  note_reminder: {
    title: 'Not hatırlatması',
    desc: 'Notlar akışında birinin eklediği hatırlatıcının zamanı gelince. Alıcılar burada değil, hatırlatıcı oluşturulurken notu yazan kişi tarafından seçilir — burada yalnız metin ayarlanır.',
    vars: ['{author}', '{note}'],
    kind: 'event',
    hideRecipients: true,
  },
};
const ORDER = ['lesson_reminder', 'stale_lesson', 'new_order', 'note_reminder'];

function slotOr(s, d) {
  const o = s || {};
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : d.enabled,
    minutes: o.minutes ?? d.minutes,
    suppressIfBusy: typeof o.suppressIfBusy === 'boolean' ? o.suppressIfBusy : d.suppressIfBusy,
  };
}

function normalizeCfg(key, config) {
  const c = config || {};
  if (key === 'lesson_reminder') {
    return {
      early: slotOr(c.early, { enabled: true, minutes: 30, suppressIfBusy: true }),
      late: slotOr(c.late, { enabled: true, minutes: 10, suppressIfBusy: false }),
      titleTemplate: c.titleTemplate ?? 'Ders başlıyor',
      bodyTemplate: c.bodyTemplate ?? '{student} ile dersiniz {minutes} dakika sonra başlıyor.',
    };
  }
  if (key === 'stale_lesson') {
    return {
      thresholdMinutes: c.thresholdMinutes ?? 120,
      titleTemplate: c.titleTemplate ?? 'Ders durumu bekliyor',
      bodyTemplate: c.bodyTemplate ?? '{student} ile {time} dersi hâlâ "planlandı" — gerçekleşti mi? Durumu işaretle.',
    };
  }
  return {
    titleTemplate: c.titleTemplate ?? 'Yeni sipariş',
    bodyTemplate: c.bodyTemplate ?? 'Trendyol’dan yeni sipariş: {customer} — #{order}',
  };
}

function cfgToPayload(key, cfg) {
  if (key === 'lesson_reminder') {
    return {
      early: { enabled: cfg.early.enabled, minutes: Number(cfg.early.minutes), suppressIfBusy: cfg.early.suppressIfBusy },
      late: { enabled: cfg.late.enabled, minutes: Number(cfg.late.minutes), suppressIfBusy: cfg.late.suppressIfBusy },
      titleTemplate: cfg.titleTemplate,
      bodyTemplate: cfg.bodyTemplate,
    };
  }
  if (key === 'stale_lesson') {
    return {
      thresholdMinutes: Number(cfg.thresholdMinutes),
      titleTemplate: cfg.titleTemplate,
      bodyTemplate: cfg.bodyTemplate,
    };
  }
  return { titleTemplate: cfg.titleTemplate, bodyTemplate: cfg.bodyTemplate };
}

export function NotificationsPanel() {
  const [rows, setRows] = React.useState(null);
  const [users, setUsers] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([getNotificationSettings(), getUsers()])
      .then(([s, u]) => {
        if (!alive) return;
        setRows(s);
        setUsers(u.filter((x) => x.isActive));
        setError(null);
      })
      .catch((e) => { if (alive) setError(e.message || 'Yüklenemedi.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) return <div className="ntf-state">Yükleniyor…</div>;
  if (error) return <div className="ntf-state ntf-state-err">{error}</div>;
  if (!rows) return null;

  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  const applyRow = (updated) =>
    setRows((prev) => prev.map((r) => (r.key === updated.key ? updated : r)));

  return (
    <div className="ntf-panel">
      <p className="ntf-intro">
        Bildirimlerin <strong>kime</strong>, <strong>ne zaman</strong> ve hangi <strong>metinle</strong> gideceğini
        buradan ayarla. Alıcılar kişi bazında seçilir. Her kart ayrı kaydedilir.
      </p>
      {ORDER.map((key) => byKey[key] && (
        <NotifCard key={key} row={byKey[key]} users={users} onSaved={applyRow} />
      ))}
      {byKey['_global'] && <QuietHoursCard row={byKey['_global']} onSaved={applyRow} />}
    </div>
  );
}

function SlotRow({ label, slot, onChange }) {
  return (
    <div className="ntf-slot">
      <label className="ntf-slot-on">
        <input
          type="checkbox"
          checked={slot.enabled}
          onChange={(e) => onChange({ ...slot, enabled: e.target.checked })}
        />
        {label}
      </label>
      <input
        type="number"
        min="1"
        max="720"
        className="ntf-num"
        value={slot.minutes}
        disabled={!slot.enabled}
        onChange={(e) => onChange({ ...slot, minutes: e.target.value })}
      />
      <span className="ntf-unit">dk önce</span>
      <label className="ntf-slot-sup">
        <input
          type="checkbox"
          checked={slot.suppressIfBusy}
          disabled={!slot.enabled}
          onChange={(e) => onChange({ ...slot, suppressIfBusy: e.target.checked })}
        />
        Arka arkaya derste bastır
      </label>
    </div>
  );
}

function NotifCard({ row, users, onSaved }) {
  const meta = NOTIF_META[row.key];
  const [enabled, setEnabled] = React.useState(row.enabled);
  const [recipients, setRecipients] = React.useState(() => new Set(row.recipientUserIds.map(String)));
  const [cfg, setCfg] = React.useState(() => normalizeCfg(row.key, row.config));
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [msg, setMsg] = React.useState(null);
  const [err, setErr] = React.useState(null);

  function toggleRecipient(id) {
    setRecipients((prev) => {
      const next = new Set(prev);
      const k = String(id);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  async function save() {
    setSaving(true); setErr(null); setMsg(null);
    try {
      const updated = await updateNotificationSettingApi(row.key, {
        enabled,
        recipientUserIds: Array.from(recipients),
        config: cfgToPayload(row.key, cfg),
      });
      onSaved(updated);
      setMsg('Kaydedildi.');
    } catch (e) {
      setErr(e.message || 'Kaydedilemedi.');
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true); setErr(null); setMsg(null);
    try {
      const res = await sendTestNotificationApi(row.key);
      const sent = res?.sent ?? 0;
      setMsg(sent > 0
        ? `Test gönderildi (${sent} cihaz).`
        : 'Gönderilecek abonelik yok — bu cihazda Genel sekmesinden bildirimleri aç.');
    } catch (e) {
      setErr(e.message || 'Test gönderilemedi.');
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className={'ntf-card' + (enabled ? '' : ' is-off')}>
      <div className="ntf-card-head">
        <div className="ntf-card-headtx">
          <h3 className="ntf-card-title">{meta.title}</h3>
          <p className="ntf-card-desc">{meta.desc}</p>
        </div>
        <Toggle checked={enabled} onChange={setEnabled} />
      </div>

      {!meta.hideRecipients && (
        <div className="ntf-field">
          <label className="ntf-label">Kimler alsın</label>
          {users.length === 0 ? (
            <p className="ntf-hint">Aktif kullanıcı yok.</p>
          ) : (
            <div className="ntf-recips">
              {users.map((u) => (
                <label key={u.id} className="ntf-recip">
                  <input
                    type="checkbox"
                    checked={recipients.has(String(u.id))}
                    onChange={() => toggleRecipient(u.id)}
                  />
                  <span className="ntf-recip-name">{u.displayName}</span>
                  <span className="ntf-recip-role">{roleLabel(u.role)}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {meta.kind === 'reminder' && (
        <div className="ntf-field">
          <label className="ntf-label">Zamanlama</label>
          <SlotRow label="Erken" slot={cfg.early} onChange={(s) => setCfg((c) => ({ ...c, early: s }))} />
          <SlotRow label="Geç" slot={cfg.late} onChange={(s) => setCfg((c) => ({ ...c, late: s }))} />
          <p className="ntf-hint">“Arka arkaya derste bastır”: hatırlatma anında eğitmen başka derste ise o hatırlatma gönderilmez.</p>
        </div>
      )}

      {meta.kind === 'stale' && (
        <div className="ntf-field">
          <label className="ntf-label">Eşik süresi (dakika)</label>
          <input
            type="number"
            min="1"
            max="10080"
            className="ntf-num"
            value={cfg.thresholdMinutes}
            onChange={(e) => setCfg((c) => ({ ...c, thresholdMinutes: e.target.value }))}
          />
          <p className="ntf-hint">Ders başlangıcından bu kadar dakika sonra hâlâ “planlandı” ise dürter (120 = 2 saat).</p>
        </div>
      )}

      <div className="ntf-field">
        <label className="ntf-label">Başlık</label>
        <input
          className="ntf-text"
          value={cfg.titleTemplate}
          onChange={(e) => setCfg((c) => ({ ...c, titleTemplate: e.target.value }))}
        />
        <label className="ntf-label">Metin</label>
        <textarea
          className="ntf-area"
          rows={2}
          value={cfg.bodyTemplate}
          onChange={(e) => setCfg((c) => ({ ...c, bodyTemplate: e.target.value }))}
        />
        <p className="ntf-hint">Kullanılabilir değişkenler: {meta.vars.join(' · ')}</p>
      </div>

      <div className="ntf-actions">
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Kaydediliyor…' : 'Kaydet'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={test} disabled={testing}>
          {testing ? 'Gönderiliyor…' : 'Test gönder'}
        </button>
        {msg && <span className="ntf-ok">{msg}</span>}
        {err && <span className="ntf-err">{err}</span>}
      </div>
    </div>
  );
}

function QuietHoursCard({ row, onSaved }) {
  const cfg = row.config || {};
  const [enabled, setEnabled] = React.useState(row.enabled);
  const [start, setStart] = React.useState(cfg.quietHoursStart || '22:00');
  const [end, setEnd] = React.useState(cfg.quietHoursEnd || '08:00');
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState(null);
  const [err, setErr] = React.useState(null);

  async function save() {
    setSaving(true); setErr(null); setMsg(null);
    try {
      const updated = await updateNotificationSettingApi('_global', {
        enabled,
        config: { quietHoursStart: start, quietHoursEnd: end },
      });
      onSaved(updated);
      setMsg('Kaydedildi.');
    } catch (e) {
      setErr(e.message || 'Kaydedilemedi.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={'ntf-card' + (enabled ? '' : ' is-off')}>
      <div className="ntf-card-head">
        <div className="ntf-card-headtx">
          <h3 className="ntf-card-title">Sessiz saatler</h3>
          <p className="ntf-card-desc">Bu aralıkta hiçbir bildirim gönderilmez; pencere bitince ertelenenler gider.</p>
        </div>
        <Toggle checked={enabled} onChange={setEnabled} />
      </div>
      <div className="ntf-field ntf-quiet">
        <label className="ntf-label">Başlangıç</label>
        <input type="time" className="ntf-time" value={start} disabled={!enabled} onChange={(e) => setStart(e.target.value)} />
        <label className="ntf-label">Bitiş</label>
        <input type="time" className="ntf-time" value={end} disabled={!enabled} onChange={(e) => setEnd(e.target.value)} />
      </div>
      <div className="ntf-actions">
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Kaydediliyor…' : 'Kaydet'}
        </button>
        {msg && <span className="ntf-ok">{msg}</span>}
        {err && <span className="ntf-err">{err}</span>}
      </div>
    </div>
  );
}
