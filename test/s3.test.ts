import { describe, expect, it } from 'vitest';
import type { S3Client } from '@aws-sdk/client-s3';
import { S3Storage } from '../src/storage/s3.js';
import { NfceClient } from '../src/client/NfceClient.js';
import { TransportError } from '../src/errors/index.js';
import { gerarPfxTeste, notaExemplo } from './helpers.js';

/** S3 em memória: implementa os 4 comandos usados, com paginação de 2 objetos por página. */
function fakeS3() {
  const objs = new Map<string, { body: string; input: Record<string, unknown> }>();
  const send = async (cmd: { constructor: { name: string }; input: any }) => {
    const i = cmd.input;
    switch (cmd.constructor.name) {
      case 'PutObjectCommand': objs.set(`${i.Bucket}/${i.Key}`, { body: i.Body, input: i }); return {};
      case 'GetObjectCommand': {
        const o = objs.get(`${i.Bucket}/${i.Key}`);
        if (!o) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
        return { Body: { transformToString: async () => o.body } };
      }
      case 'DeleteObjectCommand': objs.delete(`${i.Bucket}/${i.Key}`); return {};
      case 'ListObjectsV2Command': {
        const keys = [...objs.keys()].filter((k) => k.startsWith(`${i.Bucket}/${i.Prefix}`)).map((k) => k.slice(i.Bucket.length + 1)).sort();
        const start = Number(i.ContinuationToken ?? 0);
        const page = keys.slice(start, start + 2);
        const more = start + 2 < keys.length;
        return { Contents: page.map((Key) => ({ Key })), IsTruncated: more, NextContinuationToken: more ? String(start + 2) : undefined };
      }
      default: throw new Error(`comando inesperado ${cmd.constructor.name}`);
    }
  };
  return { client: { send } as unknown as S3Client, objs };
}

describe('S3Storage', () => {
  it('salva, lê, lista (paginado) e remove', async () => {
    const { client, objs } = fakeS3();
    const st = new S3Storage({ bucket: 'loja', prefixo: 'nfce/loja-01/', client });
    for (const n of ['a', 'b', 'c', 'd', 'e']) await st.salvar('autorizadas', n, `<x>${n}</x>`);
    await st.salvar('cancelamentos', 'z', '<z/>');
    expect(objs.has('loja/nfce/loja-01/autorizadas/a.xml')).toBe(true);
    const put = objs.get('loja/nfce/loja-01/autorizadas/a.xml')!.input;
    expect(put.ServerSideEncryption).toBe('AES256');
    expect(put.ContentType).toMatch(/xml/);
    expect(await st.ler('autorizadas', 'c')).toBe('<x>c</x>');
    expect(await st.ler('autorizadas', 'nao-existe')).toBeUndefined();
    expect((await st.listar('autorizadas')).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(await st.listar('cancelamentos')).toEqual(['z']);
    await st.remover('autorizadas', 'a');
    expect(await st.listar('autorizadas')).toHaveLength(4);
  });

  it('exige bucket', () => {
    expect(() => new S3Storage({ bucket: '' })).toThrow(/bucket/);
  });

  it('criptografia pode ser desativada (serviços compatíveis)', async () => {
    const { client, objs } = fakeS3();
    await new S3Storage({ bucket: 'b', client, criptografia: false }).salvar('rejeitadas', 'x', '<x/>');
    expect(objs.get('b/nfce/rejeitadas/x.xml')!.input.ServerSideEncryption).toBeUndefined();
  });

  it('contingência completa usando S3', async () => {
    const { client, objs } = fakeS3();
    const storage = new S3Storage({ bucket: 'nfce', client }); // mesmo uso do FileStorage
    const pfx = gerarPfxTeste();
    const off = new NfceClient({
      uf: 'SP', ambiente: 'homologacao', certificado: pfx, storage, contingenciaAutomatica: true, retentativas: { esperasMs: [0] },
      transporte: { fetchImpl: async () => { throw new TransportError('offline'); } },
    });
    const r = await off.emitir(notaExemplo());
    expect(r.status).toBe('contingencia');
    expect(objs.has(`nfce/nfce/contingencia/${r.chave}.xml`)).toBe(true);
    expect(await off.contingencia.pendentes()).toEqual([r.chave]);
  });
});
