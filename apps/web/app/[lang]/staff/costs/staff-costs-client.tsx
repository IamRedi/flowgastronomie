"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import type { Locale } from "../../../../lib/i18n";

type Ingredient = {
  id: string;
  name: string;
  baseUnit: "GRAM" | "MILLILITER" | "PIECE";
  allergens: string[];
  active: boolean;
};
type Supplier = {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  active: boolean;
};
type Price = {
  id: string;
  supplierId: string;
  ingredientId: string;
  packQuantity: number;
  unit: "GRAM" | "KILOGRAM" | "MILLILITER" | "LITER" | "PIECE";
  priceMinor: number;
  currency: string;
  effectiveFrom: string;
};
type Catalog = {
  venue: { id: string; currency: string };
  ingredients: Ingredient[];
  suppliers: Supplier[];
  prices: Price[];
};
type Product = {
  id: string;
  priceMinor: number;
  currency: string;
  translations: Array<{ locale: Locale; name: string }>;
};
type Menu = { categories: Array<{ products: Product[] }> };
type RecipeResult = {
  productId: string;
  recipe: {
    yieldBasisPoints: number;
    wastageBasisPoints: number;
    ingredients: Array<{ ingredientId: string; quantityBaseUnits: number }>;
  } | null;
  estimate: {
    complete: boolean;
    missingPriceIngredientIds: string[];
    directCostMinor: number | null;
    foodCostBasisPoints: number | null;
    grossContributionMinor: number | null;
  } | null;
};

const ALLERGENS = [
  "GLUTEN",
  "CRUSTACEANS",
  "EGGS",
  "FISH",
  "PEANUTS",
  "SOY",
  "MILK",
  "NUTS",
  "CELERY",
  "MUSTARD",
  "SESAME",
  "SULPHITES",
  "LUPIN",
  "MOLLUSCS",
];
const units = ["GRAM", "KILOGRAM", "MILLILITER", "LITER", "PIECE"] as const;
const copy = {
  en: {
    title: "Recipes & food cost",
    subtitle:
      "Maintain purchase prices to see operational cost estimates. This is not accounting profit.",
    ingredients: "Ingredients",
    suppliers: "Suppliers",
    prices: "Purchase prices",
    recipe: "Recipe",
    add: "Add",
    save: "Save recipe",
    loading: "Loading cost catalog…",
    error: "Could not save the change.",
    saved: "Saved.",
    incomplete: "Estimate incomplete — add a current purchase price for:",
    direct: "Estimated direct cost",
    food: "Food cost",
    contribution: "Estimated gross contribution",
    yield: "Preparation yield (%)",
    wastage: "Wastage allowance (%)",
    selectProduct: "Choose a menu item",
    name: "Name",
    unit: "Base unit",
    allergen: "Allergens",
    supplier: "Supplier",
    ingredient: "Ingredient",
    pack: "Pack quantity",
    packUnit: "Pack unit",
    price: "Purchase price",
    effective: "Effective from",
    quantity: "Quantity",
    remove: "Remove",
    none: "No ingredients yet.",
    back: "Menu",
  },
  de: {
    title: "Rezepte & Wareneinsatz",
    subtitle:
      "Pflegen Sie Einkaufspreise für operative Kostenschätzungen. Dies ist kein Buchhaltungsgewinn.",
    ingredients: "Zutaten",
    suppliers: "Lieferanten",
    prices: "Einkaufspreise",
    recipe: "Rezept",
    add: "Hinzufügen",
    save: "Rezept speichern",
    loading: "Kostenkatalog wird geladen…",
    error: "Änderung konnte nicht gespeichert werden.",
    saved: "Gespeichert.",
    incomplete:
      "Schätzung unvollständig — aktuellen Einkaufspreis ergänzen für:",
    direct: "Geschätzte direkte Kosten",
    food: "Wareneinsatz",
    contribution: "Geschätzter Rohertrag",
    yield: "Zubereitungsausbeute (%)",
    wastage: "Schwund (%)",
    selectProduct: "Menüartikel wählen",
    name: "Name",
    unit: "Basiseinheit",
    allergen: "Allergene",
    supplier: "Lieferant",
    ingredient: "Zutat",
    pack: "Packungsmenge",
    packUnit: "Packungseinheit",
    price: "Einkaufspreis",
    effective: "Gültig ab",
    quantity: "Menge",
    remove: "Entfernen",
    none: "Noch keine Zutaten.",
    back: "Menü",
  },
  it: {
    title: "Ricette e costo alimentare",
    subtitle:
      "Gestisci i prezzi di acquisto per stime operative dei costi. Non è un utile contabile.",
    ingredients: "Ingredienti",
    suppliers: "Fornitori",
    prices: "Prezzi di acquisto",
    recipe: "Ricetta",
    add: "Aggiungi",
    save: "Salva ricetta",
    loading: "Caricamento catalogo costi…",
    error: "Impossibile salvare la modifica.",
    saved: "Salvato.",
    incomplete: "Stima incompleta — aggiungi un prezzo corrente per:",
    direct: "Costo diretto stimato",
    food: "Costo alimentare",
    contribution: "Contributo lordo stimato",
    yield: "Resa di preparazione (%)",
    wastage: "Scarto (%)",
    selectProduct: "Scegli una voce del menu",
    name: "Nome",
    unit: "Unità base",
    allergen: "Allergeni",
    supplier: "Fornitore",
    ingredient: "Ingrediente",
    pack: "Quantità confezione",
    packUnit: "Unità confezione",
    price: "Prezzo di acquisto",
    effective: "Valido dal",
    quantity: "Quantità",
    remove: "Rimuovi",
    none: "Nessun ingrediente.",
    back: "Menu",
  },
  sq: {
    title: "Receta dhe kosto ushqimore",
    subtitle:
      "Mbani çmimet e blerjes për vlerësime operative të kostos. Kjo nuk është fitim kontabël.",
    ingredients: "Përbërësit",
    suppliers: "Furnitorët",
    prices: "Çmimet e blerjes",
    recipe: "Receta",
    add: "Shto",
    save: "Ruaj recetën",
    loading: "Po ngarkohet katalogu i kostos…",
    error: "Ndryshimi nuk u ruajt.",
    saved: "U ruajt.",
    incomplete: "Vlerësimi nuk është i plotë — shtoni çmimin aktual për:",
    direct: "Kosto direkte e vlerësuar",
    food: "Kosto ushqimore",
    contribution: "Kontribut bruto i vlerësuar",
    yield: "Rendimenti i përgatitjes (%)",
    wastage: "Humbje (%)",
    selectProduct: "Zgjidhni një produkt menuje",
    name: "Emri",
    unit: "Njësia bazë",
    allergen: "Alergjenët",
    supplier: "Furnitori",
    ingredient: "Përbërësi",
    pack: "Sasia e paketës",
    packUnit: "Njësia e paketës",
    price: "Çmimi i blerjes",
    effective: "Në fuqi nga",
    quantity: "Sasia",
    remove: "Hiq",
    none: "Nuk ka përbërës ende.",
    back: "Menu",
  },
} as const;
type CostLabels = Record<keyof (typeof copy)["en"], string>;

function productName(product: Product, locale: Locale) {
  return (
    product.translations.find((entry) => entry.locale === locale)?.name ??
    product.translations[0]?.name ??
    "—"
  );
}

export function StaffCostsClient({ locale }: { locale: Locale }) {
  const labels = copy[locale];
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState("");
  const [recipe, setRecipe] = useState<RecipeResult | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<"saved" | "error" | null>(null);
  const money = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: catalog?.venue.currency ?? "EUR",
      }),
    [catalog?.venue.currency, locale],
  );
  const load = useCallback(async () => {
    const [catalogResponse, menuResponse] = await Promise.all([
      fetch(`${apiUrl}/v1/staff/costs`, {
        credentials: "include",
        cache: "no-store",
      }),
      fetch(`${apiUrl}/v1/staff/menu`, {
        credentials: "include",
        cache: "no-store",
      }),
    ]);
    if (catalogResponse.status === 401 || menuResponse.status === 401) {
      window.location.assign(`/${locale}/staff/login`);
      return;
    }
    if (!catalogResponse.ok || !menuResponse.ok) {
      setState("error");
      return;
    }
    setCatalog((await catalogResponse.json()) as Catalog);
    setProducts(
      ((await menuResponse.json()) as Menu).categories.flatMap(
        (category) => category.products,
      ),
    );
    setState("ready");
  }, [apiUrl, locale]);
  useEffect(() => {
    void load();
  }, [load]);
  const loadRecipe = useCallback(
    async (id: string) => {
      setProductId(id);
      setRecipe(null);
      if (!id) return;
      const response = await fetch(
        `${apiUrl}/v1/staff/costs/products/${encodeURIComponent(id)}/recipe`,
        { credentials: "include", cache: "no-store" },
      );
      if (!response.ok) {
        setMessage("error");
        return;
      }
      setRecipe((await response.json()) as RecipeResult);
    },
    [apiUrl],
  );
  async function post(path: string, body: unknown) {
    setMessage(null);
    const response = await fetch(`${apiUrl}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      setMessage("error");
      return false;
    }
    setMessage("saved");
    await load();
    return true;
  }
  async function addIngredient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (
      await post("/v1/staff/costs/ingredients", {
        name: String(form.get("name")).trim(),
        baseUnit: form.get("baseUnit"),
        allergens: form.getAll("allergens"),
        active: true,
      })
    )
      event.currentTarget.reset();
  }
  async function addSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const optional = (name: string) =>
      String(form.get(name) ?? "").trim() || null;
    if (
      await post("/v1/staff/costs/suppliers", {
        name: String(form.get("name")).trim(),
        contactName: optional("contactName"),
        phone: optional("phone"),
        email: optional("email"),
        address: optional("address"),
        active: true,
      })
    )
      event.currentTarget.reset();
  }
  async function addPrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (
      await post("/v1/staff/costs/prices", {
        supplierId: form.get("supplierId"),
        ingredientId: form.get("ingredientId"),
        packQuantity: Number(form.get("packQuantity")),
        unit: form.get("unit"),
        priceMinor: Math.round(Number(form.get("price")) * 100),
        effectiveFrom: new Date(
          String(form.get("effectiveFrom")),
        ).toISOString(),
      })
    )
      event.currentTarget.reset();
  }
  async function saveRecipe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!productId) return;
    const form = new FormData(event.currentTarget);
    const ingredientIds = form.getAll("ingredientId").map(String);
    const quantities = form.getAll("quantity").map(Number);
    const response = await fetch(
      `${apiUrl}/v1/staff/costs/products/${encodeURIComponent(productId)}/recipe`,
      {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          yieldBasisPoints: Math.round(Number(form.get("yield")) * 100),
          wastageBasisPoints: Math.round(Number(form.get("wastage")) * 100),
          ingredients: ingredientIds.map((ingredientId, index) => ({
            ingredientId,
            quantityBaseUnits: quantities[index],
          })),
        }),
      },
    );
    if (!response.ok) {
      setMessage("error");
      return;
    }
    setRecipe((await response.json()) as RecipeResult);
    setMessage("saved");
  }
  if (state !== "ready" || !catalog)
    return (
      <main className="costs-page">
        <p>{state === "error" ? labels.error : labels.loading}</p>
      </main>
    );
  const byId = new Map(
    catalog.ingredients.map((ingredient) => [ingredient.id, ingredient]),
  );
  return (
    <main className="costs-page">
      <section className="costs-intro shell">
        <h1>{labels.title}</h1>
        <p>{labels.subtitle}</p>
      </section>
      <section className="costs-grid shell">
        {message && (
          <p
            className={`menu-admin-feedback ${message === "saved" ? "success" : "error"}`}
            role="status"
          >
            {labels[message]}
          </p>
        )}
        <article className="costs-card">
          <h2>{labels.ingredients}</h2>
          <form onSubmit={addIngredient}>
            <label>
              {labels.name}
              <input name="name" required />
            </label>
            <label>
              {labels.unit}
              <select defaultValue="GRAM" name="baseUnit">
                {["GRAM", "MILLILITER", "PIECE"].map((unit) => (
                  <option key={unit}>{unit}</option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend>{labels.allergen}</legend>
              {ALLERGENS.map((allergen) => (
                <label className="costs-check" key={allergen}>
                  <input name="allergens" type="checkbox" value={allergen} />
                  {allergen}
                </label>
              ))}
            </fieldset>
            <button className="button button-primary" type="submit">
              {labels.add}
            </button>
          </form>
          <ul>
            {catalog.ingredients.map((ingredient) => (
              <li key={ingredient.id}>
                <strong>{ingredient.name}</strong>
                <small>
                  {ingredient.baseUnit}
                  {ingredient.allergens.length
                    ? ` · ${ingredient.allergens.join(", ")}`
                    : ""}
                </small>
              </li>
            ))}
          </ul>
        </article>
        <article className="costs-card">
          <h2>{labels.suppliers}</h2>
          <form onSubmit={addSupplier}>
            <label>
              {labels.name}
              <input name="name" required />
            </label>
            <label>
              Contact
              <input name="contactName" />
            </label>
            <label>
              Phone
              <input name="phone" type="tel" />
            </label>
            <label>
              Email
              <input name="email" type="email" />
            </label>
            <button className="button button-primary" type="submit">
              {labels.add}
            </button>
          </form>
          <ul>
            {catalog.suppliers.map((supplier) => (
              <li key={supplier.id}>
                <strong>{supplier.name}</strong>
                <small>
                  {[supplier.contactName, supplier.phone, supplier.email]
                    .filter(Boolean)
                    .join(" · ") || (supplier.active ? "Active" : "Inactive")}
                </small>
              </li>
            ))}
          </ul>
        </article>
        <article className="costs-card">
          <h2>{labels.prices}</h2>
          <form onSubmit={addPrice}>
            <label>
              {labels.supplier}
              <select name="supplierId" required>
                {catalog.suppliers
                  .filter((supplier) => supplier.active)
                  .map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {labels.ingredient}
              <select name="ingredientId" required>
                {catalog.ingredients.map((ingredient) => (
                  <option key={ingredient.id} value={ingredient.id}>
                    {ingredient.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="costs-inline">
              <label>
                {labels.pack}
                <input min="1" name="packQuantity" required type="number" />
              </label>
              <label>
                {labels.packUnit}
                <select name="unit">
                  {units.map((unit) => (
                    <option key={unit}>{unit}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              {labels.price}
              <input min="0" name="price" required step="0.01" type="number" />
            </label>
            <label>
              {labels.effective}
              <input
                defaultValue={new Date().toISOString().slice(0, 10)}
                name="effectiveFrom"
                required
                type="date"
              />
            </label>
            <button
              className="button button-primary"
              disabled={
                !catalog.suppliers.length || !catalog.ingredients.length
              }
              type="submit"
            >
              {labels.add}
            </button>
          </form>
          <ul>
            {catalog.prices.slice(0, 8).map((price) => (
              <li key={price.id}>
                <strong>
                  {byId.get(price.ingredientId)?.name ?? "—"} ·{" "}
                  {money.format(price.priceMinor / 100)}
                </strong>
                <small>
                  {price.packQuantity} {price.unit} ·{" "}
                  {new Date(price.effectiveFrom).toLocaleDateString(locale)}
                </small>
              </li>
            ))}
          </ul>
        </article>
      </section>
      <section className="costs-recipe shell">
        <div>
          <h2>{labels.recipe}</h2>
          <label>
            {labels.selectProduct}
            <select
              onChange={(event) => void loadRecipe(event.target.value)}
              value={productId}
            >
              <option value="">—</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {productName(product, locale)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {productId && (
          <RecipeEditor
            ingredients={catalog.ingredients}
            labels={labels}
            onSave={saveRecipe}
            recipe={recipe}
          />
        )}{" "}
        {recipe?.estimate && (
          <Estimate
            estimate={recipe.estimate}
            ingredients={byId}
            labels={labels}
            money={money}
          />
        )}
      </section>
    </main>
  );
}

function RecipeEditor({
  ingredients,
  labels,
  onSave,
  recipe,
}: {
  ingredients: Ingredient[];
  labels: CostLabels;
  onSave: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  recipe: RecipeResult | null;
}) {
  const initial =
    recipe?.recipe?.ingredients ??
    (ingredients[0]
      ? [{ ingredientId: ingredients[0].id, quantityBaseUnits: 1 }]
      : []);
  const [items, setItems] = useState(initial);
  useEffect(() => setItems(initial), [recipe]);
  return (
    <form
      className="costs-recipe-form"
      onSubmit={(event) => void onSave(event)}
    >
      <div className="costs-inline">
        <label>
          {labels.yield}
          <input
            defaultValue={(recipe?.recipe?.yieldBasisPoints ?? 10000) / 100}
            min="0.01"
            name="yield"
            required
            step="0.01"
            type="number"
          />
        </label>
        <label>
          {labels.wastage}
          <input
            defaultValue={(recipe?.recipe?.wastageBasisPoints ?? 0) / 100}
            min="0"
            name="wastage"
            required
            step="0.01"
            type="number"
          />
        </label>
      </div>
      {items.map((item, index) => (
        <div
          className="costs-ingredient-row"
          key={`${item.ingredientId}-${index}`}
        >
          <label>
            {labels.ingredient}
            <select
              name="ingredientId"
              onChange={(event) =>
                setItems(
                  items.map((entry, itemIndex) =>
                    itemIndex === index
                      ? { ...entry, ingredientId: event.target.value }
                      : entry,
                  ),
                )
              }
              value={item.ingredientId}
            >
              {ingredients.map((ingredient) => (
                <option key={ingredient.id} value={ingredient.id}>
                  {ingredient.name} ({ingredient.baseUnit})
                </option>
              ))}
            </select>
          </label>
          <label>
            {labels.quantity}
            <input
              defaultValue={item.quantityBaseUnits}
              min="1"
              name="quantity"
              required
              type="number"
            />
          </label>
          <button
            disabled={items.length === 1}
            onClick={() =>
              setItems(items.filter((_, itemIndex) => itemIndex !== index))
            }
            type="button"
          >
            {labels.remove}
          </button>
        </div>
      ))}
      <div className="menu-form-actions">
        <button
          onClick={() =>
            setItems([
              ...items,
              { ingredientId: ingredients[0]?.id ?? "", quantityBaseUnits: 1 },
            ])
          }
          type="button"
        >
          + {labels.add}
        </button>
        <button
          className="button button-primary"
          disabled={!ingredients.length}
          type="submit"
        >
          {labels.save}
        </button>
      </div>
    </form>
  );
}

function Estimate({
  estimate,
  ingredients,
  labels,
  money,
}: {
  estimate: NonNullable<RecipeResult["estimate"]>;
  ingredients: Map<string, Ingredient>;
  labels: CostLabels;
  money: Intl.NumberFormat;
}) {
  if (!estimate.complete)
    return (
      <aside className="cost-estimate incomplete">
        <strong>{labels.incomplete}</strong>
        <span>
          {estimate.missingPriceIngredientIds
            .map((id) => ingredients.get(id)?.name ?? id)
            .join(", ")}
        </span>
      </aside>
    );
  return (
    <aside className="cost-estimate">
      <div>
        <span>{labels.direct}</span>
        <strong>{money.format((estimate.directCostMinor ?? 0) / 100)}</strong>
      </div>
      <div>
        <span>{labels.food}</span>
        <strong>
          {((estimate.foodCostBasisPoints ?? 0) / 100).toFixed(2)}%
        </strong>
      </div>
      <div>
        <span>{labels.contribution}</span>
        <strong>
          {money.format((estimate.grossContributionMinor ?? 0) / 100)}
        </strong>
      </div>
    </aside>
  );
}
