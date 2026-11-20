import type { Ambiente, Certificado, Csc, NotaNfce, ResponsavelTecnico, VersaoQrCode } from '../types.js';
import { carregarCertificado, certificadoVencido, type CertificadoCarregado } from '../certificate/index.js';
import { UF_CODIGO, parseChave, validarChave } from '../xml/chave.js';
import { montarNfce } from '../xml/nfce.js';
import { assinarXml, extrairDigestValue } from '../xml/sign.js';
import { montarQrCodeOffline, montarQrCodeOnline } from '../qrcode/index.js';
import { resolverEndpoints, type EndpointsAmbiente, type EndpointsOverride, type Servico } from '../sefaz/endpoints.js';
import { SoapClient, type TransportOptions } from '../sefaz/soap.js';
import * as S from '../sefaz/services.js';
import {
  TIPO_CANCELAMENTO, TIPO_CANCELAMENTO_SUBSTITUICAO, detalheCancelamento, detalheCancelamentoSubstituicao, envEvento, montarEvento, montarInutilizacao,
} from '../events/index.js';
import { validarNota } from '../validation/index.js';
import { NfceError, SefazError, TransportError, ValidationError, CertificateError } from '../errors/index.js';
import type { Storage } from '../storage/index.js';
import { gerarDanfceHtml, gerarDanfcePdf, type DanfceOpcoes } from '../danfce/index.js';

/** Fuso (minutos em relação ao UTC) por UF — o Brasil não adota horário de verão desde 2019. */
export const FUSO_UF: Record<string, number> = {
  AC: -300, AM: -240, MT: -240, MS: -240, RO: -240, RR: -240,
};
export const fusoDaUF = (uf: string) => FUSO_UF[uf] ?? -180;

export interface NfceClientConfig {
  uf: string;
  ambiente: Ambiente;
  certificado: Certificado;
  /** CSC (obrigatório para QR Code v2). */
  csc?: Csc;
  /** Versão do QR Code. Padrão: 2 se `csc` informado, senão 3. */
  qrCodeVersao?: VersaoQrCode;
  storage?: Storage;
  /** Sobrescreve/complementa URLs de serviços, QR Code e consulta por chave. */
  endpoints?: EndpointsOverride;
  transporte?: TransportOptions;
  responsavelTecnico?: ResponsavelTecnico;
  versaoSoftware?: string;
  /** Se true, indisponibilidade da SEFAZ faz emitir() cair automaticamente para contingência offline. */
  contingenciaAutomatica?: boolean;
  /** Sobrescreve o fuso horário (minutos). */
  fusoMinutos?: number;
}

export type StatusEmissao = 'autorizada' | 'rejeitada' | 'denegada' | 'contingencia';

export interface ResultadoEmissao {
  status: StatusEmissao;
  chave: string;
  numero: number;
  serie: number;
  cStat: string;
  xMotivo: string;
  protocolo?: string;
  dataAutorizacao?: string;
  /** XML da NFe assinada (com infNFeSupl/QR Code). */
  xmlAssinado: string;
  /** nfeProc (NFe + protocolo): XML de distribuição. Presente quando autorizada. */
  xmlAutorizado?: string;
  qrCode: string;
  urlChave: string;
  totais: { valorNota: number };
  /** Em contingência: motivo da queda para offline. */
  motivoContingencia?: string;
}

export interface ResultadoConsulta {
  chave: string;
  cStat: string;
  xMotivo: string;
  situacao: 'autorizada' | 'cancelada' | 'denegada' | 'inexistente' | 'outra';
  protocolo?: string;
  xmlProtocolo?: string;
  eventos: S.RetornoConsulta['eventos'];
  xml: string;
}

export interface ResultadoEvento {
  sucesso: boolean;
  cStat: string;
  xMotivo: string;
  protocolo?: string;
  xmlProcEvento?: string;
}

export interface ResultadoInutilizacao {
  sucesso: boolean;
  cStat: string;
  xMotivo: string;
  protocolo?: string;
  xml: string;
}

const CSTAT_AUTORIZADA = ['100', '150'];
const CSTAT_DENEGADA = ['110', '301', '302', '303'];
const CSTAT_INDISPONIVEL = ['108', '109', '999'];
const CSTAT_EVENTO_OK = ['135', '136', '155'];

let seqLote = 0;
const idLote = () => String(Date.now() * 1000 + (seqLote++ % 1000)).slice(-15);

export class NfceClient {
  readonly config: NfceClientConfig;
  readonly cert: CertificadoCarregado;
  readonly endpoints: EndpointsAmbiente;
  readonly contingencia: Contingencia;
  private soap: SoapClient;
  private cUF: number;

  constructor(config: NfceClientConfig) {
    const uf = config.uf.toUpperCase();
    this.config = { ...config, uf };
    const cUF = UF_CODIGO[uf];
    if (!cUF) throw new NfceError(`UF inválida: ${config.uf}`);
    this.cUF = cUF;
    this.cert = carregarCertificado(config.certificado);
    if (certificadoVencido(this.cert)) throw new CertificateError(`Certificado fora da validade (${this.cert.validoDe.toISOString()} – ${this.cert.validoAte.toISOString()})`);
    this.endpoints = resolverEndpoints(uf, config.ambiente, config.endpoints);
    this.soap = new SoapClient(this.cert, config.transporte);
    this.contingencia = new Contingencia(this);
  }

  get ambiente(): Ambiente { return this.config.ambiente; }
  get fuso(): number { return this.config.fusoMinutos ?? fusoDaUF(this.config.uf); }
  private get tpAmb(): 1 | 2 { return this.config.ambiente === 'producao' ? 1 : 2; }
  private get qrVersao(): VersaoQrCode { return this.config.qrCodeVersao ?? (this.config.csc ? 2 : 3); }

  private url(s: Servico): string {
    const u = this.endpoints.servicos[s];
    if (!u) throw new NfceError(`URL do serviço ${s} não configurada para ${this.config.uf}`, 'ENDPOINT_AUSENTE');
    return u;
  }

  private chamar(s: Servico, xml: string): Promise<string> {
    return this.soap.chamar(this.url(s), s, xml);
  }

  // ───────────────────────── Emissão ─────────────────────────

  /**
   * Monta, assina e gera o QR Code da nota **sem enviar**.
   * Útil para pré-visualização, testes ou para controlar o envio.
   */
  preparar(nota: NotaNfce, opcoes: { offline?: boolean; motivoContingencia?: string; cNF?: string } = {}) {
    validarNota(nota);
    if (nota.emitente.endereco.uf.toUpperCase() !== this.config.uf) throw new ValidationError(`UF do emitente (${nota.emitente.endereco.uf}) diferente da UF do cliente (${this.config.uf})`, ['emitente.endereco.uf']);
    const offline = !!opcoes.offline;
    const n: NotaNfce = { ...nota, responsavelTecnico: nota.responsavelTecnico ?? this.config.responsavelTecnico, versaoSoftware: nota.versaoSoftware ?? this.config.versaoSoftware };
    const m = montarNfce(n, {
      ambiente: this.ambiente, tpEmis: offline ? 9 : 1, offsetMinutes: this.fuso, cNF: opcoes.cNF,
      dhCont: new Date(), xJust: opcoes.motivoContingencia,
    });
    const assinado = assinarXml(m.xml, 'infNFe', 'NFe', this.cert);
    const urlBase = this.endpoints.qrCode;
    if (!urlBase) throw new NfceError(`URL base do QR Code não configurada para ${this.config.uf} (use \`endpoints\`).`, 'ENDPOINT_AUSENTE');
    const versao = this.qrVersao;
    const dest = n.consumidor ?? {};
    const qrCode = offline
      ? montarQrCodeOffline({
          versao, urlBase, chave: m.chave, tpAmb: this.tpAmb, csc: this.config.csc, dia: m.dhEmi.slice(8, 10), vNF: m.totais.vNF,
          digestValue: extrairDigestValue(assinado), destinatario: { cpf: dest.cpf, cnpj: dest.cnpj, idEstrangeiro: dest.idEstrangeiro }, privateKeyPem: this.cert.privateKeyPem,
        })
      : montarQrCodeOnline({ versao, urlBase, chave: m.chave, tpAmb: this.tpAmb, csc: this.config.csc });
    const urlChave = this.endpoints.urlChave;
    const supl = `<infNFeSupl><qrCode><![CDATA[${qrCode}]]></qrCode>${urlChave ? `<urlChave>${urlChave}</urlChave>` : ''}</infNFeSupl>`;
    const xmlAssinado = assinado.replace('<Signature', `${supl}<Signature`);
    return { chave: m.chave, xmlAssinado, qrCode, urlChave, totais: m.totais, nota: n };
  }

  /**
   * Emite a NFC-e (envio síncrono). Rejeições são devolvidas em `status: 'rejeitada'`;
   * falhas de comunicação lançam `TransportError` (ou caem em contingência se `contingenciaAutomatica`).
   */
  async emitir(nota: NotaNfce): Promise<ResultadoEmissao> {
    const p = this.preparar(nota);
    const base = { chave: p.chave, numero: nota.numero, serie: nota.serie, xmlAssinado: p.xmlAssinado, qrCode: p.qrCode, urlChave: p.urlChave, totais: { valorNota: p.totais.vNF } };
    try {
      return await this.enviarAssinada(p.xmlAssinado, base);
    } catch (e) {
      if (!(e instanceof TransportError) && !(e instanceof SefazError && CSTAT_INDISPONIVEL.includes(e.cStat))) throw e;
      // A SEFAZ pode ter autorizado antes da queda: confirmar antes de decidir.
      try {
        const c = await this.consultar(p.chave);
        if (c.situacao === 'autorizada' && c.xmlProtocolo) return this.resultadoAutorizado(base, c.cStat, c.xMotivo, c.xmlProtocolo, p.xmlAssinado);
      } catch { /* sem conectividade */ }
      if (!this.config.contingenciaAutomatica) throw e;
      return this.contingencia.emitirOffline(nota, `Falha de comunicacao com a SEFAZ: ${(e as Error).message}`.slice(0, 250));
    }
  }

  /** Envia uma NFC-e já assinada (usado por emitir e pela retransmissão de contingência). */
  async enviarAssinada(xmlAssinado: string, base: Pick<ResultadoEmissao, 'chave' | 'numero' | 'serie' | 'qrCode' | 'urlChave' | 'totais' | 'xmlAssinado'>): Promise<ResultadoEmissao> {
    const ret = S.parseRetEnviNFe(await this.chamar('autorizacao', S.xmlLote(idLote(), [xmlAssinado], true)));
    if (CSTAT_INDISPONIVEL.includes(ret.cStat)) throw new SefazError(`SEFAZ indisponível: ${ret.cStat} ${ret.xMotivo}`, ret.cStat, ret.xMotivo, ret);
    let prot = ret.protocolo;
    // Lote recebido (assíncrono) ou em processamento: consultar o recibo.
    if (!prot && ret.nRec) {
      for (let i = 0; i < 5 && !prot; i++) {
        const r = S.parseRetConsReciNFe(await this.chamar('retAutorizacao', S.xmlConsultaRecibo(this.ambiente, ret.nRec)));
        if (r.protocolo) prot = r.protocolo;
        else if (r.cStat !== '105') break;
        else await new Promise((res) => setTimeout(res, 1500));
      }
    }
    if (!prot) return this.resultado(base, 'rejeitada', ret.cStat, ret.xMotivo);
    // Duplicidade (204): já existe — recuperar protocolo pela consulta.
    if (prot.cStat === '204' || prot.cStat === '539') {
      const c = await this.consultar(base.chave);
      if (c.situacao === 'autorizada' && c.xmlProtocolo) return this.resultadoAutorizado(base, c.cStat, c.xMotivo, c.xmlProtocolo, xmlAssinado);
    }
    if (CSTAT_AUTORIZADA.includes(prot.cStat)) return this.resultadoAutorizado(base, prot.cStat, prot.xMotivo, prot.xml, xmlAssinado);
    if (CSTAT_DENEGADA.includes(prot.cStat)) return this.resultado(base, 'denegada', prot.cStat, prot.xMotivo, prot.nProt);
    return this.resultado(base, 'rejeitada', prot.cStat, prot.xMotivo);
  }

  private resultado(base: Pick<ResultadoEmissao, 'chave' | 'numero' | 'serie' | 'qrCode' | 'urlChave' | 'totais' | 'xmlAssinado'>, status: StatusEmissao, cStat: string, xMotivo: string, protocolo?: string): ResultadoEmissao {
    return { ...base, status, cStat, xMotivo, protocolo };
  }

  async resultadoAutorizado(base: Pick<ResultadoEmissao, 'chave' | 'numero' | 'serie' | 'qrCode' | 'urlChave' | 'totais' | 'xmlAssinado'>, cStat: string, xMotivo: string, protXml: string, xmlAssinado: string): Promise<ResultadoEmissao> {
    const xmlAutorizado = S.montarNfeProc(xmlAssinado, protXml);
    const infProt = S.parseProtocolo(protXml);
    await this.config.storage?.salvar('autorizadas', base.chave, xmlAutorizado);
    return { ...base, status: 'autorizada', cStat, xMotivo, protocolo: infProt?.nProt, dataAutorizacao: infProt?.dhRecbto, xmlAutorizado };
  }

  // ───────────────────────── Consultas ─────────────────────────

  /** Consulta a situação do serviço da SEFAZ autorizadora (cStat 107 = em operação). */
  async status(): Promise<{ online: boolean; cStat: string; xMotivo: string; tempoMedioSegundos?: number; xml: string }> {
    const r = S.parseRetornoSimples(await this.chamar('statusServico', S.xmlStatus(this.ambiente, this.cUF)), 'retConsStatServ');
    return { online: r.cStat === '107', cStat: r.cStat, xMotivo: r.xMotivo, tempoMedioSegundos: r.tMed ? Number(r.tMed) : undefined, xml: r.xml };
  }

  /** Consulta uma NFC-e pela chave de acesso. */
  async consultar(chave: string): Promise<ResultadoConsulta> {
    if (!validarChave(chave)) throw new ValidationError('Chave de acesso inválida (44 dígitos, DV módulo 11).', ['chave']);
    const r = S.parseRetConsSitNFe(await this.chamar('consultaProtocolo', S.xmlConsultaChave(this.ambiente, chave)));
    const cancelada = r.eventos.some((e) => e.tpEvento === TIPO_CANCELAMENTO && CSTAT_EVENTO_OK.includes(e.cStat)) || ['101', '151', '155'].includes(r.cStat);
    const situacao: ResultadoConsulta['situacao'] = cancelada
      ? 'cancelada'
      : CSTAT_AUTORIZADA.includes(r.cStat) ? 'autorizada'
      : CSTAT_DENEGADA.includes(r.cStat) ? 'denegada'
      : r.cStat === '217' ? 'inexistente' : 'outra';
    return { chave, cStat: r.cStat, xMotivo: r.xMotivo, situacao, protocolo: r.protocolo?.nProt, xmlProtocolo: r.protocolo?.xml, eventos: r.eventos, xml: r.xml };
  }

  // ───────────────────────── Eventos ─────────────────────────

  private async enviarEvento(chave: string, tipo: string, detalhe: string, sequencia = 1): Promise<ResultadoEvento> {
    const { cnpj } = this.dadosChave(chave);
    const ev = montarEvento({ chave, cnpj, ambiente: this.ambiente, tipo, detalhe, sequencia, offsetMinutes: this.fuso, cOrgao: this.cUF });
    const assinado = assinarXml(ev.xml, 'infEvento', 'evento', this.cert);
    const r = S.parseRetEnvEvento(await this.chamar('recepcaoEvento', envEvento(idLote(), [assinado])));
    const sucesso = CSTAT_EVENTO_OK.includes(r.cStat);
    return { sucesso, cStat: r.cStat, xMotivo: r.xMotivo, protocolo: r.nProt, xmlProcEvento: sucesso && r.xmlRetEvento ? S.montarProcEvento(assinado, r.xmlRetEvento) : undefined };
  }

  private dadosChave(chave: string) {
    if (!validarChave(chave)) throw new ValidationError('Chave de acesso inválida.', ['chave']);
    const p = parseChave(chave);
    if (p.mod !== 65) throw new ValidationError('A chave não é de uma NFC-e (modelo 65).', ['chave']);
    return { ...p, cnpj: p.cnpj };
  }

  /** Cancela uma NFC-e autorizada (evento 110111). `protocolo` = número do protocolo de autorização. */
  async cancelar(p: { chave: string; protocolo: string; justificativa: string }): Promise<ResultadoEvento> {
    const r = await this.enviarEvento(p.chave, TIPO_CANCELAMENTO, detalheCancelamento(p.protocolo, p.justificativa));
    if (r.xmlProcEvento) await this.config.storage?.salvar('cancelamentos', p.chave, r.xmlProcEvento);
    return r;
  }

  /** Cancelamento por substituição (110112): cancela `chave` apontando a NFC-e substituta já autorizada. */
  async cancelarPorSubstituicao(p: { chave: string; protocolo: string; justificativa: string; chaveSubstituta: string }): Promise<ResultadoEvento> {
    const r = await this.enviarEvento(
      p.chave, TIPO_CANCELAMENTO_SUBSTITUICAO,
      detalheCancelamentoSubstituicao({ cOrgaoAutor: this.cUF, protocolo: p.protocolo, justificativa: p.justificativa, chaveSubstituta: p.chaveSubstituta, verAplic: this.config.versaoSoftware }),
    );
    if (r.xmlProcEvento) await this.config.storage?.salvar('cancelamentos', p.chave, r.xmlProcEvento);
    return r;
  }

  /** Inutiliza uma faixa de numeração (série/numeração não utilizada). */
  async inutilizar(p: { serie: number; numeroInicial: number; numeroFinal?: number; justificativa: string; cnpj?: string; ano?: number }): Promise<ResultadoInutilizacao> {
    const cnpj = p.cnpj ?? this.cert.documento;
    if (!cnpj || cnpj.length !== 14) throw new ValidationError('Informe `cnpj` do emitente (não foi possível obter do certificado).', ['cnpj']);
    const ano = p.ano ?? new Date(Date.now() + this.fuso * 60000).getUTCFullYear();
    const inut = montarInutilizacao({
      ambiente: this.ambiente, cUF: this.cUF, cnpj, ano, serie: p.serie, numeroInicial: p.numeroInicial, numeroFinal: p.numeroFinal ?? p.numeroInicial, justificativa: p.justificativa,
    });
    const assinado = assinarXml(inut.xml, 'infInut', 'inutNFe', this.cert);
    const r = S.parseRetInutNFe(await this.chamar('inutilizacao', assinado));
    const sucesso = r.cStat === '102';
    if (sucesso) await this.config.storage?.salvar('inutilizacoes', inut.id, S.montarProcInut(assinado, r.xml));
    return { sucesso, cStat: r.cStat, xMotivo: r.xMotivo, protocolo: r.nProt, xml: r.xml };
  }

  // ───────────────────────── DANFCE ─────────────────────────

  /** Gera o DANFCE em HTML (80 mm) a partir do XML autorizado (nfeProc) ou do assinado (contingência). */
  danfceHtml(xml: string, opcoes?: DanfceOpcoes): Promise<string> { return gerarDanfceHtml(xml, opcoes); }
  /** Gera o DANFCE em PDF (80 mm). */
  danfcePdf(xml: string, opcoes?: DanfceOpcoes): Promise<Buffer> { return gerarDanfcePdf(xml, opcoes); }
}

/** Rotinas de contingência offline (tpEmis=9). */
export class Contingencia {
  constructor(private client: NfceClient) {}

  private get storage(): Storage {
    const s = this.client.config.storage;
    if (!s) throw new NfceError('Contingência requer `storage` configurado (ex.: new FileStorage("./nfce-data")).', 'STORAGE_AUSENTE');
    return s;
  }

  /** Emite em contingência offline: assina com tpEmis=9, gera QR Code offline e guarda para retransmissão. */
  async emitirOffline(nota: NotaNfce, motivo = 'Contingencia off-line por indisponibilidade de comunicacao com a SEFAZ'): Promise<ResultadoEmissao> {
    const st = this.storage;
    const p = this.client.preparar(nota, { offline: true, motivoContingencia: motivo });
    await st.salvar('contingencia', p.chave, p.xmlAssinado);
    return {
      status: 'contingencia', chave: p.chave, numero: nota.numero, serie: nota.serie, cStat: '', xMotivo: 'Emitida em contingência offline; pendente de transmissão',
      xmlAssinado: p.xmlAssinado, qrCode: p.qrCode, urlChave: p.urlChave, totais: { valorNota: p.totais.vNF }, motivoContingencia: motivo,
    };
  }

  /** Chaves de NFC-e em contingência ainda não transmitidas. */
  pendentes(): Promise<string[]> { return this.storage.listar('contingencia'); }

  /**
   * Retransmite as notas pendentes (prazo regulamentar: até 24 h após a emissão/ fim do problema, conforme UF).
   * Antes de enviar, consulta a chave para evitar duplicidade.
   */
  async transmitirPendentes(): Promise<ResultadoEmissao[]> {
    const st = this.storage;
    const out: ResultadoEmissao[] = [];
    for (const chave of await st.listar('contingencia')) {
      const xml = await st.ler('contingencia', chave);
      if (!xml) continue;
      const p = parseChave(chave);
      const base = {
        chave, numero: p.nNF, serie: p.serie, xmlAssinado: xml,
        qrCode: /<qrCode><!\[CDATA\[([^\]]*)\]\]><\/qrCode>/.exec(xml)?.[1] ?? '', urlChave: /<urlChave>([^<]*)<\/urlChave>/.exec(xml)?.[1] ?? '',
        totais: { valorNota: Number(/<vNF>([\d.]+)<\/vNF>/.exec(xml)?.[1] ?? 0) },
      };
      try {
        const c = await this.client.consultar(chave);
        const r = c.situacao === 'autorizada' && c.xmlProtocolo
          ? await this.client.resultadoAutorizado(base, c.cStat, c.xMotivo, c.xmlProtocolo, xml)
          : await this.client.enviarAssinada(xml, base);
        if (r.status === 'autorizada' || r.status === 'rejeitada' || r.status === 'denegada') {
          if (r.status !== 'autorizada') await st.salvar('rejeitadas', chave, xml);
          await st.remover('contingencia', chave);
        }
        out.push(r);
      } catch (e) {
        if (e instanceof TransportError || e instanceof SefazError) {
          out.push({ ...base, status: 'contingencia', cStat: (e as SefazError).cStat ?? '', xMotivo: (e as Error).message });
        } else throw e;
      }
    }
    return out;
  }
}
