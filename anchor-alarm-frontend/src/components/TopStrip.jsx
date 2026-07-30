import React, { useEffect, useRef, useState } from 'react';
import './Chrome.css';

/**
 * Compact top strip shared by the main map view and the remote monitor:
 * back chevron, tap-to-copy session ID chip, and an optional right-side
 * element (the status pill).
 */
export default function TopStrip({ onBack, sessionId, right }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sessionId);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.warn('Clipboard copy failed:', err);
    }
  };

  return (
    <div className="top-strip">
      <button onClick={onBack} className="back-btn" aria-label="Back">
        ‹
      </button>
      <button className="session-chip" onClick={handleCopy}>
        {copied ? 'Copied' : sessionId}
      </button>
      {right}
    </div>
  );
}
