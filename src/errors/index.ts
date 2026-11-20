// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
/** Erro base da biblioteca. */
export class NfceError extends Error {
  /** true se a mesma operação pode ser repetida mais tarde (falha temporária). */
  readonly retentavel: boolean = false;
  /** Chave de acesso envolvida, quando já existe (use em `retomar(chave)`). */
  chave?: string;
  constructor(message: string, public readonly code = 'NFCE_ERROR') {
    super(message);
    this.name = new.target.name;
  }
}

/** Dados da nota inválidos (detectado antes do envio). */
export class ValidationError extends NfceError {
  constructor(message: string, public readonly campos: string[] = []) {
    super(message, 'VALIDATION');
  }
}

/** Falha de comunicação (timeout, DNS, TLS, HTTP != 200). Temporária: pode ser repetida. */
export class TransportError extends NfceError {
  override readonly retentavel = true;
  constructor(message: string, public readonly causa?: unknown) {
    super(message, 'TRANSPORT');
  }
}

/** Códigos da SEFAZ que indicam indisponibilidade temporária. */
export const CSTAT_INDISPONIVEL = ['108', '109', '999'];

/** SEFAZ respondeu com erro. Retentável quando indica indisponibilidade (108, 109, 999). */
export class SefazError extends NfceError {
  override readonly retentavel: boolean;
  constructor(
    message: string,
    public readonly cStat: string,
    public readonly xMotivo: string,
    public readonly resposta?: unknown,
  ) {
    super(message, 'SEFAZ');
    this.retentavel = CSTAT_INDISPONIVEL.includes(cStat);
  }
}

export class CertificateError extends NfceError {
  constructor(message: string) {
    super(message, 'CERTIFICATE');
  }
}
