import { describe, it, expect } from 'vitest';
import { computeCustomerBalances, UNNAMED_CUSTOMER } from '../finance/customerCredit';

describe('computeCustomerBalances (P1 #3/#4 — credit sales + append-only settlements)', () => {
  it('ignores cash sales in receivables', () => {
    const rows = [
      { saleId: 'S1', status: 'Paid', totalRevenue: 500, customerName: 'Omar' },
      { saleId: 'S2', status: 'Paid', totalRevenue: 300 }
    ];
    expect(computeCustomerBalances(rows as any)).toEqual([]);
  });

  it('groups credit sales per customer; unnamed credit lands in the unnamed bucket', () => {
    const rows = [
      { saleId: 'S1', status: 'Pending', totalRevenue: 500, customerName: 'Omar' },
      { saleId: 'S2', status: 'Pending', totalRevenue: 250, customerName: 'Omar' },
      { saleId: 'S3', status: 'Pending', totalRevenue: 100 }
    ];
    const balances = computeCustomerBalances(rows as any);
    expect(balances).toHaveLength(2);
    const omar = balances.find(b => b.customerName === 'Omar');
    expect(omar?.billedTotal).toBe(750);
    expect(omar?.outstanding).toBe(750);
    expect(omar?.openSaleIds).toEqual(['S1', 'S2']);
    const unnamed = balances.find(b => b.customerName === UNNAMED_CUSTOMER);
    expect(unnamed?.outstanding).toBe(100);
  });

  it('applies partial settlements without mutating sales (append-only math)', () => {
    const rows = [
      { saleId: 'S1', status: 'Pending', totalRevenue: 500, customerName: 'Omar' },
      { type: 'CREDIT_SETTLEMENT', customerName: 'Omar', amountPaid: 200, status: 'Paid' }
    ];
    const balances = computeCustomerBalances(rows as any);
    const omar = balances.find(b => b.customerName === 'Omar');
    expect(omar?.billedTotal).toBe(500);
    expect(omar?.settledTotal).toBe(200);
    expect(omar?.outstanding).toBe(300);
  });

  it('fully settled customers drop to zero outstanding', () => {
    const rows = [
      { saleId: 'S1', status: 'Pending', totalRevenue: 400, customerName: 'Sara' },
      { type: 'CREDIT_SETTLEMENT', customerName: 'Sara', amountPaid: 150, status: 'Paid' },
      { type: 'CREDIT_SETTLEMENT', customerName: 'Sara', amountPaid: 250, status: 'Paid' }
    ];
    const balances = computeCustomerBalances(rows as any);
    const sara = balances.find(b => b.customerName === 'Sara');
    expect(sara?.outstanding).toBe(0);
  });

  it('clamps at zero if settlements somehow exceed billed amounts', () => {
    const rows = [
      { saleId: 'S1', status: 'Pending', totalRevenue: 100, customerName: 'Ziad' },
      { type: 'CREDIT_SETTLEMENT', customerName: 'Ziad', amountPaid: 150, status: 'Paid' }
    ];
    const balances = computeCustomerBalances(rows as any);
    expect(balances.find(b => b.customerName === 'Ziad')?.outstanding).toBe(0);
  });
});
