// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
/**
 * JSON Schemas da CLI (fonte única). `schemas/cli/*.schema.json` são cópias publicadas — um teste garante que batem.
 * Descrições em português, pensadas para quem monta o arquivo (pessoa ou IA).
 */
import { TPAG } from '../types.js';

const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
const dinheiro = (description: string) => ({ type: 'number', minimum: 0, multipleOf: 0.01, description });
const digitos = (n: number | string, description: string) => ({ type: 'string', pattern: `^\\d{${n}}$`, description });
const origem = { type: 'integer', minimum: 0, maximum: 8, description: 'Origem da mercadoria (0 = nacional).' };

const endereco = {
  type: 'object',
  additionalProperties: false,
  required: ['logradouro', 'numero', 'bairro', 'codigoMunicipio', 'municipio', 'uf', 'cep'],
  properties: {
    logradouro: { type: 'string', minLength: 2, maxLength: 60 },
    numero: { type: 'string', minLength: 1, maxLength: 60 },
    complemento: { type: 'string', maxLength: 60 },
    bairro: { type: 'string', minLength: 2, maxLength: 60 },
    codigoMunicipio: { oneOf: [digitos(7, 'Código IBGE do município (7 dígitos).'), { type: 'integer', minimum: 1000000, maximum: 9999999 }] },
    municipio: { type: 'string', minLength: 2, maxLength: 60 },
    uf: { enum: UFS },
    cep: { type: 'string', pattern: '^\\d{5}-?\\d{3}$', description: 'CEP (8 dígitos).' },
    fone: { type: 'string', pattern: '^\\d{6,14}$' },
  },
};

const icms = {
  description: 'ICMS do item. Simples Nacional (CRT 1/4) usa `csosn` (o mais comum é "102"); Regime Normal (CRT 3) usa `cst`.',
  oneOf: [
    { type: 'object', additionalProperties: false, required: ['csosn', 'origem'], properties: { csosn: { enum: ['102', '103', '300', '400'] }, origem } },
    { type: 'object', additionalProperties: false, required: ['csosn', 'origem', 'aliquotaCreditoSN'], properties: { csosn: { const: '101' }, origem, aliquotaCreditoSN: { type: 'number', minimum: 0, maximum: 100 }, valorCreditoSN: dinheiro('Crédito de ICMS (R$).') } },
    { type: 'object', additionalProperties: false, required: ['csosn', 'origem'], properties: { csosn: { const: '500' }, origem, baseSTRetido: dinheiro(''), aliquotaST: { type: 'number' }, valorSTRetido: dinheiro(''), valorICMSSubstituto: dinheiro('') } },
    { type: 'object', additionalProperties: false, required: ['csosn', 'origem'], properties: { csosn: { const: '900' }, origem, baseCalculo: dinheiro(''), aliquota: { type: 'number' }, valor: dinheiro(''), aliquotaCreditoSN: { type: 'number' }, valorCreditoSN: dinheiro('') } },
    { type: 'object', additionalProperties: false, required: ['cst', 'origem', 'aliquota'], properties: { cst: { const: '00' }, origem, baseCalculo: dinheiro(''), aliquota: { type: 'number', minimum: 0, maximum: 100, description: 'Alíquota em %.' }, valor: dinheiro('') } },
    { type: 'object', additionalProperties: false, required: ['cst', 'origem', 'reducaoBase', 'aliquota'], properties: { cst: { const: '20' }, origem, baseCalculo: dinheiro(''), reducaoBase: { type: 'number' }, aliquota: { type: 'number' }, valor: dinheiro('') } },
    { type: 'object', additionalProperties: false, required: ['cst', 'origem'], properties: { cst: { enum: ['40', '41', '50'] }, origem } },
    { type: 'object', additionalProperties: false, required: ['cst', 'origem'], properties: { cst: { const: '60' }, origem, baseSTRetido: dinheiro(''), aliquotaST: { type: 'number' }, valorSTRetido: dinheiro(''), valorICMSSubstituto: dinheiro('') } },
    { type: 'object', additionalProperties: false, required: ['cst', 'origem'], properties: { cst: { const: '90' }, origem, baseCalculo: dinheiro(''), aliquota: { type: 'number' }, valor: dinheiro('') } },
  ],
};

const pisCofins = {
  type: 'object', additionalProperties: false, required: ['cst'],
  description: 'PIS ou COFINS. Simples Nacional normalmente "49" ou omite (padrão da lib). CST 01/02 exigem `aliquota` (%).',
  properties: { cst: digitos(2, 'CST de PIS/COFINS.'), baseCalculo: dinheiro(''), aliquota: { type: 'number', minimum: 0, maximum: 100 }, valor: dinheiro('') },
};

const item = {
  type: 'object', additionalProperties: false,
  required: ['codigo', 'descricao', 'ncm', 'cfop', 'unidade', 'quantidade', 'valorUnitario', 'icms'],
  properties: {
    codigo: { type: 'string', minLength: 1, maxLength: 60, description: 'Código do produto no seu cadastro.' },
    gtin: { type: 'string', pattern: '^(\\d{8}|\\d{12,14})$', description: 'Código de barras (EAN/GTIN). Omita se não tiver ("SEM GTIN").' },
    descricao: { type: 'string', minLength: 1, maxLength: 120 },
    ncm: digitos(8, 'NCM do produto (8 dígitos). Ex.: 22021000 refrigerante, 21069090 preparações alimentícias.'),
    cest: digitos(7, 'CEST (só para produtos sujeitos a ST).'),
    cfop: { type: 'string', pattern: '^5\\d{3}$', description: 'CFOP de venda interna. Normalmente 5102 (revenda) ou 5101 (produção própria); 5405 com ST.' },
    unidade: { type: 'string', minLength: 1, maxLength: 6, description: 'UN, KG, LT, CX...' },
    quantidade: { type: 'number', exclusiveMinimum: 0, description: 'Até 4 casas decimais.' },
    valorUnitario: { type: 'number', minimum: 0, description: 'Preço unitário em reais (até 10 casas; o total do item é arredondado a centavos).' },
    desconto: dinheiro('Desconto do item em reais.'),
    frete: dinheiro(''), seguro: dinheiro(''), outrasDespesas: dinheiro(''),
    icms, pis: pisCofins, cofins: pisCofins,
    valorTributosAprox: dinheiro('Tributos aproximados (Lei 12.741/IBPT).'),
    ibsCbs: {
      type: 'object', additionalProperties: false, required: ['cClassTrib'],
      description: 'IBS/CBS (reforma tributária). Obrigatório no Regime Normal (CRT 3) desde 2026. Ex.: { "cClassTrib": "000001" } = tributação integral.',
      properties: { cClassTrib: digitos(6, 'Classificação tributária (6 dígitos).'), aliquotaIBSUF: { type: 'number' }, aliquotaIBSMun: { type: 'number' }, aliquotaCBS: { type: 'number' }, baseCalculo: dinheiro(''), doacao: { type: 'boolean' } },
    },
    informacoesAdicionais: { type: 'string', maxLength: 500 },
  },
};

export const SCHEMA_NOTA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://github.com/lenderson00/zexon-nfce/schemas/cli/nota.schema.json',
  title: 'Venda para NFC-e (arquivo da CLI `nfce`)',
  description: 'Uma venda a consumidor. Emitente, série, UF e certificado vêm do nfce.config.json — não os repita aqui. Valores em reais.',
  type: 'object', additionalProperties: false,
  required: ['itens', 'pagamentos'],
  properties: {
    $schema: { type: 'string' },
    numero: { type: 'integer', minimum: 1, maximum: 999999999, description: 'Omita: a CLI numera sozinha (recomendado).' },
    serie: { type: 'integer', minimum: 0, maximum: 889, description: 'Omita para usar a série do config.' },
    emissao: { type: 'string', format: 'date-time', description: 'Omita (agora). Só use para reprocessar uma venda específica.' },
    itens: { type: 'array', minItems: 1, maxItems: 990, items: item },
    pagamentos: {
      type: 'array', minItems: 1, maxItems: 100,
      description: 'A soma deve cobrir o total. Troco só com dinheiro (o excedente vira troco).',
      items: {
        type: 'object', additionalProperties: false, required: ['tipo', 'valor'],
        properties: {
          tipo: { anyOf: [{ enum: Object.keys(TPAG) }, digitos(2, 'Código tPag.')], description: 'dinheiro, pix, cartao_credito, cartao_debito, ...' },
          valor: dinheiro('Valor pago neste meio.'),
          descricao: { type: 'string', maxLength: 60, description: 'Obrigatório quando tipo = outros.' },
          cartao: {
            type: 'object', additionalProperties: false, required: ['integrado'],
            properties: { integrado: { type: 'boolean', description: 'true se a maquininha é integrada ao sistema (TEF).' }, cnpjCredenciadora: digitos(14, ''), bandeira: { type: 'string' }, autorizacao: { type: 'string', maxLength: 128 } },
          },
        },
      },
    },
    consumidor: {
      type: 'object', additionalProperties: false,
      description: 'Opcional ("CPF na nota"). Obrigatório acima de R$ 10.000 ou na entrega em domicílio.',
      properties: {
        cpf: digitos(11, 'CPF só com dígitos.'), cnpj: digitos(14, 'CNPJ só com dígitos.'), idEstrangeiro: { type: 'string', maxLength: 20 },
        nome: { type: 'string', maxLength: 60 }, email: { type: 'string', format: 'email' }, endereco,
      },
    },
    indicadorPresenca: { enum: [1, 4, 5], description: '1 presencial (padrão), 4 entrega em domicílio, 5 presencial fora do estabelecimento.' },
    naturezaOperacao: { type: 'string', maxLength: 60 },
    informacoesComplementares: { type: 'string', maxLength: 2000 },
  },
  examples: [{ itens: [{ codigo: '001', descricao: 'REFRIGERANTE LATA 350ML', ncm: '22021000', cfop: '5102', unidade: 'UN', quantidade: 2, valorUnitario: 5.5, icms: { csosn: '102', origem: 0 } }], pagamentos: [{ tipo: 'pix', valor: 11 }] }],
} as const;

export const SCHEMA_CONFIG = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://github.com/lenderson00/zexon-nfce/schemas/cli/config.schema.json',
  title: 'Configuração da CLI `nfce` (nfce.config.json)',
  description: 'Dados do emitente e do ambiente. NUNCA coloque senha do certificado ou CSC aqui: informe o NOME da variável de ambiente.',
  type: 'object', additionalProperties: false,
  required: ['uf', 'ambiente', 'serie', 'emitente', 'certificado'],
  properties: {
    $schema: { type: 'string' },
    uf: { enum: UFS },
    ambiente: { enum: ['homologacao', 'producao'], description: 'Comece em homologação. Produção exige também a flag --producao em cada emissão.' },
    serie: { type: 'integer', minimum: 0, maximum: 889 },
    emitente: {
      type: 'object', additionalProperties: false,
      required: ['cnpj', 'razaoSocial', 'inscricaoEstadual', 'regimeTributario', 'endereco'],
      properties: {
        cnpj: digitos(14, 'CNPJ do estabelecimento.'), razaoSocial: { type: 'string', minLength: 2, maxLength: 60 }, nomeFantasia: { type: 'string', maxLength: 60 },
        inscricaoEstadual: { type: 'string', pattern: '^(\\d{2,14}|ISENTO)$' }, inscricaoMunicipal: { type: 'string' }, cnae: digitos(7, ''),
        regimeTributario: { enum: [1, 2, 3, 4], description: '1 Simples Nacional, 2 Simples (excesso de sublimite), 3 Regime Normal, 4 MEI.' },
        endereco,
      },
    },
    certificado: {
      type: 'object', additionalProperties: false, required: ['arquivo'],
      properties: {
        arquivo: { type: 'string', description: 'Caminho do .pfx A1 (relativo ao config). Não o coloque no git.' },
        senhaEnv: { type: 'string', pattern: '^[A-Z_][A-Z0-9_]*$', default: 'NFCE_CERT_SENHA', description: 'Nome da variável de ambiente com a senha.' },
      },
    },
    csc: {
      type: 'object', additionalProperties: false, required: ['id'],
      description: 'CSC do QR Code v2. Sem ele, usa o QR Code v3 (só onde a UF aceita).',
      properties: { id: { type: 'integer', minimum: 1 }, codigoEnv: { type: 'string', pattern: '^[A-Z_][A-Z0-9_]*$', default: 'NFCE_CSC' } },
    },
    dados: { type: 'string', default: '.nfce', description: 'Pasta do estado local (XMLs, registro, numeração, DANFCE).' },
    contingenciaAutomatica: { type: 'boolean', default: true, description: 'Emite offline automaticamente quando é certo que a SEFAZ não recebeu.' },
    prazoContingencia: { type: 'object', additionalProperties: false, properties: { horas: { type: 'number', minimum: 1 }, alertaHoras: { type: 'number', minimum: 1 } } },
    versaoSoftware: { type: 'string', maxLength: 20 },
    casAdicionaisDir: { type: 'string', description: 'Pasta com a cadeia ICP-Brasil (PEM/DER) dos servidores da SEFAZ.' },
    timeoutMs: { type: 'integer', minimum: 1000 },
  },
} as const;
