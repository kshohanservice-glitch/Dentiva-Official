import { buildRegistry, type ApiSpec, type Registry } from '../registry';
import { systemApi } from './system';
import { patientsApi } from './patients';
import { clinicalApi } from './clinical';
import { schedulingApi } from './scheduling';
import { financialApi } from './financial';
import { inventoryApi } from './inventory';
import { adminApi } from './admin';
import { platformApi } from './platform';

export const api: ApiSpec = {
  ...systemApi,
  ...patientsApi,
  ...clinicalApi,
  ...schedulingApi,
  ...financialApi,
  ...inventoryApi,
  ...adminApi,
  ...platformApi,
};

let registry: Registry | null = null;

export function getRegistry(): Registry {
  if (!registry) registry = buildRegistry(api);
  return registry;
}

export function operationCatalogue(): {
  name: string;
  permissions: string[];
  public: boolean;
  guarded: boolean;
  label: string;
}[] {
  return [...getRegistry().values()].map((op) => ({
    name: op.name,
    permissions: [...op.perms, ...op.permsAny],
    public: Boolean(op.public),
    // Payload-dependent guards are enforced by the registry like any other
    // permission, so they count as an access rule for documentation and tests.
    guarded: typeof op.guard === 'function',
    label: op.label,
  }));
}
