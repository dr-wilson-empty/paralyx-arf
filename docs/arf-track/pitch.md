# Pitch: three minutes

Eight slides, about 420 spoken words, which is three minutes at a calm pace. Record once, cut nothing, and keep the last slide on screen for two seconds. Every number below is on chain or in the repository; do not round them up.

## 1. The problem (0:00 to 0:20)

**Slide:** a student, a SOL balance, a rent bill in lira.

> In Türkiye, a lot of young people hold crypto. When they need lira, their only option is to sell, usually at the wrong moment. Paralyx lets them borrow lira against their SOL instead, and keep the position.

## 2. The product (0:20 to 0:45)

**Slide:** SOL → Kamino Lend → USDC → lira to your IBAN; repay in lira, SOL comes back.

> You post SOL as collateral to a Kamino Lend market and borrow USDC, in one transaction. The rail turns that USDC into lira in your bank account. When you want your SOL back, you repay in lira. Paralyx never holds your funds: the position is yours on Kamino.

## 3. The gap nobody sees (0:45 to 1:05)

**Slide:** the repayment leg, with the operator's idle USDC float highlighted.

> The hard part is the repayment. You send lira and expect your debt to shrink now. But the rail operator only has USDC after it converts your lira. So every operator keeps a pile of USDC sitting idle, on every corridor. That is exactly the problem Arf solves for payment companies.

## 4. Arf on Solana (1:05 to 1:40)

**Slide:** `arf_line`: provider, operator, vault, draws; limit, term, fee, freeze.

> Arf lends short-term USDC to licensed payment companies so they settle without prefunding. We built `arf_line`, an Anchor program that turns that credit line into code. Arf's USDC sits in a program vault. Arf sets the limit, a term of one to five days and the fee, and can freeze the line. The rail draws without asking Arf to sign each time. Every draw is an account keyed to the deposit, so it can only happen once, and repayments go oldest first. If a draw is overdue, the program refuses new ones.

## 5. It works (1:40 to 2:10)

**Slide:** the program address, the devnet run table, test counts.

> This is deployed on devnet. Every lira repayment in our app is now funded by an Arf draw, and cash-outs repay it. We ran every path: draws, batched repayments, a limit, a freeze, and two settlements of the same deposit at once, where the second draw failed on chain. Twenty-six program tests and twenty-eight client tests.

## 6. Why Solana (2:10 to 2:30)

**Slide:** Kamino, Pyth, `arf_line` as a reusable primitive.

> Solana lets us compose: Kamino is the lender, Pyth prices it, and `arf_line` is a primitive any payment corridor can reuse, with every draw readable on chain, which is the transparency Arf already publishes.

## 7. Users (2:30 to 2:48)

**Slide:** campus test plan, numbers from [validation.md](validation.md) once the test is done.

> We are testing the flow with university students first: how long it takes from SOL to lira, and where they get stuck.

If the campus test has been run, replace this sentence with its real numbers. If not, keep it as a plan and do not claim users.

## 8. What is next (2:48 to 3:00)

**Slide:** audit, Arf partnership through a licensed operator, mainnet.

> Next: an audit of `arf_line`, a licensed operator with an Arf line, and mainnet. Lira liquidity, without selling your SOL, and without prefunding.

## Do not say

- That Arf is a partner, has approved the project, or that real Arf funds moved. It is Arf's model running on devnet with devnet USDC.
- That lira moved. The lira leg is a sandbox.
- That it is live on mainnet, or audited.
- That BiLira is integrated. It is the planned production rail, not wired.
