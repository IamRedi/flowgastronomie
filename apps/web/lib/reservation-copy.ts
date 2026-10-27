import type { Locale } from "./i18n";

type ReservationSettingsCopy = {
  title: string;
  description: string;
  loading: string;
  loadError: string;
  autoConfirm: string;
  enabled: string;
  disabled: string;
  save: string;
  saved: string;
  saveError: string;
  back: string;
};

export const reservationSettingsCopy: Record<Locale, ReservationSettingsCopy> =
  {
    en: {
      title: "Reservation settings",
      description:
        "Automatically confirm new requests only when opening hours and capacity allow it.",
      loading: "Loading reservation settings…",
      loadError: "Reservation settings could not be loaded.",
      autoConfirm: "Automatically confirm available reservations",
      enabled: "Enabled",
      disabled: "Disabled",
      save: "Save changes",
      saved: "Reservation settings saved.",
      saveError: "Reservation settings could not be saved.",
      back: "Back to business overview",
    },
    de: {
      title: "Reservierungseinstellungen",
      description:
        "Neue Anfragen nur automatisch bestätigen, wenn Öffnungszeiten und Kapazität es erlauben.",
      loading: "Reservierungseinstellungen werden geladen…",
      loadError: "Reservierungseinstellungen konnten nicht geladen werden.",
      autoConfirm: "Verfügbare Reservierungen automatisch bestätigen",
      enabled: "Aktiviert",
      disabled: "Deaktiviert",
      save: "Änderungen speichern",
      saved: "Reservierungseinstellungen gespeichert.",
      saveError: "Reservierungseinstellungen konnten nicht gespeichert werden.",
      back: "Zurück zur Business-Übersicht",
    },
    it: {
      title: "Impostazioni prenotazioni",
      description:
        "Conferma automaticamente le nuove richieste solo quando orari e capacità lo consentono.",
      loading: "Caricamento impostazioni prenotazioni…",
      loadError: "Impossibile caricare le impostazioni delle prenotazioni.",
      autoConfirm: "Conferma automaticamente le prenotazioni disponibili",
      enabled: "Attivato",
      disabled: "Disattivato",
      save: "Salva modifiche",
      saved: "Impostazioni delle prenotazioni salvate.",
      saveError: "Impossibile salvare le impostazioni delle prenotazioni.",
      back: "Torna alla panoramica aziendale",
    },
    sq: {
      title: "Cilësimet e rezervimeve",
      description:
        "Konfirmo automatikisht kërkesat e reja vetëm kur orari dhe kapaciteti e lejojnë.",
      loading: "Po ngarkohen cilësimet e rezervimeve…",
      loadError: "Cilësimet e rezervimeve nuk u ngarkuan.",
      autoConfirm: "Konfirmo automatikisht rezervimet e mundshme",
      enabled: "Aktivizuar",
      disabled: "Çaktivizuar",
      save: "Ruaj ndryshimet",
      saved: "Cilësimet e rezervimeve u ruajtën.",
      saveError: "Cilësimet e rezervimeve nuk u ruajtën.",
      back: "Kthehu te përmbledhja e biznesit",
    },
  };

type ReservationRequestCopy = {
  back: string;
  title: string;
  name: string;
  phone: string;
  email: string;
  requestedFor: string;
  partySize: string;
  notes: string;
  submit: string;
  submitted: string;
  error: string;
  whatsapp: string;
};

export const reservationRequestCopy: Record<Locale, ReservationRequestCopy> = {
  en: {
    back: "Back to restaurant",
    title: "Request a table",
    name: "Name",
    phone: "Phone",
    email: "Email (optional)",
    requestedFor: "Preferred date and time",
    partySize: "Number of guests",
    notes: "Notes (optional)",
    submit: "Send request",
    submitted: "Your request awaits confirmation.",
    error:
      "Your request could not be sent. Please check the details and try again.",
    whatsapp: "Contact us on WhatsApp",
  },
  de: {
    back: "Zurück zum Restaurant",
    title: "Tisch anfragen",
    name: "Name",
    phone: "Telefon",
    email: "E-Mail (optional)",
    requestedFor: "Gewünschtes Datum und Uhrzeit",
    partySize: "Anzahl der Gäste",
    notes: "Hinweise (optional)",
    submit: "Anfrage senden",
    submitted: "Ihre Anfrage wartet auf Bestätigung.",
    error:
      "Ihre Anfrage konnte nicht gesendet werden. Bitte prüfen Sie die Angaben und versuchen Sie es erneut.",
    whatsapp: "Über WhatsApp kontaktieren",
  },
  it: {
    back: "Torna al ristorante",
    title: "Richiedi un tavolo",
    name: "Nome",
    phone: "Telefono",
    email: "Email (facoltativa)",
    requestedFor: "Data e ora preferite",
    partySize: "Numero di persone",
    notes: "Note (facoltative)",
    submit: "Invia richiesta",
    submitted: "La tua richiesta è in attesa di conferma.",
    error: "Impossibile inviare la richiesta. Controlla i dati e riprova.",
    whatsapp: "Contattaci su WhatsApp",
  },
  sq: {
    back: "Kthehu te restoranti",
    title: "Kërko një tavolinë",
    name: "Emri",
    phone: "Telefoni",
    email: "Email (opsionale)",
    requestedFor: "Data dhe ora e preferuar",
    partySize: "Numri i personave",
    notes: "Shënime (opsionale)",
    submit: "Dërgo kërkesën",
    submitted: "Kërkesa jote është në pritje të konfirmimit.",
    error: "Kërkesa nuk u dërgua. Kontrollo të dhënat dhe provo përsëri.",
    whatsapp: "Na kontakto në WhatsApp",
  },
};
