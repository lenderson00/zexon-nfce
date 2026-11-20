// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
import { SignedXml } from 'xml-crypto';
import type { CertificadoCarregado } from '../certificate/index.js';

const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
const RSA_SHA1 = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
const SHA1 = 'http://www.w3.org/2000/09/xmldsig#sha1';

/**
 * Assina (XMLDSig enveloped, RSA-SHA1, C14N) o elemento com atributo Id.
 * @param xml documento completo
 * @param tagAssinada nome local do elemento referenciado (infNFe, infEvento, infInut)
 * @param tagPai elemento que receberá <Signature> como último filho (NFe, evento, inutNFe)
 */
export function assinarXml(xml: string, tagAssinada: string, tagPai: string, cert: CertificadoCarregado): string {
  const sig = new SignedXml({
    privateKey: cert.privateKeyPem,
    publicCert: cert.certPem,
    signatureAlgorithm: RSA_SHA1,
    canonicalizationAlgorithm: C14N,
    getKeyInfoContent: () => `<X509Data><X509Certificate>${cert.certBase64}</X509Certificate></X509Data>`,
  });
  sig.addReference({
    xpath: `//*[local-name(.)='${tagAssinada}']`,
    transforms: [ENVELOPED, C14N],
    digestAlgorithm: SHA1,
  });
  sig.computeSignature(xml, {
    prefix: undefined,
    location: { reference: `//*[local-name(.)='${tagPai}']`, action: 'append' },
  });
  return sig.getSignedXml();
}

/** DigestValue (Base64) da assinatura presente no XML. */
export function extrairDigestValue(xml: string): string | undefined {
  return /<DigestValue>([^<]+)<\/DigestValue>/.exec(xml)?.[1];
}

/** Verifica a assinatura do XML usando o certificado embutido (<X509Certificate>). */
export function verificarAssinatura(xml: string): boolean {
  const b64 = /<X509Certificate>([^<]+)<\/X509Certificate>/.exec(xml)?.[1];
  if (!b64) return false;
  const pem = `-----BEGIN CERTIFICATE-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----`;
  const sigNode = /<Signature[\s\S]*<\/Signature>/.exec(xml)?.[0];
  if (!sigNode) return false;
  const v = new SignedXml({ publicCert: pem });
  v.loadSignature(sigNode.replace(/^<Signature(?![^>]*xmlns)/, '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"'));
  try {
    return v.checkSignature(xml);
  } catch {
    return false;
  }
}
