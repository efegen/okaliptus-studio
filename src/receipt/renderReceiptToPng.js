import React from 'react';
import { createRoot } from 'react-dom/client';
import { ReceiptCard } from './ReceiptCard.jsx';
import { loadReceiptFonts } from './loadReceiptFonts.js';

// Normalize makbuz modelini ekran dışında mount edip PNG Blob'a rasterize eder.
//
// Taint güvenliği: ürün görselleri capture'dan ÖNCE same-origin data URL'e
// çözülür (urlToDataUrl). Bizim backend görselleri CORS açık → data URL olur;
// Trendyol/HB CDN görselleri (CORS yok) veya 404 → null → bej placeholder.
// Böylece modern-screenshot hiçbir cross-origin piksele dokunmaz ve tek bir
// kötü görsel tüm makbuzu (toBlob taint) bozamaz.

const FETCH_TIMEOUT_MS = 6000;

export async function renderReceiptToPng(model, { pixelRatio = 2 } = {}) {
  if (!model) throw new Error('Makbuz verisi yok.');
  const resolved = await resolveThumbnails(model);

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText =
    'position:fixed;left:-99999px;top:0;width:1080px;height:1350px;opacity:0;pointer-events:none;z-index:-1;';
  document.body.appendChild(host);
  const root = createRoot(host);

  try {
    const node = await new Promise((resolve) => {
      const innerRef = (el) => { if (el) resolve(el); };
      root.render(React.createElement(ReceiptCard, { model: resolved, innerRef }));
    });

    await loadReceiptFonts();
    await waitForImages(node);
    await doubleRaf();

    const { domToBlob } = await import('modern-screenshot');
    const opts = {
      width: 1080,
      height: 1350,
      scale: pixelRatio,
      backgroundColor: '#fbf8f1',
      type: 'image/png',
    };

    let blob = await domToBlob(node, opts);
    if (!blob || blob.size === 0) {
      // Nadiren ilk capture (foreignObject decode yarışı) boş dönebilir; bir kez yenile.
      await doubleRaf();
      blob = await domToBlob(node, opts);
    }
    if (!blob || blob.size === 0) throw new Error('Makbuz görseli oluşturulamadı.');
    return blob;
  } finally {
    root.unmount();
    host.remove();
  }
}

async function resolveThumbnails(model) {
  const items = Array.isArray(model.items) ? model.items : [];
  const resolvedItems = await Promise.all(items.map(async (it) => {
    if (!it.thumbSrc) return it;
    const dataUrl = await urlToDataUrl(it.thumbSrc);
    return { ...it, thumbSrc: dataUrl };
  }));
  return { ...model, items: resolvedItems };
}

async function urlToDataUrl(src) {
  if (typeof src !== 'string' || !src) return null;
  if (src.startsWith('data:')) return src;
  try {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
    const res = await fetch(src, {
      credentials: 'include',
      signal: controller ? controller.signal : undefined,
    });
    if (timer) clearTimeout(timer);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob || !/^image\//.test(blob.type)) return null;
    return await blobToDataUrl(blob);
  } catch {
    return null; // CORS (CDN), 404, timeout vb. → placeholder
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

function waitForImages(node) {
  const imgs = Array.from(node.querySelectorAll('img'));
  return Promise.all(imgs.map((img) => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    return new Promise((res) => {
      img.addEventListener('load', () => res(), { once: true });
      img.addEventListener('error', () => res(), { once: true });
    });
  }));
}

function doubleRaf() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') { resolve(); return; }
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}
