# Formato do arquivo da venda

O JSON completo está em `nfce schema nota`. A venda **não** leva emitente, UF nem certificado (vêm do config).

```json
{
  "itens": [
    { "codigo": "001", "descricao": "REFRIGERANTE LATA 350ML", "ncm": "22021000", "cfop": "5102",
      "unidade": "UN", "quantidade": 2, "valorUnitario": 5.5, "icms": { "csosn": "102", "origem": 0 } }
  ],
  "pagamentos": [{ "tipo": "pix", "valor": 11 }],
  "consumidor": { "cpf": "52998224725" }
}
```

Regras práticas:
- **Valores em reais** (número, até 2 casas): `5.5`, não `"5,50"`. Quantidade até 4 casas.
- `itens[].ncm`: 8 dígitos, só números. `cfop`: 5102 (revenda) / 5101 (produção própria) / 5405 (com ST).
- `itens[].gtin`: só se o produto tiver código de barras; senão omita.
- `pagamentos`: a soma deve cobrir o total da nota. Troco só com `dinheiro` (o excedente vira troco).
  Tipos: `dinheiro`, `pix`, `cartao_credito`, `cartao_debito`, `vale_alimentacao`, `vale_refeicao`, `boleto`,
  `transferencia`, `outros` (com `descricao`). Cartão: `"cartao": { "integrado": false }` se a maquininha não é integrada.
- `consumidor`: opcional (CPF na nota). Obrigatório para vendas acima de R$ 10.000 e em entrega em domicílio
  (`indicadorPresenca: 4`, com `consumidor.endereco`).
- Não informe `numero` (a CLI numera) nem `emissao` (agora), salvo instrução específica.
- Campos desconhecidos são rejeitados — use exatamente os nomes do schema.
