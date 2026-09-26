import { defineNuxtPlugin, useHead, useRequestURL, useRuntimeConfig } from '#app';
import { markdownAlternatePath } from '../../shared/markdownPath';
import { MODULE_NAME } from '../../shared/moduleName';

// Server-only: crawlers read the SSR document, and the tags need no updating on client navigation.
export default defineNuxtPlugin(() => {
  const config = (useRuntimeConfig().public as Record<string, unknown>)[MODULE_NAME] as
    | { aiReady?: { enabled: boolean; describedby: boolean } }
    | undefined;
  if (!config?.aiReady?.enabled) return;

  const markdownPath = markdownAlternatePath(useRequestURL().pathname);
  if (!markdownPath) return;

  useHead({
    link: [
      { rel: 'alternate', type: 'text/markdown', href: markdownPath },
      ...(config.aiReady.describedby ? [{ rel: 'describedby', href: '/llms.txt' }] : []),
    ],
  });
});
