// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
import { createHash } from 'node:crypto';
import type { Ambiente, IcmsItem, Item, NotaNfce, PisCofins, Pagamento, Totais } from '../types.js';
import { TPAG } from '../types.js';
import { UF_CODIGO, gerarCNF, montarChave } from './chave.js';
import { dhFormat, fmt, group, sanitizeText, tag } from '../util/xml.js';
import { ValidationError } from '../errors/index.js';
import { calcularIbsCbs, somaTributosNoItem, totalIbsCbsXml } from '../rtc/index.js';

export const NFE_NS = 'http://www.portalfiscal.inf.br/nfe';
export const HOMOLOG_TXT = 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';
/** Nome do destinatário em homologação (xNome limitado a 60 caracteres). */
export const HOMOLOG_DEST = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

export interface BuildContext {
  ambiente: Ambiente;
  /** 1=normal, 9=contingência offline. */
  tpEmis: 1 | 9;
  offsetMinutes: number;
  /** Para contingência (tpEmis=9). */
  dhCont?: Date;
  xJust?: string;
  cNF?: string;
  verProc?: string;
}

export interface NfceMontada {
  chave: string;
  /** `<NFe>` sem infNFeSupl e sem Signature. */
  xml: string;
  /** Somente o `<infNFe>`. */
  infNFe: string;
  totais: Totais;
  emissao: Date;
  dhEmi: string;
  cDV: number;
}

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

function icmsXml(i: IcmsItem, itemBase: number, tot: Totais): string {
  const o = tag('orig', i.origem);
  if ('csosn' in i) {
    const c = i.csosn;
    if (c === '101') {
      const v = i.valorCreditoSN ?? r2((itemBase * i.aliquotaCreditoSN) / 100);
      return group('ICMSSN101', [o, tag('CSOSN', c), tag('pCredSN', fmt.dec(i.aliquotaCreditoSN, 4)), tag('vCredICMSSN', fmt.money(v))]);
    }
    if (c === '500') {
      return group('ICMSSN500', [
        o, tag('CSOSN', c),
        i.baseSTRetido !== undefined ? tag('vBCSTRet', fmt.money(i.baseSTRetido)) : '',
        i.aliquotaST !== undefined ? tag('pST', fmt.dec(i.aliquotaST, 4)) : '',
        i.valorICMSSubstituto !== undefined ? tag('vICMSSubstituto', fmt.money(i.valorICMSSubstituto)) : '',
        i.valorSTRetido !== undefined ? tag('vICMSSTRet', fmt.money(i.valorSTRetido)) : '',
      ]);
    }
    if (c === '900') {
      const parts = [o, tag('CSOSN', c)];
      if (i.aliquota !== undefined) {
        const bc = i.baseCalculo ?? itemBase;
        const v = i.valor ?? r2((bc * i.aliquota) / 100);
        tot.vBC += bc; tot.vICMS += v;
        parts.push(tag('modBC', 3), tag('vBC', fmt.money(bc)), tag('pICMS', fmt.dec(i.aliquota, 4)), tag('vICMS', fmt.money(v)));
      }
      if (i.aliquotaCreditoSN !== undefined) {
        const v = i.valorCreditoSN ?? r2((itemBase * i.aliquotaCreditoSN) / 100);
        parts.push(tag('pCredSN', fmt.dec(i.aliquotaCreditoSN, 4)), tag('vCredICMSSN', fmt.money(v)));
      }
      return group('ICMSSN900', parts);
    }
    return group('ICMSSN102', [o, tag('CSOSN', c)]);
  }
  switch (i.cst) {
    case '00': {
      const bc = i.baseCalculo ?? itemBase;
      const v = i.valor ?? r2((bc * i.aliquota) / 100);
      tot.vBC += bc; tot.vICMS += v;
      return group('ICMS00', [o, tag('CST', '00'), tag('modBC', 3), tag('vBC', fmt.money(bc)), tag('pICMS', fmt.dec(i.aliquota, 4)), tag('vICMS', fmt.money(v))]);
    }
    case '20': {
      const bc = i.baseCalculo ?? r2(itemBase * (1 - i.reducaoBase / 100));
      const v = i.valor ?? r2((bc * i.aliquota) / 100);
      tot.vBC += bc; tot.vICMS += v;
      return group('ICMS20', [o, tag('CST', '20'), tag('modBC', 3), tag('pRedBC', fmt.dec(i.reducaoBase, 4)), tag('vBC', fmt.money(bc)), tag('pICMS', fmt.dec(i.aliquota, 4)), tag('vICMS', fmt.money(v))]);
    }
    case '40': case '41': case '50':
      return group('ICMS40', [o, tag('CST', i.cst)]);
    case '60':
      return group('ICMS60', [
        o, tag('CST', '60'),
        i.baseSTRetido !== undefined ? tag('vBCSTRet', fmt.money(i.baseSTRetido)) : '',
        i.aliquotaST !== undefined ? tag('pST', fmt.dec(i.aliquotaST, 4)) : '',
        i.valorICMSSubstituto !== undefined ? tag('vICMSSubstituto', fmt.money(i.valorICMSSubstituto)) : '',
        i.valorSTRetido !== undefined ? tag('vICMSSTRet', fmt.money(i.valorSTRetido)) : '',
      ]);
    case '90': {
      const bc = i.baseCalculo ?? itemBase;
      const al = i.aliquota ?? 0;
      const v = i.valor ?? r2((bc * al) / 100);
      tot.vBC += bc; tot.vICMS += v;
      return group('ICMS90', [o, tag('CST', '90'), tag('modBC', 3), tag('vBC', fmt.money(bc)), tag('pICMS', fmt.dec(al, 4)), tag('vICMS', fmt.money(v))]);
    }
    default:
      throw new ValidationError(`CST de ICMS não suportado: ${(i as { cst: string }).cst}`, ['icms']);
  }
}

function pisCofinsXml(kind: 'PIS' | 'COFINS', p: PisCofins | undefined, base: number, tot: Totais): string {
  const pct = kind === 'PIS' ? 'pPIS' : 'pCOFINS';
  const v = kind === 'PIS' ? 'vPIS' : 'vCOFINS';
  const add = (x: number) => { if (kind === 'PIS') tot.vPIS += x; else tot.vCOFINS += x; };
  const cst = p?.cst ?? '49';
  if (['04', '05', '06', '07', '08', '09'].includes(cst)) return group(kind, group(`${kind}NT`, tag('CST', cst)));
  if (cst === '01' || cst === '02') {
    const pp = p as { baseCalculo?: number; aliquota: number; valor?: number };
    const bc = pp.baseCalculo ?? base;
    const val = pp.valor ?? r2((bc * pp.aliquota) / 100);
    add(val);
    return group(kind, group(`${kind}Aliq`, [tag('CST', cst), tag('vBC', fmt.money(bc)), tag(pct, fmt.dec(pp.aliquota, 4)), tag(v, fmt.money(val))]));
  }
  const pp = (p ?? {}) as { baseCalculo?: number; aliquota?: number; valor?: number };
  const bc = pp.baseCalculo ?? 0;
  const al = pp.aliquota ?? 0;
  const val = pp.valor ?? r2((bc * al) / 100);
  add(val);
  return group(kind, group(`${kind}Outr`, [tag('CST', cst), tag('vBC', fmt.money(bc)), tag(pct, fmt.dec(al, 4)), tag(v, fmt.money(val))]));
}

function pagXml(pags: Pagamento[], troco: number): string {
  const det = pags.map((p) => {
    const t = TPAG[p.tipo as keyof typeof TPAG] ?? p.tipo;
    const isCard = ['03', '04'].includes(t);
    let card = '';
    if (p.cartao || isCard) {
      const c = p.cartao;
      card = group('card', c?.integrado
        ? [tag('tpIntegra', 1), tag('CNPJ', c.cnpjCredenciadora), tag('tBand', c.bandeira), tag('cAut', c.autorizacao)]
        : [tag('tpIntegra', 2)]);
    }
    return group('detPag', [tag('tPag', t), t === '99' ? tag('xPag', sanitizeText(p.descricao ?? 'Outros')) : '', tag('vPag', fmt.money(p.valor)), card]);
  });
  return group('pag', [...det, troco > 0 ? tag('vTroco', fmt.money(troco)) : '']);
}

/** Monta o XML (sem assinatura/QR) de uma NFC-e. A validação de negócio fica em `validarNota`. */
export function montarNfce(nota: NotaNfce, ctx: BuildContext): NfceMontada {
  const { emitente: e } = nota;
  const uf = e.endereco.uf;
  const cUF = UF_CODIGO[uf];
  if (!cUF) throw new ValidationError(`UF inválida: ${uf}`, ['emitente.endereco.uf']);
  const emissao = nota.emissao ?? new Date();
  const dhEmi = dhFormat(emissao, ctx.offsetMinutes);
  const tpAmb = ctx.ambiente === 'producao' ? 1 : 2;
  const cNF = ctx.cNF ?? gerarCNF(nota.numero);
  const { chave, cDV } = montarChave({
    cUF, emissao, offsetMinutes: ctx.offsetMinutes, cnpj: e.cnpj, serie: nota.serie, nNF: nota.numero, tpEmis: ctx.tpEmis, cNF,
  });

  const tot: Totais = { vProd: 0, vDesc: 0, vFrete: 0, vSeg: 0, vOutro: 0, vBC: 0, vICMS: 0, vICMSDeson: 0, vPIS: 0, vCOFINS: 0, vTotTrib: 0, vNF: 0 };

  const local = new Date(emissao.getTime() + ctx.offsetMinutes * 60000);
  const anoEmissao = local.getUTCFullYear();
  const dataEmissao = dhEmi.slice(0, 10);
  const rtc = { vBC: 0, vIBSUF: 0, vIBSMun: 0, vIBS: 0, vCBS: 0, vNFTot: 0 };
  let temIbsCbs = false;

  const dets = nota.itens.map((it: Item, idx) => {
    const vProd = r2(it.quantidade * it.valorUnitario);
    const vDesc = r2(it.desconto ?? 0);
    const vFrete = r2(it.frete ?? 0), vSeg = r2(it.seguro ?? 0), vOutro = r2(it.outrasDespesas ?? 0);
    tot.vProd += vProd; tot.vDesc += vDesc; tot.vFrete += vFrete; tot.vSeg += vSeg; tot.vOutro += vOutro;
    const base = r2(vProd - vDesc + vFrete + vSeg + vOutro);
    const gtin = it.gtin ? fmt.onlyDigits(it.gtin) : 'SEM GTIN';
    const xProd = idx === 0 && ctx.ambiente === 'homologacao' ? HOMOLOG_TXT : sanitizeText(it.descricao);
    const prod = group('prod', [
      tag('cProd', it.codigo), tag('cEAN', gtin), tag('xProd', xProd), tag('NCM', fmt.onlyDigits(it.ncm)), tag('CEST', it.cest),
      tag('CFOP', it.cfop), tag('uCom', it.unidade), tag('qCom', fmt.dec(it.quantidade, 4)), tag('vUnCom', fmt.dec(it.valorUnitario, 4)),
      tag('vProd', fmt.money(vProd)), tag('cEANTrib', gtin), tag('uTrib', it.unidade), tag('qTrib', fmt.dec(it.quantidade, 4)),
      tag('vUnTrib', fmt.dec(it.valorUnitario, 4)),
      vFrete ? tag('vFrete', fmt.money(vFrete)) : '', vSeg ? tag('vSeg', fmt.money(vSeg)) : '',
      vDesc ? tag('vDesc', fmt.money(vDesc)) : '', vOutro ? tag('vOutro', fmt.money(vOutro)) : '', tag('indTot', 1),
    ]);
    if (it.valorTributosAprox) tot.vTotTrib += it.valorTributosAprox;
    const antes = { vICMS: tot.vICMS, vPIS: tot.vPIS, vCOFINS: tot.vCOFINS };
    const icms = group('ICMS', icmsXml(it.icms, base, tot));
    const pis = pisCofinsXml('PIS', it.pis, base, tot);
    const cofins = pisCofinsXml('COFINS', it.cofins, base, tot);
    let ibsCbsXml = '';
    let vItem = '';
    if (it.ibsCbs) {
      temIbsCbs = true;
      const c = calcularIbsCbs(it.ibsCbs, {
        vProd, vDesc, vFrete, vSeg, vOutro, vFCP: 0,
        vICMS: r2(tot.vICMS - antes.vICMS), vPIS: r2(tot.vPIS - antes.vPIS), vCOFINS: r2(tot.vCOFINS - antes.vCOFINS),
      }, { ano: anoEmissao, data: dataEmissao }, `itens[${idx}].ibsCbs`);
      ibsCbsXml = c.xml;
      rtc.vBC += c.vBC; rtc.vIBSUF += c.vIBSUF; rtc.vIBSMun += c.vIBSMun; rtc.vIBS += c.vIBS; rtc.vCBS += c.vCBS;
      // VB01-10: vItem = vProd − vDesc + vFrete + vSeg + vOutro (+ vIBS + vCBS a partir de 2027).
      const vi = r2(base + (somaTributosNoItem(anoEmissao) ? c.vIBS + c.vCBS : 0));
      rtc.vNFTot += vi;
      vItem = tag('vItem', fmt.money(vi));
    }
    const imposto = group('imposto', [
      it.valorTributosAprox !== undefined ? tag('vTotTrib', fmt.money(it.valorTributosAprox)) : '',
      icms, pis, cofins, ibsCbsXml,
    ]);
    return group('det', [prod, imposto, tag('infAdProd', it.informacoesAdicionais && sanitizeText(it.informacoesAdicionais)), vItem], { nItem: String(idx + 1) });
  });

  for (const k of ['vProd', 'vDesc', 'vFrete', 'vSeg', 'vOutro', 'vBC', 'vICMS', 'vICMSDeson', 'vPIS', 'vCOFINS', 'vTotTrib'] as const) tot[k] = r2(tot[k]);
  if (temIbsCbs && nota.itens.some((it) => !it.ibsCbs)) {
    throw new ValidationError('Informe ibsCbs em todos os itens (ou em nenhum): o total IBSCBSTot exige consistência entre os itens.', ['itens']);
  }
  if (temIbsCbs) {
    for (const k of Object.keys(rtc) as (keyof typeof rtc)[]) rtc[k] = r2(rtc[k]);
    tot.ibsCbs = rtc;
  }
  tot.vNF = r2(tot.vProd - tot.vDesc + tot.vFrete + tot.vSeg + tot.vOutro);
  const pago = r2(nota.pagamentos.reduce((s, p) => s + p.valor, 0));
  const troco = r2(pago - tot.vNF);

  const ind = nota.indicadorPresenca ?? 1;
  const ide = group('ide', [
    tag('cUF', cUF), tag('cNF', cNF), tag('natOp', sanitizeText(nota.naturezaOperacao ?? 'VENDA AO CONSUMIDOR')), tag('mod', 65),
    tag('serie', nota.serie), tag('nNF', nota.numero), tag('dhEmi', dhEmi), tag('tpNF', 1), tag('idDest', 1),
    tag('cMunFG', e.endereco.codigoMunicipio),
    // B25b-60/70: cMunFGIBS é obrigatório na NFC-e com indPres=5 e proibido nos demais casos.
    ind === 5 ? tag('cMunFGIBS', nota.municipioFatoGerador ?? e.endereco.codigoMunicipio) : '',
    tag('tpImp', 4), tag('tpEmis', ctx.tpEmis), tag('cDV', cDV), tag('tpAmb', tpAmb),
    tag('finNFe', 1), tag('indFinal', 1), tag('indPres', ind), tag('procEmi', 0), tag('verProc', ctx.verProc ?? nota.versaoSoftware ?? 'zexon-nfce 0.2'),
    ctx.tpEmis === 9 ? tag('dhCont', dhFormat(ctx.dhCont ?? emissao, ctx.offsetMinutes)) : '',
    ctx.tpEmis === 9 ? tag('xJust', sanitizeText(ctx.xJust ?? 'Contingencia off-line por indisponibilidade de comunicacao')) : '',
  ]);

  const en = e.endereco;
  const emit = group('emit', [
    tag('CNPJ', fmt.onlyDigits(e.cnpj)), tag('xNome', sanitizeText(e.razaoSocial)), tag('xFant', e.nomeFantasia && sanitizeText(e.nomeFantasia)),
    group('enderEmit', [
      tag('xLgr', sanitizeText(en.logradouro)), tag('nro', en.numero), tag('xCpl', en.complemento), tag('xBairro', sanitizeText(en.bairro)),
      tag('cMun', en.codigoMunicipio), tag('xMun', sanitizeText(en.municipio)), tag('UF', en.uf), tag('CEP', fmt.onlyDigits(en.cep)),
      tag('cPais', 1058), tag('xPais', 'BRASIL'), tag('fone', en.fone && fmt.onlyDigits(en.fone)),
    ]),
    tag('IE', fmt.onlyDigits(e.inscricaoEstadual)), tag('IM', e.inscricaoMunicipal), tag('CNAE', e.cnae), tag('CRT', e.regimeTributario),
  ]);

  const c = nota.consumidor;
  let dest = '';
  if (c && (c.cpf || c.cnpj || c.idEstrangeiro)) {
    const nome = ctx.ambiente === 'homologacao' ? HOMOLOG_DEST : c.nome && sanitizeText(c.nome);
    const ce = c.endereco;
    dest = group('dest', [
      tag('CNPJ', c.cnpj && fmt.onlyDigits(c.cnpj)), tag('CPF', c.cpf && fmt.onlyDigits(c.cpf)), tag('idEstrangeiro', c.idEstrangeiro),
      tag('xNome', nome),
      ce ? group('enderDest', [
        tag('xLgr', sanitizeText(ce.logradouro)), tag('nro', ce.numero), tag('xCpl', ce.complemento), tag('xBairro', sanitizeText(ce.bairro)),
        tag('cMun', ce.codigoMunicipio), tag('xMun', sanitizeText(ce.municipio)), tag('UF', ce.uf), tag('CEP', fmt.onlyDigits(ce.cep)),
        tag('cPais', 1058), tag('xPais', 'BRASIL'), tag('fone', ce.fone && fmt.onlyDigits(ce.fone)),
      ]) : '',
      tag('indIEDest', 9), tag('email', c.email),
    ]);
  }

  const total = group('total', group('ICMSTot', [
    tag('vBC', fmt.money(tot.vBC)), tag('vICMS', fmt.money(tot.vICMS)), tag('vICMSDeson', fmt.money(0)), tag('vFCP', fmt.money(0)),
    tag('vBCST', fmt.money(0)), tag('vST', fmt.money(0)), tag('vFCPST', fmt.money(0)), tag('vFCPSTRet', fmt.money(0)),
    tag('vProd', fmt.money(tot.vProd)), tag('vFrete', fmt.money(tot.vFrete)), tag('vSeg', fmt.money(tot.vSeg)), tag('vDesc', fmt.money(tot.vDesc)),
    tag('vII', fmt.money(0)), tag('vIPI', fmt.money(0)), tag('vIPIDevol', fmt.money(0)), tag('vPIS', fmt.money(tot.vPIS)),
    tag('vCOFINS', fmt.money(tot.vCOFINS)), tag('vOutro', fmt.money(tot.vOutro)), tag('vNF', fmt.money(tot.vNF)),
    tot.vTotTrib ? tag('vTotTrib', fmt.money(tot.vTotTrib)) : '',
  ]) + (tot.ibsCbs ? totalIbsCbsXml(tot.ibsCbs) + tag('vNFTot', fmt.money(tot.ibsCbs.vNFTot)) : ''));

  const rt = nota.responsavelTecnico;
  const infRespTec = rt
    ? group('infRespTec', [
        tag('CNPJ', fmt.onlyDigits(rt.cnpj)), tag('xContato', sanitizeText(rt.contato)), tag('email', rt.email), tag('fone', fmt.onlyDigits(rt.fone)),
        rt.csrt ? tag('idCSRT', rt.csrt.id) : '',
        rt.csrt ? tag('hashCSRT', createHash('sha1').update(rt.csrt.token + chave).digest('base64')) : '',
      ])
    : '';

  const infNFe = group(
    'infNFe',
    [
      ide, emit, dest, ...dets, total,
      group('transp', tag('modFrete', 9)),
      pagXml(nota.pagamentos, troco),
      group('infAdic', tag('infCpl', nota.informacoesComplementares && sanitizeText(nota.informacoesComplementares))),
      infRespTec,
    ],
    { Id: `NFe${chave}`, versao: '4.00' },
  );
  const xml = `<NFe xmlns="${NFE_NS}">${infNFe}</NFe>`;
  return { chave, xml, infNFe, totais: tot, emissao, dhEmi, cDV };
}
