import { defineConfig, globalIgnores } from 'eslint/config';
import next from 'eslint-config-next/core-web-vitals';
import ts from 'eslint-config-next/typescript';
export default defineConfig([...next,...ts,{rules:{'react-hooks/set-state-in-effect':'off','@next/next/no-img-element':'off'}},globalIgnores(['out/**','.next/**','supabase/functions/ask-repwise/_shared/**'])]);
