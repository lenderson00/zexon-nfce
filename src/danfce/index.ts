// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
import PDFDocument from 'pdfkit';
import { XMLParser } from 'fast-xml-parser';
import { esc } from '../util/xml.js';
import { qrCodeDataUrl, qrCodePng } from '../qrcode/index.js';
import { NfceError } from '../errors/index.js';

export interface DanfceOpcoes {
  /** Texto extra no rodapé (ex.: "Obrigado pela preferência"). */
  rodape?: string;
  /** Largura do papel em mm (padrão 80). */
  larguraMm?: number;
  /** Exibe quadro "via do estabelecimento"? (não usado na via do consumidor) */
  viaConsumidor?: boolean;
}

interface Dados {
  chave: string;
  emitente: { nome: string; cnpj: string; ie?: string; endereco: string };
  numero: string; serie: string; emissao: string; tpAmb: string; tpEmis: string;
  itens: Array<{ n: string; codigo: string; descricao: string; qtd: string; un: string; unit: string; total: string }>;
  vProd: string; vDesc: string; vOutro: string; vNF: string; vTotTrib?: string; troco?: string;
  pagamentos: Array<{ meio: string; valor: string }>;
  consumidor?: string;
  protocolo?: string; dhAutorizacao?: string;
  qrCode: string; urlChave: string;
}

const MEIOS: Record<string, string> = {
  '01': 'Dinheiro', '02': 'Cheque', '03': 'Cartão de Crédito', '04': 'Cartão de Débito', '05': 'Crédito Loja', '10': 'Vale Alimentação',
  '11': 'Vale Refeição', '12': 'Vale Presente', '13': 'Vale Combustível', '15': 'Boleto Bancário', '16': 'Depósito Bancário', '17': 'PIX',
  '18': 'Transferência', '19': 'Programa de Fidelidade', '90': 'Sem pagamento', '99': 'Outros',
};

const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const brl = (v: string | number | undefined) => (v === undefined ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const qtd = (v: string) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
export const formatarChave = (c: string) => c.replace(/(\d{4})/g, '$1 ').trim();

export function extrairDadosDanfce(xml: string): Dados {
  const o: any = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', removeNSPrefix: true, parseTagValue: false, cdataPropName: '#cdata' }).parse(xml);
  const nfe = o.nfeProc?.NFe ?? o.NFe;
  if (!nfe?.infNFe) throw new NfceError('XML sem NFe/infNFe: informe o XML da NFC-e (nfeProc ou NFe assinada).');
  const inf = nfe.infNFe;
  const supl = nfe.infNFeSupl ?? {};
  const prot = o.nfeProc?.protNFe?.infProt;
  const en = inf.emit.enderEmit ?? {};
  const qr = supl.qrCode;
  const pags = arr<any>(inf.pag?.detPag);
  const dest = inf.dest;
  return {
    chave: String(inf['@Id']).replace(/^NFe/, ''),
    emitente: {
      nome: inf.emit.xNome, cnpj: inf.emit.CNPJ, ie: inf.emit.IE,
      endereco: `${en.xLgr}, ${en.nro}${en.xCpl ? ' ' + en.xCpl : ''} - ${en.xBairro}, ${en.xMun}/${en.UF}`,
    },
    numero: inf.ide.nNF, serie: inf.ide.serie, emissao: inf.ide.dhEmi, tpAmb: inf.ide.tpAmb, tpEmis: inf.ide.tpEmis,
    itens: arr<any>(inf.det).map((d) => ({
      n: d['@nItem'], codigo: d.prod.cProd, descricao: d.prod.xProd, qtd: d.prod.qCom, un: d.prod.uCom, unit: d.prod.vUnCom, total: d.prod.vProd,
    })),
    vProd: inf.total.ICMSTot.vProd, vDesc: inf.total.ICMSTot.vDesc, vOutro: inf.total.ICMSTot.vOutro, vNF: inf.total.ICMSTot.vNF, vTotTrib: inf.total.ICMSTot.vTotTrib,
    troco: inf.pag?.vTroco,
    pagamentos: pags.map((p) => ({ meio: MEIOS[p.tPag] ?? p.xPag ?? p.tPag, valor: p.vPag })),
    consumidor: dest ? `${dest.CPF ? 'CPF ' + dest.CPF : dest.CNPJ ? 'CNPJ ' + dest.CNPJ : dest.idEstrangeiro ?? ''}${dest.xNome ? ' - ' + dest.xNome : ''}` : undefined,
    protocolo: prot?.nProt, dhAutorizacao: prot?.dhRecbto,
    qrCode: typeof qr === 'object' ? qr['#cdata'] : qr ?? '', urlChave: supl.urlChave ?? '',
  };
}

const fmtData = (iso: string) => {
  const d = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}:\d{2})/.exec(iso);
  return d ? `${d[3]}/${d[2]}/${d[1]} ${d[4]}` : iso;
};
const cnpjFmt = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

function avisos(d: Dados): string[] {
  const a: string[] = [];
  if (d.tpAmb === '2') a.push('EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL');
  if (d.tpEmis === '9' && !d.protocolo) a.push('EMITIDA EM CONTINGÊNCIA', 'Pendente de autorização');
  return a;
}

/** DANFCE em HTML (pronto para imprimir em bobina de 80 mm). */
export async function gerarDanfceHtml(xml: string, op: DanfceOpcoes = {}): Promise<string> {
  const d = extrairDadosDanfce(xml);
  const qr = d.qrCode ? await qrCodeDataUrl(d.qrCode, 300) : '';
  const w = op.larguraMm ?? 80;
  const linhasItens = d.itens
    .map((i) => `<tr><td>${esc(i.codigo)}</td><td>${esc(i.descricao)}</td><td class="r">${qtd(i.qtd)} ${esc(i.un)}</td><td class="r">${brl(i.unit)}</td><td class="r">${brl(i.total)}</td></tr>`)
    .join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>DANFE NFC-e ${esc(d.numero)}</title>
<style>@page{size:${w}mm auto;margin:2mm}body{font:11px/1.25 "Courier New",monospace;width:${w - 4}mm;margin:0 auto;color:#000}
.c{text-align:center}.r{text-align:right}.b{font-weight:bold}hr{border:0;border-top:1px dashed #000;margin:4px 0}table{width:100%;border-collapse:collapse}td{vertical-align:top;padding:0 1px}
.av{border:1px solid #000;padding:3px;margin:4px 0;font-weight:bold}img{width:36mm;height:36mm}</style></head><body>
<div class="c b">${esc(d.emitente.nome)}</div><div class="c">CNPJ ${cnpjFmt(d.emitente.cnpj)}${d.emitente.ie ? ' IE ' + esc(d.emitente.ie) : ''}<br>${esc(d.emitente.endereco)}</div><hr>
<div class="c b">DANFE NFC-e - Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica</div>
${avisos(d).map((a) => `<div class="av c">${esc(a)}</div>`).join('')}<hr>
<table><tr><td>Cód</td><td>Descrição</td><td class="r">Qtd</td><td class="r">Unit</td><td class="r">Total</td></tr>${linhasItens}</table><hr>
<table><tr><td>Qtd. total de itens</td><td class="r">${d.itens.length}</td></tr><tr><td>Valor total R$</td><td class="r">${brl(d.vProd)}</td></tr>
${Number(d.vDesc) ? `<tr><td>Descontos R$</td><td class="r">${brl(d.vDesc)}</td></tr>` : ''}${Number(d.vOutro) ? `<tr><td>Outras despesas R$</td><td class="r">${brl(d.vOutro)}</td></tr>` : ''}
<tr class="b"><td>Valor a pagar R$</td><td class="r">${brl(d.vNF)}</td></tr><tr><td colspan="2" class="b">Forma de pagamento</td></tr>
${d.pagamentos.map((p) => `<tr><td>${esc(p.meio)}</td><td class="r">${brl(p.valor)}</td></tr>`).join('')}${d.troco ? `<tr><td>Troco</td><td class="r">${brl(d.troco)}</td></tr>` : ''}</table><hr>
${d.vTotTrib ? `<div>Tributos totais incidentes (Lei Federal 12.741/2012): R$ ${brl(d.vTotTrib)}</div><hr>` : ''}
<div class="c">NFC-e nº ${esc(d.numero)} Série ${esc(d.serie)} ${fmtData(d.emissao)}<br>Consulte pela Chave de Acesso em<br>${esc(d.urlChave)}<br><span class="b">${formatarChave(d.chave)}</span></div><hr>
<div class="c">${d.consumidor ? 'CONSUMIDOR - ' + esc(d.consumidor) : 'CONSUMIDOR NÃO IDENTIFICADO'}</div><hr>
<div class="c">${qr ? `<img alt="QR Code" src="${qr}">` : ''}<br>${d.protocolo ? `Protocolo de autorização: ${esc(d.protocolo)}<br>Data de autorização: ${fmtData(d.dhAutorizacao ?? '')}` : ''}</div>
${op.rodape ? `<hr><div class="c">${esc(op.rodape)}</div>` : ''}</body></html>`;
}

/** DANFCE em PDF (largura de bobina; altura calculada pelo conteúdo). */
export async function gerarDanfcePdf(xml: string, op: DanfceOpcoes = {}): Promise<Buffer> {
  const d = extrairDadosDanfce(xml);
  const qrPng = d.qrCode ? await qrCodePng(d.qrCode, 300) : undefined;
  const mm = (v: number) => (v * 72) / 25.4;
  const W = mm(op.larguraMm ?? 80);
  const M = mm(3);
  const inner = W - 2 * M;

  const render = (doc: PDFKit.PDFDocument) => {
    const center = (t: string, size = 8, bold = false) => doc.font(bold ? 'Courier-Bold' : 'Courier').fontSize(size).text(t, M, doc.y, { width: inner, align: 'center' });
    const row = (l: string, r: string, bold = false) => {
      const y = doc.y;
      doc.font(bold ? 'Courier-Bold' : 'Courier').fontSize(8).text(l, M, y, { width: inner * 0.6 });
      const y2 = doc.y;
      doc.text(r, M + inner * 0.6, y, { width: inner * 0.4, align: 'right' });
      doc.y = Math.max(y2, doc.y);
    };
    const line = () => { doc.font('Courier').fontSize(8); doc.moveDown(0.25); doc.moveTo(M, doc.y).lineTo(W - M, doc.y).dash(2, { space: 2 }).stroke().undash(); doc.moveDown(0.5); };
    doc.y = M;
    center(d.emitente.nome, 9, true);
    center(`CNPJ ${cnpjFmt(d.emitente.cnpj)}${d.emitente.ie ? ' IE ' + d.emitente.ie : ''}`);
    center(d.emitente.endereco);
    line();
    center('DANFE NFC-e - Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica', 8, true);
    for (const a of avisos(d)) center(a, 8, true);
    line();
    for (const i of d.itens) {
      doc.font('Courier').fontSize(8).text(`${i.codigo} ${i.descricao}`, M, doc.y, { width: inner });
      row(`${qtd(i.qtd)} ${i.un} x ${brl(i.unit)}`, brl(i.total));
    }
    line();
    row('Qtd. total de itens', String(d.itens.length));
    row('Valor total R$', brl(d.vProd));
    if (Number(d.vDesc)) row('Descontos R$', brl(d.vDesc));
    if (Number(d.vOutro)) row('Outras despesas R$', brl(d.vOutro));
    row('Valor a pagar R$', brl(d.vNF), true);
    doc.font('Courier-Bold').fontSize(8).text('Forma de pagamento', M, doc.y);
    for (const p of d.pagamentos) row(p.meio, brl(p.valor));
    if (d.troco) row('Troco', brl(d.troco));
    line();
    if (d.vTotTrib) { doc.font('Courier').fontSize(7).text(`Tributos totais incidentes (Lei Federal 12.741/2012): R$ ${brl(d.vTotTrib)}`, M, doc.y, { width: inner }); line(); }
    center(`NFC-e nº ${d.numero} Série ${d.serie} ${fmtData(d.emissao)}`);
    center('Consulte pela Chave de Acesso em');
    center(d.urlChave, 7);
    center(formatarChave(d.chave), 8, true);
    line();
    center(d.consumidor ? `CONSUMIDOR - ${d.consumidor}` : 'CONSUMIDOR NÃO IDENTIFICADO');
    line();
    if (qrPng) { const s = mm(36); const y0 = doc.y; doc.image(qrPng, (W - s) / 2, y0, { width: s, height: s }); doc.y = y0 + s + 6; }
    if (d.protocolo) { center(`Protocolo de autorização: ${d.protocolo}`); center(`Data de autorização: ${fmtData(d.dhAutorizacao ?? '')}`); }
    if (op.rodape) { line(); center(op.rodape); }
  };

  // 1ª passada: mede a altura necessária; 2ª: gera com a altura exata.
  const medir = new PDFDocument({ autoFirstPage: false });
  medir.addPage({ size: [W, 6000], margin: 0 });
  medir.on('data', () => {});
  render(medir);
  const altura = Math.ceil(medir.y + 2 * M);
  medir.end();

  const doc = new PDFDocument({ autoFirstPage: false, info: { Title: `NFC-e ${d.numero}` } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  doc.addPage({ size: [W, altura], margin: 0 });
  render(doc);
  doc.end();
  return done;
}
