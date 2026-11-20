// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
import type { Consumidor, Emitente, Item, NotaNfce, Pagamento, ResponsavelTecnico } from '../types.js';
import { validarNota } from '../validation/index.js';

/** Builder fluente para montar uma {@link NotaNfce}. */
export class NfceBuilder {
  private nota: Partial<NotaNfce> & { itens: Item[]; pagamentos: Pagamento[] } = { itens: [], pagamentos: [] };

  emitente(e: Emitente): this { this.nota.emitente = e; return this; }
  serie(s: number): this { this.nota.serie = s; return this; }
  numero(n: number): this { this.nota.numero = n; return this; }
  consumidor(c: Consumidor): this { this.nota.consumidor = c; return this; }
  cpfConsumidor(cpf: string, nome?: string): this { this.nota.consumidor = { cpf, nome }; return this; }
  item(i: Item): this { this.nota.itens.push(i); return this; }
  itens(is: Item[]): this { this.nota.itens.push(...is); return this; }
  pagamento(p: Pagamento): this { this.nota.pagamentos.push(p); return this; }
  emissao(d: Date): this { this.nota.emissao = d; return this; }
  naturezaOperacao(n: string): this { this.nota.naturezaOperacao = n; return this; }
  presenca(p: 1 | 4 | 5): this { this.nota.indicadorPresenca = p; return this; }
  informacoesComplementares(t: string): this { this.nota.informacoesComplementares = t; return this; }
  responsavelTecnico(r: ResponsavelTecnico): this { this.nota.responsavelTecnico = r; return this; }
  versaoSoftware(v: string): this { this.nota.versaoSoftware = v; return this; }

  /**
   * Valida e devolve a nota. Lança `ValidationError` listando todos os problemas.
   * A obrigatoriedade do IBS/CBS (CRT 3) é verificada no envio, pois o cliente pode aplicar `ibsCbsPadrao`.
   */
  build(): NotaNfce {
    const n = this.nota as NotaNfce;
    if (!n.emitente) throw new Error('emitente não informado');
    n.serie ??= 1;
    if (n.numero === undefined) throw new Error('numero não informado');
    validarNota(n, { exigirIbsCbs: false });
    return { ...n, itens: [...n.itens], pagamentos: [...n.pagamentos] };
  }
}
