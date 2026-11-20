// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
import type { Ambiente } from '../types.js';
import { NfceError } from '../errors/index.js';

/** Identifica uma sequência de numeração: cada combinação tem números independentes. */
export interface ChaveSequencia {
  /** CNPJ do estabelecimento emitente (14 dígitos). */
  cnpj: string;
  ambiente: Ambiente;
  modelo: 65;
  serie: number;
}

/**
 * Fornece o próximo número da NFC-e. Deve ser atômico: chamadas simultâneas nunca recebem o mesmo número.
 * Use `PostgresNumerador` / `MemoryNumerador` ou implemente para o seu banco.
 */
export interface Numerador {
  proximo(chave: ChaveSequencia): Promise<number>;
}

export const idSequencia = (k: ChaveSequencia) => `${k.cnpj}|${k.ambiente}|${k.modelo}|${k.serie}`;

/** Numerador em memória (um único processo; testes e protótipos). */
export class MemoryNumerador implements Numerador {
  private ultimos = new Map<string, number>();

  async proximo(k: ChaveSequencia): Promise<number> {
    const id = idSequencia(k);
    const n = (this.ultimos.get(id) ?? 0) + 1;
    this.ultimos.set(id, n);
    return n;
  }

  /** Define o primeiro número a ser entregue. Recusa voltar a numeração, salvo `{ forcar: true }`. */
  definirInicio(k: ChaveSequencia, primeiro: number, opcoes: { forcar?: boolean } = {}): void {
    const atual = this.ultimos.get(idSequencia(k));
    if (!opcoes.forcar && atual !== undefined && primeiro <= atual) {
      throw new NfceError(`A sequência já entregou até o número ${atual}; use { forcar: true } se tiver certeza.`, 'NUMERACAO');
    }
    this.ultimos.set(idSequencia(k), primeiro - 1);
  }
}
