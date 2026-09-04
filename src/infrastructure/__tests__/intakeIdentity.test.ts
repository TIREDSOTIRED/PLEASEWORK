import { describe, it, expect, vi } from 'vitest';
import {
  resolveIntakeTarget,
  buildRestockUpdate,
  intakeBarcodeCandidates,
  isUnstableCatalogId,
  deterministicManualId,
  IntakeInventoryDoc,
  IntakeLookup
} from '../intake/intakeIdentity';

/**
 * Regression suite for Intake Identity Fragmentation.
 *
 * Original failure: restocking an existing medicine through catalog search
 * minted a SECOND storage_inventory document for the same barcode, because
 * the intake write path only probed the doc id computed from the incoming
 * catalog item and never resolved against existing inventory by barcode.
 */

function makeLookup(docs: IntakeInventoryDoc[]): IntakeLookup & {
  docIdProbes: string[];
  barcodeProbes: string[];
} {
  const docIdProbes: string[] = [];
  const barcodeProbes: string[] = [];
  return {
    docIdProbes,
    barcodeProbes,
    async getByDocId(safeId: string) {
      docIdProbes.push(safeId);
      return docs.find(d => d.id === safeId) || null;
    },
    async getByBarcode(bc: string) {
      barcodeProbes.push(bc);
      return docs.filter(d => d.data.barcode === bc);
    }
  };
}

describe('intake identity — the original duplicate-creation failure', () => {
  it('restock via catalog search (different id regime, same barcode) resolves to the EXISTING inventory document', async () => {
    // Existing card created under the publish-time code slug.
    const existing: IntakeInventoryDoc = {
      id: 'atorvastatin10mg_ctab',
      data: { catalogId: 'atorvastatin10mg/ctab', name: 'ورفاستاتين 10', barcode: '123456', stock: 40 }
    };
    const lookup = makeLookup([existing]);

    // Catalog search item for the same product: sako id regime.
    const resolution = await resolveIntakeTarget({
      catalogId: '98765',
      id: '98765',
      barcode: '123456',
      name: 'ورفاستاتين 10',
      lookup
    });

    expect(resolution.matchedBy).toBe('barcode');
    expect(resolution.safeMedId).toBe('atorvastatin10mg_ctab');
    expect(resolution.catalogId).toBe('atorvastatin10mg/ctab');
    expect(resolution.existing?.data.stock).toBe(40);
  });

  it('doc-id hit is authoritative and short-circuits (no barcode query)', async () => {
    const existing: IntakeInventoryDoc = {
      id: 'atorvastatin10mg_ctab',
      data: { catalogId: 'atorvastatin10mg/ctab', barcode: '123456', stock: 40 }
    };
    const lookup = makeLookup([existing]);

    const resolution = await resolveIntakeTarget({
      catalogId: 'atorvastatin10mg/ctab',
      barcode: '123456',
      name: 'ورفاستاتين 10',
      lookup
    });

    expect(resolution.matchedBy).toBe('docId');
    expect(resolution.safeMedId).toBe('atorvastatin10mg_ctab');
    expect(lookup.barcodeProbes).toHaveLength(0);
  });

  it('manual intake and catalog intake converge on the same existing record for the same barcode', async () => {
    const existing: IntakeInventoryDoc = {
      id: 'custom_bc_555000',
      data: { catalogId: '', name: 'Manual Med', barcode: '555000', stock: 3 }
    };
    const manual = await resolveIntakeTarget({
      catalogId: undefined,
      barcode: '555000',
      name: 'Manual Med',
      lookup: makeLookup([existing])
    });
    const catalog = await resolveIntakeTarget({
      catalogId: '98765',
      barcode: '555000',
      name: 'Manual Med',
      lookup: makeLookup([existing])
    });
    expect(manual.safeMedId).toBe('custom_bc_555000');
    expect(catalog.safeMedId).toBe('custom_bc_555000');
  });
});

describe('intake identity — restock merge semantics', () => {
  it('stock is summed on the original record and existing identity fields are preserved', () => {
    const existing = {
      id: 'atorvastatin10mg_ctab',
      catalogId: 'atorvastatin10mg/ctab',
      name: 'ورفاستاتين 10',
      barcode: '123456',
      stock: 150,
      price: 9000
    };
    const incoming = {
      id: '98765',
      catalogId: '98765',
      name: 'ورفاستاتين 10',
      barcode: '123456',
      stock: 10,
      price: 9500,
      lastUpdated: 'old'
    };
    const merged = buildRestockUpdate(existing, incoming, 10, '2026-09-04T00:00:00Z');

    expect(merged.id).toBe('atorvastatin10mg_ctab');
    expect(merged.catalogId).toBe('atorvastatin10mg/ctab');
    expect(merged.stock).toBe(160);
    expect(merged.price).toBe(9500); // catalog enrichment rides along
    expect(merged.lastUpdated).toBe('2026-09-04T00:00:00Z');
  });
});

describe('intake identity — deterministic creation ids', () => {
  it('a genuinely new barcode creates with a deterministic custom_bc_ id', async () => {
    const lookup = makeLookup([]);
    const a = await resolveIntakeTarget({ barcode: '999777', name: 'New Med', lookup });
    const b = await resolveIntakeTarget({ barcode: '999777', name: 'New Med', lookup });
    expect(a.matchedBy).toBe('none');
    expect(a.safeMedId).toBe('custom_bc_999777');
    expect(b.safeMedId).toBe(a.safeMedId); // refresh/re-intake determinism
  });

  it('stable catalog id is used for creation when no barcode exists', async () => {
    const resolution = await resolveIntakeTarget({
      catalogId: 'atorvastatin10mg/ctab',
      barcode: '',
      name: 'ورفاستاتين',
      lookup: makeLookup([])
    });
    expect(resolution.safeMedId).toBe('atorvastatin10mg_ctab');
  });

  it('name_index catalog ids are rejected as unstable on create (explicit deterministic path instead)', async () => {
    const resolution = await resolveIntakeTarget({
      catalogId: 'Warfarin_12',
      barcode: '',
      name: 'Warfarin',
      lookup: makeLookup([])
    });
    expect(resolution.unstableCatalogIdRejected).toBe(true);
    expect(resolution.safeMedId).toBe('custom_nm_warfarin');
    expect(isUnstableCatalogId('Warfarin_12')).toBe(true);
    expect(isUnstableCatalogId('med-1730000000000')).toBe(true);
    expect(isUnstableCatalogId('98765')).toBe(false); // sako stays stable
    expect(isUnstableCatalogId('atorvastatin10mg/ctab')).toBe(false);
  });

  it('synthetic BAR-<timestamp> barcodes never mint identity', async () => {
    const lookup = makeLookup([]);
    const resolution = await resolveIntakeTarget({
      barcode: 'BAR-1730000000000',
      name: 'No Barcode Med',
      lookup
    });
    expect(lookup.barcodeProbes).toHaveLength(0);
    expect(resolution.safeMedId).toBe('custom_nm_no barcode med');
  });
});

describe('intake identity — barcode canonicalization', () => {
  it('malformed barcodes normalize to a match (quotes, zero-width, trailing comma, spaces)', async () => {
    const existing: IntakeInventoryDoc = {
      id: 'custom_bc_00598910001',
      data: { barcode: '00598910001', stock: 7 }
    };
    const resolution = await resolveIntakeTarget({
      barcode: ' "00\u200B598910001", ',
      name: 'x',
      lookup: makeLookup([existing])
    });
    expect(resolution.safeMedId).toBe('custom_bc_00598910001');
  });

  it('leading zeroes are preserved', () => {
    expect(intakeBarcodeCandidates('0012345')).toEqual(['0012345']);
  });

  it('multi-code source strings split into candidates', async () => {
    const existing: IntakeInventoryDoc = {
      id: 'doc_b',
      data: { barcode: '222', stock: 1 }
    };
    const resolution = await resolveIntakeTarget({
      barcode: '111,222',
      name: 'x',
      lookup: makeLookup([existing])
    });
    expect(resolution.safeMedId).toBe('doc_b');
    expect(intakeBarcodeCandidates('111, 222; 333 ')).toEqual(['111', '222', '333']);
  });
});

describe('intake identity — fragmentation visibility and deterministic pick', () => {
  it('when several docs share a barcode the pick is deterministic and matches are reported', async () => {
    const docs: IntakeInventoryDoc[] = [
      { id: 'zzz_doc', data: { barcode: '42', stock: 1 } },
      { id: 'aaa_doc', data: { barcode: '42', stock: 2 } }
    ];
    const resolution = await resolveIntakeTarget({ barcode: '42', name: 'x', lookup: makeLookup(docs) });
    expect(resolution.safeMedId).toBe('aaa_doc'); // lowest doc id — stable
    expect(resolution.barcodeMatches?.map(d => d.id).sort()).toEqual(['aaa_doc', 'zzz_doc']);
  });

  it('prefers the doc whose id matches the incoming catalog id when barcode matches are ambiguous', async () => {
    const docs: IntakeInventoryDoc[] = [
      { id: 'aaa_doc', data: { barcode: '42', stock: 1 } },
      { id: 'med_42', data: { barcode: '42', stock: 2, catalogId: 'med_42' } }
    ];
    const resolution = await resolveIntakeTarget({
      catalogId: 'med_42',
      barcode: '42',
      name: 'x',
      lookup: makeLookup(docs)
    });
    expect(resolution.safeMedId).toBe('med_42');
  });
});

describe('intake identity — repeated intake does not duplicate (refresh safety)', () => {
  it('the same resolution result is produced for repeated intakes of the same product', async () => {
    const existing: IntakeInventoryDoc = {
      id: 'atorvastatin10mg_ctab',
      data: { catalogId: 'atorvastatin10mg/ctab', barcode: '123456', stock: 40 }
    };
    const intake = () => resolveIntakeTarget({
      catalogId: '98765',
      barcode: '123456',
      name: 'ورفاستاتين 10',
      lookup: makeLookup([existing])
    });
    const [r1, r2, r3] = await Promise.all([intake(), intake(), intake()]);
    expect(new Set([r1.safeMedId, r2.safeMedId, r3.safeMedId]).size).toBe(1);
    expect(r1.safeMedId).toBe('atorvastatin10mg_ctab');
  });
});

describe('intake identity — deterministic manual id builder', () => {
  it('sanitizes slashes and normalizes case, matching the StockIntakeModal scheme', () => {
    expect(deterministicManualId('bc', '123/456')).toBe('custom_bc_123_456');
    expect(deterministicManualId('nm', '  My Med ')).toBe('custom_nm_my med');
    expect(deterministicManualId('nm', '')).toBe('custom_nm_unnamed');
  });
});
