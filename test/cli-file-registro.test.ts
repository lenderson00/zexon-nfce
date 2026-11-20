import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileNumerador, FileRegistro } from '../src/registro/file.js';
import { RegistroDuplicadoError, type RegistroNota } from '../src/registro/index.js';

const k = { cnpj: '11222333000181', ambiente: 'homologacao' as const, modelo: 65 as const, serie: 1 };
const nota = (chave: string, numero: number, over: Partial<RegistroNota> = {}): RegistroNota => ({
  chave, cnpj: k.cnpj, uf: 'SP', ambiente: 'homologacao', serie: 1, numero, tpEmis: 1, situacao: 'pendente', valor: 10,
  emitidaEm: '2026-11-20T10:00:00-03:00', tentativas: 0, criadaEm: new Date().toISOString(), atualizadaEm: new Date().toISOString(), ...over,
});

describe('FileNumerador / FileRegistro', () => {
  it('numeração atômica: 50 chamadas paralelas (instâncias distintas) sem número repetido', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nfce-num-'));
    const ns = await Promise.all(Array.from({ length: 50 }, () => new FileNumerador(dir).proximo(k)));
    expect(new Set(ns).size).toBe(50);
    expect(Math.max(...ns)).toBe(50);
    await expect(new FileNumerador(dir).definirInicio(k, 10)).rejects.toThrow(/já entregou/);
    await new FileNumerador(dir).definirInicio(k, 100);
    expect(await new FileNumerador(dir).proximo(k)).toBe(100);
  }, 30_000);

  it('registro persiste entre instâncias e aplica as regras de unicidade', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nfce-reg-'));
    await new FileRegistro(dir).registrar(nota('A'.padEnd(44, '0'), 1, { referencia: 'v1' }));
    const r2 = new FileRegistro(dir);
    expect(await r2.buscarPorReferencia(k.cnpj, 'homologacao', 'v1')).toMatchObject({ numero: 1 });
    await expect(r2.registrar(nota('B'.padEnd(44, '0'), 1))).rejects.toBeInstanceOf(RegistroDuplicadoError);
    await expect(r2.registrar(nota('C'.padEnd(44, '0'), 2, { referencia: 'v1' }))).rejects.toBeInstanceOf(RegistroDuplicadoError);
    await r2.atualizar('A'.padEnd(44, '0'), { situacao: 'autorizada' });
    expect(await new FileRegistro(dir).pendentes()).toHaveLength(0);
    await r2.registrarInutilizacao({ cnpj: k.cnpj, ambiente: 'homologacao', serie: 1, inicio: 3, fim: 3 });
    expect(await new FileRegistro(dir).buracos({ cnpj: k.cnpj, ambiente: 'homologacao', serie: 1, ate: 4 })).toEqual([2, 4]);
  });

  it('registros paralelos com o mesmo número: só um vence', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nfce-reg2-'));
    const rs = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => new FileRegistro(dir).registrar(nota(String(i).padEnd(44, '1'), 7))));
    expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
});
