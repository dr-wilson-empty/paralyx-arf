# Deploying the app with the Arf line

The app is a Vite build with one server function, `web/api/rail.ts`, which runs on Vercel or, through `web/netlify/functions/rail.mts`, on Netlify. These steps put it on either against the devnet line from the README's proof run.

## Keys

The proof run's keys are in `.keys/`, which git ignores. Keep a copy somewhere safe: without them the line cannot be funded and the program cannot be upgraded.

| File | Role |
|---|---|
| `.keys/treasury-local.json` | The rail treasury and the line's operator. Its secret is the rail's `SANDBOX_TREASURY_SECRET` |
| `.keys/arf-local.json` | Arf's stand-in, the line's provider: funds, withdraws, sets terms |
| `.keys/arf_line-program.json` | The `arf_line` program keypair, needed to deploy again at `ARF4…vAoC` |
| `~/.config/solana/id.json` | The deployer, which holds `arf_line`'s upgrade authority on devnet |

A different treasury key needs a new line, because a line's operator is fixed: `node scripts/arf.mjs create .keys/arf-local.json <new treasury address> 500 3 10`.

## Vercel

1. Log in and link the project, with `web` as the root directory:

   ```bash
   cd web
   vercel login
   vercel link
   ```

2. Add the server environment for Production (each command asks for the value):

   ```bash
   vercel env add SANDBOX_TREASURY_SECRET production
   vercel env add ARF_LINE production
   vercel env add RAIL_RPC production
   ```

   - `SANDBOX_TREASURY_SECRET`: the JSON array in `.keys/treasury-local.json`.
   - `ARF_LINE`: `7zLBPHXSMZ8xY2ep9CBX65zWVh1UERZK3J1yHvWwSTer`.
   - `RAIL_RPC`: a devnet RPC endpoint of your own (Helius, Triton, QuickNode). The public endpoint rate-limits the rail as soon as a few browsers poll it.
   - `PYTH_API_KEY` is optional; without it USD/TRY comes from Reflector and SOL history is empty.
   - Never set `VITE_BURNER_WALLET` on a public build.

3. Deploy:

   ```bash
   vercel --prod
   ```

4. Check it:

   ```bash
   curl https://<your domain>/api/rail?action=arf
   ```

   It should answer `"enabled": true` with the line, the vault balance and the draws. Then open `/exchange` and look for the Arf liquidity line card.

## Netlify

`netlify.toml` at the repository root sets everything the build needs: base `web`, `npm run build`, publish `dist`, Node 22, and the rail as the function `web/netlify/functions/rail.mts`, which `/api/rail` rewrites to before the single-page fallback.

1. Add a new project, import `dr-wilson-empty/paralyx-arf` from Git, and leave the build settings as `netlify.toml` gives them.

2. In Project configuration > Environment variables, add these with the **Functions** scope. Variables in `netlify.toml` do not reach functions.

   - `SANDBOX_TREASURY_SECRET`: the JSON array in `.keys/treasury-local.json`; mark it as containing secret values.
   - `ARF_LINE`: `7zLBPHXSMZ8xY2ep9CBX65zWVh1UERZK3J1yHvWwSTer`.
   - `RAIL_RPC`: a devnet RPC endpoint of your own, as on Vercel.
   - `PYTH_API_KEY` is optional. Never set `VITE_BURNER_WALLET`.

3. Deploy, or trigger a new deploy after changing a variable; values are fixed per deploy.

4. Check it the same way: `curl https://<your site>.netlify.app/api/rail?action=arf` answers `"enabled": true`.

## Keeping it working

- `node scripts/arf.mjs show 7zLBPHXSMZ8xY2ep9CBX65zWVh1UERZK3J1yHvWwSTer` shows the vault, open draws and whether the line is frozen.
- Top up the vault before a demo: `node scripts/arf.mjs fund .keys/arf-local.json 7zLBPHXSMZ8xY2ep9CBX65zWVh1UERZK3J1yHvWwSTer 3`. Arf's stand-in needs devnet USDC in its own account; borrowing from the devnet Kamino market with `scripts/open-line.mjs` is how the proof run got some.
- Keep at least 0.05 SOL on the treasury: it pays fees and each draw account's rent (about 0.0022 SOL).
- Open draws past their due date stop new draws. A cash-out repays them, or `curl -X POST https://<your domain>/api/rail?action=arf-sweep` when the treasury holds USDC.
- `vercel.json` redirects only the upstream host `paralyx-solana.vercel.app`; it does not affect a new project.
