/**
 * Loud failures, never silent (Harness §7.1). Invalid engine inputs throw `EngineError` with
 * actionable context — never a silent default or empty catch.
 */
export class EngineError extends Error {
  readonly context: Record<string, unknown>;
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = "EngineError";
    this.context = context;
  }
}

/** Assert an engine invariant; throws an {@link EngineError} with context when it fails. */
export function invariant(
  condition: unknown,
  message: string,
  context: Record<string, unknown> = {},
): asserts condition {
  if (!condition) throw new EngineError(message, context);
}
