/**
 * Exemplo mínimo de API de emissão para o Pará (homologação): Postgres + S3 + idempotência por pedido
 * + processamento periódico das pendências. Rode com variáveis de ambiente (nunca coloque segredos no código):
 *
 *   CERT_PFX=./cert.pfx CERT_SENHA=... CSC_ID=1 CSC=... EMIT_CNPJ=... EMIT_IE=... \
 *   DATABASE_URL=postgres://... S3_BUCKET=minha-empresa-nfce SEFAZ_CA_DIR=./certs/icp-brasil \
 *   npx tsx examples/emitir.ts
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import {
  NfceBuilder, NfceClient, NfceError, S3Storage, PostgresRegistro, PostgresNumerador, criarTabelas, carregarCadeiaIcpBrasil,
  type NotaNfce,
} from '../src/index.js';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Variável de ambiente ${k} não definida`);
  return v;
};

const pool = new pg.Pool({ connectionString: env('DATABASE_URL') });
await criarTabelas(pool);

const nfce = new NfceClient({
  uf: 'PA',
  ambiente: 'homologacao',
  certificado: { pfx: readFileSync(env('CERT_PFX')), senha: env('CERT_SENHA') },
  csc: { id: Number(env('CSC_ID')), codigo: env('CSC') },
  storage: new S3Storage({ bucket: env('S3_BUCKET'), prefixo: 'nfce-pa' }),
  registro: new PostgresRegistro(pool),
  numerador: new PostgresNumerador(pool),
  contingenciaAutomatica: true,
  // Cadeia ICP-Brasil dos servidores da SEFAZ/SVRS (ver README, "Certificado e TLS").
  transporte: process.env.SEFAZ_CA_DIR ? { casAdicionais: carregarCadeiaIcpBrasil(process.env.SEFAZ_CA_DIR) } : {},
  versaoSoftware: 'loopi-api 1.0',
});

console.log('Status SEFAZ:', await nfce.status());

/** Handler da rota "POST /vendas/:id/nfce" da sua API. */
async function emitirVenda(pedidoId: string): Promise<void> {
  const nota: NotaNfce = new NfceBuilder()
    .emitente({
      cnpj: env('EMIT_CNPJ'), razaoSocial: 'LOOPI MARKET LTDA', inscricaoEstadual: env('EMIT_IE'), regimeTributario: 1,
      endereco: { logradouro: 'AV PRESIDENTE VARGAS', numero: '100', bairro: 'CAMPINA', codigoMunicipio: 1501402, municipio: 'BELEM', uf: 'PA', cep: '66010000' },
    })
    .serie(1) // sem .numero(): o PostgresNumerador fornece
    .item({ codigo: '001', descricao: 'AGUA MINERAL 500ML', ncm: '22011000', cfop: '5102', unidade: 'UN', quantidade: 2, valorUnitario: 3.5, icms: { csosn: '102', origem: 0 } })
    .pagamento({ tipo: 'pix', valor: 7 })
    .build();

  try {
    // A mesma referência nunca gera duas notas (repetir a chamada devolve a mesma).
    const r = await nfce.emitir(nota, { referencia: pedidoId });
    console.log(r.status, r.chave, r.cStat, r.xMotivo);
    if (r.status === 'autorizada' || r.status === 'contingencia') {
      const pdf = await nfce.danfcePdf(r.xmlAutorizado ?? r.xmlAssinado);
      console.log(`DANFCE: ${pdf.length} bytes`);
    }
  } catch (e) {
    if (e instanceof NfceError && e.retentavel && e.chave) {
      // Recebimento incerto: o consumidor está no caixa → cupom de contingência com outro número.
      const off = await nfce.contingencia.substituirPendente(e.chave, nota);
      console.log('Contingência:', off.chave);
    } else throw e;
  }
}

await emitirVenda(`pedido-${Date.now()}`);

// Em produção: agende (cron/fila). Conclui pendentes, transmite contingências e avisa prazos/conflitos.
for (const r of await nfce.processarPendentes()) {
  if (r.status === 'conflito' || (r.prazo && r.prazo.situacao !== 'ok')) console.warn('ATENÇÃO', r.chave, r.status, r.xMotivo);
}

await pool.end();
