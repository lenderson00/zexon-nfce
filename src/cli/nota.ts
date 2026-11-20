// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { NotaNfce } from '../types.js';
import { validarNota } from '../validation/index.js';
import { ValidationError } from '../errors/index.js';
import type { CliConfig } from './config.js';
import { CliErro, SAIDA } from './erros.js';
import { validarSchema, type Problema } from './validacao.js';

/** O que a IA escreve: a venda (sem emitente). */
export type NotaArquivo = Omit<NotaNfce, 'emitente' | 'serie' | 'emissao'> & { serie?: number; emissao?: string; $schema?: string };

/** Lê o arquivo da nota (`-` = stdin já lido em `stdin`). */
export function lerNota(arquivo: string | undefined, cwd: string, stdin?: string): unknown {
  if (!arquivo) throw new CliErro(SAIDA.USO, 'USO', 'Informe o arquivo da nota (ou `-` para ler da entrada padrão).');
  let texto: string;
  try {
    texto = arquivo === '-' ? (stdin ?? '') : readFileSync(isAbsolute(arquivo) ? arquivo : resolve(cwd, arquivo), 'utf8');
  } catch (e) {
    throw new CliErro(SAIDA.USO, 'ARQUIVO', `Não foi possível ler ${arquivo}: ${(e as Error).message}`);
  }
  try {
    return JSON.parse(texto);
  } catch (e) {
    throw new CliErro(SAIDA.NOTA_INVALIDA, 'JSON_INVALIDO', `O arquivo da nota não é um JSON válido: ${(e as Error).message}`);
  }
}

const SUGESTOES: Array<[RegExp, string]> = [
  [/ncm$/, 'NCM com 8 dígitos, só números (ex.: 22021000). Na dúvida, consulte a tabela TIPI ou o cadastro do produto.'],
  [/cfop$/, 'Venda interna a consumidor: 5102 (revenda) ou 5101 (produção própria).'],
  [/\.icms$/, 'Simples Nacional (CRT 1/4): { "csosn": "102", "origem": 0 }. Regime Normal (CRT 3): { "cst": "00", "origem": 0, "aliquota": 18 }.'],
  [/^pagamentos$/, 'A soma de `pagamentos[].valor` deve ser pelo menos o total da nota; troco só com dinheiro.'],
  [/consumidor\.cpf$/, 'CPF com 11 dígitos e dígito verificador válido; ou omita `consumidor`.'],
  [/gtin$/, 'Use o código de barras exato da embalagem ou omita o campo.'],
  [/ibsCbs/, 'Regime Normal: informe { "cClassTrib": "000001" } (tributação integral) ou o cClassTrib correto do produto.'],
  [/desconto$/, 'O desconto não pode passar do valor do item (quantidade × valorUnitario).'],
];

/** A sugestão específica do campo (ex.: NCM) vale mais que a genérica do Schema. */
function comSugestao(p: Problema): Problema {
  const s = SUGESTOES.find(([re]) => re.test(p.campo))?.[1];
  return s ? { ...p, sugestao: s } : p;
}

/** Valida e converte para `NotaNfce`. Sem `config`, valida só o formato (Schema). */
export function prepararNota(dados: unknown, config?: CliConfig): { nota?: NotaNfce; problemas: Problema[] } {
  const problemas = validarSchema('nota', dados).map(comSugestao);
  if (problemas.length || !config) return { problemas };
  const a = dados as NotaArquivo;
  const { $schema: _s, emissao, ...resto } = a;
  const nota: NotaNfce = { ...resto, emitente: config.emitente, serie: a.serie ?? config.serie, ...(emissao ? { emissao: new Date(emissao) } : {}) };
  try {
    validarNota(nota);
  } catch (e) {
    if (e instanceof ValidationError) return { problemas: e.detalhes.map(comSugestao) };
    throw e;
  }
  return { nota, problemas: [] };
}

/** Igual a `prepararNota`, mas lança `CliErro` (saída 1) se houver problema. */
export function notaValida(dados: unknown, config: CliConfig): NotaNfce {
  const { nota, problemas } = prepararNota(dados, config);
  if (!nota) throw new CliErro(SAIDA.NOTA_INVALIDA, 'NOTA_INVALIDA', 'Nota inválida', problemas, { dica: 'Corrija os campos e rode `nfce validar` de novo.' });
  return nota;
}
