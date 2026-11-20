// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
import type { NotaArquivo } from './nota.js';

const refri = { codigo: '001', descricao: 'REFRIGERANTE LATA 350ML', ncm: '22021000', cfop: '5102', unidade: 'UN', quantidade: 2, valorUnitario: 5.5, icms: { csosn: '102' as const, origem: 0 as const } };
const salgado = { codigo: '002', gtin: '7891000100103', descricao: 'SALGADO ASSADO', ncm: '19059090', cfop: '5102', unidade: 'UN', quantidade: 1, valorUnitario: 8, desconto: 1, icms: { csosn: '102' as const, origem: 0 as const } };

/** Notas de exemplo válidas (Simples Nacional, salvo `regime-normal`). Usadas por `nfce exemplo` e pelos testes. */
export const EXEMPLOS: Record<string, { descricao: string; nota: NotaArquivo }> = {
  simples: { descricao: 'Venda em dinheiro, sem CPF (Simples Nacional).', nota: { itens: [refri], pagamentos: [{ tipo: 'dinheiro', valor: 20 }] } },
  pix: { descricao: 'Dois itens, pagamento em PIX.', nota: { itens: [refri, salgado], pagamentos: [{ tipo: 'pix', valor: 18 }] } },
  cartao: {
    descricao: 'Cartão de crédito em maquininha não integrada.',
    nota: { itens: [refri], pagamentos: [{ tipo: 'cartao_credito', valor: 11, cartao: { integrado: false } }] },
  },
  cpf: { descricao: 'CPF na nota, com e-mail do consumidor.', nota: { itens: [salgado], pagamentos: [{ tipo: 'dinheiro', valor: 10 }], consumidor: { cpf: '52998224725', email: 'cliente@exemplo.com.br' } } },
  'regime-normal': {
    descricao: 'Regime Normal (CRT 3): ICMS CST 00 e IBS/CBS (cClassTrib 000001). Use com um emitente CRT 3.',
    nota: {
      itens: [{ codigo: '010', descricao: 'CAFE TORRADO 500G', ncm: '09012100', cfop: '5102', unidade: 'UN', quantidade: 1, valorUnitario: 25.9, icms: { cst: '00', origem: 0, aliquota: 18 }, pis: { cst: '01', aliquota: 1.65 }, cofins: { cst: '01', aliquota: 7.6 }, ibsCbs: { cClassTrib: '000001' } }],
      pagamentos: [{ tipo: 'cartao_debito', valor: 25.9, cartao: { integrado: false } }],
    },
  },
};
