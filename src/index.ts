// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
export { NfceClient, Contingencia, fusoDaUF, resolverStorage } from './client/NfceClient.js';
export type { NfceClientConfig, ResultadoEmissao, ResultadoConsulta, ResultadoEvento, ResultadoInutilizacao, StatusEmissao } from './client/NfceClient.js';
export { NfceBuilder } from './builder/NfceBuilder.js';
export * from './types.js';
export { validarNota, cpfValido, cnpjValido, gtinValido } from './validation/index.js';
export { montarChave, validarChave, parseChave, dvModulo11, UF_CODIGO } from './xml/chave.js';
export type { UF } from './xml/chave.js';
export { montarNfce } from './xml/nfce.js';
export { assinarXml, verificarAssinatura } from './xml/sign.js';
export { carregarCertificado } from './certificate/index.js';
export { montarQrCodeOnline, montarQrCodeOffline, qrCodePng, qrCodeSvg, qrCodeDataUrl } from './qrcode/index.js';
export { resolverEndpoints, ENDPOINTS } from './sefaz/endpoints.js';
export type { EndpointsOverride, Servico } from './sefaz/endpoints.js';
export { gerarDanfceHtml, gerarDanfcePdf, extrairDadosDanfce } from './danfce/index.js';
export type { DanfceOpcoes } from './danfce/index.js';
export { FileStorage, MemoryStorage } from './storage/index.js';
export { S3Storage } from './storage/s3.js';
export type { S3StorageOptions } from './storage/s3.js';
export type { Storage, StorageConfig, TipoDocumento } from './storage/index.js';
export * from './errors/index.js';
export { calcularIbsCbs, aliquotasPadrao, baseIbsCbs, classTrib, CCLASSTRIB_NFCE, CST_IBSCBS } from './rtc/index.js';
export type { ClassTrib, IndicadoresCst } from './rtc/index.js';
