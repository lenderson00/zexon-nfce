// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
import { CertificateError, NfceError, SefazError, TransportError, ValidationError } from '../errors/index.js';
import type { Problema } from './validacao.js';

/** Códigos de saída estáveis — a IA decide o próximo passo por eles. */
export const SAIDA = {
  OK: 0,
  NOTA_INVALIDA: 1,
  REJEITADA: 2,
  TEMPORARIO: 3,
  CONFIGURACAO: 4,
  USO: 5,
} as const;
export type CodigoSaida = (typeof SAIDA)[keyof typeof SAIDA];

export class CliErro extends Error {
  constructor(public saida: CodigoSaida, public codigo: string, message: string, public erros: Problema[] = [], public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

/** Dicas para as rejeições mais comuns (cStat → o que fazer). */
export const DICAS_CSTAT: Record<string, string> = {
  '108': 'SEFAZ paralisada momentaneamente: tente de novo em alguns minutos ou emita em contingência (`nfce contingencia offline`).',
  '109': 'SEFAZ paralisada sem previsão: emita em contingência (`nfce contingencia offline`; em SP também `epec`).',
  '204': 'A nota já foi autorizada antes (duplicidade): rode `nfce consultar <chave>`, não emita outra.',
  '213': 'O CNPJ do certificado não é da empresa emitente (raiz do CNPJ diferente): confira o certificado no config.',
  '225': 'Falha no schema XML: rode `nfce validar` e corrija os campos apontados.',
  '228': 'Data de emissão muito antiga: emita de novo sem o campo `emissao`.',
  '280': 'Certificado transmissor inválido: confira o arquivo .pfx e a senha (variável de ambiente).',
  '281': 'Certificado vencido: renove o certificado A1.',
  '386': 'Contingência fora do permitido para a UF: emita normalmente quando a SEFAZ voltar.',
  '467': 'Dados da NFC-e divergentes do EPEC: transmita a nota exatamente como foi gerada (`nfce pendentes --processar`).',
  '468': 'NFC-e tpEmis=4 sem EPEC: rode `nfce pendentes --processar` (refaz o EPEC antes de transmitir).',
  '142': 'Ambiente EPEC bloqueado (EPEC pendente além do prazo): transmita as notas pendentes e use a contingência offline.',
  '539': 'O número já foi usado por outra nota com chave diferente: não reutilize o número; emita de novo sem `numero`.',
  '704': 'Data/hora de emissão atrasada: use `nfce reemitir <chave> nota.json` (mesmo número, nova chave).',
  '778': 'NCM inexistente: corrija o `ncm` do item (8 dígitos da tabela TIPI vigente).',
  '217': 'A nota não consta na SEFAZ.',
};

export function dicaCstat(cStat?: string): string | undefined {
  return cStat ? DICAS_CSTAT[cStat] : undefined;
}

/** Converte qualquer erro em `CliErro` (código de saída + mensagem + problemas), sem vazar segredos. */
export function paraCliErro(e: unknown): CliErro {
  if (e instanceof CliErro) return e;
  const chave = e instanceof NfceError ? e.chave : undefined;
  const extra = chave ? { chave } : {};
  if (e instanceof ValidationError) {
    const erros = e.detalhes.length ? e.detalhes : e.campos.map((campo) => ({ campo, mensagem: e.message }));
    return new CliErro(SAIDA.NOTA_INVALIDA, 'NOTA_INVALIDA', 'Nota inválida', erros, extra);
  }
  if (e instanceof CertificateError) return new CliErro(SAIDA.CONFIGURACAO, 'CERTIFICADO', e.message, [], extra);
  if (e instanceof SefazError && !e.retentavel) {
    return new CliErro(SAIDA.REJEITADA, 'REJEITADA', e.message, [], { ...extra, cStat: e.cStat, xMotivo: e.xMotivo, dica: dicaCstat(e.cStat) });
  }
  if (e instanceof NfceError && e.retentavel) {
    return new CliErro(SAIDA.TEMPORARIO, e instanceof TransportError ? 'SEM_COMUNICACAO' : 'TEMPORARIO', e.message, [], {
      ...extra, dica: chave ? 'A nota está gravada; rode `nfce pendentes --processar` depois (não emita outra para a mesma venda).' : 'Tente de novo em alguns minutos.',
    });
  }
  if (e instanceof NfceError && ['CONFIG', 'STORAGE_AUSENTE', 'ENDPOINT_AUSENTE', 'EPEC_UF_NAO_SUPORTADA'].includes(e.code)) {
    return new CliErro(SAIDA.CONFIGURACAO, e.code, e.message, [], extra);
  }
  if (e instanceof NfceError) return new CliErro(SAIDA.REJEITADA, e.code, e.message, [], extra);
  return new CliErro(SAIDA.CONFIGURACAO, 'ERRO_INTERNO', (e as Error)?.message ?? String(e));
}
