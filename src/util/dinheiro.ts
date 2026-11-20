// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
/**
 * Aritmética fiscal exata. Regra da biblioteca: valores monetários são somados e calculados em
 * **centavos inteiros**; produtos (quantidade × preço, base × alíquota) usam BigInt e arredondam
 * uma única vez, meio para cima (half-up), na casa decimal exigida pelo leiaute.
 *
 * Entradas da API continuam em reais (`number`); a conversão acontece aqui, na borda.
 */

const p10 = (n: number) => 10n ** BigInt(n);

/**
 * Converte um decimal para inteiro com `casas` casas, arredondando meio para cima sobre a
 * representação decimal (`1.005` → 101 com 2 casas; `0.1 + 0.2` → 30).
 */
export function paraUnidades(valor: number, casas: number): bigint {
  if (!Number.isFinite(valor)) throw new RangeError(`Valor numérico inválido: ${valor}`);
  const neg = valor < 0;
  const txt = Math.abs(valor).toFixed(Math.max(casas + 1, 10));
  const [int = '0', frac = ''] = txt.split('.');
  let u = BigInt(int + frac.slice(0, casas).padEnd(casas, '0'));
  if (Number(frac[casas] ?? '0') >= 5) u += 1n;
  return neg ? -u : u;
}

/** Divisão inteira com arredondamento meio para cima (afastando de zero). */
export function dividirArredondando(n: bigint, d: bigint): bigint {
  const neg = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n, ad = d < 0n ? -d : d;
  const q = (an * 2n + ad) / (ad * 2n);
  return neg ? -q : q;
}

/** Inteiro com `casas` casas → texto do XML ("12.34"). */
export function unidadesParaTexto(u: bigint | number, casas: number): string {
  const v = BigInt(u);
  const neg = v < 0n;
  const s = (neg ? -v : v).toString().padStart(casas + 1, '0');
  const txt = casas ? `${s.slice(0, -casas)}.${s.slice(-casas)}` : s;
  return neg ? `-${txt}` : txt;
}

export const reaisParaCentavos = (reais: number): number => Number(paraUnidades(reais, 2));
export const centavosParaReais = (centavos: number): number => centavos / 100;
export const centavosParaXml = (centavos: number): string => unidadesParaTexto(centavos, 2);

/** Valor do item em centavos: quantidade (4 casas) × valor unitário (4 casas), arredondado em 2 casas. */
export function valorDoItem(quantidade: number, valorUnitario: number): number {
  return Number(dividirArredondando(paraUnidades(quantidade, 4) * paraUnidades(valorUnitario, 4), p10(6)));
}

/** Base (centavos) × alíquota percentual (4 casas) → valor em centavos. */
export function aplicarAliquota(baseCentavos: number, aliquotaPercentual: number | bigint): number {
  const al = typeof aliquotaPercentual === 'bigint' ? aliquotaPercentual : paraUnidades(aliquotaPercentual, 4);
  return Number(dividirArredondando(BigInt(baseCentavos) * al, p10(6)));
}

/** Base (centavos) reduzida em `reducaoPercentual` (4 casas): base × (1 − red/100). */
export function reduzirBase(baseCentavos: number, reducaoPercentual: number): number {
  return Number(dividirArredondando(BigInt(baseCentavos) * (p10(6) - paraUnidades(reducaoPercentual, 4)), p10(6)));
}

/** Alíquota efetiva com 4 casas: p × (1 − red/100) (NT 2025.002, UB28/UB66). Retorna inteiro em 4 casas. */
export function aliquotaEfetiva(aliquotaPercentual: number, reducaoPercentual: number): bigint {
  return dividirArredondando(paraUnidades(aliquotaPercentual, 4) * (p10(6) - paraUnidades(reducaoPercentual, 4)), p10(6));
}
