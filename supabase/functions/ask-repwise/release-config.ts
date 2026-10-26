// Public deployment configuration; provider credentials stay in Supabase secrets.
export const release = {
  projectUrl: 'https://tfoixojdhqibihoybxsv.supabase.co',
  model: 'openai/gpt-6-luna',
  origins: 'https://rep-wiser.vercel.app',
};
