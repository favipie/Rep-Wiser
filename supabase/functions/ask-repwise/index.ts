import { createClient } from 'npm:@supabase/supabase-js@2.99.0';
import { createCoachHandler, createCoachGenerator } from './_shared/coach.js';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const gatewayKey = Deno.env.get('AI_GATEWAY_API_KEY') ?? '';
const model = Deno.env.get('REPWISE_COACH_MODEL') ?? '';
const enabled = Deno.env.get('REPWISE_COACH_ENABLED') === 'true' && !!gatewayKey && /^(openai|google)\/[a-zA-Z0-9._-]+$/.test(model);
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const auth = createClient(url, anonKey, options);
const admin = createClient(url, serviceKey, options);
const generate = enabled ? createCoachGenerator(gatewayKey, model) : async () => { throw new Error('Not configured'); };

Deno.serve(createCoachHandler({
  enabled, model, generate,
  allowedOrigins: (Deno.env.get('REPWISE_ALLOWED_ORIGINS') ?? '').split(',').map(s => s.trim()).filter(Boolean),
  authenticate: async (jwt: string) => { const { data, error } = await auth.auth.getUser(jwt); return error || data.user?.is_anonymous ? null : data.user?.id ?? null; },
  reserve: async (userId: string) => { const { data, error } = await admin.rpc('reserve_coach_request', { p_user: userId }); if (error) throw new Error('Quota service unavailable'); return data === true; },
}));
