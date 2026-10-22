/**
 * Prompt compilation primitives.
 *
 * The engine is public. Prompt content (persona, relationship, private rules)
 * lives in the private character pack and is never bundled here.
 */

export const PROMPT_LAYERS = [
  'L0_safety_identity',
  'L1_character_core',
  'L2_relationship',
  'L3_user_model',
  'L4_scene',
  'L5_task',
  'L6_output_contract',
] as const;

export type PromptLayer = typeof PROMPT_LAYERS[number];

export type PromptOutput = 'text' | 'json';

export interface PromptTemplate {
  id: string;
  version: string;
  layer: PromptLayer;
  template: string;
  output?: PromptOutput;
  schemaName?: string;
  requiredVariables?: string[];
}

export interface CompilePromptInput {
  templates: PromptTemplate[];
  variables: Record<string, unknown>;
}

export interface CompiledPrompt {
  text: string;
  layers: PromptLayer[];
  templates: Array<{ id: string; version: string; layer: PromptLayer }>;
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function promptVariables(template: string): string[] {
  const found = new Set<string>();

  for (const match of template.matchAll(PLACEHOLDER)) {
    found.add(match[1]);
  }

  return [...found];
}

function layerRank(layer: PromptLayer) {
  return PROMPT_LAYERS.indexOf(layer);
}

function renderTemplate(template: PromptTemplate, variables: Record<string, unknown>): string {
  return template.template.replace(PLACEHOLDER, (_match, name: string) => {
    const value = variables[name];

    if (value === undefined || value === null) {
      throw new Error(`Missing prompt variable "${name}" for template "${template.id}"`);
    }

    return String(value);
  });
}

export class PromptRegistry {
  private readonly templates = new Map<string, Map<string, PromptTemplate>>();

  register(template: PromptTemplate): this {
    const versions = this.templates.get(template.id) ?? new Map<string, PromptTemplate>();
    versions.set(template.version, template);
    this.templates.set(template.id, versions);
    return this;
  }

  get(id: string, version?: string): PromptTemplate {
    const versions = this.templates.get(id);

    if (!versions) {
      throw new Error(`Unknown prompt template "${id}"`);
    }

    const selected = version ? versions.get(version) : [...versions.values()].at(-1);

    if (!selected) {
      throw new Error(`Unknown version "${version}" for prompt template "${id}"`);
    }

    return selected;
  }

  render(id: string, variables: Record<string, unknown>, version?: string): string {
    return renderTemplate(this.get(id, version), variables);
  }

  list(): PromptTemplate[] {
    return [...this.templates.values()]
      .flatMap(versions => [...versions.values()])
      .sort((a, b) => layerRank(a.layer) - layerRank(b.layer) || a.id.localeCompare(b.id));
  }
}

export function compilePrompt(input: CompilePromptInput): CompiledPrompt {
  const templates = [...input.templates].sort(
    (a, b) => layerRank(a.layer) - layerRank(b.layer) || a.id.localeCompare(b.id),
  );

  const rendered = templates.map(template => ({
    template,
    text: renderTemplate(template, input.variables),
  }));

  return {
    text: rendered.map(item => item.text).join('\n\n'),
    layers: templates.map(template => template.layer),
    templates: templates.map(template => ({
      id: template.id,
      version: template.version,
      layer: template.layer,
    })),
  };
}
