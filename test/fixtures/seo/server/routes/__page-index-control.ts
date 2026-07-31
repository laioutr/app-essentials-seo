import { defineEventHandler, readBody } from 'h3';
import { pageIndexControl } from '../utils/pageIndexControl';

/** Test-only steering of the fake page index. See ../utils/pageIndexControl. */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ failPasses?: number }>(event);
  pageIndexControl.failPasses = body?.failPasses ?? 0;
  return { failPasses: pageIndexControl.failPasses };
});
