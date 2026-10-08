import { z } from 'zod';

export const USER_ID_PATTERN = /^[A-Za-z0-9_.:@|-]{1,128}$/;

export const userIdSchema = z.string().regex(USER_ID_PATTERN, 'user id must be 1-128 characters (letters, numbers, _ . : @ | -)');

const qualitySchema = z
  .object({
    lightingScore: z.number().finite().min(0).max(100).optional(),
    lighting: z.number().finite().min(0).max(100).optional(),
    brightness: z.number().finite().min(0).max(100).optional(),
    sharpnessScore: z.number().finite().min(0).max(100).optional(),
    sharpness: z.number().finite().min(0).max(100).optional(),
    blur: z.number().finite().min(0).max(100).optional(),
    noise: z.number().finite().min(0).max(100).optional(),
    confidence: z.number().finite().min(0).max(100).optional(),
  })
  .strip();

export const historyItemSchema = z
  .object({
    analysis: z.record(z.string(), z.unknown()),
    activeSelections: z.record(z.string(), z.unknown()).optional().default({}),
    productLists: z.array(z.unknown()).nullable().optional(),
    customRoutineGroup: z.array(z.unknown()).nullable().optional(),
    meta: z
      .object({
        ts: z.number().finite().optional(),
        image: z.string().max(2000).optional(),
        quality: qualitySchema.optional(),
      })
      .strip()
      .optional(),
  })
  .strip();

export type HistoryItemInput = z.infer<typeof historyItemSchema>;
