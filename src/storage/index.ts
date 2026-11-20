// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type TipoDocumento = 'autorizadas' | 'cancelamentos' | 'inutilizacoes' | 'contingencia' | 'rejeitadas';

/** Interface de persistência de XMLs. Implemente para S3, banco, etc. */
export interface Storage {
  salvar(tipo: TipoDocumento, nome: string, conteudo: string): Promise<void>;
  ler(tipo: TipoDocumento, nome: string): Promise<string | undefined>;
  listar(tipo: TipoDocumento): Promise<string[]>;
  remover(tipo: TipoDocumento, nome: string): Promise<void>;
}

/** Persistência em disco: `<raiz>/<tipo>/<nome>.xml`. */
export class FileStorage implements Storage {
  constructor(private raiz: string) {}
  private dir(t: TipoDocumento) { return join(this.raiz, t); }
  async salvar(tipo: TipoDocumento, nome: string, conteudo: string) {
    await mkdir(this.dir(tipo), { recursive: true });
    const tmp = join(this.dir(tipo), `.${nome}.tmp`);
    await writeFile(tmp, conteudo, 'utf8');
    await rename(tmp, join(this.dir(tipo), `${nome}.xml`));
  }
  async ler(tipo: TipoDocumento, nome: string) {
    try { return await readFile(join(this.dir(tipo), `${nome}.xml`), 'utf8'); } catch { return undefined; }
  }
  async listar(tipo: TipoDocumento) {
    try { return (await readdir(this.dir(tipo))).filter((f) => f.endsWith('.xml')).map((f) => f.slice(0, -4)); } catch { return []; }
  }
  async remover(tipo: TipoDocumento, nome: string) {
    try { await unlink(join(this.dir(tipo), `${nome}.xml`)); } catch { /* inexistente */ }
  }
}

/** Memória (testes). */
export class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  async salvar(t: TipoDocumento, n: string, c: string) { this.m.set(`${t}/${n}`, c); }
  async ler(t: TipoDocumento, n: string) { return this.m.get(`${t}/${n}`); }
  async listar(t: TipoDocumento) { return [...this.m.keys()].filter((k) => k.startsWith(`${t}/`)).map((k) => k.slice(t.length + 1)); }
  async remover(t: TipoDocumento, n: string) { this.m.delete(`${t}/${n}`); }
}

