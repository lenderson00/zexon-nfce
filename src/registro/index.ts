// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
import type { Ambiente } from '../types.js';
import { NfceError } from '../errors/index.js';

/**
 * Situação de uma NFC-e no registro.
 * - pendente: assinada e gravada, ainda sem resposta definitiva da SEFAZ
 * - contingencia: emitida offline (tpEmis=9), aguardando transmissão
 * - substituida: nota online, de recebimento incerto, trocada por uma de contingência com **outro número**.
 *   Nunca é reenviada; `processarPendentes` só a consulta para saber o desfecho.
 * - descartada: nota online que a SEFAZ certamente não tem (nunca recebida). O número fica livre
 *   (reaproveitado pela contingência ou listado em `buracos` para inutilizar).
 * - conflito: nota substituída que acabou autorizada — a venda tem duas notas; cancele esta.
 */
export type SituacaoNota =
  | 'pendente' | 'contingencia' | 'autorizada' | 'rejeitada' | 'denegada' | 'cancelada' | 'substituida' | 'descartada' | 'conflito';

/** Situações que não ocupam o número (podem coexistir com outra nota no mesmo número). */
export const SITUACOES_SEM_NUMERO: readonly SituacaoNota[] = ['rejeitada', 'descartada'];

export interface RegistroNota {
  chave: string;
  cnpj: string;
  uf: string;
  ambiente: Ambiente;
  serie: number;
  numero: number;
  tpEmis: 1 | 9;
  situacao: SituacaoNota;
  valor: number;
  /** dhEmi (ISO 8601). */
  emitidaEm: string;
  /** Identificador do pedido/venda no sistema do usuário. Garante que a mesma venda não gere duas notas. */
  referencia?: string | null;
  protocolo?: string | null;
  autorizadaEm?: string | null;
  cStat?: string | null;
  xMotivo?: string | null;
  tentativas: number;
  ultimoErro?: string | null;
  /** Em contingência: chave da nota online que foi substituída. */
  chaveOriginal?: string | null;
  protocoloCancelamento?: string | null;
  canceladaEm?: string | null;
  criadaEm: string;
  atualizadaEm: string;
}

export type AtualizacaoRegistro = Partial<Omit<RegistroNota, 'chave' | 'criadaEm' | 'atualizadaEm'>>;

export interface FiltroPendentes {
  uf?: string;
  ambiente?: Ambiente;
  cnpj?: string;
  limite?: number;
}

export interface Inutilizacao {
  cnpj: string;
  ambiente: Ambiente;
  serie: number;
  inicio: number;
  fim: number;
  protocolo?: string | null;
}

/**
 * Registro do estado das notas (normalmente um banco de dados).
 * Implemente para o seu banco ou use `PostgresRegistro` / `MemoryRegistro`.
 */
export interface RegistroNotas {
  /**
   * Insere a nota. Deve falhar com `RegistroDuplicadoError` se já existir a chave, a (cnpj, ambiente, referencia)
   * ou outra nota que ocupe o mesmo (cnpj, ambiente, serie, numero) — ver `SITUACOES_SEM_NUMERO`.
   */
  registrar(nota: RegistroNota): Promise<void>;
  atualizar(chave: string, mudancas: AtualizacaoRegistro): Promise<void>;
  buscar(chave: string): Promise<RegistroNota | undefined>;
  buscarPorReferencia(cnpj: string, ambiente: Ambiente, referencia: string): Promise<RegistroNota | undefined>;
  /** Todas as notas (de qualquer situação) com esse número. */
  buscarPorNumero(cnpj: string, ambiente: Ambiente, serie: number, numero: number): Promise<RegistroNota[]>;
  /** Notas a resolver (`pendente`, `contingencia`, `substituida`), mais antigas primeiro. */
  pendentes(filtro?: FiltroPendentes): Promise<RegistroNota[]>;
  /** Registra uma faixa inutilizada na SEFAZ (para não aparecer como buraco). */
  registrarInutilizacao(i: Inutilizacao): Promise<void>;
}

export const SITUACOES_A_RESOLVER: readonly SituacaoNota[] = ['pendente', 'contingencia', 'substituida'];
const A_RESOLVER = SITUACOES_A_RESOLVER;
const ocupaNumero = (n: RegistroNota) => !SITUACOES_SEM_NUMERO.includes(n.situacao);

export class RegistroDuplicadoError extends NfceError {
  constructor(message: string) {
    super(message, 'REGISTRO_DUPLICADO');
  }
}

/** Registro em memória (testes e protótipos). Aplica as mesmas regras de unicidade do Postgres. */
export class MemoryRegistro implements RegistroNotas {
  private notas = new Map<string, RegistroNota>();
  private inutilizacoes: Inutilizacao[] = [];

  private conferirUnicidade(n: RegistroNota): void {
    for (const o of this.notas.values()) {
      if (o.chave === n.chave) continue;
      if (n.referencia && o.cnpj === n.cnpj && o.ambiente === n.ambiente && o.referencia === n.referencia) {
        throw new RegistroDuplicadoError(`Referência já registrada: ${n.referencia}`);
      }
      if (ocupaNumero(n) && ocupaNumero(o) && o.cnpj === n.cnpj && o.ambiente === n.ambiente && o.serie === n.serie && o.numero === n.numero) {
        throw new RegistroDuplicadoError(`Número ${n.numero} (série ${n.serie}) já ocupado pela nota ${o.chave}`);
      }
    }
  }

  async registrar(n: RegistroNota): Promise<void> {
    if (this.notas.has(n.chave)) throw new RegistroDuplicadoError(`Chave já registrada: ${n.chave}`);
    this.conferirUnicidade(n);
    this.notas.set(n.chave, { ...n });
  }

  async atualizar(chave: string, m: AtualizacaoRegistro): Promise<void> {
    const n = this.notas.get(chave);
    if (!n) throw new NfceError(`Nota não registrada: ${chave}`, 'REGISTRO_AUSENTE');
    const definidos = Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined));
    const nova = { ...n, ...definidos, atualizadaEm: new Date().toISOString() } as RegistroNota;
    this.conferirUnicidade(nova);
    this.notas.set(chave, nova);
  }

  async buscarPorNumero(cnpj: string, ambiente: Ambiente, serie: number, numero: number) {
    return [...this.notas.values()]
      .filter((n) => n.cnpj === cnpj && n.ambiente === ambiente && n.serie === serie && n.numero === numero)
      .map((n) => ({ ...n }));
  }

  async registrarInutilizacao(i: Inutilizacao): Promise<void> {
    this.inutilizacoes.push({ ...i });
  }

  /** Números de 1 (ou `de`) até `ate` sem nota que ocupe o número e não inutilizados. */
  async buracos(p: { cnpj: string; ambiente: Ambiente; serie: number; de?: number; ate: number }): Promise<number[]> {
    const out: number[] = [];
    for (let n = p.de ?? 1; n <= p.ate; n++) {
      const usado = [...this.notas.values()].some((x) => x.cnpj === p.cnpj && x.ambiente === p.ambiente && x.serie === p.serie && x.numero === n && ocupaNumero(x));
      const inutilizado = this.inutilizacoes.some((i) => i.cnpj === p.cnpj && i.ambiente === p.ambiente && i.serie === p.serie && n >= i.inicio && n <= i.fim);
      if (!usado && !inutilizado) out.push(n);
    }
    return out;
  }

  async buscar(chave: string) {
    const n = this.notas.get(chave);
    return n && { ...n };
  }

  async buscarPorReferencia(cnpj: string, ambiente: Ambiente, referencia: string) {
    for (const n of this.notas.values()) if (n.cnpj === cnpj && n.ambiente === ambiente && n.referencia === referencia) return { ...n };
    return undefined;
  }

  async pendentes(f: FiltroPendentes = {}) {
    return [...this.notas.values()]
      .filter((n) => A_RESOLVER.includes(n.situacao)
        && (!f.uf || n.uf === f.uf) && (!f.ambiente || n.ambiente === f.ambiente) && (!f.cnpj || n.cnpj === f.cnpj))
      .sort((a, b) => a.criadaEm.localeCompare(b.criadaEm))
      .slice(0, f.limite ?? 100)
      .map((n) => ({ ...n }));
  }

  /** Todas as notas (inspeção em testes). */
  todas(): RegistroNota[] {
    return [...this.notas.values()].map((n) => ({ ...n }));
  }
}
