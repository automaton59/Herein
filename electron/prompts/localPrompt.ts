import { readFile } from 'node:fs/promises';
import path from 'node:path';

const cache = new Map<string, string | null>();

export function resolvePrivatePromptDir() {
  return path.resolve(
    process.env.HEREIN_PRIVATE_PROMPTS_DIR
      ?? path.join(process.cwd(), 'private', 'prompts', 'v0'),
  );
}

/**
 * Private prompt content is loaded at runtime from the private layer. Public
 * code only knows the slot name; it never embeds persona or product text.
 */
export async function loadPrivatePrompt(name: string): Promise<string | null> {
  if (cache.has(name)) {
    return cache.get(name) ?? null;
  }

  try {
    const text = await readFile(path.join(resolvePrivatePromptDir(), `${name}.md`), 'utf8');
    const trimmed = text.trim();
    const value = trimmed.length > 0 ? trimmed : null;
    cache.set(name, value);
    return value;
  } catch {
    cache.set(name, null);
    return null;
  }
}

export function renderPrivatePrompt(template: string, variables: Record<string, string>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, name: string) => {
    return variables[name] ?? match;
  });
}
