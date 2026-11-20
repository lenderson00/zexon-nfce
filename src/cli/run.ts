// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, accessSync, constants } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { NfceClient, ResultadoEmissao } from '../client/NfceClient.js';
import { carregarCertificado, certificadoVencido } from '../certificate/index.js';
import { resolverEndpoints } from '../sefaz/endpoints.js';
import { validarChave } from '../xml/chave.js';
import { fmt } from '../util/xml.js';
import { ARQUIVO_CONFIG, caminhoConfig, carregarConfig, criarCliente, segredos, type Carregado, type CliConfig, type Contexto } from './config.js';
import { CliErro, SAIDA, dicaCstat, paraCliErro, type CodigoSaida } from './erros.js';
import { EXEMPLOS } from './exemplos.js';
import { lerNota, notaValida, prepararNota } from './nota.js';
import { SCHEMA_CONFIG, SCHEMA_NOTA } from './schema.js';
import { validarSchema } from './validacao.js';

export interface OpcoesRun extends Partial<Contexto> {
  /** Conteúdo da entrada padrão (para `-`). */
  stdin?: string;
}

export interface ResultadoRun {
  codigo: CodigoSaida;
  saida: Record<string, unknown>;
}

const OPCOES = {
  config: { type: 'string' }, producao: { type: 'boolean' }, referencia: { type: 'string' }, justificativa: { type: 'string' },
  protocolo: { type: 'string' }, por: { type: 'string' }, inicio: { type: 'string' }, fim: { type: 'string' }, serie: { type: 'string' },
  html: { type: 'boolean' }, saida: { type: 'string' }, processar: { type: 'boolean' }, limite: { type: 'string' }, ate: { type: 'string' },
  forcar: { type: 'boolean' }, 'sem-rede': { type: 'boolean' }, 'sem-danfce': { type: 'boolean' }, destino: { type: 'string' },
  ambiente: { type: 'string' }, uf: { type: 'string' }, cnpj: { type: 'string' }, 'razao-social': { type: 'string' }, ie: { type: 'string' },
  crt: { type: 'string' }, certificado: { type: 'string' }, 'csc-id': { type: 'string' }, motivo: { type: 'string' },
  help: { type: 'boolean', short: 'h' }, versao: { type: 'boolean', short: 'v' },
} as const;

type Flags = { [K in keyof typeof OPCOES]?: (typeof OPCOES)[K]['type'] extends 'boolean' ? boolean : string };

/** Arquivos do pacote (schemas, skills, package.json): funciona tanto em `src/cli` quanto em `dist`. */
function arquivoDoPacote(rel: string): string | undefined {
  const aqui = dirname(fileURLToPath(import.meta.url));
  for (const base of [resolve(aqui, '..'), resolve(aqui, '../..')]) {
    const p = join(base, rel);
    if (existsSync(p)) return p;
  }
  return undefined;
}

export function versao(): string {
  const p = arquivoDoPacote('package.json');
  return p ? (JSON.parse(readFileSync(p, 'utf8')) as { version: string }).version : '0.0.0';
}

export const AJUDA = `nfce — emissão de NFC-e pela linha de comando (feito para IAs e scripts). Saída sempre em JSON.

Fluxo: nfce init → nfce doctor → nfce exemplo > venda.json → nfce validar venda.json → nfce emitir venda.json --referencia <id-da-venda>

Comandos
  init [--uf --cnpj --razao-social --ie --crt --certificado --csc-id --serie --ambiente]   cria nfce.config.json (sem segredos)
  doctor [--sem-rede]                         confere config, certificado, CSC, endpoints e SEFAZ
  schema nota|config                          JSON Schema do arquivo da venda ou do config
  exemplo [simples|pix|cartao|cpf|regime-normal]   venda de exemplo válida
  validar <venda.json|->                      valida sem rede e sem certificado (só formato se não houver config)
  previa <venda.json|->                       monta e assina sem enviar (chave, totais, QR Code)
  emitir <venda.json|-> --referencia <id> [--producao] [--sem-danfce]
  contingencia offline|epec <venda.json|-> [--referencia <id>] [--motivo <texto>] [--producao]
  pendentes [--processar] [--limite N]        notas a transmitir / pendentes; --processar transmite
  consultar <chave>                           situação na SEFAZ
  status                                      SEFAZ em operação?
  cancelar <chave> --justificativa <15-255 caracteres> [--producao]
  substituir <chave> --por <chave-substituta> --justificativa <...> [--producao]   cancelamento por substituição
  inutilizar --inicio N [--fim N] [--serie N] --justificativa <...> [--producao]
  buracos [--ate N]                           números sem nota e não inutilizados
  reemitir <chave-rejeitada> <venda.json|-> [--producao]   mesmo número, nova chave
  danfce <chave> [--html] [--saida arquivo]   gera o DANFCE
  mcp                                         servidor MCP (stdio) com as mesmas operações
  skill instalar [--destino .claude/skills]   copia a Skill para o projeto

Opções globais: --config <arquivo> (padrão ./${ARQUIVO_CONFIG} ou $NFCE_CONFIG), --producao (obrigatória para enviar em produção)
Códigos de saída: 0 ok · 1 venda inválida · 2 rejeitada · 3 temporário/pendente (repita depois) · 4 configuração/certificado · 5 uso incorreto`;

function exigirAmbiente(c: Carregado, f: Flags): void {
  if (c.config.ambiente === 'producao' && !f.producao) {
    throw new CliErro(SAIDA.USO, 'CONFIRMAR_PRODUCAO', 'O config está em PRODUÇÃO: a nota terá valor fiscal. Repita com --producao para confirmar.');
  }
  if (c.config.ambiente !== 'producao' && f.producao) {
    throw new CliErro(SAIDA.USO, 'AMBIENTE_DIVERGENTE', 'Você passou --producao, mas o config está em homologação. Mude "ambiente" no config ou remova a flag.');
  }
}

const inteiro = (v: string | undefined, nome: string): number | undefined => {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new CliErro(SAIDA.USO, 'USO', `--${nome} deve ser um número inteiro.`);
  return n;
};

function chaveArg(v: string | undefined): string {
  const c = fmt.onlyDigits(v ?? '');
  if (!validarChave(c)) throw new CliErro(SAIDA.USO, 'CHAVE_INVALIDA', 'Informe uma chave de acesso válida (44 dígitos).');
  return c;
}

function justificativa(f: Flags): string {
  const j = (f.justificativa ?? '').trim();
  if (j.length < 15 || j.length > 255) throw new CliErro(SAIDA.USO, 'JUSTIFICATIVA', '--justificativa deve ter de 15 a 255 caracteres.');
  return j;
}

const rel = (base: string, p: string) => relative(base, p) || p;

/** Grava o DANFCE em PDF ao lado dos XMLs. */
async function salvarDanfce(cliente: NfceClient, c: Carregado, r: ResultadoEmissao): Promise<string | undefined> {
  const xml = r.xmlAutorizado ?? r.xmlAssinado;
  if (!xml || !['autorizada', 'contingencia'].includes(r.status)) return undefined;
  const pdf = await cliente.danfcePdf(xml);
  const destino = join(c.dados, 'danfce', `${r.chave}.pdf`);
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, pdf);
  return destino;
}

const PASTA_XML: Record<string, string> = { autorizada: 'autorizadas', contingencia: 'contingencia', pendente: 'pendentes', rejeitada: 'rejeitadas', denegada: 'rejeitadas', cancelada: 'autorizadas', conflito: 'autorizadas' };

const PROXIMO: Record<string, string> = {
  autorizada: 'Entregue o DANFCE ao consumidor. Nada mais a fazer.',
  contingencia: 'Entregue o DANFCE de contingência. Rode `nfce pendentes --processar` periodicamente até a nota ser autorizada (prazo legal).',
  pendente: 'Não emita outra nota para esta venda. Rode `nfce pendentes --processar` em alguns minutos.',
  rejeitada: 'Corrija o problema indicado em xMotivo/dica e use `nfce reemitir <chave> venda.json` (mesmo número).',
  denegada: 'Uso denegado pela SEFAZ (irregularidade cadastral): não reemita; procure o contador.',
  conflito: 'A venda ficou com duas notas autorizadas: cancele esta com `nfce cancelar <chave> --justificativa ...`.',
  descartada: 'Número livre: inutilize-o com `nfce inutilizar --inicio <numero> --justificativa ...` (ver `nfce buracos`).',
  cancelada: 'Nota cancelada.',
};

const SAIDA_STATUS: Record<string, CodigoSaida> = { autorizada: 0, contingencia: 0, cancelada: 0, pendente: 3, rejeitada: 2, denegada: 2, conflito: 2, descartada: 0 };

function resumo(c: Carregado, r: ResultadoEmissao, danfce?: string) {
  const xml = join(c.dados, 'xml', PASTA_XML[r.status] ?? 'pendentes', `${r.chave}.xml`);
  return {
    ok: ['autorizada', 'contingencia', 'cancelada'].includes(r.status),
    status: r.status, chave: r.chave, numero: r.numero, serie: r.serie, ambiente: c.config.ambiente,
    cStat: r.cStat || undefined, xMotivo: r.xMotivo || undefined, dica: r.status === 'rejeitada' ? dicaCstat(r.cStat) : undefined,
    protocolo: r.protocolo, dataAutorizacao: r.dataAutorizacao, protocoloEpec: r.protocoloEpec,
    valor: r.totais?.valorNota, qrCode: r.qrCode || undefined, urlConsulta: r.urlChave || undefined,
    prazo: r.prazo, motivoContingencia: r.motivoContingencia,
    arquivos: { xml: existsSync(xml) ? rel(c.base, xml) : undefined, danfce: danfce ? rel(c.base, danfce) : undefined },
    proximoPasso: PROXIMO[r.status],
  };
}

// ───────────────────────── Comandos ─────────────────────────

function cmdInit(ctx: Contexto, f: Flags): ResultadoRun {
  const caminho = caminhoConfig(ctx, f.config);
  if (existsSync(caminho) && !f.forcar) throw new CliErro(SAIDA.USO, 'CONFIG_EXISTE', `${caminho} já existe. Use --forcar para sobrescrever.`);
  const crt = Number(f.crt ?? 1);
  const config = {
    $schema: 'https://github.com/lenderson00/zexon-nfce/schemas/cli/config.schema.json',
    uf: (f.uf ?? '').toUpperCase(), ambiente: f.ambiente === 'producao' ? 'producao' : 'homologacao', serie: inteiro(f.serie, 'serie') ?? 1,
    emitente: {
      cnpj: fmt.onlyDigits(f.cnpj ?? ''), razaoSocial: f['razao-social'] ?? '', inscricaoEstadual: f.ie ?? '', regimeTributario: crt,
      endereco: { logradouro: '', numero: '', bairro: '', codigoMunicipio: '', municipio: '', uf: (f.uf ?? '').toUpperCase(), cep: '' },
    },
    certificado: { arquivo: f.certificado ?? './certificado.pfx', senhaEnv: 'NFCE_CERT_SENHA' },
    ...(f['csc-id'] ? { csc: { id: Number(f['csc-id']), codigoEnv: 'NFCE_CSC' } } : {}),
    dados: '.nfce', contingenciaAutomatica: true,
  };
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, `${JSON.stringify(config, null, 2)}\n`);
  const dados = resolve(dirname(caminho), '.nfce');
  mkdirSync(dados, { recursive: true });
  writeFileSync(join(dados, '.gitignore'), '*\n'); // estado local nunca vai para o git
  const { $schema: _s, ...semSchema } = config;
  const problemas = validarSchemaParcial(semSchema);
  return {
    codigo: SAIDA.OK,
    saida: {
      ok: true, config: rel(ctx.cwd, caminho), faltando: problemas,
      segredos: { NFCE_CERT_SENHA: 'senha do certificado A1', ...(config.csc ? { NFCE_CSC: 'código CSC do QR Code' } : {}) },
      proximoPasso: problemas.length
        ? 'Preencha os campos em `faltando` no config, defina as variáveis de `segredos` no ambiente e rode `nfce doctor`.'
        : 'Defina as variáveis de `segredos` no ambiente (nunca no arquivo) e rode `nfce doctor`.',
      aviso: 'Não versione o certificado (.pfx) nem a pasta .nfce.',
    },
  };
}

function validarSchemaParcial(config: unknown) {
  return validarSchema('config', config).map((p) => ({ campo: p.campo, mensagem: p.mensagem }));
}

async function cmdDoctor(ctx: Contexto, f: Flags): Promise<ResultadoRun> {
  const checks: Array<{ item: string; ok: boolean; detalhe?: string; dica?: string }> = [];
  const add = (item: string, ok: boolean, detalhe?: string, dica?: string) => checks.push({ item, ok, detalhe, dica });
  let c: Carregado;
  try {
    c = carregarConfig(ctx, f.config);
    add('config', true, rel(ctx.cwd, c.caminho));
  } catch (e) {
    const ce = paraCliErro(e);
    add('config', false, ce.message, ce.erros.length ? JSON.stringify(ce.erros) : (ce.extra.dica as string));
    return { codigo: SAIDA.CONFIGURACAO, saida: { ok: false, checks } };
  }
  add('ambiente', true, c.config.ambiente === 'producao' ? 'PRODUÇÃO (notas com valor fiscal; exige --producao)' : 'homologação (sem valor fiscal)');
  let cliente: NfceClient | undefined;
  try {
    const s = segredos(c, ctx);
    add('segredos', true, 'senha do certificado' + (s.csc ? ' e CSC definidos' : ' definida (sem CSC: QR Code v3)'));
    const cert = carregarCertificado({ pfx: s.pfx, senha: s.senha });
    const dias = Math.floor((cert.validoAte.getTime() - (ctx.relogio?.() ?? new Date()).getTime()) / 86_400_000);
    const doc = cert.documento;
    const mesmaRaiz = !doc || doc.length !== 14 || doc.slice(0, 8) === c.config.emitente.cnpj.slice(0, 8);
    add('certificado', !certificadoVencido(cert) && mesmaRaiz,
      `${cert.titular} — válido até ${cert.validoAte.toISOString().slice(0, 10)} (${dias} dias)`,
      !mesmaRaiz ? `O certificado é do CNPJ ${doc}, de outra empresa.` : dias < 30 ? 'Renove o certificado em breve.' : undefined);
    cliente = criarCliente(c, ctx).cliente;
  } catch (e) {
    const ce = paraCliErro(e);
    add('certificado', false, ce.message, ce.extra.dica as string | undefined);
  }
  try {
    const ep = resolverEndpoints(c.config.uf, c.config.ambiente);
    add('endpoints', true, `${c.config.uf} (${ep.autorizador ?? c.config.uf})${ep.servicos.epecRecepcao ? ' — EPEC disponível' : ''}`);
  } catch (e) {
    add('endpoints', false, (e as Error).message);
  }
  try {
    mkdirSync(c.dados, { recursive: true });
    accessSync(c.dados, constants.W_OK);
    add('pasta de dados', true, rel(c.base, c.dados));
  } catch (e) {
    add('pasta de dados', false, (e as Error).message);
  }
  if (cliente && !f['sem-rede']) {
    try {
      const st = await cliente.status();
      add('sefaz', st.online, `${st.cStat} ${st.xMotivo}`, st.online ? undefined : 'SEFAZ fora: emita em contingência (`nfce contingencia offline`).');
    } catch (e) {
      add('sefaz', false, (e as Error).message, 'Sem comunicação com a SEFAZ: confira internet/TLS (casAdicionaisDir com a cadeia ICP-Brasil).');
    }
  }
  const ok = checks.every((x) => x.ok);
  return { codigo: ok ? SAIDA.OK : SAIDA.CONFIGURACAO, saida: { ok, checks } };
}

function configOpcional(ctx: Contexto, f: Flags): Carregado | undefined {
  try {
    return carregarConfig(ctx, f.config);
  } catch (e) {
    if (e instanceof CliErro && e.codigo === 'SEM_CONFIG') return undefined;
    throw e;
  }
}

function cmdValidar(ctx: Contexto, f: Flags, pos: string[], stdin?: string): ResultadoRun {
  const dados = lerNota(pos[0], ctx.cwd, stdin);
  const c = configOpcional(ctx, f);
  const { nota, problemas } = prepararNota(dados, c?.config);
  if (problemas.length) return { codigo: SAIDA.NOTA_INVALIDA, saida: { ok: false, codigo: 'NOTA_INVALIDA', erros: problemas, dica: 'Corrija e valide de novo.' } };
  const total = totalDaNota(nota ?? (dados as Parameters<typeof totalDaNota>[0]));
  return {
    codigo: SAIDA.OK,
    saida: {
      ok: true, completo: !!c, itens: (dados as { itens: unknown[] }).itens.length, total,
      aviso: c ? undefined : 'Sem nfce.config.json: validei só o formato. Regras que dependem do emitente (CSOSN x CST, IBS/CBS) não foram conferidas.',
      proximoPasso: c ? 'Emita com `nfce emitir <arquivo> --referencia <id-da-venda>`.' : 'Crie o config com `nfce init`.',
    },
  };
}

function totalDaNota(n: { itens: Array<{ quantidade: number; valorUnitario: number; desconto?: number; frete?: number; seguro?: number; outrasDespesas?: number }> }): number {
  const C = (v = 0) => Math.round(v * 100);
  const cent = n.itens.reduce((s, i) => s + Math.round(i.quantidade * i.valorUnitario * 100) - C(i.desconto) + C(i.frete) + C(i.seguro) + C(i.outrasDespesas), 0);
  return cent / 100;
}

async function cmdPrevia(ctx: Contexto, f: Flags, pos: string[], stdin?: string): Promise<ResultadoRun> {
  const c = carregarConfig(ctx, f.config);
  const nota = notaValida(lerNota(pos[0], ctx.cwd, stdin), c.config);
  const { cliente } = criarCliente(c, ctx);
  const p = cliente.preparar(nota.numero ? nota : { ...nota, numero: 1 });
  const destino = join(c.dados, 'previas', `${p.chave}.xml`);
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, p.xmlAssinado);
  return {
    codigo: SAIDA.OK,
    saida: {
      ok: true, chave: p.chave, total: p.totais.vNF, qrCode: p.qrCode, arquivo: rel(c.base, destino),
      aviso: nota.numero ? undefined : 'Prévia com número 1 (ilustrativo): na emissão o número vem do numerador.',
      proximoPasso: 'Nada foi enviado. Para emitir: `nfce emitir <arquivo> --referencia <id>`.',
    },
  };
}

async function cmdEmitir(ctx: Contexto, f: Flags, pos: string[], stdin?: string): Promise<ResultadoRun> {
  const c = carregarConfig(ctx, f.config);
  exigirAmbiente(c, f);
  const nota = notaValida(lerNota(pos[0], ctx.cwd, stdin), c.config);
  const { cliente } = criarCliente(c, ctx);
  const r = await cliente.emitir(nota, { referencia: f.referencia });
  const danfce = f['sem-danfce'] ? undefined : await salvarDanfce(cliente, c, r);
  const saida = resumo(c, r, danfce);
  return { codigo: SAIDA_STATUS[r.status] ?? SAIDA.REJEITADA, saida: { ...saida, aviso: f.referencia ? undefined : 'Sem --referencia: repetir este comando pode gerar outra nota para a mesma venda.' } };
}

async function cmdContingencia(ctx: Contexto, f: Flags, pos: string[], stdin?: string): Promise<ResultadoRun> {
  const modo = pos[0];
  if (modo !== 'offline' && modo !== 'epec') throw new CliErro(SAIDA.USO, 'USO', 'Use `nfce contingencia offline <venda.json>` ou `nfce contingencia epec <venda.json>` (EPEC só em SP).');
  const c = carregarConfig(ctx, f.config);
  exigirAmbiente(c, f);
  const nota = notaValida(lerNota(pos[1], ctx.cwd, stdin), c.config);
  const { cliente } = criarCliente(c, ctx);
  const motivo = f.motivo;
  const r = modo === 'epec'
    ? await cliente.contingencia.emitirEpec(nota, motivo, { referencia: f.referencia })
    : await cliente.contingencia.emitirOffline(nota, motivo, { referencia: f.referencia });
  const danfce = f['sem-danfce'] ? undefined : await salvarDanfce(cliente, c, r);
  return { codigo: SAIDA_STATUS[r.status] ?? SAIDA.OK, saida: resumo(c, r, danfce) };
}

async function cmdPendentes(ctx: Contexto, f: Flags): Promise<ResultadoRun> {
  const c = carregarConfig(ctx, f.config);
  const { cliente, registro } = criarCliente(c, ctx);
  const limite = inteiro(f.limite, 'limite') ?? 100;
  if (!f.processar) {
    const lista = await registro.pendentes({ uf: c.config.uf, ambiente: c.config.ambiente, cnpj: c.config.emitente.cnpj, limite });
    return {
      codigo: SAIDA.OK,
      saida: {
        ok: true, total: lista.length,
        notas: lista.map((n) => ({ chave: n.chave, numero: n.numero, situacao: n.situacao, tpEmis: n.tpEmis, emitidaEm: n.emitidaEm, tentativas: n.tentativas, ultimoErro: n.ultimoErro ?? undefined, prazo: [4, 9].includes(n.tpEmis) ? cliente.prazoContingencia(n.emitidaEm) : undefined })),
        proximoPasso: lista.length ? 'Rode `nfce pendentes --processar` para transmitir.' : 'Nada pendente.',
      },
    };
  }
  if (c.config.ambiente === 'producao' && !f.producao) throw new CliErro(SAIDA.USO, 'CONFIRMAR_PRODUCAO', 'O config está em PRODUÇÃO. Repita com --producao para transmitir.');
  const rs = await cliente.processarPendentes({ limite, cnpj: c.config.emitente.cnpj });
  const notas = rs.map((r) => resumo(c, r));
  const algumaPendente = rs.some((r) => ['pendente', 'contingencia'].includes(r.status));
  const algumaRuim = rs.some((r) => ['rejeitada', 'denegada', 'conflito'].includes(r.status));
  return { codigo: algumaRuim ? SAIDA.REJEITADA : algumaPendente ? SAIDA.TEMPORARIO : SAIDA.OK, saida: { ok: !algumaRuim && !algumaPendente, total: notas.length, notas } };
}

async function cmdConsultar(ctx: Contexto, f: Flags, pos: string[]): Promise<ResultadoRun> {
  const chave = chaveArg(pos[0]);
  const c = carregarConfig(ctx, f.config);
  const { cliente, registro } = criarCliente(c, ctx);
  const r = await cliente.consultar(chave);
  const local = await registro.buscar(chave);
  return {
    codigo: SAIDA.OK,
    saida: { ok: true, chave, situacao: r.situacao, cStat: r.cStat, xMotivo: r.xMotivo, protocolo: r.protocolo, eventos: r.eventos.map((e) => ({ tpEvento: e.tpEvento, cStat: e.cStat, protocolo: e.nProt })), registroLocal: local ? { situacao: local.situacao, numero: local.numero, referencia: local.referencia ?? undefined } : undefined },
  };
}

async function cmdStatus(ctx: Contexto, f: Flags): Promise<ResultadoRun> {
  const c = carregarConfig(ctx, f.config);
  const { cliente } = criarCliente(c, ctx);
  const r = await cliente.status();
  return { codigo: r.online ? SAIDA.OK : SAIDA.TEMPORARIO, saida: { ok: r.online, uf: c.config.uf, ambiente: c.config.ambiente, cStat: r.cStat, xMotivo: r.xMotivo, tempoMedioSegundos: r.tempoMedioSegundos, dica: r.online ? undefined : dicaCstat(r.cStat) ?? 'Emita em contingência.' } };
}

async function protocoloDe(registro: { buscar(c: string): Promise<{ protocolo?: string | null; situacao: string } | undefined> }, chave: string, f: Flags): Promise<string> {
  const p = f.protocolo ?? (await registro.buscar(chave))?.protocolo ?? undefined;
  if (!p) throw new CliErro(SAIDA.USO, 'SEM_PROTOCOLO', 'Protocolo de autorização desconhecido para esta chave (nota não autorizada por esta CLI). Informe --protocolo.');
  return p;
}

async function cmdCancelar(ctx: Contexto, f: Flags, pos: string[]): Promise<ResultadoRun> {
  const chave = chaveArg(pos[0]);
  const j = justificativa(f);
  const c = carregarConfig(ctx, f.config);
  exigirAmbiente(c, f);
  const { cliente, registro } = criarCliente(c, ctx);
  const r = await cliente.cancelar({ chave, protocolo: await protocoloDe(registro, chave, f), justificativa: j });
  return { codigo: r.sucesso ? SAIDA.OK : SAIDA.REJEITADA, saida: { ok: r.sucesso, chave, cStat: r.cStat, xMotivo: r.xMotivo, protocolo: r.protocolo, dica: r.sucesso ? undefined : dicaCstat(r.cStat) ?? 'Confira o prazo de cancelamento da UF.' } };
}

async function cmdSubstituir(ctx: Contexto, f: Flags, pos: string[]): Promise<ResultadoRun> {
  const chave = chaveArg(pos[0]);
  const chaveSubstituta = chaveArg(f.por);
  if (chave === chaveSubstituta) throw new CliErro(SAIDA.USO, 'USO', 'A nota substituta deve ser diferente da cancelada.');
  const j = justificativa(f);
  const c = carregarConfig(ctx, f.config);
  exigirAmbiente(c, f);
  const { cliente, registro } = criarCliente(c, ctx);
  const r = await cliente.cancelarPorSubstituicao({ chave, protocolo: await protocoloDe(registro, chave, f), justificativa: j, chaveSubstituta });
  return { codigo: r.sucesso ? SAIDA.OK : SAIDA.REJEITADA, saida: { ok: r.sucesso, chave, chaveSubstituta, cStat: r.cStat, xMotivo: r.xMotivo, protocolo: r.protocolo, dica: r.sucesso ? undefined : dicaCstat(r.cStat) } };
}

async function cmdInutilizar(ctx: Contexto, f: Flags): Promise<ResultadoRun> {
  const inicio = inteiro(f.inicio, 'inicio');
  if (!inicio) throw new CliErro(SAIDA.USO, 'USO', 'Informe --inicio (e --fim para uma faixa).');
  const fim = inteiro(f.fim, 'fim') ?? inicio;
  const j = justificativa(f);
  const c = carregarConfig(ctx, f.config);
  exigirAmbiente(c, f);
  const { cliente } = criarCliente(c, ctx);
  const r = await cliente.inutilizar({ serie: inteiro(f.serie, 'serie') ?? c.config.serie, numeroInicial: inicio, numeroFinal: fim, justificativa: j, cnpj: c.config.emitente.cnpj });
  return { codigo: r.sucesso ? SAIDA.OK : SAIDA.REJEITADA, saida: { ok: r.sucesso, inicio, fim, cStat: r.cStat, xMotivo: r.xMotivo, protocolo: r.protocolo, dica: r.sucesso ? undefined : dicaCstat(r.cStat) } };
}

async function cmdBuracos(ctx: Contexto, f: Flags): Promise<ResultadoRun> {
  const c = carregarConfig(ctx, f.config);
  const { registro } = criarCliente(c, ctx);
  const serie = inteiro(f.serie, 'serie') ?? c.config.serie;
  const notas = (await registro.todas()).filter((n) => n.cnpj === c.config.emitente.cnpj && n.ambiente === c.config.ambiente && n.serie === serie);
  const ate = inteiro(f.ate, 'ate') ?? notas.reduce((m, n) => Math.max(m, n.numero), 0);
  const numeros = ate ? await registro.buracos({ cnpj: c.config.emitente.cnpj, ambiente: c.config.ambiente, serie, ate }) : [];
  return { codigo: SAIDA.OK, saida: { ok: true, serie, ate, numeros, proximoPasso: numeros.length ? 'Inutilize os números que não serão usados: `nfce inutilizar --inicio N --fim N --justificativa ...` (até o dia 10 do mês seguinte).' : 'Sem buracos.' } };
}

async function cmdReemitir(ctx: Contexto, f: Flags, pos: string[], stdin?: string): Promise<ResultadoRun> {
  const chave = chaveArg(pos[0]);
  const c = carregarConfig(ctx, f.config);
  exigirAmbiente(c, f);
  const nota = notaValida(lerNota(pos[1], ctx.cwd, stdin), c.config);
  const { cliente } = criarCliente(c, ctx);
  const r = await cliente.reemitir(chave, nota, { referencia: f.referencia });
  const danfce = f['sem-danfce'] ? undefined : await salvarDanfce(cliente, c, r);
  return { codigo: SAIDA_STATUS[r.status] ?? SAIDA.REJEITADA, saida: { ...resumo(c, r, danfce), chaveAnterior: chave } };
}

async function cmdDanfce(ctx: Contexto, f: Flags, pos: string[]): Promise<ResultadoRun> {
  const chave = chaveArg(pos[0]);
  const c = carregarConfig(ctx, f.config);
  const { cliente, storage } = criarCliente(c, ctx);
  let xml: string | undefined;
  for (const t of ['autorizadas', 'contingencia', 'pendentes'] as const) {
    xml = await storage.ler(t, chave);
    if (xml) break;
  }
  if (!xml) throw new CliErro(SAIDA.USO, 'XML_AUSENTE', `Não encontrei o XML da nota ${chave} em ${rel(c.base, c.dados)}.`);
  const destino = f.saida ? (isAbsolute(f.saida) ? f.saida : resolve(ctx.cwd, f.saida)) : join(c.dados, 'danfce', `${chave}.${f.html ? 'html' : 'pdf'}`);
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, f.html ? await cliente.danfceHtml(xml) : await cliente.danfcePdf(xml));
  return { codigo: SAIDA.OK, saida: { ok: true, chave, arquivo: rel(ctx.cwd, destino), formato: f.html ? 'html' : 'pdf' } };
}

function cmdSkill(ctx: Contexto, f: Flags, pos: string[]): ResultadoRun {
  if (pos[0] !== 'instalar') throw new CliErro(SAIDA.USO, 'USO', 'Use `nfce skill instalar [--destino .claude/skills]`.');
  const origem = arquivoDoPacote('skills/nfce');
  if (!origem) throw new CliErro(SAIDA.CONFIGURACAO, 'SKILL_AUSENTE', 'A pasta skills/nfce não foi encontrada no pacote.');
  const base = f.destino ? (isAbsolute(f.destino) ? f.destino : resolve(ctx.cwd, f.destino)) : resolve(ctx.cwd, '.claude/skills');
  const destino = join(base, 'nfce');
  if (existsSync(destino) && !f.forcar) throw new CliErro(SAIDA.USO, 'SKILL_EXISTE', `${destino} já existe. Use --forcar para atualizar.`);
  cpSync(origem, destino, { recursive: true, force: true });
  return { codigo: SAIDA.OK, saida: { ok: true, destino: rel(ctx.cwd, destino), proximoPasso: 'A Skill "nfce" fica disponível para o agente nesta pasta de projeto.' } };
}

function cmdSchema(pos: string[]): ResultadoRun {
  const qual = pos[0] ?? 'nota';
  if (qual !== 'nota' && qual !== 'config') throw new CliErro(SAIDA.USO, 'USO', 'Use `nfce schema nota` ou `nfce schema config`.');
  return { codigo: SAIDA.OK, saida: (qual === 'nota' ? SCHEMA_NOTA : SCHEMA_CONFIG) as unknown as Record<string, unknown> };
}

function cmdExemplo(pos: string[]): ResultadoRun {
  const qual = pos[0] ?? 'simples';
  const e = EXEMPLOS[qual];
  if (!e) throw new CliErro(SAIDA.USO, 'USO', `Exemplos: ${Object.keys(EXEMPLOS).join(', ')}.`);
  return { codigo: SAIDA.OK, saida: { $schema: 'https://github.com/lenderson00/zexon-nfce/schemas/cli/nota.schema.json', ...e.nota } };
}

/**
 * Executa a CLI sem efeitos no processo (não chama `process.exit`, não escreve no terminal).
 * Usado pelo binário, pelo servidor MCP e pelos testes.
 */
export async function runCli(argv: string[], opcoes: OpcoesRun = {}): Promise<ResultadoRun> {
  const ctx: Contexto = { cwd: opcoes.cwd ?? process.cwd(), env: opcoes.env ?? process.env, fetchImpl: opcoes.fetchImpl, relogio: opcoes.relogio };
  let f: Flags;
  let pos: string[];
  try {
    const p = parseArgs({ args: argv, options: OPCOES, allowPositionals: true, strict: true });
    f = p.values as Flags;
    pos = p.positionals;
  } catch (e) {
    return { codigo: SAIDA.USO, saida: { ok: false, codigo: 'USO', mensagem: (e as Error).message, dica: 'Veja `nfce --help`.' } };
  }
  const [cmd, ...resto] = pos;
  if (f.versao) return { codigo: SAIDA.OK, saida: { ok: true, versao: versao() } };
  if (f.help || !cmd || cmd === 'ajuda' || cmd === 'help') return { codigo: SAIDA.OK, saida: { ok: true, versao: versao(), ajuda: AJUDA } };
  try {
    switch (cmd) {
      case 'init': return cmdInit(ctx, f);
      case 'doctor': return await cmdDoctor(ctx, f);
      case 'schema': return cmdSchema(resto);
      case 'exemplo': return cmdExemplo(resto);
      case 'validar': return cmdValidar(ctx, f, resto, opcoes.stdin);
      case 'previa': return await cmdPrevia(ctx, f, resto, opcoes.stdin);
      case 'emitir': return await cmdEmitir(ctx, f, resto, opcoes.stdin);
      case 'contingencia': return await cmdContingencia(ctx, f, resto, opcoes.stdin);
      case 'pendentes': return await cmdPendentes(ctx, f);
      case 'consultar': return await cmdConsultar(ctx, f, resto);
      case 'status': return await cmdStatus(ctx, f);
      case 'cancelar': return await cmdCancelar(ctx, f, resto);
      case 'substituir': return await cmdSubstituir(ctx, f, resto);
      case 'inutilizar': return await cmdInutilizar(ctx, f);
      case 'buracos': return await cmdBuracos(ctx, f);
      case 'reemitir': return await cmdReemitir(ctx, f, resto, opcoes.stdin);
      case 'danfce': return await cmdDanfce(ctx, f, resto);
      case 'skill': return cmdSkill(ctx, f, resto);
      default:
        return { codigo: SAIDA.USO, saida: { ok: false, codigo: 'COMANDO_DESCONHECIDO', mensagem: `Comando desconhecido: ${cmd}`, dica: 'Veja `nfce --help`.' } };
    }
  } catch (e) {
    const ce = paraCliErro(e);
    return { codigo: ce.saida, saida: { ok: false, codigo: ce.codigo, mensagem: ce.message, ...(ce.erros.length ? { erros: ce.erros } : {}), ...ce.extra } };
  }
}

export type { CliConfig };
