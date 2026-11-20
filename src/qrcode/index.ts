// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
import { createHash, createSign } from 'node:crypto';
import QRCode from 'qrcode';
import type { Csc, VersaoQrCode } from '../types.js';
import { fmt } from '../util/xml.js';
import { ValidationError } from '../errors/index.js';

const sha1Hex = (s: string) => createHash('sha1').update(s, 'utf8').digest('hex').toUpperCase();

/** Hexadecimal da string Base64 do DigestValue (conforme MOC/Manual do QR Code: bytes ASCII em hex). */
export const digestParaHex = (digestB64: string) => Buffer.from(digestB64, 'utf8').toString('hex');

/** Junta a URL base com o parâmetro p= (aceita base com ou sem `?`). */
function comP(base: string, p: string): string {
  const b = base.includes('?') ? base : `${base}?`;
  return `${b}${b.endsWith('?') || b.endsWith('&') ? '' : '&'}p=${p}`;
}

export interface QrOnlineParams {
  versao: VersaoQrCode;
  urlBase: string;
  chave: string;
  tpAmb: 1 | 2;
  csc?: Csc;
}

/** QR Code para emissão normal (online). v2 exige CSC; v3 não. */
export function montarQrCodeOnline(p: QrOnlineParams): string {
  if (p.versao === 3) return comP(p.urlBase, `${p.chave}|3|${p.tpAmb}`);
  if (!p.csc) throw new ValidationError('QR Code v2 exige CSC (id e código).', ['csc']);
  const id = String(Number(p.csc.id));
  const base = `${p.chave}|2|${p.tpAmb}|${id}`;
  return comP(p.urlBase, `${base}|${sha1Hex(base + p.csc.codigo)}`);
}

export interface QrOfflineParams extends QrOnlineParams {
  /** Dia da emissão (dd). */
  dia: string;
  /** Valor total da NFC-e (vNF). */
  vNF: number;
  /** v2: DigestValue Base64 da assinatura. */
  digestValue?: string;
  /** v3: destinatário. */
  destinatario?: { cpf?: string; cnpj?: string; idEstrangeiro?: string };
  /** v3: chave privada PEM do certificado que assina a NFC-e. */
  privateKeyPem?: string;
}

/** QR Code para contingência offline (tpEmis=9). */
export function montarQrCodeOffline(p: QrOfflineParams): string {
  const dia = fmt.pad(p.dia, 2);
  const vNF = fmt.money(p.vNF);
  if (p.versao === 2) {
    if (!p.csc) throw new ValidationError('QR Code v2 exige CSC.', ['csc']);
    if (!p.digestValue) throw new ValidationError('QR Code offline v2 exige o DigestValue.', ['digestValue']);
    const id = String(Number(p.csc.id));
    const base = `${p.chave}|2|${p.tpAmb}|${dia}|${vNF}|${digestParaHex(p.digestValue)}|${id}`;
    return comP(p.urlBase, `${base}|${sha1Hex(base + p.csc.codigo)}`);
  }
  if (!p.privateKeyPem) throw new ValidationError('QR Code offline v3 exige a chave privada do certificado.', ['certificado']);
  const d = p.destinatario ?? {};
  const tp = d.cnpj ? '1' : d.cpf ? '2' : d.idEstrangeiro ? '3' : '';
  const id = d.cnpj ? fmt.onlyDigits(d.cnpj) : d.cpf ? fmt.onlyDigits(d.cpf) : '';
  // Destinatário estrangeiro/não identificado: apenas separador no campo identificação (tp 3 sem número).
  const base = `${p.chave}|3|${p.tpAmb}|${dia}|${vNF}|${tp}|${id}`;
  const sig = createSign('RSA-SHA1').update(base, 'utf8').sign(p.privateKeyPem, 'base64');
  return comP(p.urlBase, `${base}|${sig}`);
}

/** Gera a imagem do QR Code (nível M, UTF-8). */
export async function qrCodePng(conteudo: string, largura = 300): Promise<Buffer> {
  return QRCode.toBuffer(conteudo, { errorCorrectionLevel: 'M', width: largura, margin: 1 });
}

export async function qrCodeDataUrl(conteudo: string, largura = 300): Promise<string> {
  return QRCode.toDataURL(conteudo, { errorCorrectionLevel: 'M', width: largura, margin: 1 });
}

export async function qrCodeSvg(conteudo: string): Promise<string> {
  return QRCode.toString(conteudo, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
}
