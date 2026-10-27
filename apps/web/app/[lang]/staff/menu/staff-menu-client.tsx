"use client";
import {
  ProductMedia,
  TableSetting,
} from "../../../../components/product-media";
import { ProductPhotoEditor } from "../../../../components/product-photo-editor";
import { productPhotoCopy } from "../../../../components/product-photo-copy";
import type { CanonicalMediaReference } from "@flowgastronomie/domain";
import "../../../../components/product-catalog.css";
import { PosActivation } from "../../../../components/pos-activation";

import {
  PLATFORM_LOCALES,
  type MenuModifierGroupConfiguration,
  type MenuModifierOptionConfiguration,
  type MenuVariantConfiguration,
  type StaffRole,
} from "@flowgastronomie/domain";
import { useCallback, useEffect, useState } from "react";

import { OwnerSetupLinks } from "../../../../components/owner-setup-links";
import type { Dictionary } from "../../../../lib/dictionaries";
import type { Locale } from "../../../../lib/i18n";
import { pilotText } from "../../../../lib/pilot-copy";

type Translation = {
  locale: Locale;
  name: string;
  description?: string | null;
};

type MenuProduct = {
  id: string;
  categoryId: string;
  priceMinor: number;
  currency: string;
  sortOrder: number;
  available: boolean;
  published: boolean;
  station: "BAR" | "KITCHEN" | "DESSERT";
  translations: Translation[];
  allergens: string[];
  variantCount: number;
  modifierGroupCount: number;
};

type MenuCategory = {
  id: string;
  sortOrder: number;
  published: boolean;
  translations: Translation[];
  products: MenuProduct[];
};

type StaffMenu = {
  venue: { id: string; name: string; currency: string };
  categories: MenuCategory[];
};

type Staff = { displayName: string; venueName: string; role: StaffRole };

type ProductConfiguration = {
  productId: string;
  basePriceMinor: number;
  variants: MenuVariantConfiguration[];
  modifierGroups: MenuModifierGroupConfiguration[];
};

function translationName(translations: Translation[], locale: Locale): string {
  return (
    translations.find((translation) => translation.locale === locale)?.name ??
    translations[0]?.name ??
    "—"
  );
}

function translationValue(
  translations: Translation[],
  locale: Locale,
  field: "name" | "description",
): string {
  const translation = translations.find((entry) => entry.locale === locale);
  return field === "name"
    ? (translation?.name ?? "")
    : (translation?.description ?? "");
}

function priceLabel(amount: number, currency: string, locale: Locale) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(amount / 100);
}

export function StaffMenuClient({
  locale,
  labels,
}: {
  locale: Locale;
  labels: Dictionary["menuAdmin"];
  staffLabels: Dictionary["staff"];
}) {
  const c = productPhotoCopy(locale);
  const [photos, setPhotos] = useState<Record<string, CanonicalMediaReference>>(
    {},
  );
  const [photoProduct, setPhotoProduct] = useState<{
    product: MenuProduct;
    category: string;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [menu, setMenu] = useState<StaffMenu | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editingProduct, setEditingProduct] = useState<string | null>(null);
  const [configuration, setConfiguration] =
    useState<ProductConfiguration | null>(null);
  const [configurationProduct, setConfigurationProduct] =
    useState<MenuProduct | null>(null);
  const [configurationLoading, setConfigurationLoading] = useState(false);
  const [feedback, setFeedback] = useState<"success" | "error" | null>(null);
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";

  const goToLogin = useCallback(() => {
    window.location.assign(
      `/${locale}/staff/login?next=${encodeURIComponent(window.location.pathname)}`,
    );
  }, [locale]);

  const loadMenu = useCallback(async () => {
    const [identityResponse, menuResponse, mediaResponse] = await Promise.all([
      fetch(`${apiUrl}/v1/staff/me`, { credentials: "include" }),
      fetch(`${apiUrl}/v1/staff/menu`, {
        cache: "no-store",
        credentials: "include",
      }),
      fetch(`${apiUrl}/v1/workspace/media`, {
        cache: "no-store",
        credentials: "include",
      }),
    ]);
    if (identityResponse.status === 401 || menuResponse.status === 401) {
      goToLogin();
      return;
    }
    if (identityResponse.ok) {
      const identity = (await identityResponse.json()) as { staff: Staff };
      setStaff(identity.staff);
    }
    if (mediaResponse.ok) {
      const result = (await mediaResponse.json()) as {
        products: { productId: string; media: CanonicalMediaReference }[];
      };
      setPhotos(
        Object.fromEntries(
          result.products.map((row) => [row.productId, row.media]),
        ),
      );
    }
    if (menuResponse.ok) setMenu((await menuResponse.json()) as StaffMenu);
    setLoading(false);
  }, [apiUrl, goToLogin]);

  useEffect(() => {
    void loadMenu().catch(() => {
      setLoading(false);
      setFeedback("error");
    });
  }, [loadMenu]);

  async function write(path: string, method: "POST" | "PUT", body: unknown) {
    setBusy(true);
    setFeedback(null);
    const response = await fetch(`${apiUrl}${path}`, {
      method,
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 401) {
      goToLogin();
      return false;
    }
    if (!response.ok) {
      setFeedback("error");
      setBusy(false);
      return false;
    }
    await loadMenu();
    setFeedback("success");
    setBusy(false);
    return true;
  }

  async function submitCategory(
    event: React.FormEvent<HTMLFormElement>,
    category?: MenuCategory,
  ) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body = {
      published: data.has("published"),
      sortOrder: Number(data.get("sortOrder")),
      translations: PLATFORM_LOCALES.map((language) => ({
        locale: language,
        name: String(data.get(`name-${language}`) ?? "").trim(),
      })),
    };
    const saved = await write(
      category
        ? `/v1/staff/menu/categories/${encodeURIComponent(category.id)}`
        : "/v1/staff/menu/categories",
      category ? "PUT" : "POST",
      body,
    );
    if (saved) setEditingCategory(null);
  }

  function productBody(data: FormData) {
    return {
      categoryId: String(data.get("categoryId")),
      priceMinor: Math.round(Number(data.get("price")) * 100),
      sortOrder: Number(data.get("sortOrder")),
      available: data.has("available"),
      published: data.has("published"),
      station: String(data.get("station")),
      translations: PLATFORM_LOCALES.map((language) => ({
        locale: language,
        name: String(data.get(`name-${language}`) ?? "").trim(),
        description:
          String(data.get(`description-${language}`) ?? "").trim() || null,
      })),
    };
  }

  async function submitProduct(
    event: React.FormEvent<HTMLFormElement>,
    product?: MenuProduct,
  ) {
    event.preventDefault();
    const body = productBody(new FormData(event.currentTarget));
    const saved = await write(
      product
        ? `/v1/staff/menu/products/${encodeURIComponent(product.id)}`
        : "/v1/staff/menu/products",
      product ? "PUT" : "POST",
      body,
    );
    if (saved) setEditingProduct(null);
  }

  async function toggleAvailability(product: MenuProduct) {
    await write(
      `/v1/staff/menu/products/${encodeURIComponent(product.id)}`,
      "PUT",
      {
        ...product,
        available: !product.available,
        translations: product.translations.map((translation) => ({
          ...translation,
          description: translation.description ?? null,
        })),
      },
    );
  }

  async function openConfiguration(product: MenuProduct) {
    setConfigurationProduct(product);
    setConfiguration(null);
    setConfigurationLoading(true);
    setFeedback(null);
    const response = await fetch(
      `${apiUrl}/v1/staff/menu/products/${encodeURIComponent(product.id)}/configuration`,
      { cache: "no-store", credentials: "include" },
    );
    if (response.status === 401) {
      goToLogin();
      return;
    }
    if (!response.ok) {
      setFeedback("error");
      setConfigurationProduct(null);
    } else {
      setConfiguration((await response.json()) as ProductConfiguration);
    }
    setConfigurationLoading(false);
  }

  async function saveConfiguration(configurationToSave: ProductConfiguration) {
    const saved = await write(
      `/v1/staff/menu/products/${encodeURIComponent(configurationToSave.productId)}/configuration`,
      "PUT",
      {
        variants: configurationToSave.variants,
        modifierGroups: configurationToSave.modifierGroups,
      },
    );
    if (saved) {
      setConfigurationProduct(null);
      setConfiguration(null);
    }
  }

  if (loading) {
    return (
      <main className="menu-admin-page">
        <p className="menu-admin-loading">{labels.loading}</p>
      </main>
    );
  }

  if (!menu || !staff || !["OWNER", "MANAGER"].includes(staff.role)) {
    return (
      <main className="menu-admin-page">
        <p className="menu-admin-loading">{labels.permissions}</p>
      </main>
    );
  }

  const query = search.trim().toLocaleLowerCase(locale);
  const filteredCategories = menu.categories
    .filter((category) => !activeCategory || category.id === activeCategory)
    .map((category) => ({
      ...category,
      products: category.products.filter((product) =>
        translationName(product.translations, locale)
          .toLocaleLowerCase(locale)
          .includes(query),
      ),
    }))
    .filter((category) => !query || category.products.length > 0);

  return (
    <main className="menu-admin-page">
      {photoProduct && (
        <ProductPhotoEditor
          key={photoProduct.product.id}
          productId={photoProduct.product.id}
          name={translationName(photoProduct.product.translations, locale)}
          category={photoProduct.category}
          locale={locale}
          apiUrl={apiUrl}
          onClose={() => setPhotoProduct(null)}
          onSaved={(media) =>
            setPhotos((current) => ({
              ...current,
              [photoProduct.product.id]: media,
            }))
          }
        />
      )}
      <section className="menu-admin-intro shell">
        <div>
          <p className="eyebrow">{menu.venue.name}</p>
          <h1>{labels.title}</h1>
          <p>{labels.subtitle}</p>
        </div>
        <button
          className="button button-primary"
          onClick={() => setEditingCategory("new")}
          type="button"
        >
          + {labels.addCategory}
        </button>
      </section>

      <section className="menu-admin-content shell">
        <OwnerSetupLinks locale={locale} />
        <PosActivation locale={locale} />
        <div className="menu-catalog-tools">
          <label className="menu-catalog-search">
            <span>{c.search}</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={c.search}
            />
          </label>
          <nav className="menu-catalog-tabs" aria-label={labels.category}>
            <button
              type="button"
              aria-pressed={activeCategory === null}
              onClick={() => setActiveCategory(null)}
            >
              {c.all}
            </button>
            {menu.categories.map((category) => (
              <button
                key={category.id}
                type="button"
                aria-pressed={activeCategory === category.id}
                onClick={() => setActiveCategory(category.id)}
              >
                {translationName(category.translations, locale)}{" "}
                <span>{category.products.length}</span>
              </button>
            ))}
          </nav>
        </div>
        {feedback && (
          <p className={`menu-admin-feedback ${feedback}`} role="status">
            {labels[feedback]}
          </p>
        )}

        {editingCategory === "new" && (
          <CategoryForm
            locale={locale}
            busy={busy}
            labels={labels}
            onCancel={() => setEditingCategory(null)}
            onSubmit={submitCategory}
            sortOrder={menu.categories.length}
          />
        )}

        {menu.categories.length === 0 && editingCategory !== "new" ? (
          <div className="menu-admin-empty">
            <TableSetting />
            <h2>{labels.empty}</h2>
            <a
              className="button button-primary"
              href={`/app/${locale}/onboarding/business-import`}
            >
              {locale === "sq"
                ? "Importo menu PDF / foto"
                : locale === "de"
                  ? "Menü aus PDF / Foto importieren"
                  : locale === "it"
                    ? "Importa menu PDF / foto"
                    : "Import menu PDF / photo"}
            </a>
          </div>
        ) : (
          <div className="menu-category-list">
            {filteredCategories.length === 0 && (
              <div className="menu-admin-empty">
                <TableSetting />
                <h2>{c.noResults}</h2>
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setSearch("");
                    setActiveCategory(null);
                  }}
                >
                  {c.all}
                </button>
              </div>
            )}
            {filteredCategories.map((category) => (
              <article className="menu-admin-category" key={category.id}>
                <div className="menu-category-heading">
                  <div>
                    <span
                      className={`menu-state ${category.published ? "published" : "draft"}`}
                    >
                      {category.published ? labels.published : labels.draft}
                    </span>
                    <h2>{translationName(category.translations, locale)}</h2>
                    <small>
                      {category.products.length} · {labels.sortOrder}{" "}
                      {category.sortOrder}
                    </small>
                  </div>
                  <div className="menu-category-actions">
                    <button
                      onClick={() =>
                        setEditingCategory(
                          editingCategory === category.id ? null : category.id,
                        )
                      }
                      type="button"
                    >
                      {labels.edit}
                    </button>
                    <button
                      className="button button-primary"
                      onClick={() => setEditingProduct(`new:${category.id}`)}
                      type="button"
                    >
                      + {labels.addProduct}
                    </button>
                  </div>
                </div>

                {editingCategory === category.id && (
                  <CategoryForm
                    locale={locale}
                    busy={busy}
                    category={category}
                    labels={labels}
                    onCancel={() => setEditingCategory(null)}
                    onSubmit={(event) => submitCategory(event, category)}
                    sortOrder={category.sortOrder}
                  />
                )}

                {editingProduct === `new:${category.id}` && (
                  <ProductForm
                    locale={locale}
                    busy={busy}
                    categories={menu.categories}
                    categoryId={category.id}
                    currency={menu.venue.currency}
                    labels={labels}
                    onCancel={() => setEditingProduct(null)}
                    onSubmit={submitProduct}
                    sortOrder={category.products.length}
                  />
                )}

                <div className="menu-product-list">
                  {category.products
                    .filter((product) =>
                      translationName(product.translations, locale)
                        .toLocaleLowerCase(locale)
                        .includes(search.trim().toLocaleLowerCase(locale)),
                    )
                    .map((product) => (
                      <div className="menu-admin-product" key={product.id}>
                        <div className="menu-product-summary">
                          <button
                            className="menu-product-photo"
                            type="button"
                            aria-label={`${c.photo}: ${translationName(product.translations, locale)}`}
                            onClick={() =>
                              setPhotoProduct({
                                product,
                                category: translationName(
                                  category.translations,
                                  locale,
                                ),
                              })
                            }
                          >
                            <ProductMedia
                              category={translationName(
                                category.translations,
                                locale,
                              )}
                              demoLabel={pilotText(locale).demoPhoto}
                              image={
                                photos[product.id]
                                  ? {
                                      src: `${apiUrl}${photos[product.id]!.url}`,
                                      kind:
                                        photos[product.id]!.source === "DEMO"
                                          ? "demo"
                                          : "approved",
                                      label:
                                        photos[product.id]!.label ?? undefined,
                                    }
                                  : undefined
                              }
                            />
                            <span className="menu-photo-action">
                              {c.photo} +
                            </span>
                          </button>
                          <div className="menu-product-copy">
                            <span className="menu-station">
                              {labels.stations[product.station]}
                            </span>
                            <h3>
                              {translationName(product.translations, locale)}
                            </h3>
                            <p>
                              {priceLabel(
                                product.priceMinor,
                                product.currency,
                                locale,
                              )}
                              {product.published ? "" : ` · ${labels.draft}`}
                              {product.variantCount > 0
                                ? ` · ${product.variantCount} variants`
                                : ""}
                              {product.modifierGroupCount > 0
                                ? ` · ${product.modifierGroupCount} option groups`
                                : ""}
                            </p>
                            {product.allergens.length > 0 && (
                              <div className="allergen-list">
                                {product.allergens.map((allergen) => (
                                  <span key={allergen}>{allergen}</span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="menu-product-actions">
                            <button
                              className={`availability-toggle ${product.available ? "available" : "sold-out"}`}
                              disabled={busy}
                              onClick={() => toggleAvailability(product)}
                              type="button"
                            >
                              {product.available
                                ? labels.available
                                : labels.soldOut}
                            </button>
                            <button
                              disabled={busy || configurationLoading}
                              onClick={() => void openConfiguration(product)}
                              type="button"
                            >
                              {labels.configure}
                            </button>
                            <button
                              onClick={() =>
                                setEditingProduct(
                                  editingProduct === product.id
                                    ? null
                                    : product.id,
                                )
                              }
                              type="button"
                            >
                              {labels.edit}
                            </button>
                          </div>
                        </div>
                        {editingProduct === product.id && (
                          <ProductForm
                            locale={locale}
                            busy={busy}
                            categories={menu.categories}
                            categoryId={category.id}
                            currency={menu.venue.currency}
                            labels={labels}
                            onCancel={() => setEditingProduct(null)}
                            onSubmit={(event) => submitProduct(event, product)}
                            product={product}
                            sortOrder={product.sortOrder}
                          />
                        )}
                        {configurationProduct?.id === product.id && (
                          <ProductConfigurationEditor
                            locale={locale}
                            busy={busy || configurationLoading}
                            configuration={configuration}
                            currency={menu.venue.currency}
                            labels={labels}
                            onCancel={() => {
                              setConfigurationProduct(null);
                              setConfiguration(null);
                            }}
                            onSave={saveConfiguration}
                            product={product}
                          />
                        )}
                      </div>
                    ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

/** All locale inputs stay mounted so closing translations never drops form values. */
function TranslationEditor({
  labels,
  locale,
  translations,
  onChange,
  descriptions = false,
  formFields = false,
}: {
  labels: Dictionary["menuAdmin"];
  locale: Locale;
  translations: Translation[];
  onChange: (translations: Translation[]) => void;
  descriptions?: boolean;
  formFields?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const update = (
    language: Locale,
    field: "name" | "description",
    value: string,
  ) => {
    setCopied(false);
    onChange(
      PLATFORM_LOCALES.map((entry) => ({
        ...translations.find((translation) => translation.locale === entry),
        locale: entry,
        name: translationValue(translations, entry, "name"),
        ...(entry === language ? { [field]: value } : {}),
      })),
    );
  };
  const fields = (language: Locale) => (
    <div className="menu-language-fields" key={language}>
      <label>
        {labels.name} · {labels.languages[language]}
        <input
          name={formFields ? `name-${language}` : undefined}
          value={translationValue(translations, language, "name")}
          onChange={(event) => update(language, "name", event.target.value)}
          maxLength={120}
          required
        />
      </label>
      {descriptions && (
        <label>
          {labels.description} · {labels.languages[language]}
          <textarea
            name={formFields ? `description-${language}` : undefined}
            value={translationValue(translations, language, "description")}
            onChange={(event) =>
              update(language, "description", event.target.value)
            }
            maxLength={500}
            rows={2}
          />
        </label>
      )}
    </div>
  );
  return (
    <div
      className={`menu-translation-editor${descriptions ? " has-description" : ""}`}
    >
      {fields(locale)}
      <div className="menu-translation-tools">
        <details
          className="menu-translations"
          onInvalidCapture={(event) => {
            // Native validation can now reveal and focus an empty translated name.
            event.currentTarget.open = true;
          }}
        >
          <summary>{labels.openTranslations}</summary>
          <div className="menu-translations-content">
            <p>{labels.translationHint}</p>
            {PLATFORM_LOCALES.filter((language) => language !== locale).map(
              fields,
            )}
          </div>
        </details>
        <button
          className="menu-copy-translations"
          type="button"
          disabled={!translationValue(translations, locale, "name").trim()}
          onClick={() => {
            onChange(
              PLATFORM_LOCALES.map((language) => ({
                locale: language,
                name: translationValue(translations, locale, "name"),
                ...(descriptions
                  ? {
                      description: translationValue(
                        translations,
                        locale,
                        "description",
                      ),
                    }
                  : {}),
              })),
            );
            setCopied(true);
          }}
        >
          {labels.copyPrimary}
        </button>
      </div>
      <span className="menu-copy-status" role="status">
        {copied ? labels.translationsCopied : ""}
      </span>
    </div>
  );
}

function TranslationFields({
  labels,
  locale,
  translations = [],
  descriptions,
}: {
  labels: Dictionary["menuAdmin"];
  locale: Locale;
  translations?: Translation[] | undefined;
  descriptions?: boolean;
}) {
  const [draft, setDraft] = useState(translations);
  return (
    <TranslationEditor
      labels={labels}
      locale={locale}
      translations={draft}
      onChange={setDraft}
      descriptions={descriptions ?? false}
      formFields
    />
  );
}

function FormActions({
  busy,
  labels,
  onCancel,
}: {
  busy: boolean;
  labels: Dictionary["menuAdmin"];
  onCancel: () => void;
}) {
  return (
    <div className="menu-form-actions">
      <button disabled={busy} onClick={onCancel} type="button">
        {labels.cancel}
      </button>
      <button className="button button-primary" disabled={busy} type="submit">
        {busy ? labels.saving : labels.save}
      </button>
    </div>
  );
}

function CategoryForm({
  busy,
  category,
  labels,
  locale,
  onCancel,
  onSubmit,
  sortOrder,
}: {
  busy: boolean;
  category?: MenuCategory;
  labels: Dictionary["menuAdmin"];
  locale: Locale;
  onCancel: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  sortOrder: number;
}) {
  return (
    <form className="menu-editor-form" onSubmit={onSubmit}>
      <h3>{category ? labels.edit : labels.addCategory}</h3>
      <TranslationFields
        locale={locale}
        labels={labels}
        translations={category?.translations}
      />
      <div className="menu-operational-fields">
        <label>
          {labels.sortOrder}
          <input
            defaultValue={sortOrder}
            max={10000}
            min={0}
            name="sortOrder"
            required
            type="number"
          />
        </label>
        <label className="checkbox-field">
          <input
            defaultChecked={category?.published ?? true}
            name="published"
            type="checkbox"
          />
          {labels.published}
        </label>
      </div>
      <FormActions busy={busy} labels={labels} onCancel={onCancel} />
    </form>
  );
}

function ProductForm({
  busy,
  categories,
  categoryId,
  currency,
  labels,
  locale,
  onCancel,
  onSubmit,
  product,
  sortOrder,
}: {
  busy: boolean;
  categories: MenuCategory[];
  categoryId: string;
  currency: string;
  labels: Dictionary["menuAdmin"];
  locale: Locale;
  onCancel: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  product?: MenuProduct;
  sortOrder: number;
}) {
  return (
    <form className="menu-editor-form product-editor" onSubmit={onSubmit}>
      <h3>{product ? labels.edit : labels.addProduct}</h3>
      <TranslationFields
        locale={locale}
        descriptions
        labels={labels}
        translations={product?.translations}
      />
      <div className="menu-operational-fields">
        <label>
          {labels.category}
          <select
            defaultValue={product?.categoryId ?? categoryId}
            name="categoryId"
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {translationName(category.translations, locale)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {labels.price} ({currency})
          <input
            defaultValue={product ? (product.priceMinor / 100).toFixed(2) : ""}
            min={0}
            name="price"
            required
            step="0.01"
            type="number"
          />
        </label>
        <label>
          {labels.station}
          <select defaultValue={product?.station ?? "KITCHEN"} name="station">
            {(["BAR", "KITCHEN", "DESSERT"] as const).map((station) => (
              <option key={station} value={station}>
                {labels.stations[station]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {labels.sortOrder}
          <input
            defaultValue={sortOrder}
            max={10000}
            min={0}
            name="sortOrder"
            required
            type="number"
          />
        </label>
        <label className="checkbox-field">
          <input
            defaultChecked={product?.available ?? true}
            name="available"
            type="checkbox"
          />
          {labels.available}
        </label>
        <label className="checkbox-field">
          <input
            defaultChecked={product?.published ?? true}
            name="published"
            type="checkbox"
          />
          {labels.published}
        </label>
      </div>
      <FormActions busy={busy} labels={labels} onCancel={onCancel} />
    </form>
  );
}

function configurationTranslations(name = "") {
  return PLATFORM_LOCALES.map((locale) => ({ locale, name }));
}

function ConfigurationTranslationFields({
  labels,
  locale,
  translations,
  onChange,
}: {
  labels: Dictionary["menuAdmin"];
  locale: Locale;
  translations: Array<{ locale: Locale; name: string }>;
  onChange: (translations: Array<{ locale: Locale; name: string }>) => void;
}) {
  return (
    <TranslationEditor
      labels={labels}
      locale={locale}
      translations={translations}
      onChange={onChange}
    />
  );
}

function ProductConfigurationEditor({
  busy,
  configuration,
  currency,
  labels,
  locale,
  onCancel,
  onSave,
  product,
}: {
  busy: boolean;
  configuration: ProductConfiguration | null;
  currency: string;
  labels: Dictionary["menuAdmin"];
  locale: Locale;
  onCancel: () => void;
  onSave: (configuration: ProductConfiguration) => Promise<void>;
  product: MenuProduct;
}) {
  const [draft, setDraft] = useState<ProductConfiguration | null>(null);

  useEffect(() => {
    setDraft(configuration);
  }, [configuration]);

  if (!draft) {
    return (
      <p className="menu-configuration-loading">
        {labels.configurationLoading}
      </p>
    );
  }

  const addVariant = () => {
    setDraft({
      ...draft,
      variants: [
        ...draft.variants,
        {
          priceDeltaMinor: 0,
          sortOrder: draft.variants.length,
          available: true,
          isDefault: draft.variants.length === 0,
          translations: configurationTranslations(labels.newVariant),
        },
      ],
    });
  };

  const addGroup = () => {
    const option: MenuModifierOptionConfiguration = {
      priceDeltaMinor: 0,
      sortOrder: 0,
      available: true,
      translations: configurationTranslations(labels.newOption),
    };
    setDraft({
      ...draft,
      modifierGroups: [
        ...draft.modifierGroups,
        {
          minSelect: 0,
          maxSelect: 1,
          sortOrder: draft.modifierGroups.length,
          translations: configurationTranslations(labels.newGroup),
          options: [option],
        },
      ],
    });
  };

  const updateVariant = (
    index: number,
    update: Partial<MenuVariantConfiguration>,
  ) => {
    setDraft({
      ...draft,
      variants: draft.variants.map((variant, variantIndex) => ({
        ...variant,
        ...(variantIndex === index ? update : {}),
        isDefault: update.isDefault
          ? variantIndex === index
          : variant.isDefault,
      })),
    });
  };

  const updateGroup = (
    groupIndex: number,
    update: Partial<MenuModifierGroupConfiguration>,
  ) => {
    setDraft({
      ...draft,
      modifierGroups: draft.modifierGroups.map((group, index) =>
        index === groupIndex ? { ...group, ...update } : group,
      ),
    });
  };

  return (
    <form
      className="menu-configuration"
      aria-label={labels.configure}
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(draft);
      }}
    >
      <div className="menu-configuration-heading">
        <div>
          <h3>{labels.configurationTitle}</h3>
          <p>
            {translationName(product.translations, locale)} · {labels.basePrice}{" "}
            {priceLabel(draft.basePriceMinor, currency, locale)}
          </p>
        </div>
        <button disabled={busy} onClick={onCancel} type="button">
          {labels.cancel}
        </button>
      </div>

      <section className="configuration-section">
        <div className="configuration-section-heading">
          <div>
            <h4>{labels.variants}</h4>
            <p>{labels.variantsHint}</p>
          </div>
          <button disabled={busy} onClick={addVariant} type="button">
            + {labels.addVariant}
          </button>
        </div>
        {draft.variants.length === 0 ? (
          <p className="configuration-empty">{labels.noVariants}</p>
        ) : (
          draft.variants.map((variant, index) => (
            <div
              className="configuration-card configuration-variant"
              key={`variant-${index}`}
            >
              <div className="configuration-card-heading">
                <strong>
                  {labels.variant} {index + 1}
                </strong>
                <button
                  disabled={busy}
                  onClick={() =>
                    setDraft(() => {
                      const variants = draft.variants.filter(
                        (_, itemIndex) => itemIndex !== index,
                      );
                      return {
                        ...draft,
                        variants: variants.map((item, itemIndex) => ({
                          ...item,
                          isDefault:
                            variants.length > 0 &&
                            (item.isDefault ||
                              !variants.some(
                                (candidate) => candidate.isDefault,
                              ))
                              ? itemIndex === 0 || item.isDefault
                              : false,
                        })),
                      };
                    })
                  }
                  type="button"
                >
                  {labels.remove}
                </button>
              </div>
              <ConfigurationTranslationFields
                locale={locale}
                labels={labels}
                onChange={(translations) =>
                  updateVariant(index, { translations })
                }
                translations={variant.translations}
              />
              <div className="configuration-fields">
                <label>
                  {labels.priceDelta} ({currency})
                  <input
                    min={-1000000}
                    onChange={(event) =>
                      updateVariant(index, {
                        priceDeltaMinor: Math.round(
                          Number(event.target.value) * 100,
                        ),
                      })
                    }
                    step="0.01"
                    type="number"
                    value={(variant.priceDeltaMinor / 100).toFixed(2)}
                  />
                </label>
                <label className="checkbox-field">
                  <input
                    checked={variant.available}
                    onChange={(event) =>
                      updateVariant(index, { available: event.target.checked })
                    }
                    type="checkbox"
                  />
                  {labels.available}
                </label>
                <label className="checkbox-field">
                  <input
                    checked={variant.isDefault}
                    name="defaultVariant"
                    onChange={() => updateVariant(index, { isDefault: true })}
                    type="radio"
                  />
                  {labels.defaultVariant}
                </label>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="configuration-section">
        <div className="configuration-section-heading">
          <div>
            <h4>{labels.modifierGroups}</h4>
            <p>{labels.modifierGroupsHint}</p>
          </div>
          <button disabled={busy} onClick={addGroup} type="button">
            + {labels.addGroup}
          </button>
        </div>
        {draft.modifierGroups.length === 0 ? (
          <p className="configuration-empty">{labels.noModifierGroups}</p>
        ) : (
          draft.modifierGroups.map((group, groupIndex) => (
            <div className="configuration-card" key={`group-${groupIndex}`}>
              <div className="configuration-card-heading">
                <strong>
                  {labels.modifierGroup} {groupIndex + 1}
                </strong>
                <button
                  disabled={busy}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      modifierGroups: draft.modifierGroups.filter(
                        (_, index) => index !== groupIndex,
                      ),
                    })
                  }
                  type="button"
                >
                  {labels.remove}
                </button>
              </div>
              <ConfigurationTranslationFields
                locale={locale}
                labels={labels}
                onChange={(translations) =>
                  updateGroup(groupIndex, { translations })
                }
                translations={group.translations}
              />
              <div className="configuration-fields">
                <label>
                  {labels.minimumSelections}
                  <input
                    min={0}
                    onChange={(event) =>
                      updateGroup(groupIndex, {
                        minSelect: Number(event.target.value),
                      })
                    }
                    type="number"
                    value={group.minSelect}
                  />
                </label>
                <label>
                  {labels.maximumSelections}
                  <input
                    min={0}
                    onChange={(event) =>
                      updateGroup(groupIndex, {
                        maxSelect: Number(event.target.value),
                      })
                    }
                    type="number"
                    value={group.maxSelect}
                  />
                </label>
              </div>
              <div className="configuration-options">
                <div className="configuration-section-heading">
                  <h4>{labels.options}</h4>
                  <button
                    disabled={busy}
                    onClick={() =>
                      updateGroup(groupIndex, {
                        options: [
                          ...group.options,
                          {
                            priceDeltaMinor: 0,
                            sortOrder: group.options.length,
                            available: true,
                            translations: configurationTranslations(
                              labels.newOption,
                            ),
                          },
                        ],
                      })
                    }
                    type="button"
                  >
                    + {labels.addOption}
                  </button>
                </div>
                {group.options.map((option, optionIndex) => (
                  <div
                    className="configuration-option"
                    key={`option-${optionIndex}`}
                  >
                    <ConfigurationTranslationFields
                      locale={locale}
                      labels={labels}
                      onChange={(translations) =>
                        updateGroup(groupIndex, {
                          options: group.options.map((item, index) =>
                            index === optionIndex
                              ? { ...item, translations }
                              : item,
                          ),
                        })
                      }
                      translations={option.translations}
                    />
                    <div className="configuration-fields">
                      <label>
                        {labels.priceDelta} ({currency})
                        <input
                          min={0}
                          onChange={(event) =>
                            updateGroup(groupIndex, {
                              options: group.options.map((item, index) =>
                                index === optionIndex
                                  ? {
                                      ...item,
                                      priceDeltaMinor: Math.round(
                                        Number(event.target.value) * 100,
                                      ),
                                    }
                                  : item,
                              ),
                            })
                          }
                          step="0.01"
                          type="number"
                          value={(option.priceDeltaMinor / 100).toFixed(2)}
                        />
                      </label>
                      <label className="checkbox-field">
                        <input
                          checked={option.available}
                          onChange={(event) =>
                            updateGroup(groupIndex, {
                              options: group.options.map((item, index) =>
                                index === optionIndex
                                  ? { ...item, available: event.target.checked }
                                  : item,
                              ),
                            })
                          }
                          type="checkbox"
                        />
                        {labels.available}
                      </label>
                      <button
                        disabled={busy || group.options.length === 1}
                        onClick={() =>
                          updateGroup(groupIndex, {
                            options: group.options.filter(
                              (_, index) => index !== optionIndex,
                            ),
                          })
                        }
                        type="button"
                      >
                        {labels.remove}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </section>
      <div className="menu-form-actions">
        <button disabled={busy} onClick={onCancel} type="button">
          {labels.cancel}
        </button>
        <button className="button button-primary" disabled={busy} type="submit">
          {busy ? labels.saving : labels.saveConfiguration}
        </button>
      </div>
    </form>
  );
}
