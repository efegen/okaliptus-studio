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
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../api", () => ({
  getStudents: vi.fn(),
  getStudentById: vi.fn(),
  getStudentLessons: vi.fn(),
  getStudentPackages: vi.fn(),
  getStudentProductSales: vi.fn(),
  getStudentsKpi: vi.fn(),
  createCashPayment: vi.fn(),
  createStudent: vi.fn(),
  updateStudent: vi.fn(),
  deleteStudent: vi.fn(),
  getStudentMovements: vi.fn(),
}));

import { StudentsPage } from "../students";
import {
  getStudents,
  getStudentsKpi,
  updateStudent,
  deleteStudent,
  getStudentLessons,
  getStudentPackages,
  getStudentProductSales,
} from "../api";

// Tek satırlık öğrenci listesi kurar; overrides ile alanlar ezilir.
function oneStudent(overrides = {}) {
  return [{
    id: "1",
    full_name: "Menü Kişi",
    is_active: true,
    lesson_debt: "0",
    product_debt: "0",
    active_credit_value: "0",
    remaining_credits: "0",
    last_lesson_at: null,
    lessons_last_30_days: "0",
    ...overrides,
  }];
}

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
        full_name: "Test Müşteri",
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

    await screen.findByText(/Test Müşteri/i);
    // Asıl borç badge'i: "500 ₺ borç" — KPI label "Borçlu öğrenci" /
    // sub "Toplam borç" gibi diğer "borç" geçen düğümlerden ayrıştırmak için
    // money + word kombinasyonu.
    expect(screen.getByText(/500.*₺.*borç/i)).toBeInTheDocument();
  });

  it("renders empty state when student list is empty", async () => {
    getStudents.mockResolvedValue([]);
    render(<StudentsPage onOpenStudent={() => {}} />);
    // Liste boş — başlık veya empty hint render edilmiş, hata atmaz
    await screen.findAllByText(/öğrenci/i);
  });

  it("aktif öğrencinin kebab menüsünde sadece 'Pasife al' var, silme yok", async () => {
    getStudents.mockResolvedValue(oneStudent({ is_active: true }));
    render(<StudentsPage onOpenStudent={() => {}} />);
    await screen.findByText(/Menü Kişi/i);

    fireEvent.click(screen.getByLabelText("İşlemler"));

    expect(screen.getByRole("menuitem", { name: "Pasife al" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Tamamen sil" })).not.toBeInTheDocument();
  });

  it("pasif öğrencinin menüsünde 'Tekrar aktif et' ve 'Tamamen sil' var", async () => {
    getStudents.mockResolvedValue(oneStudent({ is_active: false }));
    render(<StudentsPage onOpenStudent={() => {}} />);
    await screen.findByText(/Menü Kişi/i);

    fireEvent.click(screen.getByLabelText("İşlemler"));

    expect(screen.getByRole("menuitem", { name: "Tekrar aktif et" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Tamamen sil" })).toBeInTheDocument();
  });

  it("geçmişsiz öğrencide 'Kalıcı olarak sil' onay kutusu istemeden deleteStudent çağırır", async () => {
    getStudents.mockResolvedValue(oneStudent({ is_active: false }));
    getStudentLessons.mockResolvedValue([]);
    getStudentPackages.mockResolvedValue([]);
    getStudentProductSales.mockResolvedValue([]);
    deleteStudent.mockResolvedValue({ id: "1" });
    render(<StudentsPage onOpenStudent={() => {}} />);
    await screen.findByText(/Menü Kişi/i);

    fireEvent.click(screen.getByLabelText("İşlemler"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Tamamen sil" }));

    // Onay modalı açıldı; impact yüklenince (geçmiş yok) buton aktifleşir.
    const confirmBtn = await screen.findByRole("button", { name: "Kalıcı olarak sil" });
    await waitFor(() => expect(confirmBtn).not.toBeDisabled());
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(deleteStudent).toHaveBeenCalledWith("1"));
  });

  it("geçmişi olan öğrencide silme onay kutusu işaretlenene kadar kilitli", async () => {
    getStudents.mockResolvedValue(oneStudent({ is_active: false }));
    getStudentLessons.mockResolvedValue([{ id: "9" }, { id: "10" }]); // 2 ders
    getStudentPackages.mockResolvedValue([]);
    getStudentProductSales.mockResolvedValue([]);
    deleteStudent.mockResolvedValue({ id: "1" });
    render(<StudentsPage onOpenStudent={() => {}} />);
    await screen.findByText(/Menü Kişi/i);

    fireEvent.click(screen.getByLabelText("İşlemler"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Tamamen sil" }));

    const confirmBtn = await screen.findByRole("button", { name: "Kalıcı olarak sil" });
    // Geçmiş var → onay kutusu gelene kadar buton kilitli
    const ack = await screen.findByRole("checkbox");
    await waitFor(() => expect(confirmBtn).toBeDisabled());

    fireEvent.click(ack);
    await waitFor(() => expect(confirmBtn).not.toBeDisabled());
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(deleteStudent).toHaveBeenCalledWith("1"));
  });

  it("borçsuz aktif öğrencinin menüsünde 'Ödeme al' gösterilmez", async () => {
    getStudents.mockResolvedValue(oneStudent({ is_active: true, lesson_debt: "0", product_debt: "0" }));
    render(<StudentsPage onOpenStudent={() => {}} />);
    await screen.findByText(/Menü Kişi/i);

    fireEvent.click(screen.getByLabelText("İşlemler"));

    expect(screen.queryByRole("menuitem", { name: "Ödeme al" })).not.toBeInTheDocument();
  });
});
