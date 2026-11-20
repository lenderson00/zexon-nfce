// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
import { createHash } from 'node:crypto';
import type { Ambiente, IcmsItem, Item, NotaNfce, PisCofins, Pagamento, Totais } from '../types.js';
import { TPAG } from '../types.js';
import { UF_CODIGO, gerarCNF, montarChave } from './chave.js';
import { dhFormat, fmt, group, sanitizeText, tag } from '../util/xml.js';
import { ValidationError } from '../errors/index.js';
import { calcularIbsCbs, somaTributosNoItem, totalIbsCbsXml } from '../rtc/index.js';
import { aplicarAliquota, centavosParaReais, centavosParaXml, reaisParaCentavos, reduzirBase, valorDoItem } from '../util/dinheiro.js';

export const NFE_NS = 'http://www.portalfiscal.inf.br/nfe';
export const HOMOLOG_TXT = 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';
/** Nome do destinatário em homologação (xNome limitado a 60 caracteres). */
export const HOMOLOG_DEST = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

export interface BuildContext {
  ambiente: Ambiente;
  /** 1=normal, 4=contingência EPEC (só SP), 9=contingência offline. */
  tpEmis: 1 | 4 | 9;
  offsetMinutes: number;
  /** Para contingência (tpEmis=4 ou 9). */
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

/** Acumuladores em centavos inteiros. */
interface Soma { vProd: number; vDesc: number; vFrete: number; vSeg: number; vOutro: number; vBC: number; vICMS: number; vPIS: number; vCOFINS: number; vTotTrib: number }

const C = reaisParaCentavos;
const X = centavosParaXml;

/** Grupo de ICMS do item. `baseItem` em centavos; acumula vBC/vICMS (centavos) em `t`. */
function icmsXml(i: IcmsItem, baseItem: number, t: Soma): string {
  const o = tag('orig', i.origem);
  const cred = (al: number, valor?: number) => (valor !== undefined ? C(valor) : aplicarAliquota(baseItem, al));
  if ('csosn' in i) {
    const c = i.csosn;
    if (c === '101') {
      return group('ICMSSN101', [o, tag('CSOSN', c), tag('pCredSN', fmt.dec(i.aliquotaCreditoSN, 4)), tag('vCredICMSSN', X(cred(i.aliquotaCreditoSN, i.valorCreditoSN)))]);
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
        const bc = i.baseCalculo !== undefined ? C(i.baseCalculo) : baseItem;
        const v = i.valor !== undefined ? C(i.valor) : aplicarAliquota(bc, i.aliquota);
        t.vBC += bc; t.vICMS += v;
        parts.push(tag('modBC', 3), tag('vBC', X(bc)), tag('pICMS', fmt.dec(i.aliquota, 4)), tag('vICMS', X(v)));
      }
      if (i.aliquotaCreditoSN !== undefined) {
        parts.push(tag('pCredSN', fmt.dec(i.aliquotaCreditoSN, 4)), tag('vCredICMSSN', X(cred(i.aliquotaCreditoSN, i.valorCreditoSN))));
      }
      return group('ICMSSN900', parts);
    }
    return group('ICMSSN102', [o, tag('CSOSN', c)]);
  }
  switch (i.cst) {
    case '00': {
      const bc = i.baseCalculo !== undefined ? C(i.baseCalculo) : baseItem;
      const v = i.valor !== undefined ? C(i.valor) : aplicarAliquota(bc, i.aliquota);
      t.vBC += bc; t.vICMS += v;
      return group('ICMS00', [o, tag('CST', '00'), tag('modBC', 3), tag('vBC', X(bc)), tag('pICMS', fmt.dec(i.aliquota, 4)), tag('vICMS', X(v))]);
    }
    case '20': {
      const bc = i.baseCalculo !== undefined ? C(i.baseCalculo) : reduzirBase(baseItem, i.reducaoBase);
      const v = i.valor !== undefined ? C(i.valor) : aplicarAliquota(bc, i.aliquota);
      t.vBC += bc; t.vICMS += v;
      return group('ICMS20', [o, tag('CST', '20'), tag('modBC', 3), tag('pRedBC', fmt.dec(i.reducaoBase, 4)), tag('vBC', X(bc)), tag('pICMS', fmt.dec(i.aliquota, 4)), tag('vICMS', X(v))]);
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
      const bc = i.baseCalculo !== undefined ? C(i.baseCalculo) : baseItem;
      const al = i.aliquota ?? 0;
      const v = i.valor !== undefined ? C(i.valor) : aplicarAliquota(bc, al);
      t.vBC += bc; t.vICMS += v;
      return group('ICMS90', [o, tag('CST', '90'), tag('modBC', 3), tag('vBC', X(bc)), tag('pICMS', fmt.dec(al, 4)), tag('vICMS', X(v))]);
    }
    default:
      throw new ValidationError(`CST de ICMS não suportado: ${(i as { cst: string }).cst}`, ['icms']);
  }
}

/** PIS/COFINS do item; `base` em centavos; acumula em `t`. */
function pisCofinsXml(kind: 'PIS' | 'COFINS', p: PisCofins | undefined, base: number, t: Soma): string {
  const pct = kind === 'PIS' ? 'pPIS' : 'pCOFINS';
  const v = kind === 'PIS' ? 'vPIS' : 'vCOFINS';
  const add = (x: number) => { if (kind === 'PIS') t.vPIS += x; else t.vCOFINS += x; };
  const cst = p?.cst ?? '49';
  if (['04', '05', '06', '07', '08', '09'].includes(cst)) return group(kind, group(`${kind}NT`, tag('CST', cst)));
  if (cst === '01' || cst === '02') {
    const pp = p as { baseCalculo?: number; aliquota: number; valor?: number };
    const bc = pp.baseCalculo !== undefined ? C(pp.baseCalculo) : base;
    const val = pp.valor !== undefined ? C(pp.valor) : aplicarAliquota(bc, pp.aliquota);
    add(val);
    return group(kind, group(`${kind}Aliq`, [tag('CST', cst), tag('vBC', X(bc)), tag(pct, fmt.dec(pp.aliquota, 4)), tag(v, X(val))]));
  }
  const pp = (p ?? {}) as { baseCalculo?: number; aliquota?: number; valor?: number };
  const bc = pp.baseCalculo !== undefined ? C(pp.baseCalculo) : 0;
  const al = pp.aliquota ?? 0;
  const val = pp.valor !== undefined ? C(pp.valor) : aplicarAliquota(bc, al);
  add(val);
  return group(kind, group(`${kind}Outr`, [tag('CST', cst), tag('vBC', X(bc)), tag(pct, fmt.dec(al, 4)), tag(v, X(val))]));
}

/** `troco` em centavos. */
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
    return group('detPag', [tag('tPag', t), t === '99' ? tag('xPag', sanitizeText(p.descricao ?? 'Outros')) : '', tag('vPag', X(C(p.valor))), card]);
  });
  return group('pag', [...det, troco > 0 ? tag('vTroco', X(troco)) : '']);
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
  if (nota.numero === undefined) throw new ValidationError('Número da nota não informado.', ['numero']);
  const numero = nota.numero;
  const cNF = ctx.cNF ?? gerarCNF(numero);
  const { chave, cDV } = montarChave({
    cUF, emissao, offsetMinutes: ctx.offsetMinutes, cnpj: e.cnpj, serie: nota.serie, nNF: numero, tpEmis: ctx.tpEmis, cNF,
  });

  const t: Soma = { vProd: 0, vDesc: 0, vFrete: 0, vSeg: 0, vOutro: 0, vBC: 0, vICMS: 0, vPIS: 0, vCOFINS: 0, vTotTrib: 0 };

  const local = new Date(emissao.getTime() + ctx.offsetMinutes * 60000);
  const anoEmissao = local.getUTCFullYear();
  const dataEmissao = dhEmi.slice(0, 10);
  const rtc = { vBC: 0, vIBSUF: 0, vIBSMun: 0, vIBS: 0, vCBS: 0, vNFTot: 0 }; // centavos
  let temIbsCbs = false;

  const dets = nota.itens.map((it: Item, idx) => {
    const vProd = valorDoItem(it.quantidade, it.valorUnitario);
    const vDesc = C(it.desconto ?? 0);
    const vFrete = C(it.frete ?? 0), vSeg = C(it.seguro ?? 0), vOutro = C(it.outrasDespesas ?? 0);
    t.vProd += vProd; t.vDesc += vDesc; t.vFrete += vFrete; t.vSeg += vSeg; t.vOutro += vOutro;
    const base = vProd - vDesc + vFrete + vSeg + vOutro;
    const gtin = it.gtin ? fmt.onlyDigits(it.gtin) : 'SEM GTIN';
    const xProd = idx === 0 && ctx.ambiente === 'homologacao' ? HOMOLOG_TXT : sanitizeText(it.descricao);
    const prod = group('prod', [
      tag('cProd', it.codigo), tag('cEAN', gtin), tag('xProd', xProd), tag('NCM', fmt.onlyDigits(it.ncm)), tag('CEST', it.cest),
      tag('CFOP', it.cfop), tag('uCom', it.unidade), tag('qCom', fmt.dec(it.quantidade, 4)), tag('vUnCom', fmt.dec(it.valorUnitario, 4)),
      tag('vProd', X(vProd)), tag('cEANTrib', gtin), tag('uTrib', it.unidade), tag('qTrib', fmt.dec(it.quantidade, 4)),
      tag('vUnTrib', fmt.dec(it.valorUnitario, 4)),
      vFrete ? tag('vFrete', X(vFrete)) : '', vSeg ? tag('vSeg', X(vSeg)) : '',
      vDesc ? tag('vDesc', X(vDesc)) : '', vOutro ? tag('vOutro', X(vOutro)) : '', tag('indTot', 1),
    ]);
    const vTotTribItem = it.valorTributosAprox !== undefined ? C(it.valorTributosAprox) : undefined;
    if (vTotTribItem) t.vTotTrib += vTotTribItem;
    const antes = { vICMS: t.vICMS, vPIS: t.vPIS, vCOFINS: t.vCOFINS };
    const icms = group('ICMS', icmsXml(it.icms, base, t));
    const pis = pisCofinsXml('PIS', it.pis, base, t);
    const cofins = pisCofinsXml('COFINS', it.cofins, base, t);
    let ibsCbsXml = '';
    let vItem = '';
    if (it.ibsCbs) {
      temIbsCbs = true;
      const c = calcularIbsCbs(it.ibsCbs, {
        vProd, vDesc, vFrete, vSeg, vOutro, vFCP: 0,
        vICMS: t.vICMS - antes.vICMS, vPIS: t.vPIS - antes.vPIS, vCOFINS: t.vCOFINS - antes.vCOFINS,
      }, { ano: anoEmissao, data: dataEmissao }, `itens[${idx}].ibsCbs`);
      ibsCbsXml = c.xml;
      rtc.vBC += c.vBC; rtc.vIBSUF += c.vIBSUF; rtc.vIBSMun += c.vIBSMun; rtc.vIBS += c.vIBS; rtc.vCBS += c.vCBS;
      // VB01-10: vItem = vProd − vDesc + vFrete + vSeg + vOutro (+ vIBS + vCBS a partir de 2027).
      const vi = base + (somaTributosNoItem(anoEmissao) ? c.vIBS + c.vCBS : 0);
      rtc.vNFTot += vi;
      vItem = tag('vItem', X(vi));
    }
    const imposto = group('imposto', [
      vTotTribItem !== undefined ? tag('vTotTrib', X(vTotTribItem)) : '',
      icms, pis, cofins, ibsCbsXml,
    ]);
    return group('det', [prod, imposto, tag('infAdProd', it.informacoesAdicionais && sanitizeText(it.informacoesAdicionais)), vItem], { nItem: String(idx + 1) });
  });

  if (temIbsCbs && nota.itens.some((it) => !it.ibsCbs)) {
    throw new ValidationError('Informe ibsCbs em todos os itens (ou em nenhum): o total IBSCBSTot exige consistência entre os itens.', ['itens']);
  }
  const vNF = t.vProd - t.vDesc + t.vFrete + t.vSeg + t.vOutro;
  const pago = nota.pagamentos.reduce((s, p) => s + C(p.valor), 0);
  const troco = pago - vNF;
  const R = centavosParaReais;
  const tot: Totais = {
    vProd: R(t.vProd), vDesc: R(t.vDesc), vFrete: R(t.vFrete), vSeg: R(t.vSeg), vOutro: R(t.vOutro), vBC: R(t.vBC), vICMS: R(t.vICMS),
    vICMSDeson: 0, vPIS: R(t.vPIS), vCOFINS: R(t.vCOFINS), vTotTrib: R(t.vTotTrib), vNF: R(vNF),
    centavos: { vProd: t.vProd, vDesc: t.vDesc, vNF, troco: troco > 0 ? troco : 0 },
  };
  if (temIbsCbs) tot.ibsCbs = { vBC: R(rtc.vBC), vIBSUF: R(rtc.vIBSUF), vIBSMun: R(rtc.vIBSMun), vIBS: R(rtc.vIBS), vCBS: R(rtc.vCBS), vNFTot: R(rtc.vNFTot) };

  const ind = nota.indicadorPresenca ?? 1;
  const ide = group('ide', [
    tag('cUF', cUF), tag('cNF', cNF), tag('natOp', sanitizeText(nota.naturezaOperacao ?? 'VENDA AO CONSUMIDOR')), tag('mod', 65),
    tag('serie', nota.serie), tag('nNF', numero), tag('dhEmi', dhEmi), tag('tpNF', 1), tag('idDest', 1),
    tag('cMunFG', e.endereco.codigoMunicipio),
    // B25b-60/70: cMunFGIBS é obrigatório na NFC-e com indPres=5 e proibido nos demais casos.
    ind === 5 ? tag('cMunFGIBS', nota.municipioFatoGerador ?? e.endereco.codigoMunicipio) : '',
    tag('tpImp', 4), tag('tpEmis', ctx.tpEmis), tag('cDV', cDV), tag('tpAmb', tpAmb),
    tag('finNFe', 1), tag('indFinal', 1), tag('indPres', ind), tag('procEmi', 0), tag('verProc', ctx.verProc ?? nota.versaoSoftware ?? 'zexon-nfce 0.4'),
    ctx.tpEmis !== 1 ? tag('dhCont', dhFormat(ctx.dhCont ?? emissao, ctx.offsetMinutes)) : '',
    ctx.tpEmis !== 1 ? tag('xJust', sanitizeText(ctx.xJust ?? (ctx.tpEmis === 4 ? 'Contingencia EPEC por indisponibilidade do ambiente de autorizacao' : 'Contingencia off-line por indisponibilidade de comunicacao'))) : '',
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

  const z = X(0);
  const total = group('total', group('ICMSTot', [
    tag('vBC', X(t.vBC)), tag('vICMS', X(t.vICMS)), tag('vICMSDeson', z), tag('vFCP', z),
    tag('vBCST', z), tag('vST', z), tag('vFCPST', z), tag('vFCPSTRet', z),
    tag('vProd', X(t.vProd)), tag('vFrete', X(t.vFrete)), tag('vSeg', X(t.vSeg)), tag('vDesc', X(t.vDesc)),
    tag('vII', z), tag('vIPI', z), tag('vIPIDevol', z), tag('vPIS', X(t.vPIS)),
    tag('vCOFINS', X(t.vCOFINS)), tag('vOutro', X(t.vOutro)), tag('vNF', X(vNF)),
    t.vTotTrib ? tag('vTotTrib', X(t.vTotTrib)) : '',
  ]) + (temIbsCbs ? totalIbsCbsXml(rtc) + tag('vNFTot', X(rtc.vNFTot)) : ''));

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
