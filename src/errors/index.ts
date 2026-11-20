/** Erro base da biblioteca. */
export class NfceError extends Error {
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

/** Falha de comunicação (timeout, DNS, TLS, HTTP != 200). Candidata a contingência. */
export class TransportError extends NfceError {
  constructor(message: string, public readonly causa?: unknown) {
    super(message, 'TRANSPORT');
  }
}

/** SEFAZ respondeu com rejeição/erro de negócio. */
export class SefazError extends NfceError {
  constructor(
    message: string,
    public readonly cStat: string,
    public readonly xMotivo: string,
    public readonly resposta?: unknown,
  ) {
    super(message, 'SEFAZ');
  }
}

export class CertificateError extends NfceError {
  constructor(message: string) {
    super(message, 'CERTIFICATE');
  }
}
