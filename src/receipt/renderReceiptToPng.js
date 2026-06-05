import React from 'react';
import { createRoot } from 'react-dom/client';
import { ReceiptCard } from './ReceiptCard.jsx';
import { loadReceiptFonts } from './loadReceiptFonts.js';

// Normalize makbuz modelini ekran dışında mount edip JPEG Blob'a rasterize eder.
//
// Çıktı JPEG (q0.92): makbuz şeffaf değil, JPEG kodlaması PNG'ye göre mobilde çok
// daha hızlı ve dosya küçük (WhatsApp için ideal). Ölçek 1.5 → 1620×2025; WhatsApp
// zaten ~1600px'e yeniden sıkıştırdığı için 2x gereksizdi (yarı CPU, aynı sonuç).
//
// Taint güvenliği: ürün görselleri capture'dan ÖNCE data URL'e çözülür
// (urlToDataUrl), kimlik bilgisi GÖNDERMEDEN (credentials:'omit'). Böylece
// `Access-Control-Allow-Origin: *` veren CDN'ler (Trendyol cdn.dsmcdn.com → ACAO:*)
// embed edilebilir; credentials:'include' bunu bozardı (CORS, kimlikli istekte `*`
// kabul etmez). CORS vermeyen CDN veya 404 → null → bej placeholder. Görseller
// doğrudan client→CDN çekilir (bizim backend'e uğramaz, ekstra Railway maliyeti yok).

const FETCH_TIMEOUT_MS = 6000;

export async function renderReceiptToPng(model, { pixelRatio = 1.5, quality = 0.92 } = {}) {
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
      type: 'image/jpeg',
      quality,
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
      // Kimlik gönderme: bizim görsel endpoint'i zaten public; harici CDN'ler
      // (Trendyol) ise ACAO:* veriyor → credentials'sız fetch CORS'tan geçer.
      credentials: 'omit',
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
