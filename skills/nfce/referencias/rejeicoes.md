# Rejeições comuns (saída 2)

A saída traz `cStat`, `xMotivo` e, quando conhecida, `dica`. Depois de corrigir, use
`nfce reemitir <chave> venda.json` (mantém o número; evita buraco na numeração).

| cStat | Causa | Correção |
|---|---|---|
| 204 | Duplicidade: a nota já foi autorizada | `nfce consultar <chave>`; não emita de novo |
| 213 | Certificado de outra empresa (raiz do CNPJ) | trocar o certificado no config |
| 225 | Falha de schema XML | `nfce validar` e corrigir os campos |
| 228 | Data de emissão antiga | emitir sem o campo `emissao` |
| 280/281 | Certificado inválido/vencido | renovar o certificado A1 |
| 539 | Número já usado com outra chave | não reutilizar o número; emitir sem `numero` |
| 704 | Emissão atrasada | `nfce reemitir <chave> venda.json` |
| 778 | NCM inexistente | corrigir o `ncm` do item |
| 1115 | IBS/CBS ausente (Regime Normal) | incluir `ibsCbs.cClassTrib` em cada item |
| 108/109 | SEFAZ paralisada | contingência (ver contingencia.md) |

`denegada` (uso denegado) é irregularidade cadastral do emitente: **não reemita**; avise o usuário para falar com o contador.
