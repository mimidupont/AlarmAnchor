import React, { useEffect, useState } from 'react';
import { useT } from '../i18n';
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
export default function StatusPill({ mode, connected, boatLocation, gpsError, armed, boatOffline }) {
  const t = useT();
  const [sheetOpen, setSheetOpen] = useState(false);
  // Re-evaluate staleness every 5s even without new data.
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
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
      label = t('pillOffline');
    } else if (boatOffline) {
      // The server told us the boat phone's socket dropped. Said at once,
      // rather than waiting for the fix to age out: our own connection is
      // fine, so "no data" would read as our problem instead of the boat's.
      state = 'danger';
      label = t('pillBoatOffline');
    } else if (gpsDead) {
      state = 'danger';
      label = t('pillNoData');
    } else if (gpsWeak) {
      state = 'warn';
      label = t('pillDataStale');
    } else if (armed) {
      state = 'ok';
      label = t('pillWatching');
    } else {
      state = 'neutral';
      label = t('pillNotArmed');
    }
  } else {
    if (gpsDead) {
      state = 'danger';
      label = t('pillNoGps');
    } else if (gpsWeak) {
      state = 'warn';
      label = t('pillGpsWeak');
    } else if (!connected) {
      state = 'warn';
      label = t('pillOfflineLocal');
    } else if (armed) {
      state = 'ok';
      label = t('pillMonitoring');
    } else {
      state = 'neutral';
      label = t('pillNotArmed');
    }
  }

  const gpsDetail = () => {
    if (gpsError) return t('sheetError', { msg: gpsError });
    if (fixAge === null) return t('sheetNoFix');
    const age = Math.max(0, Math.round(fixAge / 1000));
    const acc = accuracy != null ? ` · ±${Math.round(accuracy)} m` : '';
    return `${t('sheetFixAgo', { s: age })}${acc}`;
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
                {mode === 'remote' ? t('sheetBoatData') : t('gpsLabel')}
              </span>
              <span className="status-sheet-detail">{gpsDetail()}</span>
            </div>
            <div className="status-sheet-row">
              {dot(connected, false)}
              <span className="status-sheet-name">{t('sheetServer')}</span>
              <span className="status-sheet-detail">
                {connected ? t('sheetConnected') : t('sheetDisconnected')}
              </span>
            </div>
            <div className="status-sheet-row">
              {dot(armed, false)}
              <span className="status-sheet-name">{t('zoneLabel')}</span>
              <span className="status-sheet-detail">{armed ? t('sheetArmed') : t('sheetNotArmed')}</span>
            </div>
            <button className="status-sheet-close" onClick={() => setSheetOpen(false)}>
              {t('close')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
