// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
import type { Ambiente } from '../types.js';
import { NfceError } from '../errors/index.js';
import { DADOS_UF, SERVICOS_AUTORIZADOR, GERADO_EM } from './endpoints-dados.js';

/**
 * Serviços SOAP 1.2 da NFC-e 4.00.
 *
 * A tabela embutida (`endpoints-dados.ts`) cobre as 27 UFs e é gerada por `scripts/gerar-endpoints.mjs`.
 * As URLs mudam: confira no Portal Nacional da NFC-e (nfce.encat.org → Desenvolvedor) e, se preciso,
 * corrija sem esperar nova versão com a opção `endpoints` do cliente.
 */
export type Servico =
  | 'autorizacao' | 'retAutorizacao' | 'consultaProtocolo' | 'statusServico' | 'inutilizacao' | 'recepcaoEvento';

export interface EndpointsAmbiente {
  servicos: Record<Servico, string>;
  /** URL base do QR Code (sem `?p=`). */
  qrCode: string;
  /** URL de consulta por chave de acesso (impressa no DANFCE e em <urlChave>; 21 a 85 caracteres). */
  urlChave: string;
  /** Quem autoriza a NFC-e da UF (a própria UF ou "SVRS"). */
  autorizador?: string;
}

export type EndpointsUF = Record<Ambiente, EndpointsAmbiente>;

export { GERADO_EM as ENDPOINTS_GERADOS_EM };

/** UFs cuja NFC-e é autorizada pela SEFAZ Virtual do RS. */
export const UFS_SVRS: readonly string[] = Object.entries(DADOS_UF).filter(([, d]) => d.autorizador === 'SVRS').map(([uf]) => uf);

function montar(uf: string, ambiente: Ambiente): EndpointsAmbiente | undefined {
  const d = (DADOS_UF as Record<string, (typeof DADOS_UF)[keyof typeof DADOS_UF]>)[uf];
  if (!d) return undefined;
  const servicos = (SERVICOS_AUTORIZADOR as Record<string, Record<Ambiente, Record<Servico, string>>>)[d.autorizador]?.[ambiente];
  if (!servicos) return undefined;
  return { servicos: { ...servicos }, qrCode: d[ambiente].qrCode, urlChave: d[ambiente].urlChave, autorizador: d.autorizador };
}

/** Tabela embutida por UF e ambiente. */
export const ENDPOINTS: Partial<Record<string, EndpointsUF>> = Object.fromEntries(
  Object.keys(DADOS_UF).map((uf) => [uf, { producao: montar(uf, 'producao')!, homologacao: montar(uf, 'homologacao')! }]),
);

export type EndpointsOverride = {
  [uf: string]: { [A in Ambiente]?: Partial<Omit<EndpointsAmbiente, 'servicos'>> & { servicos?: Partial<Record<Servico, string>> } };
};

/** Resolve endpoints da UF/ambiente, aplicando sobreposições do usuário. */
export function resolverEndpoints(uf: string, ambiente: Ambiente, override?: EndpointsOverride): EndpointsAmbiente {
  const base = montar(uf.toUpperCase(), ambiente);
  const ov = override?.[uf.toUpperCase()]?.[ambiente];
  if (!base && !ov?.servicos) {
    throw new NfceError(`Endpoints da UF ${uf} (${ambiente}) não cadastrados. Informe-os em \`endpoints\` (veja nfce.encat.org).`, 'ENDPOINT_AUSENTE');
  }
  return {
    servicos: { ...(base?.servicos ?? ({} as Record<Servico, string>)), ...(ov?.servicos ?? {}) } as Record<Servico, string>,
    qrCode: ov?.qrCode ?? base?.qrCode ?? '',
    urlChave: ov?.urlChave ?? base?.urlChave ?? '',
    autorizador: ov?.autorizador ?? base?.autorizador,
  };
}
