// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
import type { Ambiente } from '../types.js';
import { NfceError } from '../errors/index.js';

/**
 * Situação de uma NFC-e no registro.
 * - pendente: assinada e gravada, ainda sem resposta definitiva da SEFAZ
 * - contingencia: emitida offline (tpEmis=9), aguardando transmissão
 * - substituida: nota online que deu lugar a uma de contingência (não deve ser reenviada)
 * - conflito: a contingência e a nota original foram ambas tratadas pela SEFAZ — requer ação manual
 */
export type SituacaoNota =
  | 'pendente' | 'contingencia' | 'autorizada' | 'rejeitada' | 'denegada' | 'cancelada' | 'substituida' | 'conflito';

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

/**
 * Registro do estado das notas (normalmente um banco de dados).
 * Implemente para o seu banco ou use `PostgresRegistro` / `MemoryRegistro`.
 */
export interface RegistroNotas {
  /** Insere a nota. Deve falhar com `RegistroDuplicadoError` se a chave ou (cnpj, ambiente, referencia) já existir. */
  registrar(nota: RegistroNota): Promise<void>;
  atualizar(chave: string, mudancas: AtualizacaoRegistro): Promise<void>;
  buscar(chave: string): Promise<RegistroNota | undefined>;
  buscarPorReferencia(cnpj: string, ambiente: Ambiente, referencia: string): Promise<RegistroNota | undefined>;
  /** Notas com situação `pendente` ou `contingencia`, mais antigas primeiro. */
  pendentes(filtro?: FiltroPendentes): Promise<RegistroNota[]>;
}

export class RegistroDuplicadoError extends NfceError {
  constructor(message: string) {
    super(message, 'REGISTRO_DUPLICADO');
  }
}

/** Registro em memória (testes e protótipos). */
export class MemoryRegistro implements RegistroNotas {
  private notas = new Map<string, RegistroNota>();

  async registrar(n: RegistroNota): Promise<void> {
    if (this.notas.has(n.chave)) throw new RegistroDuplicadoError(`Chave já registrada: ${n.chave}`);
    if (n.referencia && (await this.buscarPorReferencia(n.cnpj, n.ambiente, n.referencia))) {
      throw new RegistroDuplicadoError(`Referência já registrada: ${n.referencia}`);
    }
    this.notas.set(n.chave, { ...n });
  }

  async atualizar(chave: string, m: AtualizacaoRegistro): Promise<void> {
    const n = this.notas.get(chave);
    if (!n) throw new NfceError(`Nota não registrada: ${chave}`, 'REGISTRO_AUSENTE');
    this.notas.set(chave, { ...n, ...m, atualizadaEm: new Date().toISOString() });
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
      .filter((n) => (n.situacao === 'pendente' || n.situacao === 'contingencia')
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
