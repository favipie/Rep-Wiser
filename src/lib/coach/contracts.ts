import { z } from 'zod';
import { snapshotSchema } from './context';
export const coachRequestSchema = z.object({
  question: z.string().trim().min(1).max(1500),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(3500) }).strict()).max(6),
  shareWorkouts: z.boolean(),
  snapshot: snapshotSchema.nullable(),
}).strict().refine(r => r.shareWorkouts === (r.snapshot !== null), 'Workout sharing must match consent.');
export const coachOutputSchema = z.object({
  answer: z.string().min(1).max(1800),
  possibleExplanations: z.array(z.string().max(350)).max(3),
  followUp: z.string().max(300),
  evidenceIds: z.array(z.string().max(60)).max(6),
  sourceIds: z.array(z.string().max(60)).max(5),
}).strict();
export type CoachOutput = z.infer<typeof coachOutputSchema>;
export type CoachRequest = z.infer<typeof coachRequestSchema>;
export const coachReplySchema = coachOutputSchema.extend({ context: z.object({ scope: z.string().max(1000), evidence: z.array(z.object({ id: z.string(), title: z.string(), facts: z.string(), guidance: z.string() })).max(11), limitations: z.array(z.string()).max(10) }).nullable(), model: z.string().max(150) });
export type CoachReply = z.infer<typeof coachReplySchema>;
