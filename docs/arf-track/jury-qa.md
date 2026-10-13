# Jury questions

Short, true answers. If a question goes past what is built, say so.

**Is Arf actually integrated?**
Arf's model is, Arf's systems are not. Arf has no public API or SDK and lends only to licensed institutions. We built the credit line Arf would give a licensed rail operator as an on-chain program, and our rail uses it for every lira repayment on devnet. The capital is devnet USDC from a test key standing in for Arf.

**Arf's public material mentions Stellar. Why Solana?**
The product's credit engine is Kamino Lend and its prices come from Pyth, both on Solana, and the track is a Solana track. USDC is native on Solana, so an Arf line can settle where the rail already is. Whether Arf settles on Solana in production is the first thing to confirm with Arf; it is on our production checklist.

**Who holds the money?**
The user's position is theirs on Kamino; `credit_line` never holds funds. `arf_line` does hold Arf's capital in a vault the line owns, so it is custody: before mainnet it needs an audit and its upgrade authority under a multisig of Arf and the operator, or a timelock. On devnet the deployer holds the authority.

**What stops the rail from draining Arf's vault?**
The program: a draw must fit under the limit with its fee, it is refused while the oldest draw is overdue, it is refused while Arf has frozen the line, and each deposit reference can be drawn once. Arf can withdraw everything that is not lent out at any moment.

**What if the operator does not repay?**
New draws stop as soon as the oldest draw passes its due date, and Arf can freeze the line. Collecting the debt itself is the credit agreement between Arf and a licensed operator, off chain, as it is today; the program makes the exposure visible and capped.

**Why not just hold a USDC float?**
A float ties up capital on every corridor and runs dry at night and on weekends. Arf's whole business is removing prefunding; this is that, applied to the repayment leg of a lira credit line.

**Is this legal in Türkiye?**
Paralyx is non-custodial software and never touches lira. The lira leg would be a licensed crypto asset service provider under Law 7518, the production candidate being BiLira, whose final authorization we have not verified. Arf is regulated in Switzerland and lends to licensed institutions. Before mainnet we need a legal opinion; the README's regulatory section says so.

**What did you build during the hackathon?**
Paralyx on Solana existed before (Kamino, the rail interface, the app). During the track we built the Arf integration: `arf_line` with its tests, the rail drawing from and repaying it, the Arf card and receipts, and the devnet run. We also found and fixed a bug that broke partial lira repayments. The git history shows each step.

**How do you know it works?**
Twelve LiteSVM tests for `arf_line`, fourteen for `credit_line`, twenty-eight client tests, and a devnet run of every path with transaction links in the README, including two simultaneous settlements of one deposit where the second draw failed on chain.

**What does it cost a user?**
On devnet: the rail's 50 bps on each conversion, Kamino's borrow rate, and network fees. Arf's fee in the sandbox is a placeholder (10 bps per draw) paid by the operator, not the user; real pricing is Arf's.

**What is the next step?**
An audit of `arf_line`, a licensed operator with an Arf line and the BiLira rail wired, then mainnet against Kamino's Main Market, which the tests already run against.
