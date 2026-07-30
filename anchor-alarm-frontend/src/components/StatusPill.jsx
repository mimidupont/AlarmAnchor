import React, { useEffect, useState } from 'react';
import './Chrome.css';

const STALE_MS = 30 * 1000;
const DEAD_MS = 90 * 1000;
const WEAK_ACCURACY_M = 25;

/**
 * Live monitoring-health pill for the top strip. Worst condition wins:
 *
 * main view (the boat phone):
 *   danger "No GPS"            — no fix yet, fix older than 90s, or a
 *                                permission/watcher error
 *   warn   "GPS weak"          — accuracy > 25 m, or fix 30–90s old
 *   warn   "Offline — local only" — server unreachable; the on-device
 *          zone check (handleGpsFix in App.jsx) keeps the alarm armed,
 *          so this is degraded (remote monitors blind), not unprotected.
 *          If that local check is ever removed, this state MUST go back
 *          to danger wording ("alarm not monitored").
 *   ok     "Monitoring"        — armed, GPS good, server connected
 *   neutral "Not armed"        — no confirmed zone yet
 *
 * remote view: the "GPS" signal is the age of the last boat position
 * received; a dead socket means truly blind, so offline is danger here.
 *
 * Tapping the pill opens a sheet listing each subsystem with a status dot.
 */
export default function StatusPill({ mode, connected, boatLocation, gpsError, armed }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  // Re-evaluate staleness every 5s even without new data.
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const fixAt = boatLocation ? Date.parse(boatLocation.timestamp) : null;
  const fixAge = fixAt != null && !Number.isNaN(fixAt) ? now - fixAt : null;
  const accuracy = boatLocation?.accuracy;

  const gpsDead = gpsError != null || fixAge === null || fixAge > DEAD_MS;
  const gpsWeak = !gpsDead && ((accuracy != null && accuracy > WEAK_ACCURACY_M) || fixAge > STALE_MS);

  let state;
  let label;
  if (mode === 'remote') {
    if (!connected) {
      state = 'danger';
      label = 'Offline';
    } else if (gpsDead) {
      state = 'danger';
      label = 'No data';
    } else if (gpsWeak) {
      state = 'warn';
      label = 'Data stale';
    } else if (armed) {
      state = 'ok';
      label = 'Watching';
    } else {
      state = 'neutral';
      label = 'Not armed';
    }
  } else {
    if (gpsDead) {
      state = 'danger';
      label = 'No GPS';
    } else if (gpsWeak) {
      state = 'warn';
      label = 'GPS weak';
    } else if (!connected) {
      state = 'warn';
      label = 'Offline — local only';
    } else if (armed) {
      state = 'ok';
      label = 'Monitoring';
    } else {
      state = 'neutral';
      label = 'Not armed';
    }
  }

  const gpsDetail = () => {
    if (gpsError) return `Error: ${gpsError}`;
    if (fixAge === null) return 'No fix yet';
    const age = Math.max(0, Math.round(fixAge / 1000));
    const acc = accuracy != null ? ` · ±${Math.round(accuracy)} m` : '';
    return `Fix ${age}s ago${acc}`;
  };

  const dot = (ok, warn) => (
    <span className={`sheet-dot sheet-dot-${ok ? 'ok' : warn ? 'warn' : 'danger'}`} />
  );

  return (
    <>
      <button className={`status-pill status-pill-${state}`} onClick={() => setSheetOpen(true)}>
        {label}
      </button>

      {sheetOpen && (
        <div className="status-sheet-overlay" onClick={() => setSheetOpen(false)}>
          <div className="status-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="status-sheet-row">
              {dot(!gpsDead && !gpsWeak, gpsWeak)}
              <span className="status-sheet-name">
                {mode === 'remote' ? 'Boat data' : 'GPS'}
              </span>
              <span className="status-sheet-detail">{gpsDetail()}</span>
            </div>
            <div className="status-sheet-row">
              {dot(connected, false)}
              <span className="status-sheet-name">Server</span>
              <span className="status-sheet-detail">
                {connected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <div className="status-sheet-row">
              {dot(armed, false)}
              <span className="status-sheet-name">Zone</span>
              <span className="status-sheet-detail">{armed ? 'Armed' : 'Not armed'}</span>
            </div>
            <button className="status-sheet-close" onClick={() => setSheetOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
