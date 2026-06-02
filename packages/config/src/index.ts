import type { ZodTypeAny, z } from 'zod';

export class EnvValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: unknown,
  ) {
    super(message);
    this.name = 'EnvValidationError';
  }
}

/**
 * Validate `process.env` against a Zod schema and return the typed result.
 *
 * Fails loudly at startup with a flat list of issues — that is the whole
 * point. No service should be reading `process.env` directly.
 */
export function loadEnv<TSchema extends ZodTypeAny>(
  schema: TSchema,
  source: NodeJS.ProcessEnv = process.env,
): z.infer<TSchema> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const flat = result.error.flatten();
    throw new EnvValidationError(`Invalid environment: ${JSON.stringify(flat.fieldErrors)}`, flat);
  }
  return result.data;
}
