import type { ImportTransport } from "../../apps/api/src/business-import-network.js";
import { controlledMenuPdf, controlledMenuPng } from "../setup/fixtures.js";
import PDFDocument from "pdfkit";
export async function textMenuPdf() {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  doc
    .fontSize(16)
    .text("Garden plates")
    .moveDown()
    .text("Garden salad 9.50 EUR")
    .moveDown()
    .text("Seasonal soup 7.00 EUR");
  doc.end();
  return done;
}
export const fixtureOrigin = "https://bistro.example.com";
export const restaurantHtml = `<!doctype html><html><head><title>Garden Bistro</title><meta name="description" content="Seasonal food in the garden."><script type="application/ld+json">${JSON.stringify(
  {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: "Garden Bistro",
    description: "Seasonal food in the garden.",
    telephone: "+49 30 555 123",
    email: "hello@garden.example.com",
    address: {
      streetAddress: "Gartenweg 12",
      postalCode: "10115",
      addressLocality: "Berlin",
      addressCountry: "DE",
    },
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday", "Tuesday"],
        opens: "12:00",
        closes: "22:00",
      },
    ],
    sameAs: ["https://www.instagram.com/gardenbistro/"],
    logo: "/logo.png",
    image: "/dish.png",
    hasMenu: "/menu",
  },
)}</script></head><body><h1>Garden Bistro</h1><a href="/menu">Menu</a><a href="/contact">Contact</a><img src="/dish.png" alt="Garden salad"></body></html>`;
export const menuHtml = `<html><head><script type="application/ld+json">${JSON.stringify(
  {
    "@type": "Menu",
    hasMenuSection: [
      {
        "@type": "MenuSection",
        name: "Garden plates",
        hasMenuItem: [
          {
            "@type": "MenuItem",
            name: "Garden salad",
            description: "Lettuce and fresh herbs",
            offers: { "@type": "Offer", price: "9.50", priceCurrency: "EUR" },
            image: "/dish.png",
          },
          {
            "@type": "MenuItem",
            name: "Soup",
            description: "Daily vegetables",
            offers: { priceCurrency: "EUR" },
          },
        ],
      },
    ],
  },
)}</script></head><body><h1>Menu</h1></body></html>`;
export const wordpressHtml = `<html><head><meta name="generator" content="WordPress"><title>Our Menu</title></head><body><section><h2>Lunch</h2><div class="menu-item"><h3>Roast vegetables</h3><p>Seasonal plate</p><span class="price">12,50 €</span></div></section></body></html>`;
export const wixHtml = `<html><head><meta name="generator" content="Wix.com Website Builder"></head><body><section><h2>Pizza</h2><div itemscope itemtype="https://schema.org/MenuItem"><span itemprop="name">Margherita</span><span itemprop="description">Tomato and mozzarella</span><span itemprop="price" content="10.00"></span><meta itemprop="priceCurrency" content="EUR"></div></section></body></html>`;
export const javascriptHtml = `<html><head><title>JS menu</title></head><body><main id="menu"></main><script src="/menu.js"></script></body></html>`;
export const javascriptBundle = `document.querySelector('#menu').innerHTML = '<section><h2>Lunch</h2><div class="menu-item"><h3>Rendered soup</h3><span class="price">6.50 EUR</span></div></section>'; fetch('http://169.254.169.254/latest/meta-data/').catch(()=>{});`;
export function controlledWebsiteTransport(): ImportTransport {
  return async (url) => {
    if (url.hostname !== "bistro.example.com")
      throw new Error("Unrecognized fixture host");
    if (url.pathname === "/robots.txt")
      return {
        status: 200,
        type: "text/plain",
        bytes: Buffer.from("User-agent: *\nAllow: /\nDisallow: /private"),
      };
    const pages: Record<string, string> = {
      "/": restaurantHtml,
      "/menu": menuHtml,
      "/contact":
        "<h1>Contact</h1><a href='mailto:hello@garden.example.com'>Email</a>",
      "/wordpress": wordpressHtml,
      "/wix": wixHtml,
      "/js": javascriptHtml,
      "/pdf": '<h1>Menu</h1><a href="/menu.pdf">PDF menu</a>',
      "/text-pdf": '<h1>Menu</h1><a href="/text-menu.pdf">PDF menu</a>',
    };
    if (url.pathname === "/text-menu.pdf")
      return {
        status: 200,
        type: "application/pdf",
        bytes: await textMenuPdf(),
      };
    if (url.pathname === "/menu.pdf")
      return {
        status: 200,
        type: "application/pdf",
        bytes: await controlledMenuPdf(),
      };
    if (url.pathname === "/dish.png" || url.pathname === "/logo.png")
      return {
        status: 200,
        type: "image/png",
        bytes: await controlledMenuPng(),
      };
    if (url.pathname === "/menu.js")
      return {
        status: 200,
        type: "application/javascript",
        bytes: Buffer.from(javascriptBundle),
      };
    if (pages[url.pathname])
      return {
        status: 200,
        type: "text/html",
        bytes: Buffer.from(pages[url.pathname]!),
      };
    return { status: 404, type: "text/plain", bytes: Buffer.from("Not found") };
  };
}
