import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { PhotoViewer } from '../mobile/shared/PhotoViewer';

describe('PhotoViewer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState(null, '');
    if (!window.PointerEvent) window.PointerEvent = class PointerEvent extends MouseEvent {};
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function renderViewer(onClose = vi.fn()) {
    const utils = render(
      <div className="card"><PhotoViewer src="blob:x" alt="Foto" title="Elif Kaya" subtitle="Bugün 09:12" onClose={onClose} /></div>,
    );
    return { ...utils, onClose };
  }

  it('sayfa katmanlarının dışında, body altında başlık ve kapatma ile açılır', () => {
    const { container } = renderViewer();
    const dialog = screen.getByRole('dialog');
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.parentElement).toBe(document.body);
    expect(screen.getByText('Elif Kaya')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kapat' })).toBeInTheDocument();
    expect(window.history.state?.photoViewer).toBe(true);
  });

  it('Escape ve kapatma butonu history girdisini geri alarak kapatır', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    const { onClose } = renderViewer();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(back).toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(200); });
    expect(onClose).toHaveBeenCalledTimes(1);
    back.mockRestore();
  });

  it('telefonun geri tuşu (popstate) görüntüleyiciyi kapatır', () => {
    const { onClose } = renderViewer();
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
    act(() => { vi.advanceTimersByTime(200); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('çift dokunma yakınlaştırır, tekrar çift dokunma geri alır', () => {
    renderViewer();
    const img = screen.getByAltText('Foto');
    const stage = img.parentElement;
    const tap = () => {
      fireEvent.pointerDown(stage, { pointerId: 1, clientX: 50, clientY: 50 });
      fireEvent.pointerUp(stage, { pointerId: 1, clientX: 50, clientY: 50 });
    };
    tap(); tap();
    expect(img.style.transform).toContain('scale(2.5)');
    act(() => { vi.advanceTimersByTime(400); });
    tap(); tap();
    expect(img.style.transform).toContain('scale(1)');
  });
});
