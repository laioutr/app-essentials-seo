// No global augmentations remain here. `RuntimeConfig[MODULE_NAME]` is not hand-declared: Nuxt
// generates its own type for that key from the actual runtime value (see .nuxt/types/schema.d.ts),
// widening every enum and typed array to its plain JS type, and TypeScript rejects two declarations
// of the same interface property that don't line up exactly (TS2717). A hand-written, more precise
// type can never match that generated one once the module assigns a real ResolvedOptions value, so
// callers that need the literal-typed shape (see Task 12) should import `ResolvedOptions` from
// `./types` and `SitemapSourceDescriptor` from `./runtime/shared/toUpstreamConfig` and cast locally.
// `PublicRuntimeConfig[MODULE_NAME]` is dropped outright: nothing in this module ever populates it.
export {};
