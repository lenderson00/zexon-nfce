import { defineConfig } from 'tsup';

const aviso = '/*! @zexon/nfce | (C) 2026 Lenderson Macedo | AGPL-3.0-only ou licença comercial (ver COPYRIGHT.md) */';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    target: 'node20',
    banner: { js: aviso },
  },
  {
    // CLI `nfce` (bin) e servidor MCP: só ESM, com shebang.
    entry: { cli: 'src/cli/index.ts' },
    format: ['esm'],
    dts: false,
    clean: false,
    target: 'node20',
    banner: { js: `#!/usr/bin/env node\n${aviso}` },
  },
]);
