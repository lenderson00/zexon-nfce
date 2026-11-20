// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
/**
 * Reforma Tributária do Consumo (LC 214/2025) — IBS e CBS na NFC-e.
 * Regras: NT 2025.002-RTC v1.53 (grupo UB, totais W34–W60 e vItem VB01).
 */
import { CCLASSTRIB_NFCE, CST_IBSCBS, type ClassTrib } from './tabela.js';
import { ValidationError } from '../errors/index.js';
import { fmt, group, tag } from '../util/xml.js';

export { CCLASSTRIB_NFCE, CST_IBSCBS } from './tabela.js';
export type { ClassTrib, IndicadoresCst } from './tabela.js';

export interface IbsCbsItem {
  /** Código de Classificação Tributária (6 dígitos). O CST é derivado dele. */
  cClassTrib: string;
  /** Alíquotas em %. Padrão: as do ano de emissão (2026: IBS UF 0,1; IBS Mun 0; CBS 0,9). */
  aliquotaIBSUF?: number;
  aliquotaIBSMun?: number;
  aliquotaCBS?: number;
  /** Base de cálculo; padrão conforme UB16-10. */
  baseCalculo?: number;
  /** Doação (indDoacao=1). Obrigatório/proibido conforme o cClassTrib. */
  doacao?: boolean;
}

export interface AliquotasAno { ibsUF: number; ibsMun: number; cbs?: number }

/** Alíquotas do período de teste (LC 214/25, arts. 343–346; Tabela de Alíquotas da CBS). */
export function aliquotasPadrao(ano: number): AliquotasAno | undefined {
  if (ano <= 2026) return { ibsUF: 0.1, ibsMun: 0, cbs: 0.9 };
  if (ano <= 2028) return { ibsUF: 0.05, ibsMun: 0.05, cbs: undefined }; // CBS 2027+: aguarda legislação
  return undefined;
}

export function classTrib(cClassTrib: string): ClassTrib {
  const ct = CCLASSTRIB_NFCE[cClassTrib];
  if (!ct) throw new ValidationError(`cClassTrib ${cClassTrib} inexistente ou não permitido em NFC-e (tabela cClassTrib).`, ['ibsCbs.cClassTrib']);
  return ct;
}

/** Valores do item já tributados por ICMS/PIS/COFINS, usados na base (UB16-10). */
export interface BaseItem { vProd: number; vDesc: number; vFrete: number; vSeg: number; vOutro: number; vICMS: number; vFCP: number; vPIS: number; vCOFINS: number }

export interface IbsCbsCalculado {
  xml: string;
  /** Item possui o grupo gIBSCBS (valores). */
  temValores: boolean;
  vBC: number; vIBSUF: number; vIBSMun: number; vIBS: number; vCBS: number;
}

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const r4 = (v: number) => Math.round((v + Number.EPSILON) * 10000) / 10000;

/** UB16-10: vProd + vFrete + vSeg + vOutro − vDesc − vPIS − vCOFINS − vICMS − vFCP. */
export function baseIbsCbs(b: BaseItem): number {
  return r2(b.vProd + b.vFrete + b.vSeg + b.vOutro - b.vDesc - b.vPIS - b.vCOFINS - b.vICMS - b.vFCP);
}

/** Monta o grupo `<IBSCBS>` do item e calcula os valores. */
export function calcularIbsCbs(i: IbsCbsItem, base: BaseItem, emissao: { ano: number; data: string }, campo = 'ibsCbs'): IbsCbsCalculado {
  const ct = classTrib(i.cClassTrib);
  if (ct.monofasica) throw new ValidationError(`cClassTrib ${ct.cClassTrib} (tributação monofásica) ainda não é suportado.`, [`${campo}.cClassTrib`]);
  if ((ct.dIniVig && emissao.data < ct.dIniVig) || (ct.dFimVig && emissao.data > ct.dFimVig)) {
    throw new ValidationError(`cClassTrib ${ct.cClassTrib} fora da vigência na data de emissão.`, [`${campo}.cClassTrib`]);
  }
  if (ct.tpDoacao === 0 && i.doacao) throw new ValidationError(`cClassTrib ${ct.cClassTrib} não permite indicar doação.`, [`${campo}.doacao`]);
  if (ct.tpDoacao === 1 && !i.doacao) throw new ValidationError(`cClassTrib ${ct.cClassTrib} exige indicar doação (doacao: true).`, [`${campo}.doacao`]);
  const ind = CST_IBSCBS[ct.cst];
  if (!ind) throw new ValidationError(`CST ${ct.cst} do IBS/CBS inexistente.`, [`${campo}.cClassTrib`]);

  const cab = [tag('CST', ct.cst), tag('cClassTrib', ct.cClassTrib), i.doacao ? tag('indDoacao', 1) : ''];
  if (!ind.gIBSCBS) {
    return { xml: group('IBSCBS', cab), temValores: false, vBC: 0, vIBSUF: 0, vIBSMun: 0, vIBS: 0, vCBS: 0 };
  }
  if (ind.gDif || ind.gTransfCred || ind.gAjusteCompet || ind.gIBSCBSMono || ind.redutorBC) {
    throw new ValidationError(`CST ${ct.cst} do IBS/CBS exige grupos ainda não suportados.`, [`${campo}.cClassTrib`]);
  }

  const padrao = aliquotasPadrao(emissao.ano);
  const pUF = ct.tribRegular ? 0 : i.aliquotaIBSUF ?? padrao?.ibsUF;
  const pMun = ct.tribRegular ? 0 : i.aliquotaIBSMun ?? padrao?.ibsMun;
  const pCBS = ct.tribRegular ? 0 : i.aliquotaCBS ?? padrao?.cbs;
  if (pUF === undefined || pMun === undefined || pCBS === undefined) {
    throw new ValidationError(`Alíquotas do IBS/CBS para ${emissao.ano} não definidas na biblioteca: informe aliquotaIBSUF, aliquotaIBSMun e aliquotaCBS.`, [campo]);
  }

  const vBC = r2(i.baseCalculo ?? baseIbsCbs(base));
  const comRed = (p: number, red: number) => {
    if (!ind.gRed) return { efet: p, xml: '' };
    const efet = r4(p * (1 - red / 100));
    return { efet, xml: group('gRed', [tag('pRedAliq', fmt.dec(red, 4)), tag('pAliqEfet', fmt.dec(efet, 4))]) };
  };
  const uf = comRed(pUF, ct.pRedIBS);
  const mun = comRed(pMun, ct.pRedIBS);
  const cbs = comRed(pCBS, ct.pRedCBS);
  const vIBSUF = r2((vBC * uf.efet) / 100);
  const vIBSMun = r2((vBC * mun.efet) / 100);
  const vIBS = r2(vIBSUF + vIBSMun);
  const vCBS = r2((vBC * cbs.efet) / 100);

  const g = group('gIBSCBS', [
    tag('vBC', fmt.money(vBC)),
    group('gIBSUF', [tag('pIBSUF', fmt.dec(pUF, 4)), uf.xml, tag('vIBSUF', fmt.money(vIBSUF))]),
    group('gIBSMun', [tag('pIBSMun', fmt.dec(pMun, 4)), mun.xml, tag('vIBSMun', fmt.money(vIBSMun))]),
    tag('vIBS', fmt.money(vIBS)),
    group('gCBS', [tag('pCBS', fmt.dec(pCBS, 4)), cbs.xml, tag('vCBS', fmt.money(vCBS))]),
  ]);
  return { xml: group('IBSCBS', [...cab, g]), temValores: true, vBC, vIBSUF, vIBSMun, vIBS, vCBS };
}

export interface TotaisIbsCbs { vBC: number; vIBSUF: number; vIBSMun: number; vIBS: number; vCBS: number }

/** Grupo `<IBSCBSTot>` (W34–W56a). */
export function totalIbsCbsXml(t: TotaisIbsCbs): string {
  const z = fmt.money(0);
  return group('IBSCBSTot', [
    tag('vBCIBSCBS', fmt.money(t.vBC)),
    group('gIBS', [
      group('gIBSUF', [tag('vDif', z), tag('vDevTrib', z), tag('vIBSUF', fmt.money(t.vIBSUF))]),
      group('gIBSMun', [tag('vDif', z), tag('vDevTrib', z), tag('vIBSMun', fmt.money(t.vIBSMun))]),
      tag('vIBS', fmt.money(t.vIBS)), tag('vCredPres', z), tag('vCredPresCondSus', z),
    ]),
    group('gCBS', [tag('vDif', z), tag('vDevTrib', z), tag('vCBS', fmt.money(t.vCBS)), tag('vCredPres', z), tag('vCredPresCondSus', z)]),
  ]);
}

/** IBS/CBS compõem vItem/vNFTot a partir de 2027 (VB01-10, exceção 1). */
export const somaTributosNoItem = (ano: number) => ano >= 2027;
