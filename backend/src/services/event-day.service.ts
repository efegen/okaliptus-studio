// Etkinlik günü ekranı (migration 0284) — kapıda tutulan düz giriş listesi.
//
// Eski katılımcı / ücret kalemi / tahsilat defteri (events.service.ts) burada
// KULLANILMAZ: önceden girilen ön ücretler anlam taşımaz, esas olan o gün
// gerçekten alınan paradır ve her satır sonradan serbestçe düzenlenebilir
// (kilit / kesin onay yok). Bu kayıtlar KPI / ciro / Hareketler hesaplarına
// karışmaz; audit yazılır ama etkinlik hareket akışına (audit_logs.event_id)
// bilinçli olarak bağlanmaz.

import type { PoolClient } from "pg";

import { pool } from "../db/connection.js";
import {
  DuplicateEventDayEntryError,
  EventDayEntryNotFoundError,
  EventNotFoundError,
  StudentNotFoundError,
  ValidationError,
  toServiceError,
} from "./errors.js";
import {
  centsToMoney,
  insertAuditLog,
  moneyToCents,
  normalizeOptionalText,
  rollbackQuietly,
  type EntityId,
  type MoneyInput,
} from "./shared.js";

export type EventDayPaymentMethod = "cash" | "card" | "iban";
// none: kahvaltı yok · paid_to_us: kahvaltı parası bize ödendi (restorana biz
// öderiz) · paid_to_restaurant: restorana kendisi ödedi (bilgi amaçlı) ·
// free: bedava (ücret alınmaz, restorana yine biz öderiz).
export type EventDayBreakfast = "none" | "paid_to_us" | "paid_to_restaurant" | "free";

const PAYMENT_METHODS: EventDayPaymentMethod[] = ["cash", "card", "iban"];
const BREAKFAST_STATES: EventDayBreakfast[] = ["none", "paid_to_us", "paid_to_restaurant", "free"];

const NAME_MAX_LENGTH = 120;
const NOTE_MAX_LENGTH = 500;
const SEARCH_LIMIT = 20;

type Queryable = Pick<PoolClient, "query">;

export type EventDayPricing = {
  lessonFee: string | null;
  breakfastFee: string | null;
};

export type EventDayEntryRow = {
  id: string;
  event_id: string;
  student_id: string | null;
  full_name: string;
  nickname: string | null;
  phone: string | null;
  is_light: boolean;
  pre_registered: boolean;
  amount: string;
  payment_method: EventDayPaymentMethod | null;
  breakfast: EventDayBreakfast;
  // Öğrenci değil, derse/etkinliğe hiç katılmıyor — yalnız kahvaltı için
  // kapıda eklenmiş misafir (bkz. migration 0286). Oluşturulduktan sonra
  // değiştirilemez.
  breakfast_only: boolean;
  note: string | null;
  checked_at: string | null;
  checked_by_name: string | null;
  // Yalnız breakfast === 'paid_to_restaurant' iken anlam taşır: kişi
  // restorana kendi ödedi demek kahvaltı verildi demek değildir — fişini
  // getirip gösterince biz karşılığında kahvaltı fişi veririz, o an burada
  // işaretlenir. checked_at'ten (kasadaki paranın kontrolü) bağımsızdır.
  breakfast_confirmed_at: string | null;
  breakfast_confirmed_by_name: string | null;
  created_at: string;
  created_by_name: string | null;
  updated_at: string;
  updated_by_name: string | null;
};

export type EventDaySummary = {
  people: number;
  checked: number;
  cash: string;
  card: string;
  iban: string;
  total: string;
  breakfastCount: number;
  breakfastPaidToUs: number;
  breakfastPaidToRestaurant: number;
  breakfastFree: number;
  // Kasadaki paranın restorana ait kısmı: bize ödenen kahvaltılar × fiyat.
  breakfastCollected: string;
  // Restorana ödeyeceğimiz toplam: (bize ödenen + bedava) × fiyat.
  restaurantOwed: string;
};

export type EventDayView = {
  event: { id: string; name: string; starts_at: string; status: string; location: string | null };
  pricing: EventDayPricing;
  summary: EventDaySummary;
  entries: EventDayEntryRow[];
};

export type EventDaySearchResult = {
  kind: "student" | "entry";
  student_id: string | null;
  entry_id: string | null;
  full_name: string;
  nickname: string | null;
  phone: string | null;
  pre_registered: boolean;
};

export type EventDayEntryInput = {
  studentId?: EntityId | null;
  fullName?: string | null;
  phone?: string | null;
  amount?: MoneyInput | null;
  paymentMethod?: string | null;
  breakfast?: string | null;
  note?: string | null;
  checked?: boolean;
  // Yalnız breakfast 'paid_to_restaurant' iken kabul edilir — fişini
  // gösterip kahvaltı fişini aldığının onayı (bkz. EventDayEntryRow yorumu).
  breakfastConfirmed?: boolean;
  // Yalnız createEventDayEntry'de okunur — oluşturulduktan sonra değişmez,
  // updateEventDayEntry bu alanı hiç okumaz.
  breakfastOnly?: boolean;
};

type EntryDbRow = {
  id: string;
  event_id: string;
  student_id: string | null;
  full_name: string;
  phone: string | null;
  amount: string;
  payment_method: EventDayPaymentMethod | null;
  breakfast: EventDayBreakfast;
  breakfast_only: boolean;
  note: string | null;
  checked_at: string | null;
  breakfast_confirmed_at: string | null;
  deleted_at: string | null;
};

// ─── Normalizasyon ──────────────────────────────────────────────────────────

// Türkçe harfleri ASCII küçük harfe katlar. DB'nin LC_CTYPE'ı 'C' olabildiği
// için (bkz. scripts/reset_db.ts) Postgres lower() yalnız ASCII'yi küçültür;
// SQL tarafında da aynı katlama önce translate() ile yapılır (foldSql).
const TR_FOLD_FROM = "ÇĞİIÖŞÜçğıöşüÂâÎîÛû";
const TR_FOLD_TO = "cgiiosucgiosuaaiiuu";

export function foldTr(value: string): string {
  let out = "";
  for (const ch of value) {
    const index = TR_FOLD_FROM.indexOf(ch);
    out += index >= 0 ? TR_FOLD_TO[index] : ch;
  }
  return out.toLowerCase();
}

function foldSql(expression: string): string {
  return `lower(translate(${expression}, '${TR_FOLD_FROM}', '${TR_FOLD_TO}'))`;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

// Kapıda girilen numara: yalnız TR cep, ulusal 10 hane (5XXXXXXXXX). Baştaki
// 0 / +90 atılır. Boş → null.
export function normalizeTrMobile(value: string | null | undefined): string | null {
  if (value == null) return null;
  let digits = String(value).replace(/\D/g, "");
  if (digits === "") return null;
  if (digits.startsWith("0")) digits = digits.slice(1);
  else if (digits.startsWith("90") && digits.length === 12) digits = digits.slice(2);
  if (!/^5\d{9}$/.test(digits)) {
    throw new ValidationError("Telefon 5 ile başlayan 10 haneli bir cep numarası olmalı.");
  }
  return digits;
}

function normalizeName(value: unknown): string {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name) throw new ValidationError("Ad soyad zorunlu.");
  if (name.length > NAME_MAX_LENGTH) {
    throw new ValidationError(`Ad soyad en fazla ${NAME_MAX_LENGTH} karakter olabilir.`);
  }
  return name;
}

function normalizeNote(value: unknown): string | null {
  const note = normalizeOptionalText(value == null ? null : String(value));
  if (note && note.length > NOTE_MAX_LENGTH) {
    throw new ValidationError(`Not en fazla ${NOTE_MAX_LENGTH} karakter olabilir.`);
  }
  return note;
}

function normalizePaymentMethod(value: unknown): EventDayPaymentMethod | null {
  if (value == null || value === "") return null;
  if (typeof value === "string" && (PAYMENT_METHODS as string[]).includes(value)) {
    return value as EventDayPaymentMethod;
  }
  throw new ValidationError("Ödeme yöntemi nakit, kart veya IBAN olmalı.");
}

function normalizeBreakfast(value: unknown): EventDayBreakfast {
  if (value == null || value === "") return "none";
  if (typeof value === "string" && (BREAKFAST_STATES as string[]).includes(value)) {
    return value as EventDayBreakfast;
  }
  throw new ValidationError("Kahvaltı durumu geçersiz.");
}

function parseAmount(value: MoneyInput | null | undefined): bigint {
  if (value == null || value === "") {
    throw new ValidationError("Alınan tutar girilmeli (ücretsizse 0).");
  }
  let cents: bigint;
  try {
    cents = moneyToCents(value, "amount");
  } catch {
    throw new ValidationError("Tutar geçersiz.");
  }
  if (cents < 0n) throw new ValidationError("Tutar negatif olamaz.");
  return cents;
}

function formatLira(cents: bigint): string {
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const fraction = cents % 100n;
  return fraction === 0n ? `${whole} ₺` : `${whole},${fraction.toString().padStart(2, "0")} ₺`;
}

// Para alanlarının son hali birlikte doğrulanır: tutar > 0 ise yöntem şart,
// 0 ise yöntem tutulmaz; kahvaltı bize ödendiyse tutar kahvaltı fiyatını
// karşılamalı (kahvaltı yarım ödenmez — esneklik yalnız ders kısmında).
function resolveMoney(
  amountCents: bigint,
  method: EventDayPaymentMethod | null,
  breakfast: EventDayBreakfast,
  pricing: EventDayPricing,
): { amount: string; method: EventDayPaymentMethod | null } {
  if (amountCents > 0n && method === null) {
    throw new ValidationError("Ödeme yöntemi seçilmeli (nakit, kart veya IBAN).");
  }
  if (breakfast !== "none" && pricing.breakfastFee == null) {
    throw new ValidationError("Bu etkinlikte kahvaltı kalemi tanımlı değil.");
  }
  if (breakfast === "paid_to_us" && pricing.breakfastFee != null) {
    const fee = moneyToCents(pricing.breakfastFee);
    if (amountCents < fee) {
      throw new ValidationError(`Kahvaltı ücreti (${formatLira(fee)}) tam alınmalı.`);
    }
  }
  return { amount: centsToMoney(amountCents), method: amountCents > 0n ? method : null };
}

// ─── Okuma ──────────────────────────────────────────────────────────────────

async function fetchEvent(queryable: Queryable, eventId: EntityId): Promise<EventDayView["event"]> {
  const result = await queryable.query<EventDayView["event"]>(
    `SELECT id, name, starts_at, status, location
       FROM events
      WHERE id = $1 AND deleted_at IS NULL`,
    [eventId],
  );
  const event = result.rows[0];
  if (!event) throw new EventNotFoundError();
  return event;
}

// Ders = is_lesson_fee kalemi (yoksa ilk geçiş-dışı kalem), kahvaltı = ilk
// "dışarıya ödenecek" (is_pass_through) kalem.
async function fetchPricing(queryable: Queryable, eventId: EntityId): Promise<EventDayPricing> {
  const result = await queryable.query<{ amount: string; is_lesson_fee: boolean; is_pass_through: boolean }>(
    `SELECT amount, is_lesson_fee, is_pass_through
       FROM event_fee_items
      WHERE event_id = $1
      ORDER BY sort_order ASC, id ASC`,
    [eventId],
  );
  const items = result.rows;
  const lesson = items.find((item) => item.is_lesson_fee) ?? items.find((item) => !item.is_pass_through);
  const breakfast = items.find((item) => item.is_pass_through);
  return {
    lessonFee: lesson ? centsToMoney(moneyToCents(lesson.amount)) : null,
    breakfastFee: breakfast ? centsToMoney(moneyToCents(breakfast.amount)) : null,
  };
}

const ENTRY_SELECT = `
  SELECT e.id, e.event_id, e.student_id,
         COALESCE(s.full_name, e.full_name) AS full_name,
         s.nickname,
         CASE WHEN e.student_id IS NULL THEN e.phone ELSE s.phone END AS phone,
         (e.student_id IS NULL) AS is_light,
         (e.student_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM event_participants p
             WHERE p.event_id = e.event_id AND p.student_id = e.student_id
         )) AS pre_registered,
         e.amount, e.payment_method, e.breakfast, e.breakfast_only, e.note,
         e.checked_at, checker.display_name AS checked_by_name,
         e.breakfast_confirmed_at, confirmer.display_name AS breakfast_confirmed_by_name,
         e.created_at, creator.display_name AS created_by_name,
         e.updated_at, updater.display_name AS updated_by_name
    FROM event_day_entries e
    LEFT JOIN students s ON s.id = e.student_id
    LEFT JOIN users checker ON checker.id = e.checked_by_user_id
    LEFT JOIN users confirmer ON confirmer.id = e.breakfast_confirmed_by_user_id
    LEFT JOIN users creator ON creator.id = e.created_by_user_id
    LEFT JOIN users updater ON updater.id = e.updated_by_user_id
`;

async function fetchEntry(queryable: Queryable, entryId: EntityId): Promise<EventDayEntryRow> {
  const result = await queryable.query<EventDayEntryRow>(`${ENTRY_SELECT} WHERE e.id = $1`, [entryId]);
  const row = result.rows[0];
  if (!row) throw new EventDayEntryNotFoundError();
  return row;
}

async function fetchSummary(
  queryable: Queryable,
  eventId: EntityId,
  pricing: EventDayPricing,
): Promise<EventDaySummary> {
  const result = await queryable.query<{
    people: number;
    checked: number;
    cash: string;
    card: string;
    iban: string;
    total: string;
    breakfast_count: number;
    breakfast_paid_to_us: number;
    breakfast_paid_to_restaurant: number;
    breakfast_free: number;
  }>(
    `SELECT COUNT(*)::int AS people,
            COUNT(*) FILTER (WHERE checked_at IS NOT NULL)::int AS checked,
            COALESCE(SUM(amount) FILTER (WHERE payment_method = 'cash'), 0)::text AS cash,
            COALESCE(SUM(amount) FILTER (WHERE payment_method = 'card'), 0)::text AS card,
            COALESCE(SUM(amount) FILTER (WHERE payment_method = 'iban'), 0)::text AS iban,
            COALESCE(SUM(amount), 0)::text AS total,
            COUNT(*) FILTER (WHERE breakfast <> 'none')::int AS breakfast_count,
            COUNT(*) FILTER (WHERE breakfast = 'paid_to_us')::int AS breakfast_paid_to_us,
            COUNT(*) FILTER (WHERE breakfast = 'paid_to_restaurant')::int AS breakfast_paid_to_restaurant,
            COUNT(*) FILTER (WHERE breakfast = 'free')::int AS breakfast_free
       FROM event_day_entries
      WHERE event_id = $1 AND deleted_at IS NULL`,
    [eventId],
  );
  const row = result.rows[0];
  const money = (value: string) => centsToMoney(moneyToCents(value));
  const feeCents = pricing.breakfastFee != null ? moneyToCents(pricing.breakfastFee) : 0n;
  return {
    people: row.people,
    checked: row.checked,
    cash: money(row.cash),
    card: money(row.card),
    iban: money(row.iban),
    total: money(row.total),
    breakfastCount: row.breakfast_count,
    breakfastPaidToUs: row.breakfast_paid_to_us,
    breakfastPaidToRestaurant: row.breakfast_paid_to_restaurant,
    breakfastFree: row.breakfast_free,
    breakfastCollected: centsToMoney(feeCents * BigInt(row.breakfast_paid_to_us)),
    restaurantOwed: centsToMoney(feeCents * BigInt(row.breakfast_paid_to_us + row.breakfast_free)),
  };
}

export async function getEventDay(eventId: EntityId): Promise<EventDayView> {
  const event = await fetchEvent(pool, eventId);
  const pricing = await fetchPricing(pool, eventId);
  const [summary, entries] = await Promise.all([
    fetchSummary(pool, eventId, pricing),
    pool.query<EventDayEntryRow>(
      `${ENTRY_SELECT}
        WHERE e.event_id = $1 AND e.deleted_at IS NULL
        ORDER BY e.created_at DESC, e.id DESC`,
      [eventId],
    ),
  ]);
  return { event, pricing, summary, entries: entries.rows };
}

// İsim (Türkçe karakter duyarsız, yazılan her kelime geçmeli) veya telefon.
// Yalnız rakam/telefon biçim karakteri içeren sorgu telefon aramasıdır:
// 0 / +90 ile başlamayan 4 ve daha az hane "son 4 hane" olarak sondan
// eşleşir, diğerleri numaranın içinde aranır. Öğrenciler (bu etkinlikteki
// satırıyla birlikte) + bugünkü hafif kayıtlar döner.
export async function searchEventDay(eventId: EntityId, query: string): Promise<EventDaySearchResult[]> {
  await fetchEvent(pool, eventId);
  const raw = String(query ?? "").trim();
  if (!raw) return [];

  let param: string | string[];
  let studentCondition: string;
  let entryCondition: string;

  if (/^[\d\s()+-]+$/.test(raw)) {
    let digits = raw.replace(/\D/g, "");
    const typedFromStart = digits.startsWith("0") || digits.startsWith("90");
    if (digits.startsWith("0")) digits = digits.slice(1);
    else if (digits.startsWith("90") && digits.length >= 12) digits = digits.slice(2);
    if (digits.length < 2) return [];
    param = !typedFromStart && digits.length <= 4 ? `%${digits}` : `%${digits}%`;
    studentCondition = `regexp_replace(COALESCE(s.phone, ''), '[^0-9]', '', 'g') LIKE $2`;
    entryCondition = `COALESCE(e.phone, '') LIKE $2`;
  } else {
    const tokens = foldTr(raw).split(/\s+/).filter(Boolean).slice(0, 5).map(escapeLike);
    if (tokens.length === 0) return [];
    param = tokens;
    studentCondition = `NOT EXISTS (
      SELECT 1 FROM unnest($2::text[]) AS t(token)
       WHERE ${foldSql("s.full_name || ' ' || COALESCE(s.nickname, '')")} NOT LIKE '%' || t.token || '%'
    )`;
    entryCondition = `NOT EXISTS (
      SELECT 1 FROM unnest($2::text[]) AS t(token)
       WHERE ${foldSql("e.full_name")} NOT LIKE '%' || t.token || '%'
    )`;
  }

  const [students, lightEntries] = await Promise.all([
    pool.query<EventDaySearchResult>(
      `SELECT 'student' AS kind, s.id AS student_id, e.id AS entry_id,
              s.full_name, s.nickname, s.phone,
              EXISTS (
                SELECT 1 FROM event_participants p
                 WHERE p.event_id = $1 AND p.student_id = s.id
              ) AS pre_registered
         FROM students s
         LEFT JOIN event_day_entries e
           ON e.event_id = $1 AND e.student_id = s.id AND e.deleted_at IS NULL
        WHERE s.deleted_at IS NULL AND ${studentCondition}
        ORDER BY pre_registered DESC, ${foldSql("s.full_name")} ASC
        LIMIT ${SEARCH_LIMIT}`,
      [eventId, param],
    ),
    pool.query<EventDaySearchResult>(
      `SELECT 'entry' AS kind, NULL::bigint AS student_id, e.id AS entry_id,
              e.full_name, NULL::text AS nickname, e.phone, false AS pre_registered
         FROM event_day_entries e
        WHERE e.event_id = $1 AND e.deleted_at IS NULL AND e.student_id IS NULL
          AND ${entryCondition}
        ORDER BY e.created_at DESC
        LIMIT ${SEARCH_LIMIT}`,
      [eventId, param],
    ),
  ]);
  return [...students.rows, ...lightEntries.rows];
}

// ─── Yazma ──────────────────────────────────────────────────────────────────

async function lockEntry(client: PoolClient, entryId: EntityId): Promise<EntryDbRow> {
  const result = await client.query<EntryDbRow>(
    `SELECT id, event_id, student_id, full_name, phone, amount, payment_method, breakfast,
            breakfast_only, note, checked_at, breakfast_confirmed_at, deleted_at
       FROM event_day_entries
      WHERE id = $1
      FOR UPDATE`,
    [entryId],
  );
  const row = result.rows[0];
  if (!row) throw new EventDayEntryNotFoundError();
  return row;
}

function auditSnapshot(row: {
  full_name: string;
  phone: string | null;
  amount: string;
  payment_method: EventDayPaymentMethod | null;
  breakfast: EventDayBreakfast;
  breakfast_only: boolean;
  note: string | null;
  checked: boolean;
  breakfastConfirmed: boolean;
}): Record<string, unknown> {
  return {
    fullName: row.full_name,
    phone: row.phone,
    amount: row.amount,
    paymentMethod: row.payment_method,
    breakfast: row.breakfast,
    breakfastOnly: row.breakfast_only,
    note: row.note,
    checked: row.checked,
    breakfastConfirmed: row.breakfastConfirmed,
  };
}

// Kayıtlı öğrenci (studentId) VEYA hafif kayıt (fullName + isteğe bağlı
// phone). İkisi birden gelirse öğrenci esas alınır.
export async function createEventDayEntry(
  eventId: EntityId,
  input: EventDayEntryInput,
  actorUserId: number | string | null = null,
): Promise<EventDayEntryRow> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await fetchEvent(client, eventId);
    const pricing = await fetchPricing(client, eventId);

    let studentId: string | null = null;
    let fullName: string;
    let phone: string | null = null;
    if (input.studentId != null && input.studentId !== "") {
      const studentResult = await client.query<{ id: string; full_name: string; deleted_at: string | null }>(
        `SELECT id, full_name, deleted_at FROM students WHERE id = $1 FOR SHARE`,
        [input.studentId],
      );
      const student = studentResult.rows[0];
      if (!student || student.deleted_at !== null) throw new StudentNotFoundError();
      const existing = await client.query(
        `SELECT 1 FROM event_day_entries
          WHERE event_id = $1 AND student_id = $2 AND deleted_at IS NULL`,
        [eventId, student.id],
      );
      if (existing.rows[0]) throw new DuplicateEventDayEntryError();
      studentId = student.id;
      fullName = student.full_name;
    } else {
      fullName = normalizeName(input.fullName);
      phone = normalizeTrMobile(input.phone);
    }

    const breakfast = normalizeBreakfast(input.breakfast);
    const breakfastOnly = input.breakfastOnly === true;
    if (breakfastOnly && studentId !== null) {
      throw new ValidationError("Sadece kahvaltı misafiri öğrenci olarak eklenemez.");
    }
    if (breakfastOnly && breakfast === "none") {
      throw new ValidationError("Sadece kahvaltı misafiri için kahvaltı seçimi gerekli.");
    }
    const money = resolveMoney(
      parseAmount(input.amount),
      normalizePaymentMethod(input.paymentMethod),
      breakfast,
      pricing,
    );
    const note = normalizeNote(input.note);
    const checked = input.checked === true;
    if (input.breakfastConfirmed === true && breakfast !== "paid_to_restaurant") {
      throw new ValidationError("Kahvaltı fişi onayı yalnız 'Restorana kendi öder' seçili kayıtlarda verilir.");
    }
    const breakfastConfirmed = input.breakfastConfirmed === true;

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO event_day_entries (
         event_id, student_id, full_name, phone, amount, payment_method, breakfast, note,
         checked_at, checked_by_user_id,
         breakfast_confirmed_at, breakfast_confirmed_by_user_id,
         breakfast_only,
         created_by_user_id, updated_by_user_id
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         CASE WHEN $9::boolean THEN now() END,
         CASE WHEN $9::boolean THEN $11::bigint END,
         CASE WHEN $10::boolean THEN now() END,
         CASE WHEN $10::boolean THEN $11::bigint END,
         $12::boolean,
         $11::bigint, $11::bigint
       )
       RETURNING id`,
      [eventId, studentId, fullName, phone, money.amount, money.method, breakfast, note, checked, breakfastConfirmed, actorUserId, breakfastOnly],
    );
    const entryId = inserted.rows[0].id;

    await insertAuditLog(client, {
      action: "event_day_entry_created",
      entityType: "event_day_entry",
      entityId: entryId,
      after: {
        eventId: String(eventId),
        studentId,
        ...auditSnapshot({
          full_name: fullName,
          phone,
          amount: money.amount,
          payment_method: money.method,
          breakfast,
          breakfast_only: breakfastOnly,
          note,
          checked,
          breakfastConfirmed,
        }),
      },
      actorUserId,
    });

    const row = await fetchEntry(client, entryId);
    await client.query("COMMIT");
    return row;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

// Kısmi güncelleme. Ad/telefon yalnız hafif kayıtta değişir (kayıtlı
// öğrencininki öğrenci profilinden). "Ödeme OK" tiki para alanlarından biri
// değişince kendiliğinden kalkar; aynı istekte açıkça checked:true
// gönderilmişse yeniden konur.
export async function updateEventDayEntry(
  entryId: EntityId,
  input: EventDayEntryInput,
  actorUserId: number | string | null = null,
): Promise<EventDayEntryRow> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await lockEntry(client, entryId);
    if (before.deleted_at !== null) throw new EventDayEntryNotFoundError();

    let fullName = before.full_name;
    let phone = before.phone;
    if (input.fullName !== undefined || input.phone !== undefined) {
      if (before.student_id !== null) {
        throw new ValidationError("Kayıtlı öğrencinin adı ve telefonu öğrenci profilinden değiştirilir.");
      }
      if (input.fullName !== undefined) fullName = normalizeName(input.fullName);
      if (input.phone !== undefined) phone = normalizeTrMobile(input.phone);
    }

    let amount = centsToMoney(moneyToCents(before.amount));
    let method = before.payment_method;
    let breakfast = before.breakfast;
    if (input.amount !== undefined || input.paymentMethod !== undefined || input.breakfast !== undefined) {
      const pricing = await fetchPricing(client, before.event_id);
      const nextBreakfast = input.breakfast !== undefined ? normalizeBreakfast(input.breakfast) : before.breakfast;
      if (before.breakfast_only && nextBreakfast === "none") {
        throw new ValidationError("Sadece kahvaltı misafiri için kahvaltı 'Almayacak' seçilemez.");
      }
      const resolved = resolveMoney(
        input.amount !== undefined ? parseAmount(input.amount) : moneyToCents(before.amount),
        input.paymentMethod !== undefined ? normalizePaymentMethod(input.paymentMethod) : before.payment_method,
        nextBreakfast,
        pricing,
      );
      amount = resolved.amount;
      method = resolved.method;
      breakfast = nextBreakfast;
    }
    const note = input.note !== undefined ? normalizeNote(input.note) : before.note;

    const moneyChanged =
      moneyToCents(amount) !== moneyToCents(before.amount)
      || method !== before.payment_method
      || breakfast !== before.breakfast;
    const dataChanged = moneyChanged || fullName !== before.full_name || phone !== before.phone || note !== before.note;

    let checkedAction: "keep" | "set" | "clear" = "keep";
    if (input.checked === true) checkedAction = before.checked_at !== null && !moneyChanged ? "keep" : "set";
    else if (input.checked === false) checkedAction = before.checked_at !== null ? "clear" : "keep";
    else if (moneyChanged && before.checked_at !== null) checkedAction = "clear";

    // Kahvaltı fişi onayı yalnız 'paid_to_restaurant' iken verilebilir; kahvaltı
    // türü başka bir şeye değiştiyse (bu istekte ya da önceden) eski onay
    // artık anlamsız — kendiliğinden temizlenir (bkz. migration 0285 CHECK).
    let breakfastConfirmedAction: "keep" | "set" | "clear" = "keep";
    if (input.breakfastConfirmed === true) {
      if (breakfast !== "paid_to_restaurant") {
        throw new ValidationError("Kahvaltı fişi onayı yalnız 'Restorana kendi öder' seçili kayıtlarda verilir.");
      }
      breakfastConfirmedAction = before.breakfast_confirmed_at !== null ? "keep" : "set";
    } else if (input.breakfastConfirmed === false) {
      breakfastConfirmedAction = before.breakfast_confirmed_at !== null ? "clear" : "keep";
    } else if (breakfast !== before.breakfast && before.breakfast_confirmed_at !== null) {
      breakfastConfirmedAction = "clear";
    }

    if (!dataChanged && checkedAction === "keep" && breakfastConfirmedAction === "keep") {
      const unchanged = await fetchEntry(client, entryId);
      await client.query("COMMIT");
      return unchanged;
    }

    await client.query(
      `UPDATE event_day_entries
          SET full_name = $2,
              phone = $3,
              amount = $4,
              payment_method = $5,
              breakfast = $6,
              note = $7,
              checked_at = CASE $8::text WHEN 'set' THEN now() WHEN 'clear' THEN NULL ELSE checked_at END,
              checked_by_user_id = CASE $8::text
                WHEN 'set' THEN $9::bigint WHEN 'clear' THEN NULL ELSE checked_by_user_id END,
              breakfast_confirmed_at = CASE $11::text WHEN 'set' THEN now() WHEN 'clear' THEN NULL ELSE breakfast_confirmed_at END,
              breakfast_confirmed_by_user_id = CASE $11::text
                WHEN 'set' THEN $9::bigint WHEN 'clear' THEN NULL ELSE breakfast_confirmed_by_user_id END,
              updated_at = CASE WHEN $10::boolean THEN now() ELSE updated_at END,
              updated_by_user_id = CASE WHEN $10::boolean THEN $9::bigint ELSE updated_by_user_id END
        WHERE id = $1`,
      [entryId, fullName, phone, amount, method, breakfast, note, checkedAction, actorUserId, dataChanged, breakfastConfirmedAction],
    );

    const wasChecked = before.checked_at !== null;
    const isChecked = checkedAction === "set" || (checkedAction === "keep" && wasChecked);
    const wasBreakfastConfirmed = before.breakfast_confirmed_at !== null;
    const isBreakfastConfirmed = breakfastConfirmedAction === "set"
      || (breakfastConfirmedAction === "keep" && wasBreakfastConfirmed);
    await insertAuditLog(client, {
      action: "event_day_entry_updated",
      entityType: "event_day_entry",
      entityId: String(entryId),
      before: auditSnapshot({ ...before, checked: wasChecked, breakfastConfirmed: wasBreakfastConfirmed }),
      after: auditSnapshot({
        full_name: fullName,
        phone,
        amount,
        payment_method: method,
        breakfast,
        breakfast_only: before.breakfast_only,
        note,
        checked: isChecked,
        breakfastConfirmed: isBreakfastConfirmed,
      }),
      actorUserId,
    });

    const row = await fetchEntry(client, entryId);
    await client.query("COMMIT");
    return row;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

// Soft delete — ekrandaki "Geri al" restoreEventDayEntry ile döndürür.
export async function deleteEventDayEntry(
  entryId: EntityId,
  actorUserId: number | string | null = null,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await lockEntry(client, entryId);
    if (before.deleted_at !== null) throw new EventDayEntryNotFoundError();

    await client.query(
      `UPDATE event_day_entries
          SET deleted_at = now(), deleted_by_user_id = $2::bigint
        WHERE id = $1`,
      [entryId, actorUserId],
    );
    await insertAuditLog(client, {
      action: "event_day_entry_deleted",
      entityType: "event_day_entry",
      entityId: String(entryId),
      before: auditSnapshot({
        ...before,
        checked: before.checked_at !== null,
        breakfastConfirmed: before.breakfast_confirmed_at !== null,
      }),
      actorUserId,
    });

    await client.query("COMMIT");
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

export async function restoreEventDayEntry(
  entryId: EntityId,
  actorUserId: number | string | null = null,
): Promise<EventDayEntryRow> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await lockEntry(client, entryId);
    if (before.deleted_at === null) {
      const current = await fetchEntry(client, entryId);
      await client.query("COMMIT");
      return current;
    }
    if (before.student_id !== null) {
      const existing = await client.query(
        `SELECT 1 FROM event_day_entries
          WHERE event_id = $1 AND student_id = $2 AND deleted_at IS NULL`,
        [before.event_id, before.student_id],
      );
      if (existing.rows[0]) throw new DuplicateEventDayEntryError();
    }

    await client.query(
      `UPDATE event_day_entries
          SET deleted_at = NULL,
              deleted_by_user_id = NULL,
              updated_at = now(),
              updated_by_user_id = $2::bigint
        WHERE id = $1`,
      [entryId, actorUserId],
    );
    await insertAuditLog(client, {
      action: "event_day_entry_restored",
      entityType: "event_day_entry",
      entityId: String(entryId),
      after: auditSnapshot({
        ...before,
        checked: before.checked_at !== null,
        breakfastConfirmed: before.breakfast_confirmed_at !== null,
      }),
      actorUserId,
    });

    const row = await fetchEntry(client, entryId);
    await client.query("COMMIT");
    return row;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}
