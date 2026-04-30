// Mock data for Okaliptus Studio

export const STUDENTS = [
  { id: 1, name: "Ayşe Yılmaz", phone: "0532 123 45 67", email: "ayse.y@mail.com", birthday: "1988-03-14", joined: "2024-09-12", note: "Sırt ağrısı var, ileri geri bükülmelerde dikkat." },
  { id: 2, name: "Mehmet Kaya", phone: "0555 987 65 43", email: "mehmet.kaya@mail.com", birthday: "1992-07-22", joined: "2025-01-08", note: "" },
  { id: 3, name: "Zeynep Demir", phone: "0543 222 11 00", email: "zeynep@mail.com", birthday: "1990-11-05", joined: "2024-05-20", note: "Meditasyonda daha çok zaman geçirmek istiyor." },
  { id: 4, name: "Can Öztürk", phone: "0505 333 44 55", email: "can.o@mail.com", birthday: "1985-04-30", joined: "2025-02-01", note: "" },
  { id: 5, name: "Elif Şahin", phone: "0538 444 55 66", email: "elif.s@mail.com", birthday: "1995-09-18", joined: "2024-11-11", note: "Yeni başladı, temel duruşlar." },
  { id: 6, name: "Burak Arslan", phone: "0532 555 66 77", email: "burak@mail.com", birthday: "1980-12-02", joined: "2023-06-15", note: "" },
  { id: 7, name: "Deniz Aydın", phone: "0544 666 77 88", email: "deniz.a@mail.com", birthday: "1993-02-28", joined: "2025-03-10", note: "" },
  { id: 8, name: "Selin Koç", phone: "0506 777 88 99", email: "selin.k@mail.com", birthday: "1987-06-11", joined: "2024-08-22", note: "Hamilelik sonrası güçlendirme." },
  { id: 9, name: "Ahmet Polat", phone: "0555 888 99 00", email: "ahmet.p@mail.com", birthday: "1975-01-19", joined: "2024-02-03", note: "" },
  { id: 10, name: "Melis Güneş", phone: "0530 111 22 33", email: "melis.g@mail.com", birthday: "1991-08-07", joined: "2025-01-25", note: "Online tercih ediyor." },
  { id: 11, name: "Okan Tunç", phone: "0536 222 33 44", email: "okan.t@mail.com", birthday: "1983-10-14", joined: "2024-12-01", note: "" },
  { id: 12, name: "Gizem Aksoy", phone: "0507 333 44 66", email: "gizem@mail.com", birthday: "1996-05-25", joined: "2025-02-15", note: "" },
];

// Weekly sessions for current week (Pazartesi 13 Nisan - Pazar 19 Nisan 2026)
// day: 0=Mon ... 6=Sun, time "HH:MM" start, duration 60min default
export const WEEK_SESSIONS = [
  { id: 101, studentId: 1, day: 0, time: "09:00", mode: "yüzyüze", price: 800, paid: 800,  status: "geçti" },
  { id: 102, studentId: 3, day: 0, time: "11:00", mode: "online",  price: 700, paid: 0,    status: "geçti", debtNote: "Sonraki hafta" },
  { id: 103, studentId: 5, day: 0, time: "17:00", mode: "yüzyüze", price: 800, paid: 800,  status: "geçti" },
  { id: 104, studentId: 8, day: 0, time: "19:00", mode: "yüzyüze", price: 800, paid: 1500, status: "geçti", note: "Lavanta yağı +700" },

  { id: 105, studentId: 2, day: 1, time: "08:00", mode: "online",  price: 700, paid: 700,  status: "geçti" },
  { id: 106, studentId: 6, day: 1, time: "10:30", mode: "yüzyüze", price: 800, paid: 0,    status: "geçti", debtNote: "3 ders birikti" },
  { id: 107, studentId: 4, day: 1, time: "14:00", mode: "yüzyüze", price: 800, paid: 800,  status: "geçti" },
  { id: 108, studentId: 10, day: 1, time: "18:00", mode: "online", price: 700, paid: 700,  status: "geçti" },

  { id: 109, studentId: 7, day: 2, time: "09:00", mode: "yüzyüze", price: 800, paid: 800,  status: "geçti" },
  { id: 110, studentId: 1, day: 2, time: "11:00", mode: "yüzyüze", price: 800, paid: 800,  status: "geçti" },
  { id: 111, studentId: 11, day: 2, time: "16:00", mode: "online", price: 700, paid: 0,    status: "geçti", debtNote: "" },
  { id: 112, studentId: 3, day: 2, time: "19:00", mode: "yüzyüze", price: 800, paid: 800,  status: "geçti" },

  { id: 113, studentId: 12, day: 3, time: "10:00", mode: "yüzyüze", price: 800, paid: 800, status: "bugün" },
  { id: 114, studentId: 5, day: 3, time: "12:00", mode: "online",  price: 700, paid: 0,   status: "bugün", debtNote: "" },
  { id: 115, studentId: 2, day: 3, time: "17:00", mode: "yüzyüze", price: 800, paid: 0,   status: "bugün" },
  { id: 116, studentId: 9, day: 3, time: "19:00", mode: "yüzyüze", price: 800, paid: 0,   status: "bugün" },

  { id: 117, studentId: 8, day: 4, time: "09:00", mode: "yüzyüze", price: 800, paid: 0,   status: "yaklaşan" },
  { id: 118, studentId: 10, day: 4, time: "11:00", mode: "online", price: 700, paid: 0,   status: "yaklaşan" },
  { id: 119, studentId: 4, day: 4, time: "15:00", mode: "yüzyüze", price: 800, paid: 0,   status: "yaklaşan" },
  { id: 120, studentId: 1, day: 4, time: "18:00", mode: "yüzyüze", price: 800, paid: 0,   status: "yaklaşan" },

  { id: 121, studentId: 7, day: 5, time: "10:00", mode: "yüzyüze", price: 800, paid: 0,   status: "yaklaşan" },
  { id: 122, studentId: 3, day: 5, time: "12:00", mode: "yüzyüze", price: 800, paid: 0,   status: "yaklaşan" },
  { id: 123, studentId: 12, day: 5, time: "16:00", mode: "online", price: 700, paid: 0,   status: "yaklaşan" },

  { id: 124, studentId: 6, day: 6, time: "11:00", mode: "yüzyüze", price: 800, paid: 0,   status: "yaklaşan" },
];

// Outstanding debts (across weeks) - these are running balances
export const DEBTS = [
  { studentId: 6, amount: 2400, since: "2026-03-28", reason: "3 ders ödenmedi", lastContact: "2026-04-12" },
  { studentId: 3, amount: 700,  since: "2026-04-13", reason: "Bu hafta Pzt dersi",    lastContact: null },
  { studentId: 11, amount: 1400, since: "2026-04-01", reason: "2 ders + lavanta yağı", lastContact: "2026-04-10" },
  { studentId: 9, amount: 4800, since: "2026-02-20", reason: "Taksitli - ürün + 4 ders", lastContact: "2026-04-05", installment: true },
  { studentId: 5, amount: 700,  since: "2026-04-16", reason: "Bugünkü online ders", lastContact: null },
];

// Last 8 weeks income (for chart)
export const INCOME_HISTORY = [
  { week: "24 Şub", total: 11200, sessions: 15, product: 0 },
  { week: "3 Mar", total: 12600, sessions: 17, product: 0 },
  { week: "10 Mar", total: 15400, sessions: 20, product: 700 },
  { week: "17 Mar", total: 13300, sessions: 18, product: 0 },
  { week: "24 Mar", total: 14800, sessions: 19, product: 1400 },
  { week: "31 Mar", total: 16100, sessions: 21, product: 700 },
  { week: "7 Nis", total: 12900, sessions: 17, product: 0 },
  { week: "14 Nis", total: 11300, sessions: 15, product: 700 }, // current week so far
];

// Helpers
export const DAYS_TR = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
export const DAYS_TR_SHORT = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

// Week dates (Mon 13 Apr - Sun 19 Apr 2026)
export const WEEK_DATES = [13, 14, 15, 16, 17, 18, 19];
export const TODAY_INDEX = 3; // Perşembe

export const TIME_SLOTS = ["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00","20:00"];

export function getStudent(id) {
  return STUDENTS.find(s => s.id === id) || { name: "—" };
}

export function fmtTL(n) {
  return new Intl.NumberFormat("tr-TR").format(n) + " ₺";
}

export function initials(name) {
  return name.split(" ").map(s => s[0]).slice(0,2).join("").toUpperCase();
}

export function weekTotal() {
  return WEEK_SESSIONS.reduce((sum, s) => sum + s.paid, 0);
}

export function weekExpected() {
  return WEEK_SESSIONS.reduce((sum, s) => sum + s.price, 0);
}

export function weekSessionsCount() {
  return WEEK_SESSIONS.length;
}

export function totalDebt() {
  return DEBTS.reduce((s, d) => s + d.amount, 0);
}
