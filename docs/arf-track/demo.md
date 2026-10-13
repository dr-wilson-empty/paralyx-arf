# Demo: three minutes

The demo must show the product working. Record the browser at 1440 px wide with the app in English (the EN switch in the top bar) and a terminal next to it. Use Phantom or Solflare on devnet; never record with the burner wallet enabled on a public build.

## Before recording

1. **The rail is deployed** with `ARF_LINE` set ([deploy.md](deploy.md)), and `GET /api/rail?action=arf` returns `"enabled": true`.
2. **The vault holds USDC.** `node scripts/arf.mjs show <line>` shows `liquidity` of at least 3 USDC and no open draw. Top it up with `node scripts/arf.mjs fund .keys/arf-local.json <line> 3`.
3. **The treasury has SOL for fees and draw rent** (each draw account costs it about 0.0022 SOL): at least 0.05 SOL.
4. **Kamino's devnet market has USDC to lend.** On the Market page, the USDC reserve's supplied minus borrowed is what is left; it is a small third-party test market, so borrow 1.5 USDC, not more.
5. **The wallet** has about 0.2 devnet SOL and no open Kamino debt. The in-app faucet is rate limited; fund it beforehand.
6. **The terms are open:** `arf.mjs show` says `frozen: false`.

## Script

| Time | Screen | Say |
|---|---|---|
| 0:00 | Exchange page, the Arf liquidity line card on the right | "This is Paralyx on Solana devnet. On the right is an Arf liquidity line: Arf's USDC in a program vault, the limit, a three-day term and a ten basis point fee." |
| 0:15 | Click the program link in the card; Explorer shows `ARF4…vAoC` | "It is our `arf_line` program, deployed on devnet." Return to the app. |
| 0:25 | Open a line: 0.05 SOL collateral, borrow 1.5 USDC, sign | "First, the user posts SOL to Kamino and borrows USDC. One transaction." |
| 0:50 | Exchange, Cash out 1 USDC, sign | "They cash out one USDC as lira. On devnet the bank payout is simulated, and the receipt says so." |
| 1:15 | Repay in lira, 50 TRY, keep "withdraw collateral" checked, sign | "Now they repay in lira. Watch the rail step." |
| 1:35 | The step says "Arf draw #N"; the receipt says "Funded by: Arf draw #N", debt 0, collateral back | "The USDC came from an Arf draw, straight from the vault to the user, signed by the rail alone. The debt is closed and the SOL is back. No prefunded float." |
| 1:55 | The Arf card: draw #N open, due in three days. Click it; Explorer shows the draw account | "Every draw is an account keyed to the deposit. The same deposit cannot be drawn twice; the program rejects it." |
| 2:15 | Terminal: `curl -X POST '<app>/api/rail?action=arf-sweep'` (or a second cash-out from another wallet) | "When cash-outs bring USDC in, the rail repays Arf, oldest draw first." |
| 2:30 | Card: draw #N "Repaid"; `node scripts/arf.mjs show <line>` | "Outstanding is back to zero and the vault kept its fee." |
| 2:45 | Optional: `arf.mjs terms ... frozen`, then the card shows "Arf froze the line" | "And Arf can freeze the line at any time; deposits then fall back to the operator's float." Unfreeze after recording. |
| 2:55 | Back to the card | "Arf's liquidity model, enforced on Solana." |

## If something fails while recording

- **429 from the RPC:** the rail needs its own `RAIL_RPC`; the public endpoint is shared with the browser.
- **"the sandbox treasury does not hold enough devnet USDC":** the line refused (the reason is in the message) and the float is empty. Fund the vault, or check `frozen` and overdue draws with `arf.mjs show`.
- **"this wallet already holds enough USDC to repay the debt":** the rail only funds real Kamino repayments. Cash out first so the wallet holds less USDC than the debt.
- **Kamino "InsufficientLiquidity" when opening:** borrow less; the devnet reserve is small.
