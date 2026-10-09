use std::path::PathBuf;

use anchor_lang::{
    prelude::{Pubkey, pubkey},
    solana_program::instruction::{AccountMeta, Instruction},
    AccountDeserialize, AnchorDeserialize, Discriminator, InstructionData, ToAccountMetas,
};
use base64::Engine;
use credit_line::{Config, Line, LineOpened, LineRepaid, PayoutRecorded};
use litesvm::{types::TransactionMetadata, LiteSVM};
use solana_account::Account;
use solana_clock::Clock;
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

const KLEND: Pubkey = pubkey!("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
const FARMS: Pubkey = pubkey!("FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr");
const TOKEN: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const SYSTEM: Pubkey = pubkey!("11111111111111111111111111111111");
const RENT: Pubkey = pubkey!("SysvarRent111111111111111111111111111111111");
const INSTRUCTIONS: Pubkey = pubkey!("Sysvar1nstructions1111111111111111111111111");
const COMPUTE_BUDGET: Pubkey = pubkey!("ComputeBudget111111111111111111111111111111");
const MARKET: Pubkey = pubkey!("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF");
const SOL_RESERVE: Pubkey = pubkey!("d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q");
const SOL_MINT: Pubkey = pubkey!("So11111111111111111111111111111111111111112");
const SOL_SUPPLY: Pubkey = pubkey!("GafNuUXj9rxGLn4y79dPu6MHSuPWeJR6UtTWuexpGh3U");
const SOL_CTOKEN_MINT: Pubkey = pubkey!("2UywZrUdyqs5vDchy7fKQJKau2RVyuzBev2XKGPDSiX1");
const SOL_CTOKEN_SUPPLY: Pubkey = pubkey!("8NXMyRD91p3nof61BTkJvrfpGTASHygz1cUvc3HvwyGS");
const SOL_FARM: Pubkey = pubkey!("955xWFhSDcDiUgUr4sBRtCpTLiMd4H5uZLAmgtP3R3sX");
const USDC_RESERVE: Pubkey = pubkey!("D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59");
const USDC_MINT: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const USDC_SUPPLY: Pubkey = pubkey!("Bgq7trRgVMeq33yt235zM2onQ4bRDBsY5EWiTetF4qw6");
const USDC_FEE_VAULT: Pubkey = pubkey!("BbDUrk1bVtSixgQsPLBJFZEF7mwGstnD5joA1WzYvYFX");
const SCOPE_PRICES: Pubkey = pubkey!("3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH");

const INIT_USER_METADATA: [u8; 8] = [117, 169, 176, 69, 197, 23, 15, 162];
const INIT_OBLIGATION: [u8; 8] = [251, 10, 231, 76, 27, 11, 159, 96];
const INIT_OBLIGATION_FARMS: [u8; 8] = [136, 63, 15, 186, 211, 152, 168, 164];
const EVENT_IX_TAG: [u8; 8] = [228, 69, 165, 46, 81, 203, 154, 29];

const SOL: u64 = 1_000_000_000;
const USDC: u64 = 1_000_000;

struct World {
    svm: LiteSVM,
    admin: Keypair,
    user: Keypair,
    start: Clock,
}

struct Pdas {
    config: Pubkey,
    line: Pubkey,
    obligation: Pubkey,
    user_metadata: Pubkey,
    market_authority: Pubkey,
    farm_user: Pubkey,
    user_sol: Pubkey,
    user_usdc: Pubkey,
    event_authority: Pubkey,
}

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures/mainnet")
}

fn pdas(user: &Pubkey) -> Pdas {
    let default = Pubkey::default();
    let obligation = Pubkey::find_program_address(&[&[0], &[0], user.as_ref(), MARKET.as_ref(), default.as_ref(), default.as_ref()], &KLEND).0;
    Pdas {
        config: Pubkey::find_program_address(&[credit_line::CONFIG_SEED], &credit_line::ID).0,
        line: Pubkey::find_program_address(&[credit_line::LINE_SEED, user.as_ref()], &credit_line::ID).0,
        obligation,
        user_metadata: Pubkey::find_program_address(&[b"user_meta", user.as_ref()], &KLEND).0,
        market_authority: Pubkey::find_program_address(&[b"lma", MARKET.as_ref()], &KLEND).0,
        farm_user: Pubkey::find_program_address(&[b"user", SOL_FARM.as_ref(), obligation.as_ref()], &FARMS).0,
        user_sol: Pubkey::find_program_address(&[b"wsol", user.as_ref()], &credit_line::ID).0,
        user_usdc: Pubkey::find_program_address(&[b"usdc", user.as_ref()], &credit_line::ID).0,
        event_authority: Pubkey::find_program_address(&[b"__event_authority"], &credit_line::ID).0,
    }
}

fn token_account(mint: &Pubkey, owner: &Pubkey, amount: u64, native_reserve: Option<u64>) -> Vec<u8> {
    let mut data = vec![0u8; 165];
    data[0..32].copy_from_slice(mint.as_ref());
    data[32..64].copy_from_slice(owner.as_ref());
    data[64..72].copy_from_slice(&amount.to_le_bytes());
    data[108] = 1;
    if let Some(reserve) = native_reserve {
        data[109..113].copy_from_slice(&1u32.to_le_bytes());
        data[113..121].copy_from_slice(&reserve.to_le_bytes());
    }
    data
}

fn set_token(svm: &mut LiteSVM, address: Pubkey, mint: &Pubkey, owner: &Pubkey, amount: u64) {
    let rent = svm.minimum_balance_for_rent_exemption(165);
    let native = *mint == SOL_MINT;
    let lamports = if native { rent + amount } else { rent };
    let data = token_account(mint, owner, amount, native.then_some(rent));
    svm.set_account(address, Account { lamports, data, owner: TOKEN, executable: false, rent_epoch: 0 }).unwrap();
}

fn balance(svm: &LiteSVM, address: &Pubkey) -> u64 {
    let account = svm.get_account(address).unwrap();
    u64::from_le_bytes(account.data[64..72].try_into().unwrap())
}

fn budget() -> Instruction {
    let mut data = vec![2u8];
    data.extend_from_slice(&1_400_000u32.to_le_bytes());
    Instruction { program_id: COMPUTE_BUDGET, accounts: vec![], data }
}

fn send(svm: &mut LiteSVM, payer: &Keypair, instructions: &[Instruction]) -> Result<TransactionMetadata, (u32, Vec<String>)> {
    svm.expire_blockhash();
    let message = Message::new_with_blockhash(instructions, Some(&payer.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(message), &[payer]).unwrap();
    svm.send_transaction(tx).map_err(|failed| {
        let code = match failed.err {
            solana_transaction::TransactionError::InstructionError(_, solana_transaction::InstructionError::Custom(code)) => code,
            _ => u32::MAX,
        };
        (code, failed.meta.logs)
    })
}

fn load() -> World {
    let raw = std::fs::read_to_string(fixtures().join("snapshot.json")).expect("run node fixtures/fetch.mjs first");
    let snapshot: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let mut svm = LiteSVM::new().with_log_bytes_limit(None);
    svm.add_program(KLEND, &std::fs::read(fixtures().join("klend.so")).unwrap()).unwrap();
    svm.add_program(FARMS, &std::fs::read(fixtures().join("farms.so")).unwrap()).unwrap();
    svm.add_program(credit_line::ID, include_bytes!("../../target/deploy/credit_line.so")).unwrap();
    for entry in snapshot["accounts"].as_array().unwrap() {
        let address: Pubkey = entry["address"].as_str().unwrap().parse().unwrap();
        let owner: Pubkey = entry["owner"].as_str().unwrap().parse().unwrap();
        let data = base64::engine::general_purpose::STANDARD.decode(entry["data"].as_str().unwrap()).unwrap();
        let lamports = entry["lamports"].as_u64().unwrap();
        svm.set_account(address, Account { lamports, data, owner, executable: false, rent_epoch: 0 }).unwrap();
    }
    svm.warp_to_slot(snapshot["slot"].as_u64().unwrap() + 1);
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = snapshot["unixTimestamp"].as_i64().unwrap();
    svm.set_sysvar(&clock);

    let admin = Keypair::new();
    let user = Keypair::new();
    svm.airdrop(&admin.pubkey(), 10 * SOL).unwrap();
    svm.airdrop(&user.pubkey(), 10 * SOL).unwrap();
    set_upgrade_authority(&mut svm, &admin.pubkey());
    World { svm, admin, user, start: clock }
}

fn set_upgrade_authority(svm: &mut LiteSVM, authority: &Pubkey) {
    let program_data = Pubkey::find_program_address(&[credit_line::ID.as_ref()], &pubkey!("BPFLoaderUpgradeab1e11111111111111111111111")).0;
    let mut account = svm.get_account(&program_data).unwrap();
    account.data[12] = 1;
    account.data[13..45].copy_from_slice(authority.as_ref());
    svm.set_account(program_data, account).unwrap();
}

fn initialize_ix(admin: &Pubkey, collateral: Pubkey, debt: Pubkey) -> Instruction {
    let p = pdas(admin);
    Instruction {
        program_id: credit_line::ID,
        accounts: credit_line::accounts::Initialize {
            admin: *admin,
            config: p.config,
            program: credit_line::ID,
            program_data: Pubkey::find_program_address(&[credit_line::ID.as_ref()], &pubkey!("BPFLoaderUpgradeab1e11111111111111111111111")).0,
            klend_program: KLEND,
            lending_market: MARKET,
            collateral_reserve: collateral,
            debt_reserve: debt,
            system_program: SYSTEM,
        }
        .to_account_metas(None),
        data: credit_line::instruction::Initialize {}.data(),
    }
}

fn kamino_setup(world: &mut World) {
    let user = world.user.pubkey();
    let p = pdas(&user);
    let mut metadata_data = INIT_USER_METADATA.to_vec();
    metadata_data.extend_from_slice(Pubkey::default().as_ref());
    let init_metadata = Instruction {
        program_id: KLEND,
        accounts: vec![
            AccountMeta::new_readonly(user, true),
            AccountMeta::new(user, true),
            AccountMeta::new(p.user_metadata, false),
            AccountMeta::new_readonly(KLEND, false),
            AccountMeta::new_readonly(RENT, false),
            AccountMeta::new_readonly(SYSTEM, false),
        ],
        data: metadata_data,
    };
    let mut obligation_data = INIT_OBLIGATION.to_vec();
    obligation_data.extend_from_slice(&[0, 0]);
    let init_obligation = Instruction {
        program_id: KLEND,
        accounts: vec![
            AccountMeta::new_readonly(user, true),
            AccountMeta::new(user, true),
            AccountMeta::new(p.obligation, false),
            AccountMeta::new_readonly(MARKET, false),
            AccountMeta::new_readonly(Pubkey::default(), false),
            AccountMeta::new_readonly(Pubkey::default(), false),
            AccountMeta::new_readonly(p.user_metadata, false),
            AccountMeta::new_readonly(RENT, false),
            AccountMeta::new_readonly(SYSTEM, false),
        ],
        data: obligation_data,
    };
    let mut farms_data = INIT_OBLIGATION_FARMS.to_vec();
    farms_data.push(0);
    let init_farms = Instruction {
        program_id: KLEND,
        accounts: vec![
            AccountMeta::new(user, true),
            AccountMeta::new_readonly(user, false),
            AccountMeta::new(p.obligation, false),
            AccountMeta::new_readonly(p.market_authority, false),
            AccountMeta::new(SOL_RESERVE, false),
            AccountMeta::new(SOL_FARM, false),
            AccountMeta::new(p.farm_user, false),
            AccountMeta::new_readonly(MARKET, false),
            AccountMeta::new_readonly(FARMS, false),
            AccountMeta::new_readonly(RENT, false),
            AccountMeta::new_readonly(SYSTEM, false),
        ],
        data: farms_data,
    };
    let user_key = world.user.insecure_clone();
    send(&mut world.svm, &user_key, &[budget(), init_metadata, init_obligation, init_farms]).unwrap_or_else(|(code, logs)| panic!("kamino setup failed {code}: {logs:#?}"));
    set_token(&mut world.svm, p.user_sol, &SOL_MINT, &user, 5 * SOL);
    set_token(&mut world.svm, p.user_usdc, &USDC_MINT, &user, 0);
}

fn ready() -> World {
    let mut world = load();
    let admin = world.admin.insecure_clone();
    send(&mut world.svm, &admin, &[initialize_ix(&admin.pubkey(), SOL_RESERVE, USDC_RESERVE)]).unwrap_or_else(|(code, logs)| panic!("initialize failed {code}: {logs:#?}"));
    kamino_setup(&mut world);
    world
}

fn line_accounts(user: &Pubkey, collateral: Pubkey, debt: Pubkey) -> credit_line::accounts::OpenLine {
    let p = pdas(user);
    credit_line::accounts::OpenLine {
        user: *user,
        config: p.config,
        line: p.line,
        klend_program: KLEND,
        lending_market: MARKET,
        lending_market_authority: p.market_authority,
        obligation: p.obligation,
        collateral_reserve: collateral,
        collateral_mint: SOL_MINT,
        collateral_supply: SOL_SUPPLY,
        collateral_ctoken_mint: SOL_CTOKEN_MINT,
        collateral_ctoken_supply: SOL_CTOKEN_SUPPLY,
        user_collateral: p.user_sol,
        debt_reserve: debt,
        debt_mint: USDC_MINT,
        debt_supply: USDC_SUPPLY,
        debt_fee_receiver: USDC_FEE_VAULT,
        user_debt: p.user_usdc,
        collateral_pyth: None,
        collateral_switchboard_price: None,
        collateral_switchboard_twap: None,
        collateral_scope: Some(SCOPE_PRICES),
        debt_pyth: None,
        debt_switchboard_price: None,
        debt_switchboard_twap: None,
        debt_scope: Some(SCOPE_PRICES),
        collateral_farm_state: Some(SOL_FARM),
        collateral_farm_user: Some(p.farm_user),
        debt_farm_state: None,
        debt_farm_user: None,
        farms_program: FARMS,
        token_program: TOKEN,
        instructions: INSTRUCTIONS,
        system_program: SYSTEM,
        event_authority: p.event_authority,
        program: credit_line::ID,
    }
}

fn open_ix(user: &Pubkey, collateral: u64, borrow: u64) -> Instruction {
    Instruction {
        program_id: credit_line::ID,
        accounts: line_accounts(user, SOL_RESERVE, USDC_RESERVE).to_account_metas(None),
        data: credit_line::instruction::OpenLine { collateral_amount: collateral, borrow_amount: borrow }.data(),
    }
}

fn repay_ix(user: &Pubkey, repay: u64, withdraw: u64) -> Instruction {
    let open = line_accounts(user, SOL_RESERVE, USDC_RESERVE);
    let accounts = credit_line::accounts::RepayLine {
        user: open.user,
        config: open.config,
        line: open.line,
        klend_program: open.klend_program,
        lending_market: open.lending_market,
        lending_market_authority: open.lending_market_authority,
        obligation: open.obligation,
        collateral_reserve: open.collateral_reserve,
        collateral_mint: open.collateral_mint,
        collateral_supply: open.collateral_supply,
        collateral_ctoken_mint: open.collateral_ctoken_mint,
        collateral_ctoken_supply: open.collateral_ctoken_supply,
        user_collateral: open.user_collateral,
        debt_reserve: open.debt_reserve,
        debt_mint: open.debt_mint,
        debt_supply: open.debt_supply,
        user_debt: open.user_debt,
        collateral_pyth: open.collateral_pyth,
        collateral_switchboard_price: open.collateral_switchboard_price,
        collateral_switchboard_twap: open.collateral_switchboard_twap,
        collateral_scope: open.collateral_scope,
        debt_pyth: open.debt_pyth,
        debt_switchboard_price: open.debt_switchboard_price,
        debt_switchboard_twap: open.debt_switchboard_twap,
        debt_scope: open.debt_scope,
        collateral_farm_state: open.collateral_farm_state,
        collateral_farm_user: open.collateral_farm_user,
        debt_farm_state: open.debt_farm_state,
        debt_farm_user: open.debt_farm_user,
        farms_program: open.farms_program,
        token_program: open.token_program,
        instructions: open.instructions,
        event_authority: open.event_authority,
        program: open.program,
    };
    Instruction {
        program_id: credit_line::ID,
        accounts: accounts.to_account_metas(None),
        data: credit_line::instruction::RepayLine { repay_amount: repay, withdraw_collateral: withdraw }.data(),
    }
}

fn payout_ix(user: &Pubkey, reference: &str, try_amount: u64) -> Instruction {
    let p = pdas(user);
    Instruction {
        program_id: credit_line::ID,
        accounts: credit_line::accounts::RecordPayout { user: *user, line: p.line, event_authority: p.event_authority, program: credit_line::ID }.to_account_metas(None),
        data: credit_line::instruction::RecordPayout { rail_tx_id: reference.to_string(), try_amount }.data(),
    }
}

fn read<T: AccountDeserialize>(svm: &LiteSVM, address: &Pubkey) -> Option<T> {
    let account = svm.get_account(address)?;
    if account.data.is_empty() {
        return None;
    }
    T::try_deserialize(&mut account.data.as_slice()).ok()
}

fn obligation_position(svm: &LiteSVM, user: &Pubkey) -> (Pubkey, u64, Pubkey, u128) {
    let data = svm.get_account(&pdas(user).obligation).unwrap().data;
    let key = |offset: usize| Pubkey::new_from_array(data[offset..offset + 32].try_into().unwrap());
    let deposited = u64::from_le_bytes(data[128..136].try_into().unwrap());
    let borrowed_sf = u128::from_le_bytes(data[1296..1312].try_into().unwrap());
    (key(96), deposited, key(1208), borrowed_sf)
}

fn events<E: AnchorDeserialize + Discriminator>(meta: &TransactionMetadata) -> Vec<E> {
    meta.inner_instructions
        .iter()
        .flatten()
        .filter_map(|inner| {
            let data = &inner.instruction.data;
            (data.len() > 16 && data[..8] == EVENT_IX_TAG && &data[8..16] == E::DISCRIMINATOR).then(|| E::deserialize(&mut &data[16..]).unwrap())
        })
        .collect()
}

fn run(world: &mut World, instruction: Instruction) -> Result<TransactionMetadata, (u32, Vec<String>)> {
    let user = world.user.insecure_clone();
    send(&mut world.svm, &user, &[budget(), instruction])
}

fn advance(world: &mut World, seconds: i64) {
    let mut clock = world.svm.get_sysvar::<Clock>();
    world.svm.warp_to_slot(clock.slot + (seconds as u64) * 5 / 2);
    clock = world.svm.get_sysvar::<Clock>();
    clock.unix_timestamp += seconds;
    world.svm.set_sysvar(&clock);
}

#[test]
fn open_line_deposits_sol_and_borrows_usdc_on_kamino() {
    let mut world = ready();
    let user = world.user.pubkey();
    let p = pdas(&user);
    let meta = run(&mut world, open_ix(&user, SOL, 20 * USDC)).unwrap_or_else(|(code, logs)| panic!("open failed {code}: {logs:#?}"));

    let line: Line = read(&world.svm, &p.line).unwrap();
    assert_eq!(line.user, user);
    assert!(SOL - line.collateral_in <= 1, "kamino rounds the deposit down by at most one lamport, got {}", line.collateral_in);
    assert_eq!(line.borrowed, 20 * USDC);
    assert_eq!(line.opened_at, world.start.unix_timestamp);
    assert_eq!(balance(&world.svm, &p.user_usdc), 20 * USDC);
    assert_eq!(balance(&world.svm, &p.user_sol), 5 * SOL - line.collateral_in);

    let (deposit_reserve, deposited, borrow_reserve, borrowed_sf) = obligation_position(&world.svm, &user);
    assert_eq!(deposit_reserve, SOL_RESERVE);
    assert!(deposited > 0);
    assert_eq!(borrow_reserve, USDC_RESERVE);
    assert!(borrowed_sf >> 60 >= u128::from(20 * USDC) - 1);

    let config: Config = read(&world.svm, &p.config).unwrap();
    assert_eq!(config.line_count, 1);
    let opened = events::<LineOpened>(&meta);
    assert_eq!(opened.len(), 1);
    assert_eq!((opened[0].user, opened[0].collateral_amount, opened[0].borrow_amount), (user, line.collateral_in, 20 * USDC));
}

#[test]
fn open_line_requires_user_signature() {
    let mut world = ready();
    let victim = world.user.pubkey();
    let attacker = Keypair::new();
    world.svm.airdrop(&attacker.pubkey(), SOL).unwrap();
    let mut forged = open_ix(&victim, SOL, 0);
    forged.accounts[0] = AccountMeta::new(victim, false);
    let before = obligation_position(&world.svm, &victim);
    let failure = send(&mut world.svm, &attacker, &[budget(), forged]).unwrap_err();
    assert_eq!(failure.0, anchor_lang::error::ErrorCode::AccountNotSigner as u32);
    assert!(read::<Line>(&world.svm, &pdas(&victim).line).is_none());
    assert_eq!(obligation_position(&world.svm, &victim), before);
}

#[test]
fn open_line_rejects_empty_requests_and_foreign_reserves() {
    let mut world = ready();
    let user = world.user.pubkey();
    let before = obligation_position(&world.svm, &user);
    assert_eq!(run(&mut world, open_ix(&user, 0, 0)).unwrap_err().0, 6000);
    let swapped = Instruction {
        program_id: credit_line::ID,
        accounts: line_accounts(&user, USDC_RESERVE, SOL_RESERVE).to_account_metas(None),
        data: credit_line::instruction::OpenLine { collateral_amount: SOL, borrow_amount: 0 }.data(),
    };
    assert_eq!(run(&mut world, swapped).unwrap_err().0, 6003);
    assert_eq!(obligation_position(&world.svm, &user), before);
    assert!(read::<Line>(&world.svm, &pdas(&user).line).is_none());
}

#[test]
fn second_open_aggregates_without_counting_a_new_line() {
    let mut world = ready();
    let user = world.user.pubkey();
    let p = pdas(&user);
    run(&mut world, open_ix(&user, SOL, 0)).unwrap_or_else(|(code, logs)| panic!("first open failed {code}: {logs:#?}"));
    advance(&mut world, 30);
    run(&mut world, open_ix(&user, 0, 4 * USDC)).unwrap_or_else(|(code, logs)| panic!("second open failed {code}: {logs:#?}"));
    let line: Line = read(&world.svm, &p.line).unwrap();
    assert!(SOL - line.collateral_in <= 1);
    assert_eq!(line.borrowed, 4 * USDC);
    assert_eq!(line.opened_at, world.start.unix_timestamp);
    assert_eq!(line.updated_at, world.start.unix_timestamp + 30);
    let config: Config = read(&world.svm, &p.config).unwrap();
    assert_eq!(config.line_count, 1);
}

#[test]
fn repay_line_repays_debt_and_withdraws_collateral() {
    let mut world = ready();
    let user = world.user.pubkey();
    let p = pdas(&user);
    run(&mut world, open_ix(&user, SOL, 4 * USDC)).unwrap_or_else(|(code, logs)| panic!("open failed {code}: {logs:#?}"));
    set_token(&mut world.svm, p.user_usdc, &USDC_MINT, &user, 5 * USDC);
    let meta = run(&mut world, repay_ix(&user, u64::MAX, u64::MAX)).unwrap_or_else(|(code, logs)| panic!("repay failed {code}: {logs:#?}"));
    let line: Line = read(&world.svm, &p.line).unwrap();
    assert!(line.repaid >= 4 * USDC && line.repaid <= 4 * USDC + 1, "repaid {}", line.repaid);
    assert!(line.collateral_out <= line.collateral_in && line.collateral_in - line.collateral_out <= 2, "in {} out {}", line.collateral_in, line.collateral_out);
    assert_eq!(balance(&world.svm, &p.user_usdc), 5 * USDC - line.repaid);
    assert_eq!(balance(&world.svm, &p.user_sol), 5 * SOL - line.collateral_in + line.collateral_out);
    assert!(world.svm.get_account(&p.obligation).map_or(true, |account| account.lamports == 0), "kamino closes the emptied obligation and refunds its rent");
    let repaid = events::<LineRepaid>(&meta);
    assert_eq!((repaid[0].repay_amount, repaid[0].withdraw_collateral), (line.repaid, line.collateral_out));
}

#[test]
fn repay_without_line_fails() {
    let mut world = ready();
    let user = world.user.pubkey();
    let before = obligation_position(&world.svm, &user);
    assert_eq!(run(&mut world, repay_ix(&user, USDC, 0)).unwrap_err().0, 6001);
    assert_eq!(obligation_position(&world.svm, &user), before);
}

#[test]
fn record_payout_updates_line_and_requires_line() {
    let mut world = ready();
    let user = world.user.pubkey();
    assert_eq!(run(&mut world, payout_ix(&user, "SBX-0123", 250_00)).unwrap_err().0, 6001);
    run(&mut world, open_ix(&user, SOL, 4 * USDC)).unwrap_or_else(|(code, logs)| panic!("open failed {code}: {logs:#?}"));
    let meta = run(&mut world, payout_ix(&user, "SBX-0123", 250_00)).unwrap_or_else(|(code, logs)| panic!("payout failed {code}: {logs:#?}"));
    let line: Line = read(&world.svm, &pdas(&user).line).unwrap();
    assert_eq!(line.payouts, 1);
    assert_eq!(line.payout_try, 250_00);
    let recorded = events::<PayoutRecorded>(&meta);
    assert_eq!((recorded[0].rail_tx_id.as_str(), recorded[0].try_amount), ("SBX-0123", 250_00));
    assert_eq!(run(&mut world, payout_ix(&user, "", 1)).unwrap_err().0, 6006);
    assert_eq!(run(&mut world, payout_ix(&user, &"x".repeat(65), 1)).unwrap_err().0, 6006);
}

#[test]
fn config_and_positions_are_client_side_reads() {
    let mut world = ready();
    let user = world.user.pubkey();
    let p = pdas(&user);
    let config: Config = read(&world.svm, &p.config).unwrap();
    assert_eq!(config.admin, world.admin.pubkey());
    assert_eq!(config.klend_program, KLEND);
    assert_eq!(config.lending_market, MARKET);
    assert_eq!(config.collateral_reserve, SOL_RESERVE);
    assert_eq!(config.debt_reserve, USDC_RESERVE);
    run(&mut world, open_ix(&user, 2 * SOL, 10 * USDC)).unwrap_or_else(|(code, logs)| panic!("open failed {code}: {logs:#?}"));
    let (deposit_reserve, deposited, borrow_reserve, borrowed_sf) = obligation_position(&world.svm, &user);
    assert_eq!((deposit_reserve, borrow_reserve), (SOL_RESERVE, USDC_RESERVE));
    assert!(deposited > 0 && borrowed_sf > 0);
    let obligation = world.svm.get_account(&p.obligation).unwrap();
    assert_eq!(obligation.owner, KLEND);
    assert_eq!(Pubkey::new_from_array(obligation.data[64..96].try_into().unwrap()), user);
}

#[test]
fn initialize_requires_upgrade_authority() {
    let mut world = load();
    let stranger = Keypair::new();
    world.svm.airdrop(&stranger.pubkey(), SOL).unwrap();
    let failure = send(&mut world.svm, &stranger, &[initialize_ix(&stranger.pubkey(), SOL_RESERVE, USDC_RESERVE)]).unwrap_err();
    assert_eq!(failure.0, 6007);
    let admin = world.admin.insecure_clone();
    let crossed = send(&mut world.svm, &admin, &[initialize_ix(&admin.pubkey(), SOL_RESERVE, SOL_RESERVE)]).unwrap_err();
    assert_eq!(crossed.0, 6003);
}
