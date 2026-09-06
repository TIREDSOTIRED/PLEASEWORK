import { describe, it, expect } from 'vitest';
import { dedupeCatalogSuggestions } from '../catalog/dedupeSuggestions';

describe('dedupeCatalogSuggestions (P2 #10 — duplicate catalog entries)', () => {
  it('collapses entries that share the same barcode', () => {
    const out = dedupeCatalogSuggestions([
      { id: 'a', name: 'ATORVATIN-10', barcode: '6210511011844', price: 90 },
      { id: 'b', name: 'ATORVATIN-10', barcode: '6210511011844', price: 130 }
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].price).toBe(90); // first occurrence wins (catalog order)
  });

  it('collapses same trade name + composition even with different doc ids', () => {
    const out = dedupeCatalogSuggestions([
      { id: 'x1', name: 'PANADOL', composition: 'paracetamol 500mg' },
      { id: 'x2', name: 'Panadol ', composition_key: 'Paracetamol 500mg ' },
      { id: 'x3', name: 'PANADOL EXTRA', composition: 'paracetamol 500mg' }
    ]);
    expect(out.map(o => o.id)).toEqual(['x1', 'x3']);
  });

  it('NEVER merges distinct medicines (different composition)', () => {
    const out = dedupeCatalogSuggestions([
      { id: '1', name: 'ATORVATIN-10', composition: 'atorvastatin 10mg' },
      { id: '2', name: 'ATORVATIN-20', composition: 'atorvastatin 20mg' }
    ]);
    expect(out).toHaveLength(2);
  });

  it('NEVER merges same-name products with different barcodes', () => {
    const out = dedupeCatalogSuggestions([
      { id: '1', name: 'AMBILOX', barcode: '111' },
      { id: '2', name: 'AMBILOX', barcode: '222' }
    ]);
    expect(out).toHaveLength(2);
  });

  it('keeps entries without identity keys', () => {
    const out = dedupeCatalogSuggestions([{ id: 'a' }, { id: 'b' }]);
    expect(out).toHaveLength(2);
  });
});
