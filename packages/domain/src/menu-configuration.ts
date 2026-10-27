import { PLATFORM_LOCALES, type PlatformLocale } from "./locale";

type LocalizedName = {
  locale: PlatformLocale;
  name: string;
};

export type MenuVariantConfiguration = {
  priceDeltaMinor: number;
  sortOrder: number;
  available: boolean;
  isDefault: boolean;
  translations: LocalizedName[];
};

export type MenuModifierOptionConfiguration = {
  priceDeltaMinor: number;
  sortOrder: number;
  available: boolean;
  translations: LocalizedName[];
};

export type MenuModifierGroupConfiguration = {
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  translations: LocalizedName[];
  options: MenuModifierOptionConfiguration[];
};

export type ProductMenuConfiguration = {
  basePriceMinor: number;
  variants: MenuVariantConfiguration[];
  modifierGroups: MenuModifierGroupConfiguration[];
};

export class MenuConfigurationInvalidError extends Error {
  constructor(public readonly issues: string[]) {
    super("The product configuration is invalid");
    this.name = "MenuConfigurationInvalidError";
  }
}

function completeTranslations(translations: LocalizedName[]) {
  return (
    translations.length === PLATFORM_LOCALES.length &&
    PLATFORM_LOCALES.every((locale) =>
      translations.some(
        (translation) =>
          translation.locale === locale && translation.name.trim().length > 0,
      ),
    )
  );
}

export function productMenuConfigurationIssues(
  configuration: ProductMenuConfiguration,
) {
  const issues: string[] = [];
  const defaults = configuration.variants.filter(
    (variant) => variant.isDefault,
  );

  if (configuration.variants.length > 0 && defaults.length !== 1) {
    issues.push("VARIANT_DEFAULT_REQUIRED");
  }

  for (const variant of configuration.variants) {
    if (
      !Number.isInteger(variant.priceDeltaMinor) ||
      configuration.basePriceMinor + variant.priceDeltaMinor < 0
    ) {
      issues.push("VARIANT_PRICE_INVALID");
    }
    if (!Number.isInteger(variant.sortOrder) || variant.sortOrder < 0) {
      issues.push("VARIANT_SORT_ORDER_INVALID");
    }
    if (!completeTranslations(variant.translations)) {
      issues.push("VARIANT_TRANSLATIONS_INCOMPLETE");
    }
  }

  for (const group of configuration.modifierGroups) {
    if (
      !Number.isInteger(group.minSelect) ||
      !Number.isInteger(group.maxSelect) ||
      group.minSelect < 0 ||
      group.maxSelect < group.minSelect ||
      group.maxSelect > group.options.length
    ) {
      issues.push("MODIFIER_SELECTION_LIMITS_INVALID");
    }
    if (!Number.isInteger(group.sortOrder) || group.sortOrder < 0) {
      issues.push("MODIFIER_GROUP_SORT_ORDER_INVALID");
    }
    if (!completeTranslations(group.translations)) {
      issues.push("MODIFIER_GROUP_TRANSLATIONS_INCOMPLETE");
    }
    for (const option of group.options) {
      if (
        !Number.isInteger(option.priceDeltaMinor) ||
        option.priceDeltaMinor < 0
      ) {
        issues.push("MODIFIER_PRICE_INVALID");
      }
      if (!Number.isInteger(option.sortOrder) || option.sortOrder < 0) {
        issues.push("MODIFIER_OPTION_SORT_ORDER_INVALID");
      }
      if (!completeTranslations(option.translations)) {
        issues.push("MODIFIER_OPTION_TRANSLATIONS_INCOMPLETE");
      }
    }
  }

  return [...new Set(issues)];
}

export function assertProductMenuConfiguration(
  configuration: ProductMenuConfiguration,
) {
  const issues = productMenuConfigurationIssues(configuration);
  if (issues.length) throw new MenuConfigurationInvalidError(issues);
}
