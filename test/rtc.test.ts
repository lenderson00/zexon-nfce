import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { montarNfce } from '../src/xml/nfce.js';
import { assinarXml } from '../src/xml/sign.js';
import { carregarCertificado } from '../src/certificate/index.js';
import { montarQrCodeOnline } from '../src/qrcode/index.js';
import { validarNota } from '../src/validation/index.js';
import { NfceClient } from '../src/client/NfceClient.js';
import { CCLASSTRIB_NFCE } from '../src/rtc/index.js';
import { ValidationError } from '../src/errors/index.js';
import type { Item, NotaNfce } from '../src/types.js';
import { gerarPfxTeste, notaExemplo } from './helpers.js';

const cert = carregarCertificado(gerarPfxTeste());
const pick = (xml: string, t: string) => [...xml.matchAll(new RegExp(`<${t}>([^<]*)</${t}>`, 'g'))].map((m) => m[1]);

function xsdValido(nota: NotaNfce) {
  const m = montarNfce(nota, { ambiente: 'homologacao', tpEmis: 1, offsetMinutes: -180, cNF: '12345678' });
  const qr = montarQrCodeOnline({ versao: 3, urlBase: 'https://www.sefazexemplo.gov.br/nfce/qrcode', chave: m.chave, tpAmb: 2 });
  const signed = assinarXml(m.xml, 'infNFe', 'NFe', cert).replace('<Signature', `<infNFeSupl><qrCode><![CDATA[${qr}]]></qrCode><urlChave>https://www.sefazexemplo.gov.br/nfce/consulta</urlChave></infNFeSupl><Signature`);
  const f = join(mkdtempSync(join(tmpdir(), 'rtc-')), 'l.xml');
  writeFileSync(f, `<enviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><idLote>1</idLote><indSinc>1</indSinc>${signed}</enviNFe>`);
  try {
    execFileSync('xmllint', ['--noout', '--schema', resolve(__dirname, '../schemas/NFe/enviNFe_v4.00.xsd'), f], { stdio: 'pipe' });
  } catch (e) {
    throw new Error(String((e as { stderr?: Buffer }).stderr));
  }
  return m;
}

const itemNormal = (over: Partial<Item> = {}): Item => ({
  codigo: '1', descricao: 'PRODUTO', ncm: '21069090', cfop: '5102', unidade: 'UN', quantidade: 1, valorUnitario: 100,
  icms: { cst: '00', origem: 0, aliquota: 18 }, pis: { cst: '01', aliquota: 1.65 }, cofins: { cst: '01', aliquota: 7.6 },
  ibsCbs: { cClassTrib: '000001' }, ...over,
});
const notaNormal = (itens: Item[], over: Partial<NotaNfce> = {}): NotaNfce => {
  const base = notaExemplo();
  const total = itens.reduce((s, i) => s + i.quantidade * i.valorUnitario - (i.desconto ?? 0), 0);
  return { ...base, emitente: { ...base.emitente, regimeTributario: 3 }, itens, pagamentos: [{ tipo: 'pix', valor: Math.round(total * 100) / 100 }], ...over };
};

describe('tabela cClassTrib oficial', () => {
  it('contém os códigos de NFC-e mais usados', () => {
    expect(CCLASSTRIB_NFCE['000001']?.cst).toBe('000');
    expect(CCLASSTRIB_NFCE['200034']?.pRedIBS).toBe(60);
    expect(CCLASSTRIB_NFCE['410001']?.cst).toBe('410');
    expect(Object.keys(CCLASSTRIB_NFCE)).toHaveLength(40);
  });
});

describe('IBS/CBS (NT 2025.002)', () => {
  it('tributação integral 2026: base UB16-10, alíquotas 0,1% / 0% / 0,9%, totais e XSD', () => {
    const m = xsdValido(notaNormal([itemNormal()]));
    // vBC = 100 − ICMS 18 − PIS 1,65 − COFINS 7,60 = 72,75
    expect(pick(m.xml, 'vBC')).toContain('72.75');
    expect(pick(m.xml, 'pIBSUF')).toEqual(['0.1000']);
    expect(pick(m.xml, 'pIBSMun')).toEqual(['0.0000']);
    expect(pick(m.xml, 'pCBS')).toEqual(['0.9000']);
    expect(pick(m.xml, 'vIBSUF')).toEqual(['0.07', '0.07']); // item e total
    expect(pick(m.xml, 'vCBS')).toEqual(['0.65', '0.65']);
    expect(pick(m.xml, 'vBCIBSCBS')).toEqual(['72.75']);
    // 2026: vItem e vNFTot não somam IBS/CBS (VB01-10, exceção 1)
    expect(pick(m.xml, 'vItem')).toEqual(['100.00']);
    expect(pick(m.xml, 'vNFTot')).toEqual(['100.00']);
    expect(m.totais.ibsCbs).toMatchObject({ vIBS: 0.07, vCBS: 0.65 });
  });

  it('alíquota reduzida 60% (200034) gera gRed com alíquota efetiva', () => {
    const m = xsdValido(notaNormal([itemNormal({ ibsCbs: { cClassTrib: '200034' } })]));
    expect(pick(m.xml, 'pRedAliq')).toEqual(['60.0000', '60.0000', '60.0000']);
    expect(pick(m.xml, 'pAliqEfet')).toEqual(['0.0400', '0.0000', '0.3600']);
    expect(pick(m.xml, 'vCBS')[0]).toBe('0.26'); // 72,75 × 0,36%
  });

  it('cesta básica com redução de 100% (200003) zera os valores', () => {
    const m = xsdValido(notaNormal([itemNormal({ ibsCbs: { cClassTrib: '200003' } })]));
    expect(pick(m.xml, 'vIBS')).toEqual(['0.00', '0.00']);
    expect(pick(m.xml, 'vCBS')).toEqual(['0.00', '0.00']);
  });

  it('não incidência (410) informa só CST e cClassTrib, com totais zerados', () => {
    const m = xsdValido(notaNormal([itemNormal({ ibsCbs: { cClassTrib: '410999' } })]));
    expect(m.xml).toContain('<IBSCBS><CST>410</CST><cClassTrib>410999</cClassTrib></IBSCBS>');
    expect(m.xml).toContain('<IBSCBSTot><vBCIBSCBS>0.00</vBCIBSCBS>');
  });

  it('doação: obrigatória em 410003 e proibida em 200003', () => {
    expect(() => xsdValido(notaNormal([itemNormal({ ibsCbs: { cClassTrib: '410003' } })]))).toThrow(/exige indicar doação/);
    const m = xsdValido(notaNormal([itemNormal({ ibsCbs: { cClassTrib: '410003', doacao: true } })]));
    expect(m.xml).toContain('<indDoacao>1</indDoacao>');
    expect(() => xsdValido(notaNormal([itemNormal({ ibsCbs: { cClassTrib: '200003', doacao: true } })]))).toThrow(/não permite/);
  });

  it('rejeita cClassTrib que não é de NFC-e', () => {
    expect(() => xsdValido(notaNormal([itemNormal({ ibsCbs: { cClassTrib: '000002' } })]))).toThrow(ValidationError);
  });

  it('a partir de 2027 exige a alíquota da CBS e soma IBS/CBS em vItem', () => {
    const em = new Date('2027-03-10T15:00:00Z');
    expect(() => xsdValido(notaNormal([itemNormal()], { emissao: em }))).toThrow(/Alíquotas do IBS\/CBS para 2027/);
    const m = xsdValido(notaNormal([itemNormal({ ibsCbs: { cClassTrib: '000001', aliquotaCBS: 8.8 } })], { emissao: em }));
    expect(pick(m.xml, 'pIBSMun')).toEqual(['0.0500']);
    const [vIBS] = pick(m.xml, 'vIBS'), [vCBS] = pick(m.xml, 'vCBS');
    expect(pick(m.xml, 'vNFTot')[0]).toBe((100 + Number(vIBS) + Number(vCBS)).toFixed(2));
  });

  it('Regime Normal sem IBS/CBS é barrado antes do envio', () => {
    expect(() => validarNota(notaNormal([itemNormal({ ibsCbs: undefined })]))).toThrow(/ibsCbs: obrigatório para Regime Normal/);
  });

  it('Simples Nacional continua sem IBS/CBS', () => {
    const m = xsdValido(notaExemplo());
    expect(m.xml).not.toContain('IBSCBS');
    expect(m.xml).not.toContain('vNFTot');
  });

  it('ibsCbsPadrao do cliente completa os itens', () => {
    const c = new NfceClient({ uf: 'SP', ambiente: 'homologacao', certificado: gerarPfxTeste(), ibsCbsPadrao: { cClassTrib: '000001' } });
    const p = c.preparar(notaNormal([itemNormal({ ibsCbs: undefined }), itemNormal({ codigo: '2', ibsCbs: { cClassTrib: '200034' } })]));
    expect(p.xmlAssinado).toContain('<cClassTrib>000001</cClassTrib>');
    expect(p.xmlAssinado).toContain('<cClassTrib>200034</cClassTrib>');
  });

  it('indPres=5 informa cMunFGIBS (B25b-70); demais casos não (B25b-60)', () => {
    const fora = xsdValido(notaExemplo({ indicadorPresenca: 5, municipioFatoGerador: 3509502 }));
    expect(fora.xml).toContain('<cMunFGIBS>3509502</cMunFGIBS>');
    expect(xsdValido(notaExemplo()).xml).not.toContain('cMunFGIBS');
  });
});
