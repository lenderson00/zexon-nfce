// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
import type { ChaveSequencia, Numerador } from '../numerador/index.js';
import type { Ambiente } from '../types.js';
import { ambienteNum, tabela, type ExecutorSql, type OpcoesPostgres } from './sql.js';

/** Numerador atômico em Postgres (tabela `nfce_sequencia`). */
export class PostgresNumerador implements Numerador {
  private readonly t: string;
  constructor(private readonly db: ExecutorSql, opcoes: OpcoesPostgres = {}) {
    this.t = tabela('nfce_sequencia', opcoes);
  }

  async proximo(k: ChaveSequencia): Promise<number> {
    // INSERT ... ON CONFLICT DO UPDATE trava a linha: chamadas simultâneas recebem números distintos.
    const r = await this.db.query(
      `INSERT INTO ${this.t} (cnpj, ambiente, modelo, serie, ultimo) VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT (cnpj, ambiente, modelo, serie)
       DO UPDATE SET ultimo = ${this.t}.ultimo + 1, atualizada_em = now()
       RETURNING ultimo`,
      [k.cnpj, ambienteNum(k.ambiente), k.modelo, k.serie],
    );
    return Number(r.rows[0].ultimo);
  }

  /** Define o primeiro número a ser entregue (ex.: migração de outro emissor). */
  async definirInicio(k: ChaveSequencia, primeiro: number): Promise<void> {
    await this.db.query(
      `INSERT INTO ${this.t} (cnpj, ambiente, modelo, serie, inicio, ultimo) VALUES ($1, $2, $3, $4, $5::bigint, $5::bigint - 1)
       ON CONFLICT (cnpj, ambiente, modelo, serie) DO UPDATE SET inicio = $5::bigint, ultimo = $5::bigint - 1, atualizada_em = now()`,
      [k.cnpj, ambienteNum(k.ambiente), k.modelo, k.serie, primeiro],
    );
  }

  /** Último número entregue (undefined se a sequência ainda não existe). */
  async ultimo(k: ChaveSequencia): Promise<number | undefined> {
    const r = await this.db.query(`SELECT ultimo FROM ${this.t} WHERE cnpj = $1 AND ambiente = $2 AND modelo = $3 AND serie = $4`,
      [k.cnpj, ambienteNum(k.ambiente as Ambiente), k.modelo, k.serie]);
    return r.rows[0] ? Number(r.rows[0].ultimo) : undefined;
  }
}
