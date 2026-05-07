import React from 'react';

export function ProductSaleCategoryChips({ chips, totalCount, activeCategory, onChange }) {
  return (
    <div className="mobile-psale-cats" role="tablist" aria-label="Kategori filtresi">
      <button
        type="button"
        role="tab"
        className={'mobile-psale-cat-chip' + (activeCategory === null ? ' is-active' : '')}
        onClick={() => onChange(null)}
        aria-pressed={activeCategory === null}
      >
        Tümü
        <span className="mobile-psale-cat-count">{totalCount}</span>
      </button>
      {chips.map(c => (
        <button
          key={c.category}
          type="button"
          role="tab"
          className={'mobile-psale-cat-chip' + (activeCategory === c.category ? ' is-active' : '')}
          onClick={() => onChange(c.category)}
          aria-pressed={activeCategory === c.category}
        >
          {c.category}
          <span className="mobile-psale-cat-count">{c.count}</span>
        </button>
      ))}
    </div>
  );
}
