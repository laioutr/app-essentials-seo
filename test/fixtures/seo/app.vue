<script setup lang="ts">
import { useHead, useRoute } from '#imports';

// A second source of schema.org nodes, as a section calling frontend-core's useStructuredData would be.
if (useRoute().query.node) {
  useHead({
    script: [
      {
        type: 'application/ld+json',
        key: 'schema-org-graph',
        nodes: [{ '@type': 'Question', name: 'Fixture question?', acceptedAnswer: { '@type': 'Answer', text: 'Yes.' } }],
      } as never,
    ],
  });
}
</script>

<template>
  <div>seo fixture</div>
</template>
