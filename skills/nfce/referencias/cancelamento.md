# Cancelamento, substituição e inutilização

Só com pedido explícito do usuário.

- **Cancelar** uma nota autorizada: `nfce cancelar <chave> --justificativa "Cliente desistiu da compra no caixa"`
  (15 a 255 caracteres; prazo definido pela UF, em geral de 30 min a 24 h).
- **Cancelar por substituição** (a venda ficou com duas notas autorizadas, ex.: uma online e outra de contingência):
  `nfce substituir <chave-a-cancelar> --por <chave-que-fica> --justificativa "..."`.
- **Inutilizar** números que não serão usados (buracos): `nfce buracos` e depois
  `nfce inutilizar --inicio N --fim N --justificativa "..."` (até o dia 10 do mês seguinte).
- Não existe cancelar um EPEC: autorize a NFC-e (`nfce pendentes --processar`) e depois cancele-a.
