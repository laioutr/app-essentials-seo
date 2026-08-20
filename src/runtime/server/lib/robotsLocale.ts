import type { RenderMarket } from '@laioutr-core/core-types/rc';
import { INTERNAL_DISALLOW } from '../../shared/toUpstreamConfig';

/**
 * An `Allow:`/`Disallow:` line, split into the parts needed to rebuild it. The value stops at the
 * first `#` so a trailing comment is not read as part of the rule; it is dropped from the copies,
 * which sit directly under the line that carries it.
 */
const RULE_LINE = /^(\s*)(allow|disallow)(\s*:\s*)([^#]*)/i;

/**
 * The domain path prefixes a host serves — `['/fr']` for a host whose German market sits at the root
 * and whose French one sits under `/fr`. The root is not listed: that is the rule as authored.
 *
 * Every market is scanned rather than only the one `hostToMarket` resolves, because robots.txt is
 * one document per host and has to cover everything served there, whichever market serves it. Host
 * matching mirrors `resolveHostContext`: a project configures one spelling and serves both.
 */
export const hostPathPrefixes = (markets: readonly RenderMarket[], host: string): string[] => {
  const bareHost = host.replace(/:\d+$/, '');
  const wwwAlt = bareHost.startsWith('www.') ? bareHost.slice(4) : `www.${bareHost}`;

  const prefixes = new Set<string>();
  for (const market of markets) {
    for (const domain of market.domains) {
      if (domain.host !== bareHost && domain.host !== wwwAlt && domain.devHost !== bareHost) continue;
      const prefix = (domain.path ?? '').replace(/\/+$/, '');
      if (prefix) prefixes.add(prefix);
    }
  }
  return [...prefixes];
};

/**
 * One rule, plus the same rule under each of the host's language prefixes.
 *
 * Additive only: the rule is repeated, never rewritten or moved, so nothing a project already
 * publishes stops applying where it applied before. Three kinds of rule are returned alone:
 *
 * - anything not starting with `/` — the empty value upstream seeds a wildcard group with, and
 *   `*`-leading patterns, which already span every prefix under RFC 9309;
 * - a rule already sitting under one of the prefixes, which the author scoped to that language on
 *   purpose. Note this is a decision not to follow @nuxtjs/robots, which strips a locale segment and
 *   re-adds every other one: that turns a deliberate `Disallow: /fr` into `Disallow: /`, taking the
 *   whole site out of search;
 * - this module's own internal disallows, which are Nitro routes at the app root and exist under no
 *   prefix at all.
 */
const localizeRule = (rule: string, prefixes: readonly string[]): string[] => {
  if (!rule.startsWith('/')) return [rule];
  if (INTERNAL_DISALLOW.includes(rule)) return [rule];
  if (prefixes.some((prefix) => rule === prefix || rule.startsWith(`${prefix}/`))) return [rule];
  return [rule, ...prefixes.map((prefix) => `${prefix}${rule}`)];
};

/**
 * Repeats every `Allow:`/`Disallow:` rule in a rendered robots.txt under each of the host's language
 * prefixes, so a rule written once covers a market's other languages too.
 *
 * Done on the rendered text, from the `robots:robots-txt` hook, rather than on the group objects the
 * earlier `robots:config` hook offers. That hook's payload is also what @nuxtjs/robots stores on
 * `nitroApp._robots.ctx` — a single process-wide value that `getPathRobotConfig` consults to set
 * `X-Robots-Tag` on ordinary page responses. One build serves every host here, so localizing that
 * payload would leave one host's prefixed rules deciding another host's page headers until the next
 * robots.txt request replaced them. The rendered text belongs to the one response it was built for.
 *
 * Every line that is not a rule is passed through untouched, and so is the original of every line
 * that is — the copies are appended below it. Whatever else is in the document — the credits
 * wrapper, `Content-Usage`/`Content-Signal` lines, `Sitemap:` lines, comments, dev hints — is
 * therefore unchanged.
 */
export const localizeRobotsTxt = (robotsTxt: string, prefixes: readonly string[]): string => {
  if (prefixes.length === 0) return robotsTxt;

  return robotsTxt
    .split('\n')
    .flatMap((line) => {
      const match = RULE_LINE.exec(line);
      if (!match) return [line];

      const [, indent = '', directive = '', separator = '', value = ''] = match;
      const [, ...copies] = localizeRule(value.trim(), prefixes);
      return [line, ...copies.map((rule) => `${indent}${directive}${separator}${rule}`)];
    })
    .join('\n');
};
