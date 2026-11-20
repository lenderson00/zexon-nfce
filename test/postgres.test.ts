import { describe, expect, it, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PostgresNumerador, PostgresRegistro, criarTabelas } from '../src/postgres/index.js';
import { RegistroDuplicadoError, type RegistroNota } from '../src/registro/index.js';

const reg = (over: Partial<RegistroNota> = {}): RegistroNota => ({
  chave: '35261111222333000181650010000000011000000011', cnpj: '11222333000181', uf: 'SP', ambiente: 'homologacao',
  serie: 1, numero: 1, tpEmis: 1, situacao: 'pendente', valor: 25.9, emitidaEm: '2026-11-20T10:00:00-03:00',
  tentativas: 0, criadaEm: new Date().toISOString(), atualizadaEm: new Date().toISOString(), ...over,
});

let db: PGlite;
beforeEach(async () => {
  db = new PGlite();
  await criarTabelas(db);
  await criarTabelas(db); // idempotente
});

describe('PostgresNumerador', () => {
  const k = { cnpj: '11222333000181', ambiente: 'homologacao' as const, modelo: 65 as const, serie: 1 };

  it('100 pedidos simultâneos recebem números distintos e sequenciais', async () => {
    const num = new PostgresNumerador(db);
    const ns = await Promise.all(Array.from({ length: 100 }, () => num.proximo(k)));
    expect(new Set(ns).size).toBe(100);
    expect(Math.min(...ns)).toBe(1);
    expect(Math.max(...ns)).toBe(100);
  });

  it('sequências independentes por CNPJ, série e ambiente', async () => {
    const num = new PostgresNumerador(db);
    await num.proximo(k); await num.proximo(k);
    expect(await num.proximo({ ...k, serie: 2 })).toBe(1);
    expect(await num.proximo({ ...k, ambiente: 'producao' })).toBe(1);
    expect(await num.proximo({ ...k, cnpj: '99888777000166' })).toBe(1);
    expect(await num.proximo(k)).toBe(3);
  });

  it('definirInicio para migração de outro emissor', async () => {
    const num = new PostgresNumerador(db);
    await num.definirInicio(k, 5001);
    expect(await num.proximo(k)).toBe(5001);
    expect(await num.ultimo(k)).toBe(5001);
  });

  it('schema próprio', async () => {
    await db.query('CREATE SCHEMA fiscal');
    await criarTabelas(db, { schema: 'fiscal' });
    expect(await new PostgresNumerador(db, { schema: 'fiscal' }).proximo(k)).toBe(1);
    expect(() => new PostgresNumerador(db, { schema: 'x; drop' })).toThrow(/schema inválido/);
  });
});

describe('PostgresRegistro', () => {
  it('registra, atualiza e busca', async () => {
    const r = new PostgresRegistro(db);
    await r.registrar(reg({ referencia: 'pedido-1' }));
    await r.atualizar(reg().chave, { situacao: 'autorizada', protocolo: '135260000000001', autorizadaEm: '2026-11-20T10:00:05-03:00', tentativas: 1 });
    const n = await r.buscar(reg().chave);
    expect(n).toMatchObject({ situacao: 'autorizada', protocolo: '135260000000001', valor: 25.9, ambiente: 'homologacao', numero: 1, tentativas: 1 });
    expect((await r.buscarPorReferencia('11222333000181', 'homologacao', 'pedido-1'))?.chave).toBe(reg().chave);
    expect(await r.buscarPorReferencia('11222333000181', 'producao', 'pedido-1')).toBeUndefined();
  });

  it('chave ou referência duplicada', async () => {
    const r = new PostgresRegistro(db);
    await r.registrar(reg({ referencia: 'pedido-1' }));
    await expect(r.registrar(reg())).rejects.toBeInstanceOf(RegistroDuplicadoError);
    await expect(r.registrar(reg({ chave: '3'.repeat(44), numero: 3, referencia: 'pedido-1' }))).rejects.toBeInstanceOf(RegistroDuplicadoError);
    // sem referência não há restrição
    await r.registrar(reg({ chave: '4'.repeat(44), numero: 4 }));
    // referência pode ser liberada (reemissão) e reutilizada
    await r.atualizar(reg().chave, { referencia: null });
    await r.registrar(reg({ chave: '5'.repeat(44), numero: 5, referencia: 'pedido-1' }));
  });

  it('pendentes filtrados e ordenados', async () => {
    const r = new PostgresRegistro(db);
    await r.registrar(reg({ chave: '1'.repeat(44), criadaEm: '2026-11-20T10:00:00Z' }));
    await r.registrar(reg({ chave: '2'.repeat(44), numero: 2, situacao: 'contingencia', tpEmis: 9, criadaEm: '2026-11-20T09:00:00Z' }));
    await r.registrar(reg({ chave: '6'.repeat(44), numero: 6, situacao: 'autorizada' }));
    await r.registrar(reg({ chave: '7'.repeat(44), numero: 7, uf: 'MG' }));
    const p = await r.pendentes({ uf: 'SP', ambiente: 'homologacao' });
    expect(p.map((x) => x.chave)).toEqual(['2'.repeat(44), '1'.repeat(44)]);
    expect(await r.pendentes({ ambiente: 'producao' })).toEqual([]);
  });

  it('número único: duas notas vivas no mesmo número são recusadas; rejeitada/descartada liberam', async () => {
    const r = new PostgresRegistro(db);
    await r.registrar(reg({ chave: 'A'.padEnd(44, '0'), numero: 10, situacao: 'autorizada' }));
    await expect(r.registrar(reg({ chave: 'B'.padEnd(44, '0'), numero: 10, situacao: 'autorizada' }))).rejects.toBeInstanceOf(RegistroDuplicadoError);
    await r.registrar(reg({ chave: 'C'.padEnd(44, '0'), numero: 11, situacao: 'rejeitada' }));
    await r.registrar(reg({ chave: 'D'.padEnd(44, '0'), numero: 11, situacao: 'pendente' })); // reemissão no número da rejeitada
    await expect(r.atualizar('C'.padEnd(44, '0'), { situacao: 'autorizada' })).rejects.toBeInstanceOf(RegistroDuplicadoError);
    expect((await r.buscarPorNumero('11222333000181', 'homologacao', 1, 11)).map((n) => n.situacao).sort()).toEqual(['pendente', 'rejeitada']);
  });

  it('cancelamento grava protocolo e data', async () => {
    const r = new PostgresRegistro(db);
    await r.registrar(reg({ situacao: 'autorizada' }));
    await r.atualizar(reg().chave, { situacao: 'cancelada', protocoloCancelamento: '135260000000099', canceladaEm: '2026-11-20T13:10:00.000Z' });
    expect(await r.buscar(reg().chave)).toMatchObject({ situacao: 'cancelada', protocoloCancelamento: '135260000000099', canceladaEm: '2026-11-20T13:10:00.000Z' });
  });

  it('buracos de numeração', async () => {
    const num = new PostgresNumerador(db);
    const r = new PostgresRegistro(db);
    const k = { cnpj: '11222333000181', ambiente: 'homologacao' as const, modelo: 65 as const, serie: 1 };
    for (let i = 0; i < 6; i++) await num.proximo(k); // números 1..6 entregues
    const ok = (n: number, situacao: RegistroNota['situacao'] = 'autorizada') => r.registrar(reg({ chave: String(n).padStart(44, '0'), numero: n, situacao }));
    await ok(1); await ok(2); await ok(4, 'rejeitada'); await ok(5, 'pendente');
    expect(await r.buracos({ cnpj: k.cnpj, ambiente: 'homologacao', serie: 1 })).toEqual([3, 4, 6]);
    // descartada não ocupa o número; inutilizados deixam de ser buraco
    await r.registrar(reg({ chave: '9'.repeat(44), numero: 3, situacao: 'descartada' }));
    await r.registrarInutilizacao({ cnpj: k.cnpj, ambiente: 'homologacao', serie: 1, inicio: 6, fim: 6, protocolo: '1' });
    expect(await r.buracos({ cnpj: k.cnpj, ambiente: 'homologacao', serie: 1 })).toEqual([3, 4]);
  });

  it('definirInicio não volta a numeração (salvo forcar)', async () => {
    const num = new PostgresNumerador(db);
    const k = { cnpj: '11222333000181', ambiente: 'homologacao' as const, modelo: 65 as const, serie: 1 };
    for (let i = 0; i < 10; i++) await num.proximo(k);
    await expect(num.definirInicio(k, 1)).rejects.toThrow(/já entregou até o número 10/);
    await expect(num.definirInicio(k, 10)).rejects.toThrow();
    await num.definirInicio(k, 11); // continuar exatamente de onde parou é permitido
    expect(await num.proximo(k)).toBe(11);
    await num.definirInicio(k, 1, { forcar: true });
    expect(await num.proximo(k)).toBe(1);
  });
});
