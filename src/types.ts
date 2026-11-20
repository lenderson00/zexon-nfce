// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
import type { UF } from './xml/chave.js';
import type { IbsCbsItem } from './rtc/index.js';

export type { IbsCbsItem };

export type Ambiente = 'producao' | 'homologacao';

export interface Endereco {
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  /** Código IBGE do município (7 dígitos). */
  codigoMunicipio: number | string;
  municipio: string;
  uf: UF;
  cep: string;
  fone?: string;
}

export interface Emitente {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia?: string;
  endereco: Endereco;
  inscricaoEstadual: string;
  inscricaoMunicipal?: string;
  cnae?: string;
  /** 1=Simples Nacional; 2=Simples (excesso sublimite); 3=Regime Normal; 4=MEI. */
  regimeTributario: 1 | 2 | 3 | 4;
}

export interface Consumidor {
  cpf?: string;
  cnpj?: string;
  idEstrangeiro?: string;
  nome?: string;
  email?: string;
  /** Obrigatório apenas para entrega em domicílio (indPres=4). */
  endereco?: Endereco;
}

/** Tributação de ICMS do item. `cst` p/ regime normal; `csosn` p/ Simples Nacional. */
export type IcmsItem =
  | { csosn: '101'; origem: Origem; aliquotaCreditoSN: number; valorCreditoSN?: number }
  | { csosn: '102' | '103' | '300' | '400'; origem: Origem }
  | { csosn: '500'; origem: Origem; baseSTRetido?: number; aliquotaST?: number; valorSTRetido?: number; valorICMSSubstituto?: number }
  | { csosn: '900'; origem: Origem; baseCalculo?: number; aliquota?: number; valor?: number; aliquotaCreditoSN?: number; valorCreditoSN?: number }
  | { cst: '00'; origem: Origem; baseCalculo?: number; aliquota: number; valor?: number }
  | { cst: '20'; origem: Origem; baseCalculo?: number; reducaoBase: number; aliquota: number; valor?: number }
  | { cst: '40' | '41' | '50'; origem: Origem }
  | { cst: '60'; origem: Origem; baseSTRetido?: number; aliquotaST?: number; valorSTRetido?: number; valorICMSSubstituto?: number }
  | { cst: '90'; origem: Origem; baseCalculo?: number; aliquota?: number; valor?: number };

export type Origem = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** PIS/COFINS: aliquota (CST 01/02), quantidade (03), nao-tributado (04-09) ou outras (49, 50-99). */
export type PisCofins =
  | { cst: '01' | '02'; baseCalculo?: number; aliquota: number; valor?: number }
  | { cst: '04' | '05' | '06' | '07' | '08' | '09' }
  | { cst: string; baseCalculo?: number; aliquota?: number; valor?: number };

export interface Item {
  codigo: string;
  /** GTIN/EAN válido (8,12,13,14 dígitos). Omitir => "SEM GTIN". */
  gtin?: string;
  descricao: string;
  ncm: string;
  cest?: string;
  cfop: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  desconto?: number;
  frete?: number;
  seguro?: number;
  outrasDespesas?: number;
  icms: IcmsItem;
  pis?: PisCofins;
  cofins?: PisCofins;
  /** Valor aproximado dos tributos (Lei 12.741). */
  valorTributosAprox?: number;
  /** IBS/CBS (reforma tributária). Obrigatório para Regime Normal (CRT 3) a partir de 2026. */
  ibsCbs?: IbsCbsItem;
  informacoesAdicionais?: string;
}

/** Meios de pagamento (tPag). */
export type MeioPagamento =
  | 'dinheiro' | 'cheque' | 'cartao_credito' | 'cartao_debito' | 'credito_loja' | 'vale_alimentacao'
  | 'vale_refeicao' | 'vale_presente' | 'vale_combustivel' | 'boleto' | 'deposito' | 'pix'
  | 'transferencia' | 'programa_fidelidade' | 'sem_pagamento' | 'outros';

export const TPAG: Record<MeioPagamento, string> = {
  dinheiro: '01', cheque: '02', cartao_credito: '03', cartao_debito: '04', credito_loja: '05',
  vale_alimentacao: '10', vale_refeicao: '11', vale_presente: '12', vale_combustivel: '13',
  boleto: '15', deposito: '16', pix: '17', transferencia: '18', programa_fidelidade: '19',
  sem_pagamento: '90', outros: '99',
};

export interface Pagamento {
  tipo: MeioPagamento | string;
  valor: number;
  /** Descrição do meio quando tipo = outros (99). */
  descricao?: string;
  /** Dados do cartão (obrigatório para cartão/PIX conforme integração). */
  cartao?: { integrado: boolean; cnpjCredenciadora?: string; bandeira?: string; autorizacao?: string };
}

export interface ResponsavelTecnico {
  cnpj: string;
  contato: string;
  email: string;
  fone: string;
  /** CSRT para gerar hashCSRT (opcional; exigido por algumas UFs). */
  csrt?: { id: string; token: string };
}

export interface NotaNfce {
  emitente: Emitente;
  serie: number;
  numero: number;
  itens: Item[];
  pagamentos: Pagamento[];
  consumidor?: Consumidor;
  naturezaOperacao?: string;
  /** 1=presencial (padrão), 4=entrega em domicílio, 5=presencial fora do estabelecimento. */
  indicadorPresenca?: 1 | 4 | 5;
  /** Município (IBGE) do fato gerador do IBS/CBS (cMunFGIBS). Usado só com indicadorPresenca=5; padrão: município do emitente. */
  municipioFatoGerador?: number | string;
  /** Data de emissão (padrão: agora). */
  emissao?: Date;
  informacoesComplementares?: string;
  responsavelTecnico?: ResponsavelTecnico;
  /** Versão/nome do software emissor (verProc). */
  versaoSoftware?: string;
}

export interface Csc {
  /** Identificador do CSC (idToken), sem zeros à esquerda. */
  id: number | string;
  /** Código de Segurança do Contribuinte. */
  codigo: string;
}

export interface Certificado {
  /** Conteúdo do PFX (A1) ou caminho do arquivo. */
  pfx: Buffer | string;
  senha: string;
}

export type VersaoQrCode = 2 | 3;

export interface Totais {
  vProd: number; vDesc: number; vFrete: number; vSeg: number; vOutro: number;
  vBC: number; vICMS: number; vICMSDeson: number; vPIS: number; vCOFINS: number; vTotTrib: number; vNF: number;
  /** Presente quando algum item tem IBS/CBS. */
  ibsCbs?: { vBC: number; vIBSUF: number; vIBSMun: number; vIBS: number; vCBS: number; vNFTot: number };
}
