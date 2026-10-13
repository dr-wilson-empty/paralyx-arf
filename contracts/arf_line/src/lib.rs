use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

declare_id!("ARF4tQPAqQdGScZK7kF2yWK4tpkp99mPpEkr2rtdvAoC");

pub const LINE_SEED: &[u8] = b"line";
pub const VAULT_SEED: &[u8] = b"vault";
pub const DRAW_SEED: &[u8] = b"draw";
pub const MIN_TERM_SECONDS: i64 = 86_400;
pub const MAX_TERM_SECONDS: i64 = 5 * 86_400;
pub const MAX_FEE_BPS: u16 = 500;
pub const MAX_REFERENCE_LEN: usize = 32;
pub const STATE_VERSION: u8 = 1;

#[program]
pub mod arf_line {
    use super::*;

    pub fn create_line(ctx: Context<CreateLine>, limit: u64, term_seconds: i64, fee_bps: u16) -> Result<()> {
        check_terms(limit, term_seconds, fee_bps)?;
        let line = ctx.accounts.line.key();
        let provider = ctx.accounts.provider.key();
        let operator = ctx.accounts.operator.key();
        let mint = ctx.accounts.mint.key();
        ctx.accounts.line.set_inner(Line {
            provider,
            operator,
            mint,
            vault: ctx.accounts.vault.key(),
            limit,
            term_seconds,
            fee_bps,
            frozen: false,
            outstanding: 0,
            drawn: 0,
            fees: 0,
            repaid: 0,
            next_seq: 0,
            head_seq: 0,
            head_due_at: 0,
            bump: ctx.bumps.line,
            vault_bump: ctx.bumps.vault,
            version: STATE_VERSION,
            reserved: [0; 64],
        });
        emit_cpi!(LineCreated { line, provider, operator, mint, limit, term_seconds, fee_bps });
        Ok(())
    }

    pub fn fund(ctx: Context<Fund>, amount: u64) -> Result<()> {
        require!(amount > 0, ArfLineError::EmptyAmount);
        let accounts = &ctx.accounts;
        transfer(&accounts.token_program, accounts.source.to_account_info(), &accounts.mint, accounts.vault.to_account_info(), accounts.provider.to_account_info(), amount, &[])?;
        emit_cpi!(LineFunded { line: ctx.accounts.line.key(), amount });
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, ArfLineError::EmptyAmount);
        require!(ctx.accounts.vault.amount >= amount, ArfLineError::InsufficientLiquidity);
        let accounts = &ctx.accounts;
        let line = &accounts.line;
        let bump = [line.bump];
        let seeds: &[&[u8]] = &[LINE_SEED, line.provider.as_ref(), line.operator.as_ref(), line.mint.as_ref(), &bump];
        transfer(&accounts.token_program, accounts.vault.to_account_info(), &accounts.mint, accounts.destination.to_account_info(), line.to_account_info(), amount, &[seeds])?;
        emit_cpi!(LineWithdrawn { line: ctx.accounts.line.key(), amount });
        Ok(())
    }

    pub fn set_terms(ctx: Context<SetTerms>, limit: u64, term_seconds: i64, fee_bps: u16, frozen: bool) -> Result<()> {
        check_terms(limit, term_seconds, fee_bps)?;
        let key = ctx.accounts.line.key();
        let line = &mut ctx.accounts.line;
        require!(term_seconds == line.term_seconds || line.head_seq == line.next_seq, ArfLineError::OpenDraws);
        line.limit = limit;
        line.term_seconds = term_seconds;
        line.fee_bps = fee_bps;
        line.frozen = frozen;
        emit_cpi!(TermsSet { line: key, limit, term_seconds, fee_bps, frozen });
        Ok(())
    }

    pub fn draw(ctx: Context<DrawFunds>, reference: String, amount: u64) -> Result<()> {
        require!(amount > 0, ArfLineError::EmptyAmount);
        require!(!reference.is_empty() && reference.len() <= MAX_REFERENCE_LEN, ArfLineError::InvalidReference);
        let now = Clock::get()?.unix_timestamp;
        let accounts = &ctx.accounts;
        let line = &accounts.line;
        require!(!line.frozen, ArfLineError::Frozen);
        let first_open = line.head_seq == line.next_seq;
        require!(first_open || now <= line.head_due_at, ArfLineError::Overdue);
        let fee = fee_for(amount, line.fee_bps)?;
        let outstanding = amount.checked_add(fee).and_then(|owed| line.outstanding.checked_add(owed)).ok_or(ArfLineError::AmountOverflow)?;
        require!(outstanding <= line.limit, ArfLineError::LimitExceeded);
        require!(accounts.vault.amount >= amount, ArfLineError::InsufficientLiquidity);
        let due_at = now.checked_add(line.term_seconds).ok_or(ArfLineError::AmountOverflow)?;
        let seq = line.next_seq;
        let next_seq = seq.checked_add(1).ok_or(ArfLineError::AmountOverflow)?;
        let drawn = line.drawn.checked_add(amount).ok_or(ArfLineError::AmountOverflow)?;
        let fees = line.fees.checked_add(fee).ok_or(ArfLineError::AmountOverflow)?;
        let bump = [line.bump];
        let seeds: &[&[u8]] = &[LINE_SEED, line.provider.as_ref(), line.operator.as_ref(), line.mint.as_ref(), &bump];
        transfer(&accounts.token_program, accounts.vault.to_account_info(), &accounts.mint, accounts.destination.to_account_info(), line.to_account_info(), amount, &[seeds])?;

        let key = ctx.accounts.line.key();
        let destination = ctx.accounts.destination.key();
        let line = &mut ctx.accounts.line;
        if first_open {
            line.head_due_at = due_at;
        }
        line.next_seq = next_seq;
        line.outstanding = outstanding;
        line.drawn = drawn;
        line.fees = fees;
        ctx.accounts.draw.set_inner(Draw {
            line: key,
            seq,
            destination,
            amount,
            fee,
            repaid: 0,
            drawn_at: now,
            due_at,
            bump: ctx.bumps.draw,
            version: STATE_VERSION,
            reserved: [0; 32],
            reference: reference.clone(),
        });
        emit_cpi!(Drawn { line: key, draw: ctx.accounts.draw.key(), seq, reference, destination, amount, fee, due_at });
        Ok(())
    }

    pub fn repay(ctx: Context<Repay>, amount: u64) -> Result<()> {
        require!(amount > 0, ArfLineError::EmptyAmount);
        let key = ctx.accounts.line.key();
        let first = ctx.accounts.line.head_seq;
        let open_until = ctx.accounts.line.next_seq;
        let mut head = first;
        let mut head_due_at = None;
        let mut left = amount;
        let mut applied = 0u64;
        let mut paid = Vec::new();
        for (index, info) in ctx.remaining_accounts.iter().enumerate() {
            let mut draw = read_draw(info)?;
            require_keys_eq!(draw.line, key, ArfLineError::WrongLine);
            require!(draw.seq == first.saturating_add(index as u64), ArfLineError::DrawOutOfOrder);
            if left == 0 {
                head_due_at = Some(draw.due_at);
                break;
            }
            let pay = owed(&draw).min(left);
            draw.repaid = draw.repaid.checked_add(pay).ok_or(ArfLineError::AmountOverflow)?;
            write_draw(info, &draw)?;
            left -= pay;
            applied += pay;
            paid.push(Repaid { line: key, draw: *info.key, seq: draw.seq, amount: pay, owed: owed(&draw) });
            if owed(&draw) > 0 {
                head_due_at = Some(draw.due_at);
                break;
            }
            head += 1;
        }
        require!(applied > 0, ArfLineError::NothingToRepay);
        require!(head == open_until || head_due_at.is_some(), ArfLineError::MissingHead);
        let accounts = &ctx.accounts;
        transfer(&accounts.token_program, accounts.source.to_account_info(), &accounts.mint, accounts.vault.to_account_info(), accounts.payer.to_account_info(), applied, &[])?;

        let line = &mut ctx.accounts.line;
        line.head_seq = head;
        line.head_due_at = if head == open_until { 0 } else { head_due_at.unwrap_or(0) };
        line.outstanding = line.outstanding.checked_sub(applied).ok_or(ArfLineError::AmountOverflow)?;
        line.repaid = line.repaid.checked_add(applied).ok_or(ArfLineError::AmountOverflow)?;
        for event in paid {
            emit_cpi!(event);
        }
        Ok(())
    }
}

pub fn fee_for(amount: u64, fee_bps: u16) -> Result<u64> {
    let fee = (u128::from(amount) * u128::from(fee_bps)).div_ceil(10_000);
    u64::try_from(fee).map_err(|_| error!(ArfLineError::AmountOverflow))
}

pub fn owed(draw: &Draw) -> u64 {
    draw.amount.saturating_add(draw.fee).saturating_sub(draw.repaid)
}

fn check_terms(limit: u64, term_seconds: i64, fee_bps: u16) -> Result<()> {
    require!(limit > 0, ArfLineError::InvalidLimit);
    require!((MIN_TERM_SECONDS..=MAX_TERM_SECONDS).contains(&term_seconds), ArfLineError::InvalidTerm);
    require!(fee_bps <= MAX_FEE_BPS, ArfLineError::InvalidFee);
    Ok(())
}

fn transfer<'info>(token_program: &Interface<'info, TokenInterface>, from: AccountInfo<'info>, mint: &InterfaceAccount<'info, Mint>, to: AccountInfo<'info>, authority: AccountInfo<'info>, amount: u64, signer: &[&[&[u8]]]) -> Result<()> {
    let accounts = TransferChecked { from, mint: mint.to_account_info(), to, authority };
    token_interface::transfer_checked(CpiContext::new_with_signer(token_program.key(), accounts, signer), amount, mint.decimals)
}

fn read_draw(info: &AccountInfo) -> Result<Draw> {
    require_keys_eq!(*info.owner, crate::ID, ArfLineError::NotADraw);
    let data = info.try_borrow_data()?;
    Draw::try_deserialize(&mut &data[..])
}

fn write_draw(info: &AccountInfo, draw: &Draw) -> Result<()> {
    let mut data = info.try_borrow_mut_data()?;
    let mut writer: &mut [u8] = &mut data;
    draw.try_serialize(&mut writer)
}

#[account]
#[derive(InitSpace)]
pub struct Line {
    pub provider: Pubkey,
    pub operator: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub limit: u64,
    pub term_seconds: i64,
    pub fee_bps: u16,
    pub frozen: bool,
    pub outstanding: u64,
    pub drawn: u64,
    pub fees: u64,
    pub repaid: u64,
    pub next_seq: u64,
    pub head_seq: u64,
    pub head_due_at: i64,
    pub bump: u8,
    pub vault_bump: u8,
    pub version: u8,
    pub reserved: [u8; 64],
}

#[account]
#[derive(InitSpace)]
pub struct Draw {
    pub line: Pubkey,
    pub seq: u64,
    pub destination: Pubkey,
    pub amount: u64,
    pub fee: u64,
    pub repaid: u64,
    pub drawn_at: i64,
    pub due_at: i64,
    pub bump: u8,
    pub version: u8,
    pub reserved: [u8; 32],
    #[max_len(32)]
    pub reference: String,
}

#[event]
pub struct LineCreated {
    pub line: Pubkey,
    pub provider: Pubkey,
    pub operator: Pubkey,
    pub mint: Pubkey,
    pub limit: u64,
    pub term_seconds: i64,
    pub fee_bps: u16,
}

#[event]
pub struct LineFunded {
    pub line: Pubkey,
    pub amount: u64,
}

#[event]
pub struct LineWithdrawn {
    pub line: Pubkey,
    pub amount: u64,
}

#[event]
pub struct TermsSet {
    pub line: Pubkey,
    pub limit: u64,
    pub term_seconds: i64,
    pub fee_bps: u16,
    pub frozen: bool,
}

#[event]
pub struct Drawn {
    pub line: Pubkey,
    pub draw: Pubkey,
    pub seq: u64,
    pub reference: String,
    pub destination: Pubkey,
    pub amount: u64,
    pub fee: u64,
    pub due_at: i64,
}

#[event]
pub struct Repaid {
    pub line: Pubkey,
    pub draw: Pubkey,
    pub seq: u64,
    pub amount: u64,
    pub owed: u64,
}

#[error_code(offset = 7100)]
pub enum ArfLineError {
    #[msg("Amount must be above zero")]
    EmptyAmount,
    #[msg("Reference must be 1 to 32 bytes")]
    InvalidReference,
    #[msg("Limit must be above zero")]
    InvalidLimit,
    #[msg("Term must be one to five days")]
    InvalidTerm,
    #[msg("Fee must be at most 500 bps")]
    InvalidFee,
    #[msg("The provider froze the line")]
    Frozen,
    #[msg("The oldest open draw is past its due date")]
    Overdue,
    #[msg("The draw would take the outstanding amount past the limit")]
    LimitExceeded,
    #[msg("The vault holds less than the amount")]
    InsufficientLiquidity,
    #[msg("No open draw was passed or the amount covers none")]
    NothingToRepay,
    #[msg("Draws must be passed from the oldest open one, in order")]
    DrawOutOfOrder,
    #[msg("Draws stay open after the repayment: pass the next open draw as well")]
    MissingHead,
    #[msg("Account is not a draw of this program")]
    NotADraw,
    #[msg("Draw belongs to another line")]
    WrongLine,
    #[msg("The term can change only while no draw is open")]
    OpenDraws,
    #[msg("Signer is not the line's provider")]
    NotProvider,
    #[msg("Signer is not the line's operator")]
    NotOperator,
    #[msg("Amount overflow")]
    AmountOverflow,
}

#[event_cpi]
#[derive(Accounts)]
pub struct CreateLine<'info> {
    #[account(mut)]
    pub provider: Signer<'info>,
    pub operator: UncheckedAccount<'info>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(init, payer = provider, space = 8 + Line::INIT_SPACE, seeds = [LINE_SEED, provider.key().as_ref(), operator.key().as_ref(), mint.key().as_ref()], bump)]
    pub line: Box<Account<'info, Line>>,
    #[account(init, payer = provider, seeds = [VAULT_SEED, line.key().as_ref()], bump, token::mint = mint, token::authority = line, token::token_program = token_program)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct Fund<'info> {
    pub provider: Signer<'info>,
    #[account(has_one = provider @ ArfLineError::NotProvider, has_one = mint, has_one = vault)]
    pub line: Box<Account<'info, Line>>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = provider)]
    pub source: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub provider: Signer<'info>,
    #[account(has_one = provider @ ArfLineError::NotProvider, has_one = mint, has_one = vault)]
    pub line: Box<Account<'info, Line>>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = mint)]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct SetTerms<'info> {
    pub provider: Signer<'info>,
    #[account(mut, has_one = provider @ ArfLineError::NotProvider)]
    pub line: Box<Account<'info, Line>>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(reference: String)]
pub struct DrawFunds<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,
    #[account(mut, has_one = operator @ ArfLineError::NotOperator, has_one = mint, has_one = vault)]
    pub line: Box<Account<'info, Line>>,
    #[account(init, payer = operator, space = 8 + Draw::INIT_SPACE, seeds = [DRAW_SEED, line.key().as_ref(), reference.as_bytes()], bump)]
    pub draw: Box<Account<'info, Draw>>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = mint)]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct Repay<'info> {
    pub payer: Signer<'info>,
    #[account(mut, has_one = mint, has_one = vault)]
    pub line: Box<Account<'info, Line>>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = payer)]
    pub source: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}
