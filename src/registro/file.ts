// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Ambiente } from '../types.js';
import { NfceError } from '../errors/index.js';
import { idSequencia, type ChaveSequencia, type Numerador } from '../numerador/index.js';
import {
  MemoryRegistro, type AtualizacaoRegistro, type FiltroPendentes, type Inutilizacao, type RegistroNota, type RegistroNotas,
} from './index.js';

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Exclusão mútua entre processos por arquivo de trava (`O_EXCL`). Uma trava mais velha que `velhaMs`
 * (processo morto no meio) é removida. Serve para a CLI: várias chamadas em paralelo na mesma pasta.
 */
async function comTrava<T>(arquivo: string, fn: () => Promise<T>, velhaMs = 30_000, limiteMs = 20_000): Promise<T> {
  const inicio = Date.now();
  for (let i = 0; ; i++) {
    try {
      const fh = await open(arquivo, 'wx');
      await fh.writeFile(String(process.pid));
      await fh.close();
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const s = await stat(arquivo).catch(() => undefined);
      if (s && Date.now() - s.mtimeMs > velhaMs) { await unlink(arquivo).catch(() => {}); continue; }
      if (Date.now() - inicio > limiteMs) throw new NfceError(`Tempo esgotado esperando a trava ${arquivo}.`, 'TRAVA');
      await espera(2 + Math.random() * Math.min(2 * 2 ** Math.min(i, 4), 25));
    }
  }
  try {
    return await fn();
  } finally {
    await unlink(arquivo).catch(() => {});
  }
}

async function lerJson<T>(arquivo: string, padrao: T): Promise<T> {
  try {
    return JSON.parse(await readFile(arquivo, 'utf8')) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return padrao;
    throw new NfceError(`Arquivo de estado corrompido: ${arquivo} (${(e as Error).message}).`, 'ESTADO_CORROMPIDO');
  }
}

/** Gravação atômica e durável (temporário + fsync + rename). */
async function gravarJson(arquivo: string, dados: unknown): Promise<void> {
  const tmp = `${arquivo}.${process.pid}.tmp`;
  const fh = await open(tmp, 'w');
  try {
    await fh.writeFile(JSON.stringify(dados, null, 1), 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  await rename(tmp, arquivo);
}

/**
 * Registro das notas em um arquivo JSON (`<pasta>/registro.json`), com as mesmas regras de unicidade do Postgres.
 * Feito para uso local e pela CLI (poucas centenas de notas por mês). Para servidores, prefira `PostgresRegistro`.
 */
export class FileRegistro implements RegistroNotas {
  private arquivo: string;
  private trava: string;
  constructor(private pasta: string) {
    this.arquivo = join(pasta, 'registro.json');
    this.trava = join(pasta, 'registro.lock');
  }

  private async ler(): Promise<MemoryRegistro> {
    return MemoryRegistro.importar(await lerJson(this.arquivo, {}));
  }

  private async alterar<T>(fn: (r: MemoryRegistro) => Promise<T>): Promise<T> {
    await mkdir(this.pasta, { recursive: true });
    return comTrava(this.trava, async () => {
      const r = await this.ler();
      const out = await fn(r);
      await gravarJson(this.arquivo, r.exportar());
      return out;
    });
  }

  registrar(nota: RegistroNota) { return this.alterar((r) => r.registrar(nota)); }
  atualizar(chave: string, m: AtualizacaoRegistro) { return this.alterar((r) => r.atualizar(chave, m)); }
  registrarInutilizacao(i: Inutilizacao) { return this.alterar((r) => r.registrarInutilizacao(i)); }
  async buscar(chave: string) { return (await this.ler()).buscar(chave); }
  async buscarPorReferencia(cnpj: string, ambiente: Ambiente, referencia: string) { return (await this.ler()).buscarPorReferencia(cnpj, ambiente, referencia); }
  async buscarPorNumero(cnpj: string, ambiente: Ambiente, serie: number, numero: number) { return (await this.ler()).buscarPorNumero(cnpj, ambiente, serie, numero); }
  async pendentes(f?: FiltroPendentes) { return (await this.ler()).pendentes(f); }
  async buracos(p: { cnpj: string; ambiente: Ambiente; serie: number; de?: number; ate: number }) { return (await this.ler()).buracos(p); }
  async todas() { return (await this.ler()).todas(); }
}

/** Numerador em arquivo (`<pasta>/numeracao.json`), atômico entre processos. */
export class FileNumerador implements Numerador {
  private arquivo: string;
  private trava: string;
  constructor(private pasta: string) {
    this.arquivo = join(pasta, 'numeracao.json');
    this.trava = join(pasta, 'numeracao.lock');
  }

  private alterar<T>(fn: (u: Record<string, number>) => T): Promise<T> {
    return mkdir(this.pasta, { recursive: true }).then(() => comTrava(this.trava, async () => {
      const u = await lerJson<Record<string, number>>(this.arquivo, {});
      const out = fn(u);
      await gravarJson(this.arquivo, u);
      return out;
    }));
  }

  proximo(k: ChaveSequencia): Promise<number> {
    return this.alterar((u) => {
      const id = idSequencia(k);
      u[id] = (u[id] ?? 0) + 1;
      return u[id]!;
    });
  }

  /** Último número entregue (0 se nenhum). */
  async ultimo(k: ChaveSequencia): Promise<number> {
    return (await lerJson<Record<string, number>>(this.arquivo, {}))[idSequencia(k)] ?? 0;
  }

  /** Define o primeiro número a ser entregue. Recusa voltar a numeração, salvo `{ forcar: true }`. */
  definirInicio(k: ChaveSequencia, primeiro: number, opcoes: { forcar?: boolean } = {}): Promise<void> {
    return this.alterar((u) => {
      const id = idSequencia(k);
      const atual = u[id];
      if (!opcoes.forcar && atual !== undefined && primeiro <= atual) {
        throw new NfceError(`A sequência já entregou até o número ${atual}; use { forcar: true } se tiver certeza.`, 'NUMERACAO');
      }
      u[id] = primeiro - 1;
    });
  }
}
