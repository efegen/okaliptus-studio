/**
 * Frontend Smoke — StudentProfilePage (A11 web yeniden tasarımı)
 *
 * - Render: API çağrıları yapılır, öğrenci ismi durum bandında basılır
 * - Durum bandı: net borç > 0 → "Toplam borç" + tutar, =0 → "Güncel"
 * - Sekmeler: Özet / Dersler / Satışlar / Hareketler (Paket sekmesi YOK — A11)
 * - Bakiye hareketleri sekmesi YOK (v1 sadeleştirme regression koruma)
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../api", () => ({
  getStudentById: vi.fn(),
  getStudentLessons: vi.fn(),
  getStudentPackages: vi.fn(),
  getStudentProductSales: vi.fn(),
  getStudentMovements: vi.fn(),
  createCashPayment: vi.fn(),
  setLessonDiscount: vi.fn(),
}));

import { StudentProfilePage } from "../student-profile";
import {
  getStudentById,
  getStudentLessons,
  getStudentPackages,
  getStudentProductSales,
  getStudentMovements,
} from "../api";

function setupMocks({ studentOverrides = {}, lessons = [], packages = [], sales = [], movements = [] } = {}) {
  getStudentById.mockResolvedValue({
    id: "1",
    full_name: "Test Student",
    nickname: null,
    is_active: true,
    phone: null,
    email: null,
    note: null,
    lesson_debt: "0",
    product_debt: "0",
    active_credit_value: "0",
    remaining_credits: "0",
    ...studentOverrides,
  });
  getStudentLessons.mockResolvedValue(lessons);
  getStudentPackages.mockResolvedValue(packages);
  getStudentProductSales.mockResolvedValue(sales);
  getStudentMovements.mockResolvedValue(movements);
}

describe("StudentProfilePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls all student detail APIs and renders student name", async () => {
    setupMocks();
    render(<StudentProfilePage studentId="1" onBack={() => {}} />);

    expect(await screen.findByText(/Test Student/i)).toBeInTheDocument();
    expect(getStudentById).toHaveBeenCalledWith("1");
    expect(getStudentLessons).toHaveBeenCalledWith("1");
    expect(getStudentPackages).toHaveBeenCalledWith("1");
    expect(getStudentProductSales).toHaveBeenCalledWith("1");
    expect(getStudentMovements).toHaveBeenCalledWith("1");
  });

  it("shows 'Toplam borç' on the status band when a completed lesson is unpaid", async () => {
    setupMocks({
      lessons: [
        {
          id: "l1", status: "completed", mode: "online",
          starts_at: "2026-05-01T10:00:00Z",
          price_snapshot: "300", discount_amount: "0", net_amount: "300",
          paid_amount: "0", remaining_receivable: "300", prepaid_package_id: null,
        },
      ],
    });
    render(<StudentProfilePage studentId="1" onBack={() => {}} />);
    await screen.findByText(/Test Student/i);
    expect(screen.getByText(/Toplam borç/i)).toBeInTheDocument();
  });

  it("shows 'Güncel' on the status band when there is no debt", async () => {
    setupMocks();
    render(<StudentProfilePage studentId="1" onBack={() => {}} />);
    await screen.findByText(/Test Student/i);
    expect(screen.getByText(/Güncel/i)).toBeInTheDocument();
  });

  it("does NOT render a 'Bakiye hareketleri' tab (v1 simplification)", async () => {
    setupMocks();
    render(<StudentProfilePage studentId="1" onBack={() => {}} />);
    await screen.findByText(/Test Student/i);
    expect(screen.queryByText(/bakiye hareketleri/i)).not.toBeInTheDocument();
  });

  it("renders A11 tabs (Özet/Dersler/Satışlar/Hareketler) with no Paket tab", async () => {
    setupMocks();
    render(<StudentProfilePage studentId="1" onBack={() => {}} />);
    await screen.findByText(/Test Student/i);
    const tablist = document.querySelector('.wp-tabs');
    expect(tablist).not.toBeNull();
    const labels = Array.from(tablist.querySelectorAll('.wp-tab .wp-tab-l')).map(el => el.textContent);
    expect(labels).toEqual(['Özet', 'Dersler', 'Satışlar', 'Hareketler']);
    expect(labels).not.toContain('Paket');
  });
});
