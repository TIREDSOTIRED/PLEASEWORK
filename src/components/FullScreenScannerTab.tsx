import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { AlertTriangle, Banknote, Box, PlusCircle } from 'lucide-react';

// 1. Global Timestamp-Based Barcode Cache
const globalBarcodeTimestampCache: Record<string, number> = {};
export let globalCameraLock = false;

export const unlockCamera = () => {
 globalCameraLock = false;
};

interface FullScreenScannerTabProps {
 onScan: (barcode: string, mode: 'sell' | 'restock' | 'add') => Promise<'known' | 'unknown'> | void;
 lang?: 'en' | 'ar';
 /**
  * Dedicated-camera mode: hide the sell/restock/add mode selector — the
  * camera identifies and the host shows an explicit action card instead.
  * Defaults to true so existing mode-based usage is unchanged.
  */
 showModes?: boolean;
}

export default function FullScreenScannerTab({ onScan, lang = 'en', showModes = true }: FullScreenScannerTabProps) {
 const [mode, setMode] = useState<'sell' | 'restock' | 'add'>('sell');
 const modeRef = useRef(mode);
 
 const [error, setError] = useState<string | null>(null);
 const [isSecure, setIsSecure] = useState(true);
 
 const scannerRef = useRef<Html5Qrcode | null>(null);
 const isProcessingRef = useRef(false);
 const scanLockRef = useRef(false); // The absolute synchronous lock

 // Stable unique ID for the scanner container to prevent mount collisions
 const scannerRegionIdRef = useRef('html5qr-code-fullscreen-region-' + Math.random().toString(36).substring(7));
 const scannerRegionId = scannerRegionIdRef.current;
 
 // Track onScan reference dynamically to avoid dependency loops
 const onScanRef = useRef(onScan);
 useEffect(() => {
 onScanRef.current = onScan;
 modeRef.current = mode;
 }, [onScan, mode]);

 useEffect(() => {
 let isUnmounted = false;
 let isCallbackDetached = false;
 
 // Component Mount Lock: prevent instant scanning from cached frames
 globalCameraLock = true;
 scanLockRef.current = true;
 const unlockTimeout = setTimeout(() => { 
 globalCameraLock = false; 
 scanLockRef.current = false;
 }, 500);

 const secure = window.isSecureContext || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
 setIsSecure(secure);
 if (!secure) {
 setError("Camera blocked: Browser requires HTTPS or Localhost to access device hardware.");
 return;
 }

 const handleSuccessfulScan = async (decodedText: string) => {
 // 1. Concurrency & Locking: synchronous boolean `scanLock`
 // The absolute millisecond a valid QR code is decoded, hit a dead end if locked.
 if (isCallbackDetached || globalCameraLock || scanLockRef.current || isProcessingRef.current || isUnmounted) return;
 
 const now = Date.now();
 const lastScanned = globalBarcodeTimestampCache[decodedText] || 0;
 
 // Strict 2500ms cooldown for duplicate codes
 if (now - lastScanned < 2500) return; 
 
 // 2. Absolute Listener Detachment & Queue Flush
 // Update Cache & Lock immediately
 globalBarcodeTimestampCache[decodedText] = now;
 globalCameraLock = true;
 scanLockRef.current = true;
 isProcessingRef.current = true;
 
 // Detach the success callback listener so buffered frames in the event loop hit a dead end
 isCallbackDetached = true;
 
 try {
 if (scannerRef.current?.getState() === 2) { // 2 = SCANNING
 scannerRef.current.pause(true);
 }
 } catch (e) {}

 try {
 const result = await onScanRef.current(decodedText, modeRef.current);
 
 if (result === 'known') {
 // Known code: cooldown before unlocking and re-attaching
 setTimeout(() => {
 if (!isUnmounted) {
 globalCameraLock = false;
 scanLockRef.current = false;
 isProcessingRef.current = false;
 isCallbackDetached = false; // Re-attach listener
 try {
 if (scannerRef.current?.getState() === 3) { // 3 = PAUSED
 scannerRef.current.resume();
 }
 } catch (e) {}
 }
 }, 1500);
 } else {
 // Unknown code: Stay locked. The popup in the other tab will handle unlocking later.
 isProcessingRef.current = false;
 }
 } catch (err) {
 if (!isUnmounted) {
 globalCameraLock = false;
 scanLockRef.current = false;
 isProcessingRef.current = false;
 isCallbackDetached = false;
 try {
 if (scannerRef.current?.getState() === 3) {
 scannerRef.current.resume();
 }
 } catch(e) {}
 }
 }
 };

 const initProfessionalCamera = async () => {
 try {
 const html5QrCode = new Html5Qrcode(scannerRegionId);
 scannerRef.current = html5QrCode;

 await html5QrCode.start(
 { facingMode: "environment" },
 { 
 fps: 4, // Throttled to 10 FPS to prevent high CPU/GPU thermal limits
 qrbox: { width: 300, height: 300 }
 },
 (decodedText) => handleSuccessfulScan(decodedText),
 (errorMessage) => {
 // Ignore frame-by-frame scan errors quietly
 }
 );
 } catch (err: any) {
 if (!isUnmounted) {
 console.warn("Camera Init Error:", err);
 setError("Camera access blocked. Please grant permissions.");
 }
 }
 };

 initProfessionalCamera();

 // 3. Absolute Listener Detachment & Queue Flush on Unmount
 return () => {
 isUnmounted = true;
 isCallbackDetached = true;
 clearTimeout(unlockTimeout);
 
 // Explicitly wipe the frame buffer and stop the native stream
 try {
 if (scannerRef.current) {
 const state = scannerRef.current.getState();
 if (state === 2 || state === 3) { // SCANNING or PAUSED
 scannerRef.current.stop().then(() => {
 try { scannerRef.current?.clear(); } catch(e) {}
 }).catch(() => {});
 } else {
 try { scannerRef.current?.clear(); } catch(e) {}
 }
 }
 } catch (e) {}
 };
 }, [scannerRegionId]);

 const modes = [
 { id: 'sell', label: lang === 'ar' ? 'بيع' : 'Sell', icon: Banknote, color: 'bg-brand-500', activeClass: 'bg-brand-500/20 text-blue-400 border-brand-500/50' },
 { id: 'restock', label: lang === 'ar' ? 'إعادة تخزين' : 'Restock', icon: Box, color: 'bg-brand-500', activeClass: 'bg-brand-500/20 text-brand-400 border-brand-500/50' },
 { id: 'add', label: lang === 'ar' ? 'إضافة للبيانات' : 'Add to DB', icon: PlusCircle, color: 'bg-purple-500', activeClass: 'bg-purple-500/20 text-purple-400 border-purple-500/50' }
 ] as const;

 return (
 <div className="absolute inset-0 z-40 bg-black flex flex-col justify-between overflow-hidden">
 <style>{`
 @keyframes scanLaser {
 0% { top: 5%; opacity: 0; }
 10% { opacity: 1; }
 50% { opacity: 1; }
 90% { opacity: 1; }
 100% { top: 95%; opacity: 0; }
 }
 
 /* Ensure the injected video stretches nicely to fill the screen */
 #${scannerRegionId} video {
 object-fit: cover !important;
 width: 100% !important;
 height: 100% !important;
 }
 `}</style>
 
 {/* Background Camera Layer */}
 <div className="absolute inset-0 bg-black">
 {/* We keep the scanner region in the DOM ALWAYS to prevent React virtual-DOM mismatch crashes. 
 We control visibility purely via CSS opacity and pointer-events. */}
 <div 
 id={scannerRegionId} 
 className={`w-full h-full object-cover transition-opacity duration-300 ${(!isSecure || error) ? 'opacity-0 pointer-events-none' : 'opacity-100'}`} 
 />
 
 {(!isSecure || error) && (
 <div className="absolute inset-0 flex items-center justify-center p-6 bg-black/90 z-50">
 <div className="p-4 bg-red-900/50 border border-red-500/50 rounded-xl flex flex-col items-center gap-3 text-center shadow-lg shadow-red-900/20">
 <AlertTriangle className="w-10 h-10 text-red-500" />
 <h3 className="text-lg font-bold text-red-100">
 {error || "Camera access error"}
 </h3>
 </div>
 </div>
 )}
 </div>

 {/* Modern Overlay & Target Reticle */}
 <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 overflow-hidden">
 {/* The target box with a massive boxShadow creating the dark vignette mask */}
 <div className="relative w-64 h-64 sm:w-80 sm:h-80 rounded-xl shadow-[0_0_0_9999px_rgba(0,0,0,0.65)] transition-all duration-300">
 
 {/* Animated Neon Laser Bar */}
 <div 
 className="absolute left-6 right-6 h-[2px] bg-brand-400 shadow-[0_0_12px_2px_rgba(52,211,153,0.8)]"
 style={{ animation: 'scanLaser 2.5s infinite cubic-bezier(0.4, 0, 0.2, 1)' }}
 />
 
 {/* Glowing Neon Corners */}
 <div className="absolute top-0 left-0 w-12 h-12 border-t-4 border-l-4 border-brand-400 rounded-tl-3xl" style={{ filter: 'drop-shadow(0 0 8px rgba(52,211,153,0.8))' }}></div>
 <div className="absolute top-0 right-0 w-12 h-12 border-t-4 border-r-4 border-brand-400 rounded-tr-3xl" style={{ filter: 'drop-shadow(0 0 8px rgba(52,211,153,0.8))' }}></div>
 <div className="absolute bottom-0 left-0 w-12 h-12 border-b-4 border-l-4 border-brand-400 rounded-bl-3xl" style={{ filter: 'drop-shadow(0 0 8px rgba(52,211,153,0.8))' }}></div>
 <div className="absolute bottom-0 right-0 w-12 h-12 border-b-4 border-r-4 border-brand-400 rounded-br-3xl" style={{ filter: 'drop-shadow(0 0 8px rgba(52,211,153,0.8))' }}></div>
 
 {/* Center Alignment Dot */}
 <div className="absolute inset-0 flex items-center justify-center">
 <div className="w-1 h-1 bg-brand-400/80 rounded-full shadow-[0_0_8px_rgba(52,211,153,0.8)]"></div>
 </div>
 </div>
 </div>

  {/* Mode Selector Overlay (Bottom) */}
  {showModes && (
  <div className="relative z-20 mt-auto p-6 w-full flex justify-center pb-12 sm:pb-8">
  <div className="p-2 rounded-xl flex items-center gap-2 border border-white/10 shadow-lg bg-white/90 max-w-sm w-full transition-all">
  {modes.map(m => {
  const Icon = m.icon;
  const isActive = mode === m.id;
  return (
  <button
  key={m.id}
  onClick={() => setMode(m.id as any)}
  className={`flex-1 flex flex-col items-center justify-center py-3 px-2 rounded-xl transition-all duration-300 border ${isActive ? m.activeClass : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/5'}`}
  >
  <Icon className={`w-5 h-5 mb-1 ${isActive ? '' : 'opacity-70'}`} />
  <span className={`text-[10px] font-bold tracking-wide uppercase ${isActive ? '' : 'opacity-70'}`}>{m.label}</span>
  </button>
  );
  })}
  </div>
  </div>
  )}
 </div>
 );
}
