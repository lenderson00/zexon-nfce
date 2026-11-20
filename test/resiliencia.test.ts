import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { NfceClient, type NfceClientConfig } from '../src/client/NfceClient.js';
import { MemoryStorage } from '../src/storage/index.js';
import { PostgresNumerador, PostgresRegistro, criarTabelas } from '../src/postgres/index.js';
import { NfceError, TransportError, ValidationError } from '../src/errors/index.js';
import { gerarPfxTeste, notaExemplo } from './helpers.js';
import type { NotaNfce } from '../src/types.js';

type Comportamento = 'ok' | 'fora' | 'recusada' | 'perdeResposta' | 'rejeita';
const NS = 'xmlns="http://www.portalfiscal.inf.br/nfe"';
const soap = (x: string) => `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg>${x}</nfeResultMsg></soap:Body></soap:Envelope>`;
const prot = (chave: string, cStat: string, xMotivo: string) =>
  `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>${chave}</chNFe><dhRecbto>2026-11-20T10:00:05-03:00</dhRecbto>${cStat === '100' ? `<nProt>1352600000${chave.slice(-5)}</nProt>` : ''}<cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protNFe>`;

/** SEFAZ simulada com estado: autoriza por chave, detecta número repetido (539) e duplicidade (204). */
class SefazFake {
  autorizadas = new Map<string, string>(); // chave -> "cnpj|serie|numero"
  canceladas = new Set<string>();
  enviosAutorizacao = 0;
  rejeicoes539 = 0;
  consultaFora = false;
  constructor(public roteiro: Comportamento[] = [], public relogio: () => Date = () => new Date()) {}

  fetchImpl = async (url: string, env: string): Promise<string> => {
    if (url.includes('Autorizacao4')) {
      this.enviosAutorizacao++;
      const comp = this.roteiro.shift() ?? 'ok';
      if (comp === 'fora') throw new TransportError('ECONNRESET');
      if (comp === 'recusada') throw new TransportError('connect ECONNREFUSED', undefined, { naoRecebido: true });
      const chave = /Id="NFe(\d{44})"/.exec(env)![1]!;
      const num = `${chave.slice(6, 20)}|${chave.slice(22, 25)}|${chave.slice(25, 34)}`;
      const dhEmi = Date.parse(/<dhEmi>([^<]+)<\/dhEmi>/.exec(env)![1]!);
      const atrasada = chave[34] === '1' && this.relogio().getTime() - dhEmi > 5 * 60000; // B09-40
      let r: string;
      if (this.autorizadas.has(chave)) r = prot(chave, '204', 'Rejeicao: Duplicidade de NF-e');
      else if ([...this.autorizadas.values()].includes(num)) { this.rejeicoes539++; r = prot(chave, '539', 'Rejeicao: Duplicidade de NF-e com diferenca na Chave de Acesso'); }
      else if (atrasada) r = prot(chave, '704', 'Rejeicao: NFC-e com Data-Hora de emissao atrasada');
      else if (comp === 'rejeita') r = prot(chave, '778', 'Rejeicao: Informado NCM inexistente');
      else { this.autorizadas.set(chave, num); r = prot(chave, '100', 'Autorizado o uso da NF-e'); }
      if (comp === 'perdeResposta') throw new TransportError('timeout após 30000ms');
      return soap(`<retEnviNFe versao="4.00" ${NS}><cStat>104</cStat><xMotivo>Lote processado</xMotivo>${r}</retEnviNFe>`);
    }
    if (url.includes('ConsultaProtocolo')) {
      if (this.consultaFora) throw new TransportError('sem rota');
      const chave = /<chNFe>(\d{44})<\/chNFe>/.exec(env)![1]!;
      if (!this.autorizadas.has(chave)) return soap(`<retConsSitNFe versao="4.00" ${NS}><cStat>217</cStat><xMotivo>Rejeicao: NF-e nao consta na base</xMotivo></retConsSitNFe>`);
      if (this.canceladas.has(chave)) return soap(`<retConsSitNFe versao="4.00" ${NS}><cStat>101</cStat><xMotivo>Cancelamento de NF-e homologado</xMotivo>${prot(chave, '100', 'Autorizado o uso da NF-e')}</retConsSitNFe>`);
      return soap(`<retConsSitNFe versao="4.00" ${NS}><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo>${prot(chave, '100', 'Autorizado o uso da NF-e')}</retConsSitNFe>`);
    }
    if (url.includes('recepcaoevento') || url.includes('RecepcaoEvento')) {
      const chave = /<chNFe>(\d{44})<\/chNFe>/.exec(env)![1]!;
      const ok = this.autorizadas.has(chave);
      if (ok) this.canceladas.add(chave);
      return soap(`<retEnvEvento versao="1.00" ${NS}><cStat>128</cStat><xMotivo>Lote processado</xMotivo><retEvento versao="1.00"><infEvento><cStat>${ok ? '135' : '217'}</cStat><xMotivo>${ok ? 'Evento registrado e vinculado a NF-e' : 'Rejeicao: NF-e nao consta na base'}</xMotivo><chNFe>${chave}</chNFe><tpEvento>110111</tpEvento>${ok ? '<nProt>135260000009999</nProt>' : ''}</infEvento></retEvento></retEnvEvento>`);
    }
    if (url.toLowerCase().includes('inutilizacao')) {
      return soap(`<retInutNFe versao="4.00" ${NS}><infInut><cStat>102</cStat><xMotivo>Inutilizacao de numero homologado</xMotivo><nProt>135260000007777</nProt></infInut></retInutNFe>`);
    }
    throw new Error('serviço inesperado ' + url);
  };
}

let pfx: { pfx: Buffer; senha: string };
beforeAll(() => { pfx = gerarPfxTeste(); });

let db: PGlite;
let storage: MemoryStorage;
let agora: Date;
const relogio = () => agora;
const avancar = (min: number) => { agora = new Date(agora.getTime() + min * 60000); };
beforeEach(async () => {
  db = new PGlite();
  await criarTabelas(db);
  storage = new MemoryStorage();
  agora = new Date('2026-11-20T13:00:00Z');
});

const cliente = (sefaz: SefazFake, extra: Partial<NfceClientConfig> = {}) => new NfceClient({
  uf: 'SP', ambiente: 'homologacao', certificado: pfx, csc: { id: 1, codigo: 'CSC-TESTE-0123456789' },
  storage, registro: new PostgresRegistro(db), numerador: new PostgresNumerador(db),
  transporte: { fetchImpl: sefaz.fetchImpl }, retentativas: { tentativas: 3, esperasMs: [0] }, relogio, ...extra,
});
/** Nota sem número e sem data (usa o numerador e o relógio do cliente). */
const semNumero = (over: Partial<NotaNfce> = {}): NotaNfce => { const n = notaExemplo(over); delete n.numero; delete n.emissao; return n; };
const novaSefaz = (roteiro: Comportamento[] = []) => new SefazFake(roteiro, relogio);
const registro = () => new PostgresRegistro(db);

describe('emissão resiliente', () => {
  it('resposta perdida + processo reiniciado: recupera a MESMA chave, sem nota em dobro', async () => {
    const sefaz = novaSefaz(['perdeResposta', 'fora', 'fora']);
    sefaz.consultaFora = true;
    const err = await cliente(sefaz).emitir(semNumero(), { referencia: 'pedido-1' }).catch((e) => e);
    expect(err).toBeInstanceOf(NfceError);
    expect(err.retentavel).toBe(true);
    expect(err.chave).toMatch(/^\d{44}$/);
    expect(await registro().buscar(err.chave)).toMatchObject({ situacao: 'pendente', tentativas: 3, numero: 1 });
    expect(await storage.listar('pendentes')).toEqual([err.chave]);

    // "reinício": novo cliente, SEFAZ normalizada
    sefaz.consultaFora = false;
    const [r] = await cliente(sefaz).processarPendentes();
    expect(r).toMatchObject({ status: 'autorizada', chave: err.chave });
    expect(sefaz.autorizadas.size).toBe(1);
    expect(await registro().buscar(err.chave)).toMatchObject({ situacao: 'autorizada', protocolo: expect.any(String) });
    expect(await storage.listar('pendentes')).toEqual([]);
    expect(await storage.ler('autorizadas', err.chave)).toContain('<nfeProc');
  });

  it('mesma referência duas vezes: uma única nota e um único número', async () => {
    const sefaz = novaSefaz();
    const c = cliente(sefaz);
    const a = await c.emitir(semNumero(), { referencia: 'pedido-7' });
    const b = await c.emitir(semNumero(), { referencia: 'pedido-7' });
    expect(b.chave).toBe(a.chave);
    expect(b.status).toBe('autorizada');
    expect(b.xmlAutorizado).toContain('<protNFe');
    expect(sefaz.enviosAutorizacao).toBe(1);
    expect(await new PostgresNumerador(db).ultimo({ cnpj: '11222333000181', ambiente: 'homologacao', modelo: 65, serie: 1 })).toBe(1);
  });

  it('mesma referência em paralelo: uma nota; o número gasto vira buraco detectável', async () => {
    const sefaz = novaSefaz();
    const c = cliente(sefaz);
    const [a, b] = await Promise.all([c.emitir(semNumero(), { referencia: 'pedido-9' }), c.emitir(semNumero(), { referencia: 'pedido-9' })]);
    expect(a.chave).toBe(b.chave);
    expect(sefaz.autorizadas.size).toBe(1);
    const buracos = await registro().buracos({ cnpj: '11222333000181', ambiente: 'homologacao', serie: 1 });
    expect(sefaz.enviosAutorizacao).toBe(1);
    expect(buracos).toEqual([2]); // número reservado pela requisição repetida: inutilizar ou reaproveitar
  });

  it('falhas temporárias seguidas de sucesso: autorizada na 3ª tentativa', async () => {
    const sefaz = novaSefaz(['fora', 'fora', 'ok']);
    const r = await cliente(sefaz).emitir(semNumero());
    expect(r).toMatchObject({ status: 'autorizada', tentativas: 3 });
    expect(await registro().buscar(r.chave)).toMatchObject({ situacao: 'autorizada', tentativas: 3 });
  });

  it('rejeição + reemitir: mesmo número, nova chave, referência transferida', async () => {
    const sefaz = novaSefaz(['rejeita']);
    const c = cliente(sefaz);
    const r1 = await c.emitir(semNumero(), { referencia: 'pedido-2' });
    expect(r1).toMatchObject({ status: 'rejeitada', cStat: '778' });
    expect(await storage.listar('rejeitadas')).toEqual([r1.chave]);
    // repetir emitir com a mesma referência devolve a rejeição (não cria outra nota)
    expect((await c.emitir(semNumero(), { referencia: 'pedido-2' })).chave).toBe(r1.chave);

    const r2 = await c.reemitir(r1.chave, semNumero());
    expect(r2).toMatchObject({ status: 'autorizada', numero: r1.numero, serie: r1.serie });
    expect(r2.chave).not.toBe(r1.chave);
    expect((await registro().buscarPorReferencia('11222333000181', 'homologacao', 'pedido-2'))?.chave).toBe(r2.chave);
    expect(await registro().buracos({ cnpj: '11222333000181', ambiente: 'homologacao', serie: 1 })).toEqual([]);
    await expect(c.reemitir(r2.chave, semNumero())).rejects.toBeInstanceOf(ValidationError);
    // reemitir de novo a chave rejeitada antiga não pode criar uma terceira nota no mesmo número
    const envios = sefaz.enviosAutorizacao;
    await expect(c.reemitir(r1.chave, semNumero())).rejects.toThrow(/já está ocupado/);
    expect(sefaz.enviosAutorizacao).toBe(envios);
  });

  it('contingência automática NÃO cria segunda nota quando o recebimento é incerto', async () => {
    const sefaz = novaSefaz(['perdeResposta', 'fora', 'fora']);
    sefaz.consultaFora = true;
    const err = await cliente(sefaz, { contingenciaAutomatica: true }).emitir(semNumero(), { referencia: 'pedido-3' }).catch((e) => e);
    expect(err).toBeInstanceOf(NfceError);
    expect(err).toMatchObject({ retentavel: true, naoRecebido: false });
    expect(await storage.listar('contingencia')).toEqual([]); // nenhuma nota tpEmis=9
    expect(await registro().buscar(err.chave)).toMatchObject({ situacao: 'pendente', tpEmis: 1, numero: 1 });

    sefaz.consultaFora = false;
    const [r] = await cliente(sefaz).processarPendentes();
    expect(r).toMatchObject({ status: 'autorizada', chave: err.chave });
    expect(sefaz.autorizadas.size).toBe(1);
    expect(sefaz.rejeicoes539).toBe(0);
  });

  it('falha certa (conexão recusada): contingência automática com o MESMO número; a chave online é descartada', async () => {
    const sefaz = novaSefaz(['recusada', 'recusada', 'recusada']);
    const off = await cliente(sefaz, { contingenciaAutomatica: true }).emitir(semNumero(), { referencia: 'pedido-4' });
    expect(off).toMatchObject({ status: 'contingencia', numero: 1 });
    expect(off.xmlAssinado).toContain('<tpEmis>9</tpEmis>');
    const offReg = await registro().buscar(off.chave);
    expect(offReg).toMatchObject({ situacao: 'contingencia', referencia: 'pedido-4', numero: 1 });
    expect(await registro().buscar(offReg!.chaveOriginal!)).toMatchObject({ situacao: 'descartada', referencia: null });
    expect(await storage.listar('substituidas')).toEqual([offReg!.chaveOriginal]);

    const [r] = await cliente(sefaz).contingencia.transmitirPendentes();
    expect(r).toMatchObject({ status: 'autorizada', chave: off.chave });
    expect(sefaz.autorizadas.size).toBe(1);
    expect(sefaz.rejeicoes539).toBe(0);
    expect(await registro().buracos({ cnpj: '11222333000181', ambiente: 'homologacao', serie: 1 })).toEqual([]);
  });

  it('emitirOffline manual (sem tentativa online) e idempotência por referência', async () => {
    const sefaz = novaSefaz();
    const c = cliente(sefaz);
    const off = await c.contingencia.emitirOffline(semNumero(), 'SEFAZ fora do ar (status 108)', { referencia: 'pedido-5' });
    expect(off.status).toBe('contingencia');
    expect((await c.contingencia.emitirOffline(semNumero(), 'x', { referencia: 'pedido-5' })).chave).toBe(off.chave);
    expect(sefaz.enviosAutorizacao).toBe(0);
    const [r] = await c.processarPendentes();
    expect(r).toMatchObject({ status: 'autorizada', chave: off.chave, prazo: { situacao: 'ok' } });
  });

  it('substituirPendente + original autorizada às escondidas → conflito; cancelar resolve', async () => {
    const sefaz = novaSefaz(['perdeResposta', 'fora', 'fora']);
    sefaz.consultaFora = true;
    const c = cliente(sefaz);
    const err = await c.emitir(semNumero(), { referencia: 'pedido-6' }).catch((e) => e);
    const off = await c.contingencia.substituirPendente(err.chave, semNumero());
    expect(off).toMatchObject({ status: 'contingencia', numero: 2 }); // número novo
    expect(await registro().buscar(err.chave)).toMatchObject({ situacao: 'substituida', referencia: null });
    expect((await registro().buscar(off.chave))?.referencia).toBe('pedido-6');

    sefaz.consultaFora = false;
    const out = await cliente(sefaz).processarPendentes();
    const original = out.find((x) => x.chave === err.chave)!;
    const offline = out.find((x) => x.chave === off.chave)!;
    expect(offline.status).toBe('autorizada'); // o cupom do consumidor é sempre transmitido
    expect(original.status).toBe('conflito'); // a original apareceu autorizada: duas notas para a venda
    expect(sefaz.rejeicoes539).toBe(0);
    expect(sefaz.enviosAutorizacao).toBe(4); // 3 tentativas da original + 1 da contingência; a original nunca é reenviada

    const canc = await cliente(sefaz).cancelar({ chave: err.chave, protocolo: original.protocolo!, justificativa: 'Venda coberta pela NFC-e de contingencia' });
    expect(canc.sucesso).toBe(true);
    expect(await registro().buscar(err.chave)).toMatchObject({ situacao: 'cancelada', protocoloCancelamento: '135260000009999' });
  });

  it('substituirPendente + original nunca recebida → descartada após a janela de 5 min; número vira buraco', async () => {
    const sefaz = novaSefaz(['fora', 'fora', 'fora']);
    sefaz.consultaFora = true;
    const c = cliente(sefaz);
    const err = await c.emitir(semNumero()).catch((e) => e);
    await c.contingencia.substituirPendente(err.chave, semNumero());
    sefaz.consultaFora = false;

    // ainda dentro da janela: aguarda
    let out = await cliente(sefaz).processarPendentes();
    expect(out.find((x) => x.chave === err.chave)?.status).toBe('pendente');
    avancar(11);
    out = await cliente(sefaz).processarPendentes();
    expect(out.find((x) => x.chave === err.chave)?.status).toBe('descartada');
    expect(await registro().buracos({ cnpj: '11222333000181', ambiente: 'homologacao', serie: 1 })).toEqual([1]);
    await cliente(sefaz).inutilizar({ serie: 1, numeroInicial: 1, justificativa: 'Numero de nota descartada nao utilizado' });
    expect(await registro().buracos({ cnpj: '11222333000181', ambiente: 'homologacao', serie: 1 })).toEqual([]);
  });

  it('pendente reenviada depois de 5 min é rejeitada (704) e reemitida com o mesmo número', async () => {
    const sefaz = novaSefaz(['fora', 'fora', 'fora']);
    sefaz.consultaFora = true;
    const err = await cliente(sefaz).emitir(semNumero(), { referencia: 'pedido-8' }).catch((e) => e);
    sefaz.consultaFora = false;
    avancar(30);
    const [r] = await cliente(sefaz).processarPendentes();
    expect(r).toMatchObject({ status: 'rejeitada', cStat: '704', chave: err.chave });
    const r2 = await cliente(sefaz).reemitir(err.chave, semNumero());
    expect(r2).toMatchObject({ status: 'autorizada', numero: 1 });
  });

  it('prazo da contingência: alerta e vencido são sinalizados, e a transmissão ainda é tentada', async () => {
    const sefaz = novaSefaz();
    sefaz.consultaFora = true;
    const c = cliente(sefaz);
    await c.contingencia.emitirOffline(semNumero());
    avancar(19 * 60);
    let [r] = await c.processarPendentes();
    expect(r).toMatchObject({ status: 'contingencia', prazo: { situacao: 'alerta' } });
    expect(r!.xMotivo).toMatch(/PRAZO ALERTA/);
    avancar(6 * 60);
    [r] = await c.processarPendentes();
    expect(r!.prazo).toMatchObject({ situacao: 'vencido', horasDesdeEmissao: 25 });
    sefaz.consultaFora = false;
    [r] = await c.processarPendentes();
    expect(r).toMatchObject({ status: 'autorizada' }); // tentou mesmo vencida
  });

  it('cancelamento atualiza o registro e a idempotência devolve cancelada', async () => {
    const sefaz = novaSefaz();
    const c = cliente(sefaz);
    const r = await c.emitir(semNumero(), { referencia: 'pedido-10' });
    await c.cancelar({ chave: r.chave, protocolo: r.protocolo!, justificativa: 'Cliente desistiu da compra' });
    expect(await registro().buscar(r.chave)).toMatchObject({ situacao: 'cancelada' });
    expect((await c.emitir(semNumero(), { referencia: 'pedido-10' })).status).toBe('cancelada');
  });

  it('processarPendentes não lança: devolve o erro de cada nota', async () => {
    const sefaz = novaSefaz(['fora', 'fora', 'fora']);
    sefaz.consultaFora = true;
    const c = cliente(sefaz);
    const e = await c.emitir(semNumero()).catch((x) => x);
    const out = await c.processarPendentes();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ status: 'pendente', chave: e.chave });
    expect(out[0]!.xMotivo).toMatch(/sem rota|ECONNRESET/);
  });

  it('sem número e sem numerador: erro de validação; registro exige storage', async () => {
    const sefaz = novaSefaz();
    await expect(cliente(sefaz, { numerador: undefined }).emitir(semNumero())).rejects.toBeInstanceOf(ValidationError);
    expect(() => cliente(sefaz, { storage: undefined })).toThrow(/requer `storage`/);
  });

  it('modo só storage (sem registro): também recupera a nota pendente', async () => {
    const sefaz = novaSefaz(['perdeResposta', 'fora', 'fora']);
    sefaz.consultaFora = true;
    const e = await cliente(sefaz, { registro: undefined }).emitir(notaExemplo()).catch((x) => x);
    expect(await storage.listar('pendentes')).toEqual([e.chave]);
    sefaz.consultaFora = false;
    const [r] = await cliente(sefaz, { registro: undefined }).processarPendentes();
    expect(r).toMatchObject({ status: 'autorizada', chave: e.chave });
  });
});
