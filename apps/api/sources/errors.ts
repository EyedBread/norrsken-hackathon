export class SourceFailure extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SourceFailure';
    this.code = code;
  }
}

export function checkContext(ctx: { deadlineAt: number; signal: AbortSignal }): void {
  if (ctx.signal.aborted) throw new SourceFailure('ABORTED', 'Request was cancelled.');
  if (!Number.isFinite(ctx.deadlineAt) || Date.now() >= ctx.deadlineAt) {
    throw new SourceFailure('TIMEOUT', 'Source deadline exceeded.');
  }
}

export function boundedSignal(ctx: { deadlineAt: number; signal: AbortSignal }, maxMs = 60000): AbortSignal {
  checkContext(ctx);
  return AbortSignal.any([ctx.signal, AbortSignal.timeout(Math.max(1, Math.min(maxMs, Math.ceil(ctx.deadlineAt - Date.now()))))]);
}

export function sourceError(source: string, error: unknown, ctx: { deadlineAt: number; signal: AbortSignal }) {
  if (ctx.signal.aborted) return { source, code: 'ABORTED', message: 'Request was cancelled.' };
  if (Date.now() >= ctx.deadlineAt || (error instanceof Error && error.name === 'TimeoutError')) {
    return { source, code: 'TIMEOUT', message: 'Source deadline exceeded.' };
  }
  if (error instanceof SourceFailure) return { source, code: error.code, message: error.message };
  // Never propagate arbitrary upstream error bodies: they can contain credentials or URLs.
  return { source, code: 'SOURCE_UNAVAILABLE', message: 'Source request failed. Try again later.' };
}
