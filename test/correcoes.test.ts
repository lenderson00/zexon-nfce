import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import forge from 'node-forge';
import { paraUnidades, reaisParaCentavos, valorDoItem, aplicarAliquota, aliquotaEfetiva, centavosParaXml } from '../src/util/dinheiro.js';
import { montarNfce } from '../src/xml/nfce.js';
import { validarNota } from '../src/validation/index.js';
import { resolverEndpoints, ENDPOINTS, UFS_SVRS } from '../src/sefaz/endpoints.js';
import { NfceClient, lerQrCode } from '../src/client/NfceClient.js';
import { carregarCadeiaIcpBrasil } from '../src/certificate/cadeia.js';
import { erroDeTransporte } from '../src/sefaz/soap.js';
import { FileStorage } from '../src/storage/index.js';
import { CertificateError } from '../src/errors/index.js';
import { gerarPfxTeste, notaExemplo } from './helpers.js';
import type { Item, NotaNfce } from '../src/types.js';

const tag = (xml: string, t: string) => [...xml.matchAll(new RegExp(`<${t}>([^<]*)</${t}>`, 'g'))].map((m) => m[1]);
const item = (valorUnitario: number, quantidade = 1, over: Partial<Item> = {}): Item => ({
  codigo: '1', descricao: 'ITEM', ncm: '21069090', cfop: '5102', unidade: 'UN', quantidade, valorUnitario, icms: { csosn: '102', origem: 0 }, ...over,
});

describe('item 3 — dinheiro em centavos', () => {
  it('conversões exatas onde float erra', () => {
    expect(reaisParaCentavos(0.1 + 0.2)).toBe(30);
    expect(reaisParaCentavos(1.005)).toBe(101);
    expect(reaisParaCentavos(-1.005)).toBe(-101);
    expect(reaisParaCentavos(19.9 * 3)).toBe(5970);
    expect(paraUnidades(0.12345, 4)).toBe(1235n);
    expect(centavosParaXml(5)).toBe('0.05');
    expect(centavosParaXml(123456)).toBe('1234.56');
    expect(valorDoItem(3, 19.9)).toBe(5970);
    expect(valorDoItem(0.452, 14.9)).toBe(673); // 6,7348 → 6,73
    expect(valorDoItem(1, 1.005)).toBe(101); // vUnCom 1,0050 → vProd 1,01
    expect(aplicarAliquota(7275, 0.1)).toBe(7); // 72,75 × 0,1%
    expect(aplicarAliquota(7275, 0.9)).toBe(65);
    expect(aliquotaEfetiva(0.9, 60)).toBe(3600n); // 0,3600 %
  });

  it('nota com valores que somam errado em float: vProd, vNF e troco exatos', () => {
    const nota: NotaNfce = notaExemplo({
      itens: [item(0.1), item(0.2), item(1.005), item(19.9, 3), item(0.07, 3)],
      pagamentos: [{ tipo: 'dinheiro', valor: 100 }],
    });
    validarNota(nota);
    const m = montarNfce(nota, { ambiente: 'homologacao', tpEmis: 1, offsetMinutes: -180, cNF: '12345678' });
    // 0,10 + 0,20 + 1,01 + 59,70 + 0,21 = 61,22
    expect(tag(m.xml, 'vProd').at(-1)).toBe('61.22');
    expect(tag(m.xml, 'vNF')).toEqual(['61.22']);
    expect(tag(m.xml, 'vTroco')).toEqual(['38.78']);
    expect(m.totais.centavos).toMatchObject({ vProd: 6122, vNF: 6122, troco: 3878 });
    const soma = tag(m.xml, 'vProd').slice(0, -1).reduce((s, v) => s + reaisParaCentavos(Number(v)), 0);
    expect(soma).toBe(6122);
  });

  it('nenhum arredondamento com Number.EPSILON no código fiscal', () => {
    const arquivos = (readdirSync(resolve(__dirname, '../src'), { recursive: true }) as string[]).filter((f) => f.endsWith('.ts'));
    const achados = arquivos.filter((f) => /EPSILON/.test(readFileSync(resolve(__dirname, '../src', f), 'utf8')));
    expect(achados).toEqual([]);
  });
});

describe('item 1 — endpoints de todas as UFs, incluindo o Pará', () => {
  it('27 UFs, dois ambientes, 6 serviços https, QR e urlChave válidos', () => {
    expect(Object.keys(ENDPOINTS)).toHaveLength(27);
    for (const uf of Object.keys(ENDPOINTS)) {
      for (const amb of ['homologacao', 'producao'] as const) {
        const e = resolverEndpoints(uf, amb);
        expect(Object.values(e.servicos)).toHaveLength(uf === 'SP' ? 7 : 6); // SP também tem o EPEC da NFC-e
        for (const u of Object.values(e.servicos)) expect(u, `${uf} ${amb}`).toMatch(/^https:\/\//);
        expect(e.qrCode, `${uf} ${amb}`).toMatch(/^https?:\/\//);
        expect(e.urlChave.length, `${uf} ${amb} urlChave`).toBeGreaterThanOrEqual(21);
        expect(e.urlChave.length, `${uf} ${amb} urlChave`).toBeLessThanOrEqual(85);
      }
    }
  });

  it('PA é autorizado pela SVRS, com QR e consulta da SEFA-PA', () => {
    expect(UFS_SVRS).toEqual(expect.arrayContaining(['PA', 'BA', 'CE', 'MA', 'PE']));
    for (const amb of ['homologacao', 'producao'] as const) {
      const e = resolverEndpoints('PA', amb);
      expect(e.autorizador).toBe('SVRS');
      expect(e.servicos.autorizacao).toBe(`https://${amb === 'producao' ? 'nfce' : 'nfce-homologacao'}.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx`);
      expect(e.qrCode).toMatch(/^https:\/\/appnfc\.sefa\.pa\.gov\.br\//);
      expect(e.urlChave).toBe('www.sefa.pa.gov.br/nfce/consulta');
    }
  });

  it('cliente do PA prepara nota com QR da SEFA-PA e XML válido no XSD', () => {
    const c = new NfceClient({ uf: 'PA', ambiente: 'homologacao', certificado: gerarPfxTeste(), csc: { id: 1, codigo: 'CSC-TESTE-PA-0123456789' } });
    const base = notaExemplo();
    const nota = notaExemplo({ emitente: { ...base.emitente, endereco: { ...base.emitente.endereco, uf: 'PA', codigoMunicipio: 1501402, municipio: 'BELEM', cep: '66010000' } } });
    const p = c.preparar(nota);
    expect(p.qrCode).toMatch(/^https:\/\/appnfc\.sefa\.pa\.gov\.br\/portal-homologacao\/.*\?p=15\d{42}\|2\|2\|1\|[0-9A-F]{40}$/);
    const f = join(mkdtempSync(join(tmpdir(), 'pa-')), 'l.xml');
    writeFileSync(f, `<enviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><idLote>1</idLote><indSinc>1</indSinc>${p.xmlAssinado}</enviNFe>`);
    expect(() => execFileSync('xmllint', ['--noout', '--schema', resolve(__dirname, '../schemas/NFe/enviNFe_v4.00.xsd'), f], { stdio: 'pipe' })).not.toThrow();
  });

  it('endpoints do usuário sobrescrevem a tabela', () => {
    expect(resolverEndpoints('PA', 'producao', { PA: { producao: { urlChave: 'https://exemplo.pa.gov.br/consulta' } } }).urlChave).toBe('https://exemplo.pa.gov.br/consulta');
  });
});

describe('item 4 — certificado x emitente (raiz do CNPJ)', () => {
  const c = new NfceClient({ uf: 'SP', ambiente: 'homologacao', certificado: gerarPfxTeste('11222333000181'), csc: { id: 1, codigo: 'CSC-TESTE-0123456789' } });
  it('outra empresa é bloqueada antes de assinar', () => {
    const base = notaExemplo();
    expect(() => c.preparar(notaExemplo({ emitente: { ...base.emitente, cnpj: '45723174000110' } }))).toThrow(CertificateError);
  });
  it('mesmo CNPJ com máscara e filial da mesma raiz passam', () => {
    const base = notaExemplo();
    expect(() => c.preparar(notaExemplo({ emitente: { ...base.emitente, cnpj: '11.222.333/0001-81' } }))).not.toThrow();
    expect(() => c.preparar(notaExemplo({ emitente: { ...base.emitente, cnpj: '11222333000262' } }))).not.toThrow();
  });
  it('inutilizar de outra empresa é bloqueado', async () => {
    await expect(c.inutilizar({ serie: 1, numeroInicial: 1, justificativa: 'Teste de bloqueio de CNPJ', cnpj: '45723174000110' })).rejects.toBeInstanceOf(CertificateError);
  });
});

describe('item 5 — cadeia ICP-Brasil', () => {
  const gerarCa = (cn: string) => {
    const keys = forge.pki.rsa.generateKeyPair(1024);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey; cert.serialNumber = '0a';
    cert.validity.notBefore = new Date(Date.now() - 864e5); cert.validity.notAfter = new Date(Date.now() + 864e5);
    cert.setSubject([{ name: 'commonName', value: cn }]); cert.setIssuer([{ name: 'commonName', value: cn }]);
    cert.setExtensions([{ name: 'basicConstraints', cA: true }]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    return cert;
  };
  it('lê PEM e DER de um diretório', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ca-'));
    const a = gerarCa('AC Teste Raiz'), b = gerarCa('AC Teste Intermediaria');
    writeFileSync(join(dir, 'raiz.crt'), forge.pki.certificateToPem(a));
    writeFileSync(join(dir, 'inter.cer'), Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(b)).getBytes(), 'binary'));
    writeFileSync(join(dir, 'leia-me.txt'), 'ignorado');
    const pems = carregarCadeiaIcpBrasil(dir);
    expect(pems).toHaveLength(2);
    for (const p of pems) expect(p).toMatch(/^-----BEGIN CERTIFICATE-----/);
    expect(() => carregarCadeiaIcpBrasil(join(dir, 'nao-existe'))).toThrow(/não encontrado/);
  });
  it('erro de certificado TLS vira erro não retentável com instrução', () => {
    const e = erroDeTransporte(Object.assign(new Error('unable to get local issuer certificate'), { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' }), 'nfce.svrs.rs.gov.br', false);
    expect(e).toMatchObject({ retentavel: false, naoRecebido: true });
    expect(e.message).toMatch(/casAdicionais/);
  });
  it('conexão recusada é "não recebida"; queda depois de conectar é incerta', () => {
    expect(erroDeTransporte(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }), 'h', false)).toMatchObject({ retentavel: true, naoRecebido: true });
    expect(erroDeTransporte(Object.assign(new Error('x'), { code: 'ECONNRESET' }), 'h', true)).toMatchObject({ retentavel: true, naoRecebido: false });
  });
});

describe('itens 10 e 11', () => {
  it('QR Code com e sem CDATA', () => {
    const url = 'https://appnfc.sefa.pa.gov.br/portal/view/consultas/nfce/nfceForm.seam?p=1|2|1|1|AB';
    expect(lerQrCode(`<infNFeSupl><qrCode><![CDATA[${url}]]></qrCode></infNFeSupl>`)).toBe(url);
    expect(lerQrCode(`<infNFeSupl><qrCode>${url}</qrCode></infNFeSupl>`)).toBe(url);
    expect(lerQrCode(`<qrCode>https://x/qr?p=1&amp;a=2</qrCode>`)).toBe('https://x/qr?p=1&a=2');
  });
  it('FileStorage grava de forma durável e sem sobras', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fs-'));
    const st = new FileStorage(dir);
    await st.salvar('pendentes', 'abc', '<x/>');
    await st.salvar('pendentes', 'abc', '<y/>');
    expect(await st.ler('pendentes', 'abc')).toBe('<y/>');
    expect(readdirSync(join(dir, 'pendentes'))).toEqual(['abc.xml']);
    mkdirSync(join(dir, 'outra'), { recursive: true });
  });
});
