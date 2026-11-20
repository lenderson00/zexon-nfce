// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { CertificateError } from '../errors/index.js';

const EXTENSOES = new Set(['.crt', '.cer', '.pem']);
const PEM_RE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

const derParaPem = (der: Buffer) =>
  `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;

/**
 * Lê certificados de CA (PEM ou DER; `.crt`, `.cer`, `.pem`) de arquivos e/ou diretórios e devolve PEMs
 * prontos para `transporte.casAdicionais`. Use para a cadeia ICP-Brasil dos servidores da SEFAZ.
 *
 * ```ts
 * transporte: { casAdicionais: carregarCadeiaIcpBrasil('./certs/icp-brasil') }
 * ```
 */
export function carregarCadeiaIcpBrasil(caminhos: string | string[]): string[] {
  const arquivos: string[] = [];
  for (const c of Array.isArray(caminhos) ? caminhos : [caminhos]) {
    let st;
    try { st = statSync(c); } catch { throw new CertificateError(`Caminho de CA não encontrado: ${c}`); }
    if (st.isDirectory()) {
      for (const f of readdirSync(c).sort()) if (EXTENSOES.has(extname(f).toLowerCase())) arquivos.push(join(c, f));
    } else arquivos.push(c);
  }
  const pems: string[] = [];
  for (const f of arquivos) {
    const buf = readFileSync(f);
    const txt = buf.toString('latin1');
    const blocos = txt.includes('-----BEGIN CERTIFICATE-----') ? txt.match(PEM_RE) ?? [] : [derParaPem(buf)];
    for (const pem of blocos) {
      try {
        const x = new X509Certificate(pem);
        if (!x.ca) continue; // só autoridades certificadoras
        pems.push(pem.endsWith('\n') ? pem : `${pem}\n`);
      } catch {
        throw new CertificateError(`Arquivo de CA inválido: ${f}`);
      }
    }
  }
  if (pems.length === 0) throw new CertificateError('Nenhum certificado de CA encontrado nos caminhos informados.');
  return pems;
}
