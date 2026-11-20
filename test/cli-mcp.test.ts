import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { criarServidorMcp } from '../src/cli/mcp.js';
import { EXEMPLOS } from '../src/cli/exemplos.js';
import { tmpdir } from 'node:os';

describe('servidor MCP', () => {
  it('lista as ferramentas e valida uma venda inline', async () => {
    const server = criarServidorMcp({ cwd: tmpdir(), env: {} });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'teste', version: '1.0.0' });
    await Promise.all([server.connect(a), client.connect(b)]);

    const { tools } = await client.listTools();
    const nomes = tools.map((t) => t.name);
    expect(nomes).toEqual(expect.arrayContaining(['nfce_validar', 'nfce_emitir', 'nfce_schema', 'nfce_exemplo', 'nfce_pendentes', 'nfce_cancelar']));
    expect(tools.find((t) => t.name === 'nfce_emitir')!.inputSchema.required).toContain('referencia');

    const ok = await client.callTool({ name: 'nfce_validar', arguments: { nota: EXEMPLOS.pix!.nota } });
    expect(ok.isError).toBe(false);
    expect(JSON.parse((ok.content as Array<{ text: string }>)[0]!.text)).toMatchObject({ codigoSaida: 0, ok: true, total: 18 });

    const ruim = await client.callTool({ name: 'nfce_validar', arguments: { nota: { itens: [], pagamentos: [] } } });
    expect(ruim.isError).toBe(true);
    expect(JSON.parse((ruim.content as Array<{ text: string }>)[0]!.text).codigoSaida).toBe(1);

    const semConfig = await client.callTool({ name: 'nfce_emitir', arguments: { nota: EXEMPLOS.pix!.nota, referencia: 'x' } });
    expect(JSON.parse((semConfig.content as Array<{ text: string }>)[0]!.text)).toMatchObject({ codigoSaida: 4, codigo: 'SEM_CONFIG' });
    await client.close();
  });
});
