function buildApiBaseUrls() {
  const configuredBaseUrl = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
  const candidates = [];

  if (configuredBaseUrl) {
    candidates.push(configuredBaseUrl);
    return candidates;
  }

  if (typeof window === "undefined") {
    candidates.push("");
    return candidates;
  }

  const { protocol, hostname, port } = window.location;
  const isHttpPage = protocol === "http:" || protocol === "https:";

  // Same-origin first — Vite proxy handles /kpi in dev, no extra request in prod
  if (isHttpPage) {
    candidates.push("");
  }

  if (hostname) {
    // Explicit IPv4 before hostname-based fallback: on Windows, Node.js 18+ resolves
    // "localhost" to ::1 (IPv6) which causes ECONNREFUSED when the server binds to
    // 0.0.0.0 (IPv4 only). Browser direct-fetches are unaffected by this but we keep
    // 127.0.0.1 first so the fallback order is consistent with the proxy fix.
    if (hostname !== "127.0.0.1") {
      candidates.push("http://127.0.0.1:4000");
    }

    if (port !== "4000" && isHttpPage) {
      candidates.push(`${protocol}//${hostname}:4000`);
    }

    if (hostname !== "localhost") {
      candidates.push("http://localhost:4000");
    }
  } else {
    candidates.push("http://127.0.0.1:4000");
    candidates.push("http://localhost:4000");
  }

  return [...new Set(candidates)];
}

function getErrorMessage(payload) {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "object" &&
    payload.error !== null &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }

  return "API istegi basarisiz oldu.";
}

async function apiRequest(path, options = {}) {
  const baseUrls = buildApiBaseUrls();
  let lastNetworkError = null;

  for (const baseUrl of baseUrls) {
    const url = `${baseUrl}${path}`;
    let response;
    try {
      response = await fetch(url, {
        method: options.method || "GET",
        credentials: "include",
        headers: {
          Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(options.headers || {}),
        },
        body: options.body,
      });
    } catch (error) {
      // Only network-level failures (ECONNREFUSED, CORS block, etc.) fall back
      // to the next baseUrl. HTTP error responses are handled below.
      if (error instanceof TypeError) {
        console.error(`[api] ${url} → network error:`, error.message);
      }
      lastNetworkError = error;
      continue;
    }

    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const msg = getErrorMessage(payload);
      console.error(`[api] ${url} → HTTP ${response.status}: ${msg}`);
      if (response.status === 401 && !path.startsWith('/auth')) {
        window.dispatchEvent(new CustomEvent('auth:unauthorized'));
      }
      // Hata nesnesine backend kodunu (örn. DELETE_CONFLICT) ve HTTP status'u
      // iliştir ki çağıran tarafta İngilizce mesaj yerine bağlama uygun
      // Türkçe metin gösterilebilsin.
      const err = new Error(msg);
      err.status = response.status;
      const code = payload?.error?.code;
      if (typeof code === 'string') err.code = code;
      throw err;
    }

    return payload;
  }

  const finalError = lastNetworkError instanceof Error
    ? lastNetworkError
    : new Error("API istegi basarisiz oldu.");
  console.error("[api] tum adaylar basarisiz oldu, son hata:", finalError.message);
  throw finalError;
}

async function apiGet(path) {
  return apiRequest(path);
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export async function login(username, password) {
  await apiRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  return getMe();
}

export async function logout() {
  return apiRequest('/auth/logout', { method: 'POST' });
}

export async function getMe() {
  const payload = await apiRequest('/auth/me');
  if (!payload?.data) throw new Error('Kullanıcı bilgisi alınamadı.');
  return payload.data;
}

// ─── Push (yalnız test kullanıcısı; diğer hesaplar 403 alır) ──────────────────

// 403 → kullanıcı yetkili değil; çağıran tarafta kart gizlenir.
export async function getPushConfig() {
  const payload = await apiRequest('/push/config');
  return payload?.data ?? null;
}

export async function subscribePush(subscription) {
  return apiRequest('/push/subscribe', {
    method: 'POST',
    body: JSON.stringify(subscription),
  });
}

export async function unsubscribePush(endpoint) {
  return apiRequest('/push/unsubscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint }),
  });
}

// delaySeconds: 0 → hemen (yanıt { sent }); 10 → sunucuda gecikmeli (yanıt { scheduled }).
export async function sendTestPush(delaySeconds = 0) {
  return apiRequest('/push/test', {
    method: 'POST',
    body: JSON.stringify({ delaySeconds }),
  });
}

// ─── KPI ────────────────────────────────────────────────────────────────────

export async function getWeeklyKpi() {
  const payload = await apiGet("/kpi/weekly");

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("data" in payload) ||
    typeof payload.data !== "object" ||
    payload.data === null
  ) {
    throw new Error("Haftalik KPI verisi bulunamadi.");
  }

  return payload.data;
}

export async function getFinanceFlow() {
  const payload = await apiGet("/kpi/finance-flow");

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("data" in payload) ||
    typeof payload.data !== "object" ||
    payload.data === null
  ) {
    throw new Error("Finans verisi bulunamadı.");
  }

  return payload.data;
}

export async function getOccupancyFlow() {
  const payload = await apiGet("/kpi/occupancy-flow");

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("data" in payload) ||
    typeof payload.data !== "object" ||
    payload.data === null
  ) {
    throw new Error("Doluluk verisi bulunamadı.");
  }

  return payload.data;
}

// ─── Week schedule ──────────────────────────────────────────────────────────

export async function getWeekLessons(weekStart) {
  if (!(weekStart instanceof Date) || Number.isNaN(weekStart.getTime())) {
    throw new Error("weekStart gecerli bir Date olmali.");
  }

  const to = new Date(weekStart);
  to.setDate(to.getDate() + 7);

  const fromParam = encodeURIComponent(weekStart.toISOString());
  const toParam = encodeURIComponent(to.toISOString());
  // Example URL: /lessons?from=2026-04-13T00%3A00%3A00.000Z&to=2026-04-20T00%3A00%3A00.000Z
  const payload = await apiGet(`/lessons?from=${fromParam}&to=${toParam}`);

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("data" in payload) ||
    !Array.isArray(payload.data)
  ) {
    throw new Error("Haftalik ders verisi bulunamadi.");
  }

  return payload.data;
}

// ─── Calendar Events (Plans) ────────────────────────────────────────────────

export async function getCalendarEvents(weekStart) {
  if (!(weekStart instanceof Date) || Number.isNaN(weekStart.getTime())) {
    throw new Error("weekStart gecerli bir Date olmali.");
  }
  const to = new Date(weekStart);
  to.setDate(to.getDate() + 7);
  const fromParam = encodeURIComponent(weekStart.toISOString());
  const toParam = encodeURIComponent(to.toISOString());
  const payload = await apiGet(`/calendar-events?from=${fromParam}&to=${toParam}`);
  if (!Array.isArray(payload?.data)) {
    throw new Error("Takvim etkinlikleri alinamadi.");
  }
  return payload.data;
}

export async function createCalendarEvent({
  eventType, title, startsAt, durationMinutes, labelColor, note, participantIds,
}) {
  const payload = await apiRequest("/calendar-events", {
    method: "POST",
    body: JSON.stringify({
      eventType,
      title,
      startsAt,
      durationMinutes: durationMinutes ?? 60,
      labelColor: labelColor ?? "graphite",
      note: note ?? null,
      participantIds: participantIds ?? [],
    }),
  });
  return ensureMutationResult(payload, "Plan oluşturulamadı.");
}

export async function updateCalendarEventApi(eventId, {
  title, durationMinutes, labelColor, note, participantIds,
}) {
  const payload = await apiRequest(
    `/calendar-events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      // participantIds undefined bırakılırsa JSON.stringify onu atlar → backend
      // katılımcılara dokunmaz. Dizi (boş dahil) gönderilirse tam liste değişir.
      body: JSON.stringify({ title, durationMinutes, labelColor, note, participantIds }),
    },
  );
  return ensureMutationResult(payload, "Plan güncellenemedi.");
}

export async function deleteCalendarEventApi(eventId) {
  const payload = await apiRequest(
    `/calendar-events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" },
  );
  return ensureMutationResult(payload, "Plan silinemedi.");
}

// ─── Students ────────────────────────────────────────────────────────────────

export async function getStudents() {
  const payload = await apiGet('/students');
  if (!Array.isArray(payload?.data)) throw new Error('Öğrenci listesi alınamadı.');
  return payload.data;
}

export async function getDebtors() {
  const payload = await apiGet('/students/debtors');
  if (!Array.isArray(payload?.data)) throw new Error('Borçlu öğrenci listesi alınamadı.');
  return payload.data;
}

export async function getStudentsKpi() {
  const payload = await apiGet('/students/kpi');
  if (typeof payload?.data !== 'object' || payload.data === null || Array.isArray(payload.data)) {
    throw new Error('Öğrenci KPI verisi alınamadı.');
  }
  return payload.data;
}

export async function getStudentById(studentId) {
  const payload = await apiGet(`/students/${encodeURIComponent(studentId)}`);
  if (typeof payload?.data !== 'object' || payload.data === null || Array.isArray(payload.data)) {
    throw new Error('Öğrenci bilgisi alınamadı.');
  }
  return payload.data;
}

export async function getStudentLessons(studentId) {
  const payload = await apiGet(`/students/${encodeURIComponent(studentId)}/lessons`);
  if (!Array.isArray(payload?.data)) throw new Error('Ders listesi alınamadı.');
  return payload.data;
}

export async function getStudentPackages(studentId) {
  const payload = await apiGet(`/students/${encodeURIComponent(studentId)}/packages`);
  if (!Array.isArray(payload?.data)) throw new Error('Paket listesi alınamadı.');
  return payload.data;
}

export async function getStudentProductSales(studentId) {
  const payload = await apiGet(`/students/${encodeURIComponent(studentId)}/product-sales`);
  if (!Array.isArray(payload?.data)) throw new Error('Ürün satışı listesi alınamadı.');
  return payload.data;
}

// Tek bir ürün satışını kalemleriyle (items[]) birlikte getirir.
export async function getProductSale(saleId) {
  const payload = await apiGet(`/product-sales/${encodeURIComponent(saleId)}`);
  if (typeof payload?.data !== 'object' || payload.data === null || Array.isArray(payload.data)) {
    throw new Error('Satış bilgisi alınamadı.');
  }
  return payload.data;
}

export async function getStudentMovements(studentId) {
  const payload = await apiGet(`/students/${encodeURIComponent(studentId)}/movements`);
  if (!Array.isArray(payload?.data)) throw new Error('Hareket listesi alınamadı.');
  return payload.data;
}

export async function createStudent(input) {
  const payload = await apiRequest('/students', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return ensureMutationResult(payload, 'Öğrenci oluşturulamadı.');
}

export async function updateStudent(studentId, input) {
  const payload = await apiRequest(`/students/${encodeURIComponent(studentId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return ensureMutationResult(payload, 'Öğrenci güncellenemedi.');
}

export async function deleteStudent(studentId) {
  const payload = await apiRequest(`/students/${encodeURIComponent(studentId)}`, {
    method: 'DELETE',
  });
  return ensureMutationResult(payload, 'Öğrenci silinemedi.');
}

// ─── Payments ───────────────────────────────────────────────────────────────

function ensureMutationResult(payload, fallbackMessage) {
  if (typeof payload?.data !== "object" || payload.data === null || Array.isArray(payload.data)) {
    throw new Error(fallbackMessage);
  }

  return payload.data;
}

export async function createCashPayment({ targetType, targetId, amount, source, paidAt, note }) {
  const payload = await apiRequest("/payments/cash", {
    method: "POST",
    body: JSON.stringify({
      targetType,
      targetId,
      amount,
      source,
      paidAt,
      note,
    }),
  });

  return ensureMutationResult(payload, "Nakit/Havale odemesi kaydedilemedi.");
}

// Yanlış girilen bir tahsilatı geri alır (soft-delete; kayıt audit'te kalır).
// Borç bu tutar kadar yeniden açılır. Pakete bağlı ödemeler silinemez (backend 409).
export async function deletePayment(paymentId) {
  const payload = await apiRequest(`/payments/${encodeURIComponent(paymentId)}`, {
    method: "DELETE",
  });
  return ensureMutationResult(payload, "Ödeme silinemedi.");
}

export async function createLesson({
  studentId,
  startsAt,
  mode,
  note,
  instructorId,
  lessonTypeId,
}) {
  const payload = await apiRequest("/lessons", {
    method: "POST",
    body: JSON.stringify({
      studentId,
      startsAt,
      mode,
      note,
      instructorId: instructorId ?? null,
      lessonTypeId: lessonTypeId ?? null,
    }),
  });
  return ensureMutationResult(payload, "Ders oluşturulamadı.");
}

// items[] verildiğinde server total'i hesaplar; verilmezse legacy mod
// (totalAmount + note) çalışır. Sepet (cart) tabanlı UI items[] kullanır.
// Item şekli: { productId | (name + unitPrice), quantity }
export async function createProductSaleApi({ studentId, soldAt, totalAmount, note, lessonId, items }) {
  const body = { studentId, soldAt, note, lessonId: lessonId ?? null };
  if (items && items.length > 0) {
    body.items = items;
  } else {
    body.totalAmount = totalAmount;
  }
  const payload = await apiRequest("/product-sales", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return ensureMutationResult(payload, "Ürün satışı oluşturulamadı.");
}

export async function completeLessonApi(lessonId) {
  const payload = await apiRequest(`/lessons/${lessonId}/complete`, {
    method: "POST",
  });
  return ensureMutationResult(payload, "Ders tamamlanamadı.");
}

export async function changeLessonStatusApi(lessonId, status) {
  const payload = await apiRequest(`/lessons/${lessonId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  return ensureMutationResult(payload, "Ders durumu güncellenemedi.");
}

export async function deleteLessonApi(lessonId) {
  const payload = await apiRequest(`/lessons/${lessonId}`, { method: "DELETE" });
  return ensureMutationResult(payload, "Ders silinemedi.");
}

// NOT: setLessonDiscount (PATCH /lessons/:id/discount) v1.6'da kaldırıldı.
// İndirim artık öğrenci × ders türü bazında özel fiyatla yönetiliyor
// (getLessonTypeStudentPrices / setLessonTypeStudentPrice / removeLessonTypeStudentPrice).

// ─── Settings ────────────────────────────────────────────────────────────────

export async function getSettings() {
  const payload = await apiGet("/settings");
  if (typeof payload?.data !== "object" || payload.data === null || Array.isArray(payload.data)) {
    throw new Error("Ayarlar alınamadı.");
  }
  return payload.data;
}

export async function updateSettings(data) {
  const payload = await apiRequest("/settings", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  if (typeof payload?.data !== "object" || payload.data === null || Array.isArray(payload.data)) {
    throw new Error("Ayarlar kaydedilemedi.");
  }
  return payload.data;
}

// ─── Instructors & Lesson Types ─────────────────────────────────────────────

export async function getInstructors({ includeAll = false } = {}) {
  const qs = includeAll ? "?include=all" : "";
  const payload = await apiGet(`/instructors${qs}`);
  if (!payload || !Array.isArray(payload.data)) {
    throw new Error("Eğitmen listesi alınamadı.");
  }
  return payload.data;
}

export async function createInstructor({ full_name }) {
  const payload = await apiRequest("/instructors", {
    method: "POST",
    body: JSON.stringify({ full_name }),
  });
  return ensureMutationResult(payload, "Eğitmen oluşturulamadı.");
}

export async function updateInstructor(id, patch) {
  const payload = await apiRequest(`/instructors/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return ensureMutationResult(payload, "Eğitmen güncellenemedi.");
}

export async function deleteInstructor(id) {
  const payload = await apiRequest(`/instructors/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!payload || typeof payload.data !== "object" || payload.data === null) {
    throw new Error("Eğitmen silinemedi.");
  }
  return payload.data;
}

export async function getLessonTypes() {
  const payload = await apiGet("/lesson-types");
  if (!payload || !Array.isArray(payload.data)) {
    throw new Error("Ders türü listesi alınamadı.");
  }
  return payload.data;
}

export async function createLessonType({ name, default_duration_minutes, default_price }) {
  const payload = await apiRequest("/lesson-types", {
    method: "POST",
    body: JSON.stringify({ name, default_duration_minutes, default_price }),
  });
  return ensureMutationResult(payload, "Ders türü oluşturulamadı.");
}

export async function updateLessonType(id, patch) {
  const payload = await apiRequest(`/lesson-types/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return ensureMutationResult(payload, "Ders türü güncellenemedi.");
}

// ─── Ders türüne özel öğrenci fiyatları (migration 0238) ──────────────────────

export async function getLessonTypeStudentPrices(lessonTypeId) {
  const payload = await apiGet(`/lesson-types/${encodeURIComponent(lessonTypeId)}/prices`);
  if (!payload || !Array.isArray(payload.data)) {
    throw new Error("Özel fiyat listesi alınamadı.");
  }
  return payload.data;
}

export async function setLessonTypeStudentPrice(lessonTypeId, studentId, customPrice) {
  const payload = await apiRequest(
    `/lesson-types/${encodeURIComponent(lessonTypeId)}/prices/${encodeURIComponent(studentId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ custom_price: customPrice }),
    },
  );
  return ensureMutationResult(payload, "Özel fiyat kaydedilemedi.");
}

export async function removeLessonTypeStudentPrice(lessonTypeId, studentId) {
  const payload = await apiRequest(
    `/lesson-types/${encodeURIComponent(lessonTypeId)}/prices/${encodeURIComponent(studentId)}`,
    { method: "DELETE" },
  );
  return ensureMutationResult(payload, "Özel fiyat kaldırılamadı.");
}

// ─── Audit Logs ──────────────────────────────────────────────────────────────

export async function getAuditLogs({ from, to, actions, actorUserId, entityType, entityId, q, page = 1, limit = 50 } = {}) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (actions && actions.length > 0) params.set("actions", actions.join(","));
  if (actorUserId != null) params.set("actor_user_id", String(actorUserId));
  if (entityType) params.set("entity_type", entityType);
  if (entityId != null) params.set("entity_id", String(entityId));
  if (q) params.set("q", q);
  params.set("page", String(page));
  params.set("limit", String(limit));

  const payload = await apiGet(`/audit-logs?${params.toString()}`);
  if (!Array.isArray(payload?.data)) throw new Error("Aktivite listesi alınamadı.");
  return { data: payload.data, page: payload.page, limit: payload.limit, hasMore: payload.hasMore };
}

export async function getAuditUsers() {
  const payload = await apiGet("/audit-logs/users");
  if (!Array.isArray(payload?.data)) throw new Error("Kullanıcı listesi alınamadı.");
  return payload.data;
}

// ─── Kullanıcı yönetimi (yalnız owner rolü — 403 diğerlerinde) ───────────────

export async function getUsers() {
  const payload = await apiGet("/users");
  if (!Array.isArray(payload?.data)) throw new Error("Kullanıcı listesi alınamadı.");
  return payload.data;
}

export async function createUserApi({ username, displayName, password, role }) {
  const payload = await apiRequest("/users", {
    method: "POST",
    body: JSON.stringify({ username, displayName, password, role }),
  });
  return ensureMutationResult(payload, "Kullanıcı oluşturulamadı.");
}

export async function updateUserApi(userId, patch) {
  const payload = await apiRequest(`/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return ensureMutationResult(payload, "Kullanıcı güncellenemedi.");
}

export async function resetUserPasswordApi(userId, password) {
  const payload = await apiRequest(`/users/${encodeURIComponent(userId)}/password`, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  return ensureMutationResult(payload, "Şifre sıfırlanamadı.");
}

// ─── Bildirim ayar modülü (owner-only) ───────────────────────────────────────
export async function getNotificationSettings() {
  const payload = await apiGet("/notification-settings");
  if (!Array.isArray(payload?.data)) throw new Error("Bildirim ayarları alınamadı.");
  return payload.data;
}

export async function updateNotificationSettingApi(key, patch) {
  const payload = await apiRequest(`/notification-settings/${encodeURIComponent(key)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return ensureMutationResult(payload, "Bildirim ayarı kaydedilemedi.");
}

// Çağıran kullanıcıya (owner) örnek bir test bildirimi gönderir; { sent } döner.
export async function sendTestNotificationApi(key) {
  const payload = await apiRequest(`/notification-settings/${encodeURIComponent(key)}/test`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  return ensureMutationResult(payload, "Test bildirimi gönderilemedi.");
}

// ─── Movements (stüdyo geneli hareket akışı) ─────────────────────────────────

export async function getMovements({ from, to, type, q, page = 1, limit = 50 } = {}) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (type && type !== "all") params.set("type", type);
  if (q) params.set("q", q);
  params.set("page", String(page));
  params.set("limit", String(limit));

  const payload = await apiGet(`/movements?${params.toString()}`);
  if (!Array.isArray(payload?.data)) throw new Error("Hareket listesi alınamadı.");
  return {
    data: payload.data,
    page: payload.page,
    limit: payload.limit,
    hasMore: payload.hasMore,
    summary: payload.summary,
  };
}

// ─── Products (catalog) ─────────────────────────────────────────────────────

export async function getProducts({ search, includeArchived = false, category } = {}) {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (includeArchived) params.set("includeArchived", "true");
  if (category) params.set("category", category);
  const qs = params.toString();
  const payload = await apiGet(`/products${qs ? `?${qs}` : ""}`);
  if (!Array.isArray(payload?.data)) throw new Error("Ürün listesi alınamadı.");
  return payload.data;
}

export async function getProductCategories() {
  const payload = await apiGet("/products/categories");
  if (!Array.isArray(payload?.data)) throw new Error("Kategori listesi alınamadı.");
  return payload.data;
}

export async function getProductById(productId) {
  const payload = await apiGet(`/products/${encodeURIComponent(productId)}`);
  if (typeof payload?.data !== "object" || payload.data === null || Array.isArray(payload.data)) {
    throw new Error("Ürün bilgisi alınamadı.");
  }
  return payload.data;
}

export async function createProduct(input) {
  const payload = await apiRequest("/products", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return ensureMutationResult(payload, "Ürün oluşturulamadı.");
}

export async function updateProduct(productId, patch) {
  const payload = await apiRequest(`/products/${encodeURIComponent(productId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return ensureMutationResult(payload, "Ürün güncellenemedi.");
}

// ─── Bundle (paket) bileşenleri (Model C / Faz 1.5) ──────────────────────────
// Paket ürünün kendi stoğu yoktur; on_hand bileşenlerden türetilir. Satışta
// (POS + TY) bileşenler düşer. İç içe paket yok.

// Paket bileşenleri + türev efektif stok. → { productId, isBundle, effectiveStock, components[] }
export async function getBundle(productId) {
  const payload = await apiGet(`/products/${encodeURIComponent(productId)}/bundle`);
  return ensureMutationResult(payload, "Paket bilgisi alınamadı.");
}

// Ürünü paket yap + bileşenleri (tam liste) ayarla. components: [{ productId, quantity }].
// Boş liste → "kurulum bekliyor" paket. → güncel BundleView
export async function setBundle(productId, components) {
  const payload = await apiRequest(`/products/${encodeURIComponent(productId)}/bundle`, {
    method: "PUT",
    body: JSON.stringify({ components }),
  });
  return ensureMutationResult(payload, "Paket kaydedilemedi.");
}

// Paketi çöz (basit ürüne döndür). → güncel BundleView
export async function clearBundle(productId) {
  const payload = await apiRequest(`/products/${encodeURIComponent(productId)}/bundle`, {
    method: "DELETE",
  });
  return ensureMutationResult(payload, "Paket çözülemedi.");
}

// Dahili stok: hedef on_hand'i mutlak olarak ayarlar (açılış stoğu + elle
// düzeltme). Backend delta'yı hesaplar. Stok takibi ayardan kapalıyken UI bu
// çağrıyı hiç göstermez. → { on_hand }
export async function setProductStock(productId, onHand, note) {
  const payload = await apiRequest(`/products/${encodeURIComponent(productId)}/stock`, {
    method: "PUT",
    body: JSON.stringify({ onHand, note: note ?? null }),
  });
  return ensureMutationResult(payload, "Stok güncellenemedi.");
}

// ─── Kanal eşleştirme (channel_listings) ─────────────────────────────────────
// İç veri modeli; dış API çağrısı yok. marketplaceSyncEnabled ayarı kapalıyken
// UI bu fonksiyonları hiç çağırmaz.

export async function getProductChannels(productId) {
  const payload = await apiGet(`/products/${encodeURIComponent(productId)}/channels`);
  if (!Array.isArray(payload?.data)) throw new Error("Kanal listesi alınamadı.");
  return payload.data;
}

export async function createProductChannel(productId, input) {
  const payload = await apiRequest(`/products/${encodeURIComponent(productId)}/channels`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return ensureMutationResult(payload, "Kanal eşleştirmesi eklenemedi.");
}

export async function updateChannelListing(listingId, patch) {
  const payload = await apiRequest(`/channels/${encodeURIComponent(listingId)}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
  return ensureMutationResult(payload, "Kanal eşleştirmesi güncellenemedi.");
}

export async function deleteChannelListing(listingId) {
  const payload = await apiRequest(`/channels/${encodeURIComponent(listingId)}`, {
    method: "DELETE",
  });
  return ensureMutationResult(payload, "Kanal eşleştirmesi silinemedi.");
}

// ─── Trendyol sipariş önizleme (read-only) ───────────────────────────────────
// Siparişleri GET ile çekip iç ürünlerle eşleştirilmiş önizleme döndürür. Hiçbir
// kayıt yazmaz. marketplaceSyncEnabled kapalıyken UI bu çağrıyı göstermez.
export async function previewTrendyolOrders(params = {}) {
  const payload = await apiRequest("/trendyol/orders/preview", {
    method: "POST",
    body: JSON.stringify(params),
  });
  if (typeof payload?.data !== "object" || payload.data === null || Array.isArray(payload.data)) {
    throw new Error("Sipariş önizlemesi alınamadı.");
  }
  return payload.data;
}

// Pazaryeri Siparişleri görünümü: TY siparişlerini TY fotoğrafı + iç ürün eşleşmesiyle
// zenginleştirilmiş liste + sekme sayıları olarak getirir. SALT-OKUMA; stoğa dokunmaz
// (order-sync defterinden bağımsız). marketplaceSyncEnabled kapalıysa 409, kimlik yoksa 503.
// → { orders[], tabCounts, total }
export async function getTrendyolOrdersList({ startDate, endDate, windowDays, force } = {}) {
  const params = new URLSearchParams();
  if (startDate) params.set("startDate", String(startDate));
  if (endDate) params.set("endDate", String(endDate));
  if (windowDays) params.set("windowDays", String(windowDays));
  if (force) params.set("force", "1"); // "Yenile": anlık önbelleği baypas et, canlı çek
  const qs = params.toString();
  const payload = await apiGet(`/trendyol/orders/list${qs ? `?${qs}` : ""}`);
  if (typeof payload?.data !== "object" || payload.data === null || Array.isArray(payload.data)) {
    throw new Error("Sipariş listesi alınamadı.");
  }
  return payload.data;
}

// Faz 2: bir siparişin kargo etiketini (Trendyol Ortak Etiket) OLUŞTURUR + getirir.
// CANLI TY yazması; marketplaceFulfillmentEnabled kapalıysa 409. format 'PDF'|'ZPL'.
// → { contentType, base64?|text?|json?, format, cargoTrackingNumber }
export async function getOrderLabel({ cargoTrackingNumber, format = "PDF" }) {
  const payload = await apiRequest("/trendyol/orders/label", {
    method: "POST",
    body: JSON.stringify({ cargoTrackingNumber, format }),
  });
  return ensureMutationResult(payload, "Kargo etiketi alınamadı.");
}

// Faz 2: bir paketin kargo firmasını DEĞİŞTİRİR (CANLI TY yazması). cargoProvider =
// TY firma KODU (orders.jsx CARGO_PROVIDERS whitelist'i). marketplaceFulfillmentEnabled
// kapalıysa 409. TY: paket başına 5 dk'da yalnız 1 değişiklik. → { packageId, cargoProvider, name }
export async function changeOrderCargoProvider({ packageId, cargoProvider }) {
  const payload = await apiRequest("/trendyol/orders/cargo-provider", {
    method: "POST",
    body: JSON.stringify({ packageId, cargoProvider }),
  });
  return ensureMutationResult(payload, "Kargo firması değiştirilemedi.");
}

// ─── Ürün eşleştirme kokpiti (iç katalog ↔ Trendyol ↔ Hepsiburada) ───────────

// Trendyol onaylı ürünlerini çekip yerel snapshot'a yazar (read-only). → { synced, pages, pruned }
export async function syncTrendyolProducts() {
  const payload = await apiRequest("/trendyol/products/sync", { method: "POST" });
  return ensureMutationResult(payload, "Trendyol ürünleri senkronlanamadı.");
}

// Kokpit verisi: iç ürünler + TY/HB eşlemeleri + eşleşmeyen TY ürünleri.
export async function getMappingOverview() {
  const payload = await apiGet("/mapping");
  if (typeof payload?.data !== "object" || payload.data === null || Array.isArray(payload.data)) {
    throw new Error("Eşleştirme verisi alınamadı.");
  }
  return payload.data;
}

// Barkodu eşleşen iç ürünleri TY snapshot'ına toplu bağlar. → { matched, links }
export async function autoMatchByBarcode() {
  const payload = await apiRequest("/mapping/auto-match", { method: "POST" });
  return ensureMutationResult(payload, "Otomatik eşleme yapılamadı.");
}

// Bir orphan TY ürününü iç kataloga benimse: mode 'link' (mevcut ürüne bağla) veya
// 'create' (yeni iç ürün oluştur + bağla). → { productId, listingId, created }
export async function adoptChannelProduct({ channelProductId, mode, productId, name, price }) {
  const payload = await apiRequest("/mapping/adopt", {
    method: "POST",
    body: JSON.stringify({
      channelProductId,
      mode,
      productId: productId ?? null,
      name: name ?? null,
      price: price ?? null,
    }),
  });
  return ensureMutationResult(payload, "Eşleştirme yapılamadı.");
}

// ─── Trendyol sipariş → stok senkronu (Model C / Faz 1) ──────────────────────
// Siparişleri çekip iç stoğu uzlaştırır (in-process poller'ın manuel ikizi).
// Trendyol'a hiçbir yazma yapılmaz (pull-only). marketplaceOrdersEnabled kapalıyken
// 409 döner. → sync özeti { counted, reversed, returnPending, unmatched, units… }
export async function syncTrendyolOrders() {
  const payload = await apiRequest("/trendyol/orders/sync", { method: "POST" });
  return ensureMutationResult(payload, "Siparişler senkronlanamadı.");
}

// İadeleri (claims) çekip ilgili sayılmış sipariş satırlarını "iade bekliyor"a taşır
// → inceleme kuyruğunu besler. Trendyol'a yazmaz, stok hareketi yazmaz (Model C:
// operatör malı sağlamsa elle ekler). marketplaceOrdersEnabled kapalıyken 409.
// → özet { returnsRegistered, alreadyPending, inactiveClaims, unlinkedClaims, … }
export async function syncTrendyolClaims() {
  const payload = await apiRequest("/trendyol/claims/sync", { method: "POST" });
  return ensureMutationResult(payload, "İadeler senkronlanamadı.");
}

// Açık inceleme kuyruğu: iade bekleyenler (operatör elle ekler) + eşleşmeyen satışlar.
export async function getOrderReviewQueue() {
  const payload = await apiGet("/trendyol/orders/review");
  if (typeof payload?.data !== "object" || payload.data === null || Array.isArray(payload.data)) {
    throw new Error("İnceleme kuyruğu alınamadı.");
  }
  return payload.data;
}

// Bir kuyruk kalemini "çözüldü" işaretler (stoğa dokunmaz; yalnız kuyruktan çıkarır).
export async function resolveOrderReviewItem(id) {
  const payload = await apiRequest(`/trendyol/orders/review/${encodeURIComponent(id)}/resolve`, {
    method: "POST",
  });
  return ensureMutationResult(payload, "Kuyruk kalemi güncellenemedi.");
}

// ─── Trendyol stok PUSH (Model C / Faz 2) ────────────────────────────────────
// CANLI pazaryeri listelerine yazma. Çok katmanlı kilit arkasında (baseline +
// dry-run + circuit-breaker + change-only + batch-doğrulama). UI bunları yalnız
// stok push açıkken gösterir.

// Her eşli ürünün iç açılış stoğunu o anki TY adedine hizalar + last_pushed işaretler
// (push'un ön koşulu). Trendyol'a YAZMAZ. → { baselined, seeded, skipped… }
export async function baselineStockPush(force = false) {
  const payload = await apiRequest("/trendyol/stock/baseline", {
    method: "POST",
    body: JSON.stringify({ force: !!force }),
  });
  return ensureMutationResult(payload, "Baseline yapılamadı.");
}

// İç efektif stoğu TY'ye gönderir. opts:
//   {}                        → toplu reconcile (dry-run flag'ine saygı)
//   { force: true }           → devre kesiciyi aş
//   { productId, live: true } → KASITLI tek-ürün CANLI yazma (dry-run'ı aşar)
// → { mode, pushedCount, failedCount, changedCount, items, breaker, … }
export async function runStockPush(opts = {}) {
  const payload = await apiRequest("/trendyol/stock/push", {
    method: "POST",
    body: JSON.stringify({
      force: opts.force === true,
      productId: opts.productId ?? null,
      live: opts.live === true,
    }),
  });
  return ensureMutationResult(payload, "Stok gönderimi başarısız.");
}

// Baseline durumu + push önizlemesi (değişecek kalemler) + push hataları + flag'ler.
export async function getStockPushStatus() {
  const payload = await apiGet("/trendyol/stock/status");
  if (typeof payload?.data !== "object" || payload.data === null || Array.isArray(payload.data)) {
    throw new Error("Stok gönderim durumu alınamadı.");
  }
  return payload.data;
}

export async function archiveProduct(productId) {
  const payload = await apiRequest(`/products/${encodeURIComponent(productId)}/archive`, {
    method: "POST",
  });
  return ensureMutationResult(payload, "Ürün arşivlenemedi.");
}

export async function unarchiveProduct(productId) {
  const payload = await apiRequest(`/products/${encodeURIComponent(productId)}/unarchive`, {
    method: "POST",
  });
  return ensureMutationResult(payload, "Ürün arşivden çıkarılamadı.");
}

// Kalıcı silme — yalnız arşivlenmiş ürünlerde başarılı olur (backend 409 atar).
export async function deleteProduct(productId) {
  const payload = await apiRequest(`/products/${encodeURIComponent(productId)}`, {
    method: "DELETE",
  });
  return ensureMutationResult(payload, "Ürün silinemedi.");
}

// Ham görsel bytes'ı (sıkıştırılmış Blob) yükler. Content-Type blob türünden
// gelir (image/webp ya da fallback image/jpeg); backend image_url'ı günceller.
export async function uploadProductImage(productId, blob) {
  const payload = await apiRequest(`/products/${encodeURIComponent(productId)}/image`, {
    method: "POST",
    body: blob,
    headers: { "Content-Type": blob.type || "image/webp" },
  });
  return ensureMutationResult(payload, "Görsel yüklenemedi.");
}

export async function removeProductImage(productId) {
  const payload = await apiRequest(`/products/${encodeURIComponent(productId)}/image`, {
    method: "DELETE",
  });
  return ensureMutationResult(payload, "Görsel kaldırılamadı.");
}

export async function bulkArchiveProducts(ids) {
  const payload = await apiRequest("/products/bulk/archive", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
  return ensureMutationResult(payload, "Toplu arşivleme başarısız.");
}

export async function bulkUnarchiveProducts(ids) {
  const payload = await apiRequest("/products/bulk/unarchive", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
  return ensureMutationResult(payload, "Toplu arşivden çıkarma başarısız.");
}

// category=null veya '' gönderildiğinde seçili ürünlerin kategorisi temizlenir.
export async function bulkSetProductCategory(ids, category) {
  const payload = await apiRequest("/products/bulk/category", {
    method: "POST",
    body: JSON.stringify({ ids, category: category ?? null }),
  });
  return ensureMutationResult(payload, "Toplu kategori değişimi başarısız.");
}

// mode: 'set' | 'add' | 'multiply'
//   set: value = yeni sabit fiyat (₺)
//   add: value = ekle/çıkar (negatif olabilir, ₺)
//   multiply: value = yüzde delta (10 = +%10, -5 = -%5)
export async function bulkUpdateProductPrice(ids, mode, value) {
  const payload = await apiRequest("/products/bulk/price", {
    method: "POST",
    body: JSON.stringify({ ids, mode, value }),
  });
  return ensureMutationResult(payload, "Toplu fiyat güncellemesi başarısız.");
}

// from'a sahip tüm ürünlerin category alanını to ile değiştirir. to=null → temizler.
export async function renameProductCategory(from, to) {
  const payload = await apiRequest("/products/categories/rename", {
    method: "POST",
    body: JSON.stringify({ from, to: to ?? null }),
  });
  return ensureMutationResult(payload, "Kategori yeniden adlandırılamadı.");
}

export async function uncompleteLesson(lessonId) {
  const payload = await apiRequest(`/lessons/${encodeURIComponent(lessonId)}/uncomplete`, {
    method: "POST",
  });
  return ensureMutationResult(payload, "Ders geri alınamadı.");
}

