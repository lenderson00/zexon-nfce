# Contingência

Quando a SEFAZ não responde, a CLI já cuida do caso mais comum: com `contingenciaAutomatica: true` (padrão) e falha
**certa** (conexão recusada, SEFAZ 108/109), `nfce emitir` emite offline com o mesmo número e devolve
`status: "contingencia"`. Entregue o DANFCE ao consumidor normalmente.

Se `nfce emitir` devolver **saída 3** (`pendente`): a SEFAZ pode ter recebido a nota. **Não emita outra.** Rode
`nfce pendentes --processar` em alguns minutos.

Manual (SEFAZ sabidamente fora antes de tentar):
- `nfce contingencia offline venda.json --referencia ID` — qualquer UF que aceite offline (SP aceita desde a Portaria SRE 40/2024).
- `nfce contingencia epec venda.json --referencia ID` — **só SP**; em produção a SEFAZ-SP só aceita EPEC quando o
  ambiente normal está fora. Se o EPEC for rejeitado, o número é liberado: use `contingencia offline`.

**Prazo:** notas de contingência devem ser transmitidas até o fim do primeiro dia útil seguinte (algumas UFs: 24 h).
Rode `nfce pendentes --processar` periodicamente; `nfce pendentes` mostra `prazo.situacao` (`ok`/`alerta`/`vencido`).
Com EPEC vencido a SEFAZ-SP bloqueia novos EPEC do emitente.
