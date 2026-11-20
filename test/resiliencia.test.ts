import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { NfceClient, type NfceClientConfig } from '../src/client/NfceClient.js';
import { MemoryStorage } from '../src/storage/index.js';
import { PostgresNumerador, PostgresRegistro, criarTabelas } from '../src/postgres/index.js';
import { NfceError, TransportError, ValidationError } from '../src/errors/index.js';
import { gerarPfxTeste, notaExemplo } from './helpers.js';
import type { NotaNfce } from '../src/types.js';

type Comportamento = 'ok' | 'fora' | 'perdeResposta' | 'rejeita';
const NS = 'xmlns="http://www.portalfiscal.inf.br/nfe"';
const soap = (x: string) => `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg>${x}</nfeResultMsg></soap:Body></soap:Envelope>`;
const prot = (chave: string, cStat: string, xMotivo: string) =>
  `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>${chave}</chNFe><dhRecbto>2026-11-20T10:00:05-03:00</dhRecbto>${cStat === '100' ? `<nProt>1352600000${chave.slice(-5)}</nProt>` : ''}<cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protNFe>`;

/** SEFAZ simulada com estado: autoriza por chave, detecta número repetido (539) e duplicidade (204). */
class SefazFake {
  autorizadas = new Map<string, string>(); // chave -> "cnpj|serie|numero"
  enviosAutorizacao = 0;
  consultaFora = false;
  constructor(public roteiro: Comportamento[] = []) {}

  fetchImpl = async (url: string, env: string): Promise<string> => {
    if (url.includes('Autorizacao4')) {
      this.enviosAutorizacao++;
      const comp = this.roteiro.shift() ?? 'ok';
      if (comp === 'fora') throw new TransportError('ECONNRESET');
      const chave = /Id="NFe(\d{44})"/.exec(env)![1]!;
      const num = `${chave.slice(6, 20)}|${chave.slice(22, 25)}|${chave.slice(25, 34)}`;
      let r: string;
      if (this.autorizadas.has(chave)) r = prot(chave, '204', 'Rejeicao: Duplicidade de NF-e');
      else if ([...this.autorizadas.values()].includes(num)) r = prot(chave, '539', 'Rejeicao: Duplicidade de NF-e com diferenca na Chave de Acesso');
      else if (comp === 'rejeita') r = prot(chave, '778', 'Rejeicao: Informado NCM inexistente');
      else { this.autorizadas.set(chave, num); r = prot(chave, '100', 'Autorizado o uso da NF-e'); }
      if (comp === 'perdeResposta') throw new TransportError('timeout após 30000ms');
      return soap(`<retEnviNFe versao="4.00" ${NS}><cStat>104</cStat><xMotivo>Lote processado</xMotivo>${r}</retEnviNFe>`);
    }
    if (url.includes('ConsultaProtocolo')) {
      if (this.consultaFora) throw new TransportError('sem rota');
      const chave = /<chNFe>(\d{44})<\/chNFe>/.exec(env)![1]!;
      if (!this.autorizadas.has(chave)) return soap(`<retConsSitNFe versao="4.00" ${NS}><cStat>217</cStat><xMotivo>Rejeicao: NF-e nao consta na base</xMotivo></retConsSitNFe>`);
      return soap(`<retConsSitNFe versao="4.00" ${NS}><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo>${prot(chave, '100', 'Autorizado o uso da NF-e')}</retConsSitNFe>`);
    }
    throw new Error('serviço inesperado ' + url);
  };
}

let pfx: { pfx: Buffer; senha: string };
beforeAll(() => { pfx = gerarPfxTeste(); });

let db: PGlite;
let storage: MemoryStorage;
beforeEach(async () => {
  db = new PGlite();
  await criarTabelas(db);
  storage = new MemoryStorage();
});

const cliente = (sefaz: SefazFake, extra: Partial<NfceClientConfig> = {}) => new NfceClient({
  uf: 'SP', ambiente: 'homologacao', certificado: pfx, csc: { id: 1, codigo: 'CSC-TESTE-0123456789' },
  storage, registro: new PostgresRegistro(db), numerador: new PostgresNumerador(db),
  transporte: { fetchImpl: sefaz.fetchImpl }, retentativas: { tentativas: 3, esperasMs: [0] }, ...extra,
});
const semNumero = (over: Partial<NotaNfce> = {}): NotaNfce => { const n = notaExemplo(over); delete n.numero; return n; };
const registro = () => new PostgresRegistro(db);

describe('emissão resiliente', () => {
  it('resposta perdida + processo reiniciado: recupera a MESMA chave, sem nota em dobro', async () => {
    const sefaz = new SefazFake(['perdeResposta', 'fora', 'fora']);
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
    const sefaz = new SefazFake();
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
    const sefaz = new SefazFake();
    const c = cliente(sefaz);
    const [a, b] = await Promise.all([c.emitir(semNumero(), { referencia: 'pedido-9' }), c.emitir(semNumero(), { referencia: 'pedido-9' })]);
    expect(a.chave).toBe(b.chave);
    expect(sefaz.autorizadas.size).toBe(1);
    const buracos = await registro().buracos({ cnpj: '11222333000181', ambiente: 'homologacao', serie: 1 });
    expect(sefaz.enviosAutorizacao).toBe(1);
    expect(buracos).toEqual([2]); // número reservado pela requisição repetida: inutilizar ou reaproveitar
  });

  it('falhas temporárias seguidas de sucesso: autorizada na 3ª tentativa', async () => {
    const sefaz = new SefazFake(['fora', 'fora', 'ok']);
    const r = await cliente(sefaz).emitir(semNumero());
    expect(r).toMatchObject({ status: 'autorizada', tentativas: 3 });
    expect(await registro().buscar(r.chave)).toMatchObject({ situacao: 'autorizada', tentativas: 3 });
  });

  it('rejeição + reemitir: mesmo número, nova chave, referência transferida', async () => {
    const sefaz = new SefazFake(['rejeita']);
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
  });

  it('contingência: original autorizada às escondidas vira conflito (não transmite a cópia)', async () => {
    const sefaz = new SefazFake(['perdeResposta', 'fora', 'fora']);
    sefaz.consultaFora = true;
    const off = await cliente(sefaz, { contingenciaAutomatica: true }).emitir(semNumero(), { referencia: 'pedido-3' });
    expect(off).toMatchObject({ status: 'contingencia', numero: 1 });
    const offReg = await registro().buscar(off.chave);
    expect(offReg).toMatchObject({ situacao: 'contingencia', tpEmis: 9, referencia: 'pedido-3' });
    const original = offReg!.chaveOriginal!;
    expect(await registro().buscar(original)).toMatchObject({ situacao: 'substituida', referencia: null });
    expect(await storage.listar('substituidas')).toEqual([original]);

    sefaz.consultaFora = false;
    const [r] = await cliente(sefaz).processarPendentes();
    expect(r).toMatchObject({ status: 'conflito', chave: off.chave });
    expect(sefaz.autorizadas.size).toBe(1); // a cópia offline não foi enviada
    expect(await registro().buscar(original)).toMatchObject({ situacao: 'autorizada' });
    expect(await storage.ler('autorizadas', original)).toContain('<nfeProc');
    expect(await registro().buscar(off.chave)).toMatchObject({ situacao: 'conflito' });
  });

  it('contingência normal: SEFAZ fora o tempo todo, depois transmite a nota offline', async () => {
    const sefaz = new SefazFake(['fora', 'fora', 'fora']);
    sefaz.consultaFora = true;
    const off = await cliente(sefaz, { contingenciaAutomatica: true }).emitir(semNumero());
    expect(off.status).toBe('contingencia');
    sefaz.consultaFora = false;
    const [r] = await cliente(sefaz).contingencia.transmitirPendentes();
    expect(r).toMatchObject({ status: 'autorizada', chave: off.chave });
    expect(await registro().buscar(off.chave)).toMatchObject({ situacao: 'autorizada' });
  });

  it('processarPendentes não lança: devolve o erro de cada nota', async () => {
    const sefaz = new SefazFake(['fora', 'fora', 'fora']);
    sefaz.consultaFora = true;
    const c = cliente(sefaz);
    const e = await c.emitir(semNumero()).catch((x) => x);
    const out = await c.processarPendentes();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ status: 'pendente', chave: e.chave });
    expect(out[0]!.xMotivo).toMatch(/sem rota|ECONNRESET/);
  });

  it('sem número e sem numerador: erro de validação; registro exige storage', async () => {
    const sefaz = new SefazFake();
    await expect(cliente(sefaz, { numerador: undefined }).emitir(semNumero())).rejects.toBeInstanceOf(ValidationError);
    expect(() => cliente(sefaz, { storage: undefined })).toThrow(/requer `storage`/);
  });

  it('modo só storage (sem registro): também recupera a nota pendente', async () => {
    const sefaz = new SefazFake(['perdeResposta', 'fora', 'fora']);
    sefaz.consultaFora = true;
    const e = await cliente(sefaz, { registro: undefined }).emitir(notaExemplo()).catch((x) => x);
    expect(await storage.listar('pendentes')).toEqual([e.chave]);
    sefaz.consultaFora = false;
    const [r] = await cliente(sefaz, { registro: undefined }).processarPendentes();
    expect(r).toMatchObject({ status: 'autorizada', chave: e.chave });
  });
});
