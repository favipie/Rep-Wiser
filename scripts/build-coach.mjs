import { build } from 'esbuild';
await build({ stdin: { contents: "export { createCoachHandler } from './src/lib/coach/handler'; export { createCoachGenerator } from './src/lib/coach/provider';", resolveDir: process.cwd() }, bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', external: ['ai'], outfile: 'supabase/functions/ask-repwise/_shared/coach.js' });
console.log('Built Supabase coach bundle from the same validated engine used by the app.');
