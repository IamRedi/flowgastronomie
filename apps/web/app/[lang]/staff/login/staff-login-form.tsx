"use client";
import { passwordRecoveryCopy } from "../../../../lib/password-recovery-copy";

import { useEffect, useState, type FormEvent } from "react";

import { staffEntryPath, type StaffRole } from "@flowgastronomie/domain";

import type { Dictionary } from "../../../../lib/dictionaries";

import type { Locale } from "../../../../lib/i18n";

const copy = {
  sq: {
    show: "Shfaq fjalëkalimin",
    hide: "Fshih fjalëkalimin",
    choose: "Zgjidh biznesin ku dëshiron të hysh",
    signup: "Krijo biznes",
  },
  de: {
    show: "Passwort anzeigen",
    hide: "Passwort ausblenden",
    choose: "Betrieb auswählen",
    signup: "Betrieb erstellen",
  },
  en: {
    show: "Show password",
    hide: "Hide password",
    choose: "Choose your business",
    signup: "Create business",
  },
  it: {
    show: "Mostra password",
    hide: "Nascondi password",
    choose: "Scegli attività",
    signup: "Crea attività",
  },
};

type Choice = {
  id: string;
  organization: string;
  venue: string;
  role: StaffRole;
};

export function StaffLoginForm({
  labels,
  locale,
}: {
  labels: Dictionary["staff"];
  locale: Locale;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    [hydrated, setHydrated] = useState(false),
    [visible, setVisible] = useState(false),
    [choices, setChoices] = useState<Choice[]>([]);

  const words = copy[locale];
  const api =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";

  const finish = (result: {
    staff?: { role: StaffRole };
    choices?: Choice[];
  }) => {
    if (result.staff)
      window.location.assign(
        staffEntryPath(
          result.staff.role,
          locale,
          new URLSearchParams(window.location.search).get("next"),
        ),
      );
    else setChoices(result.choices ?? []);
  };

  useEffect(() => {
    setHydrated(true);
    void fetch(`${api}/v1/auth/choices`, {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (r) => {
        if (r.ok) setChoices((await r.json()).choices);
      })
      .catch(() => {});
  }, [api]);

  async function send(path: string, body: unknown) {
    setBusy(true);
    setError(false);
    try {
      const r = await fetch(`${api}/v1/auth/${path}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw Error();
      finish(await r.json());
    } catch {
      setError(true);
      setChoices([]);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await send("login", {
      email: form.get("email"),
      password: form.get("password"),
    });
  }

  return (
    <form className="staff-login-form" method="post" onSubmit={submit}>
      {choices.length ? (
        <fieldset disabled={busy}>
          <legend>{words.choose}</legend>
          {choices.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => send("select", { membershipId: c.id })}
            >
              {c.venue}
              <small>
                {c.organization} ? {c.role}
              </small>
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setChoices([]);
              setError(false);
            }}
          >
            {labels.email}
          </button>
        </fieldset>
      ) : (
        <>
          <label>
            <span>{labels.email}</span>
            <input autoComplete="username" name="email" required type="email" />
          </label>

          <label>
            <span>{labels.password}</span>
            <input
              autoComplete="current-password"
              minLength={8}
              maxLength={128}
              name="password"
              required
              type={visible ? "text" : "password"}
            />
          </label>

          <button
            className="login-password-toggle"
            type="button"
            aria-pressed={visible}
            onClick={() => setVisible(!visible)}
          >
            {visible ? words.hide : words.show}
          </button>

          {error && <p role="alert">{labels.loginError}</p>}

          <button disabled={busy || !hydrated} type="submit">
            {busy ? labels.signingIn : labels.signIn}
          </button>
        </>
      )}
      {choices.length > 0 && error && <p role="alert">{labels.loginError}</p>}

      <a href={`/${locale}/signup`}>{words.signup}</a>
      <a href={`/${locale}/staff/password-reset`}>
        {passwordRecoveryCopy(locale).forgot}
      </a>
    </form>
  );
}
