// Where a session may be created.
//
// A session is the boat phone's session: whoever creates it becomes role
// 'main', starts GPS, and owns the alarm. None of that works in a browser
// tab — no foreground service, no background geolocation, no alarm that
// survives a locked screen — so offering "Create a session" on the hosted
// site produces a boat watch that silently is not one. The web build is for
// remote monitoring only; the boat phone always runs the native app.
//
// Kept as a pure function rather than an inline check so the rule is
// testable without a browser or a Capacitor runtime.
//
// `development` is allowed so `npm start` remains usable: the dev server
// runs in a browser, and without this there would be no way to create a
// session while working on the app. A production web build never takes
// that branch.
export const canCreateSession = (isNativePlatform, nodeEnv) =>
  Boolean(isNativePlatform) || nodeEnv === 'development';
