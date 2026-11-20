# Tributação (resumo para montar a venda)

Use **sempre** a tributação do cadastro do produto ou a indicada pelo usuário/contador. Este resumo só ajuda a montar o JSON.

## Simples Nacional / MEI (config `regimeTributario` 1 ou 4)
- ICMS por **CSOSN**: o comum é `{ "csosn": "102", "origem": 0 }` (tributado pelo Simples, sem crédito).
  `"500"` = ICMS já retido por ST (use CFOP 5405). `"103"` = isento no Simples.
- PIS/COFINS: pode omitir (a biblioteca aplica o padrão do Simples).
- IBS/CBS: não exigido do Simples até 2027.

## Regime Normal (config `regimeTributario` 3)
- ICMS por **CST**: `{ "cst": "00", "origem": 0, "aliquota": 18 }` (tributado), `"40"` isento, `"41"` não tributado,
  `"60"` ST retida anteriormente.
- PIS/COFINS: ex. `{ "cst": "01", "aliquota": 1.65 }` e `{ "cst": "01", "aliquota": 7.6 }` (não cumulativo).
- **IBS/CBS obrigatório desde 2026** em cada item: `"ibsCbs": { "cClassTrib": "000001" }` (tributação integral) ou o
  cClassTrib correto do produto. Sem ele a SEFAZ rejeita (1115).

## Origem
`0` nacional; `1`/`2` estrangeira (importação direta/adquirida no mercado interno); demais conforme a ficha do produto.
