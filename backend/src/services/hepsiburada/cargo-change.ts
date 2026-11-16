// Hepsiburada kargo firması değişikliği takibi — Trendyol'unkiyle aynı kayıt deposu
// (CargoChangeTracker), yalnız "yansıdı mı?" kuralı HB'ye göre.
//
// HB'de firma ADLARI (ör. "Aras Kargo") değişiklik seçeneklerindeki adla aynıdır;
// kod ("AR") sipariş verisinde gelmez. Bu yüzden paketteki güncel ad hedef adla
// eşleşirse uygulandı sayılır; eşleşmese de istek anındaki addan FARKLIYSA (HB adı
// başka yazmış olabilir) yine uygulandı sayılır.
//
// Ayrı dosya: orders.service (siparişlere iliştirme) ve order-cargo.service
// (değiştirme + yoklama) ikisi de kullanır; döngüsel içe aktarmayı önler.

import { CargoChangeTracker } from "../trendyol/cargo-change-tracker.js";
import { foldCargoName } from "../trendyol/cargo-providers.js";

export const hbCargoTracker = new CargoChangeTracker((entry, currentName) => {
  if (!currentName) return false;
  const current = foldCargoName(currentName);
  if (current === foldCargoName(entry.toName)) return true;
  return entry.fromName !== null && current !== foldCargoName(entry.fromName);
});
