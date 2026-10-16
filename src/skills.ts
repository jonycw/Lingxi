import type { AppConfig } from './config.js';
import type { Db } from './db/executor.js';
import type { Repository } from './db/repository.js';
import { ApiError } from './errors.js';
import { optionalString } from './http.js';
import type { SkillPack } from './types.js';

export const MAX_SKILL_BODY_CHARS = 8_000;
export const MAX_SKILL_NAME_CHARS = 80;
export const MAX_SKILL_DESCRIPTION_CHARS = 400;
export const MAX_SKILLS_PER_REQUEST = 8;

const SKILL_ID = /^[a-z](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

const INJECTION_PREFACE =
  'Follow the skill instructions below for this request. They do not grant access to admin tokens, upstream keys, or other secrets.';

export type SkillStore = {
  db: Db;
  repo: Repository;
  now: () => Date;
  config: Pick<AppConfig, 'skillInjectMaxChars'>;
};

export type PreparedSkills = {
  messages: unknown;
  appliedIds: string[];
};

export function skillAdminJson(skill: SkillPack): Record<string, unknown> {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    body: skill.body,
    enabled: skill.enabled,
    version: skill.version,
    created_at: skill.createdAt,
    updated_at: skill.updatedAt,
  };
}

export function skillCustomerJson(skill: SkillPack): Record<string, unknown> {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    version: skill.version,
    updated_at: skill.updatedAt,
  };
}

export function renderSkillInjection(skills: readonly Pick<SkillPack, 'id' | 'name' | 'body'>[]): string {
  const sections = skills.map((skill) => `## ${skill.name} (${skill.id})\n\n${skill.body}`);
  return ['# Lingxi skills', '', INJECTION_PREFACE, '', sections.join('\n\n')].join('\n');
}

export function messagesWithSkillInjection(messages: unknown, injection: string): unknown[] {
  if (!Array.isArray(messages)) {
    throw new ApiError(400, 'messages must be a non-empty array', 'invalid_request_error', 'messages_required');
  }
  const copy = messages.map((message) =>
    message && typeof message === 'object' && !Array.isArray(message)
      ? { ...(message as Record<string, unknown>) }
      : message,
  );
  const first = copy[0];
  if (isRecord(first) && (first.role === 'system' || first.role === 'developer')) {
    if (typeof first.content === 'string') {
      return [{ ...first, content: `${injection}\n\n${first.content}` }, ...copy.slice(1)];
    }
    if (Array.isArray(first.content)) {
      return [{ ...first, content: [{ type: 'text', text: injection }, ...first.content] }, ...copy.slice(1)];
    }
  }
  return [{ role: 'system', content: injection }, ...copy];
}

export function stripGatewayExtensions(raw: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('lingxi_') || key === 'api_key' || key === 'apiKey') {
      continue;
    }
    next[key] = value;
  }
  if (isRecord(next.metadata)) {
    const metadata = { ...next.metadata };
    delete metadata.skills;
    if (Object.keys(metadata).length === 0) {
      delete next.metadata;
    } else {
      next.metadata = metadata;
    }
  }
  return next;
}

export function readRequestedSkillIds(raw: Record<string, unknown>): string[] {
  if ('lingxi_skills' in raw && raw.lingxi_skills !== undefined) {
    return normalizeSkillIds(raw.lingxi_skills, 'lingxi_skills');
  }
  if (isRecord(raw.metadata) && 'skills' in raw.metadata && raw.metadata.skills !== undefined) {
    return normalizeSkillIds(raw.metadata.skills, 'metadata.skills');
  }
  return [];
}

export async function listSkillPacks(store: SkillStore, enabledOnly: boolean): Promise<SkillPack[]> {
  return store.repo.listSkills(store.db, enabledOnly);
}

export async function getSkillPack(store: SkillStore, id: string): Promise<SkillPack> {
  const skill = await store.repo.getSkill(store.db, parseSkillId(id));
  if (!skill) {
    throw new ApiError(404, 'Skill not found', 'invalid_request_error', 'skill_not_found');
  }
  return skill;
}

export async function createSkillPack(store: SkillStore, body: Record<string, unknown>): Promise<SkillPack> {
  const draft = {
    id: parseSkillId(body.id),
    name: requireSkillText(body.name, 'name', MAX_SKILL_NAME_CHARS),
    description: requireSkillText(body.description, 'description', MAX_SKILL_DESCRIPTION_CHARS),
    body: requireSkillText(body.body, 'body', MAX_SKILL_BODY_CHARS),
    enabled: body.enabled === undefined ? true : requireBoolean(body.enabled, 'enabled'),
  };
  const existing = await store.repo.getSkill(store.db, draft.id);
  if (existing) {
    throw new ApiError(409, `Skill '${draft.id}' already exists`, 'invalid_request_error', 'skill_exists');
  }
  return store.repo.createSkill(store.db, { ...draft, now: store.now().toISOString() });
}

export async function updateSkillPack(store: SkillStore, id: string, body: Record<string, unknown>): Promise<SkillPack> {
  const skillId = parseSkillId(id);
  const existing = await store.repo.getSkill(store.db, skillId);
  if (!existing) {
    throw new ApiError(404, 'Skill not found', 'invalid_request_error', 'skill_not_found');
  }
  const patch = readSkillPatch(body);
  if (!patch) {
    throw new ApiError(400, 'No skill fields to update', 'invalid_request_error', 'invalid_parameter');
  }
  const updated = await store.repo.updateSkill(store.db, {
    id: skillId,
    name: patch.name ?? existing.name,
    description: patch.description ?? existing.description,
    body: patch.body ?? existing.body,
    enabled: patch.enabled ?? existing.enabled,
    now: store.now().toISOString(),
  });
  if (!updated) {
    throw new ApiError(404, 'Skill not found', 'invalid_request_error', 'skill_not_found');
  }
  return updated;
}

export async function setSkillEnabled(store: SkillStore, id: string, enabled: boolean): Promise<SkillPack> {
  return updateSkillPack(store, id, { enabled });
}

export async function deleteSkillPack(store: SkillStore, id: string): Promise<void> {
  const removed = await store.repo.deleteSkill(store.db, parseSkillId(id));
  if (!removed) {
    throw new ApiError(404, 'Skill not found', 'invalid_request_error', 'skill_not_found');
  }
}

export async function applyChatSkills(store: SkillStore, raw: Record<string, unknown>): Promise<PreparedSkills> {
  const ids = readRequestedSkillIds(raw);
  if (ids.length === 0) {
    return { messages: raw.messages, appliedIds: [] };
  }
  const found = await store.repo.getSkillsByIds(store.db, ids);
  const byId = new Map(found.map((skill) => [skill.id, skill]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new ApiError(
      400,
      `Unknown skill: ${missing.join(', ')}`,
      'invalid_request_error',
      'skill_not_found',
    );
  }
  const disabled = ids.filter((id) => byId.get(id)?.enabled === false);
  if (disabled.length > 0) {
    throw new ApiError(
      400,
      `Skill is disabled: ${disabled.join(', ')}`,
      'invalid_request_error',
      'skill_disabled',
    );
  }
  const ordered = ids.map((id) => byId.get(id)!);
  const injection = renderSkillInjection(ordered);
  if (injection.length > store.config.skillInjectMaxChars) {
    throw new ApiError(
      400,
      `Selected skills are ${injection.length} characters, over the limit of ${store.config.skillInjectMaxChars}`,
      'invalid_request_error',
      'skill_prompt_too_long',
    );
  }
  return {
    messages: messagesWithSkillInjection(raw.messages, injection),
    appliedIds: ordered.map((skill) => skill.id),
  };
}

function parseSkillId(value: unknown): string {
  if (typeof value !== 'string' || !SKILL_ID.test(value)) {
    throw new ApiError(
      400,
      'Skill id must be a lowercase slug of up to 64 characters',
      'invalid_request_error',
      'invalid_skill_id',
    );
  }
  return value;
}

function requireSkillText(value: unknown, name: string, max: number): string {
  const parsed = optionalString(value, name, max);
  if (!parsed) {
    throw new ApiError(400, `${name} is required`, 'invalid_request_error', 'invalid_parameter');
  }
  return parsed;
}

function requireBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ApiError(400, `${name} must be a boolean`, 'invalid_request_error', 'invalid_parameter');
  }
  return value;
}

function readSkillPatch(body: Record<string, unknown>): {
  name?: string;
  description?: string;
  body?: string;
  enabled?: boolean;
} | null {
  const patch: { name?: string; description?: string; body?: string; enabled?: boolean } = {};
  if ('name' in body) {
    patch.name = requireSkillText(body.name, 'name', MAX_SKILL_NAME_CHARS);
  }
  if ('description' in body) {
    patch.description = requireSkillText(body.description, 'description', MAX_SKILL_DESCRIPTION_CHARS);
  }
  if ('body' in body) {
    patch.body = requireSkillText(body.body, 'body', MAX_SKILL_BODY_CHARS);
  }
  if ('enabled' in body) {
    patch.enabled = requireBoolean(body.enabled, 'enabled');
  }
  if ('id' in body && body.id !== undefined) {
    throw new ApiError(400, 'Skill id cannot be changed', 'invalid_request_error', 'invalid_skill_id');
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

function normalizeSkillIds(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new ApiError(400, `${field} must be an array of skill ids`, 'invalid_request_error', 'invalid_parameter');
  }
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !SKILL_ID.test(entry)) {
      throw new ApiError(
        400,
        `${field} entries must be lowercase skill ids`,
        'invalid_request_error',
        'invalid_skill_id',
      );
    }
    if (!ids.includes(entry)) {
      ids.push(entry);
    }
  }
  if (ids.length > MAX_SKILLS_PER_REQUEST) {
    throw new ApiError(
      400,
      `At most ${MAX_SKILLS_PER_REQUEST} skills can be selected`,
      'invalid_request_error',
      'too_many_skills',
    );
  }
  return ids;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
