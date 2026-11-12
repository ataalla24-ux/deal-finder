export function instagramLoginCredentials(env) {
  const username = String(env.INSTAGRAM_USERNAME || env.IG_USERNAME || '').trim();
  // Password whitespace is significant; never apply display-text normalization.
  const password = String(env.INSTAGRAM_PASSWORD || env.IG_PASSWORD || '');
  if (!username) throw new Error('INSTAGRAM_USERNAME/IG_USERNAME fehlt');
  if (!password) throw new Error('INSTAGRAM_PASSWORD/IG_PASSWORD fehlt');
  return { username, password };
}

export function loginConfigurationAudit(env) {
  const password = String(env.INSTAGRAM_PASSWORD || env.IG_PASSWORD || '');
  const username = String(env.INSTAGRAM_USERNAME || env.IG_USERNAME || '');
  return {
    passwordConfigured: Boolean(password),
    legacyPasswordNormalizationWouldChange: password ? password.replace(/\s+/g, ' ').trim() !== password : null,
    usernameRequiresTrimming: username ? username.trim() !== username : null,
    credentialValuesDisclosed: false,
  };
}

export function workflowMaskValue(value) {
  return String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

export function instagramLoginPageState(url, text) {
  const signal = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  let pathname = '';
  try { pathname = new URL(url).pathname; } catch { /* Unknown locations are not authenticated. */ }
  if (/please wait a few minutes|try again later|too many requests|versuche es später|versuch es später|zu viele anfragen/.test(signal)) return 'rate-limited';
  if (/login-informationen sind nicht korrekt|anmeldeinformationen.*(?:nicht korrekt|falsch)|incorrect|wrong password|invalid password|password.*not correct|passwort.*falsch|login info.*(?:incorrect|not correct)/.test(signal)) return 'login-rejected';
  if (/sieh in deinen e-mails nach|check your (?:e-?mail|inbox)|(?:e-?mail|email).{0,80}(?:code|bestätigung)|code.{0,80}(?:e-?mail|email)/.test(signal)) return 'email-code';
  if (/authenticator|authentifizierungs.?app|authentication app|two-factor|zweistufige|zwei-faktor/.test(signal) || /two_factor/.test(pathname)) return 'two-factor';
  if (/\/challenge\/|\/checkpoint\/|\/auth_platform\/codeentry|suspended|disabled/i.test(pathname)
    || /confirm it'?s you|suspicious|help us confirm|verify your account|verdächtig|security code|sicherheitscode|verification code/.test(signal)) return 'challenge';
  return 'unknown';
}
