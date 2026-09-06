import { useEffect, useState, ReactNode } from 'react';

const KEY = 'eshmun_intro_';
const SHOW_LIMIT = 3;

/**
 * Progressive-disclosure intro line: shows a tab's explainer text for the
 * first few visits, then stays hidden (local preference, no cloud write).
 * Nothing is removed — clearing localStorage or a new device shows it again.
 */
export default function TabIntro({ tabKey, children }: { tabKey: string; children: ReactNode }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const k = KEY + tabKey;
      const seen = Number(localStorage.getItem(k) || '0');
      if (seen < SHOW_LIMIT) {
        setVisible(true);
        localStorage.setItem(k, String(seen + 1));
      }
    } catch {
      setVisible(true);
    }
  }, [tabKey]);

  if (!visible) return null;
  return <p className="text-xs text-slate-500 font-medium mt-0.5">{children}</p>;
}
