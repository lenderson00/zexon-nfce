---
name: nfce
description: Emite e opera NFC-e (nota fiscal de consumidor eletrônica, modelo 65) pela CLI `nfce` do pacote @zexon/nfce — montar o arquivo da venda, validar, emitir, contingência (offline/EPEC), consultar, cancelar, inutilizar e gerar o DANFCE. Use quando o usuário pedir para emitir nota fiscal de consumidor, "cupom fiscal", NFC-e, CPF na nota, cancelar ou consultar uma NFC-e.
---

# NFC-e com a CLI `nfce`

A CLI emite **direto na SEFAZ** com o certificado A1 da máquina. Toda saída é **um JSON** com `ok`; decida o próximo
passo pelo **código de saída** e pelo campo `proximoPasso`.

| Saída | Significado | O que fazer |
|---|---|---|
| 0 | ok | seguir `proximoPasso` |
| 1 | venda inválida | corrigir os campos de `erros[]` (cada um tem `campo`, `mensagem`, `sugestao`) e validar de novo |
| 2 | rejeitada pela SEFAZ | ler `cStat`/`xMotivo`/`dica`; corrigir e `nfce reemitir <chave> venda.json` |
| 3 | temporário/pendente | **não** emitir outra nota; rodar `nfce pendentes --processar` depois |
| 4 | configuração/certificado | rodar `nfce doctor` e mostrar ao usuário o que falta |
| 5 | uso incorreto | ler `mensagem` (ex.: produção sem `--producao`) |

Execute com `npx @zexon/nfce <comando>` (ou `nfce <comando>` se instalado).

## Regras de segurança (obrigatórias)

- **Nunca** peça, leia, mostre ou grave a senha do certificado ou o CSC. Eles ficam em variáveis de ambiente
  (`NFCE_CERT_SENHA`, `NFCE_CSC`) que o **usuário** define. Não abra o `.pfx`.
- **Homologação primeiro.** Só use `--producao` quando o usuário pedir explicitamente para emitir com valor fiscal.
- Sempre passe `--referencia <id-único-da-venda>` ao emitir. Repetir o comando com a mesma referência devolve a mesma
  nota — nunca duas. Sem referência, uma repetição pode gerar nota em dobro.
- Nunca invente NCM, CFOP ou tributação: use o que o usuário/cadastro informar; na dúvida, pergunte.
- Cancelar e inutilizar só com pedido explícito do usuário.

## Fluxo

1. **Configuração (uma vez):** se não houver `nfce.config.json`, rode `nfce init --uf SP --cnpj ... --razao-social ...
   --ie ... --crt 1 --certificado ./certificado.pfx [--csc-id 1]`, peça ao usuário para completar os campos em
   `faltando` e definir as variáveis de `segredos`. Depois `nfce doctor` até `ok: true`.
2. **Montar a venda:** comece de `nfce exemplo simples` (ou `pix`, `cartao`, `cpf`, `regime-normal`) e consulte
   `nfce schema nota`. Grave em um arquivo, ex. `venda-123.json`. Detalhes em [referencias/formato-nota.md](referencias/formato-nota.md).
3. **Validar:** `nfce validar venda-123.json` — repita até `ok: true`. Não emita venda inválida.
4. **Emitir:** `nfce emitir venda-123.json --referencia 123`.
   - `autorizada` → entregue `arquivos.danfce` (PDF) e/ou `qrCode` ao consumidor.
   - `contingencia` → entregue o DANFCE de contingência; agende `nfce pendentes --processar`.
   - `pendente` (saída 3) → não emita de novo; `nfce pendentes --processar` em alguns minutos.
   - `rejeitada` (saída 2) → ver [referencias/rejeicoes.md](referencias/rejeicoes.md).
5. **Rotina:** `nfce pendentes --processar` periodicamente (contingência tem prazo legal) e `nfce buracos` no fim do mês.

Outros comandos: `nfce previa` (monta sem enviar), `nfce consultar <chave>`, `nfce status`, `nfce cancelar <chave>
--justificativa "..."`, `nfce substituir <chave> --por <chave>`, `nfce inutilizar --inicio N --fim N --justificativa
"..."`, `nfce reemitir <chave> venda.json`, `nfce danfce <chave> [--html]`. Contingência e EPEC:
[referencias/contingencia.md](referencias/contingencia.md). Cancelamento: [referencias/cancelamento.md](referencias/cancelamento.md).
Tributação: [referencias/tributacao.md](referencias/tributacao.md).

Para ler a venda da entrada padrão use `-`: `cat venda.json | nfce validar -`.
