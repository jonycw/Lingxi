import { readFileSync, statSync } from 'node:fs';
import type { ModelDefinition } from './types.js';

const MAX_PRICE = 1_000_000_000_000_000;

export type ModelCatalog = {
  list: () => ModelDefinition[];
};

function parseModel(value: unknown, index: number): ModelDefinition {
  if (!value || typeof value !== 'object') {
    throw new Error(`Model config entry ${index} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const id = record.id;
  const upstream = record.upstream;
  if (typeof id !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(id)) {
    throw new Error(`Model config entry ${index} has an invalid id`);
  }
  if (typeof upstream !== 'string' || upstream.trim().length === 0 || upstream.length > 128) {
    throw new Error(`Model ${id} has an invalid upstream name`);
  }
  const input = record.input_micros_per_million;
  const output = record.output_micros_per_million;
  if (typeof input !== 'number' || !Number.isInteger(input) || input < 0 || input > MAX_PRICE) {
    throw new Error(`Model ${id} has an invalid input_micros_per_million`);
  }
  if (typeof output !== 'number' || !Number.isInteger(output) || output < 0 || output > MAX_PRICE) {
    throw new Error(`Model ${id} has an invalid output_micros_per_million`);
  }
  const owned = record.owned_by;
  return {
    id,
    upstream: upstream.trim(),
    ownedBy: typeof owned === 'string' && owned.trim() ? owned.trim().slice(0, 64) : 'lingxi',
    inputMicrosPerMillion: input,
    outputMicrosPerMillion: output,
    enabled: record.enabled !== false,
  };
}

export function createModelCatalog(filePath: string): ModelCatalog {
  let cache: { mtimeMs: number; models: ModelDefinition[] } | null = null;

  const load = (): ModelDefinition[] => {
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(filePath).mtimeMs;
    } catch {
      if (cache) {
        return cache.models;
      }
      throw new Error(`Model config not found: ${filePath}`);
    }
    if (cache && cache.mtimeMs === mtimeMs) {
      return cache.models;
    }
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { models?: unknown };
      if (!parsed || !Array.isArray(parsed.models) || parsed.models.length === 0) {
        throw new Error('Model config must be a JSON object with a non-empty models array');
      }
      const models = parsed.models.map((entry, index) => parseModel(entry, index));
      const seen = new Set<string>();
      for (const model of models) {
        if (seen.has(model.id)) {
          throw new Error(`Duplicate model id: ${model.id}`);
        }
        seen.add(model.id);
      }
      cache = { mtimeMs, models };
      return models;
    } catch (error) {
      if (cache) {
        return cache.models;
      }
      throw error;
    }
  };

  return { list: load };
}

export function findModel(catalog: ModelCatalog, id: string): ModelDefinition | undefined {
  return catalog.list().find((model) => model.id === id);
}
