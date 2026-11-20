// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Lenderson Macedo — licença comercial disponível (ver COPYRIGHT.md).
import { runCli } from './run.js';

async function lerStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const partes: Buffer[] = [];
  for await (const p of process.stdin) partes.push(p as Buffer);
  return Buffer.concat(partes).toString('utf8');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const stdin = argv.includes('-') ? await lerStdin() : undefined;
  const { codigo, saida } = await runCli(argv, { stdin });
  // `ajuda` sai como texto para quem lê no terminal; todo o resto é JSON.
  if (typeof saida.ajuda === 'string' && process.stdout.isTTY) process.stdout.write(`${saida.ajuda}\n`);
  else process.stdout.write(`${JSON.stringify(saida, null, 2)}\n`);
  process.exitCode = codigo;
}

main().catch((e) => {
  process.stdout.write(`${JSON.stringify({ ok: false, codigo: 'ERRO_INTERNO', mensagem: (e as Error).message })}\n`);
  process.exitCode = 4;
});
