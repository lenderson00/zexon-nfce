// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
import type { S3Client, S3ClientConfig } from '@aws-sdk/client-s3';
import type { Storage, TipoDocumento } from './index.js';
import { NfceError } from '../errors/index.js';

export interface S3StorageOptions {
  /** Nome do bucket. Único campo obrigatório. */
  bucket: string;
  /** Prefixo das chaves (ex.: "nfce/loja-01"). Padrão: "nfce". */
  prefixo?: string;
  /** Região. Padrão: AWS_REGION / AWS_DEFAULT_REGION / us-east-1. */
  regiao?: string;
  /** Endpoint de serviços compatíveis (MinIO, Cloudflare R2, DigitalOcean Spaces, Wasabi...). */
  endpoint?: string;
  /** Credenciais explícitas. Padrão: cadeia da AWS (variáveis de ambiente, perfil, IAM role). */
  credenciais?: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
  /** Criptografia no servidor. Padrão: "AES256". Use `false` para desativar (alguns compatíveis não suportam). */
  criptografia?: 'AES256' | 'aws:kms' | false;
  /** Configuração extra repassada ao S3Client. */
  clientConfig?: S3ClientConfig;
  /** Cliente já criado (reuso de conexões ou testes). */
  client?: S3Client;
}

type SdkS3 = typeof import('@aws-sdk/client-s3');
let sdk: Promise<SdkS3> | undefined;
const carregarSdk = () =>
  (sdk ??= import('@aws-sdk/client-s3').catch(() => {
    sdk = undefined;
    throw new NfceError('S3Storage requer o pacote "@aws-sdk/client-s3": npm install @aws-sdk/client-s3', 'DEPENDENCIA_AUSENTE');
  }));

const naoEncontrado = (e: unknown) => {
  const x = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return x?.name === 'NoSuchKey' || x?.name === 'NotFound' || x?.$metadata?.httpStatusCode === 404;
};

/**
 * Armazena os XMLs no Amazon S3 (ou compatível).
 *
 * ```ts
 * new NfceClient({ ..., storage: new S3Storage({ bucket: 'minha-empresa-nfce' }) })
 * ```
 * Chaves: `<prefixo>/<tipo>/<nome>.xml` — ex.: `nfce/autorizadas/3526...0670.xml`.
 * Permissões IAM necessárias: s3:PutObject, s3:GetObject, s3:DeleteObject e s3:ListBucket.
 */
export class S3Storage implements Storage {
  private clientPromise?: Promise<S3Client>;
  private readonly prefixo: string;

  constructor(private readonly opts: S3StorageOptions) {
    if (!opts?.bucket) throw new NfceError('S3Storage: informe `bucket`.', 'CONFIG');
    this.prefixo = (opts.prefixo ?? 'nfce').replace(/^\/+|\/+$/g, '');
  }

  private async s3(): Promise<{ client: S3Client; sdk: SdkS3 }> {
    const mod = await carregarSdk();
    this.clientPromise ??= Promise.resolve(
      this.opts.client ??
        new mod.S3Client({
          region: this.opts.regiao ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
          endpoint: this.opts.endpoint,
          forcePathStyle: this.opts.endpoint ? true : undefined,
          credentials: this.opts.credenciais,
          ...this.opts.clientConfig,
        }),
    );
    return { client: await this.clientPromise, sdk: mod };
  }

  private chave(tipo: TipoDocumento, nome?: string): string {
    const base = this.prefixo ? `${this.prefixo}/${tipo}/` : `${tipo}/`;
    return nome === undefined ? base : `${base}${nome}.xml`;
  }

  async salvar(tipo: TipoDocumento, nome: string, conteudo: string): Promise<void> {
    const { client, sdk } = await this.s3();
    const cripto = this.opts.criptografia ?? 'AES256';
    await client.send(new sdk.PutObjectCommand({
      Bucket: this.opts.bucket, Key: this.chave(tipo, nome), Body: conteudo,
      ContentType: 'application/xml; charset=utf-8',
      ...(cripto ? { ServerSideEncryption: cripto } : {}),
      Metadata: { tipo },
    }));
  }

  async ler(tipo: TipoDocumento, nome: string): Promise<string | undefined> {
    const { client, sdk } = await this.s3();
    try {
      const r = await client.send(new sdk.GetObjectCommand({ Bucket: this.opts.bucket, Key: this.chave(tipo, nome) }));
      return await r.Body?.transformToString('utf-8');
    } catch (e) {
      if (naoEncontrado(e)) return undefined;
      throw e;
    }
  }

  async listar(tipo: TipoDocumento): Promise<string[]> {
    const { client, sdk } = await this.s3();
    const prefixo = this.chave(tipo);
    const nomes: string[] = [];
    let token: string | undefined;
    do {
      const r = await client.send(new sdk.ListObjectsV2Command({ Bucket: this.opts.bucket, Prefix: prefixo, ContinuationToken: token }));
      for (const o of r.Contents ?? []) {
        const k = o.Key ?? '';
        const nome = k.slice(prefixo.length);
        if (nome.endsWith('.xml') && !nome.includes('/')) nomes.push(nome.slice(0, -4));
      }
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return nomes;
  }

  async remover(tipo: TipoDocumento, nome: string): Promise<void> {
    const { client, sdk } = await this.s3();
    await client.send(new sdk.DeleteObjectCommand({ Bucket: this.opts.bucket, Key: this.chave(tipo, nome) }));
  }
}
