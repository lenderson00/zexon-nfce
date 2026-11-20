// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
import type { Ambiente } from '../types.js';
import { NFE_NS } from '../xml/nfce.js';
import { dhFormat, esc, fmt, sanitizeText } from '../util/xml.js';
import { ValidationError } from '../errors/index.js';
import { parseChave } from '../xml/chave.js';

export const TIPO_CANCELAMENTO = '110111';
export const TIPO_CANCELAMENTO_SUBSTITUICAO = '110112';

export interface EventoParams {
  chave: string;
  cnpj: string;
  ambiente: Ambiente;
  tipo: string;
  sequencia?: number;
  /** Conteúdo de <detEvento>. */
  detalhe: string;
  versaoDetalhe?: string;
  agora?: Date;
  offsetMinutes: number;
  /** cOrgao: por padrão, UF da chave. */
  cOrgao?: number;
}

/** `<evento>` (sem assinatura). */
export function montarEvento(p: EventoParams): { xml: string; id: string } {
  const seq = p.sequencia ?? 1;
  const id = `ID${p.tipo}${p.chave}${fmt.pad(seq, 2)}`;
  const dh = dhFormat(p.agora ?? new Date(), p.offsetMinutes);
  const xml =
    `<evento versao="1.00" xmlns="${NFE_NS}"><infEvento Id="${id}">` +
    `<cOrgao>${p.cOrgao ?? parseChave(p.chave).cUF}</cOrgao><tpAmb>${p.ambiente === 'producao' ? 1 : 2}</tpAmb>` +
    `<CNPJ>${fmt.onlyDigits(p.cnpj)}</CNPJ><chNFe>${p.chave}</chNFe><dhEvento>${dh}</dhEvento>` +
    `<tpEvento>${p.tipo}</tpEvento><nSeqEvento>${seq}</nSeqEvento><verEvento>1.00</verEvento>` +
    `<detEvento versao="${p.versaoDetalhe ?? '1.00'}">${p.detalhe}</detEvento></infEvento></evento>`;
  return { xml, id };
}

function checkJust(j: string, campo = 'justificativa'): string {
  const t = sanitizeText(j);
  if (t.length < 15 || t.length > 255) throw new ValidationError('A justificativa deve ter entre 15 e 255 caracteres.', [campo]);
  return t;
}

export function detalheCancelamento(protocolo: string, justificativa: string): string {
  return `<descEvento>Cancelamento</descEvento><nProt>${esc(protocolo)}</nProt><xJust>${esc(checkJust(justificativa))}</xJust>`;
}

export function detalheCancelamentoSubstituicao(p: { cOrgaoAutor: number; protocolo: string; justificativa: string; chaveSubstituta: string; verAplic?: string }): string {
  return (
    `<descEvento>Cancelamento por substituicao</descEvento><cOrgaoAutor>${p.cOrgaoAutor}</cOrgaoAutor><tpAutor>1</tpAutor>` +
    `<verAplic>${esc(p.verAplic ?? 'zexon-nfce')}</verAplic><nProt>${esc(p.protocolo)}</nProt><xJust>${esc(checkJust(p.justificativa))}</xJust>` +
    `<chNFeRef>${p.chaveSubstituta}</chNFeRef>`
  );
}

export function envEvento(idLote: string, eventosAssinados: string[]): string {
  return `<envEvento versao="1.00" xmlns="${NFE_NS}"><idLote>${idLote}</idLote>${eventosAssinados.join('')}</envEvento>`;
}

export interface InutParams {
  ambiente: Ambiente;
  cUF: number;
  cnpj: string;
  ano: number; // 2 dígitos
  serie: number;
  numeroInicial: number;
  numeroFinal: number;
  justificativa: string;
}

export function montarInutilizacao(p: InutParams): { xml: string; id: string } {
  if (p.numeroFinal < p.numeroInicial) throw new ValidationError('Numeração final menor que a inicial.', ['numeroFinal']);
  const just = checkJust(p.justificativa);
  const ano = fmt.pad(p.ano % 100, 2);
  const id = `ID${fmt.pad(p.cUF, 2)}${ano}${fmt.pad(fmt.onlyDigits(p.cnpj), 14)}65${fmt.pad(p.serie, 3)}${fmt.pad(p.numeroInicial, 9)}${fmt.pad(p.numeroFinal, 9)}`;
  const xml =
    `<inutNFe versao="4.00" xmlns="${NFE_NS}"><infInut Id="${id}"><tpAmb>${p.ambiente === 'producao' ? 1 : 2}</tpAmb><xServ>INUTILIZAR</xServ>` +
    `<cUF>${p.cUF}</cUF><ano>${ano}</ano><CNPJ>${fmt.pad(fmt.onlyDigits(p.cnpj), 14)}</CNPJ><mod>65</mod><serie>${p.serie}</serie>` +
    `<nNFIni>${p.numeroInicial}</nNFIni><nNFFin>${p.numeroFinal}</nNFFin><xJust>${esc(just)}</xJust></infInut></inutNFe>`;
  return { xml, id };
}
