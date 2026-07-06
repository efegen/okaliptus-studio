import React from 'react';
import { Avatar } from '../../layout';
import { MobileStudentCombobox } from './MobileStudentCombobox';

// Plan katılımcı seçici (mobil). Öğrenciler arasından çoklu seçim — katılımcı
// olmak finansal DEĞİLDİR (borç/ders yaratmaz), bilgi amaçlı bir isim
// listesidir. MobileStudentCombobox'ı tek-seçim modunda (selected=null) sürekli
// arama kutusu olarak kullanır; seçilenler üstte çip olarak durur.
// value: [{ id, name, nickname }]
export function MobilePlanParticipantsField({ students, value, onChange, loading }) {
  const selectedIds = new Set(value.map(p => String(p.id)));
  const available = students.filter(s => !selectedIds.has(String(s.id)));

  function add(s) {
    onChange([...value, { id: s.id, name: s.full_name, nickname: s.nickname || null }]);
  }
  function remove(id) {
    onChange(value.filter(p => String(p.id) !== String(id)));
  }

  return (
    <div className="mpp-field">
      {value.length > 0 && (
        <div className="mpp-chips">
          {value.map(p => (
            <span key={p.id} className="mpp-chip">
              <Avatar name={p.name} size="xs" soft />
              <span className="mpp-chip-name">{p.name}</span>
              <button
                type="button"
                className="mpp-chip-x"
                onClick={() => remove(p.id)}
                aria-label={`${p.name} çıkar`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <MobileStudentCombobox
        students={available}
        selected={null}
        onSelect={add}
        onClear={() => {}}
        loading={loading}
        placeholder="Katılımcı ara…"
      />
    </div>
  );
}

// Plan detayında katılımcıların salt-okunur listesi.
export function MobilePlanParticipantsRoster({ participants }) {
  return (
    <div className="mpp-roster">
      {participants.map(p => (
        <div key={p.id} className="mpp-roster-item">
          <Avatar name={p.name} size="sm" soft />
          <span className="mpp-roster-name">
            {p.name}
            {p.nickname && <span className="mpp-roster-nick"> ({p.nickname})</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
