import { defineTool } from '@deepseek-ai/dsh-tools';
export const inject = ['tools'];
export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'herein_hello', description: 'Return a greeting for the DSH bridge demo.',
    parameters: { name: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: args => `hello ${args.name} (v1)`
  }));
}
