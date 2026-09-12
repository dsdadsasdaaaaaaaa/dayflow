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
 *   1. In your SCHOOL account, make a filter that forwards the newsletter to
 *      your personal Gmail. (Settings -> Filters -> Create, from the school's
 *      sender, "Forward it to". Gmail makes you verify the address first,
 *      under Settings -> Forwarding.)
 *   2. In your PERSONAL account, go to script.google.com -> New project.
 *   3. Paste this whole file in, replacing what is there.
 *   4. Press Run. Google will ask for permission to read your Gmail; that
 *      permission is used by this script only. Check the log — it names the
 *      email it found and says whether the relay took it. (The dropdown
 *      beside Run should say forwardLatestSchedule; it is first in the file
 *      so that it is the default.)
 *   5. Triggers (the clock icon) -> Add trigger -> forwardLatestSchedule,
 *      time-driven, week timer, Saturday morning. The newsletter goes out
 *      Friday afternoon, so by then it is always waiting.
 *
 * Then it is automatic: open DayFlow and next week is there to be added.
 */

/**
 * Who the newsletter comes from.
 *
 * Not the school's domain, which is the obvious answer and the wrong one:
 * they send through Constant Contact, so the actual From is
 * "TanenbaumCHAT <info-tanenbaumchat.org@shared1.ccsend.com>" and the school
 * domain only appears inside the local part. Matching the bare word catches
 * the display name and that address both, and would still catch a message
 * sent directly from the school. Whatever it lets through, nothing is
 * forwarded unless it also contains a schedule grid.
 */
var SENDER = 'tanenbaumchat';

/**
 * Phrases that mean this email actually contains a timetable.
 *
 * The same address sends plain announcements between schedules, and posting
 * one of those would replace a good week with an email that has no week in
 * it. So the newest message is not necessarily the right one: the newest
 * message CONTAINING A GRID is.
 */
var SCHEDULE_MARKERS = ["next week's schedule", 'next weeks schedule', 'looking ahead'];

/** Your relay, from DayFlow -> Settings -> Own SIM. */
var RELAY = 'https://dayflow-inbox.giveawaybot1225.workers.dev';
var SECRET = '473b71b56fd1d8224a42965ff4a15c2b515d4973a4fbcba0';

/** How far back to look. A weekly trigger only needs the last few days. */
var DAYS = 10;

/**
 * ---------------------------------------------------------------------------
 * THIS is the function to run. The editor's Run button uses whichever function
 * comes first in the file, so this one does — running a helper on its own only
 * produces "Cannot read properties of undefined".
 * ---------------------------------------------------------------------------
 */
function forwardLatestSchedule() {
  // Look for the SCHEDULE, not for the sender.
  //
  // Who an email is from turns out not to survive the trip. Forwarded by a
  // Gmail filter it keeps the school's address; forwarded by hand it arrives
  // from you, and a sender search then matches nothing while looking exactly
  // like broken forwarding. The school also sends through Constant Contact,
  // so even the untouched article is from a ccsend.com address. What does not
  // change is that a schedule email contains a schedule, so that is the
  // question asked first; the sender is only a fallback.
  var queries = [];
  for (var q = 0; q < SCHEDULE_MARKERS.length; q++) {
    queries.push('"' + SCHEDULE_MARKERS[q] + '" newer_than:' + DAYS + 'd');
  }
  queries.push('from:(' + SENDER + ') newer_than:' + DAYS + 'd');
  queries.push('(' + SENDER + ') newer_than:' + DAYS + 'd');

  var messages = [];
  var seen = {};
  for (var i = 0; i < queries.length; i++) {
    var threads = GmailApp.search(queries[i], 0, 15);
    for (var t = 0; t < threads.length; t++) {
      var inThread = threads[t].getMessages();
      for (var m = 0; m < inThread.length; m++) {
        var id = inThread[m].getId();
        if (seen[id]) continue;
        seen[id] = true;
        messages.push(inThread[m]);
      }
    }
  }
  if (!messages.length) {
    Logger.log(
      'No candidate emails in the last ' + DAYS + ' days. Tried: ' + queries.join('  /  ')
    );
    return;
  }
  Logger.log('Checking ' + messages.length + ' email(s) for a schedule grid.');
  messages.sort(function (a, b) {
    return b.getDate().getTime() - a.getDate().getTime();
  });

  var chosen = null;
  var body = '';
  for (var m = 0; m < messages.length; m++) {
    var text = readBody(messages[m]);
    if (looksLikeSchedule(text)) {
      chosen = messages[m];
      body = text;
      break;
    }
  }
  if (!chosen) {
    // Better to leave last week's schedule in place than to overwrite it
    // with a notice about a bake sale.
    Logger.log(
      'Found ' + messages.length + ' email(s), none containing a schedule grid. ' +
        'Newest was "' + messages[0].getSubject() + '". Leaving the relay as it is.'
    );
    return;
  }

  var attachments = bellSchedules(chosen.getBody());
  var res = UrlFetchApp.fetch(RELAY + '/schedule/' + encodeURIComponent(SECRET), {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      body: body,
      subject: chosen.getSubject(),
      from: chosen.getFrom(),
      sentAt: chosen.getDate().getTime(),
      attachments: attachments,
    }),
    muteHttpExceptions: true,
  });
  Logger.log(
    'Sent "' + chosen.getSubject() + '" (' + body.length + ' chars, ' +
      attachments.length + ' bell schedule(s)). ' +
      'Relay answered ' + res.getResponseCode() + ': ' + res.getContentText()
  );
}

/**
 * HTML to text, keeping the table shape.
 *
 * This is the part that decides whether an entry lands on the right day. The
 * schedule is a grid: one row of day headings, and the entries underneath in
 * matching columns. Strip the tags naively and the whole grid collapses into
 * a list with nothing saying which column anything came from — the reader is
 * then guessing, and a guess here puts a test on the wrong day. So rows stay
 * rows and cells stay separated.
 */
function htmlToText(html) {
  return (
    String(html || '')
      // Zero-width junk first, before anything tries to match around it.
      // Constant Contact sprinkles U+FEFF through these emails, and a
      // "Monday,<FEFF><br>September 7" defeats every tidy-up below by
      // sitting invisibly between the comma and the break.
      .replace(/[\uFEFF\u200B\u200C\u200D\u2060]/g, '')
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      // A line break INSIDE a cell must not become a line break in the text.
      // The grid's meaning is positional — third cell means Wednesday — and a
      // cell that spills onto its own line loses the column it came from.
      // These emails put three entries in a cell separated by <br>, so this
      // is the difference between "Wednesday: Carnival" and a floating
      // "Carnival" that could belong to any day of the week.
      .replace(/<br\s*\/?>/gi, '; ')
      .replace(/<\/(p|div|li)>/gi, '; ')
      .replace(/<\/t[dh]>/gi, ' | ')
      // Only a row, a table or a heading ends a line. Everything else these
      // newsletters nest inside a cell — and they nest a great deal.
      .replace(/<\/tr>/gi, '\n')
      .replace(/<\/table>/gi, '\n\n')
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      // Numeric entities, decoded to the characters they name. HEX is the
      // form these emails actually use — "Candle Lighting:&#xa0; 7:17 PM" —
      // and the old chain handled only decimal, so every one of them reached
      // the reader as literal "&#xa0;" text. Eighty-three of them in one
      // newsletter.
      .replace(/&#x([0-9a-fA-F]+);?/g, function (whole, hex) {
        var n = parseInt(hex, 16);
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' ';
      })
      .replace(/&#(\d+);?/g, function (whole, dec) {
        var n = parseInt(dec, 10);
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' ';
      })
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&#39;|&rsquo;|&lsquo;/gi, "'")
      .replace(/&quot;|&[lr]dquo;/gi, '"')
      .replace(/&[a-z]+;/gi, ' ')
      // Decoding can produce the very characters the first pass removed: a
      // &#xfeff; is invisible junk only once it is a character.
      .replace(/[\uFEFF\u200B\u200C\u200D\u2060]/g, '')
      .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
      .replace(/[ \t]+/g, ' ')
      // Tidy the separators back down. Repeated semicolons are an artefact
      // of the layout and mean nothing. Repeated PIPES are not: an empty
      // cell is a position, and a grid whose Wednesday is blank still has a
      // Wednesday. Collapsing "| |" into "|" would slide every day after it
      // one column to the left, which is the exact failure this whole
      // function exists to prevent.
      .replace(/(?:;\s*)+/g, '; ')
      // "Monday,<br>September 7" is one heading, not two things.
      .replace(/,\s*;\s*/g, ', ')
      // Nor is "First Day of School:<br>Special Schedule". A trailing colon
      // is a label waiting for its value, and the value is the next line;
      // splitting there made two entries out of one, the first of them a
      // title with nothing after the colon.
      .replace(/:\s*;\s*/g, ': ')
      // "Grade 9 Parent Welcome<br>(7:00 PM)" is one entry with its time on
      // the next line, not an entry called "(7:00 PM)". Put the time back on
      // the thing it belongs to before anything reads the two as separate.
      .replace(/;\s*(\(\s*(?:\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?|noon)\s*\))/gi, ' $1')
      .replace(/;\s*\|/g, ' |')
      .split('\n')
      .map(function (line) {
        return line.replace(/^[\s;|]+/, '').replace(/[\s;|]+$/, '');
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

function looksLikeSchedule(text) {
  var lower = text.toLowerCase();
  for (var i = 0; i < SCHEDULE_MARKERS.length; i++) {
    if (lower.indexOf(SCHEDULE_MARKERS[i]) !== -1) return true;
  }
  return false;
}

/** The email as text, preferring the HTML because that is where the grid is. */
function readBody(message) {
  var html = message.getBody();
  if (html && html.indexOf('<') !== -1) {
    var text = htmlToText(html);
    if (text.length > 40) return text;
  }
  return message.getPlainBody();
}


/**
 * The bell-schedule documents the newsletter links to.
 *
 * "Special Schedule" in the grid is a link, and behind it is a one-page PDF
 * of that day's periods and times — the only place the school says which
 * classes run and for how long on a day that is not normal. It is an image,
 * not text, so it goes to the relay as bytes for the app to show a model.
 * Only links inside the grid whose text talks about the schedule are
 * followed; the newsletter has forty links and the rest are not this.
 */
function bellSchedules(html) {
  var out = [];
  var seen = {};
  var re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(html)) !== null && out.length < 8) {
    var text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!/schedule|start|dismissal/i.test(text)) continue;
    var href = m[1].replace(/&amp;/g, '&');
    if (seen[href]) continue;
    seen[href] = true;
    try {
      var res = UrlFetchApp.fetch(href, { followRedirects: true, muteHttpExceptions: true });
      if (res.getResponseCode() !== 200) continue;
      var blob = res.getBlob();
      var mime = String(blob.getContentType() || '');
      if (mime.indexOf('pdf') === -1 && mime.indexOf('image') === -1) continue;
      var bytes = blob.getBytes();
      if (bytes.length > 700000) continue;
      out.push({ name: text, mime: mime, data: Utilities.base64Encode(bytes) });
    } catch (e) {
      Logger.log('Could not fetch "' + text + '": ' + e);
    }
  }
  return out;
}
