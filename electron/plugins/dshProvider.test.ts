/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';
import { createDshAgentProvider, DshBridgeClient } from './dshProvider';

function bridgeFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    expect(init?.headers).toEqual(expect.objectContaining({
      authorization: 'Bearer bridge-token',
    }));

    if (url.endsWith('/health')) {
      return new Response(JSON.stringify({
        protocol: 1,
        profileId: 'profile-1',
        runtimeVersion: '0.2.1-rc.2',
        host: 'running',
      }), { status: 200 });
    }

    if (url.endsWith('/v1/inventory')) {
      return new Response(JSON.stringify({
        plugins: [],
        bundles: [],
        capabilities: [{
          name: 'herein_hello',
          description: 'Return a greeting.',
          parameters: { name: { type: 'string', required: true } },
        }],
      }), { status: 200 });
    }

    if (url.endsWith('/v1/call')) {
      const body = JSON.parse(String(init?.body)) as { name: string; arguments: unknown };
      expect(body.name).toBe('herein_hello');
      expect(body.arguments).toEqual({ name: 'Herein' });
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: 'hello Herein' }],
        value: 'hello Herein',
      }), { status: 200 });
    }

    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
}

describe('createDshAgentProvider', () => {
  it('exposes DSH inventory as external capabilities and invokes tools', async () => {
    const fetchImpl = bridgeFetch();
    const provider = createDshAgentProvider({
      url: 'http://dsh.test/',
      token: 'bridge-token',
      fetchImpl,
    });

    const capabilities = await provider.listCapabilities();
    expect(capabilities).toEqual([
      expect.objectContaining({
        providerId: 'dsh',
        id: 'herein_hello',
        name: 'herein_hello',
        lifecycle: 'external',
        actions: ['call'],
        installed: true,
        enabled: true,
      }),
    ]);
    expect(capabilities[0].inputSchema).toEqual({ name: { type: 'string', required: true } });

    await expect(provider.invoke?.('herein_hello', 'call', { name: 'Herein' })).resolves.toEqual({
      content: [{ type: 'text', text: 'hello Herein' }],
      value: 'hello Herein',
    });
    await expect(provider.install('herein_hello')).resolves.toEqual(expect.objectContaining({
      status: 'failed',
      capabilityId: 'herein_hello',
    }));
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('reports an offline DSH host as degraded', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      host: 'offline',
      runtimeVersion: '0.2.1-rc.2',
    }), { status: 200 })) as typeof fetch;
    const provider = createDshAgentProvider({
      url: 'http://dsh.test',
      token: 'bridge-token',
      fetchImpl,
    });

    await expect(provider.health()).resolves.toEqual(expect.objectContaining({
      status: 'degraded',
    }));
  });

  it('rejects non-object call inputs and unsupported actions', async () => {
    const provider = createDshAgentProvider({
      url: 'http://dsh.test',
      token: 'bridge-token',
      fetchImpl: bridgeFetch(),
    });

    await expect(provider.invoke?.('herein_hello', 'call', 'nope')).rejects.toMatchObject({
      code: 'plugin_failed',
    });
    await expect(provider.invoke?.('herein_hello', 'remove', {})).rejects.toMatchObject({
      code: 'plugin_failed',
    });
  });
});

describe('DshBridgeClient', () => {
  it('surfaces bridge HTTP errors with the stable code', async () => {
    const client = new DshBridgeClient({
      url: 'http://dsh.test',
      token: 'bridge-token',
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        error: { code: 'AUTH_REQUIRED' },
      }), { status: 401 })) as typeof fetch,
    });

    await expect(client.health()).rejects.toThrow('AUTH_REQUIRED');
  });
});
