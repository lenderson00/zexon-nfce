// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
//
// ARQUIVO GERADO por scripts/gerar-endpoints.mjs em 2026-11-20. Não edite à mão.
// Fonte: nfephp-org/sped-nfe (storage/autorizadores.json, wsnfe_4.00_mod65.xml, uri_consulta_nfce.json).
// Confira no Portal Nacional da NFC-e (nfce.encat.org → Desenvolvedor) antes de ir para produção;
// para corrigir uma UF sem esperar nova versão, use a opção `endpoints` do NfceClient.

export const GERADO_EM = '2026-11-20';

/** Webservices por autorizador (SVRS atende várias UFs). */
export const SERVICOS_AUTORIZADOR = {
  "SVRS": {
    "producao": {
      "autorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
      "retAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
      "consultaProtocolo": "https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
      "statusServico": "https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
      "inutilizacao": "https://nfce.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
      "recepcaoEvento": "https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx"
    },
    "homologacao": {
      "autorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
      "retAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
      "consultaProtocolo": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
      "statusServico": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
      "inutilizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
      "recepcaoEvento": "https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx"
    }
  },
  "AM": {
    "producao": {
      "autorizacao": "https://nfce.sefaz.am.gov.br/nfce-services/services/NfeAutorizacao4",
      "retAutorizacao": "https://nfce.sefaz.am.gov.br/nfce-services/services/NfeRetAutorizacao4",
      "consultaProtocolo": "https://nfce.sefaz.am.gov.br/nfce-services/services/NfeConsulta4",
      "statusServico": "https://nfce.sefaz.am.gov.br/nfce-services/services/NfeStatusServico4",
      "inutilizacao": "https://nfce.sefaz.am.gov.br/nfce-services/services/NfeInutilizacao4",
      "recepcaoEvento": "https://nfce.sefaz.am.gov.br/nfce-services/services/RecepcaoEvento4"
    },
    "homologacao": {
      "autorizacao": "https://homnfce.sefaz.am.gov.br/nfce-services/services/NfeAutorizacao4",
      "retAutorizacao": "https://homnfce.sefaz.am.gov.br/nfce-services/services/NfeRetAutorizacao4",
      "consultaProtocolo": "https://homnfce.sefaz.am.gov.br/nfce-services/services/NfeConsulta4",
      "statusServico": "https://homnfce.sefaz.am.gov.br/nfce-services/services/NfeStatusServico4",
      "inutilizacao": "https://homnfce.sefaz.am.gov.br/nfce-services/services/NfeInutilizacao4",
      "recepcaoEvento": "https://homnfce.sefaz.am.gov.br/nfce-services/services/RecepcaoEvento4"
    }
  },
  "GO": {
    "producao": {
      "autorizacao": "https://nfe.sefaz.go.gov.br/nfe/services/NFeAutorizacao4",
      "retAutorizacao": "https://nfe.sefaz.go.gov.br/nfe/services/NFeRetAutorizacao4",
      "consultaProtocolo": "https://nfe.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4",
      "statusServico": "https://nfe.sefaz.go.gov.br/nfe/services/NFeStatusServico4",
      "inutilizacao": "https://nfe.sefaz.go.gov.br/nfe/services/NFeInutilizacao4",
      "recepcaoEvento": "https://nfe.sefaz.go.gov.br/nfe/services/NFeRecepcaoEvento4"
    },
    "homologacao": {
      "autorizacao": "https://homolog.sefaz.go.gov.br/nfe/services/NFeAutorizacao4",
      "retAutorizacao": "https://homolog.sefaz.go.gov.br/nfe/services/NFeRetAutorizacao4",
      "consultaProtocolo": "https://homolog.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4",
      "statusServico": "https://homolog.sefaz.go.gov.br/nfe/services/NFeStatusServico4",
      "inutilizacao": "https://homolog.sefaz.go.gov.br/nfe/services/NFeInutilizacao4",
      "recepcaoEvento": "https://homolog.sefaz.go.gov.br/nfe/services/NFeRecepcaoEvento4"
    }
  },
  "MG": {
    "producao": {
      "autorizacao": "https://nfce.fazenda.mg.gov.br/nfce/services/NFeAutorizacao4",
      "retAutorizacao": "https://nfce.fazenda.mg.gov.br/nfce/services/NFeRetAutorizacao4",
      "consultaProtocolo": "https://nfce.fazenda.mg.gov.br/nfce/services/NFeConsultaProtocolo4",
      "statusServico": "https://nfce.fazenda.mg.gov.br/nfce/services/NFeStatusServico4",
      "inutilizacao": "https://nfce.fazenda.mg.gov.br/nfce/services/NFeInutilizacao4",
      "recepcaoEvento": "https://nfce.fazenda.mg.gov.br/nfce/services/NFeRecepcaoEvento4"
    },
    "homologacao": {
      "autorizacao": "https://hnfce.fazenda.mg.gov.br/nfce/services/NFeAutorizacao4",
      "retAutorizacao": "https://hnfce.fazenda.mg.gov.br/nfce/services/NFeRetAutorizacao4",
      "consultaProtocolo": "https://hnfce.fazenda.mg.gov.br/nfce/services/NFeConsultaProtocolo4",
      "statusServico": "https://hnfce.fazenda.mg.gov.br/nfce/services/NFeStatusServico4",
      "inutilizacao": "https://hnfce.fazenda.mg.gov.br/nfce/services/NFeInutilizacao4",
      "recepcaoEvento": "https://hnfce.fazenda.mg.gov.br/nfce/services/NFeRecepcaoEvento4"
    }
  },
  "MS": {
    "producao": {
      "autorizacao": "https://nfce.sefaz.ms.gov.br/ws/NFeAutorizacao4",
      "retAutorizacao": "https://nfce.sefaz.ms.gov.br/ws/NFeRetAutorizacao4",
      "consultaProtocolo": "https://nfce.sefaz.ms.gov.br/ws/NFeConsultaProtocolo4",
      "statusServico": "https://nfce.sefaz.ms.gov.br/ws/NFeStatusServico4",
      "inutilizacao": "https://nfce.sefaz.ms.gov.br/ws/NFeInutilizacao4",
      "recepcaoEvento": "https://nfce.sefaz.ms.gov.br/ws/NFeRecepcaoEvento4"
    },
    "homologacao": {
      "autorizacao": "https://hom.nfce.sefaz.ms.gov.br/ws/NFeAutorizacao4",
      "retAutorizacao": "https://hom.nfce.sefaz.ms.gov.br/ws/NFeRetAutorizacao4",
      "consultaProtocolo": "https://hom.nfce.sefaz.ms.gov.br/ws/NFeConsultaProtocolo4",
      "statusServico": "https://hom.nfce.sefaz.ms.gov.br/ws/NFeStatusServico4",
      "inutilizacao": "https://hom.nfce.sefaz.ms.gov.br/ws/NFeInutilizacao4",
      "recepcaoEvento": "https://hom.nfce.sefaz.ms.gov.br/ws/NFeRecepcaoEvento4"
    }
  },
  "MT": {
    "producao": {
      "autorizacao": "https://nfce.sefaz.mt.gov.br/nfcews/services/NfeAutorizacao4",
      "retAutorizacao": "https://nfce.sefaz.mt.gov.br/nfcews/services/NfeRetAutorizacao4",
      "consultaProtocolo": "https://nfce.sefaz.mt.gov.br/nfcews/services/NfeConsulta4",
      "statusServico": "https://nfce.sefaz.mt.gov.br/nfcews/services/NfeStatusServico4",
      "inutilizacao": "https://nfce.sefaz.mt.gov.br/nfcews/services/NfeInutilizacao4",
      "recepcaoEvento": "https://nfce.sefaz.mt.gov.br/nfcews/services/RecepcaoEvento4"
    },
    "homologacao": {
      "autorizacao": "https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeAutorizacao4",
      "retAutorizacao": "https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeRetAutorizacao4",
      "consultaProtocolo": "https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeConsulta4",
      "statusServico": "https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeStatusServico4",
      "inutilizacao": "https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeInutilizacao4",
      "recepcaoEvento": "https://homologacao.sefaz.mt.gov.br/nfcews/services/RecepcaoEvento4"
    }
  },
  "PR": {
    "producao": {
      "autorizacao": "https://nfce.sefa.pr.gov.br/nfce/NFeAutorizacao4",
      "retAutorizacao": "https://nfce.sefa.pr.gov.br/nfce/NFeRetAutorizacao4",
      "consultaProtocolo": "https://nfce.sefa.pr.gov.br/nfce/NFeConsultaProtocolo4",
      "statusServico": "https://nfce.sefa.pr.gov.br/nfce/NFeStatusServico4",
      "inutilizacao": "https://nfce.sefa.pr.gov.br/nfce/NFeInutilizacao4",
      "recepcaoEvento": "https://nfce.sefa.pr.gov.br/nfce/NFeRecepcaoEvento4"
    },
    "homologacao": {
      "autorizacao": "https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeAutorizacao4",
      "retAutorizacao": "https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeRetAutorizacao4",
      "consultaProtocolo": "https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeConsultaProtocolo4",
      "statusServico": "https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeStatusServico4",
      "inutilizacao": "https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeInutilizacao4",
      "recepcaoEvento": "https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeRecepcaoEvento4"
    }
  },
  "RS": {
    "producao": {
      "autorizacao": "https://nfce.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
      "retAutorizacao": "https://nfce.sefazrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
      "consultaProtocolo": "https://nfce.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
      "statusServico": "https://nfce.sefazrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
      "inutilizacao": "https://nfce.sefazrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
      "recepcaoEvento": "https://nfce.sefazrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx"
    },
    "homologacao": {
      "autorizacao": "https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
      "retAutorizacao": "https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
      "consultaProtocolo": "https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
      "statusServico": "https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
      "inutilizacao": "https://nfce-homologacao.sefazrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
      "recepcaoEvento": "https://nfce-homologacao.sefazrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx"
    }
  },
  "SP": {
    "producao": {
      "autorizacao": "https://nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx",
      "retAutorizacao": "https://nfce.fazenda.sp.gov.br/ws/NFeRetAutorizacao4.asmx",
      "consultaProtocolo": "https://nfce.fazenda.sp.gov.br/ws/NFeConsultaProtocolo4.asmx",
      "statusServico": "https://nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx",
      "inutilizacao": "https://nfce.fazenda.sp.gov.br/ws/NFeInutilizacao4.asmx",
      "recepcaoEvento": "https://nfce.fazenda.sp.gov.br/ws/NFeRecepcaoEvento4.asmx"
    },
    "homologacao": {
      "autorizacao": "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx",
      "retAutorizacao": "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeRetAutorizacao4.asmx",
      "consultaProtocolo": "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeConsultaProtocolo4.asmx",
      "statusServico": "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx",
      "inutilizacao": "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeInutilizacao4.asmx",
      "recepcaoEvento": "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeRecepcaoEvento4.asmx"
    }
  }
} as const;

/** Autorizador, URL do QR Code e URL de consulta por chave, por UF e ambiente. */
export const DADOS_UF = {
  "AC": {
    "autorizador": "SVRS",
    "producao": {
      "qrCode": "http://www.sefaznet.ac.gov.br/nfce/qrcode",
      "urlChave": "www.sefaznet.ac.gov.br/nfce/consulta"
    },
    "homologacao": {
      "qrCode": "http://www.hml.sefaznet.ac.gov.br/nfce/qrcode",
      "urlChave": "www.sefaznet.ac.gov.br/nfce/consulta"
    }
  },
  "AL": {
    "autorizador": "SVRS",
    "producao": {
      "qrCode": "http://nfce.sefaz.al.gov.br/QRCode/consultarNFCe.jsp",
      "urlChave": "www.sefaz.al.gov.br/nfce/consulta"
    },
    "homologacao": {
      "qrCode": "http://nfce.sefaz.al.gov.br/QRCode/consultarNFCe.jsp",
      "urlChave": "www.sefaz.al.gov.br/nfce/consulta"
    }
  },
  "AM": {
    "autorizador": "AM",
    "producao": {
      "qrCode": "https://sistemas.sefaz.am.gov.br/nfceweb/consultarNFCe.jsp",
      "urlChave": "www.sefaz.am.gov.br/nfce/consulta"
    },
    "homologacao": {
      "qrCode": "https://sistemas.sefaz.am.gov.br/nfceweb-hom/consultarNFCe.jsp",
      "urlChave": "www.sefaz.am.gov.br/nfce/consulta"
    }
  },
  "AP": {
    "autorizador": "SVRS",
    "producao": {
      "qrCode": "https://www.sefaz.ap.gov.br/nfce/nfcep.php",
      "urlChave": "www.sefaz.ap.gov.br/nfce/consulta"
    },
    "homologacao": {
      "qrCode": "https://www.sefaz.ap.gov.br/nfcehml/nfce.php",
      "urlChave": "www.sefaz.ap.gov.br/nfce/consulta"
    }
  },
  "BA": {
    "autorizador": "SVRS",
    "producao": {
      "qrCode": "http://nfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx",
      "urlChave": "http://www.sefaz.ba.gov.br/nfce/consulta"
    },
    "homologacao": {
      "qrCode": "http://hnfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx",
      "urlChave": "http://hinternet.sefaz.ba.gov.br/nfce/consulta"
    }
  },
  "CE": {
    "autorizador": "SVRS",
    "producao": {
      "qrCode": "http://nfce.sefaz.ce.gov.br/pages/ShowNFCe.html",
      "urlChave": "www.sefaz.ce.gov.br/nfce/consulta"
    },
    "homologacao": {
      "qrCode": "http://nfceh.sefaz.ce.gov.br/pages/ShowNFCe.html",
      "urlChave": "www.sefaz.ce.gov.br/nfce/consulta"
    }
  },
  "DF": {
    "autorizador": "SVRS",
    "producao": {
      "qrCode": "http://www.fazenda.df.gov.br/nfce/qrcode",
      "urlChave": "www.fazenda.df.gov.br/nfce/consulta"
    },
    "homologacao": {
      "qrCode": "http://dec.fazenda.df.gov.br/ConsultarNFCe.aspx",
      "urlChave": "www.fazenda.df.gov.br/nfce/consulta"
    }
  },
  "ES": {
    "autorizador": "SVRS",
    "producao": {
      "qrCode": "http://app.sefaz.es.gov.br/ConsultaNFCe/qrcode.aspx",
      "urlChave": "www.sefaz.es.gov.br/nfce/consulta"
    },
    "homologacao": {
      "qrCode": "http://homologacao.sefaz.es.gov.br/ConsultaNFCe/qrcode.aspx",
      "urlChave": "www.sefaz.es.gov.br/nfce/consulta"
    }
  },
  "GO": {
    "autorizador": "GO",
    "producao": {
      "qrCode": "https://nfeweb.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe",
      "urlChave": "www.sefaz.go.gov.br/nfce/consulta"
    },
    "homologacao": {
      "qrCode": "https://nfewebhomolog.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe",
      "urlChave": "www.nfce.go.gov.br/post/ver/214413/consulta-nfc-e-homologacao"
    }
  },
  "MA": {
    "autorizador": "SVRS",
    "producao": {
      "qrCode": "http://www.nfce.sefaz.ma.gov.br/portal/consultarNFCe.jsp",
      "urlChave": "www.sefaz.ma.gov.br/nfce/consulta"
    },
    "homologacao": {
      "qrCode": "http://www.hom.nfce.sefaz.ma.gov.br/portal/consultarNFCe.jsp",
      "urlChave": "www.sefaz.ma.gov.br/nfce/consulta"
    }
  },
  "MG": {
    "autorizador": "MG",
    "producao": {
      "qrCode": "https://portalsped.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml",
      "urlChave": "https://portalsped.fazenda.mg.gov.br/portalnfce"
    },
    "homologacao": {
      "qrCode": "https://portalsped.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml",
      "urlChave": "https://hportalsped.fazenda.mg.gov.br/portalnfce"
    }
  },
  "MS": {
    "autorizador": "MS",
    "producao": {
      "qrCode": "http://www.dfe.ms.gov.br/nfce/qrcode",
      "urlChave": "http://www.dfe.ms.gov.br/nfce/consulta"
    },
    "homologacao": {
      "qrCode": "http://www.dfe.ms.gov.br/nfce/qrcode",
      "urlChave": "http://www.dfe.ms.gov.br/nfce/consulta"
    }
  },
  "MT": {
    "autorizador": "MT",
    "producao": {
      "qrCode": "http://www.sefaz.mt.gov.br/nfce/consultanfce",
      "urlChave": "http://www.sefaz.mt.gov.br/nfce/consultanfce"
    },
    "homologacao": {
      "qrCode": "http://homologacao.sefaz.mt.gov.br/nfce/consultanfce",
      "urlChave": "http://homologacao.sefaz.mt.gov.br/nfce/consultanfce"
    }
  },
  "PA": {
    "autorizador": "SVRS",
    "producao": {
      "qrCode": "https://appnfc.sefa.pa.gov.br/portal/view/consultas/nfce/nfceForm.seam",
      "urlChave": "www.sefa.pa.gov.br/nfce/consulta"
    },
    "homologacao": {
      "qrCode": "https://appnfc.sefa.pa.gov.br/portal-homologacao/view/consultas/nfce/nfceForm.seam",
      "urlChave": "www.sefa.pa.gov.br/nfce/consulta"
    }
  },
  "PB": {
    "autorizador": "SVRS",
    "producao": {
      "qrCode": "http://www.sefaz.pb.gov.br/nfce",
      "urlChave": "www.sefaz.pb.gov.br/nfce/consulta"
    },
    "homologacao": {
      "qrCode": "http://www.sefaz.pb.gov.br/nfcehom",
      "urlChave": "www.sefaz.pb.gov.br/nfcehom"
    }
  },
  "PE": {
    "autorizador": "SVRS",
    "producao": {
      "qrCode": "http://nfce.sefaz.pe.gov.br/nfce/consulta",
      "urlChave": "nfce.sefaz.pe.gov.br/nfce/consulta"
    },
    "homologacao": {
      "qrCode": "http://nfcehomolog.sefaz.pe.gov.br/nfce/consulta",
      "urlChave": "nfce.sefaz.pe.gov.br/nfce/consulta"
    }
  },
  "PI": {
    "autorizador": "SVRS",
    "producao": {
      "qrCode": "http://www.sefaz.pi.gov.br/nfce/qrcode",
      "urlChave": "www.sefaz.pi.gov.br/nfce/consulta"
    },
    "homologacao": {
      "qrCode": "http://www.sefaz.pi.gov.br/nfce/qrcode",
      "urlChave": "www.sefaz.pi.gov.br/nfce/consulta"
    }
  },
  "PR": {
    "autorizador": "PR",
    "producao": {
      "qrCode": "http://www.fazenda.pr.gov.br/nfce/qrcode",
      "urlChave": "http://www.fazenda.pr.gov.br/nfce/consulta"
    },
    "homologacao": {
      "qrCode": "http://www.fazenda.pr.gov.br/nfce/qrcode",
      "urlChave": "http://www.fazenda.pr.gov.br/nfce/consulta"
    }
  },
  "RJ": {
    "autorizador": "SVRS",
    "producao": {
      "qrCode": "https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode",
      "urlChave": "www.fazenda.rj.gov.br/nfce/consulta"
    },
    "homologacao": {
      "qrCode": "http://www4.fazenda.rj.gov.br/consultaNFCe/QRCode",
      "urlChave": "www.fazenda.rj.gov.br/nfce/consulta"
    }
  },
  "RN": {
    "autorizador": "SVRS",
    "producao": {
      "qrCode": "http://nfce.set.rn.gov.br/consultarNFCe.aspx",
      "urlChave": "www.set.rn.gov.br/nfce/consulta"
    },
    "homologacao": {
      "qrCode": "http://hom.nfce.set.rn.gov.br/consultarNFCe.aspx",
      "urlChave": "www.set.rn.gov.br/nfce/consulta"
    }
  },
  "RO": {
    "autorizador": "SVRS",
    "producao": {
      "qrCode": "http://www.nfce.sefin.ro.gov.br/consultanfce/consulta.jsp",
      "urlChave": "www.sefin.ro.gov.br/nfce/consulta"
    },
    "homologacao": {
      "qrCode": "http://www.nfce.sefin.ro.gov.br/consultanfce/consulta.jsp",
      "urlChave": "www.sefin.ro.gov.br/nfce/consulta"
    }
  },
  "RR": {
    "autorizador": "SVRS",
    "producao": {
      "qrCode": "https://www.sefaz.rr.gov.br/servlet/qrcode",
      "urlChave": "www.sefaz.rr.gov.br/nfce/consulta"
    },
    "homologacao": {
      "qrCode": "http://200.174.88.103:8080/nfce/servlet/qrcode",
      "urlChave": "www.sefaz.rr.gov.br/nfce/consulta"
    }
  },
  "RS": {
    "autorizador": "RS",
    "producao": {
      "qrCode": "https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx",
      "urlChave": "www.sefaz.rs.gov.br/nfce/consulta"
    },
    "homologacao": {
      "qrCode": "https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx",
      "urlChave": "www.sefaz.rs.gov.br/nfce/consulta"
    }
  },
  "SC": {
    "autorizador": "SVRS",
    "producao": {
      "qrCode": "https://sat.sef.sc.gov.br/nfce/consulta",
      "urlChave": "https://sat.sef.sc.gov.br/nfce/consulta"
    },
    "homologacao": {
      "qrCode": "https://hom.sat.sef.sc.gov.br/nfce/consulta",
      "urlChave": "https://hom.sat.sef.sc.gov.br/nfce/consulta"
    }
  },
  "SE": {
    "autorizador": "SVRS",
    "producao": {
      "qrCode": "http://www.nfce.se.gov.br/nfce/qrcode",
      "urlChave": "http://www.nfce.se.gov.br/nfce/consulta"
    },
    "homologacao": {
      "qrCode": "http://www.hom.nfe.se.gov.br/nfce/qrcode",
      "urlChave": "http://www.hom.nfe.se.gov.br/nfce/consulta"
    }
  },
  "SP": {
    "autorizador": "SP",
    "producao": {
      "qrCode": "https://www.nfce.fazenda.sp.gov.br/qrcode",
      "urlChave": "https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica"
    },
    "homologacao": {
      "qrCode": "https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode",
      "urlChave": "https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica"
    }
  },
  "TO": {
    "autorizador": "SVRS",
    "producao": {
      "qrCode": "http://www.sefaz.to.gov.br/nfce/qrcode",
      "urlChave": "www.sefaz.to.gov.br/nfce/consulta"
    },
    "homologacao": {
      "qrCode": "http://homologacao.sefaz.to.gov.br/nfce/qrcode",
      "urlChave": "http://homologacao.sefaz.to.gov.br/nfce/consulta.jsf"
    }
  }
} as const;
