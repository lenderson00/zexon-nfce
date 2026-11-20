import https from 'node:https';
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
};

export interface TransportOptions {
  timeoutMs?: number;
  /** CAs adicionais (cadeia ICP-Brasil dos servidores SEFAZ). */
  ca?: string | Buffer | Array<string | Buffer>;
  /** Padrão true. Só desative em ambientes de teste controlados. */
  rejectUnauthorized?: boolean;
  /** Substituto para testes/mocks: recebe URL e envelope, devolve corpo HTTP. */
  fetchImpl?: (url: string, envelope: string, headers: Record<string, string>) => Promise<string>;
}

export function envelopeSoap(servico: Servico, xml: string): string {
  const { ns } = SERVICO_SOAP[servico];
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
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
        ca: this.opts.ca,
        rejectUnauthorized: this.opts.rejectUnauthorized ?? true,
        keepAlive: true,
        minVersion: 'TLSv1.2',
      });
    }
    return this.agent;
  }

  async chamar(url: string, servico: Servico, xml: string): Promise<string> {
    const envelope = envelopeSoap(servico, xml);
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
        },
      );
      req.on('timeout', () => req.destroy(new Error(`timeout após ${timeout}ms`)));
      req.on('error', (e) => reject(new TransportError(`Falha ao conectar em ${u.hostname}: ${e.message}`, e)));
      req.write(envelope);
      req.end();
    });
  }
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', removeNSPrefix: true, parseTagValue: false, trimValues: true });

/** Faz o parse do XML de retorno para objeto (prefixos de namespace removidos, tudo string). */
export function parseXml<T = Record<string, any>>(xml: string): T {
  return parser.parse(xml) as T;
}
