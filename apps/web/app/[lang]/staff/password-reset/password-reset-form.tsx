"use client";
import { useEffect, useState, type FormEvent } from "react";
import { passwordRecoveryCopy } from "../../../../lib/password-recovery-copy";
import type { Locale } from "../../../../lib/i18n";

export function PasswordResetForm({ locale }: { locale: Locale }) {
  const c = passwordRecoveryCopy(locale);
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    const readProof = () => {
      // Fragment credentials never reach access logs or Referer headers.
      const value = window.location.hash.slice(1);
      if (value) {
        window.history.replaceState(null, "", window.location.pathname);
        if (/^[A-Za-z0-9_-]{43}$/.test(value)) {
          setToken(value);
          setDone(false);
          setMessage("");
        } else {
          setMessage(c.invalid);
          setDone(true);
        }
      }
      setReady(true);
    };
    readProof();
    window.addEventListener("hashchange", readProof);
    return () => window.removeEventListener("hashchange", readProof);
  }, [c.invalid]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !ready) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    if (token && fields.get("newPassword") !== fields.get("confirm")) {
      setMessage(c.mismatch);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `${(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "")}/v1/auth/password-reset/${token ? "complete" : "request"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(
            token
              ? { token, newPassword: fields.get("newPassword") }
              : { email: fields.get("email"), locale },
          ),
        },
      );
      if (!response.ok) {
        setMessage(token && response.status === 400 ? c.invalid : c.error);
        return;
      }
      setMessage(token ? c.done : c.sent);
      setDone(true);
      setToken("");
      form.reset();
    } catch {
      setMessage(c.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h1>{token ? c.reset : c.title}</h1>
      <form className="staff-login-form" onSubmit={submit}>
        {!done && (
          <>
            {token ? (
              <>
                <label>
                  {c.password}
                  <input
                    name="newPassword"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    required
                  />
                </label>
                <label>
                  {c.confirm}
                  <input
                    name="confirm"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    required
                  />
                </label>
              </>
            ) : (
              <label>
                {c.email}
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  required
                />
              </label>
            )}
            <button type="submit" disabled={busy || !ready}>
              {token ? c.save : c.request}
            </button>
          </>
        )}
        {message && <p role="status">{message}</p>}
        {done && <a href={`/${locale}/staff/password-reset`}>{c.request}</a>}
        <a href={`/${locale}/staff/login`}>{c.login}</a>
      </form>
    </>
  );
}
