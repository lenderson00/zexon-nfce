// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { runCli, versao, type OpcoesRun } from './run.js';
import { EXEMPLOS } from './exemplos.js';

type Args = Record<string, unknown>;

const config = { type: 'string', description: 'Caminho do nfce.config.json (padrão: ./nfce.config.json ou $NFCE_CONFIG).' };
const nota = { type: 'object', description: 'A venda (formato de `nfce_schema` com qual="nota"). Alternativa a `arquivo`.' };
const arquivo = { type: 'string', description: 'Caminho de um arquivo JSON com a venda. Alternativa a `nota`.' };
const producao = { type: 'boolean', description: 'Obrigatório (true) quando o config está em produção. Nunca use sem o usuário pedir.' };
const chave = { type: 'string', pattern: '^\\d{44}$', description: 'Chave de acesso (44 dígitos).' };

interface Ferramenta {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  /** Monta argv (e stdin) para `runCli`. */
  argv: (a: Args) => { argv: string[]; stdin?: string };
}

const flag = (nome: string, v: unknown) => (v === undefined || v === null || v === '' ? [] : [`--${nome}`, String(v)]);
const bool = (nome: string, v: unknown) => (v === true ? [`--${nome}`] : []);
const comum = (a: Args) => [...flag('config', a.config), ...bool('producao', a.producao)];
function venda(a: Args): { arg: string; stdin?: string } {
  if (a.nota && typeof a.nota === 'object') return { arg: '-', stdin: JSON.stringify(a.nota) };
  if (typeof a.arquivo === 'string') return { arg: a.arquivo };
  return { arg: '' };
}

export const FERRAMENTAS: Ferramenta[] = [
  {
    name: 'nfce_schema', description: 'JSON Schema do arquivo da venda (qual="nota") ou do config (qual="config"). Leia antes de montar a venda.',
    inputSchema: { type: 'object', properties: { qual: { enum: ['nota', 'config'] } } },
    argv: (a) => ({ argv: ['schema', String(a.qual ?? 'nota')] }),
  },
  {
    name: 'nfce_exemplo', description: `Venda de exemplo válida para usar como modelo. Tipos: ${Object.keys(EXEMPLOS).join(', ')}.`,
    inputSchema: { type: 'object', properties: { tipo: { enum: Object.keys(EXEMPLOS) } } },
    argv: (a) => ({ argv: ['exemplo', String(a.tipo ?? 'simples')] }),
  },
  {
    name: 'nfce_doctor', description: 'Confere config, certificado (validade e CNPJ), CSC, endpoints e se a SEFAZ está no ar. Rode antes da primeira emissão.',
    inputSchema: { type: 'object', properties: { config, semRede: { type: 'boolean' } } },
    argv: (a) => ({ argv: ['doctor', ...flag('config', a.config), ...bool('sem-rede', a.semRede)] }),
  },
  {
    name: 'nfce_validar', description: 'Valida a venda sem enviar nada (sem rede e sem certificado). Devolve erros por campo com sugestão de correção.',
    inputSchema: { type: 'object', properties: { nota, arquivo, config } },
    argv: (a) => { const v = venda(a); return { argv: ['validar', v.arg, ...flag('config', a.config)], stdin: v.stdin }; },
  },
  {
    name: 'nfce_previa', description: 'Monta e assina a NFC-e sem enviar (chave, total, QR Code). Nada é transmitido.',
    inputSchema: { type: 'object', properties: { nota, arquivo, config } },
    argv: (a) => { const v = venda(a); return { argv: ['previa', v.arg, ...flag('config', a.config)], stdin: v.stdin }; },
  },
  {
    name: 'nfce_emitir',
    description: 'Emite a NFC-e na SEFAZ. Valide antes. `referencia` = id único da venda (repetir com a mesma referência devolve a mesma nota, nunca duas). Saída: status autorizada | contingencia | pendente | rejeitada, com proximoPasso.',
    inputSchema: { type: 'object', properties: { nota, arquivo, referencia: { type: 'string', minLength: 1 }, producao, config }, required: ['referencia'] },
    argv: (a) => { const v = venda(a); return { argv: ['emitir', v.arg, ...flag('referencia', a.referencia), ...comum(a)], stdin: v.stdin }; },
  },
  {
    name: 'nfce_contingencia', description: 'Emite em contingência quando a SEFAZ está fora: modo "offline" (tpEmis 9) ou "epec" (só SP). Depois rode nfce_pendentes com processar=true.',
    inputSchema: { type: 'object', properties: { modo: { enum: ['offline', 'epec'] }, nota, arquivo, referencia: { type: 'string' }, motivo: { type: 'string', minLength: 15, maxLength: 255 }, producao, config }, required: ['modo'] },
    argv: (a) => { const v = venda(a); return { argv: ['contingencia', String(a.modo), v.arg, ...flag('referencia', a.referencia), ...flag('motivo', a.motivo), ...comum(a)], stdin: v.stdin }; },
  },
  {
    name: 'nfce_pendentes', description: 'Lista notas pendentes/de contingência. Com processar=true transmite à SEFAZ (rode periodicamente).',
    inputSchema: { type: 'object', properties: { processar: { type: 'boolean' }, limite: { type: 'integer', minimum: 1 }, producao, config } },
    argv: (a) => ({ argv: ['pendentes', ...bool('processar', a.processar), ...flag('limite', a.limite), ...comum(a)] }),
  },
  {
    name: 'nfce_consultar', description: 'Situação de uma NFC-e na SEFAZ pela chave.',
    inputSchema: { type: 'object', properties: { chave, config }, required: ['chave'] },
    argv: (a) => ({ argv: ['consultar', String(a.chave), ...flag('config', a.config)] }),
  },
  {
    name: 'nfce_status', description: 'A SEFAZ da UF está em operação?',
    inputSchema: { type: 'object', properties: { config } },
    argv: (a) => ({ argv: ['status', ...flag('config', a.config)] }),
  },
  {
    name: 'nfce_cancelar', description: 'Cancela uma NFC-e autorizada (dentro do prazo da UF). Só com pedido explícito do usuário.',
    inputSchema: { type: 'object', properties: { chave, justificativa: { type: 'string', minLength: 15, maxLength: 255 }, producao, config }, required: ['chave', 'justificativa'] },
    argv: (a) => ({ argv: ['cancelar', String(a.chave), ...flag('justificativa', a.justificativa), ...comum(a)] }),
  },
  {
    name: 'nfce_danfce', description: 'Gera o DANFCE (PDF, ou HTML com html=true) de uma nota emitida e devolve o caminho do arquivo.',
    inputSchema: { type: 'object', properties: { chave, html: { type: 'boolean' }, saida: { type: 'string' }, config }, required: ['chave'] },
    argv: (a) => ({ argv: ['danfce', String(a.chave), ...bool('html', a.html), ...flag('saida', a.saida), ...flag('config', a.config)] }),
  },
];

/** Cria o servidor MCP (sem conectar o transporte). `opcoes` permite testes com SEFAZ simulada. */
export function criarServidorMcp(opcoes: OpcoesRun = {}): Server {
  const server = new Server(
    { name: 'zexon-nfce', version: versao() },
    {
      capabilities: { tools: {} },
      instructions: 'Emissão de NFC-e. Fluxo: nfce_doctor → nfce_exemplo/nfce_schema → montar a venda → nfce_validar → nfce_emitir (com referencia). Nunca peça nem mostre a senha do certificado ou o CSC. Só use producao=true se o usuário pedir explicitamente.',
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: FERRAMENTAS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const f = FERRAMENTAS.find((x) => x.name === req.params.name);
    if (!f) return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, codigo: 'FERRAMENTA_DESCONHECIDA' }) }] };
    const { argv, stdin } = f.argv((req.params.arguments ?? {}) as Args);
    const r = await runCli(argv.filter((x) => x !== ''), { ...opcoes, stdin });
    return {
      isError: r.codigo !== 0,
      content: [{ type: 'text', text: JSON.stringify({ codigoSaida: r.codigo, ...r.saida }, null, 2) }],
    };
  });
  return server;
}

export async function iniciarMcp(): Promise<void> {
  await criarServidorMcp().connect(new StdioServerTransport());
}
