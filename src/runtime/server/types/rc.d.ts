// `#laioutr/rc` and `#laioutr/i18n-config` are Nitro server templates that frontend-core generates
// from the project's laioutrrc at build time — they exist as real files only once a full Nuxt build
// has run. The standalone nitro tsconfig used to typecheck this package's server runtime never runs
// that build, so these ambient declarations give the two virtual specifiers the shape frontend-core's
// own runtime produces for them.
declare module '#laioutr/rc' {
  import type { RcProject } from '@laioutr-core/core-types/rc';
  // frontend-core's sanitiser deletes `config` off `rcProject` before it reaches this process — the
  // real value arrives through public runtime config instead — so it is typed out here too, turning
  // a `rcProject.config` access into the compile error it would be at runtime.
  export const rcProject: Omit<RcProject, 'config'>;
}

declare module '#laioutr/i18n-config' {
  import type { RenderI18nConfig } from '@laioutr-core/core-types/rc';
  export const i18nConfig: RenderI18nConfig;
}
