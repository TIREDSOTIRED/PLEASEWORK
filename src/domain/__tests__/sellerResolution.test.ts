import { describe, it, expect } from 'vitest';
import { resolveOfferSeller, isResolvableSellerId } from '../b2b/sellerResolution';

describe('sellerResolution (P0 #1 — B2B seller routing)', () => {
  const liveTenant = {
    id: 'tenant_smezgy_123',
    name: 'SMEGZY',
    tenantType: 'WHOLESALE_WAREHOUSE',
    verifiedLocation: 'Latakia'
  };

  it('flags well-known ghost seller ids as unresolvable', () => {
    expect(isResolvableSellerId('wh_default')).toBe(false);
    expect(isResolvableSellerId('default-warehouse')).toBe(false);
    expect(isResolvableSellerId('dev_warehouse_id')).toBe(false);
    expect(isResolvableSellerId('')).toBe(false);
    expect(isResolvableSellerId(null)).toBe(false);
    expect(isResolvableSellerId(undefined)).toBe(false);
    expect(isResolvableSellerId('tenant_smezgy_123')).toBe(true);
  });

  it('rejects offers with no seller id (legacy) — missing-id', () => {
    const res = resolveOfferSeller({ sellerTenantId: '', sellerName: 'TRYWHERE' }, liveTenant);
    expect(res).toMatchObject({ ok: false, reason: 'missing-id' });
  });

  it('rejects offers pointing at ghost placeholders — ghost-id', () => {
    const res = resolveOfferSeller({ sellerTenantId: 'wh_default', sellerName: 'TRYWHERE' }, null);
    expect(res).toMatchObject({ ok: false, reason: 'ghost-id' });
  });

  it('rejects orders when the referenced tenant no longer exists — tenant-not-found', () => {
    const res = resolveOfferSeller({ sellerTenantId: 'tenant_deleted_999', sellerName: 'Old Name' }, null);
    expect(res).toMatchObject({ ok: false, reason: 'tenant-not-found' });
  });

  it('resolves a valid seller with LIVE tenant data winning over stale denormals', () => {
    const res = resolveOfferSeller(
      { sellerTenantId: 'tenant_smezgy_123', sellerName: 'TRYWHERE (stale name)' },
      liveTenant
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.sellerTenantId).toBe('tenant_smezgy_123');
      expect(res.sellerName).toBe('SMEGZY'); // live name, not the stale offer name
      expect(res.sellerType).toBe('WHOLESALE_WAREHOUSE');
      expect(res.sellerCity).toBe('Latakia');
    }
  });

  it('falls back to the offer display name only when the tenant has none', () => {
    const res = resolveOfferSeller(
      { sellerTenantId: 'tenant_smezgy_123', sellerName: 'Offer Name' },
      { id: 'tenant_smezgy_123', tenantType: 'WHOLESALE_WAREHOUSE' }
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.sellerName).toBe('Offer Name');
  });
});
