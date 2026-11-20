// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
/**
 * Executor mínimo de SQL. Compatível com `pg.Pool`, `pg.Client`, `pg.PoolClient` e PGlite.
 * Parâmetros no formato posicional do Postgres ($1, $2...).
 */
export interface ExecutorSql {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export interface OpcoesPostgres {
  /** Schema das tabelas (padrão: o search_path da conexão, normalmente "public"). */
  schema?: string;
}

const ident = (s: string) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) throw new Error(`Nome de schema inválido: ${s}`);
  return `"${s}"`;
};

export const tabela = (nome: string, o: OpcoesPostgres = {}) => (o.schema ? `${ident(o.schema)}.${nome}` : nome);

/** SQL de criação das tabelas (idempotente). Use direto ou copie para a sua ferramenta de migração. */
export function sqlMigracao(o: OpcoesPostgres = {}): string {
  const seq = tabela('nfce_sequencia', o);
  const nota = tabela('nfce_nota', o);
  return `
CREATE TABLE IF NOT EXISTS ${seq} (
  cnpj          varchar(14) NOT NULL,
  ambiente      smallint    NOT NULL,   -- 1=produção, 2=homologação
  modelo        smallint    NOT NULL,
  serie         integer     NOT NULL,
  inicio        bigint      NOT NULL DEFAULT 1,
  ultimo        bigint      NOT NULL,
  atualizada_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cnpj, ambiente, modelo, serie)
);

CREATE TABLE IF NOT EXISTS ${nota} (
  chave          char(44)      PRIMARY KEY,
  cnpj           varchar(14)   NOT NULL,
  uf             char(2)       NOT NULL,
  ambiente       smallint      NOT NULL,
  serie          integer       NOT NULL,
  numero         bigint        NOT NULL,
  tp_emis        smallint      NOT NULL,
  situacao       text          NOT NULL,
  valor          numeric(15,2) NOT NULL,
  emitida_em     timestamptz   NOT NULL,
  referencia     text,
  protocolo      text,
  autorizada_em  timestamptz,
  c_stat         text,
  x_motivo       text,
  tentativas     integer       NOT NULL DEFAULT 0,
  ultimo_erro    text,
  chave_original char(44),
  criada_em      timestamptz   NOT NULL DEFAULT now(),
  atualizada_em  timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS nfce_nota_referencia_uk ON ${nota} (cnpj, ambiente, referencia) WHERE referencia IS NOT NULL;
CREATE INDEX IF NOT EXISTS nfce_nota_situacao_idx ON ${nota} (situacao, criada_em);
CREATE INDEX IF NOT EXISTS nfce_nota_numero_idx ON ${nota} (cnpj, ambiente, serie, numero);
`;
}

/** Cria as tabelas `nfce_sequencia` e `nfce_nota` (pode ser chamado a cada inicialização). */
export async function criarTabelas(db: ExecutorSql, o: OpcoesPostgres = {}): Promise<void> {
  for (const stmt of sqlMigracao(o).split(';').map((s) => s.trim()).filter(Boolean)) await db.query(stmt);
}

export const ambienteNum = (a: 'producao' | 'homologacao') => (a === 'producao' ? 1 : 2);
export const ambienteNome = (n: number) => (Number(n) === 1 ? 'producao' : 'homologacao') as 'producao' | 'homologacao';
