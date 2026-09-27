export const queryKeys = {
  weeklyKpi:          ()      => ['weeklyKpi'],
  financeFlow:        ()      => ['financeFlow'],
  occupancyFlow:      ()      => ['occupancyFlow'],
  weekLessons:        (ms)    => ms !== undefined ? ['weekLessons', ms] : ['weekLessons'],
  calendarEvents:     (ms)    => ms !== undefined ? ['calendarEvents', ms] : ['calendarEvents'],
  students:           ()      => ['students'],
  studentsKpi:        ()      => ['studentsKpi'],
  studentById:        (id)    => ['student', id],
  studentLessons:     (id)    => ['student', id, 'lessons'],
  studentPackages:    (id)    => ['student', id, 'packages'],
  studentProductSales:(id)    => ['student', id, 'productSales'],
  studentMovements:   (id)    => ['student', id, 'movements'],
  instructors:        ()      => ['instructors'],
  lessonTypes:        ()      => ['lessonTypes'],
  products:           (params)=> params !== undefined ? ['products', params] : ['products'],
  productById:        (id)    => ['product', id],
  settings:           ()      => ['settings'],
  // Pazaryeri siparişleri: web + mobil liste/detay aynı pencere için AYNI anahtarı
  // paylaşır (tek önbellek). Argümansız çağrı tüm pencereleri kapsayan önektir.
  trendyolOrders:     (p)     => p !== undefined
    ? ['trendyolOrders', p.startDate ?? null, p.endDate ?? null, p.windowDays ?? null]
    : ['trendyolOrders'],
  trendyolCargoChanges:(ids)  => ['trendyolCargoChanges', ids],
  debtors:            ()      => ['debtors'],
  auditLogs:          (params)=> ['auditLogs', params],
  auditUsers:         ()      => ['auditUsers'],
  studioMovements:    (params)=> params !== undefined ? ['movements', params] : ['movements'],
  upcomingEvent:      ()      => ['upcomingEvent'],
  events:             (status)=> status !== undefined ? ['events', status] : ['events'],
  eventById:          (id)    => ['event', id],
  eventParticipants:  (id)    => ['event', id, 'participants'],
  // Notlar stüdyo geneli tek bir akış — etkinliğe bağlı değil (bkz. backend
  // migration 0273_general_notes.sql).
  notes:              ()      => ['notes'],
  noteCategories:     ()      => ['notes', 'categories'],
  noteImage:          (id, version) => ['notes', String(id), 'image', version ?? null],
  noteReminderRecipients: ()  => ['notes', 'reminder-recipients'],
  noteViewers:        (id)    => ['notes', String(id), 'viewers'],
  eventParticipantFees:(id)   => ['eventParticipant', id, 'fees'],
  eventParticipantPayments:(id) => ['eventParticipant', id, 'payments'],
  eventParticipantNotes:(id)  => ['eventParticipant', id, 'notes'],
  eventVehicles:      (id)    => ['event', id, 'vehicles'],
  eventActivity:      (id)    => ['event', id, 'activity'],
  // Etkinlik günü ekranı (0284). Arama anahtarı günün altında durur ki
  // listeyi tazelemek (eventDay prefix'i) aramaları da tazelesin.
  eventDay:           (id)    => ['event', id, 'day'],
  eventDaySearch:     (id, q) => ['event', id, 'day', 'search', q],
  studentEventBalances:(id)   => ['student', id, 'events'],
};
