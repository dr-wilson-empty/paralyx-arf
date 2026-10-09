use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke;

use crate::ParalyxError;

const REFRESH_RESERVE: [u8; 8] = [2, 218, 138, 235, 79, 201, 25, 102];
const REFRESH_OBLIGATION: [u8; 8] = [33, 132, 147, 228, 151, 192, 72, 89];
const DEPOSIT_AND_COLLATERALIZE_V2: [u8; 8] = [216, 224, 191, 27, 204, 151, 102, 175];
const BORROW_V2: [u8; 8] = [161, 128, 143, 245, 171, 199, 194, 6];
const REPAY_V2: [u8; 8] = [116, 174, 213, 76, 180, 53, 210, 144];
const WITHDRAW_AND_REDEEM_V2: [u8; 8] = [235, 52, 119, 152, 149, 197, 20, 7];

pub const OBLIGATION_DISCRIMINATOR: [u8; 8] = [168, 206, 141, 106, 88, 76, 172, 167];
pub const RESERVE_DISCRIMINATOR: [u8; 8] = [43, 242, 204, 202, 26, 247, 59, 127];
pub const LENDING_MARKET_DISCRIMINATOR: [u8; 8] = [246, 114, 50, 98, 72, 157, 28, 120];

const OBLIGATION_LEN: usize = 8 + 3336;
const OBLIGATION_MARKET: usize = 32;
const OBLIGATION_OWNER: usize = 64;
const OBLIGATION_DEPOSITS: usize = 96;
const OBLIGATION_DEPOSIT_STRIDE: usize = 136;
const OBLIGATION_DEPOSIT_SLOTS: usize = 8;
const OBLIGATION_BORROWS: usize = 1208;
const OBLIGATION_BORROW_STRIDE: usize = 200;
const OBLIGATION_BORROW_SLOTS: usize = 5;
const OBLIGATION_REFERRER: usize = 2288;
const RESERVE_MARKET: usize = 32;
const TOKEN_AMOUNT: usize = 64;

pub struct Kamino<'info> {
    pub program: AccountInfo<'info>,
    pub market: AccountInfo<'info>,
    pub authority: AccountInfo<'info>,
    pub obligation: AccountInfo<'info>,
    pub owner: AccountInfo<'info>,
    pub token_program: AccountInfo<'info>,
    pub instructions: AccountInfo<'info>,
    pub farms_program: AccountInfo<'info>,
}

pub struct Side<'info> {
    pub reserve: AccountInfo<'info>,
    pub mint: AccountInfo<'info>,
    pub supply: AccountInfo<'info>,
    pub user_token: AccountInfo<'info>,
    pub oracles: [Option<AccountInfo<'info>>; 4],
    pub farm_state: Option<AccountInfo<'info>>,
    pub farm_user: Option<AccountInfo<'info>>,
}

pub fn token_amount(account: &AccountInfo) -> Result<u64> {
    let data = account.try_borrow_data()?;
    let bytes: [u8; 8] = data
        .get(TOKEN_AMOUNT..TOKEN_AMOUNT + 8)
        .ok_or(ParalyxError::AmountOverflow)?
        .try_into()
        .map_err(|_| ParalyxError::AmountOverflow)?;
    Ok(u64::from_le_bytes(bytes))
}

fn read_key(data: &[u8], offset: usize) -> Pubkey {
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(&data[offset..offset + 32]);
    Pubkey::new_from_array(bytes)
}

pub fn vanilla_obligation(klend: &Pubkey, market: &Pubkey, owner: &Pubkey) -> Pubkey {
    let default = Pubkey::default();
    Pubkey::find_program_address(
        &[&[0], &[0], owner.as_ref(), market.as_ref(), default.as_ref(), default.as_ref()],
        klend,
    )
    .0
}

pub fn check_market_account(account: &AccountInfo, klend: &Pubkey) -> Result<()> {
    let data = account.try_borrow_data()?;
    require_keys_eq!(*account.owner, *klend, ParalyxError::MarketMismatch);
    require!(data.len() >= 8 && data[..8] == LENDING_MARKET_DISCRIMINATOR, ParalyxError::MarketMismatch);
    Ok(())
}

pub fn check_reserve_account(account: &AccountInfo, klend: &Pubkey, market: &Pubkey) -> Result<()> {
    let data = account.try_borrow_data()?;
    require_keys_eq!(*account.owner, *klend, ParalyxError::ReserveMismatch);
    require!(data.len() >= RESERVE_MARKET + 32 && data[..8] == RESERVE_DISCRIMINATOR, ParalyxError::ReserveMismatch);
    require_keys_eq!(read_key(&data, RESERVE_MARKET), *market, ParalyxError::ReserveMismatch);
    Ok(())
}

pub fn check_obligation(k: &Kamino) -> Result<()> {
    require_keys_eq!(
        k.obligation.key(),
        vanilla_obligation(k.program.key, k.market.key, k.owner.key),
        ParalyxError::ObligationMismatch
    );
    require_keys_eq!(*k.obligation.owner, k.program.key(), ParalyxError::ObligationMismatch);
    let data = k.obligation.try_borrow_data()?;
    require!(data.len() >= OBLIGATION_LEN && data[..8] == OBLIGATION_DISCRIMINATOR, ParalyxError::ObligationMismatch);
    require_keys_eq!(read_key(&data, OBLIGATION_MARKET), k.market.key(), ParalyxError::ObligationMismatch);
    require_keys_eq!(read_key(&data, OBLIGATION_OWNER), k.owner.key(), ParalyxError::ObligationMismatch);
    require_keys_eq!(read_key(&data, OBLIGATION_REFERRER), Pubkey::default(), ParalyxError::UnsupportedObligation);
    Ok(())
}

fn obligation_reserves(obligation: &AccountInfo) -> Result<(Vec<Pubkey>, Vec<Pubkey>)> {
    let data = obligation.try_borrow_data()?;
    let active = |offset: usize| {
        let key = read_key(&data, offset);
        (key != Pubkey::default()).then_some(key)
    };
    let deposits = (0..OBLIGATION_DEPOSIT_SLOTS)
        .filter_map(|slot| active(OBLIGATION_DEPOSITS + slot * OBLIGATION_DEPOSIT_STRIDE))
        .collect();
    let borrows = (0..OBLIGATION_BORROW_SLOTS)
        .filter_map(|slot| active(OBLIGATION_BORROWS + slot * OBLIGATION_BORROW_STRIDE))
        .collect();
    Ok((deposits, borrows))
}

fn pick<'info>(key: &Pubkey, collateral: &Side<'info>, debt: &Side<'info>) -> Result<AccountInfo<'info>> {
    if *key == collateral.reserve.key() {
        Ok(collateral.reserve.clone())
    } else if *key == debt.reserve.key() {
        Ok(debt.reserve.clone())
    } else {
        err!(ParalyxError::UnsupportedObligation)
    }
}

fn optional_meta(account: &Option<AccountInfo>, klend: &Pubkey, writable: bool) -> AccountMeta {
    match account {
        Some(info) if writable => AccountMeta::new(info.key(), false),
        Some(info) => AccountMeta::new_readonly(info.key(), false),
        None => AccountMeta::new_readonly(*klend, false),
    }
}

fn call<'info>(k: &Kamino<'info>, data: Vec<u8>, metas: Vec<AccountMeta>, infos: Vec<AccountInfo<'info>>) -> Result<()> {
    let mut all = infos;
    all.push(k.program.clone());
    invoke(&Instruction { program_id: k.program.key(), accounts: metas, data }, &all)?;
    Ok(())
}

fn with_amount(discriminator: [u8; 8], amount: u64) -> Vec<u8> {
    let mut data = discriminator.to_vec();
    data.extend_from_slice(&amount.to_le_bytes());
    data
}

fn refresh_reserve<'info>(k: &Kamino<'info>, side: &Side<'info>) -> Result<()> {
    let klend = k.program.key();
    let mut metas = vec![AccountMeta::new(side.reserve.key(), false), AccountMeta::new_readonly(k.market.key(), false)];
    let mut infos = vec![side.reserve.clone(), k.market.clone()];
    for oracle in side.oracles.iter() {
        metas.push(optional_meta(oracle, &klend, false));
        if let Some(info) = oracle {
            infos.push(info.clone());
        }
    }
    call(k, REFRESH_RESERVE.to_vec(), metas, infos)
}

fn refresh_obligation<'info>(k: &Kamino<'info>, collateral: &Side<'info>, debt: &Side<'info>) -> Result<Vec<AccountInfo<'info>>> {
    let (deposits, borrows) = obligation_reserves(&k.obligation)?;
    let mut metas = vec![AccountMeta::new_readonly(k.market.key(), false), AccountMeta::new(k.obligation.key(), false)];
    let mut infos = vec![k.market.clone(), k.obligation.clone()];
    let mut deposit_infos = Vec::with_capacity(deposits.len());
    for key in deposits.iter().chain(borrows.iter()) {
        let info = pick(key, collateral, debt)?;
        metas.push(AccountMeta::new(info.key(), false));
        infos.push(info);
    }
    for key in deposits.iter() {
        deposit_infos.push(pick(key, collateral, debt)?);
    }
    call(k, REFRESH_OBLIGATION.to_vec(), metas, infos)?;
    Ok(deposit_infos)
}

pub fn refresh<'info>(k: &Kamino<'info>, collateral: &Side<'info>, debt: &Side<'info>) -> Result<Vec<AccountInfo<'info>>> {
    refresh_reserve(k, collateral)?;
    refresh_reserve(k, debt)?;
    refresh_obligation(k, collateral, debt)
}

fn farm_metas<'info>(k: &Kamino<'info>, side: &Side<'info>, metas: &mut Vec<AccountMeta>, infos: &mut Vec<AccountInfo<'info>>) {
    let klend = k.program.key();
    metas.push(optional_meta(&side.farm_user, &klend, true));
    metas.push(optional_meta(&side.farm_state, &klend, true));
    for account in [&side.farm_user, &side.farm_state].into_iter().flatten() {
        infos.push(account.clone());
    }
}

pub fn deposit<'info>(k: &Kamino<'info>, side: &Side<'info>, ctoken_mint: &AccountInfo<'info>, ctoken_supply: &AccountInfo<'info>, amount: u64) -> Result<()> {
    let klend = k.program.key();
    let mut metas = vec![
        AccountMeta::new(k.owner.key(), true),
        AccountMeta::new(k.obligation.key(), false),
        AccountMeta::new_readonly(k.market.key(), false),
        AccountMeta::new_readonly(k.authority.key(), false),
        AccountMeta::new(side.reserve.key(), false),
        AccountMeta::new_readonly(side.mint.key(), false),
        AccountMeta::new(side.supply.key(), false),
        AccountMeta::new(ctoken_mint.key(), false),
        AccountMeta::new(ctoken_supply.key(), false),
        AccountMeta::new(side.user_token.key(), false),
        AccountMeta::new_readonly(klend, false),
        AccountMeta::new_readonly(k.token_program.key(), false),
        AccountMeta::new_readonly(k.token_program.key(), false),
        AccountMeta::new_readonly(k.instructions.key(), false),
    ];
    let mut infos = vec![
        k.owner.clone(),
        k.obligation.clone(),
        k.market.clone(),
        k.authority.clone(),
        side.reserve.clone(),
        side.mint.clone(),
        side.supply.clone(),
        ctoken_mint.clone(),
        ctoken_supply.clone(),
        side.user_token.clone(),
        k.token_program.clone(),
        k.instructions.clone(),
    ];
    farm_metas(k, side, &mut metas, &mut infos);
    metas.push(AccountMeta::new_readonly(k.farms_program.key(), false));
    infos.push(k.farms_program.clone());
    call(k, with_amount(DEPOSIT_AND_COLLATERALIZE_V2, amount), metas, infos)
}

pub fn borrow<'info>(k: &Kamino<'info>, side: &Side<'info>, fee_receiver: &AccountInfo<'info>, deposit_reserves: &[AccountInfo<'info>], amount: u64) -> Result<()> {
    let klend = k.program.key();
    let mut metas = vec![
        AccountMeta::new_readonly(k.owner.key(), true),
        AccountMeta::new(k.obligation.key(), false),
        AccountMeta::new_readonly(k.market.key(), false),
        AccountMeta::new_readonly(k.authority.key(), false),
        AccountMeta::new(side.reserve.key(), false),
        AccountMeta::new_readonly(side.mint.key(), false),
        AccountMeta::new(side.supply.key(), false),
        AccountMeta::new(fee_receiver.key(), false),
        AccountMeta::new(side.user_token.key(), false),
        AccountMeta::new_readonly(klend, false),
        AccountMeta::new_readonly(k.token_program.key(), false),
        AccountMeta::new_readonly(k.instructions.key(), false),
    ];
    let mut infos = vec![
        k.owner.clone(),
        k.obligation.clone(),
        k.market.clone(),
        k.authority.clone(),
        side.reserve.clone(),
        side.mint.clone(),
        side.supply.clone(),
        fee_receiver.clone(),
        side.user_token.clone(),
        k.token_program.clone(),
        k.instructions.clone(),
    ];
    farm_metas(k, side, &mut metas, &mut infos);
    metas.push(AccountMeta::new_readonly(k.farms_program.key(), false));
    infos.push(k.farms_program.clone());
    for reserve in deposit_reserves {
        metas.push(AccountMeta::new(reserve.key(), false));
        infos.push(reserve.clone());
    }
    call(k, with_amount(BORROW_V2, amount), metas, infos)
}

pub fn repay<'info>(k: &Kamino<'info>, side: &Side<'info>, deposit_reserves: &[AccountInfo<'info>], amount: u64) -> Result<()> {
    let mut metas = vec![
        AccountMeta::new_readonly(k.owner.key(), true),
        AccountMeta::new(k.obligation.key(), false),
        AccountMeta::new_readonly(k.market.key(), false),
        AccountMeta::new(side.reserve.key(), false),
        AccountMeta::new_readonly(side.mint.key(), false),
        AccountMeta::new(side.supply.key(), false),
        AccountMeta::new(side.user_token.key(), false),
        AccountMeta::new_readonly(k.token_program.key(), false),
        AccountMeta::new_readonly(k.instructions.key(), false),
    ];
    let mut infos = vec![
        k.owner.clone(),
        k.obligation.clone(),
        k.market.clone(),
        side.reserve.clone(),
        side.mint.clone(),
        side.supply.clone(),
        side.user_token.clone(),
        k.token_program.clone(),
        k.instructions.clone(),
    ];
    farm_metas(k, side, &mut metas, &mut infos);
    metas.push(AccountMeta::new_readonly(k.authority.key(), false));
    metas.push(AccountMeta::new_readonly(k.farms_program.key(), false));
    infos.push(k.authority.clone());
    infos.push(k.farms_program.clone());
    for reserve in deposit_reserves {
        metas.push(AccountMeta::new(reserve.key(), false));
        infos.push(reserve.clone());
    }
    call(k, with_amount(REPAY_V2, amount), metas, infos)
}

pub fn withdraw<'info>(k: &Kamino<'info>, side: &Side<'info>, ctoken_mint: &AccountInfo<'info>, ctoken_supply: &AccountInfo<'info>, collateral_amount: u64) -> Result<()> {
    let klend = k.program.key();
    let mut metas = vec![
        AccountMeta::new(k.owner.key(), true),
        AccountMeta::new(k.obligation.key(), false),
        AccountMeta::new_readonly(k.market.key(), false),
        AccountMeta::new_readonly(k.authority.key(), false),
        AccountMeta::new(side.reserve.key(), false),
        AccountMeta::new_readonly(side.mint.key(), false),
        AccountMeta::new(ctoken_supply.key(), false),
        AccountMeta::new(ctoken_mint.key(), false),
        AccountMeta::new(side.supply.key(), false),
        AccountMeta::new(side.user_token.key(), false),
        AccountMeta::new_readonly(klend, false),
        AccountMeta::new_readonly(k.token_program.key(), false),
        AccountMeta::new_readonly(k.token_program.key(), false),
        AccountMeta::new_readonly(k.instructions.key(), false),
    ];
    let mut infos = vec![
        k.owner.clone(),
        k.obligation.clone(),
        k.market.clone(),
        k.authority.clone(),
        side.reserve.clone(),
        side.mint.clone(),
        ctoken_supply.clone(),
        ctoken_mint.clone(),
        side.supply.clone(),
        side.user_token.clone(),
        k.token_program.clone(),
        k.instructions.clone(),
    ];
    farm_metas(k, side, &mut metas, &mut infos);
    metas.push(AccountMeta::new_readonly(k.farms_program.key(), false));
    infos.push(k.farms_program.clone());
    call(k, with_amount(WITHDRAW_AND_REDEEM_V2, collateral_amount), metas, infos)
}
