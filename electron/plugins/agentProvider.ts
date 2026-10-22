import { PluginError, type PluginHealth, type PluginPermission } from './types';

export interface AgentCapabilityDescriptor {
  providerId: string;
  id: string;
  name: string;
  version: string;
  description?: string;
  permissions: PluginPermission[];
  health: PluginHealth;
  installed?: boolean;
  enabled?: boolean;
  actions?: string[];
}

export type AgentOperationStatus = 'applied' | 'restart-required' | 'failed';

export interface AgentOperationResult {
  providerId: string;
  capabilityId: string;
  status: AgentOperationStatus;
  message?: string;
  detail?: Record<string, unknown>;
}

export interface AgentProviderInfo {
  id: string;
  name: string;
  health: PluginHealth;
}

export interface AgentProvider {
  id: string;
  name: string;
  listCapabilities(): Promise<AgentCapabilityDescriptor[]>;
  install(capabilityId: string): Promise<AgentOperationResult>;
  enable(capabilityId: string): Promise<AgentOperationResult>;
  disable(capabilityId: string): Promise<AgentOperationResult>;
  remove(capabilityId: string): Promise<AgentOperationResult>;
  rollback?(capabilityId: string): Promise<AgentOperationResult>;
  invoke?(capabilityId: string, action: string, input: unknown): Promise<unknown>;
  health(): Promise<PluginHealth>;
}

export interface AgentProviderList {
  providers: AgentProviderInfo[];
  capabilities: AgentCapabilityDescriptor[];
}

export class AgentProviderRegistry {
  private readonly providers = new Map<string, AgentProvider>();

  register(provider: AgentProvider) {
    if (!provider.id.trim()) {
      throw new PluginError('invalid_manifest', 'agent provider id must not be empty');
    }

    this.providers.set(provider.id, provider);
  }

  get(providerId: string): AgentProvider | null {
    return this.providers.get(providerId) ?? null;
  }

  async list(): Promise<AgentProviderList> {
    const providers: AgentProviderInfo[] = [];
    const capabilities: AgentCapabilityDescriptor[] = [];

    for (const provider of this.providers.values()) {
      const health = await this.safeHealth(provider);
      providers.push({
        id: provider.id,
        name: provider.name,
        health,
      });

      try {
        const items = await provider.listCapabilities();
        capabilities.push(...items.map(item => ({
          ...item,
          providerId: provider.id,
        })));
      } catch {
        // A broken provider is reported through its health only.
      }
    }

    return { providers, capabilities };
  }

  async install(providerId: string, capabilityId: string) {
    return this.require(providerId).install(capabilityId);
  }

  async enable(providerId: string, capabilityId: string) {
    return this.require(providerId).enable(capabilityId);
  }

  async disable(providerId: string, capabilityId: string) {
    return this.require(providerId).disable(capabilityId);
  }

  async remove(providerId: string, capabilityId: string) {
    return this.require(providerId).remove(capabilityId);
  }

  async rollback(providerId: string, capabilityId: string) {
    const provider = this.require(providerId);

    if (!provider.rollback) {
      throw new PluginError('plugin_failed', `provider does not support rollback: ${providerId}`, 400);
    }

    return provider.rollback(capabilityId);
  }

  async invoke(providerId: string, capabilityId: string, action: string, input: unknown) {
    const provider = this.require(providerId);

    if (!provider.invoke) {
      throw new PluginError('plugin_failed', `provider does not support invoke: ${providerId}`, 400);
    }

    return provider.invoke(capabilityId, action, input);
  }

  async health(providerId: string): Promise<PluginHealth> {
    return this.safeHealth(this.require(providerId));
  }

  private require(providerId: string): AgentProvider {
    const provider = this.providers.get(providerId);

    if (!provider) {
      throw new PluginError('not_found', `agent provider not found: ${providerId}`, 404);
    }

    return provider;
  }

  private async safeHealth(provider: AgentProvider): Promise<PluginHealth> {
    try {
      return await provider.health();
    } catch (error) {
      return {
        status: 'failed',
        message: error instanceof Error ? error.message : 'agent provider health failed',
        checkedAt: new Date().toISOString(),
      };
    }
  }
}
