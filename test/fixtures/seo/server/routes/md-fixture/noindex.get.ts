import { defineEventHandler, setResponseHeader } from 'h3';

export default defineEventHandler((event) => {
  setResponseHeader(event, 'content-type', 'text/html; charset=utf-8');
  return '<!DOCTYPE html><html><head><title>Hidden</title><meta name="robots" content="noindex, follow"></head><body><h1>Hidden</h1></body></html>';
});
