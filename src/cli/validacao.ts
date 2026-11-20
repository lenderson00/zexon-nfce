// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import { SCHEMA_CONFIG, SCHEMA_NOTA } from './schema.js';

export interface Problema {
  campo: string;
  mensagem: string;
  sugestao?: string;
}

let ajv: Ajv2020 | undefined;
const cache = new Map<string, ValidateFunction>();
function validador(nome: 'nota' | 'config'): ValidateFunction {
  if (!ajv) {
    ajv = new Ajv2020({ allErrors: true, strict: false, multipleOfPrecision: 8 });
    ajv.addFormat('date-time', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/);
    ajv.addFormat('email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  }
  let v = cache.get(nome);
  if (!v) { v = ajv.compile(nome === 'nota' ? SCHEMA_NOTA : SCHEMA_CONFIG); cache.set(nome, v); }
  return v;
}

/** `/itens/0/ncm` → `itens[0].ncm` (mesma notação dos erros da lib). */
export function caminho(ptr: string): string {
  return ptr.split('/').filter(Boolean).reduce((acc, p) => (/^\d+$/.test(p) ? `${acc}[${p}]` : acc ? `${acc}.${p}` : p), '');
}

function traduzir(e: ErrorObject): Problema {
  const base = caminho(e.instancePath);
  const p = e.params as Record<string, unknown>;
  switch (e.keyword) {
    case 'required': return { campo: base ? `${base}.${p.missingProperty}` : String(p.missingProperty), mensagem: 'obrigatório' };
    case 'additionalProperties': return { campo: base ? `${base}.${p.additionalProperty}` : String(p.additionalProperty), mensagem: 'campo desconhecido', sugestao: 'remova o campo ou confira o nome em `nfce schema nota`' };
    case 'enum': return { campo: base, mensagem: `valor não permitido; use um de: ${(p.allowedValues as unknown[]).join(', ')}` };
    case 'pattern': return { campo: base, mensagem: `formato inválido (${p.pattern})`, sugestao: 'use só dígitos, sem pontos, barras ou traços' };
    case 'multipleOf': return { campo: base, mensagem: 'valor em reais com no máximo 2 casas decimais' };
    case 'oneOf': case 'anyOf': return { campo: base, mensagem: 'não corresponde a nenhuma das formas aceitas', sugestao: base.endsWith('icms') ? 'Simples Nacional: { "csosn": "102", "origem": 0 }; Regime Normal: { "cst": "00", "origem": 0, "aliquota": 18 }' : 'veja `nfce schema nota`' };
    case 'minItems': return { campo: base, mensagem: `informe ao menos ${p.limit} item(ns)` };
    case 'maxItems': return { campo: base, mensagem: `no máximo ${p.limit} item(ns)` };
    case 'minLength': return { campo: base, mensagem: Number(p.limit) <= 1 ? 'obrigatório (não pode ser vazio)' : `mínimo de ${p.limit} caracteres` };
    case 'maxLength': return { campo: base, mensagem: `máximo de ${p.limit} caracteres` };
    case 'type': return { campo: base, mensagem: `deve ser do tipo ${({ string: 'texto', number: 'número', integer: 'número inteiro', object: 'objeto', array: 'lista', boolean: 'true/false' } as Record<string, string>)[String(p.type)] ?? p.type}`, sugestao: p.type === 'number' ? 'use número com ponto decimal, sem aspas (ex.: 5.5)' : undefined };
    case 'minimum': case 'exclusiveMinimum': return { campo: base, mensagem: `deve ser ${e.keyword === 'minimum' ? '>=' : '>'} ${p.limit}` };
    case 'maximum': case 'exclusiveMaximum': return { campo: base, mensagem: `deve ser ${e.keyword === 'maximum' ? '<=' : '<'} ${p.limit}` };
    case 'format': return { campo: base, mensagem: p.format === 'date-time' ? 'data/hora inválida (ISO 8601, ex.: 2026-11-20T10:00:00-03:00)' : `formato inválido (${p.format})` };
    case 'const': return { campo: base, mensagem: `deve ser ${JSON.stringify(p.allowedValue)}` };
    default: return { campo: base || '(raiz)', mensagem: e.message ?? e.keyword };
  }
}

/** Valida contra o JSON Schema; devolve problemas (vazio = ok). Remove ruído dos ramos de `oneOf`. */
export function validarSchema(nome: 'nota' | 'config', dados: unknown): Problema[] {
  const v = validador(nome);
  if (v(dados)) return [];
  const erros = v.errors ?? [];
  // Dentro de um oneOf/anyOf que falhou, os erros de cada ramo só confundem: fica só o do oneOf/anyOf.
  const filtrados = erros.filter((e) => e.keyword === 'oneOf' || e.keyword === 'anyOf' || !/\/(oneOf|anyOf)\/\d+\//.test(e.schemaPath));
  const vistos = new Set<string>();
  return filtrados.map(traduzir).filter((x) => { const k = `${x.campo}|${x.mensagem}`; if (vistos.has(k)) return false; vistos.add(k); return true; });
}
