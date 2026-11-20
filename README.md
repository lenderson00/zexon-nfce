# zexon-nfce

Biblioteca TypeScript/Node.js para **NFC-e (modelo 65, leiaute 4.00)**: emissão, consulta, cancelamento, inutilização, status do serviço, contingência offline e DANFCE (HTML/PDF).

- Assinatura XMLDSig (RSA-SHA1) com certificado A1 (`.pfx`)
- QR Code **v2** (CSC) e **v3** (sem CSC), online e offline (`tpEmis=9`)
- Transporte SOAP 1.2 com TLS mútuo
- XML gerado validado contra os **XSDs oficiais** (pacote PL_010h, em `schemas/`)
- Node ≥ 20, ESM + CJS, tipos incluídos

> **Antes de ir a produção:** valide em homologação com seu certificado e CSC. A tabela embutida de URLs
> (`src/sefaz/endpoints.ts`) é parcial (SP, MG, PR e UFs atendidas pela SVRS) e as URLs mudam; confira em
> [nfce.encat.org](https://nfce.encat.org/desenvolvedor/) e informe `endpoints` para as demais UFs.

## Instalação

```bash
npm install zexon-nfce
```

## Uso rápido

```ts
import { NfceClient, NfceBuilder, FileStorage } from 'zexon-nfce';
import { readFileSync } from 'node:fs';

const nfce = new NfceClient({
  uf: 'SP',
  ambiente: 'homologacao',
  certificado: { pfx: readFileSync('cert.pfx'), senha: process.env.CERT_SENHA! },
  csc: { id: 1, codigo: process.env.CSC! },       // QR Code v2. Sem csc => QR Code v3
  storage: new FileStorage('./nfce-data'),        // guarda autorizadas, cancelamentos, contingência
  contingenciaAutomatica: true,                   // SEFAZ fora do ar => emite offline
});

const nota = new NfceBuilder()
  .emitente({ /* cnpj, razaoSocial, inscricaoEstadual, regimeTributario, endereco */ } as any)
  .serie(1).numero(1234)
  .cpfConsumidor('529.982.247-25')
  .item({ codigo: '001', descricao: 'CAFE 250G', ncm: '09012100', cfop: '5102', unidade: 'UN',
          quantidade: 2, valorUnitario: 12.5, icms: { csosn: '102', origem: 0 } })
  .pagamento({ tipo: 'pix', valor: 25 })
  .build();                                       // valida tudo e lista TODOS os erros

const r = await nfce.emitir(nota);
if (r.status === 'autorizada') {
  const pdf = await nfce.danfcePdf(r.xmlAutorizado!);   // bobina 80 mm
}
```

## Rotina diária

| Operação | Método |
|---|---|
| Emitir (síncrono) | `nfce.emitir(nota)` → `autorizada` \| `rejeitada` \| `denegada` \| `contingencia` |
| Montar/assinar sem enviar | `nfce.preparar(nota)` |
| Status da SEFAZ | `nfce.status()` |
| Consultar por chave | `nfce.consultar(chave)` |
| Cancelar | `nfce.cancelar({ chave, protocolo, justificativa })` |
| Cancelar por substituição | `nfce.cancelarPorSubstituicao({ ..., chaveSubstituta })` |
| Inutilizar numeração | `nfce.inutilizar({ serie, numeroInicial, numeroFinal, justificativa })` |
| Contingência offline | `nfce.contingencia.emitirOffline(nota)` |
| Retransmitir pendentes | `nfce.contingencia.transmitirPendentes()` (rode periodicamente) |
| DANFCE | `nfce.danfceHtml(xml)` / `nfce.danfcePdf(xml)` |

Comportamento relevante:

- Rejeições da SEFAZ são **devolvidas** (`status: 'rejeitada'`, `cStat`, `xMotivo`); falhas de rede lançam `TransportError`.
- Após timeout/queda, `emitir` **consulta a chave** antes de decidir: se a nota chegou a ser autorizada, ela é recuperada (sem duplicar).
- Duplicidade (cStat 204) é resolvida recuperando o protocolo existente.
- Na retransmissão de contingência, cada chave é consultada antes do reenvio.
- Em homologação, a biblioteca aplica os textos obrigatórios (primeiro item e destinatário).

## Configuração

| Opção | Descrição |
|---|---|
| `uf`, `ambiente` | UF do emitente e `'homologacao'`/`'producao'` |
| `certificado` | `{ pfx: Buffer \| caminho, senha }` (A1) |
| `csc` | `{ id, codigo }`; obrigatório no QR Code v2 |
| `qrCodeVersao` | `2` ou `3` (padrão: 2 com CSC, 3 sem) |
| `endpoints` | sobrescreve URLs de serviços, `qrCode` e `urlChave` por UF/ambiente |
| `transporte` | `timeoutMs`, `ca` (cadeia ICP-Brasil dos servidores), `rejectUnauthorized`, `fetchImpl` (testes) |
| `storage` | `FileStorage`, `MemoryStorage` ou sua implementação de `Storage` |
| `responsavelTecnico` | grupo `infRespTec` (+ CSRT) exigido por algumas UFs |

### TLS e cadeia ICP-Brasil
Os servidores da SEFAZ usam certificados da cadeia ICP-Brasil, que não está no repositório de CAs do Node.
Baixe a cadeia no site do ITI e passe em `transporte.ca`. Evite `rejectUnauthorized: false` em produção.

## Tributação suportada nesta versão
ICMS: CSOSN 101, 102/103/300/400, 500, 900; CST 00, 20, 40/41/50, 60, 90. PIS/COFINS: 01/02, 04–09 e outras (49, 99…).
ST (CST 10/30/70), IPI, ISSQN e os grupos da reforma tributária (IBS/CBS) não são emitidos por NFC-e nesta versão.

## Desenvolvimento

```bash
npm test          # unitários + XSD (requer xmllint) + SEFAZ simulada
npm run typecheck
npm run build
```

## Fontes oficiais usadas
MOC 7.0 (NF-e/NFC-e), Anexo I (leiaute), Manual do DANFE NFC-e e QR Code v6.0, Manual de Contingência Offline v2.0 e XSDs
do Portal Nacional da NF-e (nfe.fazenda.gov.br). Os vetores de teste do QR Code v2 vêm do manual.
