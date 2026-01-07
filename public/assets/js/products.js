// Product catalog (local demo). In production this can come from your backend.
//
// Key rules:
// - product_id is stored with the token and must not be switchable in the UI
// - theme_id is derived from product_id and applied as a body class (theme-*)
//
// Slugs are for human-friendly links like /activate/?product=christmas
export const PRODUCTS = {
  "demo-default": {
    id: "demo-default",
    slug: "default",
    name: "ChicCanto scratch card",
    theme_id: "theme-default",
    fields: 9
  },
  "demo-christmas": {
    id: "demo-christmas",
    slug: "christmas",
    name: "Christmas scratch card (preview)",
    theme_id: "theme-christmas",
    fields: 9
  },
  "demo-couples": {
    id: "demo-couples",
    slug: "couples",
    name: "Couples scratch card (preview)",
    theme_id: "theme-couples",
    fields: 9
  }
};

export const DEFAULT_PRODUCT_ID = "demo-default";

export function getProductById(id){
  return (id && PRODUCTS[id]) ? PRODUCTS[id] : PRODUCTS[DEFAULT_PRODUCT_ID];
}

export function getProductBySlug(slug){
  if (!slug) return PRODUCTS[DEFAULT_PRODUCT_ID];
  const s = String(slug).trim().toLowerCase();
  for (const id in PRODUCTS){
    const p = PRODUCTS[id];
    if (p && p.slug === s) return p;
  }
  return PRODUCTS[DEFAULT_PRODUCT_ID];
}
