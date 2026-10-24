import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Mirrors the "@/*" -> "./src/*" path in tsconfig.json so component tests can import like the app does.
export default defineConfig({ test: { include: ['src/**/*.test.{ts,tsx}'] }, resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } } });
