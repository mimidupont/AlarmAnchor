import React from 'react';
import './ConfirmDialog.css';

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  onConfirm,
  onCancel,
  danger = false
}) {
  // With no onCancel there is nothing to cancel: the dialog becomes a
  // single-action acknowledgement, and dismissing it by tapping the
  // backdrop is disabled so it cannot be waved away by accident. Used for
  // "the session has ended", which the watcher must actually read.
  const dismissible = typeof onCancel === 'function';

  return (
    <div className="confirm-overlay" onClick={dismissible ? onCancel : undefined}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="confirm-actions">
          {dismissible && (
            <button className="confirm-btn cancel" onClick={onCancel}>
              {cancelLabel}
            </button>
          )}
          <button
            className={`confirm-btn ${danger ? 'danger' : 'primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}