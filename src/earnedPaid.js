// Ana sayfa tahsilat kartlarının (mobil hero + web aylık kart) ortak hesabı.
//
// "Hak ediş" = dönemde yapılan iş: tamamlanan ders neti (paket dersleri dahil)
// + etkinlik ders payı + ürün satışı. `outstanding` aynı kalemlerin henüz
// ödenmemiş kısmıdır (paket dersleri ve etkinlik ders payı ödenmiş sayılır).
// Oran bu ikisinden kurulur; kasa girişine BÖLÜNMEZ — paket satışı ve eski
// borç ödemeleri kasa girişini şişirip oranı %100'ün üstüne iterdi.

// Hak edişin ödenen yüzdesi (0–100). Yuvarlama yanıltmasın: bekleyen varken
// %100, ödenen varken %0 gösterilmez.
export function earnedPaidRate(revenue, outstanding) {
  if (!(revenue > 0.005)) return 0;
  const open = Math.min(revenue, Math.max(0, outstanding || 0));
  const paid = revenue - open;
  let rate = Math.round((paid / revenue) * 100);
  if (open > 0.005) rate = Math.min(rate, 99);
  if (paid > 0.005) rate = Math.max(rate, 1);
  return rate;
}

// Türkçe iyelik eki: "%53'ü", "%50'si", "%40'ı" ... Son okunan sözcüğün
// ünlü uyumuna göre. 0–100 arası yüzdeler için doğru ek üretir.
export function percentSuffix(n) {
  const map = {
    0: 'ı', 1: 'i', 2: 'si', 3: 'ü', 4: 'ü', 5: 'i', 6: 'sı', 7: 'si', 8: 'i', 9: 'u',
    10: 'u', 20: 'si', 30: 'u', 40: 'ı', 50: 'si', 60: 'ı', 70: 'i', 80: 'i', 90: 'ı', 100: 'ü',
  };
  if (n <= 10 || n === 100) return map[n] ?? 'i';
  const ones = n % 10;
  return ones === 0 ? (map[n] ?? 'ı') : map[ones];
}
