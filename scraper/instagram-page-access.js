import { load } from 'cheerio';

const wallPrompt = /log\s*in\s+to\s+(?:instagram|(?:see|view|continue))|sign\s*in\s+to\s+(?:see|view|continue)|melde\s+dich\s+an[,\s]+um|anmelden[,\s]+um\s+(?:diesen|den|mehr|fortzufahren)|verify\s+(?:to continue|you are human)|security\s+check|sicherheits(?:pruefung|pr\u00fcfung)|best\u00e4tige,?\s+dass\s+du/i;
const wallTitle = /^(?:(?:log\s*in|sign\s*in|anmelden)\s*[|\u2022-]\s*instagram|instagram\s*[|\u2022-]\s*(?:log\s*in|sign\s*in|anmelden))$/i;

// A navigation link to login is not a refusal. Redirects, actual login forms
// and visible blocking prompts remain refusals even with cached post metadata.
export function instagramPageHasAccessWall(data = {}) {
  try {
    if (/^\/(?:accounts\/(?:login|onetap)|challenge|checkpoint)(?:\/|$)/i.test(new URL(data.finalUrl).pathname)) return true;
  } catch {}
  if (data.hasLoginForm || wallPrompt.test(data.blockingDialogText || '')) return true;
  let title = data.title || '', bodyText = data.bodyText || '';
  if (typeof data.html === 'string') {
    const $ = load(data.html);
    if ($('form input[type="password"]').toArray().some(node => !$(node).closest('[hidden], [aria-hidden="true"]').length)) return true;
    title ||= $('title').text();
    $('script, style, template, noscript, [hidden], [aria-hidden="true"]').remove();
    if (wallPrompt.test($('[role="dialog"], [aria-modal="true"]').text())) return true;
    bodyText ||= $('body').text();
  }
  return wallTitle.test(title.trim()) || wallPrompt.test(bodyText.replace(/\s+/g, ' ').trim().slice(0, 700));
}
