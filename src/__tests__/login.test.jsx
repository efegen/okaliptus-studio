/**
 * Frontend Smoke — LoginPage
 *
 * - Render: form alanları, autocomplete attribute'leri, logo
 * - Submit happy path: login() → onLogin(user) çağrılır
 * - Submit sad path: hata mesajı görünür, onLogin çağrılmaz
 * - Loading state: submit sırasında button "Giriş yapılıyor…"
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../api", () => ({
  login: vi.fn(),
}));

import { LoginPage } from "../login";
import { login as loginApi } from "../api";

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders form fields with iOS Keychain-friendly autocomplete attributes", () => {
    render(<LoginPage onLogin={() => {}} />);
    const username = screen.getByLabelText("Kullanıcı adı");
    const password = screen.getByLabelText("Şifre");
    expect(username).toHaveAttribute("autocomplete", "username");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByRole("button", { name: /giriş yap/i })).toBeInTheDocument();
  });

  it("submits credentials, calls onLogin with returned user on success", async () => {
    const user = { id: "1", username: "admin", displayName: "Admin" };
    loginApi.mockResolvedValueOnce(user);

    const onLogin = vi.fn();
    render(<LoginPage onLogin={onLogin} />);

    await userEvent.type(screen.getByLabelText("Kullanıcı adı"), "admin");
    await userEvent.type(screen.getByLabelText("Şifre"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: /giriş yap/i }));

    expect(loginApi).toHaveBeenCalledWith("admin", "secret123");
    expect(onLogin).toHaveBeenCalledWith(user);
  });

  it("shows error message on failed login, does not call onLogin", async () => {
    loginApi.mockRejectedValueOnce(new Error("Invalid"));

    const onLogin = vi.fn();
    render(<LoginPage onLogin={onLogin} />);

    await userEvent.type(screen.getByLabelText("Kullanıcı adı"), "admin");
    await userEvent.type(screen.getByLabelText("Şifre"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /giriş yap/i }));

    expect(await screen.findByText(/kullanıcı adı veya şifre hatalı/i)).toBeInTheDocument();
    expect(onLogin).not.toHaveBeenCalled();
  });

  it("disables submit button and shows loading text while pending", async () => {
    let resolveFn;
    loginApi.mockReturnValueOnce(new Promise(r => { resolveFn = r; }));

    render(<LoginPage onLogin={() => {}} />);
    await userEvent.type(screen.getByLabelText("Kullanıcı adı"), "admin");
    await userEvent.type(screen.getByLabelText("Şifre"), "secret");
    await userEvent.click(screen.getByRole("button", { name: /giriş yap/i }));

    const button = screen.getByRole("button", { name: /giriş yapılıyor/i });
    expect(button).toBeDisabled();

    resolveFn({ id: "1" });
    // Pending Promise resolved → setLoading(false) → "Giriş yap"a döner.
    // act() warning'ini önlemek için update'i bekle.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /giriş yap/i })).not.toBeDisabled();
    });
  });
});
