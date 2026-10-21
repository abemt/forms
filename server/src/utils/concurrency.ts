/**
 * Run `fn` over `items` with a fixed concurrency limit, preserving order of results.
 * Individual failures are captured and surfaced via the `errors` array so one bad
 * item never aborts the whole batch.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onSettled?: (index: number, result: R | undefined, error: Error | undefined) => void,
): Promise<{ results: (R | undefined)[]; errors: (Error | undefined)[] }> {
  const results: (R | undefined)[] = new Array(items.length).fill(undefined);
  const errors: (Error | undefined)[] = new Array(items.length).fill(undefined);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        const result = await fn(items[index], index);
        results[index] = result;
        onSettled?.(index, result, undefined);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        errors[index] = error;
        onSettled?.(index, undefined, error);
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker());
  await Promise.all(workers);
  return { results, errors };
}
