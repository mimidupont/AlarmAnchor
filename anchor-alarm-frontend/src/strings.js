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
    resumeTitle: '⚠️ Watch left running',
    resumeNote: 'This phone started a watch and never ended it. Resuming keeps the same session, so anyone already watching stays connected.',
    resumeWatch: 'Resume {id}',
    resumeDiscard: 'Discard it',
    sessionIdPlaceholder: 'Session ID',
    join: 'Join',
    scanQr: 'Scan QR',
    invalidSessionId: 'Please enter a valid session ID',
    sessionCreated: 'Session created',
    copied: 'Copied',
    shareHint: 'Scan from another phone to watch remotely — or share the ID.',
    openMap: 'Open the map',
    scanHint: 'Point the camera at the session QR code',
    scanErrorDenied: 'Camera access was refused. Allow the camera for Anchor Alarm in Android settings, then try again.',
    scanErrorNoCamera: 'No usable camera was found on this device.',
    scanErrorUnsupported: 'This device cannot scan QR codes in the app.',
    scanErrorGeneric: 'The camera could not be started.',
    scanErrorFallback: 'You can type the session ID instead — it works just as well.',
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
    connectionLostTitle: 'Connection lost',
    connectionLostMessage:
      'This phone can no longer reach the server, so the boat is not being watched from here. The boat phone keeps its own alarm running on board. Monitoring resumes on its own once the connection is back.',
    boatConnectionLostTitle: 'This phone is offline',
    boatConnectionLostMessage:
      'This phone can no longer reach the server, so anyone watching from ashore can no longer see the boat. The anchor alarm keeps running here on local GPS. It reconnects on its own once the connection is back.',
    leave: 'Leave',
    stay: 'Stay',

    // Map popups
    boatPosition: '📍 Boat position',
    accuracyMeters: 'Accuracy: {n} m',
    anchorPosition: '⚓ Anchor position',

    // Alarm on connection loss.
    // On a remote monitor these describe losing sight of the boat; on the
    // boat phone the boat-prefixed variants describe losing the server (and
    // so the watchers ashore) while the anchor alarm keeps running locally.
    linkAlarmDelayLabel: 'Alarm if the boat goes unheard',
    linkAlarmDelayHint:
      'How long a connection gap must last before this phone sounds the alarm. Short gaps are normal — the boat phone keeps its own alarm running with no network at all.',
    boatLinkAlarmDelayLabel: 'Alarm if this phone goes offline',
    boatLinkAlarmDelayHint:
      'While this app is open, how long this phone must be unable to reach the server before it warns you — a heads-up that anyone watching from ashore can no longer see the boat. The anchor alarm keeps running here on local GPS the whole time, on screen or off.',
    delayImmediate: 'At once',
    delay2min: '2 min',
    delay10min: '10 min',
    delay1h: '1 h',

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
    themeLabel: 'Theme: {name}',
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
    notifLinkTitle: '⚠️ BOAT NOT BEING WATCHED',
    notifLinkBody: 'No news from the boat. This phone is no longer monitoring it.',
    notifBoatOfflineTitle: '⚠️ PHONE OFFLINE',
    notifBoatOfflineBody: 'This phone lost its connection. Anyone watching from ashore can no longer see the boat.',

    // Session recovery (the server lost the session; the alarm never stopped)
    recoveredNotice: 'Reconnected — new session code {id}. Re-share it with your crew.',

    // Errors
    errConnecting: 'Connecting to server, please wait…',
    errCreateSession: 'Failed to create session: {msg}',
    errConnection: 'Connection error: {msg}',
    errUnreachable: "Can't reach the server ({msg}). Check your connection and try again.",
    errLocPermission: 'Location permission was not granted',
    errDropAnchor: 'Could not set the anchor position: {msg}',
    errNotYourSession: 'That watch belongs to another phone. Only the phone that started a session can take it back over.',
    alarmMutedWarning:
      "This phone's alarm volume is turned all the way down, so the anchor alarm will be silent. Turn the alarm volume up with the volume keys, or in Settings › Sound › Alarm volume.",
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
    resumeTitle: '⚠️ Veille restée active',
    resumeNote: "Ce téléphone a démarré une veille sans jamais la terminer. La reprendre conserve la même session : les personnes qui surveillent restent connectées.",
    resumeWatch: 'Reprendre {id}',
    resumeDiscard: "L'abandonner",
    sessionIdPlaceholder: 'ID de session',
    join: 'Rejoindre',
    scanQr: 'Scanner le QR',
    invalidSessionId: 'Veuillez entrer un ID de session valide',
    sessionCreated: 'Session créée',
    copied: 'Copié',
    shareHint: "Scannez depuis un autre téléphone pour suivre à distance — ou partagez l'ID.",
    openMap: 'Ouvrir la carte',
    scanHint: 'Visez le QR code de la session',
    scanErrorDenied: "L'accès à la caméra a été refusé. Autorisez la caméra pour Anchor Alarm dans les réglages Android, puis réessayez.",
    scanErrorNoCamera: 'Aucune caméra utilisable sur cet appareil.',
    scanErrorUnsupported: "Cet appareil ne peut pas scanner de QR code dans l'application.",
    scanErrorGeneric: "La caméra n'a pas pu démarrer.",
    scanErrorFallback: "Vous pouvez saisir l'ID de session à la place — cela fonctionne aussi bien.",
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
    connectionLostTitle: 'Connexion perdue',
    connectionLostMessage:
      "Ce téléphone ne joint plus le serveur : le bateau n'est plus surveillé depuis ici. Le téléphone du bateau, lui, garde son alarme active à bord. La surveillance reprend d'elle-même dès le retour du réseau.",
    boatConnectionLostTitle: 'Ce téléphone est hors ligne',
    boatConnectionLostMessage:
      "Ce téléphone ne joint plus le serveur : ceux qui surveillent depuis la terre ne voient plus le bateau. L'alarme de mouillage continue de tourner ici sur le GPS local. La connexion revient d'elle-même dès le retour du réseau.",
    leave: 'Quitter',
    stay: 'Rester',

    boatPosition: '📍 Position du bateau',
    accuracyMeters: 'Précision : {n} m',
    anchorPosition: "⚓ Position de l'ancre",

    linkAlarmDelayLabel: 'Alarme si le bateau ne donne plus de nouvelles',
    linkAlarmDelayHint:
      "Durée d'une coupure avant que ce téléphone ne déclenche l'alarme. Les coupures brèves sont normales — le téléphone du bateau garde son alarme active même sans réseau.",
    boatLinkAlarmDelayLabel: 'Alarme si ce téléphone passe hors ligne',
    boatLinkAlarmDelayHint:
      "Tant que cette appli est ouverte, durée pendant laquelle ce téléphone doit être incapable de joindre le serveur avant de vous avertir — pour signaler que ceux qui surveillent depuis la terre ne voient plus le bateau. L'alarme de mouillage continue de tourner ici sur le GPS local pendant tout ce temps, écran allumé ou éteint.",
    delayImmediate: 'Aussitôt',
    delay2min: '2 min',
    delay10min: '10 min',
    delay1h: '1 h',

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
    themeLabel: 'Thème : {name}',
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
    notifLinkTitle: '⚠️ BATEAU NON SURVEILLÉ',
    notifLinkBody: "Plus de nouvelles du bateau. Ce téléphone ne le surveille plus.",
    notifBoatOfflineTitle: '⚠️ TÉLÉPHONE HORS LIGNE',
    notifBoatOfflineBody: "Ce téléphone a perdu sa connexion. Ceux qui surveillent depuis la terre ne voient plus le bateau.",

    recoveredNotice: 'Reconnecté — nouveau code de session {id}. Repartagez-le avec votre équipage.',

    errConnecting: 'Connexion au serveur, patientez…',
    errCreateSession: 'Échec de création de session : {msg}',
    errConnection: 'Erreur de connexion : {msg}',
    errUnreachable: 'Serveur injoignable ({msg}). Vérifiez votre connexion et réessayez.',
    errLocPermission: 'Permission de localisation refusée',
    errDropAnchor: "Impossible de définir la position de l'ancre : {msg}",
    errNotYourSession: "Cette veille appartient à un autre téléphone. Seul le téléphone qui a créé la session peut la reprendre.",
    alarmMutedWarning:
      "Le volume des alarmes de ce téléphone est à zéro : l'alarme de mouillage sera silencieuse. Montez le volume des alarmes avec les touches de volume, ou dans Réglages › Son › Volume des alarmes.",
  }
};
