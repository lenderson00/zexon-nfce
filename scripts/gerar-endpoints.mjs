// Gera src/sefaz/endpoints-dados.ts a partir das tabelas mantidas pelo projeto nfephp-org/sped-nfe.
// Uso: node scripts/gerar-endpoints.mjs   (requer acesso a raw.githubusercontent.com)
// As URLs devem ser conferidas no Portal Nacional da NFC-e (nfce.encat.org) antes de produção.
import { writeFileSync } from 'node:fs';

const BASE = 'https://raw.githubusercontent.com/nfephp-org/sped-nfe/master/storage';
const get = async (f) => {
  const r = await fetch(`${BASE}/${f}`);
  if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
  return r.text();
};

const autorizadores = JSON.parse(await get('autorizadores.json'))['65'];
const ws = await get('wsnfe_4.00_mod65.xml');
const consulta = JSON.parse(await get('uri_consulta_nfce.json'));

const SERVICOS = {
  autorizacao: 'NfeAutorizacao', retAutorizacao: 'NfeRetAutorizacao', consultaProtocolo: 'NfeConsultaProtocolo',
  statusServico: 'NfeStatusServico', inutilizacao: 'NfeInutilizacao', recepcaoEvento: 'RecepcaoEvento',
};
const blocoUF = (sigla) => new RegExp(`<UF>\\s*<sigla>${sigla}</sigla>([\\s\\S]*?)</UF>`).exec(ws)?.[1];
const blocoAmb = (b, amb) => new RegExp(`<${amb}>([\\s\\S]*?)</${amb}>`).exec(b ?? '')?.[1] ?? '';
const url = (b, tag) => new RegExp(`<${tag}\\b[^>]*>([^<]*)<`).exec(b)?.[1]?.trim() ?? '';

const AMB = { producao: { xml: 'producao', json: '1' }, homologacao: { xml: 'homologacao', json: '2' } };
const servicos = {};
const ufs = {};
for (const [uf, aut] of Object.entries(autorizadores).sort()) {
  if (uf === 'SVRS') continue;
  ufs[uf] = { autorizador: aut };
  for (const [amb, k] of Object.entries(AMB)) {
    if (!servicos[aut]) servicos[aut] = {};
    if (!servicos[aut][amb]) {
      const b = blocoAmb(blocoUF(aut), k.xml);
      servicos[aut][amb] = Object.fromEntries(Object.entries(SERVICOS).map(([n, t]) => [n, url(b, t)]));
    }
    ufs[uf][amb] = { qrCode: url(blocoAmb(blocoUF(uf), k.xml), 'NfeConsultaQR'), urlChave: consulta[k.json][uf] ?? '' };
  }
}

const hoje = new Date().toISOString().slice(0, 10);
const out = `// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
//
// ARQUIVO GERADO por scripts/gerar-endpoints.mjs em ${hoje}. Não edite à mão.
// Fonte: nfephp-org/sped-nfe (storage/autorizadores.json, wsnfe_4.00_mod65.xml, uri_consulta_nfce.json).
// Confira no Portal Nacional da NFC-e (nfce.encat.org → Desenvolvedor) antes de ir para produção;
// para corrigir uma UF sem esperar nova versão, use a opção \`endpoints\` do NfceClient.

export const GERADO_EM = '${hoje}';

/** Webservices por autorizador (SVRS atende várias UFs). */
export const SERVICOS_AUTORIZADOR = ${JSON.stringify(servicos, null, 2)} as const;

/** Autorizador, URL do QR Code e URL de consulta por chave, por UF e ambiente. */
export const DADOS_UF = ${JSON.stringify(ufs, null, 2)} as const;
`;
writeFileSync(new URL('../src/sefaz/endpoints-dados.ts', import.meta.url), out);
console.log(`UFs: ${Object.keys(ufs).length}; autorizadores: ${Object.keys(servicos).join(', ')}`);
