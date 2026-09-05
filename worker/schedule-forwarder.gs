/**
 * Sends the school's weekly schedule email to DayFlow's relay.
 *
 * Why this exists: DayFlow is a phone app, so it cannot watch a mailbox, and
 * the relay is a Cloudflare Worker, which cannot receive email. This runs
 * inside the Google account that HAS the email, which is the one place that
 * needs no credentials at all — it is already signed in as you. Nothing is
 * sent anywhere except your own relay.
 *
 * Setup, once:
 *   1. In your SCHOOL account, make a filter that forwards the schedule email
 *      to your personal Gmail. (Settings -> Filters -> Create, from the
 *      school's sender, "Forward it to". Gmail will make you verify the
 *      address first, under Settings -> Forwarding.)
 *   2. In your PERSONAL account, go to script.google.com -> New project.
 *   3. Paste this whole file in, replacing what is there.
 *   4. Set SENDER and SUBJECT below to match the email.
 *   5. Run `forwardLatestSchedule` once. Google will ask for permission to
 *      read your Gmail; that permission is used by this script only.
 *   6. Triggers (the clock icon) -> Add trigger -> forwardLatestSchedule,
 *      time-driven, week timer, the morning after the email usually lands.
 *
 * Then it is automatic: open DayFlow and the week is waiting to be added.
 */

/** Who the schedule email comes from. A domain is fine. */
var SENDER = 'tanenbaumchat.org';

/** Words in the subject line. Leave '' to match on the sender alone. */
var SUBJECT = 'schedule';

/** Your relay, from DayFlow -> Settings -> Own SIM. */
var RELAY = 'https://dayflow-inbox.giveawaybot1225.workers.dev';
var SECRET = '473b71b56fd1d8224a42965ff4a15c2b515d4973a4fbcba0';

/** How far back to look. A week timer only ever needs the last few days. */
var DAYS = 8;

function forwardLatestSchedule() {
  var query = 'from:(' + SENDER + ') newer_than:' + DAYS + 'd';
  if (SUBJECT) query += ' subject:(' + SUBJECT + ')';

  var threads = GmailApp.search(query, 0, 5);
  if (!threads.length) {
    Logger.log('No schedule email in the last ' + DAYS + ' days.');
    return;
  }

  // Newest message across the matching threads. A forwarded email arrives as
  // its own thread, and a school that replies to its own announcement would
  // otherwise have the ORIGINAL picked up week after week.
  var newest = null;
  for (var t = 0; t < threads.length; t++) {
    var messages = threads[t].getMessages();
    for (var m = 0; m < messages.length; m++) {
      if (!newest || messages[m].getDate() > newest.getDate()) newest = messages[m];
    }
  }
  if (!newest) return;

  // Plain text where the school sent any, otherwise the HTML with its tags
  // stripped. A timetable is usually a table, and a table with the markup
  // removed still reads as rows, which is all the model needs.
  var body = newest.getPlainBody();
  if (!body || body.trim().length < 40) {
    body = newest
      .getBody()
      .replace(/<(br|\/tr|\/p|\/div|\/h[1-6])[^>]*>/gi, '\n')
      .replace(/<\/td>\s*<td[^>]*>/gi, '  |  ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n');
  }

  var payload = {
    body: body,
    subject: newest.getSubject(),
    from: newest.getFrom(),
    sentAt: newest.getDate().getTime(),
  };

  var res = UrlFetchApp.fetch(RELAY + '/schedule/' + encodeURIComponent(SECRET), {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  Logger.log('Relay answered ' + res.getResponseCode() + ': ' + res.getContentText());
}
