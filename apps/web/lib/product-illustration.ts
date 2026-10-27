export type IllustrationKind =
  "pizza" | "pasta" | "salad" | "dessert" | "drink" | "coffee" | "plate";

/** Decorative category hints only: never claims about a dish's ingredients. */
export function illustrationKind(category: string): IllustrationKind {
  const name = category
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/pizza|pizze|pic[ae]/.test(name)) return "pizza";
  if (/pasta|pasten|nudel|makaron|spaghetti/.test(name)) return "pasta";
  if (/salad|salat|sallat|insalat/.test(name)) return "salad";
  if (/dessert|dolci|embels|su[ßs]speis|gelat/.test(name)) return "dessert";
  if (/coffee|kaffee|kafe|caffe|espresso/.test(name)) return "coffee";
  if (/drink|getrank|pije|bevande|cocktail|wine|wein|birr/.test(name))
    return "drink";
  return "plate";
}
