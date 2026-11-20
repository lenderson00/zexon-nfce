// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
import { fmt } from '../util/xml.js';

/** Código IBGE das UFs. */
export const UF_CODIGO: Record<string, number> = {
  RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17, MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26,
  AL: 27, SE: 28, BA: 29, MG: 31, ES: 32, RJ: 33, SP: 35, PR: 41, SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53,
};
export type UF = keyof typeof UF_CODIGO;
export const UF_POR_CODIGO: Record<number, string> = Object.fromEntries(
  Object.entries(UF_CODIGO).map(([k, v]) => [v, k]),
);

/** Dígito verificador módulo 11 (pesos 2..9) da chave de acesso. */
export function dvModulo11(base: string): number {
  let peso = 2;
  let soma = 0;
  for (let i = base.length - 1; i >= 0; i--) {
    soma += Number(base[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto === 0 || resto === 1 ? 0 : 11 - resto;
}

export interface ChaveParams {
  cUF: number;
  /** Data de emissão (usa AAMM no fuso informado em `offsetMinutes`). */
  emissao: Date;
  offsetMinutes: number;
  cnpj: string;
  mod?: number;
  serie: number;
  nNF: number;
  tpEmis: number;
  cNF: string; // 8 dígitos
}

/** Monta a chave de acesso de 44 dígitos e devolve também o cDV. */
export function montarChave(p: ChaveParams): { chave: string; cDV: number } {
  const local = new Date(p.emissao.getTime() + p.offsetMinutes * 60000);
  const aamm = fmt.pad(local.getUTCFullYear() % 100, 2) + fmt.pad(local.getUTCMonth() + 1, 2);
  const base =
    fmt.pad(p.cUF, 2) +
    aamm +
    fmt.pad(fmt.onlyDigits(p.cnpj), 14) +
    fmt.pad(p.mod ?? 65, 2) +
    fmt.pad(p.serie, 3) +
    fmt.pad(p.nNF, 9) +
    String(p.tpEmis) +
    fmt.pad(p.cNF, 8);
  if (base.length !== 43) throw new Error(`Base da chave com tamanho inválido (${base.length})`);
  const cDV = dvModulo11(base);
  return { chave: base + cDV, cDV };
}

export function validarChave(chave: string): boolean {
  return /^\d{44}$/.test(chave) && dvModulo11(chave.slice(0, 43)) === Number(chave[43]);
}

/** Código numérico aleatório de 8 dígitos (cNF); não pode ser igual ao nNF nem sequencial (regra de negócio). */
export function gerarCNF(nNF: number, rnd: () => number = Math.random): string {
  for (;;) {
    const n = fmt.pad(Math.floor(rnd() * 99999999), 8);
    if (n !== fmt.pad(nNF, 8) && n !== '00000000') return n;
  }
}

export function parseChave(chave: string) {
  return {
    cUF: Number(chave.slice(0, 2)),
    aamm: chave.slice(2, 6),
    cnpj: chave.slice(6, 20),
    mod: Number(chave.slice(20, 22)),
    serie: Number(chave.slice(22, 25)),
    nNF: Number(chave.slice(25, 34)),
    tpEmis: Number(chave.slice(34, 35)),
    cNF: chave.slice(35, 43),
    cDV: Number(chave[43]),
  };
}
