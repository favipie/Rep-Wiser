import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Mirrors the "@/*" -> "./src/*" path in tsconfig.json so component tests can import like the app does.
export default defineConfig({ resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } } });
