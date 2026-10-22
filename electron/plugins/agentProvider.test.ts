/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';
import { AgentProviderRegistry, type AgentProvider } from './agentProvider';

function createProvider(): AgentProvider {
  return {
    id: 'fake-agent',
    name: 'Fake Agent',
    async listCapabilities() {
      return [{
        providerId: 'fake-agent',
        id: 'hello',
        name: 'Hello',
        version: '1.0.0',
        permissions: [],
        health: { status: 'ok', checkedAt: '2026-10-22T12:00:00.000Z' },
      }];
    },
    async install(capabilityId) {
      return { providerId: 'fake-agent', capabilityId, status: 'applied' as const };
    },
    async enable(capabilityId) {
      return { providerId: 'fake-agent', capabilityId, status: 'applied' as const };
    },
    async disable(capabilityId) {
      return { providerId: 'fake-agent', capabilityId, status: 'applied' as const };
    },
    async remove(capabilityId) {
      return { providerId: 'fake-agent', capabilityId, status: 'applied' as const };
    },
    async health() {
      return { status: 'ok', checkedAt: '2026-10-22T12:00:00.000Z' };
    },
    async invoke(capabilityId, action, input) {
      return { capabilityId, action, input };
    },
  };
}

describe('AgentProviderRegistry', () => {
  it('lists providers/capabilities and delegates lifecycle operations', async () => {
    const registry = new AgentProviderRegistry();
    registry.register(createProvider());

    const listed = await registry.list();
    expect(listed.providers).toEqual([
      expect.objectContaining({ id: 'fake-agent', health: expect.objectContaining({ status: 'ok' }) }),
    ]);
    expect(listed.capabilities[0]).toEqual(expect.objectContaining({
      providerId: 'fake-agent',
      id: 'hello',
    }));

    await expect(registry.install('fake-agent', 'hello')).resolves.toEqual(expect.objectContaining({
      status: 'applied',
      capabilityId: 'hello',
    }));
    await expect(registry.invoke('fake-agent', 'hello', 'ping', { n: 1 })).resolves.toEqual({
      capabilityId: 'hello',
      action: 'ping',
      input: { n: 1 },
    });
    await expect(registry.rollback('fake-agent', 'hello')).rejects.toMatchObject({
      code: 'plugin_failed',
    });
  });

  it('reports provider health failures without breaking the list', async () => {
    const registry = new AgentProviderRegistry();
    const provider = createProvider();
    provider.listCapabilities = vi.fn().mockRejectedValue(new Error('list failed'));
    provider.health = vi.fn().mockRejectedValue(new Error('health failed'));
    registry.register(provider);

    const listed = await registry.list();
    expect(listed.providers[0].health.status).toBe('failed');
    expect(listed.capabilities).toEqual([]);
  });
});
