export async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  operation: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < items.length) {
        const item = items[cursor];
        cursor += 1;
        await operation(item);
      }
    })
  );
}
