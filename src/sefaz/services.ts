import type { Ambiente } from '../types.js';
import { NFE_NS } from '../xml/nfce.js';
import { parseXml } from './soap.js';

const NS = `xmlns="${NFE_NS}"`;
const tpAmbNum = (a: Ambiente) => (a === 'producao' ? 1 : 2);

export const xmlStatus = (a: Ambiente, cUF: number) =>
  `<consStatServ versao="4.00" ${NS}><tpAmb>${tpAmbNum(a)}</tpAmb><cUF>${cUF}</cUF><xServ>STATUS</xServ></consStatServ>`;

export const xmlConsultaChave = (a: Ambiente, chave: string) =>
  `<consSitNFe versao="4.00" ${NS}><tpAmb>${tpAmbNum(a)}</tpAmb><xServ>CONSULTAR</xServ><chNFe>${chave}</chNFe></consSitNFe>`;

export const xmlConsultaRecibo = (a: Ambiente, nRec: string) =>
  `<consReciNFe versao="4.00" ${NS}><tpAmb>${tpAmbNum(a)}</tpAmb><nRec>${nRec}</nRec></consReciNFe>`;

export const xmlLote = (idLote: string, nfeAssinadas: string[], sincrono = true) =>
  `<enviNFe versao="4.00" ${NS}><idLote>${idLote}</idLote><indSinc>${sincrono ? 1 : 0}</indSinc>${nfeAssinadas.join('')}</enviNFe>`;

export interface Protocolo {
  tpAmb?: string; verAplic?: string; chNFe?: string; dhRecbto?: string; nProt?: string; digVal?: string; cStat: string; xMotivo: string;
  /** XML bruto do <protNFe>. */
  xml: string;
}

export interface RetornoBase { cStat: string; xMotivo: string; cUF?: string; dhRecbto?: string; xml: string }

const sub = (xml: string, tag: string) => new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`).exec(xml)?.[0];

export function parseRetornoSimples(xml: string, raiz: string): RetornoBase & Record<string, any> {
  const o = parseXml(xml)[raiz] ?? {};
  return { ...o, cStat: String(o.cStat ?? ''), xMotivo: String(o.xMotivo ?? ''), xml };
}

export function parseProtocolo(xml: string): Protocolo | undefined {
  const px = sub(xml, 'protNFe');
  if (!px) return undefined;
  const inf = parseXml(px).protNFe?.infProt ?? {};
  return { ...inf, cStat: String(inf.cStat ?? ''), xMotivo: String(inf.xMotivo ?? ''), xml: px };
}

export interface RetornoAutorizacao extends RetornoBase { nRec?: string; protocolo?: Protocolo }

export function parseRetEnviNFe(xml: string): RetornoAutorizacao {
  const r = parseRetornoSimples(xml, 'retEnviNFe');
  return { cStat: r.cStat, xMotivo: r.xMotivo, cUF: r.cUF, dhRecbto: r.dhRecbto, xml, nRec: r.infRec?.nRec, protocolo: parseProtocolo(xml) };
}

export function parseRetConsReciNFe(xml: string): RetornoAutorizacao {
  const r = parseRetornoSimples(xml, 'retConsReciNFe');
  return { cStat: r.cStat, xMotivo: r.xMotivo, cUF: r.cUF, xml, nRec: r.nRec, protocolo: parseProtocolo(xml) };
}

export interface RetornoConsulta extends RetornoBase { protocolo?: Protocolo; eventos: Array<{ tpEvento: string; nProt?: string; cStat: string; xml: string }> }

export function parseRetConsSitNFe(xml: string): RetornoConsulta {
  const r = parseRetornoSimples(xml, 'retConsSitNFe');
  const eventos = [...xml.matchAll(/<procEventoNFe[\s\S]*?<\/procEventoNFe>/g)].map((m) => {
    const o = parseXml(m[0]).procEventoNFe?.retEvento?.infEvento ?? {};
    return { tpEvento: String(o.tpEvento ?? ''), nProt: o.nProt, cStat: String(o.cStat ?? ''), xml: m[0] };
  });
  return { cStat: r.cStat, xMotivo: r.xMotivo, cUF: r.cUF, xml, protocolo: parseProtocolo(xml), eventos };
}

export interface RetornoEvento extends RetornoBase { nProt?: string; chNFe?: string; tpEvento?: string; xmlRetEvento?: string }

export function parseRetEnvEvento(xml: string): RetornoEvento {
  const lote = parseRetornoSimples(xml, 'retEnvEvento');
  const re = sub(xml, 'retEvento');
  const inf = re ? parseXml(re).retEvento?.infEvento ?? {} : {};
  return {
    cStat: String(inf.cStat ?? lote.cStat), xMotivo: String(inf.xMotivo ?? lote.xMotivo), xml,
    nProt: inf.nProt, chNFe: inf.chNFe, tpEvento: inf.tpEvento, xmlRetEvento: re,
  };
}

export const parseRetInutNFe = (xml: string) => {
  const o = parseXml(xml).retInutNFe?.infInut ?? {};
  return { cStat: String(o.cStat ?? ''), xMotivo: String(o.xMotivo ?? ''), nProt: o.nProt as string | undefined, dhRecbto: o.dhRecbto as string | undefined, xml };
};

/** Monta o <nfeProc> (NFe assinada + protocolo) = XML de distribuição. */
export function montarNfeProc(nfeAssinada: string, protNFe: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" ${NS}>${nfeAssinada}${protNFe}</nfeProc>`;
}

export function montarProcEvento(eventoAssinado: string, retEvento: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><procEventoNFe versao="1.00" ${NS}>${eventoAssinado}${retEvento}</procEventoNFe>`;
}

export function montarProcInut(inutAssinada: string, retInut: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><ProcInutNFe versao="4.00" ${NS}>${inutAssinada}${sub(retInut, 'retInutNFe') ?? retInut}</ProcInutNFe>`;
}
