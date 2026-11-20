// Gera schemas/cli/*.schema.json a partir de src/cli/schema.ts (fonte única). Rode: npx tsx scripts/gerar-schemas-cli.mjs
import { writeFileSync } from 'node:fs';
import { SCHEMA_CONFIG, SCHEMA_NOTA } from '../src/cli/schema.ts';

writeFileSync(new URL('../schemas/cli/nota.schema.json', import.meta.url), `${JSON.stringify(SCHEMA_NOTA, null, 2)}\n`);
writeFileSync(new URL('../schemas/cli/config.schema.json', import.meta.url), `${JSON.stringify(SCHEMA_CONFIG, null, 2)}\n`);
console.log('schemas/cli atualizados');
