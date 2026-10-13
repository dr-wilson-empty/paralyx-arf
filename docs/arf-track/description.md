# Project description

## One line

Paralyx gives Turkish crypto holders lira without selling their SOL, and its `arf_line` program lets the lira rail settle repayments from an Arf credit line on Solana instead of a prefunded float.

## Short (for form fields, about 60 words)

Paralyx is a collateralized lira credit line on Solana: post SOL to Kamino Lend, borrow USDC, cash it out as lira, repay in lira. We added `arf_line`, an Anchor program that holds Arf's USDC in a vault and lets the licensed rail operator draw it within Arf's limit, term and fee, so a lira repayment reaches the debt in seconds without prefunding.

## Long

**The user.** A student in Istanbul holds SOL and needs lira for rent. Selling means giving up the position and often selling low. Paralyx lets them post SOL as collateral to a Kamino Lend market, borrow USDC in one transaction, and cash it out as lira to their own IBAN through a regulated rail. They repay in lira too, and their collateral comes back.

**The rail's problem.** Repaying in lira hides a settlement gap. The user wires lira and expects the debt to shrink now, but the rail operator only has USDC once it has converted that lira. Without a lender, the operator has to keep a USDC float idle on every corridor. This is the problem Arf solves for payment companies: short-term, receivable-backed USDC liquidity, repaid in one to five days, so they can settle without prefunding.

**What we built for Arf's track.** `arf_line` is a second Anchor program, deployed on devnet. A line binds Arf (the provider), the licensed rail operator and a mint:

- Arf's capital sits in a vault the line owns. Arf funds it, withdraws what is not lent out, sets the limit, the term (one to five days, the range Arf states) and the fee, and can freeze the line.
- The operator draws without a signature from Arf, straight to the user's account, within those terms. Each draw is an account seeded by the deposit reference, so one deposit can be drawn only once, enforced on chain.
- Repayments go oldest first. The line keeps the due date of the oldest open draw, so no new draw goes out while one is overdue.

Paralyx's rail now settles every lira repayment from an Arf draw and repays open draws from the USDC that cash-outs bring in. If the line refuses (frozen, overdue, limit, liquidity), the treasury float pays and the receipt says why.

**Proof.** Every path ran on devnet against the deployed program: draws, batched repayments, a raced double settlement where the second draw failed on chain, limit and freeze refusals, and the full flow in the browser. 26 program tests and 28 client tests.

**What is not real yet.** The lira leg is a sandbox and the capital is devnet USDC put in by a test key standing in for Arf. Arf has no public API and lends only to licensed institutions, so in production the line's operator would be the licensed rail operator, after an audit of `arf_line` and an agreement with Arf.

## How it uses Arf

Arf's product is liquidity for payment companies without prefunding. `arf_line` turns that agreement into code both parties can read: the limit, term, fee, freeze, exactly-once draws and repayment order are enforced by the program, and every draw and repayment is an account or event Arf's on-chain reporting can read directly. It matches the listing's suggested areas: payments, stablecoins, cross-border transfers and PayFi.

## Built with

Solana, Anchor 1.2, Kamino Lend (klend v2 handlers through CPI), Pyth, SPL Token, the Solana wallet adapter, React and Vite, a Vercel function for the rail, LiteSVM for tests.

## Links

- Source: https://github.com/dr-wilson-empty/paralyx-arf
- `arf_line` program (devnet): https://explorer.solana.com/address/ARF4tQPAqQdGScZK7kF2yWK4tpkp99mPpEkr2rtdvAoC?cluster=devnet
- The line of the devnet run: https://explorer.solana.com/address/7zLBPHXSMZ8xY2ep9CBX65zWVh1UERZK3J1yHvWwSTer?cluster=devnet
- `credit_line` program (devnet): https://explorer.solana.com/address/PLXama5SomfMXpUzgwAVhDXMJrESMX8JP93RGRyG6qr?cluster=devnet
- App: the team's Vercel deployment ([deploy.md](deploy.md)); upstream without Arf: https://paralyx.wienerlabs.xyz
