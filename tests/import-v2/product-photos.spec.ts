import { test } from "./browser-fixture";
import { productPhotoJourney } from "../product-media/journey";
test("product photography: menu, upload, camera, AI disabled, canonical POS and tenant isolation", async ({
  browser,
  page,
}) => {
  await productPhotoJourney(
    browser,
    page,
    "http://localhost:4302",
    "http://localhost:3502",
    "artifacts/product-photo-local",
  );
});
