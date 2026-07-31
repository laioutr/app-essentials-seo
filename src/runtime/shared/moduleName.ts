/**
 * Package name, Nuxt config key, and the prefix every diagnostic this module logs carries.
 *
 * It lives here rather than beside the option schema because runtime code needs it as a *value*:
 * importing it from a module that also defines the zod schema would pull zod into the nitro bundle,
 * where it is never used. `../../types` re-exports this so build-time code has one name to import.
 */
export const MODULE_NAME = '@laioutr/app-essentials-seo';
