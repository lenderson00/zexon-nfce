import type { Ambiente } from '../types.js';
import { NfceError } from '../errors/index.js';

/**
 * Serviços SOAP 1.2 da NFC-e 4.00.
 *
 * ATENÇÃO: as URLs mudam com frequência. A fonte oficial é o Portal Nacional da NFC-e
 * (nfce.encat.org → Desenvolvedor) e os portais das SEFAZ. Confira antes de ir para produção e,
 * para qualquer UF não listada (ou desatualizada), informe `endpoints` na configuração do cliente.
 */
export type Servico =
  | 'autorizacao' | 'retAutorizacao' | 'consultaProtocolo' | 'statusServico' | 'inutilizacao' | 'recepcaoEvento';

export interface EndpointsAmbiente {
  servicos: Record<Servico, string>;
  /** URL base do QR Code (sem `?p=`). */
  qrCode: string;
  /** URL de consulta por chave de acesso (impressa no DANFCE e em <urlChave>). */
  urlChave: string;
}

export type EndpointsUF = Record<Ambiente, EndpointsAmbiente>;

const svrs = (host: string, qrCode: string, urlChave: string): EndpointsAmbiente => ({
  servicos: {
    autorizacao: `https://${host}/ws/NfeAutorizacao/NFeAutorizacao4.asmx`,
    retAutorizacao: `https://${host}/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx`,
    consultaProtocolo: `https://${host}/ws/NfeConsulta/NfeConsulta4.asmx`,
    statusServico: `https://${host}/ws/NfeStatusServico/NfeStatusServico4.asmx`,
    inutilizacao: `https://${host}/ws/nfeinutilizacao/nfeinutilizacao4.asmx`,
    recepcaoEvento: `https://${host}/ws/recepcaoevento/recepcaoevento4.asmx`,
  },
  qrCode,
  urlChave,
});

const sp = (host: string, qrHost: string): EndpointsAmbiente => ({
  servicos: {
    autorizacao: `https://${host}/ws/NFeAutorizacao4.asmx`,
    retAutorizacao: `https://${host}/ws/NFeRetAutorizacao4.asmx`,
    consultaProtocolo: `https://${host}/ws/NFeConsultaProtocolo4.asmx`,
    statusServico: `https://${host}/ws/NFeStatusServico4.asmx`,
    inutilizacao: `https://${host}/ws/NFeInutilizacao4.asmx`,
    recepcaoEvento: `https://${host}/ws/NFeRecepcaoEvento4.asmx`,
  },
  qrCode: `https://${qrHost}/qrcode`,
  urlChave: `https://${qrHost}/consulta`,
});

const mg = (host: string, qr: string, chave: string): EndpointsAmbiente => ({
  servicos: {
    autorizacao: `https://${host}/nfce/services/NFeAutorizacao4`,
    retAutorizacao: `https://${host}/nfce/services/NFeRetAutorizacao4`,
    consultaProtocolo: `https://${host}/nfce/services/NFeConsultaProtocolo4`,
    statusServico: `https://${host}/nfce/services/NFeStatusServico4`,
    inutilizacao: `https://${host}/nfce/services/NFeInutilizacao4`,
    recepcaoEvento: `https://${host}/nfce/services/NFeRecepcaoEvento4`,
  },
  qrCode: qr,
  urlChave: chave,
});

const pr = (host: string, qr: string, chave: string): EndpointsAmbiente => ({
  servicos: {
    autorizacao: `https://${host}/nfce/NFeAutorizacao4`,
    retAutorizacao: `https://${host}/nfce/NFeRetAutorizacao4`,
    consultaProtocolo: `https://${host}/nfce/NFeConsulta4`,
    statusServico: `https://${host}/nfce/NFeStatusServico4`,
    inutilizacao: `https://${host}/nfce/NFeInutilizacao4`,
    recepcaoEvento: `https://${host}/nfce/NFeRecepcaoEvento4`,
  },
  qrCode: qr,
  urlChave: chave,
});

/** UFs cujo ambiente de NFC-e é atendido pela SVRS (hosts de serviço). QR Code/urlChave dependem de cada UF. */
export const UFS_SVRS = ['AC', 'AL', 'AP', 'DF', 'ES', 'PB', 'PI', 'RJ', 'RN', 'RO', 'RR', 'SC', 'SE', 'TO'] as const;

export const SVRS_HOSTS: Record<Ambiente, string> = {
  producao: 'nfce.svrs.rs.gov.br',
  homologacao: 'nfce-homologacao.svrs.rs.gov.br',
};

/** Tabela embutida (parcial). Complementar via `endpoints` na configuração. */
export const ENDPOINTS: Partial<Record<string, EndpointsUF>> = {
  SP: {
    producao: sp('nfce.fazenda.sp.gov.br', 'www.nfce.fazenda.sp.gov.br'),
    homologacao: sp('homologacao.nfce.fazenda.sp.gov.br', 'www.homologacao.nfce.fazenda.sp.gov.br'),
  },
  MG: {
    producao: mg('nfce.fazenda.mg.gov.br', 'https://portalsped.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml', 'https://portalsped.fazenda.mg.gov.br/portalnfce'),
    homologacao: mg('hnfce.fazenda.mg.gov.br', 'https://hportalsped.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml', 'https://hportalsped.fazenda.mg.gov.br/portalnfce'),
  },
  PR: {
    producao: pr('nfce.sefa.pr.gov.br', 'http://www.fazenda.pr.gov.br/nfce/qrcode', 'http://www.fazenda.pr.gov.br/nfce/consulta'),
    homologacao: pr('homologacao.nfce.sefa.pr.gov.br', 'http://www.fazenda.pr.gov.br/nfce/qrcode', 'http://www.fazenda.pr.gov.br/nfce/consulta'),
  },
};

export type EndpointsOverride = {
  [uf: string]: { [A in Ambiente]?: Partial<Omit<EndpointsAmbiente, 'servicos'>> & { servicos?: Partial<Record<Servico, string>> } };
};

/** Resolve endpoints da UF/ambiente, aplicando sobreposições do usuário. */
export function resolverEndpoints(uf: string, ambiente: Ambiente, override?: EndpointsOverride): EndpointsAmbiente {
  const base: EndpointsAmbiente | undefined =
    ENDPOINTS[uf]?.[ambiente] ??
    ((UFS_SVRS as readonly string[]).includes(uf) ? svrs(SVRS_HOSTS[ambiente], '', '') : undefined);
  const ov = override?.[uf]?.[ambiente];
  if (!base && !ov?.servicos) {
    throw new NfceError(`Endpoints da UF ${uf} (${ambiente}) não cadastrados. Informe-os em \`endpoints\` (veja nfce.encat.org).`, 'ENDPOINT_AUSENTE');
  }
  const merged: EndpointsAmbiente = {
    servicos: { ...(base?.servicos ?? ({} as Record<Servico, string>)), ...(ov?.servicos ?? {}) } as Record<Servico, string>,
    qrCode: ov?.qrCode ?? base?.qrCode ?? '',
    urlChave: ov?.urlChave ?? base?.urlChave ?? '',
  };
  return merged;
}
