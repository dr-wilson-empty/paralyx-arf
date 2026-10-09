use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

pub mod kamino;

use kamino::{Kamino, Side};

declare_id!("PLXama5SomfMXpUzgwAVhDXMJrESMX8JP93RGRyG6qr");

pub const CONFIG_SEED: &[u8] = b"config";
pub const LINE_SEED: &[u8] = b"line";
pub const MAX_REFERENCE_LEN: usize = 64;
pub const INSTRUCTIONS_SYSVAR: Pubkey = pubkey!("Sysvar1nstructions1111111111111111111111111");

#[program]
pub mod credit_line {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let klend = ctx.accounts.klend_program.key();
        let market = ctx.accounts.lending_market.key();
        kamino::check_market_account(&ctx.accounts.lending_market, &klend)?;
        kamino::check_reserve_account(&ctx.accounts.collateral_reserve, &klend, &market)?;
        kamino::check_reserve_account(&ctx.accounts.debt_reserve, &klend, &market)?;
        require_keys_neq!(ctx.accounts.collateral_reserve.key(), ctx.accounts.debt_reserve.key(), ParalyxError::ReserveMismatch);
        ctx.accounts.config.set_inner(Config {
            admin: ctx.accounts.admin.key(),
            klend_program: klend,
            lending_market: market,
            collateral_reserve: ctx.accounts.collateral_reserve.key(),
            debt_reserve: ctx.accounts.debt_reserve.key(),
            line_count: 0,
            bump: ctx.bumps.config,
        });
        Ok(())
    }

    pub fn open_line(ctx: Context<OpenLine>, collateral_amount: u64, borrow_amount: u64) -> Result<()> {
        require!(collateral_amount > 0 || borrow_amount > 0, ParalyxError::EmptyRequest);
        let accounts = &ctx.accounts;
        let k = accounts.kamino();
        kamino::check_obligation(&k)?;
        let collateral = accounts.collateral_side();
        let debt = accounts.debt_side();
        let ctoken_mint = accounts.collateral_ctoken_mint.to_account_info();
        let ctoken_supply = accounts.collateral_ctoken_supply.to_account_info();
        let fee_receiver = accounts.debt_fee_receiver.to_account_info();

        let mut deposited = 0u64;
        if collateral_amount > 0 {
            kamino::refresh(&k, &collateral, &debt)?;
            let before = kamino::token_amount(&collateral.user_token)?;
            kamino::deposit(&k, &collateral, &ctoken_mint, &ctoken_supply, collateral_amount)?;
            deposited = before.saturating_sub(kamino::token_amount(&collateral.user_token)?);
        }
        let mut received = 0u64;
        if borrow_amount > 0 {
            let deposit_reserves = kamino::refresh(&k, &collateral, &debt)?;
            let before = kamino::token_amount(&debt.user_token)?;
            kamino::borrow(&k, &debt, &fee_receiver, &deposit_reserves, borrow_amount)?;
            received = kamino::token_amount(&debt.user_token)?.saturating_sub(before);
        }

        let now = Clock::get()?.unix_timestamp;
        let user = ctx.accounts.user.key();
        let line = &mut ctx.accounts.line;
        if line.opened_at == 0 {
            line.user = user;
            line.opened_at = now;
            line.bump = ctx.bumps.line;
            let config = &mut ctx.accounts.config;
            config.line_count = config.line_count.checked_add(1).ok_or(ParalyxError::AmountOverflow)?;
        }
        line.updated_at = now;
        line.collateral_in = line.collateral_in.checked_add(deposited).ok_or(ParalyxError::AmountOverflow)?;
        line.borrowed = line.borrowed.checked_add(received).ok_or(ParalyxError::AmountOverflow)?;
        emit_cpi!(LineOpened { user, collateral_amount: deposited, borrow_amount: received });
        Ok(())
    }

    pub fn repay_line(ctx: Context<RepayLine>, repay_amount: u64, withdraw_collateral: u64) -> Result<()> {
        require!(repay_amount > 0 || withdraw_collateral > 0, ParalyxError::EmptyRequest);
        let mut line = read_line(&ctx.accounts.line)?;
        let accounts = &ctx.accounts;
        let k = accounts.kamino();
        kamino::check_obligation(&k)?;
        let collateral = accounts.collateral_side();
        let debt = accounts.debt_side();
        let ctoken_mint = accounts.collateral_ctoken_mint.to_account_info();
        let ctoken_supply = accounts.collateral_ctoken_supply.to_account_info();

        let mut repaid = 0u64;
        if repay_amount > 0 {
            let deposit_reserves = kamino::refresh(&k, &collateral, &debt)?;
            let before = kamino::token_amount(&debt.user_token)?;
            kamino::repay(&k, &debt, &deposit_reserves, repay_amount)?;
            repaid = before.saturating_sub(kamino::token_amount(&debt.user_token)?);
        }
        let mut withdrawn = 0u64;
        if withdraw_collateral > 0 {
            kamino::refresh(&k, &collateral, &debt)?;
            let before = kamino::token_amount(&collateral.user_token)?;
            kamino::withdraw(&k, &collateral, &ctoken_mint, &ctoken_supply, withdraw_collateral)?;
            withdrawn = kamino::token_amount(&collateral.user_token)?.saturating_sub(before);
        }

        line.updated_at = Clock::get()?.unix_timestamp;
        line.repaid = line.repaid.checked_add(repaid).ok_or(ParalyxError::AmountOverflow)?;
        line.collateral_out = line.collateral_out.checked_add(withdrawn).ok_or(ParalyxError::AmountOverflow)?;
        write_line(&ctx.accounts.line, &line)?;
        let user = ctx.accounts.user.key();
        emit_cpi!(LineRepaid { user, repay_amount: repaid, withdraw_collateral: withdrawn });
        Ok(())
    }

    pub fn record_payout(ctx: Context<RecordPayout>, rail_tx_id: String, try_amount: u64) -> Result<()> {
        require!(!rail_tx_id.is_empty() && rail_tx_id.len() <= MAX_REFERENCE_LEN, ParalyxError::InvalidReference);
        let mut line = read_line(&ctx.accounts.line)?;
        line.updated_at = Clock::get()?.unix_timestamp;
        line.payouts = line.payouts.checked_add(1).ok_or(ParalyxError::AmountOverflow)?;
        line.payout_try = line.payout_try.checked_add(try_amount).ok_or(ParalyxError::AmountOverflow)?;
        write_line(&ctx.accounts.line, &line)?;
        let user = ctx.accounts.user.key();
        emit_cpi!(PayoutRecorded { user, rail_tx_id, try_amount });
        Ok(())
    }
}

fn read_line(info: &AccountInfo) -> Result<Line> {
    if info.owner != &crate::ID || info.data_is_empty() {
        return err!(ParalyxError::LineNotFound);
    }
    let data = info.try_borrow_data()?;
    Line::try_deserialize(&mut &data[..])
}

fn write_line(info: &AccountInfo, line: &Line) -> Result<()> {
    let mut data = info.try_borrow_mut_data()?;
    let mut writer: &mut [u8] = &mut data;
    line.try_serialize(&mut writer)
}

fn some<'info>(account: &Option<UncheckedAccount<'info>>) -> Option<AccountInfo<'info>> {
    account.as_ref().map(|inner| inner.to_account_info())
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub klend_program: Pubkey,
    pub lending_market: Pubkey,
    pub collateral_reserve: Pubkey,
    pub debt_reserve: Pubkey,
    pub line_count: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Line {
    pub user: Pubkey,
    pub opened_at: i64,
    pub updated_at: i64,
    pub collateral_in: u64,
    pub collateral_out: u64,
    pub borrowed: u64,
    pub repaid: u64,
    pub payouts: u32,
    pub payout_try: u64,
    pub bump: u8,
}

#[event]
pub struct LineOpened {
    pub user: Pubkey,
    pub collateral_amount: u64,
    pub borrow_amount: u64,
}

#[event]
pub struct LineRepaid {
    pub user: Pubkey,
    pub repay_amount: u64,
    pub withdraw_collateral: u64,
}

#[event]
pub struct PayoutRecorded {
    pub user: Pubkey,
    pub rail_tx_id: String,
    pub try_amount: u64,
}

#[error_code]
pub enum ParalyxError {
    #[msg("Both amounts are zero")]
    EmptyRequest,
    #[msg("No credit line for this user")]
    LineNotFound,
    #[msg("Account is not the configured Kamino program or lending market")]
    MarketMismatch,
    #[msg("Reserve is not the configured collateral or debt reserve")]
    ReserveMismatch,
    #[msg("Obligation is not the user's vanilla Kamino obligation in the configured market")]
    ObligationMismatch,
    #[msg("Obligation uses a reserve outside the configured pair or carries a referrer")]
    UnsupportedObligation,
    #[msg("Payout reference must be 1 to 64 bytes")]
    InvalidReference,
    #[msg("Signer is not the program upgrade authority")]
    NotUpgradeAuthority,
    #[msg("Amount overflow")]
    AmountOverflow,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ ParalyxError::NotUpgradeAuthority)]
    pub program: Program<'info, crate::program::CreditLine>,
    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()) @ ParalyxError::NotUpgradeAuthority)]
    pub program_data: Account<'info, ProgramData>,
    #[account(executable)]
    pub klend_program: UncheckedAccount<'info>,
    pub lending_market: UncheckedAccount<'info>,
    pub collateral_reserve: UncheckedAccount<'info>,
    pub debt_reserve: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct OpenLine<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(init_if_needed, payer = user, space = 8 + Line::INIT_SPACE, seeds = [LINE_SEED, user.key().as_ref()], bump)]
    pub line: Box<Account<'info, Line>>,
    #[account(address = config.klend_program @ ParalyxError::MarketMismatch)]
    pub klend_program: UncheckedAccount<'info>,
    #[account(address = config.lending_market @ ParalyxError::MarketMismatch)]
    pub lending_market: UncheckedAccount<'info>,
    pub lending_market_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub obligation: UncheckedAccount<'info>,
    #[account(mut, address = config.collateral_reserve @ ParalyxError::ReserveMismatch)]
    pub collateral_reserve: UncheckedAccount<'info>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub collateral_supply: UncheckedAccount<'info>,
    #[account(mut)]
    pub collateral_ctoken_mint: UncheckedAccount<'info>,
    #[account(mut)]
    pub collateral_ctoken_supply: UncheckedAccount<'info>,
    #[account(mut, token::mint = collateral_mint, token::authority = user)]
    pub user_collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = config.debt_reserve @ ParalyxError::ReserveMismatch)]
    pub debt_reserve: UncheckedAccount<'info>,
    pub debt_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub debt_supply: UncheckedAccount<'info>,
    #[account(mut)]
    pub debt_fee_receiver: UncheckedAccount<'info>,
    #[account(mut, token::mint = debt_mint, token::authority = user)]
    pub user_debt: Box<InterfaceAccount<'info, TokenAccount>>,
    pub collateral_pyth: Option<UncheckedAccount<'info>>,
    pub collateral_switchboard_price: Option<UncheckedAccount<'info>>,
    pub collateral_switchboard_twap: Option<UncheckedAccount<'info>>,
    pub collateral_scope: Option<UncheckedAccount<'info>>,
    pub debt_pyth: Option<UncheckedAccount<'info>>,
    pub debt_switchboard_price: Option<UncheckedAccount<'info>>,
    pub debt_switchboard_twap: Option<UncheckedAccount<'info>>,
    pub debt_scope: Option<UncheckedAccount<'info>>,
    #[account(mut)]
    pub collateral_farm_state: Option<UncheckedAccount<'info>>,
    #[account(mut)]
    pub collateral_farm_user: Option<UncheckedAccount<'info>>,
    #[account(mut)]
    pub debt_farm_state: Option<UncheckedAccount<'info>>,
    #[account(mut)]
    pub debt_farm_user: Option<UncheckedAccount<'info>>,
    pub farms_program: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    #[account(address = INSTRUCTIONS_SYSVAR)]
    pub instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct RepayLine<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [LINE_SEED, user.key().as_ref()], bump)]
    pub line: UncheckedAccount<'info>,
    #[account(address = config.klend_program @ ParalyxError::MarketMismatch)]
    pub klend_program: UncheckedAccount<'info>,
    #[account(address = config.lending_market @ ParalyxError::MarketMismatch)]
    pub lending_market: UncheckedAccount<'info>,
    pub lending_market_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub obligation: UncheckedAccount<'info>,
    #[account(mut, address = config.collateral_reserve @ ParalyxError::ReserveMismatch)]
    pub collateral_reserve: UncheckedAccount<'info>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub collateral_supply: UncheckedAccount<'info>,
    #[account(mut)]
    pub collateral_ctoken_mint: UncheckedAccount<'info>,
    #[account(mut)]
    pub collateral_ctoken_supply: UncheckedAccount<'info>,
    #[account(mut, token::mint = collateral_mint, token::authority = user)]
    pub user_collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = config.debt_reserve @ ParalyxError::ReserveMismatch)]
    pub debt_reserve: UncheckedAccount<'info>,
    pub debt_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub debt_supply: UncheckedAccount<'info>,
    #[account(mut, token::mint = debt_mint, token::authority = user)]
    pub user_debt: Box<InterfaceAccount<'info, TokenAccount>>,
    pub collateral_pyth: Option<UncheckedAccount<'info>>,
    pub collateral_switchboard_price: Option<UncheckedAccount<'info>>,
    pub collateral_switchboard_twap: Option<UncheckedAccount<'info>>,
    pub collateral_scope: Option<UncheckedAccount<'info>>,
    pub debt_pyth: Option<UncheckedAccount<'info>>,
    pub debt_switchboard_price: Option<UncheckedAccount<'info>>,
    pub debt_switchboard_twap: Option<UncheckedAccount<'info>>,
    pub debt_scope: Option<UncheckedAccount<'info>>,
    #[account(mut)]
    pub collateral_farm_state: Option<UncheckedAccount<'info>>,
    #[account(mut)]
    pub collateral_farm_user: Option<UncheckedAccount<'info>>,
    #[account(mut)]
    pub debt_farm_state: Option<UncheckedAccount<'info>>,
    #[account(mut)]
    pub debt_farm_user: Option<UncheckedAccount<'info>>,
    pub farms_program: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    #[account(address = INSTRUCTIONS_SYSVAR)]
    pub instructions: UncheckedAccount<'info>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct RecordPayout<'info> {
    pub user: Signer<'info>,
    #[account(mut, seeds = [LINE_SEED, user.key().as_ref()], bump)]
    pub line: UncheckedAccount<'info>,
}

impl<'info> OpenLine<'info> {
    fn kamino(&self) -> Kamino<'info> {
        Kamino {
            program: self.klend_program.to_account_info(),
            market: self.lending_market.to_account_info(),
            authority: self.lending_market_authority.to_account_info(),
            obligation: self.obligation.to_account_info(),
            owner: self.user.to_account_info(),
            token_program: self.token_program.to_account_info(),
            instructions: self.instructions.to_account_info(),
            farms_program: self.farms_program.to_account_info(),
        }
    }

    fn collateral_side(&self) -> Side<'info> {
        Side {
            reserve: self.collateral_reserve.to_account_info(),
            mint: self.collateral_mint.to_account_info(),
            supply: self.collateral_supply.to_account_info(),
            user_token: self.user_collateral.to_account_info(),
            oracles: [some(&self.collateral_pyth), some(&self.collateral_switchboard_price), some(&self.collateral_switchboard_twap), some(&self.collateral_scope)],
            farm_state: some(&self.collateral_farm_state),
            farm_user: some(&self.collateral_farm_user),
        }
    }

    fn debt_side(&self) -> Side<'info> {
        Side {
            reserve: self.debt_reserve.to_account_info(),
            mint: self.debt_mint.to_account_info(),
            supply: self.debt_supply.to_account_info(),
            user_token: self.user_debt.to_account_info(),
            oracles: [some(&self.debt_pyth), some(&self.debt_switchboard_price), some(&self.debt_switchboard_twap), some(&self.debt_scope)],
            farm_state: some(&self.debt_farm_state),
            farm_user: some(&self.debt_farm_user),
        }
    }
}

impl<'info> RepayLine<'info> {
    fn kamino(&self) -> Kamino<'info> {
        Kamino {
            program: self.klend_program.to_account_info(),
            market: self.lending_market.to_account_info(),
            authority: self.lending_market_authority.to_account_info(),
            obligation: self.obligation.to_account_info(),
            owner: self.user.to_account_info(),
            token_program: self.token_program.to_account_info(),
            instructions: self.instructions.to_account_info(),
            farms_program: self.farms_program.to_account_info(),
        }
    }

    fn collateral_side(&self) -> Side<'info> {
        Side {
            reserve: self.collateral_reserve.to_account_info(),
            mint: self.collateral_mint.to_account_info(),
            supply: self.collateral_supply.to_account_info(),
            user_token: self.user_collateral.to_account_info(),
            oracles: [some(&self.collateral_pyth), some(&self.collateral_switchboard_price), some(&self.collateral_switchboard_twap), some(&self.collateral_scope)],
            farm_state: some(&self.collateral_farm_state),
            farm_user: some(&self.collateral_farm_user),
        }
    }

    fn debt_side(&self) -> Side<'info> {
        Side {
            reserve: self.debt_reserve.to_account_info(),
            mint: self.debt_mint.to_account_info(),
            supply: self.debt_supply.to_account_info(),
            user_token: self.user_debt.to_account_info(),
            oracles: [some(&self.debt_pyth), some(&self.debt_switchboard_price), some(&self.debt_switchboard_twap), some(&self.debt_scope)],
            farm_state: some(&self.debt_farm_state),
            farm_user: some(&self.debt_farm_user),
        }
    }
}
