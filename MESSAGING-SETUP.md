# DayFlow Messaging — setup guide

Two phases: **A)** get a second number working inside DayFlow today (zero risk to your
TextNow number), **B)** port the TextNow number later only if you're happy.

---

## Part A — In-app number, working today (~15 min + one approval wait)

1. **Create the account** — go to twilio.com, sign up, verify your email and your
   personal phone number.

2. **Upgrade it** — add a payment card and load the minimum balance (~$20).
   (Trial accounts can only text numbers you've verified and stamp a trial notice
   on every message — useless for real clients.)

3. **Buy your number** — Console → **Phone Numbers → Manage → Buy a number** →
   pick your area code, make sure **SMS** is checked → Buy (~$1.15/month).

4. **Register the sender (required, or US carriers filter you)** — Console →
   **Messaging → Regulatory Compliance → A2P 10DLC** → register as **Sole Proprietor**.
   Name, address, and a short use-case description — "appointment scheduling and
   client communication for a personal services business" is accurate. One-time fee
   of a few dollars plus ~$2/month. Approval: minutes to a few days. Attach your
   number to the campaign it creates.

5. **Get your credentials** — Console home page shows **Account SID** (starts `AC…`)
   and **Auth Token** (tap to reveal).

6. **Connect DayFlow** — DayFlow → Settings → **Messaging** → paste SID, token, and
   the new number → **Connect**. Done: the Messages tab is live.

7. **Instant alerts on your personal phone (recommended)** — Console →
   **Explore products → Developer tools → TwiML Bins** → Create, paste (with your
   real personal number):

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <Response>
     <Message to="+1YOURPERSONALNUMBER">From {{From}}: {{Body}}</Message>
   </Response>
   ```

   Save → **Phone Numbers → your number → Messaging → "A message comes in"** →
   choose **TwiML Bin** → pick the bin → Save.
   Every incoming text now instantly buzzes your regular Messages app, AND still
   appears in DayFlow (the app reads the message log independently).

8. **Test it** — text the new number from your personal phone: you should get the
   forward instantly, see the thread in DayFlow within a few seconds of opening it,
   and be able to reply from DayFlow (reply arrives from the business number).

**Running costs:** ≈ $1.15/mo number + ≈ $2/mo registration + ~$0.008 per message.

---

## Part B — Porting the TextNow number (later, only once Part A feels solid)

The number keeps working on TextNow the whole time; a rejected port changes nothing.

1. **Unlock the number at TextNow** — TextNow app → Settings → Account →
   **Port out / Unlock number**. They charge a small unlock fee and give you an
   **account number and PIN**. Screenshot these.

2. **Check eligibility** — Twilio Console → **Phone Numbers → Port & Host →
   Port a number** → enter the TextNow number. It tells you immediately if it's
   portable.

3. **Submit the port** — fill the request with your name/address exactly as on the
   TextNow account, the account number + PIN from step 1, and e-sign the Letter of
   Authorization.

4. **Wait** — typically 1–2 weeks for VoIP numbers; Twilio emails progress. Keep
   using TextNow normally meanwhile.

5. **Flip day** — when Twilio confirms completion:
   - DayFlow → Settings → Messaging → change **Your number** to the ported number.
   - Re-attach the TwiML Bin forward to the ported number (step A7).
   - Attach the ported number to your A2P campaign (step A4 page).
   TextNow stops carrying the number at this point; the second number can be
   released or kept as a spare.

**Reality check before you do Part B:** the port process is safe, but the number's
new home (business SMS platform) polices message content more aggressively than a
consumer texting app — filtered messages or provider enforcement are possible
depending on content. Run Part A for a few weeks first and judge with your own
traffic. If anything ever felt off, you'd simply not port — nothing lost.
