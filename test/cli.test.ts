import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { runCli } from '../src/cli/run.js';
import { EXEMPLOS } from '../src/cli/exemplos.js';
import { SCHEMA_CONFIG, SCHEMA_NOTA } from '../src/cli/schema.js';
import { prepararNota } from '../src/cli/nota.js';
import { TransportError } from '../src/errors/index.js';
import { gerarPfxTeste, notaExemplo } from './helpers.js';

const NS = 'xmlns="http://www.portalfiscal.inf.br/nfe"';
const soap = (x: string) => `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg>${x}</nfeResultMsg></soap:Body></soap:Envelope>`;
const prot = (chave: string, cStat = '100', xMotivo = 'Autorizado o uso da NF-e') =>
  `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>${chave}</chNFe><dhRecbto>2026-11-20T10:00:05-03:00</dhRecbto>${cStat === '100' ? `<nProt>1352600000${chave.slice(-5)}</nProt>` : ''}<cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protNFe>`;

/** SEFAZ-SP simulada para a CLI. */
class Sefaz {
  autorizadas = new Set<string>();
  roteiro: Array<'ok' | 'rejeita' | 'fora' | 'recusada'> = [];
  chamadas: string[] = [];
  fetchImpl = async (url: string, env: string): Promise<string> => {
    this.chamadas.push(url);
    if (url.includes('StatusServico')) return soap(`<retConsStatServ versao="4.00" ${NS}><cStat>107</cStat><xMotivo>Servico em Operacao</xMotivo><tMed>1</tMed></retConsStatServ>`);
    if (url.includes('Autorizacao4')) {
      const comp = this.roteiro.shift() ?? 'ok';
      if (comp === 'fora') throw new TransportError('ECONNRESET');
      if (comp === 'recusada') throw new TransportError('connect ECONNREFUSED', undefined, { naoRecebido: true });
      const chave = /Id="NFe(\d{44})"/.exec(env)![1]!;
      if (comp === 'rejeita') return soap(`<retEnviNFe versao="4.00" ${NS}><cStat>104</cStat><xMotivo>Lote processado</xMotivo>${prot(chave, '778', 'Rejeicao: Informado NCM inexistente')}</retEnviNFe>`);
      this.autorizadas.add(chave);
      return soap(`<retEnviNFe versao="4.00" ${NS}><cStat>104</cStat><xMotivo>Lote processado</xMotivo>${prot(chave)}</retEnviNFe>`);
    }
    if (url.includes('ConsultaProtocolo')) {
      const chave = /<chNFe>(\d{44})<\/chNFe>/.exec(env)![1]!;
      if (!this.autorizadas.has(chave)) return soap(`<retConsSitNFe versao="4.00" ${NS}><cStat>217</cStat><xMotivo>Rejeicao: NF-e nao consta na base</xMotivo></retConsSitNFe>`);
      return soap(`<retConsSitNFe versao="4.00" ${NS}><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo>${prot(chave)}</retConsSitNFe>`);
    }
    if (url.includes('RecepcaoEvento4')) {
      const chave = /<chNFe>(\d{44})<\/chNFe>/.exec(env)![1]!;
      return soap(`<retEnvEvento versao="1.00" ${NS}><cStat>128</cStat><xMotivo>Lote processado</xMotivo><retEvento versao="1.00"><infEvento><cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo><chNFe>${chave}</chNFe><tpEvento>110111</tpEvento><nProt>135260000009999</nProt></infEvento></retEvento></retEnvEvento>`);
    }
    if (url.includes('Inutilizacao')) return soap(`<retInutNFe versao="4.00" ${NS}><infInut><cStat>102</cStat><xMotivo>Inutilizacao de numero homologado</xMotivo><nProt>135260000007777</nProt></infInut></retInutNFe>`);
    throw new Error(`serviço inesperado ${url}`);
  };
}

const SENHA = 'teste123';
const CSC = 'CSC-TESTE-0123456789';
let pfx: Buffer;
beforeAll(() => { pfx = gerarPfxTeste('11222333000181', SENHA).pfx; });

let dir: string;
let sefaz: Sefaz;
const env = () => ({ NFCE_CERT_SENHA: SENHA, NFCE_CSC: CSC });
const cli = (argv: string[], extra: { env?: Record<string, string>; stdin?: string } = {}) =>
  runCli(argv, { cwd: dir, env: extra.env ?? env(), fetchImpl: sefaz.fetchImpl, stdin: extra.stdin });

function escreverConfig(over: Record<string, unknown> = {}) {
  const e = notaExemplo().emitente;
  writeFileSync(join(dir, 'certificado.pfx'), pfx);
  writeFileSync(join(dir, 'nfce.config.json'), JSON.stringify({
    uf: 'SP', ambiente: 'homologacao', serie: 1,
    emitente: { ...e, endereco: { ...e.endereco, codigoMunicipio: String(e.endereco.codigoMunicipio) } },
    certificado: { arquivo: './certificado.pfx' }, csc: { id: 1 }, ...over,
  }));
}
const venda = (nome: string, conteudo: unknown = EXEMPLOS.simples!.nota) => { writeFileSync(join(dir, nome), JSON.stringify(conteudo)); return nome; };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nfce-cli-'));
  sefaz = new Sefaz();
});

describe('schemas e exemplos', () => {
  it('os schemas publicados em schemas/cli batem com a fonte', () => {
    expect(JSON.parse(readFileSync('schemas/cli/nota.schema.json', 'utf8'))).toEqual(JSON.parse(JSON.stringify(SCHEMA_NOTA)));
    expect(JSON.parse(readFileSync('schemas/cli/config.schema.json', 'utf8'))).toEqual(JSON.parse(JSON.stringify(SCHEMA_CONFIG)));
    const ajv = new Ajv2020({ strict: false });
    expect(() => ajv.compile(SCHEMA_NOTA)).not.toThrow();
  });

  it('todo exemplo passa no Schema e nas regras da lib (com o emitente certo)', () => {
    const e = notaExemplo().emitente;
    const base = { uf: 'SP', ambiente: 'homologacao', serie: 1, certificado: { arquivo: 'x' } } as const;
    for (const [nome, ex] of Object.entries(EXEMPLOS)) {
      const crt = nome === 'regime-normal' ? 3 : 1;
      const r = prepararNota(ex.nota, { ...base, emitente: { ...e, regimeTributario: crt } } as never);
      expect(r.problemas, nome).toEqual([]);
      expect(r.nota, nome).toBeDefined();
    }
  });
});

describe('CLI nfce', () => {
  it('ajuda, versão e comando desconhecido', async () => {
    expect((await cli([])).saida.ajuda).toContain('nfce emitir');
    expect((await cli(['--versao'])).saida.versao).toMatch(/^\d+\.\d+\.\d+/);
    expect(await cli(['xpto'])).toMatchObject({ codigo: 5, saida: { ok: false, codigo: 'COMANDO_DESCONHECIDO' } });
    expect((await cli(['emitir', '--opcao-que-nao-existe'])).codigo).toBe(5);
  });

  it('init cria config sem segredos e aponta o que falta; doctor fica ok depois de completar', async () => {
    const r = await cli(['init', '--uf', 'SP', '--cnpj', '11.222.333/0001-81', '--crt', '1', '--csc-id', '1']);
    expect(r.codigo).toBe(0);
    expect((r.saida.faltando as Array<{ campo: string }>).map((x) => x.campo)).toContain('emitente.razaoSocial');
    const texto = readFileSync(join(dir, 'nfce.config.json'), 'utf8');
    expect(texto).not.toContain(SENHA);
    expect(existsSync(join(dir, '.nfce', '.gitignore'))).toBe(true);
    expect((await cli(['init'])).codigo).toBe(5); // não sobrescreve

    expect((await cli(['doctor', '--sem-rede'])).codigo).toBe(4); // config incompleto
    escreverConfig();
    const d = await cli(['doctor']);
    expect(d.codigo).toBe(0);
    expect((d.saida.checks as Array<{ item: string; ok: boolean }>).every((c) => c.ok)).toBe(true);
    expect(JSON.stringify(d.saida)).not.toContain(SENHA);
    expect(JSON.stringify(d.saida)).not.toContain(CSC);

    const semSenha = await cli(['doctor', '--sem-rede'], { env: { NFCE_CSC: CSC } });
    expect(semSenha.codigo).toBe(4);
    expect(JSON.stringify(semSenha.saida)).toContain('NFCE_CERT_SENHA');
  });

  it('schema, exemplo e validar (sem config valida só o formato)', async () => {
    expect((await cli(['schema', 'nota'])).saida.title).toContain('NFC-e');
    const ex = (await cli(['exemplo', 'pix'])).saida;
    expect(ex.itens).toBeDefined();
    const ok = await cli(['validar', '-'], { stdin: JSON.stringify(ex) });
    expect(ok).toMatchObject({ codigo: 0, saida: { ok: true, completo: false, total: 18 } });

    const ruim = await cli(['validar', venda('ruim.json', { itens: [{ codigo: '1', descricao: 'X', ncm: '2202.10.00', cfop: '5102', unidade: 'UN', quantidade: 1, valorUnitario: 5, icms: { csosn: '102', origem: 0 }, cor: 'azul' }], pagamentos: [] })]);
    expect(ruim.codigo).toBe(1);
    const erros = ruim.saida.erros as Array<{ campo: string; mensagem: string; sugestao?: string }>;
    expect(erros.find((e) => e.campo === 'itens[0].ncm')?.sugestao).toContain('8 dígitos');
    expect(erros.find((e) => e.campo === 'itens[0].cor')?.mensagem).toBe('campo desconhecido');
    expect(erros.some((e) => e.campo === 'pagamentos')).toBe(true);

    expect((await cli(['validar', '-'], { stdin: '{nao json' })).saida.codigo).toBe('JSON_INVALIDO');
  });

  it('validar com config aplica as regras do emitente (Simples exige CSOSN; pagamento cobre o total)', async () => {
    escreverConfig();
    const nota = { itens: [{ codigo: '1', descricao: 'X', ncm: '22021000', cfop: '5102', unidade: 'UN', quantidade: 1, valorUnitario: 50, icms: { cst: '00', origem: 0, aliquota: 18 } }], pagamentos: [{ tipo: 'pix', valor: 10 }] };
    const r = await cli(['validar', venda('v.json', nota)]);
    expect(r.codigo).toBe(1);
    const campos = (r.saida.erros as Array<{ campo: string }>).map((e) => e.campo);
    expect(campos).toEqual(expect.arrayContaining(['itens[0].icms', 'pagamentos']));
    expect((await cli(['validar', venda('ok.json')])).saida).toMatchObject({ ok: true, completo: true });
  });

  it('emitir: autoriza, salva XML e DANFCE; a mesma referência devolve a mesma nota', async () => {
    escreverConfig();
    const a = await cli(['emitir', venda('v.json'), '--referencia', 'venda-1']);
    expect(a.codigo).toBe(0);
    expect(a.saida).toMatchObject({ ok: true, status: 'autorizada', numero: 1, cStat: '100', ambiente: 'homologacao' });
    const arquivos = a.saida.arquivos as { xml: string; danfce: string };
    expect(readFileSync(join(dir, arquivos.danfce)).subarray(0, 4).toString()).toBe('%PDF');
    expect(readFileSync(join(dir, arquivos.xml), 'utf8')).toContain('<nfeProc');
    const b = await cli(['emitir', 'v.json', '--referencia', 'venda-1']);
    expect(b.saida.chave).toBe(a.saida.chave);
    expect(sefaz.autorizadas.size).toBe(1);
    const c = await cli(['emitir', 'v.json', '--referencia', 'venda-2']);
    expect(c.saida.numero).toBe(2);
    expect(JSON.stringify([a, b, c])).not.toContain(SENHA);
  });

  it('rejeição → saída 2 com dica; reemitir mantém o número', async () => {
    escreverConfig();
    sefaz.roteiro = ['rejeita'];
    const r = await cli(['emitir', venda('v.json'), '--referencia', 'v9']);
    expect(r.codigo).toBe(2);
    expect(r.saida).toMatchObject({ ok: false, status: 'rejeitada', cStat: '778' });
    expect(String(r.saida.dica)).toContain('NCM');
    const re = await cli(['reemitir', String(r.saida.chave), 'v.json']);
    expect(re.saida).toMatchObject({ status: 'autorizada', numero: r.saida.numero });
  });

  it('incerto → saída 3 (pendente) e pendentes --processar conclui a MESMA chave', async () => {
    escreverConfig({ contingenciaAutomatica: false });
    sefaz.roteiro = ['fora', 'fora', 'fora'];
    const r = await cli(['emitir', venda('v.json'), '--referencia', 'v3']);
    expect(r.codigo).toBe(3);
    expect(r.saida.chave).toMatch(/^\d{44}$/);
    expect(String(r.saida.dica)).toContain('pendentes --processar');
    const lista = await cli(['pendentes']);
    expect(lista.saida.total).toBe(1);
    const p = await cli(['pendentes', '--processar']);
    expect(p.codigo).toBe(0);
    expect((p.saida.notas as Array<{ chave: string; status: string }>)[0]).toMatchObject({ chave: r.saida.chave, status: 'autorizada' });
  });

  it('falha certa com contingência automática → contingencia (saída 0) com DANFCE', async () => {
    escreverConfig();
    sefaz.roteiro = ['recusada', 'recusada', 'recusada'];
    const r = await cli(['emitir', venda('v.json'), '--referencia', 'v4']);
    expect(r).toMatchObject({ codigo: 0, saida: { status: 'contingencia' } });
    expect(String(r.saida.chave)[34]).toBe('9');
    expect((r.saida.arquivos as { danfce: string }).danfce).toBeDefined();
  });

  it('produção exige --producao; --producao em homologação é recusado', async () => {
    escreverConfig({ ambiente: 'producao' });
    const r = await cli(['emitir', venda('v.json'), '--referencia', 'p1']);
    expect(r).toMatchObject({ codigo: 5, saida: { codigo: 'CONFIRMAR_PRODUCAO' } });
    expect(sefaz.chamadas).toHaveLength(0);
    escreverConfig();
    expect((await cli(['emitir', 'v.json', '--referencia', 'p1', '--producao'])).saida.codigo).toBe('AMBIENTE_DIVERGENTE');
  });

  it('cancelar, consultar, inutilizar, buracos, danfce e status', async () => {
    escreverConfig();
    const e = await cli(['emitir', venda('v.json'), '--referencia', 'c1']);
    const chave = String(e.saida.chave);
    expect((await cli(['cancelar', chave, '--justificativa', 'curta'])).codigo).toBe(5);
    const c = await cli(['cancelar', chave, '--justificativa', 'Cliente desistiu da compra no caixa']);
    expect(c).toMatchObject({ codigo: 0, saida: { ok: true, cStat: '135' } });
    expect((await cli(['consultar', chave])).saida).toMatchObject({ situacao: 'autorizada', registroLocal: { situacao: 'cancelada' } });
    expect((await cli(['consultar', '123'])).codigo).toBe(5);
    const i = await cli(['inutilizar', '--inicio', '5', '--fim', '6', '--justificativa', 'Falha no sistema pulou a numeracao']);
    expect(i).toMatchObject({ codigo: 0, saida: { ok: true, inicio: 5, fim: 6 } });
    expect((await cli(['buracos', '--ate', '7'])).saida.numeros).toEqual([2, 3, 4, 7]);
    const d = await cli(['danfce', chave, '--html']);
    expect(readFileSync(join(dir, String(d.saida.arquivo)), 'utf8')).toContain('DANFE NFC-e');
    expect((await cli(['status'])).saida).toMatchObject({ ok: true, cStat: '107' });
  });

  it('contingência manual offline e EPEC (SP)', async () => {
    escreverConfig();
    const off = await cli(['contingencia', 'offline', venda('v.json'), '--referencia', 'o1']);
    expect(off.saida).toMatchObject({ status: 'contingencia' });
    expect((await cli(['contingencia', 'xyz', 'v.json'])).codigo).toBe(5);
  });

  it('previa monta sem enviar', async () => {
    escreverConfig();
    const p = await cli(['previa', venda('v.json')]);
    expect(p.saida).toMatchObject({ ok: true, total: 11 });
    expect(sefaz.chamadas).toHaveLength(0);
    expect(readFileSync(join(dir, String(p.saida.arquivo)), 'utf8')).toContain('<Signature');
  });

  it('skill instalar copia a Skill', async () => {
    const r = await cli(['skill', 'instalar']);
    expect(r.codigo).toBe(0);
    expect(readFileSync(join(dir, '.claude/skills/nfce/SKILL.md'), 'utf8')).toContain('name: nfce');
    expect((await cli(['skill', 'instalar'])).codigo).toBe(5);
  });
});
