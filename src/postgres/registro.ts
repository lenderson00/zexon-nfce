// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
import type { Ambiente } from '../types.js';
import {
  RegistroDuplicadoError, type AtualizacaoRegistro, type FiltroPendentes, type Inutilizacao, type RegistroNota, type RegistroNotas,
} from '../registro/index.js';
import { NfceError } from '../errors/index.js';
import { ambienteNome, ambienteNum, tabela, type ExecutorSql, type OpcoesPostgres } from './sql.js';

const COLUNAS: Record<keyof AtualizacaoRegistro, string> = {
  cnpj: 'cnpj', uf: 'uf', ambiente: 'ambiente', serie: 'serie', numero: 'numero', tpEmis: 'tp_emis', situacao: 'situacao',
  valor: 'valor', emitidaEm: 'emitida_em', referencia: 'referencia', protocolo: 'protocolo', autorizadaEm: 'autorizada_em',
  cStat: 'c_stat', xMotivo: 'x_motivo', tentativas: 'tentativas', ultimoErro: 'ultimo_erro', chaveOriginal: 'chave_original',
  protocoloCancelamento: 'protocolo_cancelamento', canceladaEm: 'cancelada_em',
};

const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const valorColuna = (k: string, v: unknown) => (k === 'ambiente' ? ambienteNum(v as Ambiente) : v ?? null);

function deLinha(r: any): RegistroNota {
  return {
    chave: r.chave, cnpj: r.cnpj, uf: r.uf, ambiente: ambienteNome(r.ambiente), serie: Number(r.serie), numero: Number(r.numero),
    tpEmis: Number(r.tp_emis) as 1 | 9, situacao: r.situacao, valor: Number(r.valor), emitidaEm: iso(r.emitida_em)!,
    referencia: r.referencia, protocolo: r.protocolo, autorizadaEm: iso(r.autorizada_em), cStat: r.c_stat, xMotivo: r.x_motivo,
    tentativas: Number(r.tentativas), ultimoErro: r.ultimo_erro, chaveOriginal: r.chave_original,
    protocoloCancelamento: r.protocolo_cancelamento ?? null, canceladaEm: iso(r.cancelada_em),
    criadaEm: iso(r.criada_em)!, atualizadaEm: iso(r.atualizada_em)!,
  };
}

/** Registro de notas em Postgres (tabela `nfce_nota`). Crie as tabelas com `criarTabelas(db)`. */
export class PostgresRegistro implements RegistroNotas {
  private readonly t: string;
  private readonly seq: string;
  private readonly inut: string;
  constructor(private readonly db: ExecutorSql, opcoes: OpcoesPostgres = {}) {
    this.t = tabela('nfce_nota', opcoes);
    this.seq = tabela('nfce_sequencia', opcoes);
    this.inut = tabela('nfce_inutilizacao', opcoes);
  }

  private duplicado(e: unknown, quem: string): never {
    if ((e as { code?: string }).code === '23505') throw new RegistroDuplicadoError(`Nota já registrada (chave, referência ou número ocupado): ${quem}`);
    throw e;
  }

  async registrar(n: RegistroNota): Promise<void> {
    const cols = ['chave', ...Object.values(COLUNAS), 'criada_em'];
    const vals = [n.chave, ...Object.keys(COLUNAS).map((k) => valorColuna(k, (n as any)[k])), n.criadaEm ?? new Date().toISOString()];
    try {
      await this.db.query(`INSERT INTO ${this.t} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, vals);
    } catch (e) {
      this.duplicado(e, n.chave);
    }
  }

  async atualizar(chave: string, m: AtualizacaoRegistro): Promise<void> {
    const ks = (Object.keys(m) as (keyof AtualizacaoRegistro)[]).filter((k) => k in COLUNAS && m[k] !== undefined);
    const sets = ks.map((k, i) => `${COLUNAS[k]} = $${i + 2}`);
    let r: { rows: any[] };
    try {
      r = await this.db.query(
        `UPDATE ${this.t} SET ${[...sets, 'atualizada_em = now()'].join(', ')} WHERE chave = $1 RETURNING chave`,
        [chave, ...ks.map((k) => valorColuna(k, m[k]))],
      );
    } catch (e) {
      this.duplicado(e, chave);
    }
    if (r.rows.length === 0) throw new NfceError(`Nota não registrada: ${chave}`, 'REGISTRO_AUSENTE');
  }

  async buscar(chave: string): Promise<RegistroNota | undefined> {
    const r = await this.db.query(`SELECT * FROM ${this.t} WHERE chave = $1`, [chave]);
    return r.rows[0] ? deLinha(r.rows[0]) : undefined;
  }

  async buscarPorReferencia(cnpj: string, ambiente: Ambiente, referencia: string): Promise<RegistroNota | undefined> {
    const r = await this.db.query(`SELECT * FROM ${this.t} WHERE cnpj = $1 AND ambiente = $2 AND referencia = $3`, [cnpj, ambienteNum(ambiente), referencia]);
    return r.rows[0] ? deLinha(r.rows[0]) : undefined;
  }

  async pendentes(f: FiltroPendentes = {}): Promise<RegistroNota[]> {
    const conds = [`situacao IN ('pendente', 'contingencia', 'substituida')`];
    const params: unknown[] = [];
    if (f.uf) { params.push(f.uf); conds.push(`uf = $${params.length}`); }
    if (f.ambiente) { params.push(ambienteNum(f.ambiente)); conds.push(`ambiente = $${params.length}`); }
    if (f.cnpj) { params.push(f.cnpj); conds.push(`cnpj = $${params.length}`); }
    params.push(f.limite ?? 100);
    const r = await this.db.query(`SELECT * FROM ${this.t} WHERE ${conds.join(' AND ')} ORDER BY criada_em LIMIT $${params.length}`, params);
    return r.rows.map(deLinha);
  }

  async buscarPorNumero(cnpj: string, ambiente: Ambiente, serie: number, numero: number): Promise<RegistroNota[]> {
    const r = await this.db.query(`SELECT * FROM ${this.t} WHERE cnpj = $1 AND ambiente = $2 AND serie = $3 AND numero = $4 ORDER BY criada_em`,
      [cnpj, ambienteNum(ambiente), serie, numero]);
    return r.rows.map(deLinha);
  }

  async registrarInutilizacao(i: Inutilizacao): Promise<void> {
    await this.db.query(
      `INSERT INTO ${this.inut} (cnpj, ambiente, serie, inicio, fim, protocolo) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (cnpj, ambiente, serie, inicio) DO UPDATE SET fim = EXCLUDED.fim, protocolo = EXCLUDED.protocolo`,
      [i.cnpj, ambienteNum(i.ambiente), i.serie, i.inicio, i.fim, i.protocolo ?? null],
    );
  }

  /**
   * Números da série sem nota que os ocupe e não inutilizados — precisam ser inutilizados ou reaproveitados.
   * Rejeitadas e descartadas não ocupam o número. Intervalo padrão: do início ao último número entregue.
   */
  async buracos(p: { cnpj: string; ambiente: Ambiente; serie: number; de?: number; ate?: number }): Promise<number[]> {
    const r = await this.db.query(
      `WITH lim AS (
         SELECT COALESCE($4::bigint, (SELECT inicio FROM ${this.seq} WHERE cnpj = $1 AND ambiente = $2 AND modelo = 65 AND serie = $3), 1) AS de,
                COALESCE($5::bigint, (SELECT ultimo FROM ${this.seq} WHERE cnpj = $1 AND ambiente = $2 AND modelo = 65 AND serie = $3),
                         (SELECT max(numero) FROM ${this.t} WHERE cnpj = $1 AND ambiente = $2 AND serie = $3), 0) AS ate)
       SELECT n FROM lim, generate_series(lim.de, lim.ate) AS n
       WHERE NOT EXISTS (SELECT 1 FROM ${this.t} x WHERE x.cnpj = $1 AND x.ambiente = $2 AND x.serie = $3 AND x.numero = n
                           AND x.situacao NOT IN ('rejeitada', 'descartada'))
         AND NOT EXISTS (SELECT 1 FROM ${this.inut} i WHERE i.cnpj = $1 AND i.ambiente = $2 AND i.serie = $3 AND n BETWEEN i.inicio AND i.fim)
       ORDER BY n`,
      [p.cnpj, ambienteNum(p.ambiente), p.serie, p.de ?? null, p.ate ?? null],
    );
    return r.rows.map((x) => Number(x.n));
  }
}
