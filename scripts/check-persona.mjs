import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { loadPersonaPacks, resolvePersonaRoot } = require('../dist-electron/persona/loader.js');

const root = process.argv[2] ? path.resolve(process.argv[2]) : resolvePersonaRoot();
const packs = await loadPersonaPacks(root).catch(error => {
  console.error(`persona pack check failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});

if (packs.size === 0) {
  console.log(`no persona packs under ${root}`);
  process.exit(0);
}

for (const pack of packs.values()) {
  const layers = [...pack.templates.values()].map(template => template.ref.layer).join(',');
  console.log(
    `${pack.manifest.id}@${pack.manifest.version} `
    + `templates=${pack.templates.size} layers=${layers} character=${pack.character.id}`,
  );
}

console.log(`persona packs ok (${packs.size})`);
