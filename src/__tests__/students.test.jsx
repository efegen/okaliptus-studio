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
  getStudentDeleteImpact: vi.fn(),
  getStudentsKpi: vi.fn(),
  createCashPayment: vi.fn(),
  createStudent: vi.fn(),
  updateStudent: vi.fn(),
  deleteStudent: vi.fn(),
  getStudentMovements: vi.fn(),
}));

import { StudentsPage } from "../students";
import { CurrentUserProvider } from "../currentUser";
import {
  getStudents,
  getStudentById,
  getStudentsKpi,
  updateStudent,
  deleteStudent,
  getStudentLessons,
  getStudentPackages,
  getStudentProductSales,
  getStudentDeleteImpact,
} from "../api";

// Etap 3: silme aksiyonu `useCan('students.delete')`'e bağlı → testler
// CurrentUserProvider ile rol vererek render eder. Varsayılan admin (silebilir).
function renderWithUser(ui, role = "admin") {
  return render(<CurrentUserProvider user={{ role }}>{ui}</CurrentUserProvider>);
}

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

    renderWithUser(<StudentsPage onOpenStudent={() => {}} />);

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

    renderWithUser(<StudentsPage onOpenStudent={() => {}} />);

    await screen.findByText(/Test Müşteri/i);
    // Yeni tasarım: açık borç "Açık borç" sütununda ve alt toplam çubuğunda
    // para olarak ("500 ₺") gösterilir. fmtTL(500) → "500 ₺".
    expect(screen.getAllByText(/500\s*₺/).length).toBeGreaterThan(0);
  });

  it("renders empty state when student list is empty", async () => {
    getStudents.mockResolvedValue([]);
    renderWithUser(<StudentsPage onOpenStudent={() => {}} />);
    // Liste boş — başlık veya empty hint render edilmiş, hata atmaz
    await screen.findAllByText(/öğrenci/i);
  });

  it("aktif öğrencinin kebab menüsünde sadece 'Pasife al' var, silme yok", async () => {
    getStudents.mockResolvedValue(oneStudent({ is_active: true }));
    renderWithUser(<StudentsPage onOpenStudent={() => {}} />);
    await screen.findByText(/Menü Kişi/i);

    fireEvent.click(screen.getByLabelText("İşlemler"));

    expect(screen.getByRole("menuitem", { name: "Pasife al" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Tamamen sil" })).not.toBeInTheDocument();
  });

  it("pasif öğrencinin menüsünde 'Tekrar aktif et' ve 'Tamamen sil' var", async () => {
    getStudents.mockResolvedValue(oneStudent({ is_active: false }));
    renderWithUser(<StudentsPage onOpenStudent={() => {}} />);
    await screen.findByText(/Menü Kişi/i);

    fireEvent.click(screen.getByLabelText("İşlemler"));

    expect(screen.getByRole("menuitem", { name: "Tekrar aktif et" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Tamamen sil" })).toBeInTheDocument();
  });

  it("asistan rolünde pasif öğrencide bile 'Tamamen sil' gösterilmez", async () => {
    getStudents.mockResolvedValue(oneStudent({ is_active: false }));
    renderWithUser(<StudentsPage onOpenStudent={() => {}} />, "assistant");
    await screen.findByText(/Menü Kişi/i);

    fireEvent.click(screen.getByLabelText("İşlemler"));

    // Pasife alma/aktifleştirme açık (update yetkisi), ama kalıcı silme yok.
    expect(screen.getByRole("menuitem", { name: "Tekrar aktif et" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Tamamen sil" })).not.toBeInTheDocument();
  });

  it("geçmişsiz öğrencide 'Kalıcı olarak sil' onay kutusu istemeden deleteStudent çağırır", async () => {
    getStudents.mockResolvedValue(oneStudent({ is_active: false }));
    getStudentDeleteImpact.mockResolvedValue({
      lessons: 0, prepaidPackages: 0, productSales: 0, payments: 0,
      eventParticipations: 0, eventPayments: 0, eventInteractions: 0,
      participantNotes: 0, noteMentions: 0, drivenVehicles: 0,
    });
    deleteStudent.mockResolvedValue({ id: "1" });
    renderWithUser(<StudentsPage onOpenStudent={() => {}} />);
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
    getStudentDeleteImpact.mockResolvedValue({
      lessons: 2, prepaidPackages: 0, productSales: 0, payments: 0,
      eventParticipations: 0, eventPayments: 0, eventInteractions: 0,
      participantNotes: 0, noteMentions: 0, drivenVehicles: 0,
    });
    deleteStudent.mockResolvedValue({ id: "1" });
    renderWithUser(<StudentsPage onOpenStudent={() => {}} />);
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

  it("yalnız etkinlik/not geçmişi olan öğrencide kapsamı gösterip onay ister", async () => {
    getStudents.mockResolvedValue(oneStudent({ is_active: false }));
    getStudentDeleteImpact.mockResolvedValue({
      lessons: 0, prepaidPackages: 0, productSales: 0, payments: 0,
      eventParticipations: 1, eventPayments: 1, eventInteractions: 2,
      participantNotes: 1, noteMentions: 1, drivenVehicles: 1,
    });
    renderWithUser(<StudentsPage onOpenStudent={() => {}} />);
    await screen.findByText(/Menü Kişi/i);

    fireEvent.click(screen.getByLabelText("İşlemler"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Tamamen sil" }));

    expect(await screen.findByText(/1 etkinlik katılımı/i)).toBeInTheDocument();
    expect(screen.getByText(/1 not bahsi/i)).toBeInTheDocument();
    expect(screen.getByText(/şoför bağlantıları anonimleştirilir/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kalıcı olarak sil" })).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  it("silme etkisi alınamazsa geçmişsiz varsaymayıp onay ister", async () => {
    getStudents.mockResolvedValue(oneStudent({ is_active: false }));
    getStudentDeleteImpact.mockRejectedValue(new Error("ağ hatası"));
    renderWithUser(<StudentsPage onOpenStudent={() => {}} />);
    await screen.findByText(/Menü Kişi/i);

    fireEvent.click(screen.getByLabelText("İşlemler"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Tamamen sil" }));

    expect(await screen.findByText(/Bağlı kayıtlar sayılamadı/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kalıcı olarak sil" })).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  it("borçsuz aktif öğrencinin menüsünde 'Ödeme al' gösterilmez", async () => {
    getStudents.mockResolvedValue(oneStudent({ is_active: true, lesson_debt: "0", product_debt: "0" }));
    renderWithUser(<StudentsPage onOpenStudent={() => {}} />);
    await screen.findByText(/Menü Kişi/i);

    fireEvent.click(screen.getByLabelText("İşlemler"));

    expect(screen.queryByRole("menuitem", { name: "Ödeme al" })).not.toBeInTheDocument();
  });

  it("kebab 'Düzenle' tam kaydı çekip düzenleme modalını açar ve updateStudent çağırır", async () => {
    getStudents.mockResolvedValue(oneStudent({ id: "1", full_name: "Menü Kişi", is_active: true }));
    getStudentById.mockResolvedValue({
      id: "1", full_name: "Menü Kişi", nickname: null, phone: null, email: null,
      birthday: null, joined_at: null, preferred_mode: null, note: null, is_active: true,
    });
    updateStudent.mockResolvedValue({ id: "1" });
    renderWithUser(<StudentsPage onOpenStudent={() => {}} />);
    await screen.findByText(/Menü Kişi/i);

    fireEvent.click(screen.getByLabelText("İşlemler"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Düzenle" }));

    // Liste satırında tüm alanlar yok → tam kayıt çekilir, modal açılır.
    await waitFor(() => expect(getStudentById).toHaveBeenCalledWith("1"));
    const saveBtn = await screen.findByRole("button", { name: "Kaydet" });

    fireEvent.change(screen.getByLabelText(/Ad Soyad/i), { target: { value: "Yeni Ad" } });
    fireEvent.click(saveBtn);

    await waitFor(() =>
      expect(updateStudent).toHaveBeenCalledWith("1", expect.objectContaining({ fullName: "Yeni Ad" })),
    );
  });
});
