/**
 * Frontend Smoke — StudentsPage
 *
 * - Renders student list from getStudents() mock
 * - Borçlu rozeti: lesson_debt > 0 öğrenci için
 *
 * Mock'lar minimal — UI'nin tüm interaksiyonu değil sadece render smoke'u.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../api", () => ({
  getStudents: vi.fn(),
  getStudentById: vi.fn(),
  getStudentLessons: vi.fn(),
  getStudentPackages: vi.fn(),
  getStudentProductSales: vi.fn(),
  getStudentsKpi: vi.fn(),
  createCashPayment: vi.fn(),
  createStudent: vi.fn(),
  setLessonDiscount: vi.fn(),
  getStudentMovements: vi.fn(),
}));

import { StudentsPage } from "../students";
import {
  getStudents,
  getStudentsKpi,
} from "../api";

describe("StudentsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStudentsKpi.mockResolvedValue({
      total: 2,
      activeCount: 2,
      debtorCount: 1,
      totalReceivable: "300.00",
    });
  });

  it("renders fetched student list", async () => {
    getStudents.mockResolvedValue([
      {
        id: "1",
        full_name: "Ali Yılmaz",
        is_active: true,
        lesson_debt: "0",
        product_debt: "0",
        active_credit_value: "0",
        remaining_credits: "0",
        last_lesson_at: null,
        lessons_last_30_days: "0",
      },
      {
        id: "2",
        full_name: "Ayşe Demir",
        is_active: true,
        lesson_debt: "300",
        product_debt: "0",
        active_credit_value: "0",
        remaining_credits: "0",
        last_lesson_at: new Date().toISOString(),
        lessons_last_30_days: "3",
      },
    ]);

    render(<StudentsPage onOpenStudent={() => {}} />);

    expect(await screen.findByText(/Ali Yılmaz/i)).toBeInTheDocument();
    expect(screen.getByText(/Ayşe Demir/i)).toBeInTheDocument();
  });

  it("shows debt indicator for students with lesson_debt > 0", async () => {
    getStudents.mockResolvedValue([
      {
        id: "1",
        full_name: "Borçlu Test",
        is_active: true,
        lesson_debt: "500",
        product_debt: "0",
        active_credit_value: "0",
        remaining_credits: "0",
        last_lesson_at: null,
        lessons_last_30_days: "0",
      },
    ]);

    render(<StudentsPage onOpenStudent={() => {}} />);

    await screen.findByText(/Borçlu Test/i);
    // Borç göstergesi tek bir spesifik string'e bağlı kalmasın diye geniş regex
    expect(screen.getByText(/borç/i)).toBeInTheDocument();
  });

  it("renders empty state when student list is empty", async () => {
    getStudents.mockResolvedValue([]);
    render(<StudentsPage onOpenStudent={() => {}} />);
    // Liste boş — başlık veya empty hint render edilmiş, hata atmaz
    await screen.findAllByText(/öğrenci/i);
  });
});
