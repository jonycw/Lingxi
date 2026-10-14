import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { computeCostMicros } from '../src/billingCost.js';
import { toPostgresPlaceholders } from '../src/db/placeholders.js';
import { resolveSqlitePath } from '../src/paths.js';

describe('billing math and portable SQL', () => {
  test('charges ceil(tokens * price / 1_000_000) in micros', () => {
    expect(computeCostMicros(0, 0, 1_000_000, 4_000_000)).toBe(0);
    expect(computeCostMicros(2, 3, 1_000_000, 4_000_000)).toBe(2 + 12);
    expect(computeCostMicros(1, 1, 1, 1)).toBe(2);
    expect(computeCostMicros(1_500_000, 10, 2_000_000, 1_000_000)).toBe(3_000_000 + 10);
  });

  test('converts sqlite placeholders without touching quoted question marks', () => {
    expect(toPostgresPlaceholders("SELECT * FROM t WHERE a = ? AND note = '?' AND b = ?")).toBe(
      "SELECT * FROM t WHERE a = $1 AND note = '?' AND b = $2",
    );
  });

  test('resolves sqlite file URLs', () => {
    expect(resolveSqlitePath(':memory:')).toBe(':memory:');
    expect(resolveSqlitePath('file::memory:')).toBe(':memory:');
    expect(resolveSqlitePath('file:./data/lingxi.sqlite')).toBe(path.resolve('data/lingxi.sqlite'));
    expect(resolveSqlitePath('file:/tmp/lingxi.sqlite')).toBe('/tmp/lingxi.sqlite');
    expect(resolveSqlitePath('file:///tmp/lingxi.sqlite')).toBe('/tmp/lingxi.sqlite');
  });
});
