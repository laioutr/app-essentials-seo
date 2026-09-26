import { defineEventHandler, setResponseHeader, setResponseStatus } from 'h3';

/** Stands in for an upstream error page that also sets a cookie meant for the browser that hit it directly. */
export default defineEventHandler((event) => {
  setResponseHeader(event, 'content-type', 'text/html; charset=utf-8');
  setResponseHeader(event, 'set-cookie', 'session=leaked; Path=/');
  setResponseStatus(event, 500);
  return '<!DOCTYPE html><html><body>Internal Server Error</body></html>';
});
