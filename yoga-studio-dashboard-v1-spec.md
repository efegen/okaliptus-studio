# Yoga Stüdyosu Dashboard — v1 Spesifikasyonu

**Spec versiyonu:** 1.5 · son revizyon kapsamı için bkz. §11.

## 0. Bağlam ve Hedef

Tek eğitmenli bir yoga stüdyosu için operasyon/finans dashboard'u. Bu doküman **v1 için tam ve bitmiş** bir veri modeli, iş kuralları seti, KPI hesaplama mantığı, migration planı ve servis katmanı tasarımı sunar. Implementasyon bu spec'i tek kaynak doğruluk olarak alır.

Bu spec kaynak alınarak üretilen bileşenler:

1. **PostgreSQL DDL dosyaları** (tüm CREATE TABLE'lar, CHECK'ler, FK'ler, index'ler, trigger'lar, view'lar)
2. **Migration sırası** (FK bağımlılıklarına göre)
3. **Seed data** (`studio_settings` ilk satırı)
4. **Servis katmanı modülleri** (transaction, lock, overpayment reddi, kredi tahsisi akışları)
5. **KPI sorguları** (view veya function olarak)
6. **Test senaryoları** (kritik kuralları doğrulayacak)

V1 üretim sistemidir, "logging-only observation mode" gibi ara aşama yoktur. Tüm finansal olaylar `audit_logs`'a düşer.

**v1 sadeleştirmesi (önceki revizyonlardan fark):** "Öğrenci bakiyesi / fazla ödeme / mahsup" sistemi v1 kapsamından çıkarılmıştır. Fazla ödeme kabul edilmez, reddedilir. Detay: §2.6.

**v1 multi-entity + discount altyapısı:** `instructors` ve `lesson_types` tabloları + `lessons.instructor_id / lesson_type_id / duration_minutes / discount_amount` kolonları + `prepaid_packages.lesson_type_id` (nullable) kolonu eklenmiştir. v1 deployment'ında tek aktif eğitmen + tek aktif ders tipi seed edilir; isim/etiket gibi operasyonel veriler bootstrap aşamasında doldurulur (§10 "Bootstrap" bölümü). Ders tipi v1 deployment'ı için sabit varsayılan: **"Yoga & Meditasyon" (60 dk)**. v1.2'den itibaren UI eğitmen/ders tipi seçimine açık: `CreateLessonModal` aktif eğitmen ve aktif ders türlerini select olarak sunar; tek aktif kayıt varsa otomatik dolu gelir. Ayrıca `LessonTypesPage` ders türü CRUD ekranını sağlar (yeni tip oluşturma, fiyat/süre/aktiflik düzenleme); `InstructorsPage` read-only listedir. Servis seçim gönderilmediğinde aktif tek seed'i otomatik atamaya devam eder (geriye dönük uyum). Ders indirimi (net tutar = `price_snapshot - discount_amount`) ayrı endpoint ile yönetilir. Detay: §2.12 (indirim), §2.13 (duration + multi-entity UI), §3.10/§3.11 (yeni tablolar), §5.8 (set discount), §10 (endpoint listesi + hata sınıfları + bootstrap).

**v1 ürün satışı ↔ ders bağı (v1.2 → v1.6):** `product_sales.lesson_id` (nullable) kolonu v1.2'de eklenmişti; ders tamamlama akışı opsiyonel olarak aynı transaction'da satış oluştururdu. v1.6'da bu kavram tamamen kaldırıldı: tüm satışlar v2 ürün satış modülünden (kalem bazlı, ürün katalogundan) bağımsız olarak (lesson_id NULL) yaratılır ve ders bloğu/modal'ı ile **hiçbir görsel ya da veri ilişkisi taşımaz**. Migration 0233 mevcut bağları temizler. Ders bloğu yalnız ders verilerini gösterir; ürün satışı operatör tarafından öğrenci profilinden ya da ürün satış modülünden takip edilir. Kolon ve FK constraint geriye dönük olarak korunur ama yeni satırlarda doldurulmaz.

**v1 takvim etkileşimi (v1.2):** Önceki revizyonun "ders bloğu tıklanmaz" kuralı kaldırıldı. Bloklar artık `LessonModal`'ı açar; modal içinden tamamlama, iptal, kısmi/tam ödeme ve indirim akışları çalışır. Detay: §8.4.

**v1 kimlik doğrulama (v1.3):** Önceki revizyonların "v1'de tek kullanıcı varsayımı" kuralı kaldırıldı. Sistem artık 3 admin user ile çalışır; hepsi tüm kaynaklara erişir (rol kavramı v1'de tek seviye). Username + password ile login. WebAuthn/passkey **v1'de yok** — iOS Keychain/Safari ve macOS Keychain'in varsayılan şifre autofill + Face/Touch ID akışı zaten "Face ID ile giriş" UX'ini parasız sağlıyor; ekstra ceremony eklemek 3 yakın admin için marjinal kazançtı (§9). Email kolonu v1.3'te yok — password reset email'i, notification gibi kullanım yok; ileride gerekirse nullable kolon olarak eklenir. Audit log her mutating işlem için `actor_user_id` taşır. Detay: §2.14, §3.7 (audit güncellemesi), §3.12–§3.13 (yeni tablolar), §5.9–§5.11 (auth servis akışları), §8.6 (login UI), §10 (yeni endpoint listesi + hata sınıfları).

---

## 1. Domain Sözlüğü

| Terim | Tanım |
|---|---|
| **Öğrenci (Student)** | Sistemde aktif/pasif profil. Borç/ödeme/ders kaydı tutulur. |
| **Eğitmen (Instructor)** | Dersi veren kişi. V1'de tek aktif eğitmen seed'i; isim deployment'a özgüdür ve bootstrap'ta atanır (§10). Tablo + FK ileriye dönük altyapı. |
| **Ders Tipi (LessonType)** | Dersin türü ve varsayılan süresi (ör. "Yoga & Meditasyon", 60 dk). V1'de tek aktif tip. |
| **Ders (Lesson)** | Özel ders. `scheduled`, `completed`, `cancelled`, `no_show` durumlarından birinde olabilir. Her ders bir instructor_id + lesson_type_id + duration_minutes taşır. |
| **Ürün Satışı (ProductSale)** | V1'de kalem bazında değil, toplam tutar olarak kaydedilir. Mutlaka bir öğrenciye bağlı. |
| **Ön Ödemeli Paket (PrepaidPackage)** | Öğrencinin önceden N ders için yaptığı ödeme. Her completed ders 1 kredi tüketir. Paket = ön ödeme (oluşturulurken payment ile atomik). Opsiyonel olarak bir ders tipine bağlanabilir (NULL = generic). |
| **Ödeme (Payment)** | Tek hedefli (XOR). Hedef: lesson, product_sale veya prepaid_package. Source: cash, iban. Kısmi ödeme serbest, fazla ödeme yasak. |
| **İndirim (Discount)** | Tek ders üzerine uygulanan, yalnızca tamamlanmış ve paket-dışı derslerde geçerli bir ince ayar. `discount_amount` kolonu olarak tutulur; brüt fiyat değişmez. |
| **Net Tutar (Net Amount)** | `price_snapshot - discount_amount`. Tüm ciro, receivable ve ödeme doğrulamaları net üzerinden yürür. |
| **Ciro (Revenue)** | Belirli pencerede "hak edilmiş" tutar. Completed derslerin **net tutarı** + gerçekleşen ürün satışlarının toplamı. |
| **Tahsilat (Cash Inflow)** | Belirli pencerede kasaya/hesaba giren fiziksel para. Tüm payment kayıtlarının toplamı. |
| **Bekleyen Tahsilat (Receivable)** | Öğrencilerin stüdyoya olan açık borçları. Completed lesson (net − paid) ve product_sale açık bakiyeleri. |
| **Aktif Kredi Değeri (Deferred)** | Ödenmiş ama henüz tüketilmemiş paket kredilerinin parasal karşılığı. |
| **Kullanıcı (User)** | Sisteme login olan operatör. v1.3'ten itibaren 3 admin user; hepsi tüm kaynaklara erişir (tek rol seviyesi). |
| **Session** | Login sonrası yaratılan, opaque token taşıyan httpOnly cookie ile tutulan oturum. Sliding window 30 gün. |

**Finansal metriklerin ayrımı:**
- **Receivable ve Deferred iki ayrı kavramdır**, karıştırılamaz, aynı kutuda toplanamaz.
- Dashboard'da iki ayrı bileşende gösterilir.
- V1'de "öğrenci bakiyesi / liability" diye üçüncü bir kavram **yoktur** (ileride gerekirse ayrı bir revizyonla değerlendirilir).

---

## 2. İş Kuralları (Otorite Listesi)

Aşağıdaki kurallar şemayı ve servis katmanını yöneten otoritedir. Uyumsuzluk varsa bu liste geçerli.

### 2.1 Borç oluşumu
- **Borç yalnızca iki kaynaktan oluşur:** completed lesson (net tutar = `price_snapshot - discount_amount`) ve product_sale (`total_amount`).
- `scheduled`, `cancelled`, `no_show` statüsündeki dersler **borç oluşturmaz**.
- Kredi ile karşılanan (`prepaid_package_id IS NOT NULL`) completed dersler **borç oluşturmaz** (çünkü para zaten tahsil edilmiş durumda).
- Ayrı `debts` tablosu YOK. Borç türev bir kavram, her an sorguyla hesaplanır.
- Lesson net tutarının hesabı: `remaining_receivable = GREATEST(0, price_snapshot - discount_amount - paid_amount)` — view'lar ve KPI bu formülü kullanır (§4.5, §4.8).

### 2.2 Ders durum geçişleri
- `scheduled → completed`: serbest
- `scheduled → cancelled`: serbest (v1'de scheduled dersler kredi rezerve etmez, iade gündemde değil)
- `scheduled → no_show`: serbest
- `cancelled → completed`: serbest (geç işaretleme)
- `no_show → completed`: serbest
- `completed → cancelled`: **yasak** (istisnasız)
- `completed → no_show`: **yasak** (istisnasız)
- `completed → scheduled` (uncomplete): **kısıtlı izin** (v1.4). Yalnızca son **24 saat içinde tamamlanmış**, **hiç aktif ödemesi olmayan** ve **bağlı ürün satışında ödeme bulunmayan** dersler geri alınabilir. Akış: bağlı aktif ürün satışları soft-delete edilir, `prepaid_package_id` ve `completed_at` NULL'a çekilir, status `scheduled` olur. Audit: `lesson_uncompleted`. Eski kayıtlar veya ödemeli kayıtlar için klasik düzeltme akışı geçerli (payment soft-delete + lesson soft-delete + yeniden oluştur). Detay: §5.7b.
- Completed durumdan geri sarma yukarıdaki dar pencere dışında yapılamaz. Hatalı completed kaydı varsa düzeltme akışı şudur: bağlı payment'ları soft-delete et, sonra lesson'ı soft-delete et, yeni doğru kayıt oluştur.
- Tüm status değişimleri `audit_logs`'a düşer.

### 2.3 Fiyat snapshot
- `lesson.price_snapshot` brüt/liste fiyatıdır. **İki anda** belirlenir ve sonrasında **asla değişmez**:
  1. **Lesson create anında:** `lesson_type.default_price` kopyalanır. Brüt ders fiyatının tek kaynağı ders türüdür — öğrenci başına özel fiyat **yoktur**.
  2. **Credit-covered completion anında (§5.2):** eğer completion sırasında aktif bir prepaid_package varsa, `price_snapshot` bir kez `package.unit_price` ile **override** edilir (aynı transaction, FIFO kredi tahsisi ile birlikte).
- Bu iki an dışında `price_snapshot` otomatik olarak güncellenmez — ne fiyat değişiminde, ne status değişiminde, ne başka bir trigger'da.
- `lesson_types.default_price` değiştirilirse **mevcut derslerin price_snapshot'ı etkilenmez** (completed veya scheduled fark etmeksizin). Yeni `createLesson` çağrıları yeni değeri kullanır; geçmiş snapshot'lar olduğu gibi kalır. Servis katmanında scheduled dersleri toplu olarak yeni fiyata çekme akışı **yoktur** — fiyat değişiklikleri sadece yeni dersleri etkiler.
- Completed olmuş derslerin price_snapshot'ı **hiçbir koşulda değişmez**. Bu kural audit trail ve ciro tutarlılığı için sağlam tutulur.
- **İndirim (`discount_amount`) price_snapshot'ı değiştirmez**; brüt fiyat korunur, net tutar `price_snapshot - discount_amount` olarak türetilir. Öğrenciye özel fiyat ihtiyaçları (ücretsiz ders, özel iskontolu ders, vb.) brüt ≠ net şeklinde, yalnızca indirim akışıyla modellenir. Detay: §2.12.

### 2.4 Ön ödemeli paketler
- Paket oluşturma işlemi (insert) **aynı transaction içinde** bir payment insert ile atomik olmak zorundadır. DB-level constraint olarak kurulamaz; servis katmanı bu kuralı enforce eder.
- **"Ödenmemiş paket" durumu mümkün değildir.** Paket varsa ödeme de vardır.
- **Invariant sınıflandırması — bilinçli kabul:** "Ödenmemiş paket olamaz" kuralı tam anlamıyla DB CHECK ile kurulamaz (paket insert'i sırasında henüz payment yaratılmadı, aynı transaction sonunda iki satır birden commit olur). Bu kural yalnızca **servis transaction'ı** tarafından enforce edilir. Savunma katmanları:
  1. Servis katmanı: `create_prepaid_package()` (§5.4) tek giriş noktası, atomik insert
  2. Test katmanı: §7'deki paket senaryoları bu invariant'ı doğrular
  3. **Karşı yönde DB garanti** (`ux_payments_one_active_per_package` — §3.6): "paket başına en fazla bir aktif payment" garantilidir.
- Paket `credit_count > 0` olmak zorunda.
- **Paket `total_amount = credit_count × unit_price` ZORUNLUDUR** (CHECK constraint ile DB-level garanti). İndirim uygulanacaksa `unit_price` doğrudan indirimli fiyatla girilir. Bu eşitlik olmadan tahsilat ↔ ciro sapması oluşur: örneğin 8 × 500 = 4000 tahsilat toplanır ama dersler tamamlanınca 8 × 600 = 4800 ciro yazılırsa sistem 800 TL hayali ciro üretir. Eşitlik invariant'ı bu hatayı yapısal olarak engeller.
- Kredi tahsisi FIFO: öğrencinin aktif paketleri `purchased_at ASC` sıralanır, en eski paketten düşülür.
- **Aktif paket:** `remaining_credits > 0` ve `deleted_at IS NULL`.
- `remaining_credits` TÜRETİLMİŞ değer, kolon olarak tutulmaz: `credit_count - COUNT(lessons WHERE prepaid_package_id = X AND status = 'completed' AND deleted_at IS NULL)`.
- **Kural:** `lessons.prepaid_package_id IS NOT NULL` ise `lessons.status = 'completed'` olmalıdır (CHECK constraint).
- Lesson kredi ile karşılanırken `prepaid_package_id` set edildiği anda kalan kredi 0'a düşerse paket doğal olarak "tükenmiş" sayılır.
- Scheduled bir lesson kredi ile planlanmışsa (gelecek ders için kredi "rezerve" ise) → v1'de bu mekanizma YOK. Kredi sadece completed anında tahsis edilir.
- Scheduled lesson iptal edilirse (cancelled/no_show): `prepaid_package_id` zaten NULL olduğu için kredi iadesi gündemde değil.
- **Paket payment silinemez (§2.9):** paket'e bağlı payment soft-delete'i yasaktır. Silinmesi gereken paket varsa önce kredi kullanımı revert edilir, sonra paket soft-delete edilir, payment soft-delete'i **aynı transaction'da** atomik olur.

### 2.5 Ödemeler
- Her payment **tam olarak bir** hedefe bağlı: `lesson_id`, `product_sale_id` veya `prepaid_package_id`. XOR constraint ile garanti.
- `amount > 0` zorunlu.
- Scheduled lesson'a direkt payment **yasak**. Ön ödeme istiyorsa öğrenci → prepaid_package mekanizması kullanılır.
- `source`: `cash`, `iban` (iki değer). V1'de başka source yoktur.
- Payment `paid_at` (gerçek ödeme tarihi) `created_at`'ten bağımsız. Geçmiş tarihli payment girişi serbest.
- `payments.student_id` denormalize kolonu **YOK**. Öğrenci parent üzerinden JOIN ile çıkarılır.

### 2.6 Fazla ödeme kuralı

V1'de "öğrenci bakiyesi" veya "mahsup" kavramı yoktur. Fazla ödeme yapısal olarak reddedilir.

| Durum | Davranış |
|---|---|
| `amount == remaining_debt` | Kabul. Borç tam olarak kapanır. |
| `0 < amount < remaining_debt` | Kabul. Kısmi ödeme. Kalan borç düşer. |
| `amount > remaining_debt` | **Red.** `OverpaymentNotAllowedError` fırlatılır (HTTP 409). Payment hiç kaydedilmez. |
| `amount <= 0` | **Red.** ValidationError. |

- Fazla ödeme için "yedek bakiye", "sonraki derse aktar", "iade kaydı" gibi otomatik akışlar **yoktur**. Operatör doğru tutarı girmekle yükümlüdür.
- Gerçek dünyada fazla para alındıysa (küsür, yanlışlık) ya düzeltilmeli (doğru tutarla tekrar girilmeli) ya da ayrıca nakit olarak öğrenciye geri verilmelidir — bunun sistem dışı bir çözüm olduğu kabul edilmiştir.
- Prepaid package için kural zaten mevcut: `total_amount` ne ise o ödenir. Paket için fazla/eksik ödeme yoktur (§3.6 chk_prepaid_total_equals_credits_times_unit).

### 2.7 Geçmiş tarihli giriş
- Tüm event tarihleri (`starts_at`, `sold_at`, `paid_at`, `purchased_at`) geçmişe ait olabilir. Sınır yok.
- Tüm KPI hesapları event tarihi üzerinden yapılır. `created_at` sadece audit amaçlı.

### 2.8 no_show semantiği
- `no_show` borç üretmez, cancelled ile finansal olarak aynı davranır.
- Fark: raporlama/disiplin takibi için ayrı status. "Bu öğrenci 3 kez gelmedi" gibi sorgular mümkün.
- Planlanan ders sayımında cancelled hariç, no_show dahil (çünkü slot tüketildi).

### 2.9 Silme politikası
- **Finansal tablolarda hard delete yasak.** Soft delete: `deleted_at timestamptz NULL`.
- FK'lar `ON DELETE RESTRICT` (güvenlik katmanı).
- **Paket'e bağlı payment tek başına silinemez** (invariant: ödenmemiş paket olamaz). Silinmesi gereken paket varsa özel akış: (a) paketten düşülmüş completed lesson'lardaki `prepaid_package_id` NULL'a çekilir veya o lesson'lar soft-delete edilir, (b) paket ve bağlı payment aynı transaction'da soft-delete edilir (§5.6b).
- Silme işlemleri `audit_logs`'a düşer.

### 2.10 Para birimi
- V1'de aktif kullanılan tek currency: `TRY`.
- Tüm finansal tablolarda `currency text NOT NULL DEFAULT 'TRY'` kolonu var (ileri uyumluluk için).
- Aynı parent ile child currency farklı olamaz. Servis katmanı ve trigger kontrol eder.

### 2.11 Zaman / Timezone
- Tüm event tarihleri `timestamptz`.
- KPI pencereleri **Europe/Istanbul** timezone'da hesaplanır.
- Hafta başlangıcı **Pazartesi 00:00**.
- Hafta penceresi: `[monday 00:00 Europe/Istanbul, next_monday 00:00 Europe/Istanbul)`.

### 2.12 Ders indirimi (Discount)

V1'de bir dersin fiyatından indirim yapma gereksinimi için `lessons.discount_amount` kolonu kullanılır. Brüt fiyat (`price_snapshot`) değişmez; net tutar türev kavramdır.

| Kural | Davranış |
|---|---|
| `discount_amount >= 0` | CHECK (`chk_lessons_discount_nonneg`) |
| `discount_amount <= price_snapshot` | CHECK (`chk_lessons_discount_le_price`) |
| `prepaid_package_id IS NOT NULL` → `discount_amount = 0` | CHECK (`chk_lessons_prepaid_no_discount`). Paket dersi kredi ile kapatıldığı için indirim anlamsızdır. |
| `paid_amount > price_snapshot - discount_amount` denemesi | **Red.** Servis katmanı `DiscountWouldExceedNetError` fırlatır (HTTP 409). DB'ye yazılmaz. |
| `status <> 'completed'` dersine indirim uygulama | **Red.** `DiscountNotAllowedError` (HTTP 409). Scheduled dersin fiyatı bulk price update ile değişir (§5.5). |
| `discount_amount = 0` gönderilmesi | İndirimi kaldırır (idempotent set). Yeni audit event yazılır. |

**Uygulama noktası:** `PATCH /lessons/:id/discount` endpoint'i (§5.8). Idempotent set — mevcut değeri üzerine yazar. 

**Audit:** Her değişim `audit_logs.action = 'lesson_discount_updated'` satırı yaratır; `before = {discount_amount: X}`, `after = {discount_amount: Y}`, opsiyonel `note`. Hareketler akışı bu olayı "İndirim uygulandı / güncellendi / kaldırıldı" olarak renderlar (§8.3).

**Neden `price_snapshot`'a gömmedik:** Brüt fiyatı korumak, raporlama ve analizde "kaç TL indirim verildi" metriklerinin kaybolmamasını sağlar. Ayrıca mevcut audit trail (`lesson_created`'taki fiyat snapshot'ı) doğru kalır.

### 2.13 Ders süresi ve multi-entity altyapısı

- `lessons.duration_minutes` NOT NULL kolonudur. Yeni ders oluşturulurken servis, seçilen `lesson_types.default_duration_minutes` değerini doldurur.
- `lessons.instructor_id` NOT NULL, `lessons.lesson_type_id` NOT NULL.
- V1'de default seed:
  - 1 aktif instructor (`is_active = true`); ismi bootstrap aşamasında doldurulur (§10), migration'da PII tutulmaz.
  - 1 aktif lesson_type: **"Yoga & Meditasyon"** (`default_duration_minutes = 60`, `is_active = true`). Bu jenerik bir etiket olduğu için migration'da hardcoded olarak güvenli kabul edilir.
- Seed satırları silinmemeli veya deaktive edilmemelidir — aktif eğitmen/tip kalmazsa `createLesson` `No active instructor or lesson type is configured` hatası ile reddeder.

**UI seçim davranışı (v1.2):**
- `CreateLessonModal` `<select>` ile aktif `instructors` ve aktif `lesson_types` listesini sunar. Tek aktif kayıt varsa otomatik seçili gelir; birden fazla varsa kullanıcı seçer.
- `POST /lessons` çağrısında `instructorId` ve `lessonTypeId` opsiyoneldir: gönderilmediğinde servis aktif tek kaydı otomatik atar (geriye dönük uyum + tek aktif kayıt için sessiz default).
- Body'de gönderilen `instructorId` veya `lessonTypeId` aktif değil veya silinmişse `ValidationError` döner.
- Ders türü yönetimi `LessonTypesPage` üzerinden yapılır: yeni tip oluşturma + isim/süre/fiyat/aktiflik düzenleme. Eğitmen yönetimi v1.2'de read-only listedir; CRUD ileri revizyona bırakıldı.

**Paket ↔ ders türü:**
- `prepaid_packages.lesson_type_id` nullable: `NULL = generic paket` (tüm ders tiplerinde geçerli). FIFO kredi tahsisi v1'de bu kolonu filtrelemez (§3.5).

**KPI:**
- KPI/takvim v1'de instructor/lesson_type bazlı ayrıştırma yapmaz. Bu ayrıştırıcılar gelecek revizyonun konusudur.

**Audit (v1.4 güncelleme):**
- `lesson_types` create/update işlemleri **artık** `audit_logs`'a yazılır (`lesson_type_created`, `lesson_type_updated`). v1.2'deki "sessizce yapılır" notu v1.4 ile geçersizdir; CHECK listesi migration 0225 ile genişletildi. `studio_settings` PATCH'leri de `settings_updated` action'ı ile audit'a düşer.

### 2.14 Kimlik doğrulama (Authentication, v1.3 → v1.4)

V1.3'ten itibaren sistem birden fazla admin user ile çalışır (deploy seed'i 3 user; üst sınır yok). Tek rol seviyesi: `admin`. Hepsi tüm kaynaklara erişir; rol-bazlı kısıtlama yoktur (gelecekte gerekirse genişletilir, §9).

**Kapsam ve kurallar (v1.4 kod realitesine göre):**

| Kural | Davranış |
|---|---|
| Korumalı endpoint | `/auth/*` ve `/health` dışındaki **tüm** endpoint'ler valid session cookie zorunludur. Yoksa `401 UNAUTHORIZED`. |
| Session token | Opaque (`crypto.randomBytes(32).toString('hex')` — 64 hex char); httpOnly + secure (production) + SameSite (production: `none`, dev: `lax`) cookie. JWT **değil** — server-side `sessions` tablosunda tutulur, revoke edilebilir (§3.13). Cross-origin (Vercel + Railway) dağıtımı için prod'da SameSite=None zorunludur. |
| Session TTL | Sliding 30 gün: her korumalı request `last_seen_at = now()` ve `expires_at = now() + 30d` günceller. 30 gün hareketsizlik = session ölü. |
| Password kuralı | bcrypt cost 12, **min 6 char**, max 100 char. Plaintext hiçbir log/audit'e düşmez. **Min 6 kararı:** kapalı admin sistemi + bcrypt cost 12 birleşimi 6-haneli PIN'i pratik olarak kırılamaz yapar; mobil klavyede hızlı girilir. Validation `auth.service.ts` ve bootstrap script'inde. |
| Rate limit | **v1 dışı.** Kapalı admin sistemi için brute force riski düşük kabul edildi; ileride `express-rate-limit` ile eklenir. Şu an `POST /auth/login`'da rate limit yoktur. |
| Şifre değişimi (UI) | **v1 dışı.** Settings → Hesap bölümü v1.4'te yok (§8.5, §9). Şifre reset gerekirse sysadmin DB'den manuel günceller (`bcrypt.hash($pw, 12)` + `UPDATE users SET password_hash = ...`). |
| Logout | Tek session: `DELETE FROM sessions WHERE token = ?`. "Tüm cihazlardan çık" endpoint'i v1.4'te yok (§9). |
| Auth audit | **v1.4'te yazılmaz.** Login/logout/password değişimi `audit_logs`'a düşmez; `audit_logs.action` CHECK listesi `user_login`/`user_logout`/`password_changed` action'larını **içermez** (§3.7). Mutating *iş* işlemleri (lesson, payment, package, ...) `actor_user_id` taşır ve audit'a yazılır — auth event'leri ayrı kategori sayılır ve v1 kapsamına alınmadı. İleride eklenirse: ayrı action'lar + entity_type=`'user'` + CHECK genişletmesi gerekir. |
| Audit aktör | Her mutating *iş servisi* çağrısı `actorUserId` parametresi alır ve `audit_logs.actor_user_id` kolonuna yazar. NULL yalnızca v1.3 öncesi legacy satırlar için. |
| Hesap deaktive | `users.is_active = false` → mevcut session'lar bir sonraki request'te 401 alır; yeni login imkânsız. (`users.deleted_at` kolonu **yok** — soft delete v1'de gerekmedi.) |
| Self-service password reset | **Yok** (§9). |
| Hesap oluşturma UI | **Yok** (§9). Admin'ler bootstrap script ile (§10) `.env`'den seed edilir. Yeni user gerekirse aynı bootstrap'a satır eklenip yeniden çalıştırılır (idempotent: `ON CONFLICT (username) DO NOTHING`). |
| Face/Touch ID UX | iOS/macOS Keychain'in varsayılan şifre kaydet → Face/Touch ID ile autofill akışı kullanılır; uygulama tarafında özel implementasyon gerekmiyor. WebAuthn/passkey v1 kapsamı dışı (§9). |

**Why:** Kapalı admin senaryosunda Clerk gibi external auth provider'a bağımlı olmak vendor lock-in + maliyet getirisi düşük. Kendi auth'umuz: opaque session + bcrypt, ihtiyaç doğarsa Lucia/Better-Auth gibi kütüphanelere göç ederken DB şeması korunur.

**v1.3 spec ile v1.4 kod arasındaki uyumlama:** v1.3 spec'i auth audit logging, rate limit, sliding-on-mutate, logout-everywhere, password change UI, IP/UA tracking, soft-delete users gibi ek özellikler içeriyordu. v1.4 bunların hepsini **kasıtlı olarak v1 dışına** çıkarttı (kapalı admin sistemi için over-engineering); geride kalan yüzey opaque session + sliding TTL + tek-cihaz logout + bcrypt cost 12. Detay ve gerekçeler §11 v1.4 sürüm notunda.

---

## 3. Veri Modeli (Final DDL)

### 3.1 studio_settings

```sql
CREATE TABLE studio_settings (
  id                  integer PRIMARY KEY CHECK (id = 1),
  weekly_capacity     integer NOT NULL DEFAULT 25 CHECK (weekly_capacity > 0),
  timezone            text    NOT NULL DEFAULT 'Europe/Istanbul',
  default_currency    text    NOT NULL DEFAULT 'TRY',
  week_start          text    NOT NULL DEFAULT 'monday' CHECK (week_start = 'monday'),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
```

**Singleton garantisi:** `CHECK (id = 1)` + PK sayesinde tablo en fazla 1 satır içerir.

**Ek ayar kolonları (sonraki migration'larda eklenen):**
- `calendar_start_hour` / `calendar_end_hour` (0201) — takvim görünür saat aralığı.
- `default_lesson_mode` (0201) — yeni `CreateLessonModal` açılışında varsayılan mode.
- `payment_method_cash` / `payment_method_iban` (0201) — UI ödeme yöntemi seçicisinde hangi seçeneklerin göründüğü.
- `lesson_color_saturation` (0202) — takvim ders blokları için renk doygunluk çarpanı.

**Tarihsel kalıntı:** `default_lesson_duration` kolonu (0201) ve `default_lesson_price` kolonu (0201) tarihsel olarak eklenmişti. `default_lesson_price` 0220'de drop edildi (fiyat tek kaynağı `lesson_types.default_price`). `default_lesson_duration` kolonu hâlâ tabloda ve settings UI'sında görünür ama hiçbir runtime tarafından okunmaz: yeni ders oluşturulurken `duration_minutes` aktif `lesson_type.default_duration_minutes`'tan gelir (§5.1). v1.2 itibarıyla bu kolon kullanılmamaktadır; ileri revizyonda ya bağlanacak ya da düşürülecek (TODO §11).

Güncel şema için en son migration'a bakılır.

### 3.2 students

```sql
-- NOTE: Bu final DDL, 0002 (ilk tablo) + 0216 (nickname) + 0217 (preferred_mode)
-- + 0219 (default_lesson_price drop) uygulandıktan sonraki durumdur. Historical
-- migration 0002 default_lesson_price kolonunu içeriyordu; yeni fiyat modelinde
-- (lesson_types.default_price) bu kolon gereksiz olduğundan 0219'de düşürüldü.
CREATE TABLE students (
  id                    bigserial PRIMARY KEY,
  full_name             text NOT NULL,
  nickname              text,
  preferred_mode        text CHECK (preferred_mode IN ('online', 'onsite')),
  phone                 text,
  email                 text,
  birthday              date,
  joined_at             date,
  note                  text,
  currency              text NOT NULL DEFAULT 'TRY',
  is_active             boolean NOT NULL DEFAULT true,
  deleted_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_students_is_active ON students (is_active) WHERE deleted_at IS NULL;
CREATE INDEX idx_students_full_name ON students (lower(full_name)) WHERE deleted_at IS NULL;
```

### 3.3 lessons

```sql
-- NOTE: Bu final DDL, ilk tablo migration'ı (0005) + çok-varlık + discount
-- migration'ı (0212) uygulandıktan sonraki durumdur. Historical migration 0005
-- instructor_id / lesson_type_id / duration_minutes / discount_amount kolonlarını
-- içermez; bu kolonlar 0212'de eklenir, backfill edilir ve NOT NULL'a çekilir.
CREATE TABLE lessons (
  id                   bigserial PRIMARY KEY,
  student_id           bigint NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  instructor_id        bigint NOT NULL REFERENCES instructors(id) ON DELETE RESTRICT,
  lesson_type_id       bigint NOT NULL REFERENCES lesson_types(id) ON DELETE RESTRICT,
  starts_at            timestamptz NOT NULL,
  completed_at         timestamptz,
  mode                 text NOT NULL CHECK (mode IN ('online', 'onsite')),
  status               text NOT NULL CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
  duration_minutes     integer NOT NULL,
  price_snapshot       numeric(10,2) NOT NULL CHECK (price_snapshot >= 0),
  discount_amount      numeric(10,2) NOT NULL DEFAULT 0,
  currency             text NOT NULL DEFAULT 'TRY',
  prepaid_package_id   bigint REFERENCES prepaid_packages(id) ON DELETE RESTRICT,
  note                 text,
  deleted_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_lessons_prepaid_only_completed
    CHECK (prepaid_package_id IS NULL OR status = 'completed'),

  CONSTRAINT chk_lessons_completed_at
    CHECK (
      (status = 'completed' AND completed_at IS NOT NULL)
      OR
      (status <> 'completed' AND completed_at IS NULL)
    ),

  CONSTRAINT chk_lessons_duration_positive
    CHECK (duration_minutes > 0 AND duration_minutes <= 240),

  -- Ref: §2.12 Discount kuralları
  CONSTRAINT chk_lessons_discount_nonneg
    CHECK (discount_amount >= 0),
  CONSTRAINT chk_lessons_discount_le_price
    CHECK (discount_amount <= price_snapshot),
  CONSTRAINT chk_lessons_prepaid_no_discount
    CHECK (prepaid_package_id IS NULL OR discount_amount = 0)
);

CREATE INDEX idx_lessons_student_starts_at ON lessons (student_id, starts_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_lessons_starts_at ON lessons (starts_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_lessons_status ON lessons (status) WHERE deleted_at IS NULL;
CREATE INDEX idx_lessons_prepaid_package_id ON lessons (prepaid_package_id) WHERE prepaid_package_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_lessons_instructor_id ON lessons (instructor_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_lessons_lesson_type_id ON lessons (lesson_type_id) WHERE deleted_at IS NULL;
```

### 3.4 product_sales

```sql
-- NOTE: Bu final DDL, 0003 (ilk tablo) + 0221 (lesson_id) uygulandıktan sonraki
-- durumdur. Historical migration 0003 lesson_id kolonunu içermez; 0221'de
-- nullable olarak eklenir (NULL = standalone, ders dışı satış).
CREATE TABLE product_sales (
  id             bigserial PRIMARY KEY,
  student_id     bigint NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  lesson_id      bigint REFERENCES lessons(id) ON DELETE RESTRICT,
  sold_at        timestamptz NOT NULL,
  total_amount   numeric(10,2) NOT NULL CHECK (total_amount > 0),
  currency       text NOT NULL DEFAULT 'TRY',
  note           text,
  deleted_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_product_sales_student_sold_at ON product_sales (student_id, sold_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_product_sales_sold_at ON product_sales (sold_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_product_sales_lesson_id
  ON product_sales (lesson_id)
  WHERE lesson_id IS NOT NULL AND deleted_at IS NULL;
```

**`lesson_id` semantiği (v1.2):**
- `NULL` = standalone satış (öğrenci sadece alışveriş yaptı, derse bağlı değil).
- `NOT NULL` = bir derse bağlı satış. **v1.6 itibarıyla deprecated**: ders tamamlama akışı satış yaratmaz, ürün satış modülü her satışı `lesson_id NULL` yazar. Mevcut bağlar 0233 migration'ı ile temizlendi. Kolon korunur (FK + index) ancak takvim/ders modal hiçbir noktada bu alanı kullanmaz.
- **Tutarlılık kuralı (servis-level):** `lesson.student_id` ile `product_sale.student_id` eşleşmelidir; servis (`createProductSaleWithClient`) bunu doğrular. DB-level CHECK ile ifade edilemez (cross-table). v1.6'da çağrılmıyor (kalan koruma katmanı).
- **Silme korumaları:**
  - v1.6: `softDeleteLesson` artık derse bağlı satış kontrolü yapmaz — yeni satışlar lesson_id yazmadığı ve eski bağlar 0233 ile temizlendiği için kontrol gereksizdir.
  - `softDeleteProductSale` aktif payment kontrolü **yapmaz**: payment hâlâ DB'de kalır ama parent silindiği için view'larda gözükmez. Bu bilinçli bir hafif tutarsızlıktır; düzeltme akışında payment'ı önce manuel silmek operatöre bırakılmıştır.
- **FK davranışı:** `ON DELETE RESTRICT` — hard delete'lere karşı koruma. Soft delete app-layer'da yönetilir.
- **Takvim görselleştirmesi:** v1.6 itibarıyla yok. Ders bloğu ve ders modali yalnız ders bilgilerini gösterir; ürün satışları öğrenci profilinde ve ürün satış modülünde görülür.

### 3.5 prepaid_packages

```sql
-- Historical migration 0004 lesson_type_id kolonunu içermez; 0213'te nullable
-- olarak eklenir (NULL = generic paket, tüm ders tiplerinde geçerli).
CREATE TABLE prepaid_packages (
  id              bigserial PRIMARY KEY,
  student_id      bigint NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  lesson_type_id  bigint REFERENCES lesson_types(id) ON DELETE RESTRICT,
  purchased_at    timestamptz NOT NULL,
  credit_count    integer NOT NULL CHECK (credit_count > 0),
  unit_price      numeric(10,2) NOT NULL CHECK (unit_price >= 0),
  total_amount    numeric(10,2) NOT NULL CHECK (total_amount > 0),
  currency        text NOT NULL DEFAULT 'TRY',
  note            text,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- Muhasebe invariant'ı: paket toplamı kredi × birim fiyat olmak zorunda.
  CONSTRAINT chk_prepaid_total_equals_credits_times_unit
    CHECK (total_amount = credit_count * unit_price)
);

CREATE INDEX idx_prepaid_packages_student_purchased_at ON prepaid_packages (student_id, purchased_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_prepaid_packages_lesson_type_id ON prepaid_packages (lesson_type_id)
  WHERE lesson_type_id IS NOT NULL AND deleted_at IS NULL;
```

**V1 davranışı:** FIFO kredi tahsisi (§5.2) `lesson_type_id` kolonunu filtrelemez — paket generic sayılır. Bu kolonun tam semantiği (type-scoped krediler) ileriki revizyonda devreye alınır.

### 3.6 payments

```sql
CREATE TABLE payments (
  id                    bigserial PRIMARY KEY,
  paid_at               timestamptz NOT NULL,
  amount                numeric(10,2) NOT NULL CHECK (amount > 0),
  currency              text NOT NULL DEFAULT 'TRY',
  source                text NOT NULL CHECK (source IN ('cash', 'iban')),
  lesson_id             bigint REFERENCES lessons(id) ON DELETE RESTRICT,
  product_sale_id       bigint REFERENCES product_sales(id) ON DELETE RESTRICT,
  prepaid_package_id    bigint REFERENCES prepaid_packages(id) ON DELETE RESTRICT,
  note                  text,
  deleted_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- XOR: tam olarak bir hedef dolu
  CONSTRAINT chk_payments_single_target
    CHECK (
      (CASE WHEN lesson_id IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN product_sale_id IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN prepaid_package_id IS NOT NULL THEN 1 ELSE 0 END) = 1
    )
);

CREATE INDEX idx_payments_lesson_id ON payments (lesson_id) WHERE lesson_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_payments_product_sale_id ON payments (product_sale_id) WHERE product_sale_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_payments_paid_at ON payments (paid_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_payments_source ON payments (source) WHERE deleted_at IS NULL;

-- HARDENING: Paket başına en fazla bir aktif payment olmasını DB-level garanti et.
CREATE UNIQUE INDEX ux_payments_one_active_per_package
  ON payments (prepaid_package_id)
  WHERE prepaid_package_id IS NOT NULL AND deleted_at IS NULL;
```

**Notlar:**
- `source` v1'de yalnızca `'cash'` ve `'iban'`. `'balance'` source kavramı v1 kapsamından çıkarılmıştır (§2.6). Historical migration 0006 `'balance'` değerini içeriyordu; migration 0203 (§3.9) bu değeri CHECK constraint'ten daralttı.
- `ux_payments_one_active_per_package` sayesinde aynı paket için ikinci aktif payment INSERT edilmek istenirse unique violation fırlatır. Soft-delete edilmiş payment'lar WHERE filtresi dışında olduğu için paket silme + yeniden oluşturma senaryosu desteklenir.
- "Paket için source='balance' yasak" gibi eski bir kural artık anlamsızdır çünkü `'balance'` source'u yoktur. `chk_payments_prepaid_source` v1'de anlamını yitirir ve schema tarafında kaldırılabilir; kod tabanında hâlâ mevcutsa operasyonel etkisi yoktur (package payment zaten sadece cash/iban ile yaratılır).

### 3.7 audit_logs

```sql
-- NOTE: Bu final DDL, 0008 (ilk tablo) + 0203 (balance kayıtları purge) + 0214
-- (lesson_discount_updated action) + 0224 (actor_user_id) + 0225 (lesson_uncompleted,
-- lesson_type_*, settings_updated genişletmeleri) uygulandıktan sonraki durumdur.
-- v1.3 spec'inde teklif edilen 3 auth action'ı (user_login, user_logout,
-- password_changed) ve entity_type='user' v1.4'te kapsama alınmadı (§2.14).
CREATE TABLE audit_logs (
  id              bigserial PRIMARY KEY,
  action          text NOT NULL CHECK (action IN (
                    'lesson_created',
                    'lesson_status_change',
                    'lesson_uncompleted',     -- v1.4 (migration 0225)
                    'lesson_updated',
                    'lesson_deleted',
                    'lesson_discount_updated',
                    'bulk_price_update',
                    'payment_created',
                    'payment_updated',
                    'payment_deleted',
                    'product_sale_created',
                    'product_sale_updated',
                    'product_sale_deleted',
                    'prepaid_package_created',
                    'prepaid_package_deleted',
                    'student_created',
                    'student_updated',
                    'student_deleted',
                    'lesson_type_created',     -- v1.4 (migration 0225)
                    'lesson_type_updated',     -- v1.4 (migration 0225)
                    'settings_updated'         -- v1.4 (migration 0225)
                  )),
  entity_type     text NOT NULL CHECK (entity_type IN (
                    'student',
                    'lesson',
                    'product_sale',
                    'prepaid_package',
                    'payment',
                    'balance_transaction',     -- LEGACY: 0203 ile içerik silindi ama
                                               -- CHECK listesinde kalıntı olarak duruyor.
                                               -- Pratik etki yok; ileride drop edilebilir.
                    'lesson_type',             -- v1.4 (migration 0225)
                    'settings'                 -- v1.4 (migration 0225)
                  )),
  entity_id       bigint NOT NULL,
  actor_user_id   bigint REFERENCES users(id), -- v1.3, NULL = legacy/system
  before          jsonb,
  after           jsonb,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_entity            ON audit_logs (entity_type, entity_id);
CREATE INDEX idx_audit_action            ON audit_logs (action);
CREATE INDEX idx_audit_created_at        ON audit_logs (created_at);
CREATE INDEX idx_audit_logs_actor        ON audit_logs (actor_user_id, created_at DESC);
```

**`actor_user_id` semantiği (v1.3):**
- NOT NULL servis-level invariant'tır (DB-level değil — legacy satırlar için NULL kabul edilir).
- Tüm mutating *iş servisleri* (`createLesson`, `completeLesson`, `uncompleteLesson`, `setLessonDiscount`, `createCashPayment`, `createPrepaidPackage`, `createProductSale`, `updateSettings`, `createLessonType`, `updateLessonType`, ...) çağrıldıkları request'in `req.currentUser.id` değerini taşır.
- **v1.4'te login/logout/password değişimi audit'a yazılmaz** (§2.14). CHECK listesi bu yüzden 3 auth action'ını içermez; ileride eklenirse migration ile genişletilir.

**Tarihsel not:** Audit action listesi önceki revizyonda balance-ile-ilgili action'ları (`balance_manual_adjustment`, `balance_refund`, `balance_overpayment_credit`, `balance_usage_debit`) içeriyordu; v1 sadeleştirmesi ile kaldırılmıştır. Migration 0008 orijinal listeyi, 0203 daraltma, 0214 `lesson_discount_updated`, 0224 `actor_user_id` kolonu, 0225 `lesson_uncompleted` + `lesson_type_*` + `settings_updated` action'ları ile `lesson_type` + `settings` entity_type'larını ekler. `entity_type='balance_transaction'` CHECK listesinde kaldı ama hiçbir satır yok (0203 purge sonrası).

**v1.3 spec sapması:** Spec v1.3 `lessons.actor_user_id` ve `payments.actor_user_id` kolonlarını öngörmüyordu; migration 0223 yanlışlıkla bu iki tabloya da `actor_user_id` ekledi. Kolonlar **kullanılmıyor** (servis sadece `audit_logs.actor_user_id`'ye yazıyor) → ölü kolon. Drop migration'ı v1.5+ kapsamına ertelendi (NULL hep, performans/disk etkisi yok).

**`lesson_discount_updated` olayı (§2.12):**
- `entity_type = 'lesson'`, `entity_id = <lesson id>`
- `before = {"discount_amount": "<eski değer>"}`
- `after  = {"discount_amount": "<yeni değer>"}`
- `note` opsiyonel — operatörün indirim nedenini yazdığı serbest metin.
- Hareketler akışı bu olayı "İndirim uygulandı / güncellendi / kaldırıldı" olarak görselleştirir (§8.3).

### 3.8 DB-Level Invariant Trigger'ları

Bazı kritik kurallar tek tablo CHECK ile ifade edilemez (cross-table referanslar gerektirir). Servis katmanı **ve** DB trigger'da çift katmanda korunur. DB trigger'ları "defense in depth"tir.

**Scope:** Dört trigger (en kritik invariant'lar).

#### 3.8.1 Payment target coherence (payments için BEFORE INSERT/UPDATE)

- `lesson_id` dolu ise → lesson `status = 'completed'` ve `prepaid_package_id IS NULL` olmalı
- `product_sale_id` dolu ise → product_sale mevcut ve `deleted_at NULL`
- `prepaid_package_id` dolu ise → package mevcut ve `deleted_at NULL`
- Currency target ile match etmeli

```sql
CREATE OR REPLACE FUNCTION trg_validate_payment_target() RETURNS trigger AS $$
DECLARE
  v_lesson   lessons%ROWTYPE;
  v_sale     product_sales%ROWTYPE;
  v_package  prepaid_packages%ROWTYPE;
BEGIN
  IF NEW.lesson_id IS NOT NULL THEN
    SELECT * INTO v_lesson FROM lessons WHERE id = NEW.lesson_id;
    IF NOT FOUND OR v_lesson.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Payment target lesson not found or deleted';
    END IF;
    IF v_lesson.status <> 'completed' THEN
      RAISE EXCEPTION 'Payment allowed only on completed lesson (lesson #% status=%)', NEW.lesson_id, v_lesson.status;
    END IF;
    IF v_lesson.prepaid_package_id IS NOT NULL THEN
      RAISE EXCEPTION 'Credit-covered lesson has no debt; cannot attach payment (lesson #%)', NEW.lesson_id;
    END IF;
    IF v_lesson.currency <> NEW.currency THEN
      RAISE EXCEPTION 'Currency mismatch: payment=% lesson=%', NEW.currency, v_lesson.currency;
    END IF;
  END IF;

  IF NEW.product_sale_id IS NOT NULL THEN
    SELECT * INTO v_sale FROM product_sales WHERE id = NEW.product_sale_id;
    IF NOT FOUND OR v_sale.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Payment target product_sale not found or deleted';
    END IF;
    IF v_sale.currency <> NEW.currency THEN
      RAISE EXCEPTION 'Currency mismatch: payment=% product_sale=%', NEW.currency, v_sale.currency;
    END IF;
  END IF;

  IF NEW.prepaid_package_id IS NOT NULL THEN
    SELECT * INTO v_package FROM prepaid_packages WHERE id = NEW.prepaid_package_id;
    IF NOT FOUND OR v_package.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Payment target prepaid_package not found or deleted';
    END IF;
    IF v_package.currency <> NEW.currency THEN
      RAISE EXCEPTION 'Currency mismatch: payment=% package=%', NEW.currency, v_package.currency;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

#### 3.8.2 Lesson credit coherence (lessons için BEFORE UPDATE)

`prepaid_package_id` set edilirken paketin aynı öğrenciye ait ve aktif olduğunu garanti eder.

```sql
CREATE OR REPLACE FUNCTION trg_validate_lesson_credit() RETURNS trigger AS $$
DECLARE
  v_package prepaid_packages%ROWTYPE;
BEGIN
  IF NEW.prepaid_package_id IS NOT NULL
     AND (OLD.prepaid_package_id IS DISTINCT FROM NEW.prepaid_package_id) THEN
    SELECT * INTO v_package FROM prepaid_packages WHERE id = NEW.prepaid_package_id;
    IF NOT FOUND OR v_package.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Prepaid package not found or deleted';
    END IF;
    IF v_package.student_id <> NEW.student_id THEN
      RAISE EXCEPTION 'Package student mismatch';
    END IF;
    IF v_package.currency <> NEW.currency THEN
      RAISE EXCEPTION 'Currency mismatch on credit allocation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

#### 3.8.3 Package payment non-deletion (payments için BEFORE UPDATE)

Paket'e bağlı payment tek başına soft-delete edilemez (§2.9).

```sql
CREATE OR REPLACE FUNCTION trg_block_package_payment_delete() RETURNS trigger AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
     AND NEW.prepaid_package_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM prepaid_packages
      WHERE id = NEW.prepaid_package_id
        AND deleted_at IS NOT NULL
    ) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Cannot soft-delete payment bound to active prepaid_package';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**Not:** Atomik silme akışında (§5.6b) paket önce soft-delete edilir, payment'ın sonra silinmesi sırasında trigger EXISTS kontrolünde paketin de silinmiş olduğunu görür ve izin verir.

#### 3.8.4 Updated_at auto-touch (tüm tablolarda)

`updated_at` kolonu olan her tabloda UPDATE sonrası otomatik güncellenir.

**Servis katmanı kuralı:** `updated_at = now()` **manuel olarak SET edilmez** — bu alan yalnızca trigger tarafından yönetilir.

```sql
CREATE OR REPLACE FUNCTION trg_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER students_touch_updated_at        BEFORE UPDATE ON students        FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
CREATE TRIGGER lessons_touch_updated_at         BEFORE UPDATE ON lessons         FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
CREATE TRIGGER product_sales_touch_updated_at   BEFORE UPDATE ON product_sales   FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
CREATE TRIGGER prepaid_packages_touch_updated_at BEFORE UPDATE ON prepaid_packages FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
CREATE TRIGGER payments_touch_updated_at        BEFORE UPDATE ON payments        FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
-- audit_logs'ta updated_at yok (append-only, asla update edilmez)
-- studio_settings'te manuel updated_at set edilir (singleton)
```

### 3.9 Migration Sırası

FK bağımlılıkları nedeniyle doğru sıra:

```
Schema (0001-0008):
  0001_studio_settings.sql
  0002_students.sql
  0003_product_sales.sql
  0004_prepaid_packages.sql
  0005_lessons.sql
  0006_payments.sql
  0007_student_balance_transactions.sql   (legacy, 0203 ile drop edildi)
  0008_audit_logs.sql

Triggers (0050):
  0050_triggers.sql

Views (0100):
  0100_views.sql
    - v_lesson_balances
    - v_product_sale_balances
    - v_prepaid_package_status
    - v_student_balances                  (legacy, 0203 ile drop edildi)
    - v_student_summary                   (0203 ile yeniden yaratıldı, current_balance kolonu yok)

Seed (0200):
  0200_seed.sql
    - INSERT INTO studio_settings (id) VALUES (1);

Sonraki değişiklikler (0201+):
  0201_studio_settings_v2.sql                  (ek ayar kolonları)
  0202_lesson_color_saturation.sql
  0203_remove_student_balance.sql              (balance sistemini kaldırır; §2.6 sadeleştirmesi)

Multi-entity + discount altyapısı (0210+, canlı öncesi):
  0210_instructors.sql                         (tablo; seed satırı bootstrap aşamasında atılır — PII migration içinde tutulmaz)
  0211_lesson_types.sql                        (tablo + seed "Yoga & Meditasyon", 60 dk)
  0212_lessons_multi_entity_discount.sql       (instructor_id, lesson_type_id, duration_minutes, discount_amount + backfill + CHECK'ler + indexler)
  0213_prepaid_packages_lesson_type.sql        (nullable lesson_type_id kolonu)
  0214_audit_logs_discount_action.sql          ('lesson_discount_updated' action eklenir)
  0215_views_net_amount.sql                    (v_lesson_balances → net_amount kolonu; v_student_summary net bazlı)

Öğrenci profil zenginleştirme + fiyat modeli sadeleştirmesi (0216–0220):
  0216_students_nickname.sql                   (students.nickname + v_student_summary recreate)
  0217_students_preferred_mode.sql             (students.preferred_mode + v_student_summary recreate)
  0218_lesson_types_pricing.sql                (lesson_types.default_price + currency; backfill studio_settings.default_lesson_price'tan)
  0219_students_drop_default_lesson_price.sql  (students.default_lesson_price kolonu drop)
  0220_studio_settings_drop_default_lesson_price.sql (studio_settings.default_lesson_price kolonu drop)

Ürün satışı ↔ ders bağı (v1.2 → v1.6):
  0221_product_sales_lesson_link.sql           (v1.2: product_sales.lesson_id nullable kolon + index + v_product_sale_balances recreate)
  0233_clear_product_sales_lesson_link.sql     (v1.6: tüm lesson_id değerleri NULL — display-side eşleştirmeye geçiş; kolon korunur)

Auth + audit genişletmesi (v1.3 → v1.4):
  0222_users_sessions.sql                      (users + sessions tabloları; admin user'lar bootstrap aşamasında yaratılır — PII migration içinde tutulmaz)
  0223_audit_actor.sql                         (lessons.actor_user_id + payments.actor_user_id — KULLANILMIYOR; spec sapması, drop bekleniyor)
  0224_audit_actor_user.sql                    (audit_logs.actor_user_id kolonu + idx_audit_logs_actor)
  0225_audit_extend_enums.sql                  (action listesi: lesson_uncompleted, lesson_type_created/updated, settings_updated; entity_type listesi: lesson_type, settings; v1.3 spec'indeki 3 auth action ve entity_type='user' EKLENMEDİ — §2.14, §11)
```

**0203 migration'ının işi özetle:**
- `v_student_summary` ve `v_student_balances` drop
- `student_balance_transactions` table drop
- `payments.source` CHECK constraint'i `('cash','iban')` olarak daralt
- `audit_logs`'tan balance-ilgili kayıtları sil, CHECK constraint'leri §3.7'deki daralmış listeye güncelle
- `v_student_summary` yeniden yaratılır; `current_balance` kolonu yok

**0210–0215 migration'larının işi özetle (§2.12, §2.13):**
- 0210: `instructors` tablosu yaratılır. **PII içermez** — gerçek eğitmen ismi migration'da tutulmaz; bootstrap aşamasında (§10) env-driven `INSERT` ile atılır.
- 0211: `lesson_types` tablosu (`default_duration_minutes` zorunlu) + aktif seed: "Yoga & Meditasyon" (60 dk).
- 0212: `lessons` tablosuna `instructor_id`, `lesson_type_id`, `duration_minutes`, `discount_amount` eklenir; mevcut test verileri tek aktif eğitmen + tip + 60 dk + 0 indirim ile backfill edilir; CHECK constraint'ler (§2.12) kurulur; partial index'ler oluşturulur.
- 0213: `prepaid_packages.lesson_type_id` nullable eklenir.
- 0214: `audit_logs.action` CHECK'ine `lesson_discount_updated` eklenir.
- 0215: `v_lesson_balances` yeniden yaratılır — `net_amount = price_snapshot - discount_amount` kolonu, `remaining_receivable` net üzerinden. `v_student_summary` bağımlılık nedeniyle drop/recreate edilir (şekil değişmez).

**0216–0220 migration'larının işi özetle (§3.2, §3.11):**
- 0216: `students.nickname` (opsiyonel ikinci ad) eklenir. `v_student_summary` drop/recreate; `nickname` kolonu eklenir.
- 0217: `students.preferred_mode` (`online`/`onsite` veya NULL) eklenir. `v_student_summary` drop/recreate; `preferred_mode` kolonu eklenir.
- 0218: `lesson_types.default_price` ve `currency` kolonları eklenir; `default_price` mevcut `studio_settings.default_lesson_price`'tan backfill edilir; sonra NOT NULL'a çekilir. Settings singleton satırı yoksa veya değer NULL ise migration açık hata verir.
- 0219: `students.default_lesson_price` kolonu drop edilir (yeni fiyat modelinde rolü kalmadı).
- 0220: `studio_settings.default_lesson_price` kolonu drop edilir (tek fiyat kaynağı `lesson_types.default_price`).

**0221 migration'ının işi özetle (v1.2):**
- 0221: `product_sales.lesson_id` (nullable) + index eklenir; `v_product_sale_balances` `CREATE OR REPLACE` ile yeniden yaratılır (`lesson_id` kolonu sona eklenir).

**0222–0225 migration'larının işi özetle (v1.3 → v1.4, §2.14):**
- 0222: `users` (`display_name` kolonu, `is_active`, `password_hash`) ve `sessions` (`bigserial id` PK + `token text UNIQUE`, `expires_at`, `last_seen_at`) tabloları yaratılır. **Admin kullanıcılar migration'da seed edilmez** (username + şifre PII'dir, public repo'ya commit edilemez); bootstrap aşamasında (§10) `.env`'den okunup yaratılırlar. `users` üzerinde `updated_at` trigger'ı kurulur. `sessions` üzerinde `(token)` ve `(expires_at)` index'leri.
- 0223: `lessons.actor_user_id` ve `payments.actor_user_id` kolonları eklenir. **v1.4'te kullanılmıyor** (servis sadece `audit_logs.actor_user_id`'ye yazıyor); ölü kolonlar olarak kaldı, drop ertelendi.
- 0224: `audit_logs.actor_user_id bigint REFERENCES users(id) ON DELETE SET NULL` kolonu + `idx_audit_logs_actor (actor_user_id, created_at DESC)` index'i eklenir.
- 0225: `audit_logs_action_check` listesi `lesson_uncompleted`, `lesson_type_created`, `lesson_type_updated`, `settings_updated` ile genişletilir. `audit_logs_entity_type_check` `lesson_type`, `settings` ile genişletilir. **v1.3 spec'indeki `user_login`/`user_logout`/`password_changed` action'ları ve `entity_type='user'` eklenmedi** — auth audit logging v1.4'te kapsam dışı (§2.14).

**Kurallar:**
- Her migration idempotent olmamalı (tek seferlik uygulanır); runner tablosu durum takibini yapar.
- Seed sadece `0200_seed.sql`'de bulunur — **istisna:** `0210` (default instructor) ve `0211` (default lesson_type) seed satırlarını migration gövdesinde içerir; bunlar sistem seed'idir, test verisi değildir.
- Trigger'lar tablolardan sonra, view'lardan önce (0050).
- View'lar tablolardan sonra (0100).
- Sonraki schema değişiklikleri ayrı numaralı migration'larla yapılır (hiçbir eski migration in-place düzenlenmez).

### 3.10 instructors

```sql
CREATE TABLE instructors (
  id          bigserial PRIMARY KEY,
  full_name   text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Migration 0210 yalnızca tabloyu yaratır; gerçek eğitmen ismi (PII)
-- migration'da hardcoded değildir. Bootstrap script (§10) deploy zamanında
-- BOOTSTRAP_INSTRUCTOR_NAME env değerini okuyarak insert yapar:
--   INSERT INTO instructors (full_name, is_active) VALUES ($1, true);
```

- V1'de tek aktif eğitmen. `createLesson` aktif seed'i otomatik atar (§5.1).
- Kolonlar minimum set: `phone`, `email`, `color_hex` gibi alanlar v1'de yok, ileride eklenir.

### 3.11 lesson_types

```sql
-- NOTE: Bu final DDL, 0211 (ilk tablo) + 0218 (default_price + currency)
-- uygulandıktan sonraki durumdur. Historical migration 0211 default_price ve
-- currency kolonlarını içermez; 0218'de eklenir ve NOT NULL'a çekilir.
CREATE TABLE lesson_types (
  id                        bigserial PRIMARY KEY,
  name                      text NOT NULL,
  default_duration_minutes  integer NOT NULL DEFAULT 60
                            CHECK (default_duration_minutes > 0 AND default_duration_minutes <= 240),
  default_price             numeric(10,2) NOT NULL CHECK (default_price >= 0),
  currency                  text NOT NULL DEFAULT 'TRY' CHECK (currency = 'TRY'),
  is_active                 boolean NOT NULL DEFAULT true,
  deleted_at                timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- Default seed (migration 0211); default_price 0218'de studio_settings'ten
-- backfill edilir, sonradan per-type elle yönetilir.
INSERT INTO lesson_types (name, default_duration_minutes, is_active)
VALUES ('Yoga & Meditasyon', 60, true);
```

- V1'de tek aktif ders tipi. `createLesson` `duration_minutes` değerini aktif seed'in `default_duration_minutes` alanından okur.
- **Fiyat kaynağı:** `lesson.price_snapshot` create anında `lesson_type.default_price` üzerinden kopyalanır (§2.3). Öğrenci başına default fiyat yoktur; özel durumlar indirim ile modellenir.

### 3.12 users (v1.3 → v1.4 kod realitesi)

```sql
-- Migration 0222'nin uyguladığı gerçek DDL.
CREATE TABLE users (
  id              bigserial PRIMARY KEY,
  username        text NOT NULL UNIQUE,
  display_name    text NOT NULL,
  password_hash   text NOT NULL,                  -- bcrypt cost 12
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER users_touch_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

-- Migration 0222 yalnızca tabloyu yaratır; admin kullanıcılar (username +
-- password) PII olduğu için migration'da hardcoded değildir. Bootstrap
-- script (§10) deploy zamanında BOOTSTRAP_ADMINS env değerini okuyarak
-- bcrypt(cost=12) ile hash'leyip insert yapar:
--   INSERT INTO users (username, display_name, password_hash) VALUES ($1, $1, $2)
--   ON CONFLICT (username) DO NOTHING;
-- (Bootstrap'ta display_name = username; kullanıcı DB'den manuel düzeltebilir.)
-- Self-service şifre reset (forgotten password) yok — sysadmin DB üzerinden
-- manuel UPDATE ile reset yapar.
```

**Kurallar (v1.4 kod realitesi):**
- `username` plain `UNIQUE`. v1.3 spec'i CHECK constraint (lowercase + `[a-z0-9_-]` + 3–32 char) öneriyordu; v1.4 bu CHECK'i **eklemedi** — kapalı admin sistemi için over-engineering kabul edildi. Bootstrap operatörü makul username üretmekle sorumlu.
- Login formu username string'i alır; backend ham string ile karşılaştırır. Operatör DB'ye küçük harf yazmadıkça case-sensitive davranır.
- v1.3'te tek rol: tüm aktif user'lar admin. `role` kolonu yoktur.
- **Soft delete yok** (`deleted_at` kolonu eklenmedi). Hesap pasifleştirme `is_active = false` ile yapılır; mevcut session'ları bir sonraki request'te 401 alır (`validateSession` `is_active = true` filtresi ile).
- **Email kolonu yok** — password reset email, notification gibi senaryolar v1 dışı (§9).
- **Display field adı `display_name`** (spec v1.3 `full_name` öneriyordu). API çıkışlarında `displayName` (camelCase).

### 3.13 sessions (v1.3 → v1.4 kod realitesi)

```sql
-- Migration 0222'nin uyguladığı gerçek DDL.
CREATE TABLE sessions (
  id            bigserial PRIMARY KEY,
  user_id       bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token         text NOT NULL UNIQUE,                 -- crypto.randomBytes(32).toString('hex')
  expires_at    timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_token_idx   ON sessions (token);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);
```

**Kurallar (v1.4 kod realitesi):**
- **Şema farkı (v1.3 spec → v1.4 kod):** v1.3 spec `id text PRIMARY KEY` (opaque secret = PK) öneriyordu; v1.4 `bigserial id` + ayrı `token text UNIQUE` kullanır. Lookup `token` üstünden, JOIN'lerde `id` (integer FK ucuz). Token ileride hash'lenmek istenirse cookie değişmeden DB tarafı kolayca güncellenir.
- `token` cookie'de düz tutulur (httpOnly + secure-prod + SameSite=Lax/dev veya None/prod, cross-origin Vercel+Railway için).
- **Sliding window:** her korumalı request `last_seen_at = now()` ve `expires_at = now() + interval '30 days'` ile güncellenir (`auth.service.ts` `validateSession`).
- **`user_agent` ve `ip` kolonları yok.** v1.3 spec'i öneriyordu (rate limit + audit IP/UA için); v1.4 rate limit ve auth audit'ı kapsam dışına çıkardığı için bu kolonlar da eklenmedi (§2.14, §11). İleride gerekirse `ALTER TABLE` ile eklenir.
- Cleanup: request-zamanı `s.expires_at > now()` filtresi (`validateSession`) — request-time invalidation yeterli; nightly cron v1'de kurulmadı.
- `ON DELETE CASCADE`: user hard-delete edilirken session'lar otomatik silinir (`is_active=false` kullanan akışta CASCADE devreye girmez; bir sonraki request 401 alır).

---

## 4. KPI Hesaplamaları

Hafta penceresi: `[monday 00:00 Europe/Istanbul, next_monday 00:00 Europe/Istanbul)`.

```sql
-- Bu haftanın Pazartesi 00:00 Europe/Istanbul
SELECT date_trunc('week', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul' AS week_start;
```

### 4.1 Tahsilat (Cash Inflow)

**Tanım:** Belirli pencerede kasaya/hesaba fiziksel olarak giren para.

```sql
SELECT COALESCE(SUM(amount), 0) AS total_cash_inflow,
       COALESCE(SUM(CASE WHEN source = 'cash' THEN amount ELSE 0 END), 0) AS cash_total,
       COALESCE(SUM(CASE WHEN source = 'iban' THEN amount ELSE 0 END), 0) AS iban_total
FROM payments
WHERE paid_at >= :week_start
  AND paid_at <  :week_end
  AND deleted_at IS NULL;
```

**Not:** V1'de her payment fiziksel nakit girişi demektir (cash veya iban). Source enum'unda başka değer yoktur, o yüzden ayrıca filtrelenmez. (Eski revizyonda `source = 'balance'` payment'lar tahsilata dahil edilmezdi çünkü mahsup kavramı vardı; §2.6 sonrası bu ayrım ortadan kalktı.)

### 4.2 Ciro (Revenue)

**Tanım:** Belirli pencerede hak edilmiş tutar. **Net bazlı** — indirim uygulanmışsa düşülür (§2.12).

```sql
-- Lesson cirosu (kredi ile karşılanan dersler DAHİL, çünkü price_snapshot dolu;
-- net = price_snapshot - discount_amount).
SELECT COALESCE(SUM(price_snapshot - discount_amount), 0) AS lesson_revenue
FROM lessons
WHERE status = 'completed'
  AND starts_at >= :week_start
  AND starts_at <  :week_end
  AND deleted_at IS NULL;

-- Ürün satışı cirosu
SELECT COALESCE(SUM(total_amount), 0) AS product_revenue
FROM product_sales
WHERE sold_at >= :week_start
  AND sold_at <  :week_end
  AND deleted_at IS NULL;

-- Toplam = lesson_revenue + product_revenue
```

**Kritik:** Ciro hesabı `starts_at` üzerinden yapılır, `completed_at` üzerinden değil. Geç işaretlenen ders orijinal hafta cirosuna yazılır. İndirim daha sonra uygulansa bile cironun net değeri, sorgu anında geçerli `discount_amount` ile hesaplanır — yani bir dersin cirosu zamana göre değişebilir; audit trail `lesson_discount_updated` olaylarıyla bu sapmayı izlenebilir kılar.

### 4.3 Ders Sayıları

```sql
SELECT COUNT(*) AS planned
FROM lessons
WHERE starts_at >= :week_start
  AND starts_at <  :week_end
  AND status IN ('scheduled', 'completed', 'no_show')
  AND deleted_at IS NULL;

SELECT COUNT(*) AS completed
FROM lessons
WHERE starts_at >= :week_start
  AND starts_at <  :week_end
  AND status = 'completed'
  AND deleted_at IS NULL;
```

### 4.4 Doluluk

```sql
SELECT
  (planned::numeric / s.weekly_capacity::numeric) AS occupancy_ratio
FROM studio_settings s
CROSS JOIN LATERAL (
  SELECT COUNT(*) AS planned
  FROM lessons l
  WHERE l.starts_at >= :week_start
    AND l.starts_at <  :week_end
    AND l.status IN ('scheduled', 'completed', 'no_show')
    AND l.deleted_at IS NULL
) p
WHERE s.id = 1;
```

### 4.5 Bekleyen Tahsilat (Receivable)

**Tanım:** Öğrencilerin stüdyoya açık borçları.

```sql
WITH lesson_balances AS (
  SELECT
    l.id,
    (l.price_snapshot - l.discount_amount) - COALESCE(pay.paid_sum, 0) AS remaining
  FROM lessons l
  LEFT JOIN (
    SELECT lesson_id, SUM(amount) AS paid_sum
    FROM payments
    WHERE lesson_id IS NOT NULL AND deleted_at IS NULL
    GROUP BY lesson_id
  ) pay ON pay.lesson_id = l.id
  WHERE l.status = 'completed'
    AND l.prepaid_package_id IS NULL
    AND l.deleted_at IS NULL
),
product_balances AS (
  SELECT
    ps.id,
    ps.total_amount - COALESCE(pay.paid_sum, 0) AS remaining
  FROM product_sales ps
  LEFT JOIN (
    SELECT product_sale_id, SUM(amount) AS paid_sum
    FROM payments
    WHERE product_sale_id IS NOT NULL AND deleted_at IS NULL
    GROUP BY product_sale_id
  ) pay ON pay.product_sale_id = ps.id
  WHERE ps.deleted_at IS NULL
)
SELECT
  (SELECT COALESCE(SUM(GREATEST(0, remaining)), 0) FROM lesson_balances) +
  (SELECT COALESCE(SUM(GREATEST(0, remaining)), 0) FROM product_balances)
AS total_receivable;
```

**Not:** `GREATEST(0, remaining)` savunma amaçlı. §2.6 fazla ödeme reddi + §2.12 discount validation sayesinde `remaining` zaten negatife düşmemeli; düşerse bir yerde bug vardır (servis discount apply anında `paid > price - discount` kombinasyonunu reddeder; §5.8).

### 4.6 Aktif Kredi Değeri (Deferred)

```sql
WITH package_usage AS (
  SELECT
    pp.id,
    pp.credit_count,
    pp.unit_price,
    pp.credit_count - COALESCE(used.used_count, 0) AS remaining_credits
  FROM prepaid_packages pp
  LEFT JOIN (
    SELECT prepaid_package_id, COUNT(*) AS used_count
    FROM lessons
    WHERE prepaid_package_id IS NOT NULL
      AND status = 'completed'
      AND deleted_at IS NULL
    GROUP BY prepaid_package_id
  ) used ON used.prepaid_package_id = pp.id
  WHERE pp.deleted_at IS NULL
)
SELECT COALESCE(SUM(GREATEST(0, remaining_credits) * unit_price), 0) AS active_credit_value
FROM package_usage;
```

### 4.7 Öğrenci Bakiyeleri (kaldırıldı)

V1'de "studyonun öğrenciye borcu" gibi bir KPI yoktur. §2.6 sadeleştirmesi ile bu kavram sistemin dışına çıkarılmıştır. Önceki revizyonun "total_student_liability" metriği, "debtor_student_count" hesabındaki `- current_balance` terimi ve ilgili view'lar kaldırılmıştır.

### 4.8 View Önerileri

```sql
-- Migration 0215 ile net_amount / discount_amount kolonlarıyla yeniden yaratılır.
CREATE VIEW v_lesson_balances AS
SELECT
  l.id AS lesson_id,
  l.student_id,
  l.starts_at,
  l.status,
  l.price_snapshot,
  l.discount_amount,
  (l.price_snapshot - l.discount_amount) AS net_amount,
  l.prepaid_package_id,
  COALESCE(pay.paid_sum, 0) AS paid_amount,
  (l.price_snapshot - l.discount_amount) - COALESCE(pay.paid_sum, 0) AS remaining_raw,
  GREATEST(
    0,
    (l.price_snapshot - l.discount_amount) - COALESCE(pay.paid_sum, 0)
  ) AS remaining_receivable
FROM lessons l
LEFT JOIN (
  SELECT lesson_id, SUM(amount) AS paid_sum
  FROM payments
  WHERE lesson_id IS NOT NULL AND deleted_at IS NULL
  GROUP BY lesson_id
) pay ON pay.lesson_id = l.id
WHERE l.deleted_at IS NULL;

-- Migration 0221 ile lesson_id kolonu eklendi (CREATE OR REPLACE VIEW yeni
-- sütunu yalnızca sona ekleyebildiği için lesson_id en sonda — sütun sırası
-- dışında mevcut tüketicilerin kontratı bozulmaz).
CREATE VIEW v_product_sale_balances AS
SELECT
  ps.id AS product_sale_id,
  ps.student_id,
  ps.sold_at,
  ps.total_amount,
  COALESCE(pay.paid_sum, 0) AS paid_amount,
  ps.total_amount - COALESCE(pay.paid_sum, 0) AS remaining_raw,
  GREATEST(0, ps.total_amount - COALESCE(pay.paid_sum, 0)) AS remaining_receivable,
  ps.lesson_id
FROM product_sales ps
LEFT JOIN (
  SELECT product_sale_id, SUM(amount) AS paid_sum
  FROM payments
  WHERE product_sale_id IS NOT NULL AND deleted_at IS NULL
  GROUP BY product_sale_id
) pay ON pay.product_sale_id = ps.id
WHERE ps.deleted_at IS NULL;

CREATE VIEW v_prepaid_package_status AS
SELECT
  pp.id AS package_id,
  pp.student_id,
  pp.purchased_at,
  pp.credit_count,
  pp.unit_price,
  pp.total_amount,
  COALESCE(used.used_count, 0) AS used_credits,
  pp.credit_count - COALESCE(used.used_count, 0) AS remaining_credits,
  (pp.credit_count - COALESCE(used.used_count, 0)) * pp.unit_price AS remaining_value
FROM prepaid_packages pp
LEFT JOIN (
  SELECT prepaid_package_id, COUNT(*) AS used_count
  FROM lessons
  WHERE prepaid_package_id IS NOT NULL
    AND status = 'completed'
    AND deleted_at IS NULL
  GROUP BY prepaid_package_id
) used ON used.prepaid_package_id = pp.id
WHERE pp.deleted_at IS NULL;

-- Öğrenci özet kart (UI için) — v1 sadeleştirmesi: current_balance kolonu yok
CREATE VIEW v_student_summary AS
SELECT
  s.id,
  s.full_name,
  s.is_active,
  (SELECT COALESCE(SUM(remaining_receivable), 0)
     FROM v_lesson_balances
     WHERE student_id = s.id
       AND status = 'completed'
       AND prepaid_package_id IS NULL) AS lesson_debt,
  (SELECT COALESCE(SUM(remaining_receivable), 0)
     FROM v_product_sale_balances
     WHERE student_id = s.id) AS product_debt,
  (SELECT COALESCE(SUM(remaining_value), 0)
     FROM v_prepaid_package_status
     WHERE student_id = s.id AND remaining_credits > 0) AS active_credit_value,
  (SELECT COALESCE(SUM(remaining_credits), 0)
     FROM v_prepaid_package_status
     WHERE student_id = s.id AND remaining_credits > 0) AS remaining_credits
FROM students s
WHERE s.deleted_at IS NULL;
```

**v_student_balances view'ı v1'de yoktur** (legacy, migration 0203 ile drop edildi).

---

## 5. Servis Katmanı Kuralları (Pseudocode)

Aşağıdaki akışlar **tam transaction** (BEGIN/COMMIT) içinde implement edilir. Her biri atomik.

### 5.1 Lesson Oluşturma

```
create_lesson(p_student_id, p_starts_at, p_mode):
  -- V1'de scheduled dersler kredi rezerve etmez. Kredi tahsisi sadece complete_lesson akışında (§5.2).
  -- V1 multi-entity: UI seçim sunmaz, aktif tek eğitmen/ders tipi otomatik atanır (§2.13).

  BEGIN TRANSACTION
    student = SELECT * FROM students WHERE id = p_student_id FOR UPDATE
    IF student IS NULL OR student.deleted_at IS NOT NULL:
      ROLLBACK; RAISE "Student not found"

    -- Aktif tek eğitmen / tip + ders türünden fiyat, süre, currency çek (§2.13, §2.3).
    defaults = SELECT
      (SELECT id FROM instructors
         WHERE is_active AND deleted_at IS NULL
         ORDER BY id ASC LIMIT 1) AS instructor_id,
      lt.id                       AS lesson_type_id,
      lt.default_duration_minutes AS duration_minutes,
      lt.default_price            AS default_price,
      lt.currency                 AS currency
    FROM (SELECT id, default_duration_minutes, default_price, currency
            FROM lesson_types
           WHERE is_active AND deleted_at IS NULL
           ORDER BY id ASC LIMIT 1) lt

    IF defaults.instructor_id IS NULL OR defaults.lesson_type_id IS NULL:
      ROLLBACK; RAISE ValidationError
        "No active instructor or lesson type is configured; cannot create a lesson."

    INSERT INTO lessons
      (student_id, instructor_id, lesson_type_id,
       starts_at, mode, status, duration_minutes,
       price_snapshot, currency)
    VALUES
      (p_student_id, defaults.instructor_id, defaults.lesson_type_id,
       p_starts_at, p_mode, 'scheduled', defaults.duration_minutes,
       defaults.default_price, defaults.currency)
    RETURNING * AS lesson
    -- discount_amount DEFAULT 0 ile otomatik 0

    INSERT INTO audit_logs (action, entity_type, entity_id, after)
    VALUES ('lesson_created', 'lesson', lesson.id, row_to_json(lesson))
  COMMIT
```

### 5.2 Lesson Complete

```
complete_lesson(p_lesson_id):
  -- Saf bir status geçişi: ders 'completed'a alınır ve uygunsa paket
  -- kredisi tahsis edilir. v1.6: ürün satışı bu akıştan kaldırıldı; satışlar
  -- yalnız ürün satış modülünden (§5.x) bağımsız oluşturulur.

  BEGIN TRANSACTION
    lesson = SELECT * FROM lessons WHERE id = p_lesson_id FOR UPDATE
    IF lesson IS NULL OR lesson.deleted_at IS NOT NULL:
      RAISE "Lesson not found or deleted"
    IF lesson.status = 'completed':
      RAISE "Already completed"

    before = row_to_json(lesson)

    -- Aynı öğrenci için paralel completion'ları serileştir (kredi tahsisi race condition koruması)
    PERFORM pg_advisory_xact_lock(hashtext('student_prepaid_' || lesson.student_id))

    -- FIFO kredi tahsisi: en eski aktif paketten 1 kredi düş
    active_package = SELECT pp.*
      FROM prepaid_packages pp
      JOIN v_prepaid_package_status vs ON vs.package_id = pp.id
      WHERE pp.student_id = lesson.student_id
        AND vs.remaining_credits > 0
        AND pp.deleted_at IS NULL
      ORDER BY pp.purchased_at ASC
      LIMIT 1
      FOR UPDATE OF pp

    IF active_package IS NOT NULL:
      UPDATE lessons
        SET status = 'completed',
            completed_at = now(),
            prepaid_package_id = active_package.id,
            price_snapshot = active_package.unit_price
        WHERE id = p_lesson_id
    ELSE:
      UPDATE lessons
        SET status = 'completed',
            completed_at = now()
        WHERE id = p_lesson_id

    after = SELECT row_to_json(l) FROM lessons l WHERE id = p_lesson_id

    INSERT INTO audit_logs (action, entity_type, entity_id, before, after)
    VALUES ('lesson_status_change', 'lesson', p_lesson_id, before, after)
  COMMIT

  RETURN { lesson }
```

**Return shape:** `complete_lesson` çağrısı **`{ lesson }` objesi** döndürür — düz `LessonRow` değil. Tüm caller'lar destructure eder:

```ts
const { lesson: completed } = await completeLesson(lessonId);
// completed.status, completed.prepaid_package_id, completed.price_snapshot ...
```

**v1.6 değişikliği:** Eski `p_product_sale` parametresi ve `product_sale_id` return alanı kaldırıldı. v1.2'de eklenen "ders tamamlama akışında opsiyonel ürün satışı oluşturma" kavramı, v2 ürün satış modülü (gerçek ürün seçimli, kalemli satış) ile gereksizleşti. Ders bloğunda gösterilen satışlar artık aynı gün + aynı öğrenci eşleşmesi ile listelenir (§8.4).

**Advisory lock mantığı:** `student_prepaid_<id>` anahtarı sayesinde aynı öğrenci için paralel `complete_lesson` çağrıları seri işlenir; iki completed ders aynı paketin son kredisini görüp ikisi de tüketmeye çalışamaz.

### 5.3 Cash/IBAN Payment (fazla ödeme reddi)

**Önemli:** Bu akış **yalnızca lesson veya product_sale** hedefleri için kullanılır. Prepaid package için ayrı akış: §5.4. Paket'e başka yerden payment yazılmasına izin verilmez.

```
create_cash_payment(p_target_type, p_target_id, p_amount, p_source, p_paid_at, p_note):
  ASSERT p_source IN ('cash', 'iban')
  ASSERT p_amount > 0
  ASSERT p_target_type IN ('lesson', 'product_sale')

  BEGIN TRANSACTION
    IF p_target_type = 'lesson':
      target = SELECT * FROM lessons WHERE id = p_target_id FOR UPDATE
      IF target IS NULL OR target.deleted_at IS NOT NULL:
        RAISE LessonNotFoundError
      IF target.status <> 'completed':
        RAISE PaymentTargetMismatchError "Payment only allowed on completed lesson"
      IF target.prepaid_package_id IS NOT NULL:
        RAISE PaymentTargetMismatchError "Credit-covered lesson has no debt"
      paid_sum = SELECT COALESCE(SUM(amount), 0)
        FROM payments
        WHERE lesson_id = p_target_id AND deleted_at IS NULL
      -- §2.12: kalan borç NET tutar üzerinden hesaplanır.
      remaining = (target.price_snapshot - target.discount_amount) - paid_sum

    ELIF p_target_type = 'product_sale':
      target = SELECT * FROM product_sales WHERE id = p_target_id FOR UPDATE
      IF target IS NULL OR target.deleted_at IS NOT NULL:
        RAISE ProductSaleNotFoundError
      paid_sum = SELECT COALESCE(SUM(amount), 0)
        FROM payments
        WHERE product_sale_id = p_target_id AND deleted_at IS NULL
      remaining = target.total_amount - paid_sum

    -- §2.6 fazla ödeme reddi
    IF p_amount > remaining:
      RAISE OverpaymentNotAllowedError
        "Payment amount exceeds the remaining debt."

    INSERT INTO payments (paid_at, amount, currency, source, <target_fk>)
    VALUES (p_paid_at, p_amount, target.currency, p_source, p_target_id)
    RETURNING * AS payment

    INSERT INTO audit_logs (action, entity_type, entity_id, after)
    VALUES ('payment_created', 'payment', payment.id, row_to_json(payment))
  COMMIT
```

**Concurrency ve lock mantığı:**
- Aynı target için paralel `create_cash_payment` çağrıları parent row lock (`FOR UPDATE`) ile serileştirilir.
- V1'de fazla ödeme hiçbir durumda kabul edilmediği için "bakiye race condition" diye ayrı bir lock'a gerek yoktur.

### 5.4 Prepaid Package Oluşturma

Prepaid package'a ödeme yalnızca bu akışta atomik olarak yapılır. `create_cash_payment` package hedefini kabul etmez. "Paket vardır ama ödenmedi" durumu yapısal olarak imkansızdır.

```
create_prepaid_package(p_student_id, p_purchased_at, p_credit_count, p_unit_price,
                       p_total_amount, p_source):
  ASSERT p_credit_count > 0
  ASSERT p_unit_price >= 0
  ASSERT p_total_amount > 0
  ASSERT p_source IN ('cash', 'iban')

  BEGIN TRANSACTION
    student = SELECT * FROM students WHERE id = p_student_id FOR UPDATE
    IF student IS NULL OR student.deleted_at IS NOT NULL:
      RAISE StudentNotFoundError

    INSERT INTO prepaid_packages
      (student_id, purchased_at, credit_count, unit_price, total_amount, currency)
    VALUES
      (p_student_id, p_purchased_at, p_credit_count, p_unit_price, p_total_amount, student.currency)
    RETURNING * AS package

    INSERT INTO payments
      (paid_at, amount, currency, source, prepaid_package_id)
    VALUES
      (p_purchased_at, p_total_amount, student.currency, p_source, package.id)
    RETURNING * AS payment

    INSERT INTO audit_logs (action, entity_type, entity_id, after)
    VALUES ('prepaid_package_created', 'prepaid_package', package.id, row_to_json(package))

    INSERT INTO audit_logs (action, entity_type, entity_id, after)
    VALUES ('payment_created', 'payment', payment.id, row_to_json(payment))
  COMMIT
```

### 5.5 Bulk Price Update

Bu akış v1'de **yoktur**. Brüt fiyat artık `lesson_types.default_price` üzerinden gelir (§2.3); öğrenci başına default fiyat mevcut olmadığı için "bu öğrencinin scheduled derslerini yeni fiyata çek" kavramı anlamsızdır. Bir ders türünün fiyatı değişirse yeni `createLesson` çağrıları yeni değeri kullanır, mevcut snapshot'lar olduğu gibi kalır.

> `audit_logs.action` CHECK listesinde `bulk_price_update` değeri tarihsel tamlık için tutulmaktadır; ama servis katmanında bu action'ı yazan bir akış yoktur.

### 5.6 Payment Silme

```
delete_payment(p_payment_id):
  BEGIN TRANSACTION
    payment = SELECT * FROM payments WHERE id = p_payment_id FOR UPDATE
    IF payment IS NULL:
      RAISE PaymentNotFoundError
    IF payment.deleted_at IS NOT NULL:
      RAISE PaymentNotFoundError "Already deleted"

    -- Invariant koruması (§2.4, §2.9): paket'e bağlı payment tek başına silinemez
    IF payment.prepaid_package_id IS NOT NULL:
      RAISE PackagePaymentDeleteForbiddenError
        "Cannot delete payment bound to prepaid_package. Use delete_prepaid_package() flow instead."

    before = row_to_json(payment)

    UPDATE payments SET deleted_at = now() WHERE id = p_payment_id

    INSERT INTO audit_logs (action, entity_type, entity_id, before)
    VALUES ('payment_deleted', 'payment', p_payment_id, before)
  COMMIT
```

**V1 sadeleştirmesi:** Payment silindiğinde "bağlı ledger entry'sini de soft-delete et" adımı v1'de yoktur — çünkü ledger kavramı (balance transactions) yoktur. Payment soft-delete edilince lesson/product_sale'in kalan borcu doğal olarak yeniden hesaplanır (view'lar payment'ı `deleted_at IS NULL` filtresi ile hariç tutar).

### 5.6b Prepaid Package Silme (özel akış)

**Bu akış istisna düzeltme akışıdır.** Hatalı girilmiş paketi düzeltmek, test/temizlik senaryoları veya özel müşteri durumlarında kullanılır. Günlük iş akışında paket "silinmez".

```
delete_prepaid_package(p_package_id):
  BEGIN TRANSACTION
    package = SELECT * FROM prepaid_packages WHERE id = p_package_id FOR UPDATE
    IF package IS NULL OR package.deleted_at IS NOT NULL:
      RAISE "Package not found or already deleted"

    used_lessons = SELECT * FROM lessons
      WHERE prepaid_package_id = p_package_id
        AND status = 'completed'
        AND deleted_at IS NULL
      FOR UPDATE

    IF used_lessons NOT EMPTY:
      RAISE PackageHasUsedCreditsError
        "Package has used credits. Soft-delete affected lessons first."

    pkg_payment = SELECT * FROM payments
      WHERE prepaid_package_id = p_package_id AND deleted_at IS NULL
      FOR UPDATE

    before_pkg = row_to_json(package)
    before_pay = row_to_json(pkg_payment)

    UPDATE prepaid_packages SET deleted_at = now() WHERE id = p_package_id
    UPDATE payments SET deleted_at = now() WHERE id = pkg_payment.id

    INSERT INTO audit_logs (action, entity_type, entity_id, before)
    VALUES ('prepaid_package_deleted', 'prepaid_package', p_package_id, before_pkg)

    INSERT INTO audit_logs (action, entity_type, entity_id, before, note)
    VALUES ('payment_deleted', 'payment', pkg_payment.id, before_pay,
            'Deleted atomically with package #' || p_package_id)
  COMMIT
```

### 5.7 Lesson Status Değişimi — Yasak Geçişler

**V1 kuralı (§2.2):** `completed → cancelled` ve `completed → no_show` **istisnasız yasak**.

```
change_lesson_status(p_lesson_id, p_new_status):
  ASSERT p_new_status IN ('scheduled', 'completed', 'cancelled', 'no_show')

  BEGIN TRANSACTION
    lesson = SELECT * FROM lessons WHERE id = p_lesson_id FOR UPDATE
    IF lesson IS NULL OR lesson.deleted_at IS NOT NULL:
      RAISE "Lesson not found"

    old_status = lesson.status

    IF old_status = 'completed' AND p_new_status IN ('cancelled', 'no_show', 'scheduled'):
      RAISE InvalidStatusTransitionError
        "Completed lessons cannot be reverted. Delete payments and the lesson, then recreate."

    IF old_status <> 'completed' AND p_new_status = 'completed':
      -- Direkt buraya düşmemeli; caller complete_lesson kullanmalı
      RAISE "Use complete_lesson() for transition to completed"

    before = row_to_json(lesson)
    UPDATE lessons
      SET status = p_new_status
      WHERE id = p_lesson_id
    after = SELECT row_to_json(l) FROM lessons l WHERE id = p_lesson_id

    INSERT INTO audit_logs (action, entity_type, entity_id, before, after)
    VALUES ('lesson_status_change', 'lesson', p_lesson_id, before, after)
  COMMIT
```

### 5.7b Lesson Uncomplete (v1.4)

**Ref:** §2.2. Endpoint: `POST /lessons/:id/uncomplete`. Bilinçli olarak dar bir geri-alma penceresi: yalnızca son 24 saat içinde tamamlanmış, hiç ödemesi olmayan dersler. Eski/ödemeli dersler için klasik düzeltme akışı (payment soft-delete + lesson soft-delete + yeniden oluştur) geçerlidir.

```
uncomplete_lesson(p_lesson_id, p_actor_user_id):
  BEGIN TRANSACTION
    lesson = SELECT * FROM lessons WHERE id = p_lesson_id FOR UPDATE
    IF lesson IS NULL OR lesson.deleted_at IS NOT NULL:
      RAISE LessonNotFoundError
    IF lesson.status <> 'completed':
      RAISE InvalidStatusTransitionError "Sadece 'tamamlandı' dersler geri alınabilir."
    IF lesson.completed_at IS NULL OR lesson.completed_at < now() - interval '24 hours':
      RAISE InvalidStatusTransitionError "24 saatten eski tamamlamalar geri alınamaz; ödemeyi silip dersi yeniden oluşturun."

    -- Aktif ödeme varsa reddet
    IF EXISTS (SELECT 1 FROM payments WHERE lesson_id = p_lesson_id AND deleted_at IS NULL):
      RAISE InvalidStatusTransitionError "Dersin aktif ödemeleri var; önce ödemeleri silin."

    -- v1.6: ürün satışı bağlı kontrolü kaldırıldı (lesson_id artık doldurulmuyor;
    -- mevcut bağlar 0233 ile temizlendi).

    before = row_to_json(lesson)

    UPDATE lessons
      SET status             = 'scheduled',
          completed_at       = NULL,
          prepaid_package_id = NULL
      WHERE id = p_lesson_id

    after = SELECT row_to_json(l) FROM lessons l WHERE id = p_lesson_id

    INSERT INTO audit_logs (action, entity_type, entity_id, before, after, note, actor_user_id)
    VALUES ('lesson_uncompleted', 'lesson', p_lesson_id, before, after, 'Ders geri alındı', p_actor_user_id)
  COMMIT
```

**Etkiler:**
- Kredi-karşılanmış ders ise `prepaid_package_id` NULL'a çekilir → paket kredisi otomatik geri yüklenir (`v_prepaid_package_status.remaining_credits` türev hesabı). `discount_amount` zaten 0'dı (paket dersinde indirim yasak); değişmez.
- v1.6: Ürün satışları artık derse bağlı değil; uncomplete satış lifecycle'ını etkilemez (eski "bağlı satış soft-delete" davranışı kaldırıldı).
- `price_snapshot` korunur (§2.3 — completed olsa olmasa snapshot dokunulmazdır; uncomplete sonrası ders aynı fiyatla scheduled'a döner).

**Audit:** `lesson_uncompleted` action (migration 0225 ile CHECK listesine eklendi). `before/after` tüm satırı içerir (paket bağı kopuşu izlenebilir).

### 5.8 Ders İndirimi (Set Lesson Discount)

**Ref:** §2.12. Endpoint: `PATCH /lessons/:id/discount` (§10). Idempotent set — verilen değer `discount_amount` üzerine yazılır. 0 indirimi kaldırır. Sadece completed & non-prepaid derse uygulanabilir.

```
set_lesson_discount(p_lesson_id, p_new_discount, p_note?):
  ASSERT p_new_discount >= 0

  BEGIN TRANSACTION
    lesson = SELECT *,
      COALESCE(
        (SELECT SUM(amount) FROM payments
          WHERE lesson_id = l.id AND deleted_at IS NULL), 0
      ) AS paid_amount
      FROM lessons l WHERE id = p_lesson_id FOR UPDATE

    IF lesson IS NULL OR lesson.deleted_at IS NOT NULL:
      RAISE LessonNotFoundError
    IF lesson.status <> 'completed':
      RAISE DiscountNotAllowedError
        "Discount can only be applied to completed lessons."
    IF lesson.prepaid_package_id IS NOT NULL:
      RAISE DiscountNotAllowedError
        "Discount cannot be applied to a lesson covered by a prepaid package."

    -- §2.12 discount validation
    IF p_new_discount > lesson.price_snapshot:
      RAISE ValidationError
        "discountAmount cannot exceed the lesson price_snapshot."
    IF lesson.paid_amount > lesson.price_snapshot - p_new_discount:
      RAISE DiscountWouldExceedNetError
        "Applying this discount would leave the paid amount above the net due."

    -- No-op kestirmesi: aynı değer gönderilirse audit yazmayız
    IF lesson.discount_amount = p_new_discount:
      COMMIT; RETURN lesson

    before = { discount_amount: lesson.discount_amount }
    UPDATE lessons SET discount_amount = p_new_discount WHERE id = p_lesson_id
    after  = { discount_amount: p_new_discount }

    INSERT INTO audit_logs (action, entity_type, entity_id, before, after, note)
    VALUES ('lesson_discount_updated', 'lesson', p_lesson_id, before, after, p_note)
  COMMIT
```

**Güvenlik katmanları (defense in depth):**
1. Servis validation (yukarıdaki akış) — net / paid / status / prepaid kurallarını enforce eder.
2. DB-level CHECK constraint'ler (§3.3):
   - `chk_lessons_discount_nonneg` (discount ≥ 0)
   - `chk_lessons_discount_le_price` (discount ≤ price_snapshot)
   - `chk_lessons_prepaid_no_discount` (paket dersinde discount = 0)
3. Frontend validation (§8.2) — aynı kuralları form submit öncesi kontrol eder.

### 5.9 Auth: Password ile login (v1.3 → v1.4 kod realitesi)

```
login_with_password(p_username, p_password):
  IF NOT (typeof p_password === 'string' AND length(p_password) >= 6):
    RETURN null   -- "kullanıcı adı veya şifre hatalı" generic mesajı

  user = SELECT id, password_hash FROM users
    WHERE username = p_username
      AND is_active = true

  hash = user?.password_hash ?? DUMMY_HASH  -- timing attack koruması
  ok   = bcrypt.compare(p_password, hash)
  IF NOT user OR NOT ok:
    RETURN null

  token = crypto.randomBytes(32).toString('hex')
  INSERT INTO sessions (user_id, token, expires_at)
  VALUES (user.id, token, now() + interval '30 days')

  RETURN token
```

**Cookie set:** HTTP route `Set-Cookie: session=<token>; HttpOnly; Secure(prod); SameSite=None(prod) | Lax(dev); Max-Age=2592000; Path=/`. Cross-origin (Vercel + Railway) deploy'da SameSite=None zorunlu.

**v1.3 sapması:** Spec v1.3 login sırasında `audit_logs`'a `user_login` satırı yazıyordu. v1.4'te yazılmaz (§2.14). User-agent/IP de kayda alınmaz (sessions tablosunda kolon yok).

### 5.10 Auth: Logout

```
logout(p_token):
  DELETE FROM sessions WHERE token = p_token
```

Tek session silme. **`user_logout` audit yazılmaz** (v1.4, §2.14). Cookie route handler tarafından `res.clearCookie('session')` ile temizlenir.

**`logout_everywhere` v1.4 dışı:** Tüm cihazlardan çıkış endpoint'i v1 kapsamında değil (§9). Bir admin'in tüm session'larını silmek gerekirse sysadmin DB'den `DELETE FROM sessions WHERE user_id = ?` çalıştırır.

### 5.11 Auth: Password değişimi

**v1.4 dışı (§9).** Settings → Hesap UI bölümü v1 kapsamına alınmadı; `PATCH /auth/password` endpoint'i de yok. Şifre değişimi gerekirse sysadmin DB'den manuel UPDATE yapar:

```
node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 12))" '<yeni-sifre>'
-- çıktıyı al, sonra:
UPDATE users SET password_hash = '<bcrypt-hash>' WHERE username = '<username>';
DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = '<username>');
```

Bcrypt cost 12, min 6 char invariant'ı şu an yalnızca bootstrap script ve `auth.service.ts` `login` validation'ında zorlanır; manuel UPDATE'te operatörün dikkatli olması gerekir.

### 5.12 RequireAuth middleware (v1.4 kod realitesi)

```
requireAuth(req, res, next):
  token = parse cookie 'session' from req.headers.cookie
  IF token IS NULL:
    RETURN 401 { error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } }

  user = SELECT u.id, u.username, u.display_name
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = token
      AND s.expires_at > now()
      AND u.is_active = true

  IF user IS NULL:
    RETURN 401 { error: { code: 'UNAUTHORIZED', message: 'Session expired or invalid.' } }

  -- Sliding window. AWAIT edilir (request-level update eşzamanlı tamamlanır)
  -- ama fail silently — DB hatası session'ı invalidate etmez. Caller bir
  -- sonraki SELECT'te güncel expires_at'ı görmek istiyorsa bu await zorunlu;
  -- önceki "fire-and-forget" davranış smoke test'inde sliding doğrulamasını
  -- bozuyordu (§11 "Smoke test bulguları" notu).
  await UPDATE sessions
    SET last_seen_at = now(),
        expires_at   = now() + interval '30 days'
    WHERE token = token
  -- .catch ile yutulur

  req.currentUser = { id, username, displayName }
  next()
```

**v1.3 sapmaları:**
- v1.3 spec'i `req.user = { id, username, full_name }` öneriyordu; v1.4 kodu `req.currentUser = { id, username, displayName }` (camelCase + display_name kolonu).
- v1.3 spec'i 401 verirken `res.clearCookie('session')` öneriyordu; v1.4 sadece 401 döner — frontend `auth:unauthorized` event'i ile login ekranına yönlendirir, ölü cookie bir sonraki login'de üzerine yazılır.
- v1.4 sliding update **await** edilir (önceki implementasyon fire-and-forget'di → sonraki SELECT eski `expires_at`'ı görüyordu). Latency etkisi tek `UPDATE ... WHERE token` sorgusu mertebesinde; hata `.catch` ile yutulur, oturum invalidate olmaz.

**`actor_user_id` enjeksiyonu:** Mevcut mutating *iş servisleri* (`createLesson`, `completeLesson`, `uncompleteLesson`, `setLessonDiscount`, `createCashPayment`, `createPrepaidPackage`, `createProductSale`, `updateSettings`, `createLessonType`, `updateLessonType`, ...) `actorUserId` parametresi alır; route handler `req.currentUser.id`'yi servise geçirir; servis `insertAuditLog` çağrısında bu değeri `audit_logs.actor_user_id`'ye yazar. Auth event'leri (login/logout) audit'a yazılmaz (§2.14).

---

## 6. Edge Case'ler ve Karar Özetleri

| Durum | Karar |
|---|---|
| Scheduled lesson'ı kredi ile rezerve etmek | **Yasak.** Kredi tahsisi sadece completed anında. |
| Kredi ile completed lesson + ek manuel ödeme | **Yasak.** Kredi ile karşılanan ders "kapalı" sayılır. |
| Ücretsiz ders / öğrenciye özel iskontolu ders | **İndirim ile modellenir.** Brüt fiyat her zaman `lesson_type.default_price` üzerinden gelir; öğrenciye özel koşullar `discount_amount` akışıyla uygulanır (ör. `price_snapshot = 900`, `discount_amount = 900` → `net_amount = 0`, ücretsiz ders). Tam ücretsiz bir ders türü istenirse `lesson_type.default_price = 0` da yeterlidir; bu durumda `discount = 0` kalır ve payment kaydedilmez. |
| Scheduled derse indirim uygulama | **Yasak (§2.12).** `DiscountNotAllowedError`. İndirim sadece completed + non-prepaid dersler için geçerlidir. |
| Paket (kredi ile kapalı) derse indirim uygulama | **Yasak.** Servis `DiscountNotAllowedError`; DB CHECK (`chk_lessons_prepaid_no_discount`) savunma. |
| `discount_amount > price_snapshot` | **Yasak (§2.12).** Servis ValidationError; DB CHECK (`chk_lessons_discount_le_price`) savunma. |
| Ödeme sonrası indirim net tutarı ödemenin altına çeker | **Yasak (§2.12).** `DiscountWouldExceedNetError`. Önce ödemeler azaltılmalı. |
| İndirim sıfıra çekme | **İzinli.** `discountAmount=0` gönderilmesi indirimi kaldırır; audit'a `before/after` ile düşer. |
| Fazla ödeme (lesson/product_sale) | **Yasak (§2.6).** `OverpaymentNotAllowedError` fırlatılır. Payment kaydedilmez. Net hesabı: `net = price_snapshot - discount_amount`; ödeme bu tutarı aşamaz. |
| Overpayment on prepaid_package | **Yasak.** Paket `total_amount` ne ise o ödenir (§2.4, chk_prepaid_total_equals_credits_times_unit). |
| Kısmi ödeme | **İzinli.** `0 < amount < remaining_debt` kabul edilir. Kalan borç azalır. |
| cancelled/no_show lesson'a payment | **Yasak.** Sadece completed. |
| scheduled lesson'a payment | **Yasak.** Ön ödeme için prepaid_package. |
| Completed → cancelled/no_show | **İstisnasız yasak.** Düzeltme için §5.6 + soft-delete + yeniden oluşturma. |
| Completed → scheduled (uncomplete) | **Kısıtlı izin (v1.4, §5.7b).** Yalnızca son 24 saat içinde tamamlanmış + ödemesi olmayan + bağlı satışında ödeme bulunmayan dersler. Eski/ödemeli kayıtlar için klasik soft-delete + yeniden oluştur. |
| Aynı anda iki completion (aynı öğrenci, son 1 kredi) | Advisory xact lock (`student_prepaid_<id>`) ile serileştirilir; sadece biri paketten düşebilir. |
| Geçmiş tarihli lesson/payment | **Serbest.** `event_date < created_at` izinli. |
| Öğrenci soft delete edildiğinde bağlı kayıtlar | RESTRICT sayesinde FK ihlali. Önce bağlı kayıtlar soft delete edilmeli. |

---

## 7. Test Senaryoları

### 7.1 Temel Lesson Akışı
1. `lesson_types.default_price = 500` olduğu doğrulanır (veya test başında sabitle)
2. Öğrenci oluştur (fiyat bilgisi gönderilmez)
3. Scheduled lesson oluştur → `price_snapshot = 500` (lesson_type.default_price'tan kopyalandı)
4. Status `completed` yap → `completed_at` set oldu mu?
5. Payment cash 500 → lesson kapandı, receivable 0

### 7.2 Fazla Ödeme Reddi
1. Öğrenci + 500 TL'lik completed lesson
2. Payment cash 600 → **`OverpaymentNotAllowedError` beklenir**, payment kaydedilmez
3. Lesson remaining = 500 (değişmedi), receivable hâlâ 500

### 7.3 Kısmi Ödeme
1. Öğrenci + 500 TL'lik completed lesson
2. Payment cash 200 → kabul, kalan borç 300
3. Payment cash 300 → kabul, kalan borç 0
4. Payment cash 1 (over) → **red**, borç hâlâ 0

### 7.4 Prepaid Package Akışı
1. Paket oluştur (8 kredi × 500 = 4000), source cash
2. Payment otomatik insert edildi mi? → audit_logs'ta hem package hem payment
3. Tahsilat haftasında 4000 görünüyor
4. O hafta ciro = 0 (henüz lesson completed olmadı)
5. Aynı hafta 1 lesson completed → FIFO ile bu paketten düşüldü mü?
6. `lesson.price_snapshot = 500` (paketin `unit_price`'ı)
7. Ciro haftasında 500 eklendi
8. `v_prepaid_package_status.remaining_credits = 7`

### 7.5 Geçmiş Tarihli Giriş
1. `paid_at = 30 gün önce`, `created_at = bugün`
2. Tahsilat sorgusu 30 gün önceki haftayı gösterir
3. Bugünkü hafta tahsilatına DAHİL DEĞİL

### 7.6 Ders Türü Fiyat Değişimi
1. `lesson_types.default_price = 500` ile scheduled lesson oluşturuldu → `price_snapshot = 500`
2. `lesson_types.default_price` 600'e çıkarıldı (doğrudan UPDATE)
3. Mevcut scheduled lesson.price_snapshot hâlâ 500 (otomatik güncellenmez)
4. Mevcut completed lesson.price_snapshot hâlâ 500 (hiçbir koşulda değişmez)
5. Yeni createLesson → `price_snapshot = 600` (yeni değer)
6. v1'de scheduled dersleri toplu olarak yeni fiyata çeken bir akış **yok**; mevcut snapshot'lar korunur.

### 7.7 Silme Senaryoları
1. Payment silindi → ilgili lesson/product_sale'ın `remaining` tekrar doğru (view'lar `deleted_at IS NULL` filtresi ile)
2. Prepaid package payment'ı tek başına silinmeye çalışıldı → **`PackagePaymentDeleteForbiddenError`**
3. Prepaid package silme (henüz kredi kullanılmamış) → paket + payment atomik soft-delete
4. Prepaid package silme (kredi kullanılmış) → **`PackageHasUsedCreditsError`**

### 7.8 KPI Doğruluğu
Hafta içinde:
- 1 completed lesson (500, fully paid cash 500)
- 1 product sale (300, fully paid iban 300)
- 1 completed lesson (500, paid cash 200 — kısmi)

Sonuçlar:
- Tahsilat = 1000 (500 + 300 + 200)
- Ciro = 800 (500 + 500 ders + 300 ürün **= 1300**; düzeltme: iki ders → 1000 ders + 300 ürün = 1300). *Not: test senaryosunda gerçek değerleri rakamla doğrulamak yeterlidir; formül her hafta deterministik.*
- Receivable = 300 (ikinci ders 200 ödenmiş, 300 açık)
- Student liability = **YOK (v1 kapsamında değil)**

### 7.9 Status Geçiş Yasakları
1. Completed + payment var → cancelled yapmayı dene → `InvalidStatusTransitionError`
2. Completed + kredi ile → no_show yapmayı dene → `InvalidStatusTransitionError`
3. Scheduled → completed: serbest, `completed_at` set edilmeli

### 7.10 Discount Akışı (§2.12, §5.8)
1. `lesson_types.default_price = 900` ile öğrenci + completed lesson (scheduled→completed); `price_snapshot = 900`
2. `setLessonDiscount(lessonId, 200)` → `discount_amount = 200`, `net_amount = 700`, `remaining_receivable = 700`
3. Payment cash 700 → kabul, remaining = 0
4. İkinci lesson: `discount = 200`, payment 701 → **`OVERPAYMENT_NOT_ALLOWED`** (net = 700)
5. Ücretsiz lesson `price_snapshot = 0` → `discount = 50` uygulama → **ValidationError** (`discount <= price`)
6. Scheduled lesson → discount uygula → **`DISCOUNT_NOT_ALLOWED`**
7. Paket (kredi) ile completed lesson → discount uygula → **`DISCOUNT_NOT_ALLOWED`**
8. Completed lesson + paid=800, discount=100 → kabul (net=800=paid, remaining=0); discount=200 → **`DISCOUNT_WOULD_EXCEED_NET`** (net=700 < paid=800); state 100'de kalır
9. `setLessonDiscount(lessonId, 150)` sonra `setLessonDiscount(lessonId, 0)` → iki ayrı `lesson_discount_updated` audit satırı; `before/after` sırasıyla `{0, 150}` ve `{150, 0}`
10. Haftalık KPI lesson_revenue sorgusu indirim öncesi vs sonrası farkını tam olarak `-discount_amount` kadar gösterir
11. Hareketler feed'inde indirim olayları "İndirim uygulandı / güncellendi / kaldırıldı" metinleriyle görünür; `old_discount` ve `new_discount` detayları mevcut

### 7.11 Multi-entity Seed & Defaults (§2.13)
1. Fresh DB migrate + bootstrap edildiğinde `instructors` tablosunda 1 aktif satır mevcut (`is_active = true`); ismi `BOOTSTRAP_INSTRUCTOR_NAME` ile eşleşir
2. `lesson_types` tablosunda `name = 'Yoga & Meditasyon'`, `default_duration_minutes = 60`, `is_active = true` seed satırı mevcut
3. Yeni `createLesson` çağrısı: `instructor_id`, `lesson_type_id`, `duration_minutes=60`, `discount_amount=0` otomatik doldurulmuş
4. Tüm aktif eğitmenler silinmiş/pasifleştirilmişse `createLesson` → **ValidationError** ("No active instructor or lesson type is configured")
5. `prepaid_packages.lesson_type_id` NULL → FIFO kredi tahsisi paket tipini filtrelemez (tüm completed dersler için geçerli)

---

## 8. UI Kontratı

### 8.1 Dashboard ana göstergeler

| Bileşen | Kaynak | Renk kodlaması |
|---|---|---|
| **Bu Hafta Tahsilat** | §4.1 | Mavi (cash inflow) |
| **Bu Hafta Ciro** | §4.2 | Yeşil (earned revenue) |
| **Bu Hafta Ders** (planlanan/tamamlanan) | §4.3 | Nötr |
| **Doluluk %** | §4.4 | Progress bar |
| **Bekleyen Tahsilat** (Receivable) | §4.5 | Turuncu (asset) |
| **Aktif Kredi Değeri** (Deferred) | §4.6 | Gri (deferred service) |

**İki finansal kavram birbirine karıştırılmaz.** UI'da açık, tam cümle etiketlerle ayrılır:

- **Alacaklarımız (Receivable):** "Öğrencilerin stüdyoya ödemesi gereken tutar"
- **Ödenmiş Kredi Değeri (Deferred):** "Öğrencilerin tükettikçe hak edilecek, ödenmiş paket değeri"

Kısa ve yanıltıcı olabilecek "Öğrenci Alacakları" gibi etiketler tek başına kullanılmaz — kimin kimden alacaklı olduğu her kutuda açık cümle ile yazılır.

### 8.2 Ödeme formu (UI)

Ödeme yöntemi seçici iki değer sunar: **Nakit**, **IBAN**. Başka seçenek (örn. "Mahsup") yer almaz.

Ödeme tutarı alanı kalan borçtan büyük girilirse form submit etmez; inline hata ile "Ödeme tutarı kalan borçtan ({fmtTL(remaining)}) fazla olamaz" mesajı gösterilir. Bu, backend'deki `OverpaymentNotAllowedError` ile aynı kuralın client-side yansımasıdır (defense in depth).

**İndirim uygula (§2.12):** Ödeme modalında bir ders kalemi seçildiğinde (ve ders completed & non-prepaid ise) inline bir "İndirim uygula" aksiyonu görünür. Aksiyon açıldığında:
- `discount_amount` için numara alanı (0 = indirim yok / indirimi kaldır)
- Opsiyonel not alanı
- Anlık net hesaplama önizlemesi: "İndirim sonrası net: {fmtTL(price_snapshot - discount)}"
- Client validation: `0 <= discount <= price_snapshot` ve `paid_amount <= price_snapshot - discount` — ihlal hâlinde submit kapalı, inline hata

Apply → `PATCH /lessons/:id/discount` çağırır, modalin lokal state'i yenilenir, net tutar ve kalan borç güncellenir. Ödeme akışı aynı modal içinde devam eder — discount uygulanması ayrı bir ekrana götürmez.

### 8.3 Öğrenci profil ekranı

- Finansal durum başlığı **net borç odaklı**: toplam borç varsa "X ₺ borçlu", yoksa "Güncel".
- Kırılım: `ders borcu + ürün borcu` (varsa).
- "Fazla ödeme / aktif bakiye / mahsup" gibi kavramlar UI'da yer almaz.
- Aktif paket kenar çubuğunda ayrı kart olarak gösterilir (yalnız varsa): kalan kredi sayısı + parasal değer + kullanım ilerlemesi.
- Hareketler akışı: "Tüm Hareketler / Dersler / Ürün Satışı" sekmeleri. "Bakiye hareketleri" sekmesi v1'de yoktur.
- **İndirim olayları** hareketler feed'inde ayrı satır olarak görünür (§2.12, §3.7):
  - İlk uygulama: "**İndirim uygulandı** · {fmtTL(new)}"
  - Güncelleme: "**İndirim güncellendi** · {fmtTL(old)} → {fmtTL(new)}"
  - Kaldırma: "**İndirim kaldırıldı** · eski indirim {fmtTL(old)}"
  - Olay metni **mutlak değer** bazlı; delta içermez (kararı operatör açıkça okuyabilsin diye).
- Tek bir dersin activity kartında brüt fiyat değişmeden görünür; indirim uygulanmışsa küçük bir "İndirim -{fmtTL(discount)}" rozeti eklenir ve kalan borç net üzerinden hesaplanır.

### 8.4 Haftalık takvim (Ana Sayfa)

Takvim, ana sayfada `WeekCalendar` bileşeni ile gösterilir. Ayrı bir "Program" sayfası v1.2 itibarıyla **kaldırılmıştır** (mock veri kullanan stub idi). Takvim haftalık grid gösterir; her hücre bir saat dilimi, ders blokları o slota yerleşir.

**Boş slota tıklama:** `CreateLessonModal` açılır, o saate yeni ders planlanabilir.

**Ders bloğuna tıklama (v1.2'de aktif):** `LessonModal` açılır. Modal, dersin durumuna göre üç farklı akış sunar:

| Ders durumu | Modal davranışı |
|---|---|
| **scheduled (planlı)** | Detay görünümü + "Tamamla" / "İptal" butonları. v1.6: Tamamla akışı tek tıkla biter — ürün satışı sorusu kaldırıldı; satış olacaksa operatör ürün satış modülünü açıp ayrı yapar. İptal akışı iki seçenek sunar: "Öğrenci iptal etti" → `changeLessonStatus(cancelled)`; "Yanlışlıkla eklendi" → `softDeleteLesson` (ders ve geçmişten kaldırılır). |
| **completed (paid / partial / unpaid)** | Detay görünümü yalnız ders ücreti `DebtCard`'ını gösterir. v1.6: Ürün satışları ders modal'ında listelenmez — operatör onları öğrenci profilinden ya da ürün satış modülünden takip eder. Ders kaleminde "Tahsil" butonu ile pay fazına geçilir; kalan tutar otomatik dolu gelir, operatör düzenleyebilir. Tamamı net üzerinden hesaplanır (§2.12). Discount inline aksiyonu sadece completed + non-prepaid + paket-dışı durumda görünür (§8.2). |
| **cancelled / no_show** | Modal açılır ama aksiyonu yoktur — sadece detay/durum gösterilir. |

**Bloğun görsel bilgisi:**
- `lessonState`: planned / unpaid / partial / paid / cancelled (CSS sınıfı + renk).
- Üst-sağ köşede `online` rozeti (mode) ve partial ise eksi-tutarlı kalan etiketi. v1.6: Ürün satışı sepet ikonu kaldırıldı; ders bloğu yalnız derse ait verilerle ilgilidir.
- Alt satırda öğrencinin nickname'i (varsa) yoksa full_name.

**Gün-grubu başlığı (örn. "09–12"):** daraltılmış band ise tıklamayla açılır/kapanır.

**Tasarım kararı:** v1'in önceki revizyonu takvim üzerinden etkileşimi yasaklıyordu. Pratikte operatörün her aksiyon için öğrenci profiline gidip ders araması verimsiz oldu — takvim halihazırda operasyonel görünümün merkezi. v1.2 etkileşimi tek bir modal arkasında topladı; servis-seviyesi kuralları (overpayment reddi, status geçiş yasakları, discount validation) modal içindeki aksiyonlar üzerinden de aynı şekilde işler — UI extra defense layer'dır, otorite servis katmanıdır.

### 8.5 Settings ekranı

[src/settings.jsx](src/settings.jsx) `studio_settings` tablosundaki kolonları yönetir:
- `weekly_capacity` — KPI doluluk hesabı (§4.4) bunu kullanır.
- `calendar_start_hour` / `calendar_end_hour` — `WeekCalendar`'ın `alwaysFrom`/`alwaysTo` propları.
- `default_lesson_mode` — `CreateLessonModal`'ın açılış varsayılanı.
- `payment_method_cash` / `payment_method_iban` — `LessonModal` ödeme akışındaki cash/iban butonları.
- `lesson_color_saturation` — takvim ders bloğu CSS doygunluk çarpanı.
- **Sabit gösterilenler (v1 spec kısıtlaması):** `timezone` (Europe/Istanbul), `default_currency` (TRY), `week_start` (monday). UI bunları "v1 sabit" rozetiyle gösterir; PATCH endpoint'i bu alanları kabul etmez.

**Görünür ama runtime'da tüketilmeyen:** `default_lesson_duration` alanı UI'da düzenlenebilir görünür ama ders süresinin tek kaynağı `lesson_types.default_duration_minutes`'tır (§3.1 "Tarihsel kalıntı" notu).

Ödeme akışı ile ilişkili bir ayar (örneğin "Mahsup etkin" toggle'ı) v1'de yoktur (§2.6).

**v1.4 — Hesap bölümü v1 kapsamı dışı (§9).** v1.3 spec'i Settings altında şifre değiştir + tüm cihazlardan çıkış öneriyordu; v1.4 bu UI bölümünü ve karşılığındaki `PATCH /auth/password` / `POST /auth/logout-everywhere` endpoint'lerini kapsam dışına çıkardı. Settings ekranı yalnızca "Genel" + "Aktivite" sekmeleri sunar.

**Face/Touch ID kullanımı:** iOS Safari ve macOS Safari/Chrome şifre kaydetme prompt'unu kendileri sunar; kullanıcı kabul ederse bir sonraki girişte Face/Touch ID ile şifreyi otomatik dolduruluyor. Uygulamanın bunun için ekstra bir akışı yok — login formu standart `<input type="password" autocomplete="current-password">` kullanır, gerisini OS halleder.

### 8.6 Login ekranı (v1.3)

`/auth/login` korumasız ana yol; uygulamanın geri kalanı 401 dönerse buraya redirect olur.

**Davranış:**
- Username + Password input'ları; submit → `POST /auth/login`. Başarılı → home'a redirect.
- HTML attribute'leri: username input `autocomplete="username"`, password input `autocomplete="current-password"`. Bu sayede iOS/macOS Keychain ve browser password manager'ları şifreyi kaydetme/doldurma prompt'unu doğru gösterir.
- Inline hata mesajları: yanlış kimlik → "Kullanıcı adı veya şifre hatalı" (username var/yok ayırt edilmez — enumeration koruması); rate limit → "Çok fazla başarısız deneme — 15 dk sonra tekrar dene".
- "Şifremi unuttum" linki **yoktur** (§9). 3 user için manuel reset; UI'da ipucu olarak küçük yazıyla "Şifrenizi unuttuysanız sistem yöneticisi ile iletişime geçin."
- Kayıt sayfası **yoktur** (§9).

**Mobil:**
- Login form mobile-first tasarlanır; username input'unda `autoCapitalize="none"`, `autoCorrect="off"`, `inputMode="text"` + autofill destekli.
- iOS Safari'de bir kez şifre kaydedildiğinde sonraki girişlerde Face ID/Touch ID prompt'u + autofill otomatik gelir. PWA "Ana ekrana ekle" durumunda da aynı autofill çalışır.

---

## 9. Yapılmayacaklar (V1 Dışı)

V1 kapsamı dışında kalan özellikler:

- **Multi-instructor CRUD UI'sı** — `instructors` tablosu ve seed mevcut, `InstructorsPage` v1.2'de read-only listedir. Yeni eğitmen ekleme / düzenleme / pasifleştirme ekranı yoktur; çoklu eğitmen senaryosu DB seed'iyle yapılır. Lesson type CRUD'u v1.2'de UI'da var (§2.13); eğitmen tarafı ileri revizyonun konusudur.
- **Rol bazlı yetkilendirme (RBAC)** — v1.3'te 3 admin user var (§2.14), tek seviye, hepsi her yere erişir. Scheduler/viewer gibi kısıtlı roller v1 kapsamı dışı. Gerekirse `users.role` kolonu + `requireRole(...)` middleware ile genişletilir.
- **Self-service password reset** — "şifremi unuttum" email akışı yoktur (§2.14). 3 user için sysadmin DB'den manuel reset eder. Email gönderimi altyapısı (SMTP, Resend, SendGrid vb.) v1 kapsamında değildir.
- **Hesap oluşturma / kayıt UI'sı** — yeni user bootstrap script + `.env` ile yaratılır. Self-signup endpoint yoktur; account provisioning operatöre bağlıdır.
- **Settings → Hesap UI bölümü** (v1.4'te kapsam dışı) — şifre değiştir + tüm cihazlardan çıkış UI'sı yok; karşılık gelen `PATCH /auth/password` ve `POST /auth/logout-everywhere` endpoint'leri de yok. Sysadmin DB'den manuel halleder (§5.11).
- **Auth audit logging** (v1.4'te kapsam dışı) — login/logout/password değişimi `audit_logs`'a yazılmaz; CHECK listesi `user_login`/`user_logout`/`password_changed` action'larını içermez (§2.14, §3.7). Mutating *iş* event'leri (lesson, payment, ...) audit'a düşmeye devam eder.
- **Login rate limit** (v1.4'te kapsam dışı) — `POST /auth/login`'da rate limit middleware'i yok. Kapalı admin sistemi için kabul edildi; ileride `express-rate-limit` ile eklenir (§2.14).
- **Session IP/UA kaydı** (v1.4'te kapsam dışı) — `sessions` tablosunda `user_agent`/`ip` kolonu yok (§3.13). Audit + rate limit gereksinimleri olmadığı için eklenmedi.
- **SSO / OAuth / sosyal login** — Google/Apple ile giriş v1 kapsamında değil.
- **WebAuthn / Passkey** — iOS Safari + macOS Keychain'in varsayılan şifre kaydetme + Face/Touch ID autofill akışı 3 admin için yeterli. Ekstra ceremony eklemek (yeni tablo + 4 endpoint + frontend SDK) marjinal kazanç olarak değerlendirildi. İleride dış kullanıcı / phishing endişesi artarsa eklenir.
- **MFA (şifre + TOTP / SMS)** — kapalı 3-admin sistemi için ek faktör gereği görülmedi. İhtiyaç doğarsa şifre login'i sonrası TOTP zorunlu hale getirilebilir.
- **KPI ve takvimde instructor / lesson_type segmentasyonu** — KPI sorguları tek aktif eğitmen + tip varsayımıyla yazılmıştır; "şu eğitmenin haftalık cirosu" gibi parça raporlar yoktur.
- **Öğrenci başına fiyatlandırma / fiyat motoru** — `student_class_rates` gibi tablolar bilinçli olarak eklenmemiştir. V1'de brüt ders fiyatı `lesson_types.default_price` üzerinden snapshot'lanır (§2.3); öğrenciye özel durumlar `discount_amount` ile modellenir. Mode bazlı (online/yüz yüze) fiyatlandırma da kapsam dışıdır.
- **Paketlerin ders tipine göre kısıtlanması** — `prepaid_packages.lesson_type_id` kolonu nullable olarak eklenmiştir ama FIFO kredi tahsisi v1'de bu kolonu filtrelemez (§3.5).
- **Lesson type değişiklikleri için audit log** — `lesson_types_*` action'ları yoktur (§2.13 sonu).
- Takvimde scheduled kredi rezervasyonu
- Kredi transferi (öğrenciden öğrenciye)
- Paket iptali / kredi iadesi (manuel süreç dışı)
- **Öğrenci bakiyesi / fazla ödeme / mahsup sistemi** (§2.6 sadeleştirmesi)
- **Nakit iade akışı** (iade sistem dışında, operatör elden verir)
- **Manuel bakiye düzeltme** (kavram yok)
- Multi-currency conversion
- Logging-only observation mode — v1 direkt canlı
- Ürün kalem bazlı satış (v1'de sadece toplam tutar; ürün satışı opsiyonel olarak bir derse bağlanabilir — §3.4 — ama kalem detayı tutulmaz)
- Abonelik / tekrarlayan ödeme
- **Takvim bloğu üzerinde drag&drop / yeniden zamanlama** — bloklar tıklanabilir (§8.4) ama saat değiştirme / başka güne taşıma akışı yoktur. Eski "Program" sayfası (drag&drop'lu mock) v1.2'de kaldırıldı.
- **Kompliman ders kavramı** — "dersten para alınmıyor" durumu v1'de discount ile modellenir (örn. 900 TL ders + 900 TL indirim = net 0). Ayrı bir `is_complimentary` flag'i / waiver modeli v1'de yoktur.

---

## 10. İmplementasyon Talimatları

1. **Migration'lar numaralı dosyalara ayrılır.** Her tablo bir dosya: `0001_studio_settings.sql`, `0002_students.sql`, ...
2. **Her DDL dosyasının üst kısmına** ilgili spec bölüm numarası yorum olarak eklenir (örn. `-- Ref: §3.3 lessons`).
3. **View'lar ayrı migration'da** (`0100_views.sql`), tablolardan sonra.
4. **Seed ayrı dosyada** (`0200_seed.sql`): sadece `studio_settings` (id=1) insert.
5. **Schema değişiklikleri** yeni numaralı migration'larla yapılır; eski migration'lar in-place düzenlenmez. `0201+` sayılı dosyalar bu prensibi takip eder.
6. **Servis katmanı Node.js/TypeScript ile** yazılır (mevcut stack uyumu). Her akış kendi fonksiyonunda, transaction'lar explicit.
7. **Advisory lock key'leri** sabit prefix + `hashtext()`:
   - `student_prepaid_<id>` → kredi tahsisi / paketten düşme (§5.2)
   
   V1'de başka bir advisory lock kullanımı yoktur.
8. **Hata sınıfları** (servis katmanı bunları fırlatır, HTTP katmanı uygun status code'a çevirir — 4xx iş kuralı ihlali, 404 not found):
   - `OverpaymentNotAllowedError` — payment > remaining_debt (§2.6)
   - `OverpaymentOnPrepaidPackageError` — paket `total_amount`'tan sapma denemesi (constraint kaynaklı)
   - `InvalidStatusTransitionError` — yasak status geçişleri
   - `PaymentTargetMismatchError` — hedef uygun değil (scheduled lesson'a payment, kredi ile karşılanmış lesson'a payment)
   - `PackagePaymentDeleteForbiddenError` — paket'e bağlı payment tek başına silinmeye çalışıldı (§5.6)
   - `PackageHasUsedCreditsError` — tüketilmiş kredisi olan paket silinmeye çalışıldı (§5.6b)
   - `DiscountNotAllowedError` — scheduled veya paket dersine discount uygulama denemesi (§2.12, §5.8)
   - `DiscountWouldExceedNetError` — discount uygulaması ödemeyi net tutarın üstüne çıkarırdı (§2.12, §5.8)
   - `CurrencyMismatchError` — currency uyuşmazlığı (trigger kaynaklı)
   - `StudentNotFoundError`, `LessonNotFoundError`, `ProductSaleNotFoundError`, `PrepaidPackageNotFoundError`, `PaymentNotFoundError` — not-found
   - **Auth (v1.3 → v1.4 kod realitesi):**
     - `UnauthorizedError` — geçersiz/expired session veya cookie yok (HTTP 401)
     - `InvalidCredentialsError` — yanlış username/şifre (HTTP 401, message generic — username enumeration koruması)
     - ~~`RateLimitError`~~ — v1.4'te kapsam dışı; rate limit middleware'i yok (§2.14, §9).
9. **API disiplini — endpoint listesi:**

   **Lessons:**
   - `GET /lessons?from=&to=` → `[from, to)` aralığındaki dersleri öğrenci adı + payment summary ile döner (takvim için). v1.6: Yanıttan `product_sales` alanı kaldırıldı — ders bloğu artık satış göstermiyor.
   - `POST /lessons` → `create_lesson()` (§5.1). Body: `{ studentId, startsAt, mode, note?, instructorId?, lessonTypeId? }`. instructor/lesson_type opsiyonel; gönderilmezse aktif tek seed otomatik atanır (§2.13). Aktif olmayan id gönderilirse `ValidationError`.
   - `GET /lessons/:id` → tek ders.
   - `POST /lessons/:id/complete` → `complete_lesson()` (§5.2). Body yok. Kredi tahsisi sadece bu yoldan yapılır. v1.6: Eski opsiyonel `productSale` alanı kaldırıldı; satış ürün satış modülünden ayrı yapılır.
   - `PATCH /lessons/:id/status` (generic) → yalnızca `{scheduled, cancelled, no_show}` hedeflerini kabul eder. `completed` reddedilir (409 `INVALID_STATUS_TRANSITION`). Generic update route kredi tahsisini bypass edemez.
   - `PATCH /lessons/:id/discount` → `set_lesson_discount()` (§5.8). Body: `{ discountAmount: number, note?: string }`. Idempotent set; 0 indirimi kaldırır.
   - `DELETE /lessons/:id` → soft delete. Aktif payment varsa `DELETE_CONFLICT` (409). v1.6: Bağlı satış kontrolü kaldırıldı (lesson_id artık doldurulmuyor).

   **Payments:**
   - `POST /payments/cash` → `create_cash_payment()` (§5.3). Body: `{ targetType: 'lesson'|'product_sale', targetId, amount, source, paidAt, note? }`. Paket hedefi reddedilir.
   - `GET /payments/:id`, `DELETE /payments/:id` → soft delete (§5.6); paket'e bağlı payment'ı tek başına silmek `PACKAGE_PAYMENT_DELETE_FORBIDDEN` ile reddedilir.

   **Packages:**
   - `POST /packages` → `create_prepaid_package()` (§5.4). Atomik paket + payment.
   - `GET /packages/:id`, `DELETE /packages/:id` → §5.6b özel akış.

   **Product sales:**
   - `POST /product-sales` → satış oluşturma (her satış lessonId NULL — v1.6). Body kalemli (items[]) veya legacy total amount (geriye dönük). Detay §3.4.
   - `GET /product-sales/:id`, `PATCH /product-sales/:id`, `DELETE /product-sales/:id`.

   **Students:**
   - `GET /students`, `GET /students/debtors`, `GET /students/:id`.
   - `POST /students`, `PATCH /students/:id`, `DELETE /students/:id` (soft, bağlı kayıt varken `DELETE_CONFLICT`).
   - `GET /students/:studentId/lessons`, `/packages`, `/product-sales`, `/movements`.
   - **Yasak alan:** `POST /students` ve `PATCH /students/:id` body'sinde `defaultLessonPrice` gelirse `ValidationError`. Sessizce yok sayılmaz; fiyat artık `lesson_types.default_price`'tan gelir.

   **KPI:**
   - `GET /kpi/weekly` → §4 hesaplamalarının tümü tek query.

   **Settings:**
   - `GET /settings`, `PATCH /settings` → §3.1 + §8.5.

   **Multi-entity yönetimi (v1.2):**
   - `GET /instructors` → aktif eğitmen listesi (CreateLessonModal için). v1.2'de CRUD endpoint yok — eğitmen yönetimi DB seed'iyle yapılır.
   - `GET /lesson-types` → tüm ders türleri (aktif + pasif).
   - `POST /lesson-types` → yeni tip oluşturma. Body: `{ name, default_duration_minutes (1–240), default_price (≥0) }`. Currency `TRY` zorla.
   - `PATCH /lesson-types/:id` → tip güncelleme. Body: yukarıdakiler + `is_active?`. `lesson_type_id` üzerindeki snapshot'lar değişmez (§2.3); değişiklik yalnızca yeni `createLesson` çağrılarını etkiler.

   **Lessons (v1.4 ek):**
   - `POST /lessons/:id/uncomplete` → `uncomplete_lesson()` (§5.7b). Body yok. 24 saat penceresi + ödemesiz olma + bağlı satış kontrolleri servis seviyesinde. Audit: `lesson_uncompleted`. Eski/ödemeli dersler için klasik soft-delete + yeniden oluştur akışı kullanılır.

   **Auth (v1.3 → v1.4 kod realitesi, §2.14, §5.9–§5.12):**
   - `POST /auth/login` → username + password ile login. Body: `{ username, password }`. Başarılı → `Set-Cookie: session=<token>` + `{ ok: true }`. Hata: 401 `INVALID_CREDENTIALS` (mesaj generic — username enumeration koruması). **Rate limit yok** (v1 dışı).
   - `POST /auth/logout` → mevcut session'ı sil (`DELETE FROM sessions WHERE token = ?`). Body yok. Cookie temizlenir. `{ ok: true }` döner.
   - `GET /auth/me` → mevcut user bilgisi (frontend hydration için). Yanıt: `{ data: { id, username, displayName } }`. 401 = login gerekli.
   - `POST /auth/logout-everywhere`, `PATCH /auth/password` — **v1.4 dışı** (§9). Tüm cihazlardan çıkış ve self-service şifre değişimi v1 kapsamında değil; sysadmin DB üzerinden halleder.

   **Korumalı endpoint disiplini (v1.3):** `/auth/*` ve `/health` dışındaki **tüm** endpoint'ler `requireAuth` middleware'inden geçer. Cookie yok / session ölü / user pasif → 401 `UNAUTHORIZED`. Servis katmanı `actorUserId` parametresi alır ve audit log'a yazar.

   **Lesson type yönetimi (v1.4 audit notu):** `POST /lesson-types` ve `PATCH /lesson-types/:id` artık `audit_logs`'a yazar (`lesson_type_created`, `lesson_type_updated`). `PATCH /settings` da `settings_updated` ile audit'a düşer.

10. **Testler** en azından §7'deki senaryolar için yazılır. Integration test tercih edilir (gerçek PostgreSQL'e karşı, transaction rollback ile temizlik). Trigger'lar için "DB-level invariant" testleri de yazılır: servis katmanı bypass edilip doğrudan SQL ile ihlal denemesi → trigger tarafından reddedilmeli.

11. **PII'siz bootstrap pattern (v1.3):** Repo public olduğu için **migration'lar PII içermez**. Tüm operasyonel veri (gerçek isimler, kullanıcı adları, şifreler) `.env` dosyasından okunur ve bootstrap script ile DB'ye yazılır. Üç katmanlı ayrım:

   **Migration'lar (git'te, public):** Sadece schema. `0210_instructors.sql` boş bir tablo yaratır; `0222_users_and_sessions.sql` boş `users` ve `sessions` yaratır. Hiçbir `INSERT` PII içermez. (`lesson_types` jenerik bir etiket "Yoga & Meditasyon" ile seed'lenir; bu PII sayılmaz.)

   **`.env.example` (git'te, public, placeholder, v1.4 kod realitesi):**
   ```
   DATABASE_URL=postgresql://...
   PORT=4000
   TZ=Europe/Istanbul
   NODE_ENV=development

   # Bootstrap — migration'dan SONRA bir kez çalıştırılır.
   # Bu satırlar PII'dir; bootstrap tamamlanınca ÖZGÜN .env'den silinmelidir.
   BOOTSTRAP_INSTRUCTOR_NAME=Instructor Name Here
   BOOTSTRAP_ADMINS=username1:password1,username2:password2,username3:password3
   # Format: username:password,...  (display_name = username; DB'den manuel düzeltilir)
   # Password min 6 char (bootstrap script ve auth servisinde zorlanır).
   ```

   **`.env` (gitignore'lu, sadece operatörün local'inde / production env'inde):** Gerçek değerler. Bootstrap tamamlanınca `BOOTSTRAP_*` satırları operatör tarafından **silinir**.

   **Bootstrap script (`backend/scripts/bootstrap.ts`, git'te, v1.4 kod realitesi):**
   - `BOOTSTRAP_INSTRUCTOR_NAME` → mevcut "Default Instructor" placeholder satırını gerçek isimle UPDATE eder. Migration 0210 tabloyu seed'siz açar; placeholder'ı 0210'dan sonraki başka bir geçiş veya elle ekleyebilir. (v1.4 kodu: `UPDATE instructors SET full_name = $1 WHERE full_name = 'Default Instructor'`.)
   - `BOOTSTRAP_ADMINS` → her satır için `bcrypt.hash(password, 12)` + `INSERT INTO users (username, display_name, password_hash) VALUES ($1, $1, $2) ON CONFLICT (username) DO NOTHING`. **Display name = username**; operatör DB'den daha sonra manuel `UPDATE users SET display_name = '...'` yapabilir. Idempotent: aynı username yeniden bootstrap'lanırsa skip.
   - Password length < 6 → bootstrap fail.
   - **Bcrypt hash repo'da hardcoded değildir**, runtime'da hesaplanır.

   **v1.3 sapması:** v1.3 spec'i `BOOTSTRAP_ADMINS` formatını `username:full_name:password` öneriyordu; v1.4 kodu `username:password` kullanır (display_name = username). İleride 3'lü format'a geçilirse migration'a gerek yok, sadece script güncellenir.

   **Setup akışı:**
   ```
   git clone ...
   cp .env.example .env  &&  edit .env
   npm install
   npm run migrate
   npm run bootstrap
   # bootstrap raporu → .env'den BOOTSTRAP_* satırlarını sil
   ```

   **Test/dev seed:** Test verisi de aynı pattern'i takip eder — `BOOTSTRAP_INSTRUCTOR_NAME=Test Instructor` ile lokal dev DB'si bootstrap'lanır; testler hardcoded isim assert etmez (assertion'lar id/şekil bazlı olur).

12. **README.md** setup adımları, migration çalıştırma, bootstrap, test komutları içerir. `.env` örneği placeholder olur, gerçek değerler dokümantasyonda yer almaz.

13. **`.env.example`** (git'te) yukarıdaki şablon. **`.env`** ve `*.env.local` `.gitignore`'a eklenir. Smoke test scriptleri ve seed komutları da `.env`'i okur — hardcoded PII assertion'ı içermez.

---

## 11. Spec ile kod tabanı arasındaki sürüm notları

### v1.5 (mevcut) — Mobile + PWA + public deploy sertleştirme

v1.5 revizyonu, v1.4'ün "ayrı sprint'e ertelenmiş" PWA artefaktlarını ve mobile-first kullanım için shell mimarisini v1 kapsamına aldı. Aynı revizyonda public deploy hazırlığı kapsamında CORS whitelist altyapısı ve login rate limit kapatıldı; deploy hedefi Vercel + Railway'den Cloudflare Pages + Railway'e döndü. Backend ve veri modeli tarafında değişiklik **yok**; tüm değişiklik frontend mimari ve operasyonel sertleştirme.

**Spec değişiklikleri (kod kapsama alındı):**

- **PWA altyapısı.** `vite-plugin-pwa` (autoUpdate + Workbox runtime caching) entegre edildi. Manifest: name "Okaliptus Yoga Studio", short_name "Okaliptus", `theme_color: '#f5efe6'` (krem), `display=standalone`, `orientation=portrait`, `lang=tr`. İkonlar: pwa-192/512/512-maskable + apple-touch-icon + favicon.svg ([public/](public/)). Workbox cache stratejisi: API → NetworkFirst (5 dk TTL, 100 entry, 5 sn timeout), static assets → CacheFirst. 401 davranışı: api-cache temizlenir + service worker → client `auth:unauthorized` mesajı yayar, frontend bu mesajla login'e redirect olur. v1.4 line 2095'in "kapsamı dışı" ifadesi v1.5 ile geçersizdir.

- **Mobile shell mimarisi.** Frontend artık iki shell ile geliyor: web (mevcut) ve mobile. [main.jsx](src/main.jsx) içinde `useIsMobile` hook'u viewport breakpoint'inde aktif shell'i seçer. MobileApp shell yapısı: sticky `MobileHeader` + scrollable `<main>` + fixed `BottomTabBar`. Quick-Add (`+`) FAB bottom tab merkezinde (henüz no-op stub — v1.6+'a ertelendi).

- **Mobile pages (v1.5 kapsamında tamamlanmış).**
  - `MobileHome` = `MobileGreetingHeader` + `MobileFinanceSummary` + `MobileAgenda` (önceki `MobileKpiSection` + `MobileWeekStrip` + `MobileDayLessons` + `MobileHeroLessonCard` kompozisyonu kaldırıldı; finans özet kartı ve "Bugün / Yarın / sıradaki ders" ajandası ile birleşik akışa geçildi)
  - `MobileCalendar` (haftalık görünüm) + `MobileLessonSheet` (lesson detay + complete / cancel / payment / product-sale edit-delete actions)
  - `MobileCreateLessonSheet` (yeni ders bottom sheet)
  - `MobileStudents` + `MobileStudentList` + `MobileStudentsKpi` + `MobileStudentsMenu` + `MobileCreateStudentPage`
  - Mobile-only stylesheet: [src/mobile/styles.css](src/mobile/styles.css) (~2550 satır)

- **Shared hooks/utils (frontend mimari).** [src/mobile/shared/](src/mobile/shared/) klasörü hem mobile hem web tarafından kullanılan hook ve util'leri içerir: `useLessonActions`, `useWeekLessons`, `useWeeklyKpi`, `useStudents`, `lessonMeta`, `studentMeta`. `useLessonActions` web'in `home.jsx`/`LessonModal`'ından extract edildi (modal yeniden kullanılabilirliği için). Klasör adı yanıltıcı (web de import ediyor) ama v1.5'te `mobile/shared/` altında bırakıldı; rename v1.6'da değerlendirilir.

- **Login iOS attrs.** [src/login.jsx](src/login.jsx) username input'una `autoCapitalize="none"`, `autoCorrect="off"`, `inputMode="text"` eklendi (§8.6 mobil davranışı tamamlandı). v1.4 hijyen TODO'su kapatıldı.

- **CORS whitelist altyapısı.** Backend artık `env.allowedOrigins` ile çalışır ([env.ts](backend/src/config/env.ts) + [app.ts](backend/src/server/app.ts)). Sadece whitelist'teki origin'lere `Access-Control-Allow-*` header'ları yansıtır; whitelist boşsa production'da hiçbir cross-origin istek geçmez (fail-secure). Dev'de fallback olarak `localhost:5173` + `127.0.0.1:5173` izinli. Operatör production'da `ALLOWED_ORIGINS=https://<domain>` env var'ını set etmelidir.

- **Login rate limit.** `POST /auth/login` artık `express-rate-limit` middleware'i ile korunuyor: 5 başarısız deneme / 15 dakika / IP başına. Başarılı login sayaçtan düşmez (`skipSuccessfulRequests: true`). v1.4 §2.14 / §9 / §10'daki "rate limit yok" ifadeleri v1.5 ile geçersizdir; mevcut hata kodu `RATE_LIMITED` (HTTP 429). Rate limiter store şu an in-memory (process-local); horizontal scale gerekirse Redis'e taşınır.

- **`studio_settings.default_lesson_duration` drop.** Migration `0228_drop_default_lesson_duration.sql` ile kolon DB'den kaldırıldı; v1.4 line 2084'teki "kalıntı kolon" hijyen notu v1.5 ile kapatıldı.

**Production deploy notları (Cloudflare Pages + Railway, v1.4 line 2089-2095'i süpersedes):**

- **Frontend:** Cloudflare Pages (free tier). Build: `npm run build`, output: `dist/`. SPA fallback için `public/_redirects` (`/*  /index.html  200`). Build env: `VITE_API_BASE_URL` (production API origin).
- **Backend + Postgres:** Railway (~$5/ay, Express + Postgres tek proje). Cookie cross-origin için aynı eTLD+1 önerilir: `<domain>` (Pages) + `api.<domain>` (Railway custom domain). `SameSite=none + Secure` ile çalışır.
- Deploy öncesi check: `ALLOWED_ORIGINS` set, `VITE_API_BASE_URL` set, `SameSite=none + Secure` doğrulandı, `npm run smoke:reset` yeşil, `/health` endpoint Railway probe'a bağlı.
- **Cloudflare Workers'a backend port v1.6+'a ertelendi:** Mevcut `pg@8.13.1` + Express `createServer().listen()` pattern'i Worker'a doğrudan oturmuyor. Workers'a geçiş için pg ≥ 8.16.3 + Hono refactor + Hyperdrive setup gerekir; ayda 5 dolar tasarruf bu lift'i bugün haklı çıkarmıyor.

**v1.6+'a bilinçli ertelenenler:**

- **Mobile Settings sayfası** ([MobileApp.jsx](src/mobile/MobileApp.jsx) içinde placeholder)
- **Mobile Student Profile detay sayfası** (MobileApp.jsx içinde placeholder)
- **Mobile Quick-Add (`+`) FAB** — bottom sheet modal stub, henüz no-op
- **`src/mobile/shared/` → `src/shared/` rename** — düşük öncelik, isim yanıltıcı ama low-impact
- **Spec §7 tam test matrisi** — mevcut backend smoke 17 senaryo + frontend Vitest 26 test §7'nin büyük çoğunluğunu kapsar; CRUD edge case matrisi v1.6'da
- **Cloudflare Workers backend port** (yukarıda gerekçesi)
- **KVKK aydınlatma metni + veri sahibi hakları endpoint'i** — gerçek müşteri öncesi blocker; demo / staj başvurusu öncesi gerekli değil
- **DB backup stratejisi** — Railway retention öğrenilmeli; yetmezse `pg_dump` → R2/S3 cron job
- **Frontend error tracking (Sentry vb.)** — public deploy ile birlikte v1.5 sonu / v1.6 başı eklenir; ücretsiz tier yeterli
- **Auth audit log + login event tracking** — v1.4 line 2055 hâlâ geçerli; eklenmesi düşük öncelik
- **GitHub Actions CI** (PR'larda smoke + Vitest) — depo profesyonelliği için iyi sinyal, deploy sonrası eklenir

**Test kapsamı durumu (dürüst tarif):**

v1 test stratejisi iki katmanlı: backend smoke suite (17 senaryo, servis-katmanı integration, [backend/scripts/smoke/](backend/scripts/smoke/)) + frontend Vitest (7 dosya, 26 test, [src/__tests__/](src/__tests__/)). Spec §7'nin temel akışlarını (lesson + payment + package + discount + multi-entity + uncomplete + auth + KPI E2E + DB invariants + audit + net-amount edge cases) karşılar. Tam test matrisi (her CRUD edge case, her hata yolu) v1.6'ya ertelendi; mevcut kapsam canlı kullanım için yeterli kabul edildi. `npm run smoke:reset` (backend, full clean) + `npm run test` (frontend) yeşilse v1 deploy-ready.

**Why (genel gerekçe):**

v1.5, v1.4'ün "ileride" diye işaretlediği iki sürüklenmeyi (PWA artefaktları + public deploy sertleştirme) tek revizyonda kapatıyor. Solo developer + henüz canlıya çıkmamış proje + dış görünürlük gereksinimi (staj başvurusu, GitHub repo) bağlamı: bir teknik incelemeci açtığında README + spec + canlı demo URL üçgeninin tutarlı olduğunu görmeli. Workers migrasyonu, KVKK metni ve §7 tam test matrisi gibi büyük lift'ler v1.6'ya bilinçli olarak ertelendi — kazanım/efor oranı şu an düşük.

### v1.4 (önceki) — kod realitesi ile spec'in hizalanması

v1.4, v1.3 spec'inde söz verilen ama implementasyonda *kasıtlı olarak* sadeleştirilen auth katmanını yazıya döktü. Solo developer + kapalı admin sistemi gerçeği üzerine over-engineering riskini azalttı; ileride gerekirse genişletilecek yüzeyleri açıkça v1 dışı işaretledi. Aynı revizyonda kod tabanında v1.3 sonrası eklenmiş `lesson_uncompleted` akışı, `lesson_types` ve `settings` audit kanalları da spec'e dahil edildi.

**Spec değişiklikleri (kod kapsama alındı):**
- `lesson_uncompleted` akışı (§2.2 + §5.7b yeni bölüm) — completed → scheduled için 24 saat penceresi, ödemesiz olma kontrolü, bağlı satışların temizliği, `prepaid_package_id` NULL'a çekme. `lesson_uncompleted` audit action'ı (migration 0225).
- `lesson_types` create/update artık audit'a yazılıyor (`lesson_type_created`, `lesson_type_updated`); v1.2'deki "sessizce yapılır" notu geçersiz.
- `studio_settings` PATCH'leri `settings_updated` audit action'ı ile düşüyor.
- Audit `entity_type` listesi `lesson_type` ve `settings` ile genişledi (migration 0225).

**Spec değişiklikleri (v1.3'ten v1 dışına çekildi):**
- **Auth audit logging.** Login/logout/password değişimi `audit_logs`'a yazılmaz. CHECK listesi `user_login`/`user_logout`/`password_changed` action'larını ve `entity_type='user'` değerini içermez. Mutating *iş* event'leri `actor_user_id` ile audit'a yazılmaya devam eder. Gerekçe: kapalı admin sistemi, blast radius küçük.
- **Login rate limit.** `POST /auth/login`'da rate limit yok. 3 admin için brute force riski düşük.
- **Self-service şifre değişimi.** `PATCH /auth/password` endpoint'i ve Settings → Hesap UI bölümü v1 kapsamına alınmadı. Sysadmin DB'den manuel halleder (bcrypt hash + UPDATE + DELETE FROM sessions).
- **Tüm cihazlardan çıkış.** `POST /auth/logout-everywhere` endpoint'i ve UI'sı v1 dışı.
- **`users.deleted_at` (soft delete).** Sadece `is_active = false` ile pasifleştirme. 3 admin için soft delete'in aktör atfı için katma değeri düşük.
- **Username CHECK constraint.** `users.username` plain `UNIQUE`; v1.3 spec'inin lower-case + `[a-z0-9_-]` + 3–32 char CHECK kuralı zorlanmıyor. Bootstrap operatörü makul username üretmekle sorumlu.
- **`sessions.user_agent` ve `sessions.ip` kolonları.** Rate limit + auth audit yok ise bu meta veri ölü kolonlardı; eklenmedi.
- **`RateLimitError` hata sınıfı.** Karşılığı yok.

**Spec değişiklikleri (kod realitesini yansıtmak için):**
- `users` tablosunda alan adı **`display_name`** (v1.3 spec'inde `full_name`). API çıkışı `displayName`. Bootstrap script display_name = username atar; sysadmin DB'den manuel yükseltebilir.
- `sessions` tablosu: `bigserial id` PK + ayrı `token text UNIQUE` kolonu (v1.3 spec'inde `id text PRIMARY KEY` opaque secret). JOIN'ler `id` üstünden, lookup `token` üstünden. Token şu an düz tutuluyor; ileride hash'lenebilir, cookie değişmez.
- Cookie `SameSite`: prod'da **`none`**, dev'de `lax` (cross-origin Vercel + Railway için zorunlu).
- Login min password length: **6 char** (v1.3 spec'inde §2.14 tablosu da 6 derken §5.9 pseudocode 8 diyordu; çelişki giderildi). Validation `auth.service.ts` ve bootstrap script'inde.
- Sliding window güncellemesi her korumalı request'te `last_seen_at` + `expires_at` ikisini de günceller (kod düzeltildi: önceden sadece `last_seen_at` güncelleniyordu).
- `requireAuth` invalid session'da 401 dönüyor; `res.clearCookie('session')` yapmıyor (frontend `auth:unauthorized` event'i ile yönlendirme yapar).
- `req.currentUser = { id, username, displayName }` (v1.3 spec'inde `req.user = { id, username, full_name }`).
- Bootstrap `BOOTSTRAP_ADMINS` formatı: `username:password,...` (v1.3 spec'inde `username:full_name:password`).

**Migration sırası farkı:**
- v1.3 spec'i tek `0223_audit_logs_actor_user_id.sql` öneriyordu (audit_logs.actor_user_id + 3 auth action + entity_type='user').
- v1.4 kodu üç ayrı migration kullandı:
  - `0223_audit_actor.sql` → `lessons.actor_user_id` + `payments.actor_user_id` ekledi (**ölü kolonlar** — kullanılmıyor; spec sapması)
  - `0224_audit_actor_user.sql` → `audit_logs.actor_user_id` + `idx_audit_logs_actor`
  - `0225_audit_extend_enums.sql` → `lesson_uncompleted` / `lesson_type_*` / `settings_updated` action'ları + `lesson_type` / `settings` entity_type'ları (auth action'ları ve entity_type='user' eklenmedi)

**Bilinçli kabul edilmiş hijyen borçları (v1.5+ TODO):**
- `lessons.actor_user_id` ve `payments.actor_user_id` ölü kolonları drop edilebilir (her zaman NULL, view'lar/sorgular kullanmıyor). Etkisi sadece disk/şema temizliği.
- `audit_logs.entity_type` CHECK listesinde `'balance_transaction'` kalıntısı (0203 ile içerik silinmiş ama listede duruyor). Yeni satır eklenemiyor; pratik etki yok.
- `studio_settings.default_lesson_duration` kalıntı kolonu (v1.2 notu — kullanılmıyor, settings UI'da görünüyor).
- Spec §7 test senaryoları henüz büyük ölçüde implement edilmedi; mevcut smoke test'ler 01/04/05/06/08/10. Auth happy/sad path testi yok. Bilinçli olarak v1.5+'a ertelendi.
- CORS whitelist altyapısı kodda hazır (`env.allowedOrigins`, [app.ts](backend/src/server/app.ts) gelen origin'i yalnızca whitelist'te varsa yansıtır). Production'da operatör `ALLOWED_ORIGINS=https://<domain>` env var'ını set etmek zorunda; aksi halde production'da hiçbir cross-origin istek geçmez (fail-secure). Dev'de fallback olarak `localhost:5173` + `127.0.0.1:5173` izinli.

**Production deploy notları (Vercel + Railway):**
- Frontend Vercel'de (Hobby plan teknik kapasite olarak yeterli; ToS "personal use" gri alanı için Pro yükseltmesi ileride değerlendirilebilir).
- Backend + PostgreSQL Railway'de.
- Cross-origin cookie için aynı eTLD+1 önerilir (`okaliptus.com` + `api.okaliptus.com`); değilse SameSite=None + Secure ile çalışır ama CSRF yüzeyi artar.
- `VITE_API_BASE_URL` env var Vercel build'inde set edilir; `api.js` `buildApiBaseUrls` fallback davranışı üretim için zaten doğru.
- `vercel.json` SPA rewrite + asset cache header'ları için eklenmeli (kapsam dışı, deploy hazırlığı).
- PWA artefaktları (manifest, service worker, apple-touch-icon, theme-color) v1.4 kapsamı dışı; ayrı sprint'te eklenecek (mobile + iOS PWA hedefi).

**Why (genel gerekçe):** Spec v1.3 auth tarafında "ideal" güvenlik modelini tarif ediyordu; v1.4 onu "yeterli + sade" modeline indirdi. Solo developer + kapalı admin sistemi + henüz canlıya çıkmamış proje → over-engineered güvenlik özellikleri taşımak hem geliştirme hızını hem yüzey alanını şişiriyordu. Auth event audit, rate limit, password change UI gibi her özellik *yokluğu kadar var olduğu güvenlikle de* ölçülmeli; bu sürümde kapsam, ileri revizyonda kanıtlanmış ihtiyaç sonrası genişler.

**Smoke test bulguları (v1.4 kod düzeltmeleri):** Smoke test paketi yazılırken iki gerçek bug yakalandı; spec ile kod arasındaki uyumsuzluk değil, kodun kendi içinde sessiz hatalardı. Her ikisi de canlıya çıkmadan önce kapatıldı.

1. **`validateSession` sliding update fire-and-forget'di.** [auth.service.ts](backend/src/services/auth.service.ts) içinde session lookup başarılı olduktan sonra `expires_at + last_seen_at` UPDATE'i `pool.query(...).catch(() => {})` olarak çağrılıyordu — Promise await edilmediği için caller bir sonraki SELECT'te eski `expires_at` değerini görüyordu. Spec §2.14 + §3.13 davranışı (sliding 30 gün) doğru tarif ediyordu, kod o davranışı bozuyordu. Düzeltme: tek karakter — `await pool.query(...).catch(...)`. `.catch` korunduğu için DB hatası hâlâ session'ı invalidate etmez; latency tek satır UPDATE mertebesinde. Doğrulama: smoke test 14-auth.ts B senaryosu (1 sn ardışık iki SELECT'te `expires_at` farkını ölçüyor).
2. **`completeLesson` return shape genişlemişti, eski caller'lar destructure etmiyordu.** v1.2'de opsiyonel `productSale` parametresi eklendiğinde dönüş `LessonRow`'dan `{ lesson, product_sale_id }`'e çıkmıştı (§5.2 pseudocode'unda zaten görünüyordu, ama call site'lar güncellenmemişti). Mevcut smoke test'leri 01/04/05/06/08/10 düz `LessonRow` varsayıp `done.status`, `done.prepaid_package_id` okuyordu → her seferinde `undefined` dönüyor, assertion fail oluyordu. Etkilenen 6 dosyada `const { lesson: done } = await completeLesson(...)` formatına geçildi; başka caller (HTTP route handler'ı) zaten yeni shape'i kullanıyordu, üretim akışı etkilenmedi. Doğrulama: 17/17 smoke yeşil.

### v1.3 (önceki)

v1.3 revizyonu auth katmanını v1 kapsamına aldı. v1.2'nin "v1'de tek kullanıcı varsayımı" kuralı kaldırıldı; artık 3 admin user, username + password ile login oluyor. WebAuthn/passkey kasıtlı olarak kapsam dışı bırakıldı (§9) — iOS/macOS Keychain'in varsayılan autofill akışı zaten Face/Touch ID UX'ini ücretsiz veriyor.

**Şema değişiklikleri:**
- `users` (§3.12), `sessions` (§3.13) tabloları (migration 0222).
- `audit_logs.actor_user_id` kolonu + 3 yeni auth action + `entity_type='user'` (migration 0223).

**Servis akışı eklemeleri:**
- `login_with_password` (§5.9), `logout` + `logout_everywhere` (§5.10), `change_password` (§5.11), `requireAuth` middleware (§5.12).
- Tüm mutating servisler `actor_user_id` parametresi alacak şekilde genişletilir; `insertAuditLog` helper'ı bu değeri taşır.

**Endpoint açılımları:**
- `/auth/login`, `/auth/logout`, `/auth/logout-everywhere`, `/auth/me`, `/auth/password` (§10).
- `requireAuth` middleware tüm korumalı route'ların önüne kondu. `/auth/*` ve `/health` muaf.

**UI eklemeleri:**
- `/auth/login` standalone login ekranı (§8.6) — username + password, autofill-friendly attribute'lerle. iOS/macOS Keychain Face/Touch ID + autofill'i kendisi halleder.
- Settings ekranında "Hesap" bölümü: şifre değiştir + tüm cihazlardan çıkış (§8.5).

**Yeni hata sınıfları:** `UnauthorizedError`, `InvalidCredentialsError`, `RateLimitError` (§10).

**v1 dışı bırakılanlar (§9 güncellendi):**
- Rol-bazlı yetkilendirme (3 admin, tek seviye).
- Self-service password reset email.
- Kayıt UI / SSO / OAuth / TOTP MFA.
- WebAuthn / Passkey — iOS Keychain autofill 3 admin için yeterli görüldü.

**Açıkça not edilen TODO:**
- 3 admin user bootstrap script (§10) ile `.env` dosyasından okunarak yaratılır. **Migration'larda PII bulunmaz.** Her user'ın başlangıç şifresi `.env`'deki değerden bcrypt(cost=12) ile hash'lenir; bootstrap tamamlandıktan sonra `.env` PII satırı operatör tarafından silinmelidir. Aile içi sistem; her user kendi Settings'inden şifresini değiştirir. Self-service şifre reset (forgotten password email) yok — sysadmin manuel reset yapar (`scripts/reset-password.ts <username>`).
- Rate limiter store v1'de in-memory (`express-rate-limit` default); horizontal scale gerekirse Redis'e taşınır.
- Email kolonu yok; password reset / notification gerekirse ileride nullable kolon olarak eklenir.

### v1.2 (önceki)

v1.2 revizyonu, spec'in v1.0 / v1.1 yazımı ile fiili kod arasındaki sapmaları kapadı. Kod tabanında zaten yapılmış olan ama spec'te dokümante edilmemiş kararlar açıkça yazıya döküldü; spec içindeki ölü maddeler temizlendi.

**Şema değişiklikleri:**
- `product_sales.lesson_id` (nullable) eklendi (migration 0221). NULL = standalone satış, NOT NULL = derse bağlı satış. `v_product_sale_balances` `lesson_id` kolonu içerecek şekilde yeniden yaratıldı (§3.4, §4.8).
- §3.9 migration listesi 0216 (nickname), 0217 (preferred_mode), 0218 (lesson_types pricing), 0219 (students drop default_lesson_price), 0220 (settings drop default_lesson_price), 0221 (product_sales.lesson_id) ile tamamlandı.

**Servis akışı değişiklikleri:**
- `complete_lesson` artık opsiyonel `productSale` parametresi alır; ders + (opsiyonel) ürün satışı + (opsiyonel) tam ödeme aynı transaction içinde atomik (§5.2).

**UI / endpoint açılımları:**
- Takvim blok etkileşimi spec'e eklendi (§8.4). Önceki "tıklanmaz" kuralı kaldırıldı; `LessonModal` planlı/tamamlanmış/iptal durumlarında farklı akışlar açar.
- `CreateLessonModal` instructor + lesson_type seçimi sunar; `POST /lessons` body'si `instructorId?` ve `lessonTypeId?` kabul eder (gönderilmezse aktif tek seed otomatik atanır) (§2.13).
- `LessonTypesPage` ders türü CRUD'unu UI'ya taşıdı; `GET/POST/PATCH /lesson-types` endpoint'leri §10'a eklendi.
- `InstructorsPage` read-only listeyi gösterir; `GET /instructors` endpoint'i §10'a eklendi.

**Kaldırılanlar:**
- `src/schedule.jsx` ve "Program" sayfası tamamen kaldırıldı. Mock veriyle çalışıyordu, ana sayfa takvimi (`WeekCalendar`) zaten gerçek API ile aynı işlevi sunuyordu. Settings UI'sındaki bağlantı, sidebar item'ı ve schedule-spesifik CSS de temizlendi.

**Açıkça not edilen (gelecek için TODO):**
- `studio_settings.default_lesson_duration` kolonu hâlâ DB'de ve settings UI'sında ama hiçbir yerde tüketilmiyor (§3.1). Bağlanacak ya da düşürülecek.
- `lesson_types` üzerindeki insert/update'ler `audit_logs`'a yazmıyor (§2.13 sonu, §9). Operasyonel ihtiyaç doğduğunda eklenebilir.
- `softDeleteProductSale` aktif payment kontrolü yapmıyor — soft delete sonrası payment view'larda gözükmez (§3.4 silme korumaları). Bu hafif tutarsızlık bilinçli kabul edildi.
- `chk_payments_prepaid_source` constraint'i v1'de işlevsizdir (§3.6). `errors.ts` mapping'i hâlâ adı referans ediyor; runtime etkisi yok.
- §7 test senaryoları henüz implement edilmedi.

### v1.1 (önceki)

- `student_balance_transactions` tablosu, `v_student_balances` view'ı ve tüm mahsup / fazla ödeme / liability akışları kaldırıldı (migration 0203).
- Payment source `'cash' | 'iban'`'a daraltıldı.
- Audit log action/entity listeleri balance satırları olmadan daraltıldı; `lesson_discount_updated` eklendi (migration 0214).
- Overpayment reddi fazla ödemenin tek davranışı olarak tanımlandı (§2.6); net tutar üzerinden hesaplanır.
- Multi-entity + discount altyapısı (migration 0210–0215):
  - `instructors` + `lesson_types` tabloları + kalıcı seed.
  - `lessons` tablosuna `instructor_id`, `lesson_type_id`, `duration_minutes`, `discount_amount` eklendi.
  - `prepaid_packages.lesson_type_id` nullable eklendi.
  - Net tutar üzerinden ciro/receivable/ödeme doğrulaması; `v_lesson_balances` `net_amount` kolonu.
  - `PATCH /lessons/:id/discount` endpoint'i + `DiscountNotAllowedError` / `DiscountWouldExceedNetError`.

---

Bir çelişki fark edilirse (örn. pseudocode ile §2 arasında), §2'deki iş kuralı kazanır.

**Hedef:** Tek seferde çalışan, test edilebilir, production-ready v1.
