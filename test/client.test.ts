import { describe, expect, it, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { NfceClient } from '../src/client/NfceClient.js';
import { MemoryStorage } from '../src/storage/index.js';
import { TransportError } from '../src/errors/index.js';
import { gerarPfxTeste, notaExemplo } from './helpers.js';

const NS = 'xmlns="http://www.portalfiscal.inf.br/nfe"';
const soap = (inner: string) => `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg xmlns="x">${inner}</nfeResultMsg></soap:Body></soap:Envelope>`;
const pick = (s: string, t: string) => new RegExp(`<${t}>([^<]*)</${t}>`).exec(s)?.[1] ?? '';

/** SEFAZ simulada: responde conforme o serviço (pela URL) e o conteúdo enviado. */
function sefazFake(opts: { down?: boolean; recusada?: boolean; authorize?: boolean; cStatProt?: string } = {}) {
  const calls: Array<{ url: string; body: string }> = [];
  const autorizadas = new Set<string>();
  const fetchImpl = async (url: string, envelope: string) => {
    calls.push({ url, body: envelope });
    if (opts.recusada) throw new TransportError('connect ECONNREFUSED', undefined, { naoRecebido: true });
    if (opts.down) throw new TransportError('sem conexão');
    if (url.includes('Autorizacao4')) {
      const chave = /Id="NFe(\d{44})"/.exec(envelope)![1]!;
      const cs = opts.cStatProt ?? '100';
      if (cs === '100') autorizadas.add(chave);
      return soap(`<retEnviNFe versao="4.00" ${NS}><tpAmb>2</tpAmb><cStat>104</cStat><xMotivo>Lote processado</xMotivo><cUF>35</cUF><dhRecbto>2026-11-20T10:00:05-03:00</dhRecbto><protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SP_NFCE</verAplic><chNFe>${chave}</chNFe><dhRecbto>2026-11-20T10:00:05-03:00</dhRecbto>${cs === '100' ? '<nProt>135260000000001</nProt>' : ''}<digVal>abc=</digVal><cStat>${cs}</cStat><xMotivo>${cs === '100' ? 'Autorizado o uso da NF-e' : 'Rejeicao: teste'}</xMotivo></infProt></protNFe></retEnviNFe>`);
    }
    if (url.includes('StatusServico')) return soap(`<retConsStatServ versao="4.00" ${NS}><tpAmb>2</tpAmb><cStat>107</cStat><xMotivo>Servico em Operacao</xMotivo><cUF>35</cUF><tMed>1</tMed></retConsStatServ>`);
    if (url.includes('ConsultaProtocolo')) {
      const chave = pick(envelope, 'chNFe');
      if (!autorizadas.has(chave)) return soap(`<retConsSitNFe versao="4.00" ${NS}><tpAmb>2</tpAmb><cStat>217</cStat><xMotivo>Rejeicao: NF-e nao consta na base</xMotivo><cUF>35</cUF></retConsSitNFe>`);
      return soap(`<retConsSitNFe versao="4.00" ${NS}><tpAmb>2</tpAmb><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo><cUF>35</cUF><protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>${chave}</chNFe><dhRecbto>2026-11-20T10:00:05-03:00</dhRecbto><nProt>135260000000001</nProt><digVal>abc=</digVal><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></retConsSitNFe>`);
    }
    if (url.includes('RecepcaoEvento')) {
      const chave = pick(envelope, 'chNFe');
      return soap(`<retEnvEvento versao="1.00" ${NS}><idLote>1</idLote><tpAmb>2</tpAmb><cStat>128</cStat><xMotivo>Lote de Evento Processado</xMotivo><retEvento versao="1.00"><infEvento><tpAmb>2</tpAmb><cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo><chNFe>${chave}</chNFe><tpEvento>${pick(envelope, 'tpEvento')}</tpEvento><nProt>135260000000099</nProt></infEvento></retEvento></retEnvEvento>`);
    }
    if (url.includes('nfeinutilizacao') || url.includes('Inutilizacao')) {
      return soap(`<retInutNFe versao="4.00" ${NS}><infInut><tpAmb>2</tpAmb><cStat>102</cStat><xMotivo>Inutilizacao de numero homologado</xMotivo><nProt>135260000000777</nProt><dhRecbto>2026-11-20T10:00:00-03:00</dhRecbto></infInut></retInutNFe>`);
    }
    throw new Error('serviço inesperado ' + url);
  };
  return { fetchImpl, calls };
}

let pfx: { pfx: Buffer; senha: string };
beforeAll(() => { pfx = gerarPfxTeste(); });

const novoCliente = (fake: ReturnType<typeof sefazFake>, extra: Record<string, unknown> = {}) =>
  new NfceClient({
    uf: 'SP', ambiente: 'homologacao', certificado: pfx, csc: { id: 1, codigo: 'CSC-DE-TESTE-0123456789' }, storage: new MemoryStorage(),
    transporte: { fetchImpl: fake.fetchImpl }, retentativas: { esperasMs: [0] }, ...extra,
  });

describe('NfceClient', () => {
  it('emite com sucesso e monta nfeProc + QR Code v2', async () => {
    const c = novoCliente(sefazFake());
    const r = await c.emitir(notaExemplo());
    expect(r.status).toBe('autorizada');
    expect(r.protocolo).toBe('135260000000001');
    expect(r.xmlAutorizado).toContain('<nfeProc');
    expect(r.xmlAutorizado).toContain('<protNFe');
    expect(r.qrCode).toMatch(/\/qrcode\?p=\d{44}\|2\|2\|1\|[0-9A-F]{40}$/);
    expect(await c.config.storage!.listar('autorizadas')).toEqual([r.chave]);
    // XML autorizado valida no XSD de procNFe
    const f = join(mkdtempSync(join(tmpdir(), 'nfce-')), 'p.xml');
    writeFileSync(f, r.xmlAutorizado!);
    expect(() => execFileSync('xmllint', ['--noout', '--schema', resolve(__dirname, '../schemas/NFe/procNFe_v4.00.xsd'), f], { stdio: 'pipe' })).not.toThrow();
  });

  it('devolve rejeição sem lançar', async () => {
    const r = await novoCliente(sefazFake({ cStatProt: '539' })).emitir(notaExemplo());
    expect(r.status).toBe('rejeitada');
    expect(r.cStat).toBe('539');
  });

  it('status e consulta', async () => {
    const fake = sefazFake();
    const c = novoCliente(fake);
    expect((await c.status()).online).toBe(true);
    const r = await c.emitir(notaExemplo());
    const q = await c.consultar(r.chave);
    expect(q.situacao).toBe('autorizada');
    expect(q.protocolo).toBe('135260000000001');
  });

  it('cancela e inutiliza', async () => {
    const c = novoCliente(sefazFake());
    const r = await c.emitir(notaExemplo());
    const canc = await c.cancelar({ chave: r.chave, protocolo: r.protocolo!, justificativa: 'Cancelamento por erro de digitacao' });
    expect(canc.sucesso).toBe(true);
    expect(canc.xmlProcEvento).toContain('<procEventoNFe');
    await expect(c.cancelar({ chave: r.chave, protocolo: '1', justificativa: 'curta' })).rejects.toThrow(/justificativa/);
    const inut = await c.inutilizar({ serie: 1, numeroInicial: 10, numeroFinal: 12, justificativa: 'Numeracao pulada por falha do sistema' });
    expect(inut.sucesso).toBe(true);
    expect(await c.config.storage!.listar('inutilizacoes')).toHaveLength(1);
  });

  it('sem conexão: lança TransportError', async () => {
    await expect(novoCliente(sefazFake({ down: true })).emitir(notaExemplo())).rejects.toBeInstanceOf(TransportError);
  });

  it('contingência automática e retransmissão', async () => {
    // Conexão recusada = certo que a SEFAZ não recebeu: contingência automática com o mesmo número.
    const down = novoCliente(sefazFake({ recusada: true }), { contingenciaAutomatica: true });
    const r = await down.emitir(notaExemplo());
    expect(r.numero).toBe(1);
    expect(r.status).toBe('contingencia');
    expect(r.xmlAssinado).toContain('<tpEmis>9</tpEmis>');
    expect(r.qrCode).toMatch(/\|2\|2\|\d{2}\|25\.00\|[0-9a-f]+\|1\|[0-9A-F]{40}$/);
    expect(await down.contingencia.pendentes()).toEqual([r.chave]);

    // Volta a conexão: reutiliza o mesmo storage.
    const storage = down.config.storage!;
    const up = novoCliente(sefazFake(), { storage });
    const out = await up.contingencia.transmitirPendentes();
    expect(out[0]!.status).toBe('autorizada');
    expect(await up.contingencia.pendentes()).toEqual([]);
  });

  it('QR Code v3 offline assina os parâmetros', async () => {
    const c = novoCliente(sefazFake({ down: true }), { csc: undefined, qrCodeVersao: 3 });
    const p = c.preparar(notaExemplo(), { offline: true });
    expect(p.qrCode).toMatch(/\|3\|2\|\d{2}\|25\.00\|2\|52998224725\|[A-Za-z0-9+/=]{300,}$/);
  });

  it('DANFCE HTML e PDF', async () => {
    const c = novoCliente(sefazFake());
    const r = await c.emitir(notaExemplo());
    const html = await c.danfceHtml(r.xmlAutorizado!);
    expect(html).toContain('DANFE NFC-e');
    expect(html).toContain('HOMOLOGAÇÃO');
    expect(html).toContain('data:image/png;base64');
    const pdf = await c.danfcePdf(r.xmlAutorizado!);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
