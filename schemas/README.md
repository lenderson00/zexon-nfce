# Esquemas XML (XSD)

Arquivos oficiais do Portal Nacional da NF-e (nfe.fazenda.gov.br → Documentos → Esquemas XML), sem alteração.
Usados nos testes (`xmllint`) para validar o XML que a biblioteca gera.

| Pasta / arquivos | Origem | Conteúdo |
|---|---|---|
| `NFe/leiauteNFe_v4.00.xsd`, `NFe/nfe_v4.00.xsd`, `NFe/tiposBasico_v4.00.xsd`, `NFe/DFeTiposBasicos_v1.00.xsd`, `NFe/xmldsig-core-schema_v1.01.xsd` | **Pacote de Liberação PL_010h v1.03** (NT 2025.002 – RTC, NT 2026.006 e NT 2026.008) | Leiaute NF-e/NFC-e 4.00 **com os grupos da Reforma Tributária** (IBS/CBS/IS em `DFeTiposBasicos_v1.00.xsd`) |
| `NFe/enviNFe_v4.00.xsd`, `retEnviNFe`, `consSitNFe`, `retConsSitNFe`, `consStatServ`, `retConsStatServ`, `consReciNFe`, `retConsReciNFe`, `inutNFe`, `retInutNFe`, `procNFe`, `procInutNFe` e respectivos `leiaute*` | **PL_009q** (NT 2025.001) | Mensagens dos webservices (lote, consultas, status, inutilização). Os pacotes PL_010x publicados trazem apenas o leiaute da nota; estes XSDs de serviço incluem o `leiauteNFe_v4.00.xsd` acima. |
| `Evento/*CancNFe*`, `Evento/e110111_v1.00.xsd` | Pacote "Evento Cancelamento" (atualizado em 21/12/2018) | Evento de cancelamento (110111) |
| `Evento/*CancSubst*`, `Evento/e110112_v1.00.xsd` | Pacote "Evento Cancelamento por Substituição" NFC-e (21/12/2018) | Cancelamento por substituição (110112) |
| `Evento/e110001`, `e110300`, `e412140`, `tiposBasico_v1.03.xsd` | PL_010h v1.03 | Eventos da RTC incluídos no pacote |

Para atualizar: baixe o pacote novo no portal, substitua os arquivos e rode `npm test`.
