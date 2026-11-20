import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { NfceClient, type NfceClientConfig } from '../src/client/NfceClient.js';
import { MemoryStorage } from '../src/storage/index.js';
import { PostgresNumerador, PostgresRegistro, criarTabelas } from '../src/postgres/index.js';
import { NfceError, SefazError, TransportError } from '../src/errors/index.js';
import { gerarPfxTeste, notaExemplo } from './helpers.js';
import type { NotaNfce } from '../src/types.js';

const NS = 'xmlns="http://www.portalfiscal.inf.br/nfe"';
const soap = (x: string) => `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg>${x}</nfeResultMsg></soap:Body></soap:Envelope>`;
const prot = (chave: string) =>
  `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>${chave}</chNFe><dhRecbto>2026-11-20T10:00:05-03:00</dhRecbto><nProt>1352600000${chave.slice(-5)}</nProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>`;

/** SEFAZ-SP simulada: ambiente normal + EPEC (NT 2014.003). */
class SefazSp {
  epecs: string[] = [];
  autorizadas = new Set<string>();
  envelopesEpec: string[] = [];
  /** Roteiro do EPEC: 'ok' | 'rejeita' (142 bloqueado) | 'fora' (falha de rede). */
  roteiroEpec: Array<'ok' | 'rejeita' | 'fora'> = [];
  fetchImpl = async (url: string, env: string): Promise<string> => {
    if (url.includes('EPECws/RecepcaoEPEC')) {
      this.envelopesEpec.push(env);
      const comp = this.roteiroEpec.shift() ?? 'ok';
      if (comp === 'fora') throw new TransportError('ECONNRESET');
      const chave = /<chNFe>(\d{44})<\/chNFe>/.exec(env)![1]!;
      if (comp === 'rejeita') {
        return soap(`<retEnvEvento versao="1.00" ${NS}><idLote>1</idLote><cStat>128</cStat><xMotivo>Lote processado</xMotivo><retEvento versao="1.00"><infEvento><cStat>142</cStat><xMotivo>Rejeicao: Ambiente de Contingencia EPEC bloqueado para o Emitente</xMotivo><chNFe>${chave}</chNFe></infEvento></retEvento></retEnvEvento>`);
      }
      this.epecs.push(chave);
      return soap(`<retEnvEvento versao="1.00" ${NS}><idLote>1</idLote><cStat>128</cStat><xMotivo>Lote processado</xMotivo><retEvento versao="1.00"><infEvento><cStat>136</cStat><xMotivo>Evento registrado, mas nao vinculado a NFC-e</xMotivo><chNFe>${chave}</chNFe><tpEvento>110140</tpEvento><nProt>535260000000001</nProt></infEvento></retEvento></retEnvEvento>`);
    }
    if (url.includes('Autorizacao4')) {
      const chave = /Id="NFe(\d{44})"/.exec(env)![1]!;
      // 468: NFC-e tpEmis=4 sem EPEC correspondente
      if (chave[34] === '4' && !this.epecs.includes(chave)) {
        return soap(`<retEnviNFe versao="4.00" ${NS}><cStat>104</cStat><xMotivo>Lote processado</xMotivo><protNFe versao="4.00"><infProt><chNFe>${chave}</chNFe><cStat>468</cStat><xMotivo>Rejeicao: NFC-e com Tipo Emissao = 4, sem EPEC correspondente</xMotivo></infProt></protNFe></retEnviNFe>`);
      }
      this.autorizadas.add(chave);
      return soap(`<retEnviNFe versao="4.00" ${NS}><cStat>104</cStat><xMotivo>Lote processado</xMotivo>${prot(chave)}</retEnviNFe>`);
    }
    if (url.includes('ConsultaProtocolo')) {
      const chave = /<chNFe>(\d{44})<\/chNFe>/.exec(env)![1]!;
      if (this.autorizadas.has(chave)) return soap(`<retConsSitNFe versao="4.00" ${NS}><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo>${prot(chave)}</retConsSitNFe>`);
      if (this.epecs.includes(chave)) return soap(`<retConsSitNFe versao="4.00" ${NS}><cStat>124</cStat><xMotivo>EPEC Autorizado</xMotivo></retConsSitNFe>`);
      return soap(`<retConsSitNFe versao="4.00" ${NS}><cStat>217</cStat><xMotivo>Rejeicao: NF-e nao consta na base</xMotivo></retConsSitNFe>`);
    }
    throw new Error('serviço inesperado ' + url);
  };
}

let pfx: { pfx: Buffer; senha: string };
beforeAll(() => { pfx = gerarPfxTeste(); });
let db: PGlite;
let storage: MemoryStorage;
const agora = new Date('2026-11-20T13:00:00Z');
beforeEach(async () => {
  db = new PGlite();
  await criarTabelas(db);
  storage = new MemoryStorage();
});

const cliente = (sefaz: SefazSp, extra: Partial<NfceClientConfig> = {}) => new NfceClient({
  uf: 'SP', ambiente: 'homologacao', certificado: pfx, csc: { id: 1, codigo: 'CSC-TESTE-0123456789' },
  storage, registro: new PostgresRegistro(db), numerador: new PostgresNumerador(db),
  transporte: { fetchImpl: sefaz.fetchImpl }, retentativas: { tentativas: 1, esperasMs: [0] }, relogio: () => agora, ...extra,
});
const semNumero = (over: Partial<NotaNfce> = {}): NotaNfce => { const n = notaExemplo(over); delete n.numero; delete n.emissao; return n; };

describe('EPEC da NFC-e (SP) — NT 2014.003', () => {
  it('gera NFC-e tpEmis=4 com dhCont/xJust e registra o EPEC com o layout da NT', async () => {
    const sefaz = new SefazSp();
    const c = cliente(sefaz);
    const r = await c.contingencia.emitirEpec(semNumero(), 'Internet fora do ar na loja inteira', { referencia: 'v1' });

    expect(r.status).toBe('contingencia');
    expect(r.cStat).toBe('136');
    expect(r.protocoloEpec).toBe('535260000000001');
    expect(r.chave[34]).toBe('4'); // posição 35 = tpEmis
    expect(r.xmlAssinado).toContain('<tpEmis>4</tpEmis>');
    expect(r.xmlAssinado).toMatch(/<dhCont>[^<]+<\/dhCont><xJust>Internet fora do ar na loja inteira<\/xJust>/);
    // QR Code do EPEC segue o formato online (NT 2014.003 não prevê o formato offline)
    expect(r.qrCode).not.toContain('|9|');

    expect(sefaz.envelopesEpec).toHaveLength(1);
    const env = sefaz.envelopesEpec[0]!;
    expect(env).toContain('<soap12:Header><nfeCabecMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/RecepcaoEvento"><cUF>35</cUF><versaoDados>1.00</versaoDados></nfeCabecMsg></soap12:Header>');
    expect(env).toContain(`<infEvento Id="ID110140${r.chave}01">`);
    expect(env).toContain('<cOrgao>35</cOrgao><tpAmb>2</tpAmb><CNPJ>11222333000181</CNPJ>');
    expect(env).toContain('<tpEvento>110140</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento>');
    expect(env).toContain('<descEvento>EPEC</descEvento><cOrgaoAutor>35</cOrgaoAutor><tpAutor>1</tpAutor>');
    expect(env).toContain('<tpNF>1</tpNF><IE>110042490114</IE><dest><UF>SP</UF><CPF>52998224725</CPF></dest><vNF>');
    expect(env).toContain('<vICMS>0.00</vICMS>');
    expect(env).toContain('<Signature'); // assinado em infEvento
    // dhEmi do EPEC é idêntico ao da NFC-e (rejeição 467 se divergir)
    const dhEmi = /<dhEmi>([^<]+)<\/dhEmi>/.exec(r.xmlAssinado)![1];
    expect(env).toContain(`<dhEmi>${dhEmi}</dhEmi>`);

    expect(await c.protocoloEpec(r.chave)).toBe('535260000000001');
    const reg = await new PostgresRegistro(db).buscar(r.chave);
    expect(reg).toMatchObject({ tpEmis: 4, situacao: 'contingencia' });
  });

  it('processarPendentes transmite a MESMA NFC-e depois do EPEC e ela vira autorizada', async () => {
    const sefaz = new SefazSp();
    const c = cliente(sefaz);
    const epec = await c.contingencia.emitirEpec(semNumero(), 'Internet fora do ar na loja inteira');
    const [r] = await c.processarPendentes();
    expect(r).toMatchObject({ chave: epec.chave, status: 'autorizada', cStat: '100' });
    expect(sefaz.autorizadas.has(epec.chave)).toBe(true);
    expect(await new PostgresRegistro(db).buscar(epec.chave)).toMatchObject({ situacao: 'autorizada' });
  });

  it('EPEC rejeitado (ambiente bloqueado): nada fica autorizado, número e referência são liberados', async () => {
    const sefaz = new SefazSp();
    sefaz.roteiroEpec = ['rejeita'];
    const c = cliente(sefaz);
    const nota = semNumero();
    const falha = await c.contingencia.emitirEpec(nota, 'Internet fora do ar na loja inteira', { referencia: 'v2' }).catch((e) => e);
    expect(falha).toBeInstanceOf(SefazError);
    expect((falha as SefazError).cStat).toBe('142');
    const reg = new PostgresRegistro(db);
    const rejeitada = await reg.buscar((falha as SefazError).chave!);
    expect(rejeitada).toMatchObject({ situacao: 'rejeitada', referencia: null });
    expect(await storage.listar('contingencia')).toHaveLength(0);

    // o número volta a ficar livre: contingência offline com o mesmo número
    const off = await c.contingencia.emitirOffline({ ...nota, numero: rejeitada!.numero }, undefined, { referencia: 'v2' });
    expect(off.status).toBe('contingencia');
    expect(off.numero).toBe(rejeitada!.numero);
    expect(off.chave[34]).toBe('9');
  });

  it('falha de rede no EPEC: a nota fica em contingência e o EPEC é refeito antes da transmissão', async () => {
    const sefaz = new SefazSp();
    sefaz.roteiroEpec = ['fora'];
    const c = cliente(sefaz);
    const erro = await c.contingencia.emitirEpec(semNumero(), 'Internet fora do ar na loja inteira').catch((e) => e);
    expect(erro).toBeInstanceOf(NfceError);
    const chave = (erro as NfceError).chave!;
    expect(await new PostgresRegistro(db).buscar(chave)).toMatchObject({ tpEmis: 4, situacao: 'contingencia' });
    expect(sefaz.epecs).toHaveLength(0);

    const [r] = await c.processarPendentes(); // refaz o EPEC e depois transmite a NFC-e
    expect(sefaz.epecs).toEqual([chave]);
    expect(r).toMatchObject({ chave, status: 'autorizada' });
  });

  it('idempotente por referência e só existe em SP', async () => {
    const sefaz = new SefazSp();
    const c = cliente(sefaz);
    const a = await c.contingencia.emitirEpec(semNumero(), 'Internet fora do ar na loja inteira', { referencia: 'v3' });
    const b = await c.contingencia.emitirEpec(semNumero(), 'Internet fora do ar na loja inteira', { referencia: 'v3' });
    expect(b.chave).toBe(a.chave);
    expect(sefaz.envelopesEpec).toHaveLength(1);

    const mg = notaExemplo({ emitente: { ...notaExemplo().emitente, endereco: { ...notaExemplo().emitente.endereco, uf: 'MG', codigoMunicipio: 3106200 } } });
    const cMg = new NfceClient({ uf: 'MG', ambiente: 'homologacao', certificado: pfx, csc: { id: 1, codigo: 'CSC-TESTE-0123456789' }, storage: new MemoryStorage(), transporte: { fetchImpl: sefaz.fetchImpl } });
    await expect(cMg.contingencia.emitirEpec(mg)).rejects.toMatchObject({ code: 'EPEC_UF_NAO_SUPORTADA' });
  });

  it('DANFCE da NFC-e em EPEC traz a expressão da NT, o protocolo, o motivo e a hora', async () => {
    const sefaz = new SefazSp();
    const c = cliente(sefaz);
    const r = await c.contingencia.emitirEpec(semNumero(), 'Internet fora do ar na loja inteira');
    const html = await c.danfceHtml(r.xmlAssinado);
    expect(html).toContain('DANFE impresso em contingência - DPEC regularmente recebida pela SEFAZ autorizadora');
    expect(html).toContain('Protocolo EPEC: 535260000000001');
    expect(html).toContain('Motivo: Internet fora do ar na loja inteira');
    expect(html).toContain('Contingência desde');
    const pdf = await c.danfcePdf(r.xmlAssinado);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });
});
