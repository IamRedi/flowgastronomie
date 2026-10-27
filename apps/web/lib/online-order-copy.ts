import type { Locale } from "./i18n";

export const ONLINE_ORDER_STATUSES = [
  "PENDING_CONFIRMATION",
  "ACCEPTED",
  "PREPARING",
  "READY",
  "OUT_FOR_DELIVERY",
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
] as const;

export type OnlineOrderStatus = (typeof ONLINE_ORDER_STATUSES)[number];

export const ONLINE_FULFILLMENT_TYPES = [
  "PICKUP",
  "DELIVERY",
  "CATERING",
] as const;

export type OnlineFulfillmentType = (typeof ONLINE_FULFILLMENT_TYPES)[number];

export const onlineOrderStatusLabels: Record<
  Locale,
  Record<OnlineOrderStatus, string>
> = {
  sq: {
    PENDING_CONFIRMATION: "Në pritje të konfirmimit",
    ACCEPTED: "Pranuar",
    PREPARING: "Në përgatitje",
    READY: "Gati",
    OUT_FOR_DELIVERY: "Në dërgesë",
    COMPLETED: "Përfunduar",
    REJECTED: "Refuzuar",
    CANCELLED: "Anuluar",
  },
  en: {
    PENDING_CONFIRMATION: "Awaiting confirmation",
    ACCEPTED: "Accepted",
    PREPARING: "Preparing",
    READY: "Ready",
    OUT_FOR_DELIVERY: "Out for delivery",
    COMPLETED: "Completed",
    REJECTED: "Rejected",
    CANCELLED: "Cancelled",
  },
  de: {
    PENDING_CONFIRMATION: "Wartet auf Bestätigung",
    ACCEPTED: "Angenommen",
    PREPARING: "In Zubereitung",
    READY: "Bereit",
    OUT_FOR_DELIVERY: "In Zustellung",
    COMPLETED: "Abgeschlossen",
    REJECTED: "Abgelehnt",
    CANCELLED: "Storniert",
  },
  it: {
    PENDING_CONFIRMATION: "In attesa di conferma",
    ACCEPTED: "Accettato",
    PREPARING: "In preparazione",
    READY: "Pronto",
    OUT_FOR_DELIVERY: "In consegna",
    COMPLETED: "Completato",
    REJECTED: "Rifiutato",
    CANCELLED: "Annullato",
  },
};

export const onlineFulfillmentLabels: Record<
  Locale,
  Record<OnlineFulfillmentType, string>
> = {
  sq: { PICKUP: "Marrje në lokal", DELIVERY: "Dërgesë", CATERING: "Catering" },
  en: { PICKUP: "Pickup", DELIVERY: "Delivery", CATERING: "Catering" },
  de: { PICKUP: "Abholung", DELIVERY: "Lieferung", CATERING: "Catering" },
  it: { PICKUP: "Ritiro", DELIVERY: "Consegna", CATERING: "Catering" },
};

type DeliveryZoneCopy = {
  title: string;
  loading: string;
  loadError: string;
  name: string;
  prefixes: string;
  fee: string;
  minimum: string;
  add: string;
  saved: string;
  saveError: string;
  active: string;
  inactive: string;
  minimumShort: string;
};

export const deliveryZoneCopy: Record<Locale, DeliveryZoneCopy> = {
  sq: {
    title: "Zonat e dërgesës",
    loading: "Po ngarkohen zonat…",
    loadError: "Zonat e dërgesës nuk u ngarkuan.",
    name: "Emri i zonës",
    prefixes: "Prefikset postare, p.sh. 80, 81",
    fee: "Tarifa (EUR)",
    minimum: "Porosia minimale (EUR)",
    add: "Shto zonën",
    saved: "Zona u ruajt.",
    saveError: "Zona nuk u ruajt.",
    active: "Aktive",
    inactive: "Jo aktive",
    minimumShort: "minimumi",
  },
  en: {
    title: "Delivery zones",
    loading: "Loading delivery zones…",
    loadError: "Delivery zones could not be loaded.",
    name: "Zone name",
    prefixes: "Postal prefixes, e.g. 80, 81",
    fee: "Delivery fee (EUR)",
    minimum: "Minimum order (EUR)",
    add: "Add zone",
    saved: "Zone saved.",
    saveError: "Zone could not be saved.",
    active: "Active",
    inactive: "Inactive",
    minimumShort: "minimum",
  },
  de: {
    title: "Lieferzonen",
    loading: "Lieferzonen werden geladen…",
    loadError: "Lieferzonen konnten nicht geladen werden.",
    name: "Name der Zone",
    prefixes: "Postleitzahl-Präfixe, z. B. 80, 81",
    fee: "Liefergebühr (EUR)",
    minimum: "Mindestbestellwert (EUR)",
    add: "Zone hinzufügen",
    saved: "Zone gespeichert.",
    saveError: "Zone konnte nicht gespeichert werden.",
    active: "Aktiv",
    inactive: "Inaktiv",
    minimumShort: "Minimum",
  },
  it: {
    title: "Zone di consegna",
    loading: "Caricamento zone di consegna…",
    loadError: "Impossibile caricare le zone di consegna.",
    name: "Nome della zona",
    prefixes: "Prefissi postali, es. 80, 81",
    fee: "Costo di consegna (EUR)",
    minimum: "Ordine minimo (EUR)",
    add: "Aggiungi zona",
    saved: "Zona salvata.",
    saveError: "Impossibile salvare la zona.",
    active: "Attiva",
    inactive: "Non attiva",
    minimumShort: "minimo",
  },
};

type OnlineOrderSettingsCopy = {
  title: string;
  loading: string;
  loadError: string;
  pickup: string;
  delivery: string;
  catering: string;
  active: string;
  inactive: string;
  save: string;
  saved: string;
  saveError: string;
};

export const onlineOrderSettingsCopy: Record<Locale, OnlineOrderSettingsCopy> =
  {
    sq: {
      title: "Kanalet e porosive online",
      loading: "Po ngarkohen kanalet…",
      loadError: "Kanalet e porosive nuk u ngarkuan.",
      pickup: "Marrje në lokal",
      delivery: "Dërgesë",
      catering: "Catering",
      active: "Aktiv",
      inactive: "Jo aktiv",
      save: "Ruaj ndryshimet",
      saved: "Ndryshimet u ruajtën.",
      saveError: "Ndryshimet nuk u ruajtën.",
    },
    en: {
      title: "Online order channels",
      loading: "Loading order channels…",
      loadError: "Order channels could not be loaded.",
      pickup: "Pickup",
      delivery: "Delivery",
      catering: "Catering",
      active: "Active",
      inactive: "Inactive",
      save: "Save changes",
      saved: "Changes saved.",
      saveError: "Changes could not be saved.",
    },
    de: {
      title: "Online-Bestellkanäle",
      loading: "Bestellkanäle werden geladen…",
      loadError: "Bestellkanäle konnten nicht geladen werden.",
      pickup: "Abholung",
      delivery: "Lieferung",
      catering: "Catering",
      active: "Aktiv",
      inactive: "Inaktiv",
      save: "Änderungen speichern",
      saved: "Änderungen gespeichert.",
      saveError: "Änderungen konnten nicht gespeichert werden.",
    },
    it: {
      title: "Canali degli ordini online",
      loading: "Caricamento canali…",
      loadError: "Impossibile caricare i canali degli ordini.",
      pickup: "Ritiro",
      delivery: "Consegna",
      catering: "Catering",
      active: "Attivo",
      inactive: "Non attivo",
      save: "Salva modifiche",
      saved: "Modifiche salvate.",
      saveError: "Impossibile salvare le modifiche.",
    },
  };
