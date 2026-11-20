import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { montarChave, validarChave, dvModulo11 } from '../src/xml/chave.js';
import { montarQrCodeOffline, montarQrCodeOnline } from '../src/qrcode/index.js';
import { carregarCertificado } from '../src/certificate/index.js';
import { montarNfce } from '../src/xml/nfce.js';
import { assinarXml, verificarAssinatura } from '../src/xml/sign.js';
import { cnpjValido, cpfValido, gtinValido, validarNota } from '../src/validation/index.js';
import { NfceBuilder } from '../src/builder/NfceBuilder.js';
import { gerarPfxTeste, notaExemplo } from './helpers.js';

const SCHEMAS = resolve(__dirname, '../schemas/NFe');
function xsdOk(xml: string, xsd: string): string {
  const f = join(mkdtempSync(join(tmpdir(), 'nfce-')), 'doc.xml');
  writeFileSync(f, xml);
  try {
    execFileSync('xmllint', ['--noout', '--schema', join(SCHEMAS, xsd), f], { stdio: 'pipe' });
    return 'validates';
  } catch (e) {
    return String((e as { stderr?: Buffer }).stderr ?? e);
  }
}

describe('chave de acesso', () => {
  it('valida o DV da chave do manual', () => {
    const { chave } = montarChave({ cUF: 28, emissao: new Date('2017-08-10T12:00:00Z'), offsetMinutes: -180, cnpj: '00156225000131', serie: 11, nNF: 15134, tpEmis: 1, cNF: '56204082' });
    expect(chave.slice(0, 43)).toBe('2817080015622500013165011000015134156204082');
    expect(validarChave(chave)).toBe(true);
    expect(validarChave(chave.slice(0, 43) + String((Number(chave[43]) + 1) % 10))).toBe(false);
  });
  it('monta chave de 44 dígitos', () => {
    const { chave } = montarChave({ cUF: 35, emissao: new Date('2026-11-20T13:00:00Z'), offsetMinutes: -180, cnpj: '11222333000181', serie: 1, nNF: 1, tpEmis: 1, cNF: '12345678' });
    expect(chave).toHaveLength(44);
    expect(chave.slice(0, 6)).toBe('352611');
    expect(validarChave(chave)).toBe(true);
    expect(dvModulo11(chave.slice(0, 43))).toBe(Number(chave[43]));
  });
});

describe('QR Code', () => {
  const chave = '28170800156225000131650110000151341562040824';
  const csc = { id: 1, codigo: 'SEU-CODIGO-CSC-CONTRIBUINTE-36-CARACTERES' };
  it('v2 online segue o exemplo do manual (hash SHA-1)', () => {
    const url = montarQrCodeOnline({ versao: 2, urlBase: 'http://www.sefazexemplo.gov.br/nfce/qrcode', chave, tpAmb: 1, csc });
    expect(url).toBe(`http://www.sefazexemplo.gov.br/nfce/qrcode?p=${chave}|2|1|1|DC6AE2C2B9A992BE59679AC365E29922DE6B7511`);
  });
  it('v2 offline segue o exemplo do manual', () => {
    const k = '28170800156225000131650110000151349562040824';
    const url = montarQrCodeOffline({
      versao: 2, urlBase: 'http://www.sefazexemplo.gov.br/nfce/qrcode', chave: k, tpAmb: 1, csc, dia: '02', vNF: 60.9, digestValue: 'yzGYhUx1/XYYzksWB+fPR3Qc50c=',
    });
    expect(url).toBe(`http://www.sefazexemplo.gov.br/nfce/qrcode?p=${k}|2|1|02|60.90|797a4759685578312f5859597a6b7357422b6650523351633530633d|1|4615A93BB0D7C4E780F8D30EE77EDD5BA55C7D66`);
  });
  it('v3 online não usa CSC', () => {
    expect(montarQrCodeOnline({ versao: 3, urlBase: 'https://x/qrcode', chave, tpAmb: 2 })).toBe(`https://x/qrcode?p=${chave}|3|2`);
  });
});

describe('validações', () => {
  it('documentos', () => {
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('111.111.111-11')).toBe(false);
    expect(cnpjValido('11.222.333/0001-81')).toBe(true);
    expect(cnpjValido('11.222.333/0001-82')).toBe(false);
    expect(gtinValido('7891000100103')).toBe(true);
    expect(gtinValido('7891000100104')).toBe(false);
  });
  it('rejeita pagamento insuficiente e CPF inválido', () => {
    expect(() => validarNota(notaExemplo({ pagamentos: [{ tipo: 'pix', valor: 1 }], consumidor: { cpf: '123' } }))).toThrow(/pagamentos[\s\S]*consumidor\.cpf|consumidor\.cpf[\s\S]*pagamentos/);
  });
  it('builder valida', () => {
    const n = notaExemplo();
    const b = new NfceBuilder().emitente(n.emitente).numero(1).itens(n.itens).pagamento(n.pagamentos[0]!).build();
    expect(b.itens).toHaveLength(2);
  });
});

describe('XML + assinatura + XSD', () => {
  const cert = carregarCertificado(gerarPfxTeste());
  it('extrai CNPJ do certificado', () => expect(cert.documento).toBe('11222333000181'));

  for (const ambiente of ['homologacao', 'producao'] as const) {
    it(`NFC-e assinada valida no XSD enviNFe (${ambiente})`, () => {
      const m = montarNfce(notaExemplo(), { ambiente, tpEmis: 1, offsetMinutes: -180, cNF: '12345678' });
      expect(m.totais.vNF).toBe(25);
      let signed = assinarXml(m.xml, 'infNFe', 'NFe', cert);
      const qr = montarQrCodeOnline({ versao: 3, urlBase: 'https://www.sefazexemplo.gov.br/nfce/qrcode', chave: m.chave, tpAmb: ambiente === 'producao' ? 1 : 2 });
      signed = signed.replace('<Signature', `<infNFeSupl><qrCode><![CDATA[${qr}]]></qrCode><urlChave>https://www.sefazexemplo.gov.br/nfce/consulta</urlChave></infNFeSupl><Signature`);
      expect(verificarAssinatura(signed)).toBe(true);
      const lote = `<enviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><idLote>1</idLote><indSinc>1</indSinc>${signed}</enviNFe>`;
      expect(xsdOk(lote, 'enviNFe_v4.00.xsd')).toContain('validates');
    });
  }

  it('contingência offline (tpEmis=9) valida no XSD', () => {
    const m = montarNfce(notaExemplo(), { ambiente: 'homologacao', tpEmis: 9, offsetMinutes: -180, cNF: '87654321' });
    const signed = assinarXml(m.xml, 'infNFe', 'NFe', cert);
    const lote = `<enviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><idLote>1</idLote><indSinc>1</indSinc>${signed}</enviNFe>`;
    expect(xsdOk(lote, 'enviNFe_v4.00.xsd')).toContain('validates');
  });

  it('adulteração invalida a assinatura', () => {
    const m = montarNfce(notaExemplo(), { ambiente: 'homologacao', tpEmis: 1, offsetMinutes: -180, cNF: '12345678' });
    const signed = assinarXml(m.xml, 'infNFe', 'NFe', cert).replace('<vNF>', '<vNF>9');
    expect(verificarAssinatura(signed)).toBe(false);
  });
});
