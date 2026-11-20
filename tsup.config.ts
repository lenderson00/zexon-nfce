import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  target: 'node20',
  banner: { js: '/*! @zexon/nfce | (C) 2026 Lenderson Macedo | AGPL-3.0-only ou licença comercial (ver COPYRIGHT.md) */' },
});
