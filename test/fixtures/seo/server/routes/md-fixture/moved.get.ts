import { defineEventHandler, sendRedirect } from 'h3';

export default defineEventHandler((event) => sendRedirect(event, '/md-fixture/page', 302));
