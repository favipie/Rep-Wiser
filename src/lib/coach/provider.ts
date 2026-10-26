import { createGateway, generateText, Output } from 'ai';
import { coachOutputSchema } from './contracts';

export function createCoachGenerator(apiKey: string, model: string) {
  if (!apiKey || !/^(openai|google)\/[a-zA-Z0-9._-]+$/.test(model)) throw new Error('Configure a supported gateway model and server API key.');
  const gateway = createGateway({ apiKey });
  return async (system: string, prompt: string, abortSignal: AbortSignal) => {
    const result = await generateText({ model: gateway(model), system, prompt, output: Output.object({ schema: coachOutputSchema }), maxOutputTokens: 1400, maxRetries: 0, abortSignal });
    return coachOutputSchema.parse(result.output);
  };
}
