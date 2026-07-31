/**
 * Test-only steering for the fake page index. One server serves a whole suite, so behaviour a test
 * wants to vary has to be switchable at request time rather than baked in at build time.
 */
export const pageIndexControl = {
  /** Passes still to fail before the handler starts succeeding. Decremented as they fail. */
  failPasses: 0,
};
