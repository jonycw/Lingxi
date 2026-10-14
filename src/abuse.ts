export type FailLimiter = {
  check: (key: string) => { limited: boolean; retryAfterSeconds: number };
};

export function createFailLimiter(limit: number, windowMs: number, now: () => number): FailLimiter {
  const buckets = new Map<string, { count: number; reset: number }>();
  return {
    check(key) {
      const time = now();
      if (buckets.size > 10_000) {
        for (const [bucketKey, bucket] of buckets) {
          if (bucket.reset <= time) {
            buckets.delete(bucketKey);
          }
        }
      }
      const existing = buckets.get(key);
      if (!existing || existing.reset <= time) {
        buckets.set(key, { count: 1, reset: time + windowMs });
        return { limited: false, retryAfterSeconds: 0 };
      }
      existing.count += 1;
      if (existing.count > limit) {
        return {
          limited: true,
          retryAfterSeconds: Math.max(1, Math.ceil((existing.reset - time) / 1000)),
        };
      }
      return { limited: false, retryAfterSeconds: 0 };
    },
  };
}
