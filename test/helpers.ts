import forge from 'node-forge';
import type { NotaNfce } from '../src/types.js';

/** Gera um PFX A1 de teste (autoassinado) com CN no padrão ICP-Brasil. */
export function gerarPfxTeste(cnpj = '11222333000181', senha = 'teste123'): { pfx: Buffer; senha: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  const attrs = [{ name: 'commonName', value: `EMPRESA TESTE LTDA:${cnpj}` }, { name: 'countryName', value: 'BR' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], senha, { algorithm: '3des' });
  return { pfx: Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary'), senha };
}

export const notaExemplo = (over: Partial<NotaNfce> = {}): NotaNfce => ({
  emitente: {
    cnpj: '11222333000181', razaoSocial: 'EMPRESA TESTE LTDA', nomeFantasia: 'LOJA TESTE', inscricaoEstadual: '110042490114', regimeTributario: 1,
    endereco: { logradouro: 'RUA TESTE', numero: '100', bairro: 'CENTRO', codigoMunicipio: 3550308, municipio: 'SAO PAULO', uf: 'SP', cep: '01001000', fone: '1133334444' },
  },
  serie: 1,
  numero: 1,
  emissao: new Date('2026-11-20T13:00:00Z'),
  itens: [
    { codigo: '001', descricao: 'PRODUTO TESTE A', ncm: '21069090', cfop: '5102', unidade: 'UN', quantidade: 2, valorUnitario: 10.5, icms: { csosn: '102', origem: 0 } },
    { codigo: '002', gtin: '7891000100103', descricao: 'PRODUTO TESTE B', ncm: '22021000', cfop: '5102', unidade: 'UN', quantidade: 1, valorUnitario: 4.9, desconto: 0.9, icms: { csosn: '102', origem: 0 } },
  ],
  pagamentos: [{ tipo: 'dinheiro', valor: 30 }],
  consumidor: { cpf: '52998224725' },
  ...over,
});
