# Arf x Superteam Türkiye University Track: submission kit

Everything the jury asks for, in English as the track requires. Listing: [Arf × Superteam Türkiye: University Track](https://superteam.fun/earn/listing/arf-superteam-turkiye-university-track).

| File | What it is |
|---|---|
| [description.md](description.md) | One-liner, short and long descriptions, how Arf is used, links |
| [pitch.md](pitch.md) | Three-minute pitch: slide by slide, with the spoken text and timings |
| [demo.md](demo.md) | Three-minute demo: the click path on devnet, what to say, what to check before recording |
| [jury-qa.md](jury-qa.md) | The questions the jury is likely to ask, answered without overclaiming |
| [validation.md](validation.md) | A campus test with students: protocol, survey and the table to fill |
| [deploy.md](deploy.md) | Putting the app on Vercel or Netlify with the Arf line |

## Checklist

What the listing requires, and where it stands.

| Requirement | State |
|---|---|
| Every team member is currently enrolled at a university in Türkiye | Team's to confirm; the README's Team section still lists the upstream authors |
| Colosseum profile with Türkiye as the home country | Team's to do |
| Superteam Türkiye Support & Intake Form | Team's to do: https://forms.gle/Lb585suVhkwm3Uxk7 |
| Colosseum Hackathon Telegram group | Team's to do: https://t.me/+3sWAzL4fgPViMjU8 |
| Triple submission: Colosseum Crypto World's Fair portal, the Superteam Türkiye local track, this listing | Team's to do. Colosseum announced that product submissions were due 12 October 2026; confirm with the listing contact (https://t.me/aysegulsensoy) before relying on a late submission |
| Pitch video, at most 3 minutes | Script ready in [pitch.md](pitch.md); recording is the team's |
| Demo video, at most 3 minutes, showing the product working | Script ready in [demo.md](demo.md); recording is the team's |
| Public GitHub repository, or access for the jury | Done: https://github.com/dr-wilson-empty/paralyx-arf is public |
| All materials in English | These files, the README and the app's EN switch |
| Traction and validation with real users | Protocol in [validation.md](validation.md); the test itself is the team's |

## What is built

- `arf_line`, an Anchor program on devnet at [`ARF4tQPAqQdGScZK7kF2yWK4tpkp99mPpEkr2rtdvAoC`](https://explorer.solana.com/address/ARF4tQPAqQdGScZK7kF2yWK4tpkp99mPpEkr2rtdvAoC?cluster=devnet): Arf's USDC in a vault, drawn by a licensed rail operator within a limit, a term of one to five days and a fee, exactly once per deposit, repaid oldest first, frozen by Arf at will. Twelve LiteSVM tests.
- The Paralyx rail drawing from that line for every lira repayment and repaying it from cash-outs, with the treasury float as fallback; the Takas screen showing the line and every receipt saying how it was funded.
- A devnet run of every path, linked transaction by transaction in the [README](../../README.md#the-arf-line-on-devnet).
- A fix for partial lira repayments and borrow-only opens, found during the run.
