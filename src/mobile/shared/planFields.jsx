import React from 'react';

export const LABEL_COLORS = ['graphite', 'slate', 'plum', 'teal'];

export const DURATION_STEP = 30;
export const DURATION_MIN = 30;
export const DURATION_MAX = 480;

export function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} dk`;
  if (m === 0) return `${h} sa`;
  return `${h} sa ${m} dk`;
}

export function Toggle({ on, onClick }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={'pl-sw' + (on ? ' on' : '')} onClick={onClick}>
      <span className="pl-sw-knob" />
    </button>
  );
}

export function DurationStepper({ value, onChange }) {
  function dec() { onChange(Math.max(DURATION_MIN, value - DURATION_STEP)); }
  function inc() { onChange(Math.min(DURATION_MAX, value + DURATION_STEP)); }
  return (
    <div className="pl-duration-stepper">
      <button
        type="button"
        className="pl-duration-btn"
        onClick={dec}
        disabled={value <= DURATION_MIN}
        aria-label="Süreyi azalt"
      >
        –
      </button>
      <span className="pl-duration-val">{formatDuration(value)}</span>
      <button
        type="button"
        className="pl-duration-btn"
        onClick={inc}
        disabled={value >= DURATION_MAX}
        aria-label="Süreyi artır"
      >
        +
      </button>
    </div>
  );
}

export function LabelColorDots({ value, onChange }) {
  return (
    <div className="pl-dots">
      {LABEL_COLORS.map(c => (
        <button
          key={c}
          type="button"
          className={'pl-dot pl-dot-' + c + (value === c ? ' sel' : '')}
          onClick={() => onChange(c)}
          aria-label={c}
        />
      ))}
    </div>
  );
}
