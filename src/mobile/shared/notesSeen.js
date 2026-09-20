// Ana sayfadaki "Notlar" kutusunda yeni not bildirimi için basit, cihaz
// bazlı okundu takibi. Backend'de okundu/okunmadı alanı yok — bu yalnız
// istemci tarafında en son görülen not id'sini localStorage'da tutar.
const STORAGE_KEY = 'mobileNotesLastSeenId';

export function getLastSeenNoteId() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setLastSeenNoteId(id) {
  if (id == null) return;
  try {
    localStorage.setItem(STORAGE_KEY, String(id));
  } catch {
    // localStorage kapalı/dolu olabilir — sessizce yut, bildirim tekrar görünür.
  }
}
