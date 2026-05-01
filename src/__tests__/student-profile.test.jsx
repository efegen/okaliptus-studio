/**
 * Frontend Smoke — StudentProfilePage
 *
 * - Render: API çağrıları yapılır, öğrenci ismi ekrana basılır
 * - FinanceStrip: net borç > 0 → "borç" görünür, =0 → "Güncel" / "Borç yok"
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

  it("shows debt headline when lesson_debt > 0", async () => {
    setupMocks({ studentOverrides: { lesson_debt: "300" } });
    render(<StudentProfilePage studentId="1" onBack={() => {}} />);
    await screen.findByText(/Test Student/i);
    expect(screen.getByText(/borç/i)).toBeInTheDocument();
  });

  it("does NOT render a 'Bakiye hareketleri' tab (v1 simplification)", async () => {
    setupMocks();
    render(<StudentProfilePage studentId="1" onBack={() => {}} />);
    await screen.findByText(/Test Student/i);
    expect(screen.queryByText(/bakiye hareketleri/i)).not.toBeInTheDocument();
  });

  it("renders Paket as a top-level tab next to Kayıtlar/Dersler/Ürün Satışı/Hareketler", async () => {
    setupMocks();
    render(<StudentProfilePage studentId="1" onBack={() => {}} />);
    await screen.findByText(/Test Student/i);
    const tablist = document.querySelector('.sp-tabs');
    expect(tablist).not.toBeNull();
    const labels = Array.from(tablist.querySelectorAll('.sp-tab > span:first-child')).map(el => el.textContent);
    expect(labels).toEqual(['Kayıtlar', 'Dersler', 'Ürün Satışı', 'Paket', 'Hareketler']);
  });
});
