import { readFileSync } from 'node:fs';
import { NfceBuilder, NfceClient } from '../src/index.js';

const nfce = new NfceClient({
  uf: 'SP',
  ambiente: 'homologacao',
  certificado: { pfx: readFileSync(process.env.CERT_PFX!), senha: process.env.CERT_SENHA! },
  csc: { id: Number(process.env.CSC_ID), codigo: process.env.CSC! },
  storage: { tipo: 's3', bucket: 'minha-empresa-nfce' },
  contingenciaAutomatica: true,
});

console.log(await nfce.status());

const nota = new NfceBuilder()
  .emitente({
    cnpj: process.env.EMIT_CNPJ!, razaoSocial: 'MINHA EMPRESA LTDA', inscricaoEstadual: process.env.EMIT_IE!, regimeTributario: 1,
    endereco: { logradouro: 'RUA X', numero: '1', bairro: 'CENTRO', codigoMunicipio: 3550308, municipio: 'SAO PAULO', uf: 'SP', cep: '01001000' },
  })
  .serie(1).numero(Number(process.env.NUMERO ?? 1))
  .item({ codigo: '001', descricao: 'PRODUTO', ncm: '21069090', cfop: '5102', unidade: 'UN', quantidade: 1, valorUnitario: 10, icms: { csosn: '102', origem: 0 } })
  .pagamento({ tipo: 'dinheiro', valor: 10 })
  .build();

const r = await nfce.emitir(nota);
console.log(r.status, r.cStat, r.xMotivo, r.protocolo);
