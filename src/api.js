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
      throw new Error(msg);
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

export async function setLessonDiscount(lessonId, { discountAmount, note } = {}) {
  const payload = await apiRequest(`/lessons/${lessonId}/discount`, {
    method: "PATCH",
    body: JSON.stringify({ discountAmount, note: note ?? null }),
  });
  return ensureMutationResult(payload, "İndirim uygulanamadı.");
}

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

