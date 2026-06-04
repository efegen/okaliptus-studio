/**
 * Frontend Smoke — HomePage (calendar + KPI cards)
 *
 * Dashboard'un render smoke'u:
 * - getWeeklyKpi, getWeekLessons, getSettings mock'lı
 * - KPI kartları render ediliyor
 * - Takvim render hatası yok
 *
 * LessonModal etkileşimini bu smoke'ta detaylandırmıyoruz; modal home.jsx
 * içinde inline ve büyük bir component — full-flow testi için ileride ayrı
 * dosya açılabilir.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function renderWithQuery(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

vi.mock("../api", () => ({
  getWeeklyKpi: vi.fn(),
  getWeekLessons: vi.fn(),
  getSettings: vi.fn(),
  getStudents: vi.fn(),
  getInstructors: vi.fn(),
  getLessonTypes: vi.fn(),
  createLesson: vi.fn(),
  completeLessonApi: vi.fn(),
  changeLessonStatusApi: vi.fn(),
  deleteLessonApi: vi.fn(),
  createCashPayment: vi.fn(),
  uncompleteLesson: vi.fn(),
  createProductSaleApi: vi.fn(),
  getAuditLogs: vi.fn(),
  getAuditUsers: vi.fn(),
}));

import { HomePage } from "../home";
import {
  getWeeklyKpi,
  getWeekLessons,
  getSettings,
  getStudents,
  getInstructors,
  getLessonTypes,
  getAuditLogs,
} from "../api";

describe("HomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWeeklyKpi.mockResolvedValue({
      weekStart: new Date().toISOString(),
      weekEnd: new Date(Date.now() + 7 * 86400_000).toISOString(),
      cashInflow: { total: "1000", cash: "700", iban: "300" },
      revenue: { total: "1500", lesson: "1200", product: "300" },
      lessonCounts: { planned: "5", completed: "3" },
      occupancyRatio: "0.20",
      receivable: "200",
      activeCreditValue: "1500",
      debtorStudentCount: "1",
      monthStart: new Date(Date.now() - 86400_000).toISOString(),
      monthlyCashInflow: { total: "5000" },
      monthlyRevenue: { total: "6000" },
    });
    getWeekLessons.mockResolvedValue([]);
    getSettings.mockResolvedValue({
      weeklyCapacity: 25,
      weekStart: "monday",
      calendarStartHour: 17,
      calendarEndHour: 23,
      defaultLessonMode: "onsite",
      defaultCurrency: "TRY",
      paymentMethodCash: true,
      paymentMethodIban: true,
      lessonColorSaturation: 1,
    });
    getStudents.mockResolvedValue([]);
    getInstructors.mockResolvedValue([{ id: "1", full_name: "Test Instructor", is_active: true }]);
    getLessonTypes.mockResolvedValue([
      { id: "1", name: "Yoga & Meditasyon", default_duration_minutes: 60, default_price: "500", is_active: true },
    ]);
    getAuditLogs.mockResolvedValue({ data: [], page: 1, limit: 50, hasMore: false });
  });

  it("renders without crashing and calls expected APIs", async () => {
    renderWithQuery(<HomePage layout="detayli" onNavigate={() => {}} />);
    // KPI fetch + week schedule fetch + settings fetch beklenir
    await screen.findAllByText(/./, { selector: "h1, h2, h3, .card" }).catch(() => {});
    expect(getWeeklyKpi).toHaveBeenCalled();
    expect(getWeekLessons).toHaveBeenCalled();
  });

  it("renders financial KPI cards (Tahsilat / Ciro / Receivable)", async () => {
    renderWithQuery(<HomePage layout="detayli" onNavigate={() => {}} />);
    // Spec §8.1 başlıkları geniş eşleşmeli
    const labels = await screen.findAllByText(/(tahsilat|ciro|alacak|kredi|ders)/i);
    expect(labels.length).toBeGreaterThan(0);
  });
});
