// `#laioutr/rc` and `#laioutr/i18n-config` are Nitro server templates that frontend-core generates
// from the project's laioutrrc at build time — they exist as real files only once a full Nuxt build
// has run. The standalone nitro tsconfig used to typecheck this package's server runtime never runs
// that build, so these ambient declarations give the two virtual specifiers the shape frontend-core's
// own runtime produces for them.
declare module '#laioutr/rc' {
  import type { RcProject } from '@laioutr-core/core-types/rc';
  export const rcProject: RcProject;
}

declare module '#laioutr/i18n-config' {
  import type { RenderI18nConfig } from '@laioutr-core/core-types/rc';
  export const i18nConfig: RenderI18nConfig;
}
