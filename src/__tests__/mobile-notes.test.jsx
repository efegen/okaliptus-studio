import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { MobileNotes } from '../mobile/MobileNotes';
import { CurrentUserProvider } from '../currentUser';
import * as api from '../api';

vi.mock('../api', () => ({
  getNotes: vi.fn(),
  getNoteCategories: vi.fn(),
  createNoteCategory: vi.fn(),
  updateNoteCategory: vi.fn(),
  deleteNoteCategory: vi.fn(),
  getStudents: vi.fn(),
  getNoteReminderRecipients: vi.fn(),
  addNote: vi.fn(),
  updateNote: vi.fn(),
  deleteNote: vi.fn(),
  toggleNoteReaction: vi.fn(),
  uploadNoteImage: vi.fn(),
  getNoteImage: vi.fn(),
}));

vi.mock('../imageCompress', () => ({
  compressToBoundedWebp: vi.fn(async () => new Blob(['webp'], { type: 'image/webp' })),
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
    category: null,
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
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:note-photo') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    Object.defineProperty(window, 'confirm', { configurable: true, value: vi.fn(() => true) });
    api.getStudents.mockResolvedValue([{ id: '7', full_name: 'Ada Yılmaz', nickname: null }]);
    api.getNoteReminderRecipients.mockResolvedValue([
      { id: '10', displayName: 'Efe', role: 'admin' },
      { id: '11', displayName: 'Ceren', role: 'instructor' },
    ]);
    api.getNoteCategories.mockResolvedValue([
      { id: '21', name: 'Operasyon', note_count: 1 },
      { id: '22', name: 'Hatırlatma', note_count: 0 },
    ]);
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
    expect(screen.getByText('En yeni yanıt').closest('.evx-note-thread')).toBeInTheDocument();
    expect(screen.getByText('En yeni yanıt').closest('.evx-note-card')).toHaveClass('is-reply');
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
    expect(reactionButtons[0]).toHaveTextContent('');
    const reaction = screen.getByRole('button', { name: '👍 tepkisi, 1 kişi' });
    expect(reaction).toHaveTextContent('👍1');
    expect(reaction.closest('.evx-note-reaction-strip')).toBeInTheDocument();
    expect(reaction.closest('.evx-note-actionbar')).toBeInTheDocument();
    fireEvent.click(reactionButtons[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Beğen' }));

    await waitFor(() => expect(api.toggleNoteReaction).toHaveBeenCalledWith('1', '👍'));
    expect(await screen.findByRole('button', { name: '👍 tepkisi, 2 kişi' })).toHaveClass('is-mine');
  });

  it('tepki düğmesini yanıtla düğmesinden önce gösterir', async () => {
    renderNotes();

    const reactionButton = (await screen.findAllByRole('button', { name: 'Tepki ekle' }))[0];
    const actionGroup = reactionButton.closest('.evx-note-actionbar');
    expect(actionGroup.children[0]).toContainElement(reactionButton);
    expect(actionGroup.children[1]).toHaveTextContent('Yanıtla');
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
    fireEvent.click(await screen.findByRole('button', { name: /Not yaz/ }));
    expect(screen.getByRole('button', { name: 'Fotoğraf ekle' })).toBeInTheDocument();
  });

  it('ayarlar butonundan not kategorisi ekler', async () => {
    api.createNoteCategory.mockResolvedValue({ id: '23', name: 'Malzeme', note_count: 0 });
    renderNotes();

    fireEvent.click(await screen.findByRole('button', { name: 'Not kategorilerini düzenle' }));
    expect(screen.getByText('Not kategorileri')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Yeni kategori'), { target: { value: 'Malzeme' } });
    fireEvent.click(screen.getByRole('button', { name: /Ekle/ }));

    await waitFor(() => expect(api.createNoteCategory).toHaveBeenCalledWith('Malzeme'));
  });

  it('kategori ayarlarından kategoriyi siler; notların korunacağını onay metninde belirtir', async () => {
    renderNotes();

    fireEvent.click(await screen.findByRole('button', { name: 'Not kategorilerini düzenle' }));
    expect(await screen.findByText('Operasyon')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Operasyon kategorisini sil' }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Notlar silinmez'));
    await waitFor(() => expect(api.deleteNoteCategory).toHaveBeenCalledWith('21'));
  });

  it('özel kategoriyle notları filtreler', async () => {
    api.getNotes.mockResolvedValue([
      note({ id: '30', body: 'Operasyon notu', category: { id: '21', name: 'Operasyon' } }),
      note({ id: '31', body: 'Kategorisiz not', author_user_id: '11' }),
    ]);
    renderNotes();

    fireEvent.click(await screen.findByRole('button', { name: 'Operasyon' }));
    expect(screen.getByText('Operasyon notu')).toBeInTheDocument();
    expect(screen.queryByText('Kategorisiz not')).not.toBeInTheDocument();
  });

  it('yeni notta yalnız bir kategori seçer ve son seçimi kaydeder', async () => {
    api.addNote.mockResolvedValue(note({
      id: '32',
      body: 'Yeni operasyon notu',
      category: { id: '22', name: 'Hatırlatma' },
    }));
    renderNotes();

    fireEvent.click(await screen.findByRole('button', { name: /Not yaz/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Operasyon' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hatırlatma' }));
    expect(screen.getByRole('button', { name: 'Operasyon' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Hatırlatma' })).toHaveAttribute('aria-pressed', 'true');
    const editor = screen.getByRole('textbox');
    editor.textContent = 'Yeni operasyon notu';
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole('button', { name: 'Paylaş' }));

    await waitFor(() => expect(api.addNote).toHaveBeenCalledWith({
      body: 'Yeni operasyon notu',
      mentionedStudentIds: [],
      categoryId: '22',
    }));
  });

  it('kategori seçmeden not eklenebilir', async () => {
    api.addNote.mockResolvedValue(note({ id: '33', body: 'Kategorisiz yeni not' }));
    renderNotes();

    fireEvent.click(await screen.findByRole('button', { name: /Not yaz/ }));
    const editor = screen.getByRole('textbox');
    editor.textContent = 'Kategorisiz yeni not';
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole('button', { name: 'Paylaş' }));

    await waitFor(() => expect(api.addNote).toHaveBeenCalledWith({
      body: 'Kategorisiz yeni not',
      mentionedStudentIds: [],
      categoryId: null,
    }));
  });

  it('yanıta fotoğraf ekleyip yanıt kaydından sonra yükler', async () => {
    api.addNote.mockResolvedValue(note({ id: '9', body: 'Fotoğraflı yanıt', parent_note_id: '1' }));
    api.uploadNoteImage.mockResolvedValue(note({ id: '9', body: 'Fotoğraflı yanıt', parent_note_id: '1', has_image: true }));
    renderNotes();

    fireEvent.click(await screen.findByRole('button', { name: 'Yanıtla' }));
    const photoButton = screen.getByRole('button', { name: 'Fotoğraf ekle' });
    const composer = photoButton.closest('.evx-note-composer');
    const editor = composer.querySelector('[role="textbox"]');
    editor.textContent = 'Fotoğraflı yanıt';
    fireEvent.input(editor);
    fireEvent.change(composer.querySelector('input[type="file"]'), {
      target: { files: [new File(['image'], 'yanit.jpg', { type: 'image/jpeg' })] },
    });

    await screen.findByAltText('Eklenecek fotoğraf');
    fireEvent.click(screen.getByRole('button', { name: 'Gönder' }));

    await waitFor(() => expect(api.addNote).toHaveBeenCalledWith({
      body: 'Fotoğraflı yanıt',
      parentNoteId: '1',
      mentionedStudentIds: [],
    }));
    expect(api.uploadNoteImage).toHaveBeenCalledWith('9', expect.any(Blob));
  });

  it('yeni notta kişi, hızlı zaman ve özel tarih-saat içeren hatırlatıcı önizlemesi sunar', async () => {
    renderNotes();
    fireEvent.click(await screen.findByRole('button', { name: /Not yaz/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Hatırlatıcı ekle' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Efe/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Ceren/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Yarın' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1 hafta sonra' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1 ay sonra' })).toBeInTheDocument();
    expect(screen.getByLabelText('Tarih')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('Saat')).toHaveAttribute('type', 'time');

    fireEvent.click(screen.getByRole('button', { name: /Ceren/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Ekle' }));

    expect(await screen.findByText('2 kişiye hatırlatılacak')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hatırlatıcıyı kaldır' })).toBeInTheDocument();
  });

  it('hatırlatıcılı notu paylaşınca reminder verisini addNote isteğine ekler', async () => {
    api.addNote.mockResolvedValue(note({ id: '40', body: 'Hatırlatıcılı not' }));
    const { container } = renderNotes();
    fireEvent.click(await screen.findByRole('button', { name: /Not yaz/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Hatırlatıcı ekle' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: '1 hafta sonra' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ekle' }));
    await screen.findByText('Sana hatırlatılacak');

    // vaul'un kapanış geçişi jsdom'da hiç tamamlanmadığından Drawer DOM'da
    // kalır ve "hide others" a11y deseniyle geri kalan her şeyi aria-hidden
    // yapar — bu yüzden burada getByRole yerine ham DOM sorgusu kullanılır
    // (fireEvent, erişilebilirlik durumundan bağımsız çalışır).
    const editor = container.querySelector('[role="textbox"]');
    editor.textContent = 'Hatırlatıcılı not';
    fireEvent.input(editor);
    fireEvent.click(container.querySelector('.evx-note-add-btn'));

    await waitFor(() => expect(api.addNote).toHaveBeenCalled());
    const payload = api.addNote.mock.calls[0][0];
    expect(payload.reminder.recipientUserIds).toEqual(['10']);
    expect(new Date(payload.reminder.remindAt).getHours()).toBe(12);
  });
});
