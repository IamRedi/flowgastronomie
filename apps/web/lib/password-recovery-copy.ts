import type { Locale } from "./i18n";

const copy = {
  en: {
    title: "Recover your account",
    reset: "Choose a new password",
    email: "Email",
    password: "New password (12–128 characters)",
    confirm: "Confirm password",
    request: "Send recovery link",
    save: "Reset password",
    sent: "If an active account matches, a personal recovery link will arrive by email. Check your spam folder too.",
    done: "Password updated. Sign in again with your new password.",
    error: "Could not complete the request. Try again later.",
    invalid:
      "This link is invalid, expired or already used. Request a new recovery email.",
    mismatch: "The passwords must match.",
    login: "Back to sign in",
    forgot: "Forgot your password?",
  },
  sq: {
    title: "Rikupero llogarinë",
    reset: "Zgjidh një fjalëkalim të ri",
    email: "Email",
    password: "Fjalëkalimi i ri (12–128 karaktere)",
    confirm: "Konfirmo fjalëkalimin",
    request: "Dërgo lidhjen e rikuperimit",
    save: "Rivendos fjalëkalimin",
    sent: "Nëse ka një llogari aktive me këtë email, do të marrësh lidhjen personale të rikuperimit. Kontrollo edhe spam-in.",
    done: "Fjalëkalimi u ndryshua. Hyr sërish me fjalëkalimin e ri.",
    error: "Kërkesa nuk u përfundua. Riprovo më vonë.",
    invalid:
      "Kjo lidhje është e pavlefshme, ka skaduar ose është përdorur. Kërko një email të ri rikuperimi.",
    mismatch: "Fjalëkalimet duhet të jenë të njëjta.",
    login: "Kthehu te hyrja",
    forgot: "Ke harruar fjalëkalimin?",
  },
  de: {
    title: "Konto wiederherstellen",
    reset: "Neues Passwort wählen",
    email: "E-Mail",
    password: "Neues Passwort (12–128 Zeichen)",
    confirm: "Passwort bestätigen",
    request: "Wiederherstellungslink senden",
    save: "Passwort zurücksetzen",
    sent: "Falls ein aktives Konto vorhanden ist, erhalten Sie einen persönlichen Link per E-Mail. Prüfen Sie auch den Spam-Ordner.",
    done: "Passwort geändert. Melden Sie sich mit Ihrem neuen Passwort an.",
    error:
      "Die Anfrage konnte nicht abgeschlossen werden. Versuchen Sie es später erneut.",
    invalid:
      "Dieser Link ist ungültig, abgelaufen oder bereits verwendet. Fordern Sie eine neue E-Mail an.",
    mismatch: "Die Passwörter müssen übereinstimmen.",
    login: "Zur Anmeldung",
    forgot: "Passwort vergessen?",
  },
  it: {
    title: "Recupera il tuo account",
    reset: "Scegli una nuova password",
    email: "Email",
    password: "Nuova password (12–128 caratteri)",
    confirm: "Conferma password",
    request: "Invia link di recupero",
    save: "Reimposta password",
    sent: "Se esiste un account attivo, riceverai un link personale via email. Controlla anche lo spam.",
    done: "Password aggiornata. Accedi con la nuova password.",
    error: "Impossibile completare la richiesta. Riprova più tardi.",
    invalid:
      "Questo link non è valido, è scaduto o è già stato usato. Richiedi una nuova email.",
    mismatch: "Le password devono coincidere.",
    login: "Torna all’accesso",
    forgot: "Password dimenticata?",
  },
};
export const passwordRecoveryCopy = (locale: Locale) => copy[locale];
