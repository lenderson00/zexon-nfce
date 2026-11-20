// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
import type { NotaNfce } from '../types.js';
import { TPAG } from '../types.js';
import { ValidationError } from '../errors/index.js';
import { fmt } from '../util/xml.js';
import { centavosParaXml, reaisParaCentavos, valorDoItem } from '../util/dinheiro.js';

export function cpfValido(v: string): boolean {
  const c = fmt.onlyDigits(v);
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (const n of [9, 10]) {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i);
    const d = ((s * 10) % 11) % 10;
    if (d !== Number(c[n])) return false;
  }
  return true;
}

export function cnpjValido(v: string): boolean {
  const c = fmt.onlyDigits(v);
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  for (const n of [12, 13]) {
    let s = 0, p = n - 7;
    for (let i = 0; i < n; i++) { s += Number(c[i]) * p--; if (p < 2) p = 9; }
    const d = s % 11 < 2 ? 0 : 11 - (s % 11);
    if (d !== Number(c[n])) return false;
  }
  return true;
}

export function gtinValido(v: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(v)) return false;
  const d = v.split('').map(Number);
  const dv = d.pop()!;
  let s = 0;
  d.reverse().forEach((x, i) => { s += x * (i % 2 === 0 ? 3 : 1); });
  return (10 - (s % 10)) % 10 === dv;
}

export const NFCE_LIMITE_ITENS = 990;

/** Validações de negócio antes do envio. Lança ValidationError com todos os problemas. */
export function validarNota(n: NotaNfce, opcoes: { exigirIbsCbs?: boolean } = {}): void {
  const exigirIbsCbs = opcoes.exigirIbsCbs ?? true;
  const erros: Array<[string, string]> = [];
  const add = (campo: string, msg: string) => erros.push([campo, msg]);
  if (!cnpjValido(n.emitente.cnpj)) add('emitente.cnpj', 'CNPJ do emitente inválido');
  if (!n.emitente.razaoSocial) add('emitente.razaoSocial', 'obrigatório');
  if (!n.emitente.inscricaoEstadual) add('emitente.inscricaoEstadual', 'obrigatório');
  if (!/^\d{7}$/.test(String(n.emitente.endereco.codigoMunicipio))) add('emitente.endereco.codigoMunicipio', 'código IBGE deve ter 7 dígitos');
  if (!/^\d{8}$/.test(fmt.onlyDigits(n.emitente.endereco.cep))) add('emitente.endereco.cep', 'CEP deve ter 8 dígitos');
  if (!Number.isInteger(n.serie) || n.serie < 0 || n.serie > 889) add('serie', 'série deve estar entre 0 e 889');
  if (n.numero !== undefined && (!Number.isInteger(n.numero) || n.numero < 1 || n.numero > 999999999)) add('numero', 'número inválido');
  if (n.itens.length === 0) add('itens', 'informe ao menos 1 item');
  if (n.itens.length > NFCE_LIMITE_ITENS) add('itens', `máximo de ${NFCE_LIMITE_ITENS} itens`);
  if (n.pagamentos.length === 0) add('pagamentos', 'informe ao menos 1 forma de pagamento');

  n.itens.forEach((it, i) => {
    const p = `itens[${i}]`;
    if (!it.codigo) add(`${p}.codigo`, 'obrigatório');
    if (!it.descricao) add(`${p}.descricao`, 'obrigatório');
    if (!/^\d{8}$/.test(fmt.onlyDigits(it.ncm))) add(`${p}.ncm`, 'NCM deve ter 8 dígitos');
    if (!/^\d{4}$/.test(it.cfop)) add(`${p}.cfop`, 'CFOP deve ter 4 dígitos');
    if (!(it.quantidade > 0)) add(`${p}.quantidade`, 'deve ser > 0');
    if (!(it.valorUnitario >= 0)) add(`${p}.valorUnitario`, 'inválido');
    if (it.gtin && !gtinValido(fmt.onlyDigits(it.gtin))) add(`${p}.gtin`, 'GTIN inválido (dígito verificador)');
    if (it.cest && !/^\d{7}$/.test(it.cest)) add(`${p}.cest`, 'CEST deve ter 7 dígitos');
    if (it.quantidade > 0 && it.valorUnitario >= 0 && valorDoItem(it.quantidade, it.valorUnitario) - reaisParaCentavos(it.desconto ?? 0) < 0) add(`${p}.desconto`, 'desconto maior que o valor do item');
    if (exigirIbsCbs && n.emitente.regimeTributario === 3 && (n.emissao ?? new Date()).getUTCFullYear() >= 2026 && !it.ibsCbs) {
      add(`${p}.ibsCbs`, 'obrigatório para Regime Normal (CRT 3) desde 2026 — LC 214/2025, NT 2025.002 (rejeição 1115). Informe cClassTrib ou configure ibsCbsPadrao no cliente');
    }
    if (it.ibsCbs && !/^\d{6}$/.test(it.ibsCbs.cClassTrib)) add(`${p}.ibsCbs.cClassTrib`, 'deve ter 6 dígitos');
    if (n.emitente.regimeTributario === 1 || n.emitente.regimeTributario === 4) {
      if (!('csosn' in it.icms)) add(`${p}.icms`, 'emitente do Simples Nacional deve usar CSOSN');
    } else if (!('cst' in it.icms)) add(`${p}.icms`, 'regime normal deve usar CST');
  });

  const c = n.consumidor;
  if (c?.cpf && !cpfValido(c.cpf)) add('consumidor.cpf', 'CPF inválido');
  if (c?.cnpj && !cnpjValido(c.cnpj)) add('consumidor.cnpj', 'CNPJ inválido');
  if ((n.indicadorPresenca ?? 1) === 4 && !c?.endereco) add('consumidor.endereco', 'obrigatório na entrega em domicílio (indPres=4)');

  // Totais em centavos inteiros (mesmo cálculo de montarNfce).
  const C = reaisParaCentavos;
  const itensValidos = n.itens.every((it) => it.quantidade > 0 && it.valorUnitario >= 0);
  const vNF = itensValidos
    ? n.itens.reduce((s, it) => s + valorDoItem(it.quantidade, it.valorUnitario) - C(it.desconto ?? 0) + C(it.frete ?? 0) + C(it.seguro ?? 0) + C(it.outrasDespesas ?? 0), 0)
    : 0;
  const pago = n.pagamentos.reduce((s, p) => s + (Number.isFinite(p.valor) ? C(p.valor) : 0), 0);
  if (vNF > 0 && pago < vNF) add('pagamentos', `soma dos pagamentos (${centavosParaXml(pago)}) menor que o total da nota (${centavosParaXml(vNF)})`);
  if (pago > vNF) {
    const temDinheiro = n.pagamentos.some((p) => (TPAG[p.tipo as keyof typeof TPAG] ?? p.tipo) === '01');
    if (!temDinheiro) add('pagamentos', 'troco só é permitido quando há pagamento em dinheiro');
  }
  n.pagamentos.forEach((p, i) => {
    if (!(p.valor >= 0)) add(`pagamentos[${i}].valor`, 'inválido');
    if (!(p.tipo in TPAG) && !/^\d{2}$/.test(p.tipo)) add(`pagamentos[${i}].tipo`, `meio de pagamento desconhecido: ${p.tipo}`);
  });

  if (erros.length) throw new ValidationError(`Nota inválida:\n${erros.map(([c, m]) => `  - ${c}: ${m}`).join('\n')}`, erros.map(([c]) => c));
}
