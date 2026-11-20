// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { NfceClient, type NfceClientConfig } from '../client/NfceClient.js';
import { carregarCadeiaIcpBrasil } from '../certificate/cadeia.js';
import { FileStorage } from '../storage/index.js';
import { FileNumerador, FileRegistro } from '../registro/file.js';
import type { Ambiente, Emitente } from '../types.js';
import type { UF } from '../xml/chave.js';
import { CliErro, SAIDA } from './erros.js';
import { validarSchema } from './validacao.js';

export const ARQUIVO_CONFIG = 'nfce.config.json';

export interface CliConfig {
  uf: UF;
  ambiente: Ambiente;
  serie: number;
  emitente: Emitente;
  certificado: { arquivo: string; senhaEnv?: string };
  csc?: { id: number; codigoEnv?: string };
  dados?: string;
  contingenciaAutomatica?: boolean;
  prazoContingencia?: { horas?: number; alertaHoras?: number };
  versaoSoftware?: string;
  casAdicionaisDir?: string;
  timeoutMs?: number;
}

export interface Contexto {
  cwd: string;
  env: Record<string, string | undefined>;
  /** Testes: substitui a comunicação com a SEFAZ. */
  fetchImpl?: NonNullable<NfceClientConfig['transporte']>['fetchImpl'];
  relogio?: () => Date;
}

export interface Carregado {
  config: CliConfig;
  caminho: string;
  base: string;
  dados: string;
}

export function caminhoConfig(ctx: Contexto, arquivo?: string): string {
  const a = arquivo ?? ctx.env.NFCE_CONFIG ?? ARQUIVO_CONFIG;
  return isAbsolute(a) ? a : resolve(ctx.cwd, a);
}

export function carregarConfig(ctx: Contexto, arquivo?: string): Carregado {
  const caminho = caminhoConfig(ctx, arquivo);
  if (!existsSync(caminho)) {
    throw new CliErro(SAIDA.CONFIGURACAO, 'SEM_CONFIG', `Configuração não encontrada: ${caminho}`, [], { dica: 'Rode `nfce init` (ou informe --config).' });
  }
  let bruto: unknown;
  try {
    bruto = JSON.parse(readFileSync(caminho, 'utf8'));
  } catch (e) {
    throw new CliErro(SAIDA.CONFIGURACAO, 'CONFIG_INVALIDA', `JSON inválido em ${caminho}: ${(e as Error).message}`);
  }
  const problemas = validarSchema('config', bruto);
  if (problemas.length) throw new CliErro(SAIDA.CONFIGURACAO, 'CONFIG_INVALIDA', `Configuração inválida: ${caminho}`, problemas, { dica: 'Veja `nfce schema config`.' });
  const config = bruto as CliConfig;
  const base = dirname(caminho);
  return { config, caminho, base, dados: resolve(base, config.dados ?? '.nfce') };
}

/** Lê os segredos das variáveis de ambiente indicadas no config. Nunca os devolve em saídas. */
export function segredos(c: Carregado, ctx: Contexto): { pfx: Buffer; senha: string; csc?: { id: number; codigo: string } } {
  const senhaEnv = c.config.certificado.senhaEnv ?? 'NFCE_CERT_SENHA';
  const arquivo = resolve(c.base, c.config.certificado.arquivo);
  if (!existsSync(arquivo)) throw new CliErro(SAIDA.CONFIGURACAO, 'SEM_CERTIFICADO', `Certificado não encontrado: ${arquivo}`);
  const senha = ctx.env[senhaEnv];
  if (!senha) throw new CliErro(SAIDA.CONFIGURACAO, 'SEM_SENHA', `Variável de ambiente ${senhaEnv} (senha do certificado) não definida.`, [], { dica: `Defina ${senhaEnv} no ambiente; nunca no arquivo de config.` });
  let csc: { id: number; codigo: string } | undefined;
  if (c.config.csc) {
    const codigoEnv = c.config.csc.codigoEnv ?? 'NFCE_CSC';
    const codigo = ctx.env[codigoEnv];
    if (!codigo) throw new CliErro(SAIDA.CONFIGURACAO, 'SEM_CSC', `Variável de ambiente ${codigoEnv} (CSC) não definida.`, [], { dica: `Defina ${codigoEnv} no ambiente, ou remova "csc" do config para usar o QR Code v3.` });
    csc = { id: c.config.csc.id, codigo };
  }
  return { pfx: readFileSync(arquivo), senha, csc };
}

export function criarCliente(c: Carregado, ctx: Contexto): { cliente: NfceClient; registro: FileRegistro; numerador: FileNumerador; storage: FileStorage } {
  const s = segredos(c, ctx);
  const storage = new FileStorage(resolve(c.dados, 'xml'));
  const registro = new FileRegistro(c.dados);
  const numerador = new FileNumerador(c.dados);
  const cas = c.config.casAdicionaisDir ? carregarCadeiaIcpBrasil(resolve(c.base, c.config.casAdicionaisDir)) : undefined;
  const cliente = new NfceClient({
    uf: c.config.uf, ambiente: c.config.ambiente,
    certificado: { pfx: s.pfx, senha: s.senha }, csc: s.csc,
    storage, registro, numerador,
    contingenciaAutomatica: c.config.contingenciaAutomatica ?? true,
    prazoContingencia: c.config.prazoContingencia,
    versaoSoftware: c.config.versaoSoftware ?? 'zexon-nfce-cli',
    transporte: { timeoutMs: c.config.timeoutMs ?? 20000, ...(cas ? { casAdicionais: cas } : {}), ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}) },
    relogio: ctx.relogio,
  });
  return { cliente, registro, numerador, storage };
}
