use anchor_lang::{
    prelude::{Pubkey, pubkey},
    solana_program::instruction::{AccountMeta, Instruction},
    AccountDeserialize, AnchorDeserialize, Discriminator, InstructionData, ToAccountMetas,
};
use arf_line::{Draw, Drawn, Line, LineCreated, LineFunded, LineWithdrawn, Repaid, TermsSet};
use litesvm::{types::TransactionMetadata, LiteSVM};
use solana_account::Account;
use solana_clock::Clock;
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

const TOKEN: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const SYSTEM: Pubkey = pubkey!("11111111111111111111111111111111");
const EVENT_IX_TAG: [u8; 8] = [228, 69, 165, 46, 81, 203, 154, 29];
const USDC: u64 = 1_000_000;
const DAY: i64 = 86_400;
const START: i64 = 1_791_900_000;

const ACCOUNT_IN_USE: u32 = 0;
const EMPTY_AMOUNT: u32 = 7100;
const INVALID_REFERENCE: u32 = 7101;
const INVALID_LIMIT: u32 = 7102;
const INVALID_TERM: u32 = 7103;
const INVALID_FEE: u32 = 7104;
const FROZEN: u32 = 7105;
const OVERDUE: u32 = 7106;
const LIMIT_EXCEEDED: u32 = 7107;
const INSUFFICIENT_LIQUIDITY: u32 = 7108;
const NOTHING_TO_REPAY: u32 = 7109;
const DRAW_OUT_OF_ORDER: u32 = 7110;
const MISSING_HEAD: u32 = 7111;
const WRONG_LINE: u32 = 7113;
const OPEN_DRAWS: u32 = 7114;
const NOT_PROVIDER: u32 = 7115;
const NOT_OPERATOR: u32 = 7116;

struct World {
    svm: LiteSVM,
    provider: Keypair,
    operator: Keypair,
    stranger: Keypair,
    mint: Pubkey,
    line: Pubkey,
    vault: Pubkey,
    provider_usdc: Pubkey,
    operator_usdc: Pubkey,
    user_usdc: Pubkey,
}

fn line_address(provider: &Pubkey, operator: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[arf_line::LINE_SEED, provider.as_ref(), operator.as_ref(), mint.as_ref()], &arf_line::ID).0
}

fn vault_address(line: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[arf_line::VAULT_SEED, line.as_ref()], &arf_line::ID).0
}

fn draw_address(line: &Pubkey, reference: &str) -> Pubkey {
    Pubkey::find_program_address(&[arf_line::DRAW_SEED, line.as_ref(), reference.as_bytes()], &arf_line::ID).0
}

fn event_authority() -> Pubkey {
    Pubkey::find_program_address(&[b"__event_authority"], &arf_line::ID).0
}

fn set_mint(svm: &mut LiteSVM, address: Pubkey, decimals: u8) {
    let mut data = vec![0u8; 82];
    data[44] = decimals;
    data[45] = 1;
    let lamports = svm.minimum_balance_for_rent_exemption(82);
    svm.set_account(address, Account { lamports, data, owner: TOKEN, executable: false, rent_epoch: 0 }).unwrap();
}

fn set_token(svm: &mut LiteSVM, address: Pubkey, mint: &Pubkey, owner: &Pubkey, amount: u64) {
    let mut data = vec![0u8; 165];
    data[0..32].copy_from_slice(mint.as_ref());
    data[32..64].copy_from_slice(owner.as_ref());
    data[64..72].copy_from_slice(&amount.to_le_bytes());
    data[108] = 1;
    let lamports = svm.minimum_balance_for_rent_exemption(165);
    svm.set_account(address, Account { lamports, data, owner: TOKEN, executable: false, rent_epoch: 0 }).unwrap();
}

fn balance(svm: &LiteSVM, address: &Pubkey) -> u64 {
    let account = svm.get_account(address).unwrap();
    u64::from_le_bytes(account.data[64..72].try_into().unwrap())
}

fn token_owner(svm: &LiteSVM, address: &Pubkey) -> Pubkey {
    let account = svm.get_account(address).unwrap();
    Pubkey::new_from_array(account.data[32..64].try_into().unwrap())
}

fn read<T: AccountDeserialize>(svm: &LiteSVM, address: &Pubkey) -> T {
    let account = svm.get_account(address).unwrap();
    T::try_deserialize(&mut account.data.as_slice()).unwrap()
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

fn send(svm: &mut LiteSVM, signers: &[&Keypair], instructions: &[Instruction]) -> Result<TransactionMetadata, u32> {
    svm.expire_blockhash();
    let message = Message::new_with_blockhash(instructions, Some(&signers[0].pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(message), signers).unwrap();
    svm.send_transaction(tx).map_err(|failed| match failed.err {
        solana_transaction::TransactionError::InstructionError(_, solana_transaction::InstructionError::Custom(code)) => code,
        other => panic!("unexpected failure {other:?}: {:#?}", failed.meta.logs),
    })
}

fn advance(svm: &mut LiteSVM, seconds: i64) {
    let mut clock = svm.get_sysvar::<Clock>();
    clock.slot += (seconds as u64) * 5 / 2;
    clock.unix_timestamp += seconds;
    svm.set_sysvar(&clock);
}

fn now(svm: &LiteSVM) -> i64 {
    svm.get_sysvar::<Clock>().unix_timestamp
}

fn world() -> World {
    let mut svm = LiteSVM::new();
    svm.add_program(arf_line::ID, include_bytes!("../../target/deploy/arf_line.so")).unwrap();
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = START;
    svm.set_sysvar(&clock);
    let provider = Keypair::new();
    let operator = Keypair::new();
    let stranger = Keypair::new();
    for key in [&provider, &operator, &stranger] {
        svm.airdrop(&key.pubkey(), 10_000_000_000).unwrap();
    }
    let mint = Pubkey::new_unique();
    set_mint(&mut svm, mint, 6);
    let provider_usdc = Pubkey::new_unique();
    let operator_usdc = Pubkey::new_unique();
    let user_usdc = Pubkey::new_unique();
    set_token(&mut svm, provider_usdc, &mint, &provider.pubkey(), 1_000 * USDC);
    set_token(&mut svm, operator_usdc, &mint, &operator.pubkey(), 0);
    set_token(&mut svm, user_usdc, &mint, &Pubkey::new_unique(), 0);
    let line = line_address(&provider.pubkey(), &operator.pubkey(), &mint);
    World { svm, provider, operator, stranger, mint, line, vault: vault_address(&line), provider_usdc, operator_usdc, user_usdc }
}

fn create_ix(w: &World, limit: u64, term_seconds: i64, fee_bps: u16) -> Instruction {
    Instruction {
        program_id: arf_line::ID,
        accounts: arf_line::accounts::CreateLine {
            provider: w.provider.pubkey(),
            operator: w.operator.pubkey(),
            mint: w.mint,
            line: w.line,
            vault: w.vault,
            token_program: TOKEN,
            system_program: SYSTEM,
            event_authority: event_authority(),
            program: arf_line::ID,
        }
        .to_account_metas(None),
        data: arf_line::instruction::CreateLine { limit, term_seconds, fee_bps }.data(),
    }
}

fn fund_ix(w: &World, provider: &Pubkey, source: Pubkey, amount: u64) -> Instruction {
    Instruction {
        program_id: arf_line::ID,
        accounts: arf_line::accounts::Fund { provider: *provider, line: w.line, mint: w.mint, vault: w.vault, source, token_program: TOKEN, event_authority: event_authority(), program: arf_line::ID }.to_account_metas(None),
        data: arf_line::instruction::Fund { amount }.data(),
    }
}

fn withdraw_ix(w: &World, provider: &Pubkey, destination: Pubkey, amount: u64) -> Instruction {
    Instruction {
        program_id: arf_line::ID,
        accounts: arf_line::accounts::Withdraw { provider: *provider, line: w.line, mint: w.mint, vault: w.vault, destination, token_program: TOKEN, event_authority: event_authority(), program: arf_line::ID }.to_account_metas(None),
        data: arf_line::instruction::Withdraw { amount }.data(),
    }
}

fn terms_ix(w: &World, provider: &Pubkey, limit: u64, term_seconds: i64, fee_bps: u16, frozen: bool) -> Instruction {
    Instruction {
        program_id: arf_line::ID,
        accounts: arf_line::accounts::SetTerms { provider: *provider, line: w.line, event_authority: event_authority(), program: arf_line::ID }.to_account_metas(None),
        data: arf_line::instruction::SetTerms { limit, term_seconds, fee_bps, frozen }.data(),
    }
}

fn draw_ix(w: &World, operator: &Pubkey, reference: &str, amount: u64) -> Instruction {
    Instruction {
        program_id: arf_line::ID,
        accounts: arf_line::accounts::DrawFunds {
            operator: *operator,
            line: w.line,
            draw: draw_address(&w.line, reference),
            mint: w.mint,
            vault: w.vault,
            destination: w.user_usdc,
            token_program: TOKEN,
            system_program: SYSTEM,
            event_authority: event_authority(),
            program: arf_line::ID,
        }
        .to_account_metas(None),
        data: arf_line::instruction::Draw { reference: reference.to_string(), amount }.data(),
    }
}

fn repay_ix(w: &World, payer: &Pubkey, source: Pubkey, amount: u64, draws: &[Pubkey]) -> Instruction {
    let mut accounts = arf_line::accounts::Repay { payer: *payer, line: w.line, mint: w.mint, vault: w.vault, source, token_program: TOKEN, event_authority: event_authority(), program: arf_line::ID }.to_account_metas(None);
    accounts.extend(draws.iter().map(|draw| AccountMeta::new(*draw, false)));
    Instruction { program_id: arf_line::ID, accounts, data: arf_line::instruction::Repay { amount }.data() }
}

fn ready(limit: u64, fee_bps: u16, capital: u64) -> World {
    let mut w = world();
    let provider = w.provider.insecure_clone();
    let ixs = [create_ix(&w, limit, 3 * DAY, fee_bps), fund_ix(&w, &provider.pubkey(), w.provider_usdc, capital)];
    send(&mut w.svm, &[&provider], &ixs).unwrap();
    w
}

fn draw(w: &mut World, reference: &str, amount: u64) -> Result<TransactionMetadata, u32> {
    let operator = w.operator.insecure_clone();
    let ix = draw_ix(w, &operator.pubkey(), reference, amount);
    send(&mut w.svm, &[&operator], &[ix])
}

fn repay(w: &mut World, amount: u64, references: &[&str]) -> Result<TransactionMetadata, u32> {
    let operator = w.operator.insecure_clone();
    let draws: Vec<Pubkey> = references.iter().map(|reference| draw_address(&w.line, reference)).collect();
    let ix = repay_ix(w, &operator.pubkey(), w.operator_usdc, amount, &draws);
    send(&mut w.svm, &[&operator], &[ix])
}

fn give_operator(w: &mut World, amount: u64) {
    let current = balance(&w.svm, &w.operator_usdc);
    let (mint, owner, account) = (w.mint, w.operator.pubkey(), w.operator_usdc);
    set_token(&mut w.svm, account, &mint, &owner, current + amount);
}

#[test]
fn create_line_records_the_terms_and_a_vault_the_line_owns() {
    let mut w = world();
    let provider = w.provider.insecure_clone();
    let ix = create_ix(&w, 500 * USDC, 3 * DAY, 10);
    let meta = send(&mut w.svm, &[&provider], &[ix]).unwrap();
    let line: Line = read(&w.svm, &w.line);
    assert_eq!((line.provider, line.operator, line.mint, line.vault), (provider.pubkey(), w.operator.pubkey(), w.mint, w.vault));
    assert_eq!((line.limit, line.term_seconds, line.fee_bps, line.frozen), (500 * USDC, 3 * DAY, 10, false));
    assert_eq!((line.outstanding, line.next_seq, line.head_seq, line.version), (0, 0, 0, arf_line::STATE_VERSION));
    assert_eq!(token_owner(&w.svm, &w.vault), w.line);
    assert_eq!(balance(&w.svm, &w.vault), 0);
    let created = events::<LineCreated>(&meta);
    assert_eq!(created.len(), 1);
    assert_eq!((created[0].line, created[0].limit, created[0].term_seconds, created[0].fee_bps), (w.line, 500 * USDC, 3 * DAY, 10));
}

#[test]
fn create_line_refuses_terms_outside_one_to_five_days_and_500_bps() {
    let mut w = world();
    let provider = w.provider.insecure_clone();
    for (limit, term, fee, code) in [(0, 3 * DAY, 10, INVALID_LIMIT), (USDC, DAY - 1, 10, INVALID_TERM), (USDC, 5 * DAY + 1, 10, INVALID_TERM), (USDC, 3 * DAY, 501, INVALID_FEE)] {
        let ix = create_ix(&w, limit, term, fee);
        assert_eq!(send(&mut w.svm, &[&provider], &[ix]).unwrap_err(), code);
    }
    let ix = create_ix(&w, USDC, 5 * DAY, 500);
    send(&mut w.svm, &[&provider], &[ix]).unwrap();
}

#[test]
fn only_the_provider_funds_and_withdraws_and_never_more_than_the_vault_holds() {
    let mut w = ready(500 * USDC, 10, 100 * USDC);
    let meta_events = {
        let provider = w.provider.insecure_clone();
        let ix = withdraw_ix(&w, &provider.pubkey(), w.provider_usdc, 40 * USDC);
        send(&mut w.svm, &[&provider], &[ix]).unwrap()
    };
    assert_eq!(events::<LineWithdrawn>(&meta_events)[0].amount, 40 * USDC);
    assert_eq!(balance(&w.svm, &w.vault), 60 * USDC);
    assert_eq!(balance(&w.svm, &w.provider_usdc), 940 * USDC);

    let stranger = w.stranger.insecure_clone();
    let stranger_usdc = Pubkey::new_unique();
    let mint = w.mint;
    set_token(&mut w.svm, stranger_usdc, &mint, &stranger.pubkey(), 10 * USDC);
    let ix = withdraw_ix(&w, &stranger.pubkey(), stranger_usdc, USDC);
    assert_eq!(send(&mut w.svm, &[&stranger], &[ix]).unwrap_err(), NOT_PROVIDER);
    let ix = fund_ix(&w, &stranger.pubkey(), stranger_usdc, USDC);
    assert_eq!(send(&mut w.svm, &[&stranger], &[ix]).unwrap_err(), NOT_PROVIDER);

    let provider = w.provider.insecure_clone();
    let ix = withdraw_ix(&w, &provider.pubkey(), w.provider_usdc, 60 * USDC + 1);
    assert_eq!(send(&mut w.svm, &[&provider], &[ix]).unwrap_err(), INSUFFICIENT_LIQUIDITY);
    let ix = fund_ix(&w, &provider.pubkey(), w.provider_usdc, 0);
    assert_eq!(send(&mut w.svm, &[&provider], &[ix]).unwrap_err(), EMPTY_AMOUNT);
    let ix = fund_ix(&w, &provider.pubkey(), w.provider_usdc, 5 * USDC);
    let funded = send(&mut w.svm, &[&provider], &[ix]).unwrap();
    assert_eq!(events::<LineFunded>(&funded)[0].amount, 5 * USDC);
}

#[test]
fn a_draw_pays_the_destination_and_records_amount_fee_and_due_date() {
    let mut w = ready(500 * USDC, 10, 100 * USDC);
    let meta = draw(&mut w, "F3236FBEB7", 2_015_491).unwrap();
    assert_eq!(balance(&w.svm, &w.user_usdc), 2_015_491);
    assert_eq!(balance(&w.svm, &w.vault), 100 * USDC - 2_015_491);

    let record: Draw = read(&w.svm, &draw_address(&w.line, "F3236FBEB7"));
    assert_eq!((record.line, record.seq, record.destination, record.reference.as_str()), (w.line, 0, w.user_usdc, "F3236FBEB7"));
    assert_eq!((record.amount, record.fee, record.repaid), (2_015_491, 2_016, 0));
    assert_eq!((record.drawn_at, record.due_at), (START, START + 3 * DAY));

    let line: Line = read(&w.svm, &w.line);
    assert_eq!((line.outstanding, line.drawn, line.fees, line.next_seq, line.head_seq, line.head_due_at), (2_017_507, 2_015_491, 2_016, 1, 0, START + 3 * DAY));
    let drawn = events::<Drawn>(&meta);
    assert_eq!(drawn.len(), 1);
    assert_eq!((drawn[0].seq, drawn[0].amount, drawn[0].fee, drawn[0].due_at, drawn[0].reference.as_str()), (0, 2_015_491, 2_016, START + 3 * DAY, "F3236FBEB7"));
}

#[test]
fn only_the_operator_draws_and_one_reference_draws_once() {
    let mut w = ready(500 * USDC, 10, 100 * USDC);
    let stranger = w.stranger.insecure_clone();
    let ix = draw_ix(&w, &stranger.pubkey(), "A1", USDC);
    assert_eq!(send(&mut w.svm, &[&stranger], &[ix]).unwrap_err(), NOT_OPERATOR);
    draw(&mut w, "A1", USDC).unwrap();
    assert_eq!(draw(&mut w, "A1", USDC).unwrap_err(), ACCOUNT_IN_USE);
    assert_eq!(balance(&w.svm, &w.user_usdc), USDC);
    assert_eq!(read::<Line>(&w.svm, &w.line).next_seq, 1);
}

#[test]
fn a_draw_is_refused_past_the_limit_beyond_the_vault_while_frozen_or_empty() {
    let mut w = ready(10 * USDC, 100, 8 * USDC);
    assert_eq!(draw(&mut w, "A1", 0).unwrap_err(), EMPTY_AMOUNT);
    assert_eq!(draw(&mut w, "", USDC).unwrap_err(), INVALID_REFERENCE);
    assert_eq!(draw(&mut w, "A1", 10 * USDC).unwrap_err(), LIMIT_EXCEEDED);
    assert_eq!(draw(&mut w, "A1", 8 * USDC + 1).unwrap_err(), INSUFFICIENT_LIQUIDITY);
    draw(&mut w, "A1", 8 * USDC).unwrap();
    assert_eq!(read::<Line>(&w.svm, &w.line).outstanding, 8 * USDC + 80_000);

    let provider = w.provider.insecure_clone();
    let ix = terms_ix(&w, &provider.pubkey(), 100 * USDC, 3 * DAY, 100, true);
    let meta = send(&mut w.svm, &[&provider], &[ix]).unwrap();
    assert!(events::<TermsSet>(&meta)[0].frozen);
    let ix = fund_ix(&w, &provider.pubkey(), w.provider_usdc, 10 * USDC);
    send(&mut w.svm, &[&provider], &[ix]).unwrap();
    assert_eq!(draw(&mut w, "A2", USDC).unwrap_err(), FROZEN);
    let ix = terms_ix(&w, &provider.pubkey(), 100 * USDC, 3 * DAY, 100, false);
    send(&mut w.svm, &[&provider], &[ix]).unwrap();
    draw(&mut w, "A2", USDC).unwrap();
}

#[test]
fn an_overdue_draw_stops_new_draws_until_it_is_repaid() {
    let mut w = ready(500 * USDC, 0, 100 * USDC);
    draw(&mut w, "A1", 5 * USDC).unwrap();
    advance(&mut w.svm, 3 * DAY);
    draw(&mut w, "A2", USDC).unwrap();
    advance(&mut w.svm, 1);
    assert_eq!(draw(&mut w, "A3", USDC).unwrap_err(), OVERDUE);
    give_operator(&mut w, 5 * USDC);
    repay(&mut w, 5 * USDC, &["A1", "A2"]).unwrap();
    let line: Line = read(&w.svm, &w.line);
    assert_eq!((line.head_seq, line.head_due_at), (1, START + 6 * DAY));
    draw(&mut w, "A3", USDC).unwrap();
}

#[test]
fn repayments_go_to_the_oldest_draws_first_and_move_the_head() {
    let mut w = ready(500 * USDC, 10, 100 * USDC);
    draw(&mut w, "A1", 2 * USDC).unwrap();
    advance(&mut w.svm, 60);
    draw(&mut w, "A2", 3 * USDC).unwrap();
    advance(&mut w.svm, 60);
    draw(&mut w, "A3", 4 * USDC).unwrap();
    give_operator(&mut w, 10 * USDC);

    let meta = repay(&mut w, 3 * USDC, &["A1", "A2"]).unwrap();
    let paid = events::<Repaid>(&meta);
    assert_eq!(paid.iter().map(|event| (event.seq, event.amount, event.owed)).collect::<Vec<_>>(), vec![(0, 2_002_000, 0), (1, 998_000, 2_005_000)]);
    let line: Line = read(&w.svm, &w.line);
    assert_eq!((line.head_seq, line.head_due_at, line.repaid), (1, START + 60 + 3 * DAY, 3 * USDC));
    assert_eq!(line.outstanding, 2_002_000 + 3_003_000 + 4_004_000 - 3 * USDC);
    assert_eq!(balance(&w.svm, &w.vault), 100 * USDC - 9 * USDC + 3 * USDC);

    let meta = repay(&mut w, 50 * USDC, &["A2", "A3"]).unwrap();
    assert_eq!(events::<Repaid>(&meta).iter().map(|event| event.amount).sum::<u64>(), 2_005_000 + 4_004_000);
    let line: Line = read(&w.svm, &w.line);
    assert_eq!((line.head_seq, line.next_seq, line.outstanding, line.head_due_at), (3, 3, 0, 0));
    assert_eq!(balance(&w.svm, &w.operator_usdc), 10 * USDC - 3 * USDC - 6_009_000);
    assert_eq!(read::<Draw>(&w.svm, &draw_address(&w.line, "A3")).repaid, 4_004_000);
    assert_eq!(repay(&mut w, USDC, &["A3"]).unwrap_err(), DRAW_OUT_OF_ORDER);
}

#[test]
fn a_repayment_must_start_at_the_head_and_name_the_next_open_draw() {
    let mut w = ready(500 * USDC, 0, 100 * USDC);
    draw(&mut w, "A1", USDC).unwrap();
    draw(&mut w, "A2", USDC).unwrap();
    give_operator(&mut w, 5 * USDC);
    assert_eq!(repay(&mut w, USDC, &["A2"]).unwrap_err(), DRAW_OUT_OF_ORDER);
    assert_eq!(repay(&mut w, USDC, &["A1", "A1"]).unwrap_err(), DRAW_OUT_OF_ORDER);
    assert_eq!(repay(&mut w, USDC, &["A1"]).unwrap_err(), MISSING_HEAD);
    assert_eq!(repay(&mut w, USDC, &[]).unwrap_err(), NOTHING_TO_REPAY);
    assert_eq!(repay(&mut w, 0, &["A1", "A2"]).unwrap_err(), EMPTY_AMOUNT);
    repay(&mut w, USDC, &["A1", "A2"]).unwrap();
    assert_eq!(read::<Line>(&w.svm, &w.line).head_seq, 1);
}

#[test]
fn a_draw_of_another_line_cannot_be_repaid_through_this_one() {
    let mut w = ready(500 * USDC, 0, 100 * USDC);
    draw(&mut w, "A1", USDC).unwrap();
    let other_operator = Keypair::new();
    w.svm.airdrop(&other_operator.pubkey(), 10_000_000_000).unwrap();
    let provider = w.provider.insecure_clone();
    let mut other = World {
        svm: std::mem::replace(&mut w.svm, LiteSVM::default()),
        provider: provider.insecure_clone(),
        operator: other_operator.insecure_clone(),
        stranger: w.stranger.insecure_clone(),
        mint: w.mint,
        line: line_address(&provider.pubkey(), &other_operator.pubkey(), &w.mint),
        vault: vault_address(&line_address(&provider.pubkey(), &other_operator.pubkey(), &w.mint)),
        provider_usdc: w.provider_usdc,
        operator_usdc: Pubkey::new_unique(),
        user_usdc: w.user_usdc,
    };
    let (mint, owner, account) = (other.mint, other_operator.pubkey(), other.operator_usdc);
    set_token(&mut other.svm, account, &mint, &owner, 5 * USDC);
    let ixs = [create_ix(&other, 500 * USDC, 3 * DAY, 0), fund_ix(&other, &provider.pubkey(), other.provider_usdc, 10 * USDC)];
    send(&mut other.svm, &[&provider], &ixs).unwrap();
    draw(&mut other, "B1", USDC).unwrap();
    let foreign = draw_address(&w.line, "A1");
    assert_eq!(repay(&mut other, USDC, &[]).unwrap_err(), NOTHING_TO_REPAY);
    let ix = repay_ix(&other, &other_operator.pubkey(), other.operator_usdc, USDC, &[foreign]);
    assert_eq!(send(&mut other.svm, &[&other_operator], &[ix]).unwrap_err(), WRONG_LINE);
}

#[test]
fn anyone_may_repay_and_only_what_is_owed_moves() {
    let mut w = ready(500 * USDC, 100, 100 * USDC);
    draw(&mut w, "A1", 10 * USDC).unwrap();
    let stranger = w.stranger.insecure_clone();
    let stranger_usdc = Pubkey::new_unique();
    let mint = w.mint;
    set_token(&mut w.svm, stranger_usdc, &mint, &stranger.pubkey(), 50 * USDC);
    let ix = repay_ix(&w, &stranger.pubkey(), stranger_usdc, 50 * USDC, &[draw_address(&w.line, "A1")]);
    send(&mut w.svm, &[&stranger], &[ix]).unwrap();
    assert_eq!(balance(&w.svm, &stranger_usdc), 50 * USDC - 10_100_000);
    assert_eq!(balance(&w.svm, &w.vault), 100 * USDC + 100_000);
    let line: Line = read(&w.svm, &w.line);
    assert_eq!((line.outstanding, line.repaid, line.fees), (0, 10_100_000, 100_000));
}

#[test]
fn terms_change_by_the_provider_alone_and_the_term_only_with_no_open_draw() {
    let mut w = ready(500 * USDC, 10, 100 * USDC);
    let stranger = w.stranger.insecure_clone();
    let ix = terms_ix(&w, &stranger.pubkey(), USDC, 3 * DAY, 10, false);
    assert_eq!(send(&mut w.svm, &[&stranger], &[ix]).unwrap_err(), NOT_PROVIDER);
    draw(&mut w, "A1", USDC).unwrap();
    let provider = w.provider.insecure_clone();
    let ix = terms_ix(&w, &provider.pubkey(), 500 * USDC, 2 * DAY, 10, false);
    assert_eq!(send(&mut w.svm, &[&provider], &[ix]).unwrap_err(), OPEN_DRAWS);
    let ix = terms_ix(&w, &provider.pubkey(), USDC, 3 * DAY, 20, false);
    send(&mut w.svm, &[&provider], &[ix]).unwrap();
    assert_eq!(draw(&mut w, "A2", USDC).unwrap_err(), LIMIT_EXCEEDED);
    give_operator(&mut w, 2 * USDC);
    repay(&mut w, 2 * USDC, &["A1"]).unwrap();
    let ix = terms_ix(&w, &provider.pubkey(), 500 * USDC, DAY, 20, false);
    send(&mut w.svm, &[&provider], &[ix]).unwrap();
    draw(&mut w, "A2", USDC).unwrap();
    let record: Draw = read(&w.svm, &draw_address(&w.line, "A2"));
    assert_eq!((record.fee, record.due_at - record.drawn_at), (2_000, DAY));
    assert_eq!(now(&w.svm), record.drawn_at);
}
