// All user-facing strings, en + fr. Plain object lookup — no i18n
// library. Placeholders use {name} and are substituted by t(key, vars).

export const strings = {
  en: {
    // Session screen
    appTitle: '⚓ Anchor Alarm',
    startMonitoring: '⚓ Start monitoring',
    startMonitoringNote: 'This phone stays on the boat',
    createSession: 'Create a session',
    creating: 'Creating…',
    watchRemotely: '👀 Watch remotely',
    watchRemotelyNote: 'Join a session running on the boat',
    createInAppNote: 'To start a session, use the Anchor Alarm app on the boat phone.',
    sessionIdPlaceholder: 'Session ID',
    join: 'Join',
    scanQr: 'Scan QR',
    invalidSessionId: 'Please enter a valid session ID',
    sessionCreated: 'Session created',
    copied: 'Copied',
    shareHint: 'Scan from another phone to watch remotely — or share the ID.',
    openMap: 'Open the map',
    scanHint: 'Point the camera at the session QR code',
    cancel: 'Cancel',

    // Top strip / instrument panel
    back: 'Back',
    distanceToAnchor: 'Distance to anchor',
    zoneLabel: 'Zone',
    gpsLabel: 'GPS',
    waitingGps: 'Waiting for GPS signal…',
    waitingBoat: 'Waiting for boat position…',
    updatedAt: 'Updated {time}',

    // Anchor flow
    dropAnchor: '⚓ Drop anchor',
    armAlarm: 'Arm alarm',
    radiusHint: 'Slide, or drag the green handle on the map',
    adjustZone: 'Adjust zone',
    raiseAnchor: 'Raise anchor',
    raiseAnchorTitle: 'Raise anchor?',
    raiseAnchorMessage: 'This clears the anchor position and disarms the alarm.',
    keepWatching: 'Keep watching',

    // Leave-session dialog
    leaveTitle: 'Leave the session?',
    leaveMessage: 'If you leave now, the anchor position and zone will be lost.',
    sessionEndedTitle: 'Session ended — monitoring finished',
    sessionEndedMessage:
      'The boat phone has closed this session. The boat is no longer being monitored and this screen will stop updating.',
    sessionEndedAck: 'Understood',
    monitoringStoppedTitle: 'Monitoring stopped',
    monitoringStoppedMessage:
      'The boat phone is no longer reporting. The boat is not being watched. It may have been closed, lost signal, or run out of battery — if it reconnects, monitoring resumes on its own.',
    monitoringStoppedAck: 'Understood',
    leave: 'Leave',
    stay: 'Stay',

    // Map popups
    boatPosition: '📍 Boat position',
    accuracyMeters: 'Accuracy: {n} m',
    anchorPosition: '⚓ Anchor position',
    adjustRadius: 'Adjust radius',
    removeAnchor: 'Remove anchor',

    // Status pill + sheet
    pillNoGps: 'No GPS',
    pillGpsWeak: 'GPS weak',
    pillOfflineLocal: 'Offline — local only',
    pillOffline: 'Offline',
    pillBoatOffline: 'Boat offline',
    pillNoData: 'No data',
    pillDataStale: 'Data stale',
    pillMonitoring: 'Monitoring',
    pillWatching: 'Watching',
    pillNotArmed: 'Not armed',
    sheetBoatData: 'Boat data',
    sheetServer: 'Server',
    sheetConnected: 'Connected',
    sheetDisconnected: 'Disconnected',
    sheetArmed: 'Armed',
    sheetNotArmed: 'Not armed',
    sheetFixAgo: 'Fix {s}s ago',
    sheetNoFix: 'No fix yet',
    sheetError: 'Error: {msg}',
    close: 'Close',

    // Move anchor
    moveAnchor: 'Move anchor',
    moveAnchorHint: 'Drag the anchor to its real position',
    useBoatPosition: 'Use boat position',
    save: 'Save',
    anchorMoved: 'Moved {d} m · {brg}',
    moveFarTitle: 'Move the anchor there?',
    moveFarMessage: 'That is {n} m from the boat.',

    // Zone margin
    zoneEdge: 'Edge',
    metersOutside: '{n} m outside',

    // GPS track
    trackOff: 'Track off',
    trackLastHour: 'Track 1 h',
    trackAll: 'Track all',

    // Zone editor sheet
    zoneModeCircle: 'Circle',
    zoneModeShape: 'Shape',
    shapeHint: 'Drag the points on the map to reshape the zone',
    resetToCircle: 'Reset to circle',
    done: 'Done',
    backToCircleTitle: 'Back to a circle?',
    backToCircleMessage: 'Your custom shape will be lost.',
    keepShape: 'Keep the shape',

    // Alarm screen
    anchorDragging: 'ANCHOR DRAGGING',
    triggeredInfo: 'Triggered {time} · outside zone for {s}s',
    zoneIs: 'zone is {n} m',
    drifting: 'drifting {dir} at {kn} kn',
    slideToSilence: 'Slide to silence',
    rearmCaption: 'Alarm re-arms when the boat returns inside the zone',

    // Native notifications (alarm + foreground service)
    notifTitle: '🚨 ANCHOR ALARM',
    notifBody: 'Your boat has left the anchor zone! {loc}',
    unknownLocation: 'Unknown location',
    fgsTitle: 'Anchor alarm active',
    fgsMessage: 'Tracking the boat position',

    // Session recovery (the server lost the session; the alarm never stopped)
    recoveredNotice: 'Reconnected — new session code {id}. Re-share it with your crew.',

    // Errors
    errConnecting: 'Connecting to server, please wait…',
    errCreateSession: 'Failed to create session: {msg}',
    errConnection: 'Connection error: {msg}',
    errUnreachable: "Can't reach the server ({msg}). Check your connection and try again.",
    errLocPermission: 'Location permission was not granted',
    errDropAnchor: 'Could not set the anchor position: {msg}',
  },

  fr: {
    appTitle: '⚓ Alarme de Mouillage',
    startMonitoring: '⚓ Surveiller ce bateau',
    startMonitoringNote: 'Ce téléphone reste à bord',
    createSession: 'Créer une session',
    creating: 'Création…',
    watchRemotely: '👀 Suivre à distance',
    watchRemotelyNote: 'Rejoindre une session en cours sur le bateau',
    createInAppNote:
      "Pour démarrer une session, utilisez l'application Anchor Alarm sur le téléphone du bateau.",
    sessionIdPlaceholder: 'ID de session',
    join: 'Rejoindre',
    scanQr: 'Scanner le QR',
    invalidSessionId: 'Veuillez entrer un ID de session valide',
    sessionCreated: 'Session créée',
    copied: 'Copié',
    shareHint: "Scannez depuis un autre téléphone pour suivre à distance — ou partagez l'ID.",
    openMap: 'Ouvrir la carte',
    scanHint: 'Visez le QR code de la session',
    cancel: 'Annuler',

    back: 'Retour',
    distanceToAnchor: "Distance à l'ancre",
    zoneLabel: 'Zone',
    gpsLabel: 'GPS',
    waitingGps: 'En attente du signal GPS…',
    waitingBoat: 'En attente de la position du bateau…',
    updatedAt: 'Mis à jour {time}',

    dropAnchor: "⚓ Mouiller l'ancre",
    armAlarm: "Armer l'alarme",
    radiusHint: 'Glissez le curseur, ou le point vert sur la carte',
    adjustZone: 'Ajuster la zone',
    raiseAnchor: "Lever l'ancre",
    raiseAnchorTitle: "Lever l'ancre ?",
    raiseAnchorMessage: "La position de l'ancre sera effacée et l'alarme désarmée.",
    keepWatching: 'Continuer la surveillance',

    leaveTitle: 'Quitter la session ?',
    leaveMessage: "Si vous quittez maintenant, la position de l'ancre et la zone seront perdues.",
    sessionEndedTitle: 'Session terminée — surveillance arrêtée',
    sessionEndedMessage:
      "Le téléphone du bateau a fermé cette session. Le bateau n'est plus surveillé et cet écran ne sera plus mis à jour.",
    sessionEndedAck: 'Compris',
    monitoringStoppedTitle: 'Surveillance interrompue',
    monitoringStoppedMessage:
      "Le téléphone du bateau ne transmet plus. Le bateau n'est plus surveillé. L'application a pu être fermée, perdre le réseau ou tomber en panne de batterie — s'il se reconnecte, la surveillance reprend d'elle-même.",
    monitoringStoppedAck: 'Compris',
    leave: 'Quitter',
    stay: 'Rester',

    boatPosition: '📍 Position du bateau',
    accuracyMeters: 'Précision : {n} m',
    anchorPosition: "⚓ Position de l'ancre",
    adjustRadius: 'Ajuster le rayon',
    removeAnchor: "Retirer l'ancre",

    pillNoGps: 'Pas de GPS',
    pillGpsWeak: 'GPS faible',
    pillOfflineLocal: 'Hors ligne — local seul',
    pillOffline: 'Hors ligne',
    pillBoatOffline: 'Bateau hors ligne',
    pillNoData: 'Pas de données',
    pillDataStale: 'Données anciennes',
    pillMonitoring: 'Surveillance',
    pillWatching: 'Suivi',
    pillNotArmed: 'Non armée',
    sheetBoatData: 'Données bateau',
    sheetServer: 'Serveur',
    sheetConnected: 'Connecté',
    sheetDisconnected: 'Déconnecté',
    sheetArmed: 'Armée',
    sheetNotArmed: 'Non armée',
    sheetFixAgo: 'Fix il y a {s}s',
    sheetNoFix: 'Aucun fix',
    sheetError: 'Erreur : {msg}',
    close: 'Fermer',

    // Move anchor
    moveAnchor: "Déplacer l'ancre",
    moveAnchorHint: "Faites glisser l'ancre vers sa position réelle",
    useBoatPosition: 'Utiliser la position du bateau',
    save: 'Enregistrer',
    anchorMoved: 'Déplacée de {d} m · {brg}',
    moveFarTitle: "Déplacer l'ancre ici ?",
    moveFarMessage: "C'est à {n} m du bateau.",

    // Zone margin
    zoneEdge: 'Bord',
    metersOutside: '{n} m hors zone',

    // GPS track
    trackOff: 'Trace masquée',
    trackLastHour: 'Trace 1 h',
    trackAll: 'Trace complète',

    // Zone editor sheet
    zoneModeCircle: 'Cercle',
    zoneModeShape: 'Forme',
    shapeHint: 'Glissez les points sur la carte pour modifier la zone',
    resetToCircle: 'Revenir au cercle',
    done: 'Terminé',
    backToCircleTitle: 'Revenir à un cercle ?',
    backToCircleMessage: 'Votre forme personnalisée sera perdue.',
    keepShape: 'Garder la forme',

    anchorDragging: "L'ANCRE DÉRAPE",
    triggeredInfo: 'Déclenchée à {time} · hors zone depuis {s}s',
    zoneIs: 'zone de {n} m',
    drifting: 'dérive {dir} à {kn} nd',
    slideToSilence: 'Glisser pour acquitter',
    rearmCaption: "L'alarme se réarme quand le bateau revient dans la zone",

    notifTitle: '🚨 ALARME MOUILLAGE',
    notifBody: 'Votre bateau a quitté la zone de mouillage ! {loc}',
    unknownLocation: 'Position inconnue',
    fgsTitle: 'Alarme de mouillage active',
    fgsMessage: 'Surveillance de la position du bateau',

    recoveredNotice: 'Reconnecté — nouveau code de session {id}. Repartagez-le avec votre équipage.',

    errConnecting: 'Connexion au serveur, patientez…',
    errCreateSession: 'Échec de création de session : {msg}',
    errConnection: 'Erreur de connexion : {msg}',
    errUnreachable: 'Serveur injoignable ({msg}). Vérifiez votre connexion et réessayez.',
    errLocPermission: 'Permission de localisation refusée',
    errDropAnchor: "Impossible de définir la position de l'ancre : {msg}",
  }
};
