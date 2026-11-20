// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
import https from 'node:https';
import tls from 'node:tls';
import { URL } from 'node:url';
import { XMLParser } from 'fast-xml-parser';
import { TransportError } from '../errors/index.js';
import type { CertificadoCarregado } from '../certificate/index.js';
import type { Servico } from './endpoints.js';

export const SERVICO_SOAP: Record<Servico, { ns: string; action: string }> = {
  autorizacao: { ns: 'NFeAutorizacao4', action: 'nfeAutorizacaoLote' },
  retAutorizacao: { ns: 'NFeRetAutorizacao4', action: 'nfeRetAutorizacaoLote' },
  consultaProtocolo: { ns: 'NFeConsultaProtocolo4', action: 'nfeConsultaNF' },
  statusServico: { ns: 'NFeStatusServico4', action: 'nfeStatusServicoNF' },
  inutilizacao: { ns: 'NFeInutilizacao4', action: 'nfeInutilizacaoNF' },
  recepcaoEvento: { ns: 'NFeRecepcaoEvento4', action: 'nfeRecepcaoEvento' },
  // EPEC da NFC-e (SP): serviço ASMX anterior ao 4.00, com cabeçalho nfeCabecMsg (NT 2014.003, item 03.7).
  epecRecepcao: { ns: 'RecepcaoEvento', action: 'nfeRecepcaoEvento' },
};

export const EPEC_VERSAO_DADOS = '1.00';

export interface TransportOptions {
  timeoutMs?: number;
  /** Substitui os CAs confiáveis do Node (use só se souber o que faz). Prefira `casAdicionais`. */
  ca?: string | Buffer | Array<string | Buffer>;
  /**
   * CAs somados aos confiáveis do Node — normalmente a cadeia ICP-Brasil dos servidores da SEFAZ
   * (ver `carregarCadeiaIcpBrasil`).
   */
  casAdicionais?: Array<string | Buffer>;
  /** Padrão true. Só desative em ambientes de teste controlados. */
  rejectUnauthorized?: boolean;
  /** Substituto para testes/mocks: recebe URL e envelope, devolve corpo HTTP. */
  fetchImpl?: (url: string, envelope: string, headers: Record<string, string>) => Promise<string>;
}

export function envelopeSoap(servico: Servico, xml: string, cUF?: number): string {
  const { ns } = SERVICO_SOAP[servico];
  const cabecalho = servico === 'epecRecepcao' && cUF
    ? `<soap12:Header><nfeCabecMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/${ns}"><cUF>${cUF}</cUF><versaoDados>${EPEC_VERSAO_DADOS}</versaoDados></nfeCabecMsg></soap12:Header>`
    : '';
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    cabecalho +
    `<soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/${ns}">${xml}</nfeDadosMsg></soap12:Body></soap12:Envelope>`
  );
}

/** Extrai o XML de resposta (primeiro elemento filho de nfeResultMsg / Body). */
export function extrairRetorno(soap: string): string {
  const m = /<(?:\w+:)?nfeResultMsg[^>]*>([\s\S]*?)<\/(?:\w+:)?nfeResultMsg>/.exec(soap);
  if (m) return m[1]!.trim();
  const b = /<(?:\w+:)?Body[^>]*>([\s\S]*?)<\/(?:\w+:)?Body>/.exec(soap);
  if (b) return b[1]!.trim();
  return soap.trim();
}

export class SoapClient {
  private agent?: https.Agent;
  constructor(private cert: CertificadoCarregado | undefined, private opts: TransportOptions = {}) {}

  private getAgent(): https.Agent {
    if (!this.agent) {
      this.agent = new https.Agent({
        key: this.cert?.privateKeyPem,
        cert: this.cert ? [this.cert.certPem, ...this.cert.chainPem].join('\n') : undefined,
        ca: this.opts.ca ?? (this.opts.casAdicionais?.length ? [...tls.rootCertificates, ...this.opts.casAdicionais] : undefined),
        rejectUnauthorized: this.opts.rejectUnauthorized ?? true,
        keepAlive: true,
        minVersion: 'TLSv1.2',
      });
    }
    return this.agent;
  }

  async chamar(url: string, servico: Servico, xml: string, cUF?: number): Promise<string> {
    const envelope = envelopeSoap(servico, xml, cUF);
    const { ns, action } = SERVICO_SOAP[servico];
    const headers = {
      'Content-Type': `application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/${ns}/${action}"`,
    };
    const body = this.opts.fetchImpl ? await this.opts.fetchImpl(url, envelope, headers) : await this.post(url, envelope, headers);
    return extrairRetorno(body);
  }

  private post(url: string, envelope: string, headers: Record<string, string>): Promise<string> {
    const u = new URL(url);
    const timeout = this.opts.timeoutMs ?? 30000;
    return new Promise((resolve, reject) => {
      // "conectado" = TLS estabelecido; antes disso é certo que a SEFAZ não recebeu nada.
      let conectado = false;
      const req = https.request(
        {
          host: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'POST', agent: this.getAgent(),
          headers: { ...headers, 'Content-Length': Buffer.byteLength(envelope) }, timeout,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const txt = Buffer.concat(chunks).toString('utf8');
            if (res.statusCode && res.statusCode >= 400 && !txt.includes('Envelope')) {
              reject(new TransportError(`HTTP ${res.statusCode} em ${u.hostname}`));
            } else resolve(txt);
          });
          res.on('error', (e) => reject(new TransportError(`Falha ao ler resposta de ${u.hostname}: ${e.message}`, e)));
        },
      );
      req.on('socket', (sock) => {
        if (!sock.connecting && (sock as tls.TLSSocket).encrypted) conectado = true; // socket reaproveitado (keep-alive)
        else sock.once('secureConnect', () => { conectado = true; });
      });
      req.on('timeout', () => req.destroy(new Error(`timeout após ${timeout}ms`)));
      req.on('error', (e) => reject(erroDeTransporte(e, u.hostname, conectado)));
      req.write(envelope);
      req.end();
    });
  }
}

const ERROS_CERTIFICADO = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_GET_ISSUER_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_UNTRUSTED', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/** Converte um erro de rede em TransportError, indicando se é certo que nada chegou à SEFAZ. */
export function erroDeTransporte(e: Error & { code?: string }, host: string, conectado: boolean): TransportError {
  if (e.code && ERROS_CERTIFICADO.has(e.code)) {
    return new TransportError(
      `Não foi possível validar o certificado TLS de ${host} (${e.code}). Os servidores da SEFAZ usam a cadeia ICP-Brasil: ` +
        'informe-a em `transporte.casAdicionais` (ex.: carregarCadeiaIcpBrasil("./certs/icp-brasil")).',
      e, { naoRecebido: true, retentavel: false },
    );
  }
  return new TransportError(`Falha ao conectar em ${host}: ${e.message}`, e, { naoRecebido: !conectado });
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', removeNSPrefix: true, parseTagValue: false, trimValues: true });

/** Faz o parse do XML de retorno para objeto (prefixos de namespace removidos, tudo string). */
export function parseXml<T = Record<string, any>>(xml: string): T {
  return parser.parse(xml) as T;
}
