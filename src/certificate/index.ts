import { readFileSync } from 'node:fs';
import forge from 'node-forge';
import type { Certificado } from '../types.js';
import { CertificateError } from '../errors/index.js';

export interface CertificadoCarregado {
  privateKeyPem: string;
  certPem: string;
  /** Cadeia adicional (PEM), se presente no PFX. */
  chainPem: string[];
  /** Certificado em Base64 DER (sem cabeçalhos) para <X509Certificate>. */
  certBase64: string;
  validoDe: Date;
  validoAte: Date;
  titular: string;
  /** CNPJ/CPF extraído do CN (padrão ICP-Brasil "NOME:CNPJ"), se disponível. */
  documento?: string;
}

export function carregarCertificado(c: Certificado): CertificadoCarregado {
  let buf: Buffer;
  try {
    buf = typeof c.pfx === 'string' ? readFileSync(c.pfx) : c.pfx;
  } catch (e) {
    throw new CertificateError(`Não foi possível ler o arquivo PFX: ${(e as Error).message}`);
  }
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(buf.toString('binary'));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, c.senha);
  } catch (e) {
    throw new CertificateError(`PFX inválido ou senha incorreta: ${(e as Error).message}`);
  }
  const shrouded = forge.pki.oids['pkcs8ShroudedKeyBag']!;
  const plain = forge.pki.oids['keyBag']!;
  const certBag = forge.pki.oids['certBag']!;
  const keyBags = p12.getBags({ bagType: shrouded })[shrouded] ?? [];
  const plainKeys = p12.getBags({ bagType: plain })[plain] ?? [];
  const key = [...keyBags, ...plainKeys][0]?.key;
  const certs = (p12.getBags({ bagType: certBag })[certBag] ?? [])
    .map((b) => b.cert)
    .filter((x): x is forge.pki.Certificate => !!x);
  if (!key || certs.length === 0) throw new CertificateError('PFX sem chave privada ou certificado.');

  const keyPub = (key as forge.pki.rsa.PrivateKey).n.toString(16);
  const leaf = certs.find((x) => (x.publicKey as forge.pki.rsa.PublicKey).n.toString(16) === keyPub) ?? certs[0]!;
  const chain = certs.filter((x) => x !== leaf);
  const cn = String(leaf.subject.getField('CN')?.value ?? '');
  const doc = /:(\d{11}|\d{14})\b/.exec(cn)?.[1];
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(leaf)).getBytes();
  const cert: CertificadoCarregado = {
    privateKeyPem: forge.pki.privateKeyToPem(key as forge.pki.rsa.PrivateKey),
    certPem: forge.pki.certificateToPem(leaf),
    chainPem: chain.map((x) => forge.pki.certificateToPem(x)),
    certBase64: forge.util.encode64(der),
    validoDe: leaf.validity.notBefore,
    validoAte: leaf.validity.notAfter,
    titular: cn,
    documento: doc,
  };
  return cert;
}

export function certificadoVencido(c: CertificadoCarregado, agora = new Date()): boolean {
  return agora < c.validoDe || agora > c.validoAte;
}
