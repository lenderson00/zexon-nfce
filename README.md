# zexon-nfce

Biblioteca TypeScript/Node.js para operar a **NFC-e — Nota Fiscal de Consumidor Eletrônica (modelo 65, leiaute 4.00)** no dia a dia do varejo: emitir, consultar, cancelar, inutilizar, trabalhar em contingência offline e imprimir o DANFCE.

```ts
const r = await nfce.emitir(nota);
if (r.status === 'autorizada') await imprimir(await nfce.danfcePdf(r.xmlAutorizado!));
```

<p align="center"><img src="docs/img/danfce-exemplo.png" alt="DANFCE gerado pela biblioteca: nota autorizada e nota em contingência" width="620"></p>

---

## Sumário

- [Situação do projeto](#situação-do-projeto)
- [Recursos](#recursos)
- [Instalação](#instalação)
- [Primeiros passos](#primeiros-passos)
- [Montando a nota](#montando-a-nota)
- [Rotina diária (API)](#rotina-diária-api)
- [Reforma tributária (IBS/CBS)](#reforma-tributária-ibscbs)
- [Contingência offline](#contingência-offline)
- [DANFCE](#danfce)
- [Armazenamento dos XMLs](#armazenamento-dos-xmls)
- [Registro, numeração e resiliência](#registro-numeração-e-resiliência)
- [Configuração](#configuração)
- [URLs por UF (endpoints)](#urls-por-uf-endpoints)
- [Certificado e TLS](#certificado-e-tls)
- [Tratamento de erros](#tratamento-de-erros)
- [Checklist de homologação](#checklist-de-homologação)
- [Arquitetura](#arquitetura)
- [Desenvolvimento](#desenvolvimento)
- [Fontes oficiais](#fontes-oficiais)

---

## Situação do projeto

> **Versão 0.3 — pronta para homologação (Simples Nacional e Regime Normal com IBS/CBS).**
> Ainda não testada contra uma SEFAZ real; os testes usam uma SEFAZ simulada e os XSDs oficiais.

| Tema | Situação |
|---|---|
| Emissão, consulta, cancelamento, inutilização, status | ✅ Implementado |
| Contingência offline (`tpEmis=9`) e retransmissão | ✅ Implementado |
| Emissão resiliente: grava antes de enviar, retentativas, `retomar`, `processarPendentes` | ✅ Implementado |
| Registro das notas em banco e numeração automática (Postgres incluso) | ✅ Implementado (interfaces abertas para outros bancos) |
| QR Code v2 (com CSC) e v3 (sem CSC) | ✅ Implementado (v2 conferido com os exemplos do manual) |
| DANFCE em HTML e PDF (80 mm) | ✅ Implementado |
| XML validado contra o XSD oficial (PL_010h) | ✅ Coberto por testes |
| **Reforma tributária (IBS/CBS)** — Simples Nacional / MEI (CRT 1, 2, 4) | ✅ Não exigido até 2027 (NT 2025.002) |
| **Reforma tributária (IBS/CBS)** — Regime Normal (CRT 3) | ✅ Grupo `IBSCBS` por item, redução de alíquota, `IBSCBSTot`, `vItem`, `vNFTot` (NT 2025.002 v1.53; tabela cClassTrib v1.71) |
| IBS/CBS: diferimento, crédito presumido, monofásico (combustíveis), compras governamentais | ❌ Fora do escopo (raros ou proibidos em NFC-e) |
| ICMS-ST (CST 10/30/70), IPI, ISSQN, Imposto Seletivo | ❌ Fora do escopo da v0.1 |
| URLs de todas as UFs | ⚠️ Parcial: SP, MG, PR e UFs atendidas pela SVRS. As demais precisam ser informadas em `endpoints` |

---

## Recursos

- **Cliente único** (`NfceClient`) com todas as operações da rotina de caixa.
- **Builder fluente** (`NfceBuilder`) que valida a nota e devolve **todos** os erros de uma vez.
- **Assinatura digital** XMLDSig (RSA-SHA1, C14N) com certificado A1 (`.pfx`).
- **Envio síncrono** com recuperação automática:
  - em timeout/queda, consulta a chave antes de decidir (não duplica nota já autorizada);
  - duplicidade (cStat 204) recupera o protocolo existente;
  - lote assíncrono (cStat 103/105) consulta o recibo.
- **Nenhuma nota perdida:** a nota é gravada antes do envio; falhas temporárias são repetidas e o que sobrar é concluído depois por `retomar`/`processarPendentes`, sempre com a mesma chave.
- **Idempotência por pedido:** `emitir(nota, { referencia: 'pedido-123' })` nunca gera duas notas para a mesma venda.
- **Registro em banco e numeração automática** por CNPJ/série/ambiente (Postgres pronto; outros bancos via interface).
- **Contingência offline** manual ou automática, com fila de retransmissão.
- **DANFCE** em HTML (para tela/impressão pelo navegador) e PDF (impressora térmica).
- **Armazenamento plugável** dos XMLs (disco, memória ou sua implementação).
- Textos obrigatórios de **homologação** aplicados automaticamente.
- Node ≥ 20, ESM + CommonJS, tipagem completa.

---

## Instalação

```bash
npm install zexon-nfce
```

Requisitos: Node.js 20+, certificado digital **A1** do emitente e **CSC** (se usar QR Code v2), obtido no portal da SEFAZ da sua UF.

---

## Primeiros passos

```ts
import { readFileSync } from 'node:fs';
import { NfceClient, NfceBuilder, S3Storage } from 'zexon-nfce';

const nfce = new NfceClient({
  uf: 'SP',
  ambiente: 'homologacao',                       // 'producao' quando estiver pronto
  certificado: { pfx: readFileSync('certificado.pfx'), senha: process.env.CERT_SENHA! },
  csc: { id: 1, codigo: process.env.CSC! },      // sem csc => QR Code v3
  storage: new S3Storage({ bucket: 'minha-empresa-nfce' }),
  contingenciaAutomatica: true,
});

// 1) A SEFAZ está no ar?
console.log(await nfce.status()); // { online: true, cStat: '107', ... }

// 2) Monte a nota
const nota = new NfceBuilder()
  .emitente({
    cnpj: '11222333000181',
    razaoSocial: 'MERCADINHO EXEMPLO LTDA',
    inscricaoEstadual: '110042490114',
    regimeTributario: 1, // Simples Nacional
    endereco: {
      logradouro: 'AV PAULISTA', numero: '1000', bairro: 'BELA VISTA',
      codigoMunicipio: 3550308, municipio: 'SAO PAULO', uf: 'SP', cep: '01310100',
    },
  })
  .serie(1)
  .numero(4821)
  .cpfConsumidor('529.982.247-25')
  .item({
    codigo: '000123', descricao: 'CAFE TORRADO 500G', ncm: '09012100', cfop: '5102',
    unidade: 'UN', quantidade: 2, valorUnitario: 18.9,
    icms: { csosn: '102', origem: 0 },
  })
  .pagamento({ tipo: 'pix', valor: 37.8 })
  .build();

// 3) Emita
const r = await nfce.emitir(nota);

switch (r.status) {
  case 'autorizada':   console.log('Protocolo', r.protocolo); break;
  case 'contingencia': console.log('Emitida offline, será transmitida depois'); break;
  case 'rejeitada':
  case 'denegada':     console.error(r.cStat, r.xMotivo); break;
}
```

---

## Montando a nota

### Itens

| Campo | Obrigatório | Observação |
|---|---|---|
| `codigo`, `descricao` | sim | |
| `ncm` | sim | 8 dígitos |
| `cfop` | sim | 4 dígitos (ex.: `5102`, `5405`) |
| `unidade`, `quantidade`, `valorUnitario` | sim | até 4 casas decimais |
| `gtin` | não | validado pelo dígito verificador; omitido ⇒ `SEM GTIN` |
| `cest` | não | 7 dígitos |
| `desconto`, `frete`, `seguro`, `outrasDespesas` | não | por item |
| `icms` | sim | ver abaixo |
| `pis`, `cofins` | não | padrão: CST 49 com valores zerados |
| `valorTributosAprox` | não | Lei 12.741/2012, somado no total e impresso no DANFCE |
| `ibsCbs` | CRT 3 | `{ cClassTrib, aliquota*?, baseCalculo?, doacao? }` — ver [Reforma tributária](#reforma-tributária-ibscbs) |

### ICMS suportado

| Regime | Opções |
|---|---|
| Simples Nacional (`csosn`) | `101`, `102`, `103`, `300`, `400`, `500`, `900` |
| Regime Normal (`cst`) | `00`, `20`, `40`, `41`, `50`, `60`, `90` |

Quando a base e o valor não são informados, a biblioteca calcula a partir do valor do item (produto − desconto + despesas).

### Pagamentos

`tipo` aceita: `dinheiro`, `cheque`, `cartao_credito`, `cartao_debito`, `credito_loja`, `vale_alimentacao`, `vale_refeicao`, `vale_presente`, `vale_combustivel`, `boleto`, `deposito`, `pix`, `transferencia`, `programa_fidelidade`, `sem_pagamento`, `outros` — ou o código `tPag` de 2 dígitos.

- O troco (`vTroco`) é calculado automaticamente e só é aceito quando há pagamento em dinheiro.
- Cartão integrado ao TEF: informe `cartao: { integrado: true, cnpjCredenciadora, bandeira, autorizacao }`.

### Validações feitas antes do envio

CNPJ/CPF, GTIN, NCM, CFOP, CEST, município (IBGE), CEP, série (0–889), número, limite de 990 itens, CST/CSOSN compatível com o regime, desconto maior que o item, soma dos pagamentos × total da nota, endereço obrigatório na entrega em domicílio (`presenca(4)`).

---

## Rotina diária (API)

| Operação | Método | Retorno |
|---|---|---|
| Status da SEFAZ | `status()` | `{ online, cStat, xMotivo, tempoMedioSegundos }` |
| Emitir | `emitir(nota, { referencia? })` | `ResultadoEmissao` |
| Concluir nota pendente | `retomar(chave)` | `ResultadoEmissao` |
| Processar pendentes (cron/fila) | `processarPendentes({ limite?, cnpj? })` | `ResultadoEmissao[]` (nunca lança) |
| Reemitir rejeitada (mesmo número) | `reemitir(chave, notaCorrigida)` | `ResultadoEmissao` |
| Montar e assinar sem enviar | `preparar(nota, { offline? })` | `{ chave, xmlAssinado, qrCode, urlChave, totais }` |
| Consultar por chave | `consultar(chave)` | `{ situacao: 'autorizada' \| 'cancelada' \| 'denegada' \| 'inexistente' \| 'outra', protocolo, eventos }` |
| Cancelar | `cancelar({ chave, protocolo, justificativa })` | `ResultadoEvento` |
| Cancelar por substituição | `cancelarPorSubstituicao({ chave, protocolo, justificativa, chaveSubstituta })` | `ResultadoEvento` |
| Inutilizar numeração | `inutilizar({ serie, numeroInicial, numeroFinal?, justificativa })` | `ResultadoInutilizacao` |
| Emitir offline | `contingencia.emitirOffline(nota, motivo?, { referencia? })` | `ResultadoEmissao` (`status: 'contingencia'`) |
| Listar pendentes | `contingencia.pendentes()` | chaves |
| Retransmitir pendentes | `contingencia.transmitirPendentes()` | igual a `processarPendentes()` |
| DANFCE | `danfceHtml(xml)` / `danfcePdf(xml)` | `string` / `Buffer` |

### `ResultadoEmissao`

```ts
{
  status: 'autorizada' | 'rejeitada' | 'denegada' | 'contingencia'
        | 'pendente' | 'cancelada' | 'conflito';  // ver "Registro, numeração e resiliência"
  chave: string;              // 44 dígitos
  numero: number; serie: number;
  cStat: string; xMotivo: string;
  protocolo?: string; dataAutorizacao?: string;
  xmlAssinado: string;        // NFe assinada, com QR Code
  xmlAutorizado?: string;     // nfeProc (NFe + protocolo): guarde por 5 anos
  qrCode: string; urlChave: string;
  totais: { valorNota: number };
  tentativas?: number;        // tentativas de envio nesta chamada
}
```

### Exemplos

```ts
// Cancelar (justificativa de 15 a 255 caracteres)
await nfce.cancelar({ chave: r.chave, protocolo: r.protocolo!, justificativa: 'Desistencia da compra pelo cliente' });

// Inutilizar números pulados
await nfce.inutilizar({ serie: 1, numeroInicial: 4830, numeroFinal: 4835, justificativa: 'Falha no sistema pulou a numeracao' });

// Conferir uma nota
const c = await nfce.consultar('35261111222333000181650010000048211499370670');
```

---

## Reforma tributária (IBS/CBS)

Implementação conforme a **NT 2025.002-RTC v1.53** e a **tabela oficial de cClassTrib (IT 2025.002 v1.71)**, embutida na biblioteca com os 40 códigos permitidos em NFC-e.

**Quem precisa informar**

| Emitente | Obrigação |
|---|---|
| Regime Normal (CRT 3) | Obrigatório por lei desde 01/01/2026. Em homologação, a SEFAZ rejeita a nota sem o grupo (rejeição 1115) desde 01/07/2026; em produção a rejeição será ativada depois. A biblioteca **bloqueia o envio** se faltar. |
| Simples Nacional / MEI (CRT 1, 2, 4) | Só a partir de 2027 (NT futura). Hoje é opcional. |

**Uso**: informe só o `cClassTrib`; CST, alíquotas e valores são calculados.

```ts
// Em todos os itens que não informarem ibsCbs
new NfceClient({ /* ... */ ibsCbsPadrao: { cClassTrib: '000001' } }); // tributação integral

// Por item
.item({ /* ... */ ibsCbs: { cClassTrib: '200034' } })              // alimentos: redução de 60%
.item({ /* ... */ ibsCbs: { cClassTrib: '200003' } })              // cesta básica: redução de 100%
.item({ /* ... */ ibsCbs: { cClassTrib: '410999' } })              // não incidência
.item({ /* ... */ ibsCbs: { cClassTrib: '410003', doacao: true } }) // doação/amostra grátis
```

**O que a biblioteca calcula**

- **Base (UB16-10):** vProd + vFrete + vSeg + vOutro − vDesc − vPIS − vCOFINS − vICMS − vFCP (pode ser sobrescrita com `baseCalculo`).
- **Alíquotas padrão por ano de emissão:**

  | Ano | IBS UF | IBS Mun | CBS |
  |---|---|---|---|
  | 2026 | 0,1% | 0% | 0,9% |
  | 2027–2028 | 0,05% | 0,05% | informar (aguarda legislação) |

  Outros valores podem ser informados em `aliquotaIBSUF`, `aliquotaIBSMun` e `aliquotaCBS`.
- **Redução de alíquota (`gRed`):** percentual tirado da tabela do cClassTrib; alíquota efetiva com 4 casas (UB28/UB66).
- **Totais:** `IBSCBSTot`, `vItem` por item e `vNFTot`. Até 2026 o IBS/CBS **não** soma em `vItem`/`vNFTot`; a partir de 2027 soma (VB01-10).
- **Validações:** cClassTrib existente e permitido em NFC-e, vigência, indicador de doação, CSTs com grupos não suportados.
- **`cMunFGIBS`:** informado automaticamente quando `presenca(5)` (venda presencial fora do estabelecimento), usando `municipioFatoGerador` ou o município do emitente (regras B25b-60/70).

> O DANFCE ainda não exibe IBS/CBS: a NT informa que o novo leiaute do DANFE está "em estudo".

---

## Contingência offline

Quando a SEFAZ não responde, a NFC-e pode ser emitida offline (`tpEmis=9`) e transmitida depois (em geral, em até 24 h — confira o prazo da sua UF).

```ts
// Automática: basta configurar contingenciaAutomatica: true + storage
const r = await nfce.emitir(nota); // r.status === 'contingencia' se a SEFAZ estiver fora

// Manual
await nfce.contingencia.emitirOffline(nota, 'Queda do link de internet');

// Agende a retransmissão (ex.: a cada 5 minutos)
setInterval(async () => {
  for (const r of await nfce.contingencia.transmitirPendentes()) {
    console.log(r.chave, r.status, r.cStat);
  }
}, 5 * 60_000);
```

Como funciona:

1. A nota é assinada com `tpEmis=9`, `dhCont`, `xJust` e QR Code offline, e salva em `storage` (`contingencia/`).
2. O DANFCE sai com "EMITIDA EM CONTINGÊNCIA — Pendente de autorização".
3. Na retransmissão, cada chave é **consultada antes** do reenvio. Autorizadas vão para `autorizadas/`; rejeitadas vão para `rejeitadas/` e precisam de tratamento manual (por exemplo, emitir uma nova nota e cancelar por substituição).
4. Na contingência automática, a nota online que falhou é guardada em `substituidas/` e **nunca é reenviada**. Se ela tiver sido autorizada sem a resposta chegar, a cópia offline não é transmitida e volta com `status: 'conflito'` para tratamento manual.

---

## DANFCE

```ts
const pdf  = await nfce.danfcePdf(r.xmlAutorizado!, { rodape: 'Obrigado pela preferência!' });
const html = await nfce.danfceHtml(r.xmlAutorizado!);          // inclui QR Code embutido
```

- Aceita o `nfeProc` (autorizada) ou a NFe assinada (contingência).
- Largura padrão 80 mm (`larguraMm` para 58 mm); a altura do PDF acompanha o conteúdo.
- As funções também existem soltas: `gerarDanfcePdf(xml)`, `gerarDanfceHtml(xml)`.

---

## Armazenamento dos XMLs

`storage` recebe qualquer objeto que implemente a interface `Storage`. A biblioteca traz três prontos:

| Classe | Uso |
|---|---|
| `S3Storage` | Amazon S3 ou compatível — produção, vários caixas/lojas compartilhando a fila de contingência |
| `FileStorage` | pasta local — um único servidor/PDV |
| `MemoryStorage` | testes |

```ts
import { S3Storage, FileStorage } from 'zexon-nfce';

new NfceClient({ /* ... */ storage: new S3Storage({ bucket: 'minha-empresa-nfce' }) });
new NfceClient({ /* ... */ storage: new FileStorage('./nfce-data') });
```

### S3Storage

```bash
npm install @aws-sdk/client-s3   # dependência opcional, só para quem usa S3
```

```ts
new S3Storage({ bucket: 'minha-empresa-nfce' });          // mínimo necessário

new S3Storage({
  bucket: 'minha-empresa-nfce',
  prefixo: 'loja-01',                                     // padrão: 'nfce'
  regiao: 'sa-east-1',                                    // padrão: AWS_REGION
  credenciais: { accessKeyId, secretAccessKey },          // padrão: cadeia da AWS (env, perfil, IAM role)
});

// MinIO, Cloudflare R2, DigitalOcean Spaces, Wasabi...
new S3Storage({ bucket: 'nfce', endpoint: 'https://<conta>.r2.cloudflarestorage.com', criptografia: false });
```

- Credenciais: se não informadas, valem as variáveis `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, o perfil `~/.aws` ou a IAM role da máquina/container.
- Chaves no bucket: `<prefixo>/<tipo>/<chave>.xml` — ex.: `loja-01/autorizadas/3526…0670.xml`.
- Objetos gravados com `Content-Type: application/xml` e criptografia `AES256` no servidor.
- Permissões IAM mínimas: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` e `s3:ListBucket` no bucket.
- Dica: ative o **versionamento** do bucket e uma regra de ciclo de vida para manter os XMLs pelo prazo legal (5 anos).

### Implementação própria

Para banco de dados ou outro serviço, implemente a interface. Tipos de documento: `autorizadas`, `pendentes`, `contingencia`, `rejeitadas`, `substituidas`, `cancelamentos`, `inutilizacoes`.

```ts
interface Storage {
  salvar(tipo, nome, conteudo): Promise<void>;
  ler(tipo, nome): Promise<string | undefined>;
  listar(tipo): Promise<string[]>;
  remover(tipo, nome): Promise<void>;
}
```

---

## Registro, numeração e resiliência

A biblioteca não tem fila nem banco próprios. Ela garante que cada operação possa ser **repetida com segurança** e deixa o estado gravado onde o seu sistema consegue retomar. *Quando* processar (cron, fila, worker) fica com você.

Três peças independentes e opcionais, cada uma uma interface:

| Peça | Função | Prontas |
|---|---|---|
| `storage` (`Storage`) | XML assinado/autorizado (imutável) | `S3Storage`, `FileStorage`, `MemoryStorage` |
| `registro` (`RegistroNotas`) | estado e dados de cada nota (banco) | `PostgresRegistro`, `MemoryRegistro` |
| `numerador` (`Numerador`) | próximo número por CNPJ/série/ambiente | `PostgresNumerador`, `MemoryNumerador` |

### Configuração com Postgres

```ts
import { Pool } from 'pg';
import { NfceClient, S3Storage, PostgresRegistro, PostgresNumerador, criarTabelas } from 'zexon-nfce';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await criarTabelas(pool);               // idempotente; ou use sqlMigracao() na sua ferramenta de migração

const nfce = new NfceClient({
  // ...uf, ambiente, certificado, csc
  storage: new S3Storage({ bucket: 'minha-empresa-nfce' }),
  registro: new PostgresRegistro(pool),
  numerador: new PostgresNumerador(pool),
});

// Sem `numero`: o numerador fornece. Com `referencia`: nunca duas notas para o mesmo pedido.
const r = await nfce.emitir(notaSemNumero, { referencia: `pedido-${pedido.id}` });
```

Os adaptadores Postgres **não dependem de nenhum pacote**: recebem qualquer objeto com `query(sql, params)` — `pg.Pool`, `pg.Client`, uma transação (`PoolClient`) ou PGlite. Opção `{ schema: 'fiscal' }` para usar outro schema.

Tabelas criadas: `nfce_sequencia` (uma linha por CNPJ + ambiente + modelo + série) e `nfce_nota` (uma linha por chave, com `referencia` única por CNPJ/ambiente).

### O que acontece em `emitir`

1. Se a `referencia` já existe no registro → devolve (ou conclui) **a mesma nota**.
2. Valida a nota e, se não houver `numero`, pede ao `numerador` (só depois de validar: erro de validação não gasta número).
3. Assina e **grava antes de enviar**: XML em `storage` (`pendentes/`) e registro com `situacao: 'pendente'`. A chave fica fixada.
4. Envia com **retentativa curta** em falha temporária (padrão: 3 tentativas; `retentativas: { tentativas, esperasMs }`).
5. Se ainda falhar, **consulta a chave** (a SEFAZ pode ter autorizado sem a resposta chegar). Se não, a nota fica `pendente` e o erro sai com `retentavel: true` e `chave` — ou vai para contingência, se `contingenciaAutomatica`.
6. Resultado definitivo → registro atualizado (`autorizada`, `rejeitada`, `denegada`, protocolo, tentativas) e XML movido.

### Concluindo o que ficou pendente

```ts
// Uma nota específica (ex.: o erro de emitir trouxe e.chave)
await nfce.retomar(chave);

// Todas: chame periodicamente — nunca lança, devolve o status de cada nota
await nfce.processarPendentes({ limite: 50 });
```

`retomar` é idempotente: consulta a chave antes e só reenvia o **mesmo XML** se a SEFAZ não a conhecer. Exemplos de agendamento:

```ts
setInterval(() => nfce.processarPendentes(), 60_000);                     // processo único
cron.schedule('*/2 * * * *', () => nfce.processarPendentes());             // node-cron
new Worker('nfce', async (job) => nfce.retomar(job.data.chave));           // BullMQ: enfileire e.chave
export const handler = async (ev) => { for (const m of ev.Records) await nfce.retomar(JSON.parse(m.body).chave); }; // SQS + Lambda
```

Em SaaS com vários emitentes, crie um `NfceClient` por empresa (o certificado é por empresa) compartilhando `storage`, `registro` e `numerador`, e passe `processarPendentes({ cnpj })` — o filtro por UF e ambiente é automático.

### Rejeições e numeração sem buracos

```ts
const r = await nfce.emitir(nota, { referencia: 'pedido-42' });
if (r.status === 'rejeitada') {
  // corrija e reemita com a MESMA série e número (nova chave; a referência passa para a nova nota)
  await nfce.reemitir(r.chave, notaCorrigida);
}

// Números entregues sem nota válida (ex.: requisições repetidas, falhas antes do envio) — para inutilizar
const buracos = await new PostgresRegistro(pool).buracos({ cnpj, ambiente: 'producao', serie: 1 });
if (buracos.length) await nfce.inutilizar({ serie: 1, numeroInicial: buracos[0], numeroFinal: buracos[0], justificativa: 'Numero reservado e nao utilizado' });
```

`PostgresNumerador.definirInicio(seq, 5001)` faz a numeração continuar de onde o emissor anterior parou.

### Situações no registro

| `situacao` | Significado |
|---|---|
| `pendente` | gravada, sem resposta definitiva — `processarPendentes` conclui |
| `contingencia` | emitida offline, aguardando transmissão |
| `autorizada` / `rejeitada` / `denegada` | resposta definitiva da SEFAZ |
| `substituida` | nota online trocada por uma de contingência (não é reenviada) |
| `conflito` | a original apareceu autorizada depois da contingência — tratar manualmente |

### Outro banco

Implemente `RegistroNotas` (`registrar`, `atualizar`, `buscar`, `buscarPorReferencia`, `pendentes`) e/ou `Numerador` (`proximo`). Requisitos: `registrar` deve recusar chave ou referência repetida com `RegistroDuplicadoError`, e `proximo` deve ser atômico.

---

## Configuração

| Opção | Tipo | Descrição |
|---|---|---|
| `uf` | `string` | UF do emitente (`'SP'`, `'MG'`...) |
| `ambiente` | `'homologacao' \| 'producao'` | |
| `certificado` | `{ pfx: Buffer \| string, senha }` | A1; `pfx` aceita o conteúdo ou o caminho |
| `csc` | `{ id, codigo }` | obrigatório para QR Code v2 |
| `qrCodeVersao` | `2 \| 3` | padrão: 2 com CSC, 3 sem |
| `storage` | `Storage` | `new S3Storage({ bucket })`, `new FileStorage(pasta)`, `new MemoryStorage()` ou implementação própria; obrigatório para contingência |
| `contingenciaAutomatica` | `boolean` | SEFAZ fora ⇒ emite offline |
| `endpoints` | `EndpointsOverride` | URLs de serviços, QR Code e consulta |
| `transporte` | `{ timeoutMs, ca, rejectUnauthorized, fetchImpl }` | rede/TLS; `fetchImpl` para mocks |
| `responsavelTecnico` | `{ cnpj, contato, email, fone, csrt? }` | grupo `infRespTec` (+ hash CSRT) |
| `versaoSoftware` | `string` | vai em `verProc` |
| `fusoMinutos` | `number` | padrão pelo fuso da UF (ex.: −180, AM −240, AC −300) |
| `ibsCbsPadrao` | `{ cClassTrib, ... }` | IBS/CBS aplicado aos itens sem `ibsCbs` |
| `registro` | `RegistroNotas` | estado das notas em banco (`PostgresRegistro`); exige `storage` |
| `numerador` | `Numerador` | fornece `numero` quando a nota não traz (`PostgresNumerador`) |
| `retentativas` | `{ tentativas?, esperasMs? }` | padrão 3 tentativas, esperas 500/1500 ms |

---

## URLs por UF (endpoints)

A tabela embutida cobre **SP, MG, PR** e os serviços das UFs atendidas pela **SVRS** (AC, AL, AP, DF, ES, PB, PI, RJ, RN, RO, RR, SC, SE, TO). Para as UFs da SVRS ainda é preciso informar a URL do QR Code e da consulta. As URLs oficiais estão no Portal Nacional da NFC-e (nfce.encat.org → Desenvolvedor).

```ts
new NfceClient({
  // ...
  endpoints: {
    RJ: {
      homologacao: {
        qrCode: 'https://<url-do-qrcode-da-UF>',       // conferir no nfce.encat.org
        urlChave: 'https://<url-de-consulta-da-UF>',
      },
    },
    BA: {
      producao: {
        servicos: { autorizacao: 'https://...', consultaProtocolo: 'https://...', /* ... */ },
        qrCode: 'https://...', urlChave: 'https://...',
      },
    },
  },
});
```

Serviços: `autorizacao`, `retAutorizacao`, `consultaProtocolo`, `statusServico`, `inutilizacao`, `recepcaoEvento`.

> ⚠️ As URLs mudam com o tempo. Confira as de sua UF antes de entrar em produção.

---

## Certificado e TLS

- Use um certificado **A1** (`.pfx`/`.p12`). O CNPJ é lido do certificado quando possível (usado na inutilização).
- O cliente recusa certificado vencido.
- Os servidores da SEFAZ usam a cadeia **ICP-Brasil**, que não vem no Node. Baixe a cadeia no site do ITI e informe:

```ts
transporte: { ca: [readFileSync('icp-brasil-raiz-v5.crt'), readFileSync('ac-intermediaria.crt')] }
```

Evite `rejectUnauthorized: false` em produção.

---

## Tratamento de erros

| Classe | Quando |
|---|---|
| `ValidationError` | nota inválida antes do envio (`campos` lista os caminhos com problema) |
| `TransportError` | timeout, DNS, TLS, HTTP — `retentavel: true` |
| `SefazError` | SEFAZ indisponível (cStat 108/109/999) — `retentavel: true` |
| `RegistroDuplicadoError` | chave ou referência já registrada |
| `CertificateError` | PFX inválido, senha errada, certificado vencido |
| `NfceError` | base de todas; também endpoint/storage ausente |

Rejeições de negócio **não** lançam exceção: voltam em `status: 'rejeitada'` com `cStat` e `xMotivo`.

Todo `NfceError` tem `retentavel` (vale repetir mais tarde?) e, quando a nota já foi gravada, `chave` — use-a em `retomar(chave)` ou na sua fila.

```ts
try {
  const r = await nfce.emitir(nota);
} catch (e) {
  if (e instanceof ValidationError) mostrarErros(e.campos);
  else if (e instanceof NfceError && e.retentavel) await fila.enfileirar({ chave: e.chave }); // concluir depois com nfce.retomar
  else throw e;
}
```

---

## Checklist de homologação

1. Solicitar o CSC de homologação no portal da SEFAZ.
2. `status()` deve retornar `cStat 107`.
3. Emitir notas com cada meio de pagamento que a loja usa (dinheiro com troco, cartão, PIX).
4. Emitir com e sem CPF do consumidor.
5. Cancelar uma nota (dentro do prazo da UF).
6. Inutilizar uma faixa.
7. Simular queda de rede, emitir offline e retransmitir.
8. Derrubar o processo durante um envio e conferir que `processarPendentes()` conclui a mesma chave.
9. Ler o QR Code impresso com o celular e conferir a consulta pública.
10. Imprimir o DANFCE na impressora térmica real.

---

## Arquitetura

```
src/
  client/NfceClient.ts   fachada: emitir, consultar, cancelar, inutilizar, status, contingência
  builder/               NfceBuilder (API fluente)
  validation/            regras de negócio pré-envio
  xml/                   chave de acesso, montagem do infNFe, assinatura
  qrcode/                QR Code v2/v3 online e offline
  rtc/                   IBS/CBS: cálculo e tabela oficial de cClassTrib/CST
  sefaz/                 endpoints por UF, SOAP 1.2, parse de retornos
  events/                cancelamento, substituição, inutilização
  danfce/                HTML e PDF
  storage/               S3Storage, FileStorage, MemoryStorage
  registro/              interface RegistroNotas + MemoryRegistro
  numerador/             interface Numerador + MemoryNumerador
  postgres/              PostgresRegistro, PostgresNumerador, criarTabelas (sem dependências)
  errors/                hierarquia de erros
schemas/                 XSDs oficiais (PL_010h + serviços + eventos)
test/                    unitários, XSD, SEFAZ simulada, Postgres (PGlite) e cenários de falha
examples/                exemplo de ponta a ponta
```

---

## Desenvolvimento

```bash
npm install
npm test            # testes (a validação XSD usa o xmllint: apt install libxml2-utils)
npm run typecheck
npm run build       # dist/ ESM + CJS + .d.ts
```

Exemplo real em homologação: `examples/emitir.ts` (lê `CERT_PFX`, `CERT_SENHA`, `CSC_ID`, `CSC`, `EMIT_CNPJ`, `EMIT_IE` do ambiente).

---

## Fontes oficiais

Portal Nacional da NF-e (nfe.fazenda.gov.br):

- Manual de Orientação ao Contribuinte (MOC) 7.0 e Anexo I — leiaute e regras de validação
- Manual de Especificações Técnicas do DANFE NFC-e e QR Code, versão 6.0
- Manual de Especificações da Contingência Offline para NFC-e, versão 2.0
- NT 2025.002 v1.53 — Reforma Tributária (IBS/CBS/IS)
- Tabela de Classificação Tributária do IBS e CBS (IT 2025.002 v1.71) e Tabela de Alíquotas da CBS
- Esquemas XML: pacote PL_010h e PL_009q (serviços), eventos de cancelamento e cancelamento por substituição

## Licença

Copyright (C) 2026 Lenderson Macedo.

**Licenciamento duplo** — escolha uma:

- **[AGPL-3.0](LICENSE)**: uso livre, inclusive comercial, desde que a aplicação que usa a biblioteca (inclusive acessada pela rede: PDV, ERP, API, SaaS) também tenha o código-fonte disponibilizado aos usuários sob a AGPL-3.0.
- **Licença comercial**: para usar em software fechado, sem as obrigações da AGPL. Veja [COPYRIGHT.md](COPYRIGHT.md).

Versões anteriores ao commit `13ee9c4` foram publicadas sob MIT.
