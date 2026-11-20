// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
import type { Ambiente, Certificado, Csc, IbsCbsItem, NotaNfce, ResponsavelTecnico, VersaoQrCode } from '../types.js';
import { carregarCertificado, certificadoVencido, type CertificadoCarregado } from '../certificate/index.js';
import { UF_CODIGO, parseChave, validarChave } from '../xml/chave.js';
import { fmt } from '../util/xml.js';
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
import { NfceError, SefazError, ValidationError, CertificateError, CSTAT_INDISPONIVEL } from '../errors/index.js';
import type { Storage } from '../storage/index.js';
import { RegistroDuplicadoError, SITUACOES_A_RESOLVER, SITUACOES_SEM_NUMERO, type RegistroNota, type RegistroNotas } from '../registro/index.js';
import type { Numerador } from '../numerador/index.js';
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
  /** Onde guardar os XMLs: `new S3Storage({ bucket })`, `new FileStorage(pasta)` ou sua implementação de `Storage`. */
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
  /**
   * IBS/CBS aplicado aos itens que não informarem `ibsCbs` (ex.: `{ cClassTrib: '000001' }` para tributação integral).
   * Útil para emitentes do Regime Normal cujos produtos são, em geral, tributados integralmente.
   */
  ibsCbsPadrao?: IbsCbsItem;
  /**
   * Registro do estado das notas (banco de dados): `new PostgresRegistro(pool)` ou sua implementação de `RegistroNotas`.
   * Exige `storage`. Habilita `referencia` (idempotência por pedido), `retomar` e `processarPendentes` com estado.
   */
  registro?: RegistroNotas;
  /** Fornece o número quando a nota não informar `numero`: `new PostgresNumerador(pool)` ou sua implementação. */
  numerador?: Numerador;
  /** Retentativa curta para falhas temporárias (rede, SEFAZ 108/109). Padrão: 3 tentativas, esperas de 0,5 s e 1,5 s. */
  retentativas?: { tentativas?: number; esperasMs?: number[] };
  /**
   * Prazo para transmitir notas de contingência offline. A regra nacional é o fim do primeiro dia útil seguinte
   * à emissão; algumas UFs (ex.: PA) usam 24 h. Padrão: `{ horas: 24, alertaHoras: 18 }` (conservador).
   */
  prazoContingencia?: { horas?: number; alertaHoras?: number };
  /** Relógio (testes). Padrão: `() => new Date()`. */
  relogio?: () => Date;
}

export interface OpcoesEmissao {
  /**
   * Identificador do pedido/venda no seu sistema. Com `registro`, repetir `emitir` com a mesma referência
   * devolve (ou retoma) a nota já criada, em vez de emitir outra.
   */
  referencia?: string;
}

/**
 * - pendente: gravada, ainda sem resposta definitiva (falha temporária); será concluída por `retomar`/`processarPendentes`
 * - contingencia: emitida offline (tpEmis=9), aguardando transmissão
 * - descartada: nota online que a SEFAZ nunca recebeu; o número foi liberado
 * - conflito: nota online substituída por contingência que acabou autorizada — a venda tem duas notas: cancele esta
 */
export type StatusEmissao = 'autorizada' | 'rejeitada' | 'denegada' | 'contingencia' | 'pendente' | 'cancelada' | 'descartada' | 'conflito';

export interface PrazoContingencia {
  horasDesdeEmissao: number;
  /** ok; alerta (passou de `alertaHoras`); vencido (passou de `horas`). */
  situacao: 'ok' | 'alerta' | 'vencido';
}

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
  /** Tentativas de envio feitas nesta chamada. */
  tentativas?: number;
  /** Notas de contingência em `processarPendentes`: tempo desde a emissão em relação ao prazo de transmissão. */
  prazo?: PrazoContingencia;
}

type BaseResultado = Pick<ResultadoEmissao, 'chave' | 'numero' | 'serie' | 'qrCode' | 'urlChave' | 'totais' | 'xmlAssinado'>;

/** Reconstrói os dados básicos do resultado a partir da chave e do XML assinado. */
function baseDeXml(chave: string, xml: string): BaseResultado {
  const p = parseChave(chave);
  return {
    chave, numero: p.nNF, serie: p.serie, xmlAssinado: xml,
    qrCode: lerQrCode(xml),
    urlChave: /<urlChave>([^<]*)<\/urlChave>/.exec(xml)?.[1] ?? '',
    totais: { valorNota: Number(/<vNF>([\d.]+)<\/vNF>/.exec(xml)?.[1] ?? 0) },
  };
}

/** Conteúdo de <qrCode>, com ou sem CDATA (a NT 2025.001 dispensou o CDATA). */
export function lerQrCode(xml: string): string {
  const m = /<qrCode>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))\s*<\/qrCode>/.exec(xml);
  return (m?.[1] ?? m?.[2] ?? '').trim().replace(/&amp;/g, '&');
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const agoraIso = () => new Date().toISOString();
/** B09-40: NFC-e normal só é aceita até 5 min após o dhEmi; margem extra antes de declarar uma chave descartada. */
const JANELA_ENVIO_MIN = 5;
const MARGEM_DESCARTE_MIN = 5;

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
    if (config.registro && !config.storage) throw new NfceError('`registro` requer `storage` (onde o XML assinado é guardado).', 'CONFIG');
  }

  get ambiente(): Ambiente { return this.config.ambiente; }
  /** Hora atual segundo o relógio configurado. */
  agora(): Date { return this.config.relogio?.() ?? new Date(); }
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
  preparar(notaOriginal: NotaNfce, opcoes: { offline?: boolean; motivoContingencia?: string; cNF?: string } = {}) {
    const padrao = this.config.ibsCbsPadrao;
    const nota: NotaNfce = padrao ? { ...notaOriginal, itens: notaOriginal.itens.map((it) => (it.ibsCbs ? it : { ...it, ibsCbs: padrao })) } : notaOriginal;
    validarNota(nota);
    if (nota.emitente.endereco.uf.toUpperCase() !== this.config.uf) throw new ValidationError(`UF do emitente (${nota.emitente.endereco.uf}) diferente da UF do cliente (${this.config.uf})`, ['emitente.endereco.uf']);
    this.conferirCertificado(nota.emitente.cnpj);
    const offline = !!opcoes.offline;
    const agora = this.agora();
    const n: NotaNfce = {
      ...nota, emissao: nota.emissao ?? agora,
      responsavelTecnico: nota.responsavelTecnico ?? this.config.responsavelTecnico, versaoSoftware: nota.versaoSoftware ?? this.config.versaoSoftware,
    };
    const m = montarNfce(n, {
      ambiente: this.ambiente, tpEmis: offline ? 9 : 1, offsetMinutes: this.fuso, cNF: opcoes.cNF,
      dhCont: agora, xJust: opcoes.motivoContingencia,
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
    return { chave: m.chave, xmlAssinado, qrCode, urlChave, totais: m.totais, dhEmi: m.dhEmi, nota: n };
  }

  /**
   * Confere se o certificado pertence à empresa emitente. A SEFAZ compara a **raiz do CNPJ** (8 dígitos;
   * rejeição 213), o que permite ao certificado da matriz assinar notas das filiais. Certificados sem CNPJ
   * no CN (ou e-CPF) não são conferidos: a responsabilidade fica com quem chama.
   */
  conferirCertificado(cnpjEmitente: string): void {
    const doc = this.cert.documento;
    const cnpj = fmt.onlyDigits(cnpjEmitente);
    if (doc && doc.length === 14 && cnpj.length === 14 && doc.slice(0, 8) !== cnpj.slice(0, 8)) {
      throw new CertificateError(`O certificado digital é do CNPJ ${doc}, que não pertence à empresa emitente ${cnpj} (raiz do CNPJ diferente).`);
    }
  }

  /** Aplica padrões do cliente, valida e obtém o número (do `numerador` se a nota não trouxer). */
  async numerar(nota: NotaNfce): Promise<NotaNfce & { numero: number }> {
    const padrao = this.config.ibsCbsPadrao;
    const n: NotaNfce = padrao ? { ...nota, itens: nota.itens.map((it) => (it.ibsCbs ? it : { ...it, ibsCbs: padrao })) } : nota;
    validarNota(n);
    if (n.numero !== undefined) return n as NotaNfce & { numero: number };
    if (!this.config.numerador) throw new ValidationError('Informe `numero` na nota ou configure um `numerador` no cliente.', ['numero']);
    const numero = await this.config.numerador.proximo({ cnpj: fmt.onlyDigits(n.emitente.cnpj), ambiente: this.ambiente, modelo: 65, serie: n.serie });
    return { ...n, numero };
  }

  /**
   * Emite a NFC-e (envio síncrono), com garantia contra perda de nota:
   * 1. a nota é assinada e **gravada antes do envio** (`storage` + `registro`), fixando a chave;
   * 2. falhas temporárias são repetidas (`retentativas`);
   * 3. se ainda assim falhar, a nota fica `pendente` (ou vai para contingência) e pode ser concluída com
   *    `retomar(chave)` / `processarPendentes()` — sem gerar outra chave.
   *
   * Rejeições são devolvidas em `status: 'rejeitada'`. Falhas temporárias lançam um erro com `retentavel: true` e `chave`.
   */
  async emitir(notaOriginal: NotaNfce, opcoes: OpcoesEmissao = {}): Promise<ResultadoEmissao> {
    const reg = this.config.registro;
    const cnpj = fmt.onlyDigits(notaOriginal.emitente.cnpj);
    if (opcoes.referencia && reg) {
      const existente = await reg.buscarPorReferencia(cnpj, this.ambiente, opcoes.referencia);
      if (existente) return this.resultadoDoRegistro(existente);
    }
    const nota = await this.numerar(notaOriginal);
    const p = this.preparar(nota);
    const base: BaseResultado = { chave: p.chave, numero: nota.numero, serie: nota.serie, xmlAssinado: p.xmlAssinado, qrCode: p.qrCode, urlChave: p.urlChave, totais: { valorNota: p.totais.vNF } };
    try {
      await this.gravarAntesDeEnviar(p.chave, p.xmlAssinado, nota, { tpEmis: 1, referencia: opcoes.referencia, valor: p.totais.vNF, dhEmi: p.dhEmi });
    } catch (e) {
      // Outra requisição registrou a mesma referência ao mesmo tempo: devolve a nota dela.
      if (e instanceof RegistroDuplicadoError && opcoes.referencia && reg) {
        const existente = await reg.buscarPorReferencia(cnpj, this.ambiente, opcoes.referencia);
        if (existente) return this.resultadoDoRegistro(existente);
      }
      throw e;
    }
    return this.transmitir(base, { nota, referencia: opcoes.referencia });
  }

  /** Grava XML (storage) e depois o registro: a chave fica fixada antes de qualquer envio. */
  private async gravarAntesDeEnviar(chave: string, xml: string, nota: NotaNfce & { numero: number },
    o: { tpEmis: 1 | 9; referencia?: string; valor: number; dhEmi: string; chaveOriginal?: string }): Promise<void> {
    await this.config.storage?.salvar(o.tpEmis === 9 ? 'contingencia' : 'pendentes', chave, xml);
    const agora = agoraIso();
    await this.config.registro?.registrar({
      chave, cnpj: fmt.onlyDigits(nota.emitente.cnpj), uf: this.config.uf, ambiente: this.ambiente, serie: nota.serie, numero: nota.numero,
      tpEmis: o.tpEmis, situacao: o.tpEmis === 9 ? 'contingencia' : 'pendente', valor: o.valor, emitidaEm: o.dhEmi,
      referencia: o.referencia ?? null, chaveOriginal: o.chaveOriginal ?? null, tentativas: 0, criadaEm: agora, atualizadaEm: agora,
    });
  }

  /**
   * Envia com retentativa. Se a falha persistir:
   * - confirma pela consulta (a SEFAZ pode ter autorizado sem a resposta chegar);
   * - se for **certo** que a SEFAZ nunca recebeu a nota (todas as falhas antes da conexão, ou 108/109) e
   *   `contingenciaAutomatica` estiver ligada: emite offline com o **mesmo número** e descarta a chave online;
   * - se houver qualquer dúvida: a nota fica `pendente` (nunca cria uma segunda nota automaticamente) e o erro
   *   sai com `retentavel` e `chave`. Para dar um cupom ao consumidor nesse caso, use `contingencia.substituirPendente`.
   */
  private async transmitir(base: BaseResultado, ctx: { nota?: NotaNfce & { numero: number }; referencia?: string; tentativasAnteriores?: number } = {}): Promise<ResultadoEmissao> {
    const reg = this.config.registro;
    let tentativas = 0;
    let incerto = false;
    try {
      const r = await this.enviarComRetentativa(base, () => { tentativas++; }, (e) => { if (!e.naoRecebido) incerto = true; });
      return await this.finalizar(r, (ctx.tentativasAnteriores ?? 0) + tentativas);
    } catch (e) {
      if (!(e instanceof NfceError && e.retentavel)) {
        if (e instanceof NfceError) e.chave = base.chave;
        throw e;
      }
      if (incerto) {
        try {
          const c = await this.consultar(base.chave);
          if (c.situacao === 'autorizada' && c.xmlProtocolo) {
            const r = await this.resultadoAutorizado(base, c.cStat, c.xMotivo, c.xmlProtocolo, base.xmlAssinado);
            return await this.finalizar(r, (ctx.tentativasAnteriores ?? 0) + tentativas);
          }
        } catch { /* sem conectividade */ }
      }
      await reg?.atualizar(base.chave, { tentativas: (ctx.tentativasAnteriores ?? 0) + tentativas, ultimoErro: (e as Error).message.slice(0, 500) }).catch(() => {});
      if (!incerto && ctx.nota && this.config.contingenciaAutomatica && this.config.storage) {
        return this.contingencia.emitirOfflineInterno(ctx.nota, `Falha de comunicacao com a SEFAZ: ${(e as Error).message}`.slice(0, 250), {
          referencia: ctx.referencia, original: { chave: base.chave, modo: 'descartada' },
        });
      }
      e.chave = base.chave;
      throw e;
    }
  }

  private async enviarComRetentativa(base: BaseResultado, aoTentar: () => void, aoFalhar: (e: NfceError) => void): Promise<ResultadoEmissao> {
    const max = Math.max(1, this.config.retentativas?.tentativas ?? 3);
    const esperas = this.config.retentativas?.esperasMs ?? [500, 1500, 4000];
    for (let i = 1; ; i++) {
      aoTentar();
      try {
        return { ...(await this.enviarAssinada(base.xmlAssinado, base)), tentativas: i };
      } catch (e) {
        if (e instanceof NfceError) aoFalhar(e);
        if (!(e instanceof NfceError && e.retentavel) || i >= max) throw e;
        await espera(esperas[Math.min(i - 1, esperas.length - 1)] ?? 0);
      }
    }
  }

  /** Atualiza storage e registro com o resultado definitivo. */
  private async finalizar(r: ResultadoEmissao, tentativas: number): Promise<ResultadoEmissao> {
    const st = this.config.storage;
    if (st && r.status !== 'autorizada') await st.salvar('rejeitadas', r.chave, r.xmlAssinado);
    if (st) { await st.remover('pendentes', r.chave); await st.remover('contingencia', r.chave); }
    await this.config.registro?.atualizar(r.chave, {
      situacao: r.status === 'autorizada' ? 'autorizada' : r.status === 'denegada' ? 'denegada' : 'rejeitada',
      cStat: r.cStat, xMotivo: r.xMotivo, protocolo: r.protocolo ?? null, autorizadaEm: r.dataAutorizacao ?? null,
      tentativas, ultimoErro: null,
    });
    return r;
  }

  /**
   * @internal Monta o resultado de uma nota já registrada (idempotência por referência).
   * Notas a resolver são concluídas com `retomar`, salvo `semRede` (devolve o que está gravado, sem acessar a SEFAZ).
   */
  async resultadoDoRegistro(n: RegistroNota, opcoes: { semRede?: boolean } = {}): Promise<ResultadoEmissao> {
    const st = this.config.storage;
    if (SITUACOES_A_RESOLVER.includes(n.situacao)) {
      if (!opcoes.semRede) return this.retomar(n.chave);
      const xml = (await st?.ler(n.situacao === 'contingencia' ? 'contingencia' : 'pendentes', n.chave)) ?? '';
      return { ...baseDeXml(n.chave, xml), status: n.situacao === 'contingencia' ? 'contingencia' : 'pendente', cStat: n.cStat ?? '', xMotivo: n.xMotivo ?? '' };
    }
    const tipo = ['autorizada', 'cancelada', 'conflito'].includes(n.situacao) ? 'autorizadas' : n.situacao === 'descartada' ? 'substituidas' : 'rejeitadas';
    const xml = (await st?.ler(tipo, n.chave)) ?? '';
    const assinado = /<NFe[\s\S]*<\/NFe>/.exec(xml)?.[0] ?? xml;
    const status = n.situacao as StatusEmissao;
    return {
      ...baseDeXml(n.chave, assinado), status, cStat: n.cStat ?? '', xMotivo: n.xMotivo ?? '', protocolo: n.protocolo ?? undefined,
      dataAutorizacao: n.autorizadaEm ?? undefined, xmlAutorizado: tipo === 'autorizadas' && xml ? xml : undefined,
    };
  }

  /**
   * Conclui uma nota gravada e ainda sem resposta definitiva (pendente ou contingência). Idempotente:
   * consulta a chave antes e só reenvia se a SEFAZ não a conhecer. Use após uma falha temporária ou reinício.
   */
  async retomar(chave: string): Promise<ResultadoEmissao> {
    const st = this.config.storage;
    if (!st) throw new NfceError('`retomar` requer `storage` configurado.', 'STORAGE_AUSENTE');
    const reg = this.config.registro;
    const r0 = await reg?.buscar(chave);
    if (r0 && !SITUACOES_A_RESOLVER.includes(r0.situacao)) return this.resultadoDoRegistro(r0);
    if (r0?.situacao === 'substituida') return this.resolverSubstituida(r0);

    const xml = (await st.ler('pendentes', chave)) ?? (await st.ler('contingencia', chave));
    if (!xml) {
      const aut = await st.ler('autorizadas', chave);
      if (aut) return { ...baseDeXml(chave, aut), status: 'autorizada', cStat: '100', xMotivo: 'Autorizado o uso da NF-e', xmlAutorizado: aut };
      throw new NfceError(`XML da nota ${chave} não encontrado no storage.`, 'XML_AUSENTE');
    }
    const base = baseDeXml(chave, xml);
    const tentativasAnteriores = r0?.tentativas ?? 0;
    try {
      const c = await this.consultar(chave);
      if (c.situacao === 'autorizada' && c.xmlProtocolo) {
        return await this.finalizar(await this.resultadoAutorizado(base, c.cStat, c.xMotivo, c.xmlProtocolo, xml), tentativasAnteriores);
      }
      if (c.situacao === 'denegada') return await this.finalizar({ ...base, status: 'denegada', cStat: c.cStat, xMotivo: c.xMotivo, protocolo: c.protocolo }, tentativasAnteriores);
    } catch (e) {
      if (e instanceof NfceError) e.chave = chave;
      throw e;
    }
    return this.transmitir(base, { tentativasAnteriores });
  }

  /**
   * Nota online trocada por contingência com outro número: **nunca** é reenviada; só consultada.
   * - autorizada → `conflito` (a venda tem duas notas; cancele esta dentro do prazo da UF);
   * - inexistente (217) e já fora da janela de 5 min (B09-40) → `descartada` (número livre: inutilize — ver `buracos`);
   * - senão continua aguardando.
   */
  private async resolverSubstituida(r0: RegistroNota): Promise<ResultadoEmissao> {
    const st = this.config.storage!;
    const reg = this.config.registro!;
    const xml = (await st.ler('substituidas', r0.chave)) ?? '';
    const base = xml ? baseDeXml(r0.chave, xml) : { ...baseDeXml(r0.chave, ''), totais: { valorNota: r0.valor } };
    let c: ResultadoConsulta;
    try {
      c = await this.consultar(r0.chave);
    } catch (e) {
      if (e instanceof NfceError) e.chave = r0.chave;
      throw e;
    }
    if (c.situacao === 'autorizada' && c.xmlProtocolo) {
      const xmlAutorizado = xml ? S.montarNfeProc(xml, c.xmlProtocolo) : undefined;
      if (xmlAutorizado) await st.salvar('autorizadas', r0.chave, xmlAutorizado);
      const motivo = 'Autorizada depois de ter sido substituida por contingencia: a venda ficou com duas notas. Cancele esta nota (dentro do prazo da UF).';
      await reg.atualizar(r0.chave, { situacao: 'conflito', protocolo: c.protocolo ?? null, cStat: c.cStat, xMotivo: motivo });
      return { ...base, status: 'conflito', cStat: c.cStat, xMotivo: motivo, protocolo: c.protocolo, xmlAutorizado };
    }
    if (c.situacao === 'cancelada' || c.situacao === 'denegada') {
      await reg.atualizar(r0.chave, { situacao: c.situacao, cStat: c.cStat, xMotivo: c.xMotivo });
      return { ...base, status: c.situacao, cStat: c.cStat, xMotivo: c.xMotivo };
    }
    const idadeMin = (this.agora().getTime() - Date.parse(r0.emitidaEm)) / 60000;
    if (c.situacao === 'inexistente' && idadeMin > JANELA_ENVIO_MIN + MARGEM_DESCARTE_MIN) {
      const motivo = 'Nunca recebida pela SEFAZ e fora da janela de envio (B09-40): numero livre, inutilize-o (ver buracos).';
      await reg.atualizar(r0.chave, { situacao: 'descartada', cStat: c.cStat, xMotivo: motivo });
      return { ...base, status: 'descartada', cStat: c.cStat, xMotivo: motivo };
    }
    return { ...base, status: 'pendente', cStat: c.cStat, xMotivo: 'Nota substituida por contingencia, aguardando confirmacao de que a SEFAZ nao a recebeu.' };
  }

  /** Tempo desde a emissão de uma nota de contingência, comparado ao prazo de transmissão. */
  prazoContingencia(dhEmi: string): PrazoContingencia {
    const horas = this.config.prazoContingencia?.horas ?? 24;
    const alerta = this.config.prazoContingencia?.alertaHoras ?? 18;
    const h = (this.agora().getTime() - Date.parse(dhEmi)) / 3600000;
    return { horasDesdeEmissao: Math.round(h * 10) / 10, situacao: h > horas ? 'vencido' : h > alerta ? 'alerta' : 'ok' };
  }

  /**
   * Processa notas pendentes e de contingência (mais antigas primeiro). Nunca lança: cada nota volta com seu status
   * (`pendente`/`contingencia` com `xMotivo` do erro, se ainda não deu). Chame periodicamente (cron, fila, setInterval).
   */
  async processarPendentes(opcoes: { limite?: number; cnpj?: string } = {}): Promise<ResultadoEmissao[]> {
    const st = this.config.storage;
    if (!st) throw new NfceError('`processarPendentes` requer `storage` configurado.', 'STORAGE_AUSENTE');
    const limite = opcoes.limite ?? 100;
    let chaves: string[];
    if (this.config.registro) {
      chaves = (await this.config.registro.pendentes({ uf: this.config.uf, ambiente: this.ambiente, cnpj: opcoes.cnpj, limite })).map((n) => n.chave);
    } else {
      const prefixo = String(this.cUF);
      const candidatas = [...(await st.listar('contingencia')), ...(await st.listar('pendentes'))]
        .filter((c) => c.startsWith(prefixo) && (!opcoes.cnpj || c.slice(6, 20) === opcoes.cnpj));
      chaves = [];
      for (const c of candidatas) {
        if (chaves.length >= limite) break;
        const xml = (await st.ler('contingencia', c)) ?? (await st.ler('pendentes', c));
        if (xml && /<tpAmb>(\d)<\/tpAmb>/.exec(xml)?.[1] === String(this.tpAmb)) chaves.push(c);
      }
    }
    const out: ResultadoEmissao[] = [];
    for (const chave of chaves) {
      const xml = (await st.ler('contingencia', chave)) ?? (await st.ler('pendentes', chave)) ?? '';
      const contingencia = parseChave(chave).tpEmis === 9;
      // Prazo da contingência: avisa (alerta/vencido) mas ainda tenta transmitir.
      const dhEmi = /<dhEmi>([^<]+)<\/dhEmi>/.exec(xml)?.[1];
      const prazo = contingencia && dhEmi ? this.prazoContingencia(dhEmi) : undefined;
      let r: ResultadoEmissao;
      try {
        r = await this.retomar(chave);
      } catch (e) {
        r = { ...baseDeXml(chave, xml), status: contingencia ? 'contingencia' : 'pendente', cStat: (e as SefazError).cStat ?? '', xMotivo: (e as Error).message };
      }
      if (prazo && prazo.situacao !== 'ok' && r.status === 'contingencia') {
        r.xMotivo = `${r.xMotivo} [PRAZO ${prazo.situacao.toUpperCase()}: ${prazo.horasDesdeEmissao} h desde a emissao]`;
      }
      out.push(prazo ? { ...r, prazo } : r);
    }
    return out;
  }

  /**
   * Reemite uma nota **rejeitada** com a mesma série e número (evita buraco na numeração).
   * A nota corrigida recebe nova chave; a referência do pedido passa para ela.
   */
  async reemitir(chave: string, notaCorrigida: NotaNfce, opcoes: OpcoesEmissao = {}): Promise<ResultadoEmissao> {
    const reg = this.config.registro;
    const r0 = await reg?.buscar(chave);
    if (r0 && !SITUACOES_SEM_NUMERO.includes(r0.situacao)) {
      throw new ValidationError(`Só notas rejeitadas (ou descartadas) podem ser reemitidas com o mesmo número (situação atual: ${r0.situacao}).`, ['chave']);
    }
    const pc = parseChave(chave);
    if (reg) {
      // O número pode já ter sido reaproveitado (reemissão anterior, contingência): nunca duas notas vivas no mesmo número.
      const vivas = (await reg.buscarPorNumero(pc.cnpj, this.ambiente, pc.serie, pc.nNF)).filter((n) => n.chave !== chave && !SITUACOES_SEM_NUMERO.includes(n.situacao));
      if (vivas.length) throw new ValidationError(`O número ${pc.nNF} (série ${pc.serie}) já está ocupado pela nota ${vivas[0]!.chave} (${vivas[0]!.situacao}).`, ['chave']);
    }
    if (!r0) {
      const c = await this.consultar(chave);
      if (c.situacao !== 'inexistente') throw new ValidationError(`A nota ${chave} existe na SEFAZ (${c.situacao}); não pode ser reemitida.`, ['chave']);
    }
    if (fmt.onlyDigits(notaCorrigida.emitente.cnpj) !== pc.cnpj) throw new ValidationError('O CNPJ do emitente difere do da nota original.', ['emitente.cnpj']);
    const referencia = opcoes.referencia ?? r0?.referencia ?? undefined;
    if (r0?.referencia) await reg!.atualizar(chave, { referencia: null });
    return this.emitir({ ...notaCorrigida, serie: pc.serie, numero: pc.nNF }, { referencia });
  }

  /** Envia uma NFC-e já assinada (uma tentativa). Prefira `emitir`/`retomar`, que gravam o estado. */
  async enviarAssinada(xmlAssinado: string, base: BaseResultado): Promise<ResultadoEmissao> {
    const ret = S.parseRetEnviNFe(await this.chamar('autorizacao', S.xmlLote(idLote(), [xmlAssinado], true)));
    if (CSTAT_INDISPONIVEL.includes(ret.cStat)) throw new SefazError(`SEFAZ indisponível: ${ret.cStat} ${ret.xMotivo}`, ret.cStat, ret.xMotivo, ret);
    let prot = ret.protocolo;
    // Lote recebido (assíncrono) ou em processamento: consultar o recibo.
    if (!prot && ret.nRec) {
      for (let i = 0; i < 5 && !prot; i++) {
        const r = S.parseRetConsReciNFe(await this.chamar('retAutorizacao', S.xmlConsultaRecibo(this.ambiente, ret.nRec)));
        if (r.protocolo) prot = r.protocolo;
        else if (r.cStat !== '105') break;
        else await espera(1500);
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

  private resultado(base: BaseResultado, status: StatusEmissao, cStat: string, xMotivo: string, protocolo?: string): ResultadoEmissao {
    return { ...base, status, cStat, xMotivo, protocolo };
  }

  async resultadoAutorizado(base: BaseResultado, cStat: string, xMotivo: string, protXml: string, xmlAssinado: string): Promise<ResultadoEmissao> {
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
    await this.registrarCancelamento(p.chave, r);
    return r;
  }

  /** Guarda o XML do evento e marca a nota como cancelada no registro (só em caso de sucesso). */
  private async registrarCancelamento(chave: string, r: ResultadoEvento): Promise<void> {
    if (!r.sucesso) return;
    if (r.xmlProcEvento) await this.config.storage?.salvar('cancelamentos', chave, r.xmlProcEvento);
    await this.config.registro?.atualizar(chave, {
      situacao: 'cancelada', protocoloCancelamento: r.protocolo ?? null, canceladaEm: this.agora().toISOString(), cStat: r.cStat, xMotivo: r.xMotivo,
    }).catch((e) => { if ((e as NfceError).code !== 'REGISTRO_AUSENTE') throw e; });
  }

  /** Cancelamento por substituição (110112): cancela `chave` apontando a NFC-e substituta já autorizada. */
  async cancelarPorSubstituicao(p: { chave: string; protocolo: string; justificativa: string; chaveSubstituta: string }): Promise<ResultadoEvento> {
    const r = await this.enviarEvento(
      p.chave, TIPO_CANCELAMENTO_SUBSTITUICAO,
      detalheCancelamentoSubstituicao({ cOrgaoAutor: this.cUF, protocolo: p.protocolo, justificativa: p.justificativa, chaveSubstituta: p.chaveSubstituta, verAplic: this.config.versaoSoftware }),
    );
    await this.registrarCancelamento(p.chave, r);
    return r;
  }

  /** Inutiliza uma faixa de numeração (série/numeração não utilizada). */
  async inutilizar(p: { serie: number; numeroInicial: number; numeroFinal?: number; justificativa: string; cnpj?: string; ano?: number }): Promise<ResultadoInutilizacao> {
    const cnpj = p.cnpj ?? this.cert.documento;
    if (!cnpj || cnpj.length !== 14) throw new ValidationError('Informe `cnpj` do emitente (não foi possível obter do certificado).', ['cnpj']);
    this.conferirCertificado(cnpj);
    const ano = p.ano ?? new Date(this.agora().getTime() + this.fuso * 60000).getUTCFullYear();
    const inut = montarInutilizacao({
      ambiente: this.ambiente, cUF: this.cUF, cnpj, ano, serie: p.serie, numeroInicial: p.numeroInicial, numeroFinal: p.numeroFinal ?? p.numeroInicial, justificativa: p.justificativa,
    });
    const assinado = assinarXml(inut.xml, 'infInut', 'inutNFe', this.cert);
    const r = S.parseRetInutNFe(await this.chamar('inutilizacao', assinado));
    const sucesso = r.cStat === '102';
    if (sucesso) {
      await this.config.storage?.salvar('inutilizacoes', inut.id, S.montarProcInut(assinado, r.xml));
      await this.config.registro?.registrarInutilizacao({
        cnpj: fmt.onlyDigits(cnpj), ambiente: this.ambiente, serie: p.serie, inicio: p.numeroInicial, fim: p.numeroFinal ?? p.numeroInicial, protocolo: r.nProt ?? null,
      });
    }
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

  /**
   * Emite em contingência offline (tpEmis=9), para uma venda **ainda não tentada online** (SEFAZ sabidamente fora,
   * ou decisão explícita). Grava em `contingencia/` para transmissão por `processarPendentes`.
   * Com `referencia` já registrada, devolve a nota existente (não cria outra).
   */
  async emitirOffline(
    nota: NotaNfce,
    motivo = 'Contingencia off-line por indisponibilidade de comunicacao com a SEFAZ',
    opcoes: OpcoesEmissao = {},
  ): Promise<ResultadoEmissao> {
    const reg = this.client.config.registro;
    if (opcoes.referencia && reg) {
      const existente = await reg.buscarPorReferencia(fmt.onlyDigits(nota.emitente.cnpj), this.client.ambiente, opcoes.referencia);
      if (existente) return this.client.resultadoDoRegistro(existente, { semRede: true });
    }
    return this.emitirOfflineInterno(nota, motivo, opcoes);
  }

  /**
   * Para uma venda cuja nota online ficou `pendente` com recebimento **incerto** (ex.: timeout): emite um cupom
   * offline com **número novo** para o consumidor e marca a original como `substituida`. A original nunca é reenviada;
   * `processarPendentes` a consulta e conclui: `descartada` (número para inutilizar) ou `conflito` (cancelar a original).
   * Requer `registro`.
   */
  async substituirPendente(chave: string, nota: NotaNfce, motivo = 'Contingencia off-line: autorizacao online sem resposta'): Promise<ResultadoEmissao> {
    const reg = this.client.config.registro;
    if (!reg) throw new NfceError('`substituirPendente` requer `registro` configurado.', 'CONFIG');
    const r0 = await reg.buscar(chave);
    if (!r0 || r0.situacao !== 'pendente' || r0.tpEmis !== 1) {
      throw new ValidationError(`A nota ${chave} não está pendente de envio online (situação: ${r0?.situacao ?? 'não registrada'}).`, ['chave']);
    }
    if (fmt.onlyDigits(nota.emitente.cnpj) !== r0.cnpj) throw new ValidationError('O CNPJ do emitente difere do da nota pendente.', ['emitente.cnpj']);
    if (nota.numero !== undefined && nota.numero === r0.numero && nota.serie === r0.serie) {
      throw new ValidationError('A nota de contingência precisa de outro número (a original pode ter sido recebida pela SEFAZ).', ['numero']);
    }
    return this.emitirOfflineInterno({ ...nota, numero: nota.numero }, motivo, {
      referencia: r0.referencia ?? undefined, original: { chave, modo: 'substituida' },
    });
  }

  /**
   * @internal Emite offline. Com `original`: a nota online é tirada de `pendentes/` (guardada em `substituidas/`) e marcada
   * `descartada` (mesmo número, SEFAZ certamente não recebeu) ou `substituida` (número novo, recebimento incerto).
   */
  async emitirOfflineInterno(
    nota: NotaNfce, motivo: string,
    opcoes: OpcoesEmissao & { original?: { chave: string; modo: 'descartada' | 'substituida' } },
  ): Promise<ResultadoEmissao> {
    const st = this.storage;
    const reg = this.client.config.registro;
    const n = await this.client.numerar(nota);
    const p = this.client.preparar(n, { offline: true, motivoContingencia: motivo });
    const o = opcoes.original;
    if (o) {
      const orig = await st.ler('pendentes', o.chave);
      if (orig) await st.salvar('substituidas', o.chave, orig);
      await st.remover('pendentes', o.chave);
      // Antes de registrar a nova nota: libera a referência (e, se descartada, o número).
      await reg?.atualizar(o.chave, {
        situacao: o.modo, referencia: null,
        xMotivo: o.modo === 'descartada'
          ? `Nao recebida pela SEFAZ (falha antes da conexao); substituida pela contingencia ${p.chave} com o mesmo numero.`
          : `Recebimento incerto; substituida pela contingencia ${p.chave}. Aguardando consulta.`,
      });
    }
    await st.salvar('contingencia', p.chave, p.xmlAssinado);
    const agora = agoraIso();
    await reg?.registrar({
      chave: p.chave, cnpj: fmt.onlyDigits(n.emitente.cnpj), uf: this.client.config.uf, ambiente: this.client.ambiente, serie: n.serie,
      numero: n.numero, tpEmis: 9, situacao: 'contingencia', valor: p.totais.vNF, emitidaEm: p.dhEmi, referencia: opcoes.referencia ?? null,
      chaveOriginal: o?.chave ?? null, tentativas: 0, criadaEm: agora, atualizadaEm: agora,
    });
    return {
      status: 'contingencia', chave: p.chave, numero: n.numero, serie: n.serie, cStat: '', xMotivo: 'Emitida em contingência offline; pendente de transmissão',
      xmlAssinado: p.xmlAssinado, qrCode: p.qrCode, urlChave: p.urlChave, totais: { valorNota: p.totais.vNF }, motivoContingencia: motivo,
    };
  }

  /** Chaves de NFC-e em contingência ainda não transmitidas. */
  pendentes(): Promise<string[]> { return this.storage.listar('contingencia'); }

  /** Transmite as notas pendentes e de contingência. Equivale a `client.processarPendentes()`. */
  transmitirPendentes(opcoes: { limite?: number; cnpj?: string } = {}): Promise<ResultadoEmissao[]> {
    return this.client.processarPendentes(opcoes);
  }
}
