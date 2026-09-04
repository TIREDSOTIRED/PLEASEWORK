import React from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';

export interface ShippingManifestItem {
 id: string;
 name: string;
 genericName?: string;
 allocatedBatch: string;
 expiryDate: string;
 quantity: number;
 unitPrice: number;
 totalPrice: number;
}

export interface ShippingManifestData {
 orderId: string;
 dispatchDate: string;
 warehouseName: string;
 warehouseLicense: string;
 warehouseAddress?: string;
 warehousePhone?: string;
 buyerName: string;
 buyerLicense?: string;
 buyerAddress?: string;
 contactPerson?: string;
 items: ShippingManifestItem[];
 totalQuantity: number;
 totalValue: number;
 dispatchToken?: string;
 /** When the warehouse commits to deliver (ISO). Set at dispatch time. */
 expectedDeliveryAt?: string;
 /** End of the promised delivery window (ISO). */
 deliveryWindowEnd?: string;
}

interface ShippingManifestProps {
 data: ShippingManifestData;
}

export default function ShippingManifest({ data }: ShippingManifestProps) {
 const qrPayload = JSON.stringify({
 type: 'B2B_MANIFEST_AUTO_ACCEPT',
 orderId: data.orderId,
 token: data.dispatchToken || `TOK-${data.orderId}`,
 itemsCount: data.items.length,
 timestamp: data.dispatchDate
 });

 const manifestContent = (
 <div
 id="printable-manifest"
 className="bg-white text-black p-6 font-sans max-w-4xl mx-auto border border-slate-200 print:border-none print:p-4 text-xs leading-normal"
 >
 {/* Header */}
 <div className="flex justify-between items-start border-b-2 border-black pb-4 mb-4">
 <div>
 <h1 className="text-xl font-bold tracking-tight uppercase">{data.warehouseName}</h1>
 <p className="text-[11px] font-mono text-slate-700">License #: {data.warehouseLicense}</p>
 {data.warehouseAddress && <p className="text-[10px] text-slate-600">{data.warehouseAddress}</p>}
 {data.warehousePhone && <p className="text-[10px] text-slate-600">Tel: {data.warehousePhone}</p>}
 </div>
 <div className="text-right">
 <div className="inline-block bg-black text-white font-mono font-bold px-3 py-1 text-sm uppercase rounded print:border print:border-black print:bg-white print:text-black">
 B2B Shipping Manifest
 </div>
 <p className="text-[11px] font-mono font-bold mt-2">Order ID: {data.orderId}</p>
 <p className="text-[10px] text-slate-600">Dispatch: {new Date(data.dispatchDate).toLocaleString()}</p>
 </div>
 </div>

 {/* Destination & Recipient Info */}
 <div className="grid grid-cols-2 gap-4 border border-black p-3 mb-4 rounded-sm">
 <div>
 <span className="font-bold text-[10px] uppercase text-slate-500 block mb-1">Destination Pharmacy</span>
 <p className="font-bold text-sm uppercase">{data.buyerName}</p>
 <p className="text-[11px]">{data.buyerAddress || 'Licensed Local Pharmacy Branch'}</p>
 {data.buyerLicense && <p className="text-[10px] font-mono mt-0.5">License: {data.buyerLicense}</p>}
 </div>
 <div className="border-l border-slate-300 pl-4">
 <span className="font-bold text-[10px] uppercase text-slate-500 block mb-1">Delivery Details</span>
 <p className="text-[11px]"><span className="font-semibold">Contact:</span> {data.contactPerson || 'Pharmacist-in-Charge'}</p>
 <p className="text-[11px]"><span className="font-semibold">Chain of Custody:</span> FEFO Verified & Cold-Chain Secured</p>
 <p className="text-[10px] font-mono mt-0.5"><span className="font-semibold">Dispatch Token:</span> {data.dispatchToken || `TOK-${data.orderId}`}</p>
 </div>
 </div>

 {/* Itemized Manifest Table */}
 <table className="w-full text-left border-collapse border border-black mb-4">
 <thead>
 <tr className="bg-slate-100 print:bg-slate-200 border-b border-black text-[10px] font-mono font-bold uppercase">
 <th className="p-2 border-r border-black">#</th>
 <th className="p-2 border-r border-black">Item & Active Ingredient</th>
 <th className="p-2 border-r border-black">Allocated Batch</th>
 <th className="p-2 border-r border-black">Expiry</th>
 <th className="p-2 border-r border-black text-right">Qty</th>
 <th className="p-2 border-r border-black text-right">Unit Price</th>
 <th className="p-2 text-right">Subtotal</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-slate-300 border-b border-black text-[11px]">
 {data.items.map((item, idx) => (
 <tr key={item.id || idx} className="hover:bg-slate-50">
 <td className="p-2 border-r border-slate-300 font-mono text-[10px]">{idx + 1}</td>
 <td className="p-2 border-r border-slate-300">
 <div className="font-bold">{item.name}</div>
 {item.genericName && (
 <div className="text-[9px] font-mono text-slate-600 uppercase">{item.genericName}</div>
 )}
 </td>
 <td className="p-2 border-r border-slate-300 font-mono font-bold">{item.allocatedBatch}</td>
 <td className="p-2 border-r border-slate-300 font-mono text-[10px]">{String(item.expiryDate).split('T')[0]}</td>
 <td className="p-2 border-r border-slate-300 font-mono text-right font-bold">{item.quantity}</td>
 <td className="p-2 border-r border-slate-300 font-mono text-right">{item.unitPrice.toLocaleString('en-US')} SYP</td>
 <td className="p-2 font-mono text-right font-bold">{item.totalPrice.toLocaleString('en-US')} SYP</td>
 </tr>
 ))}
 </tbody>
 <tfoot>
 <tr className="bg-slate-100 print:bg-slate-200 font-bold border-t border-black text-[11px]">
 <td colSpan={4} className="p-2 text-right uppercase border-r border-black">Total Dispatched</td>
 <td className="p-2 text-right font-mono border-r border-black">{data.totalQuantity} Units</td>
 <td className="p-2 text-right uppercase border-r border-black">Order Value</td>
 <td className="p-2 text-right font-mono text-sm">{data.totalValue.toLocaleString('en-US')} SYP</td>
 </tr>
 </tfoot>
 </table>

 {/* Security & Delivery Verification Footer */}
 <div className="grid grid-cols-3 gap-4 border border-black p-4 mb-4 items-center rounded-sm">
 <div className="col-span-1 flex flex-col items-center justify-center text-center">
 <QRCodeSVG value={qrPayload} size={90} level="M" />
 <span className="text-[9px] font-mono font-bold mt-1 uppercase tracking-wider">Scan to Auto-Accept Stock</span>
 </div>
 <div className="col-span-2 text-[10px] space-y-1 pl-2">
 <p className="font-bold uppercase text-slate-800">Pharmacy Verification Instructions:</p>
 <p className="text-slate-600">
 Scan the QR Code above using your local POS system to instantly reconcile and auto-ingest these allocated batches into your local inventory.
 </p>
 <p className="text-slate-500 italic">
 All pharmaceutical shipments are sealed in compliance with GSP (Good Storage Practice) guidelines.
 </p>
 </div>
 </div>

 {/* Signatures */}
 <div className="grid grid-cols-2 gap-8 border-t-2 border-black pt-4 mt-6">
 <div>
 <p className="font-bold text-[10px] uppercase text-slate-500 mb-8">Dispatch Driver / Logistics Signature</p>
 <div className="border-b border-black w-full mb-1"></div>
 <div className="flex justify-between text-[9px] text-slate-600 font-mono">
 <span>Name: ____________________</span>
 <span>Date: ____________</span>
 </div>
 </div>
 <div>
 <p className="font-bold text-[10px] uppercase text-slate-500 mb-8">Receiving Pharmacist Signature & Stamp</p>
 <div className="border-b border-black w-full mb-1"></div>
 <div className="flex justify-between text-[9px] text-slate-600 font-mono">
 <span>License #: _________________</span>
 <span>Date: ____________</span>
 </div>
 </div>
 </div>
 </div>
 );

 return createPortal(manifestContent, document.body);
}
