import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { MobileNotes } from '../mobile/MobileNotes';
import { CurrentUserProvider } from '../currentUser';
import * as api from '../api';

vi.mock('../api', () => ({
  getNotes: vi.fn(),
  getStudents: vi.fn(),
  addNote: vi.fn(),
  updateNote: vi.fn(),
  deleteNote: vi.fn(),
  toggleNoteReaction: vi.fn(),
  uploadNoteImage: vi.fn(),
  getNoteImage: vi.fn(),
}));

const now = '2026-09-05T10:00:00.000Z';

function note(overrides) {
  return {
    id: '1',
    author_user_id: '10',
    author_name: 'Efe',
    body: 'Ana not',
    parent_note_id: null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    mentions: [],
    reactions: [],
    has_image: false,
    image_updated_at: null,
    ...overrides,
  };
}

function renderNotes(props = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CurrentUserProvider user={{ id: '10', displayName: 'Efe', role: 'admin' }}>
        <MobileNotes onBack={() => {}} {...props} />
      </CurrentUserProvider>
    </QueryClientProvider>,
  );
}

describe('Mobil notlar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getStudents.mockResolvedValue([{ id: '7', full_name: 'Ada Yılmaz', nickname: null }]);
    api.getNotes.mockResolvedValue([
      note({ id: '4', author_user_id: '11', author_name: 'Ceren', body: 'En yeni yanıt', parent_note_id: '1', created_at: '2026-09-05T10:04:00.000Z' }),
      note({ id: '3', author_user_id: '11', author_name: 'Ceren', body: 'Ortadaki yanıt', parent_note_id: '1', created_at: '2026-09-05T10:03:00.000Z' }),
      note({ id: '2', author_user_id: '11', author_name: 'Ceren', body: 'İlk yanıt', parent_note_id: '1', created_at: '2026-09-05T10:02:00.000Z' }),
      note({
        id: '1',
        body: '@Ada Yılmaz bugün gelecek.',
        mentions: [{ studentId: '7', name: 'Ada Yılmaz' }],
        reactions: [{ emoji: '👍', count: 1, reactedByMe: false }],
      }),
    ]);
  });

  it('çoklu yanıtları en güncel yanıt dışında daraltır ve istenince açar', async () => {
    renderNotes();

    expect(await screen.findByText('En yeni yanıt')).toBeInTheDocument();
    expect(screen.queryByText('İlk yanıt')).not.toBeInTheDocument();
    expect(screen.queryByText('Ortadaki yanıt')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '3 yanıt · Tümünü göster' }));
    expect(screen.getByText('İlk yanıt')).toBeInTheDocument();
    expect(screen.getByText('Ortadaki yanıt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yanıtları gizle' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('öğrenci etiketini @ olmadan profil bağlantısı yapar', async () => {
    const onOpenStudent = vi.fn();
    renderNotes({ onOpenStudent });

    const mention = await screen.findByRole('button', { name: 'Ada Yılmaz' });
    expect(mention).not.toHaveTextContent('@');
    fireEvent.click(mention);
    expect(onOpenStudent).toHaveBeenCalledWith('7');
  });

  it('emoji seçimini API üzerinden toggle edip sayacı günceller', async () => {
    api.toggleNoteReaction.mockResolvedValue(note({
      id: '1',
      body: '@Ada Yılmaz bugün gelecek.',
      mentions: [{ studentId: '7', name: 'Ada Yılmaz' }],
      reactions: [{ emoji: '👍', count: 2, reactedByMe: true }],
    }));
    renderNotes();

    const reactionButtons = await screen.findAllByRole('button', { name: 'Tepki ekle' });
    expect(reactionButtons[0].querySelector('svg')).toBeInTheDocument();
    expect(reactionButtons[0]).toHaveTextContent('Tepki');
    const reaction = screen.getByRole('button', { name: '👍 tepkisi, 1 kişi' });
    expect(reaction.closest('.evx-note-reaction-strip')).toBeInTheDocument();
    expect(reaction.closest('.evx-note-actionbar')).not.toBeInTheDocument();
    fireEvent.click(reactionButtons[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Beğen' }));

    await waitFor(() => expect(api.toggleNoteReaction).toHaveBeenCalledWith('1', '👍'));
    expect(await screen.findByRole('button', { name: '👍 tepkisi, 2 kişi' })).toHaveClass('is-mine');
  });

  it('emoji seçicisini dışarı dokununca ve Escape ile kapatır', async () => {
    renderNotes();

    const reactionButton = (await screen.findAllByRole('button', { name: 'Tepki ekle' }))[0];
    fireEvent.click(reactionButton);
    expect(screen.getByLabelText('Emoji tepkisi seç')).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByLabelText('Emoji tepkisi seç')).not.toBeInTheDocument();

    fireEvent.click(reactionButton);
    expect(screen.getByLabelText('Emoji tepkisi seç')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByLabelText('Emoji tepkisi seç')).not.toBeInTheDocument();
    expect(reactionButton).toHaveFocus();
  });

  it('kendi notundaki düzenle ve sil eylemlerini üç nokta menüsünde toplar', async () => {
    renderNotes();

    const moreButton = await screen.findByRole('button', { name: 'Not işlemleri' });
    expect(screen.queryByRole('menuitem', { name: 'Düzenle' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Sil' })).not.toBeInTheDocument();

    fireEvent.click(moreButton);
    expect(screen.getByRole('menuitem', { name: 'Düzenle' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Sil' })).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menuitem', { name: 'Düzenle' })).not.toBeInTheDocument();
  });

  it('yeni not composerında fotoğraf ekleme kontrolünü gösterir', async () => {
    renderNotes();
    fireEvent.click(await screen.findByRole('button', { name: /Not ekle/ }));
    expect(screen.getByRole('button', { name: 'Fotoğraf ekle' })).toBeInTheDocument();
  });

  it('yeni notta kişi, hızlı zaman ve özel tarih-saat içeren hatırlatıcı önizlemesi sunar', async () => {
    renderNotes();
    fireEvent.click(await screen.findByRole('button', { name: /Not ekle/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Hatırlatıcı ekle' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Efe/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Ceren/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('Tarih')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('Saat')).toHaveAttribute('type', 'time');

    fireEvent.click(screen.getByRole('button', { name: /Ceren/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Ekle' }));

    expect(await screen.findByText('2 kişiye hatırlatılacak')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hatırlatıcıyı kaldır' })).toBeInTheDocument();
  });
});
