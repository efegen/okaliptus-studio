// Telefonla çekilen fotoğrafı yüklemeden önce tarayıcıda küçültür.
//
// Neden: ham telefon fotosu 3-5MB. Sunucuya/Postgres'e olduğu gibi koymak hem
// maliyet hem yavaşlık. Burada ~800x800 kareye kırpıp WebP q0.75 ile sıkıştırınca
// dosya ~30-80KB'a iner. Kare kırpma, katalogdaki object-fit:cover kutusuyla
// birebir uyumlu görünüm verir (Trendyol'un kare studio fotolarıyla tutarlı).
//
// Bağımlılık yok: createImageBitmap (EXIF orientation'a saygılı) + canvas.toBlob.

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

async function loadDrawable(file) {
  // createImageBitmap EXIF orientation'ı uygular (telefon fotoları yan dönük gelmez).
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, cleanup: () => bmp.close?.() };
    } catch {
      try {
        const bmp = await createImageBitmap(file);
        return { source: bmp, width: bmp.width, height: bmp.height, cleanup: () => bmp.close?.() };
      } catch {
        /* createImageBitmap yoksa/başarısızsa <img> fallback'e geç */
      }
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Görsel yüklenemedi.'));
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      cleanup: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

// file: File/Blob (kameradan veya dosya seçiciden). Dönüş: sıkıştırılmış Blob
// (.type === 'image/webp' ya da fallback 'image/jpeg').
export async function compressToSquareWebp(file, options = {}) {
  const size = options.size ?? 800;
  const quality = options.quality ?? 0.75;

  const { source, width, height, cleanup } = await loadDrawable(file);
  try {
    const side = Math.min(width, height);
    if (!side || !Number.isFinite(side)) {
      throw new Error('Görsel boyutu okunamadı.');
    }
    const sx = (width - side) / 2;
    const sy = (height - side) / 2;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Bu tarayıcı görsel sıkıştırmayı desteklemiyor.');

    // PNG şeffaflığı WebP/JPEG'de siyah görünmesin diye beyaz zemin.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(source, sx, sy, side, side, 0, 0, size, size);

    let blob = await canvasToBlob(canvas, 'image/webp', quality);
    if (!blob || blob.size === 0) {
      blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    }
    if (!blob || blob.size === 0) {
      throw new Error('Görsel sıkıştırılamadı.');
    }
    return blob;
  } finally {
    cleanup?.();
  }
}
