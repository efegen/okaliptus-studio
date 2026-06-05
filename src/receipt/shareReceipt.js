// Makbuz PNG'sini paylaşır. Mobilde Web Share API ile native paylaşım sayfası
// (WhatsApp vb.) açılır; desteklenmeyen yerde (masaüstü tarayıcılar) dosya
// otomatik indirilir.

export function receiptFilename(model) {
  const no = (model?.receiptNo || 'makbuz').replace(/[^\w-]/g, '');
  return `Okaliptus-Makbuz-${no}.png`;
}

export async function shareReceipt(blob, filename, { title, text } = {}) {
  const file = new File([blob], filename, { type: 'image/png' });

  const canShareFiles =
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    typeof navigator.share === 'function' &&
    navigator.canShare({ files: [file] });

  if (canShareFiles) {
    try {
      await navigator.share({ files: [file], title, text });
      return { method: 'share' };
    } catch (err) {
      // Kullanıcı paylaşım sayfasını kapattıysa indirme yapma.
      if (err && err.name === 'AbortError') return { method: 'cancelled' };
      // Diğer hatalarda indirmeye düş.
    }
  }

  downloadBlob(blob, filename);
  return { method: 'download' };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
