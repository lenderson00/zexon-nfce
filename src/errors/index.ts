// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
/** Erro base da biblioteca. */
export class NfceError extends Error {
  /** true se a mesma operação pode ser repetida mais tarde (falha temporária). */
  readonly retentavel: boolean = false;
  /**
   * true quando é **certo** que a SEFAZ não recebeu a requisição (conexão recusada, DNS, handshake TLS,
   * ou serviço paralisado 108/109). false = incerto: a nota pode ter sido processada.
   */
  readonly naoRecebido: boolean = false;
  /** Chave de acesso envolvida, quando já existe (use em `retomar(chave)`). */
  chave?: string;
  constructor(message: string, public readonly code = 'NFCE_ERROR') {
    super(message);
    this.name = new.target.name;
  }
}

/** Dados da nota inválidos (detectado antes do envio). */
export class ValidationError extends NfceError {
  constructor(
    message: string,
    public readonly campos: string[] = [],
    /** Um problema por campo (mesma ordem de `campos`), quando a validação os detalha. */
    public readonly detalhes: Array<{ campo: string; mensagem: string }> = [],
  ) {
    super(message, 'VALIDATION');
  }
}

/** Falha de comunicação (timeout, DNS, TLS, HTTP). Em geral temporária; ver `retentavel` e `naoRecebido`. */
export class TransportError extends NfceError {
  override readonly retentavel: boolean;
  override readonly naoRecebido: boolean;
  constructor(message: string, public readonly causa?: unknown, opcoes: { naoRecebido?: boolean; retentavel?: boolean } = {}) {
    super(message, 'TRANSPORT');
    this.retentavel = opcoes.retentavel ?? true;
    this.naoRecebido = opcoes.naoRecebido ?? false;
  }
}

/** Códigos da SEFAZ que indicam indisponibilidade temporária. */
export const CSTAT_INDISPONIVEL = ['108', '109', '999'];

/** SEFAZ respondeu com erro. Retentável quando indica indisponibilidade (108, 109, 999). */
export class SefazError extends NfceError {
  override readonly retentavel: boolean;
  override readonly naoRecebido: boolean;
  constructor(
    message: string,
    public readonly cStat: string,
    public readonly xMotivo: string,
    public readonly resposta?: unknown,
  ) {
    super(message, 'SEFAZ');
    this.retentavel = CSTAT_INDISPONIVEL.includes(cStat);
    // 108/109: serviço paralisado — o lote não foi processado. 999 (erro não catalogado) fica como incerto.
    this.naoRecebido = cStat === '108' || cStat === '109';
  }
}

export class CertificateError extends NfceError {
  constructor(message: string) {
    super(message, 'CERTIFICATE');
  }
}
