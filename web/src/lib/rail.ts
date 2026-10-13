import { NETWORK, RAIL_API, type RailId } from '../config'

export type RailSide = 'cashout' | 'repay'

export interface RailQuote {
  price: number
  sellAmount: number
  buyAmount: number
  feeTotal: number
  rate: number
}

export interface PayoutInstruction {
  id: string
  treasury: string
  memo: string
  usdc: number
  tryAmount: number
  token: string
}

export interface DepositInstruction {
  id: string
  iban: string
  reference: string
  usdc: number
  token: string
}

export type ArfRefusal = 'frozen' | 'overdue' | 'limit' | 'liquidity'

export type RailFunding = { source: 'arf'; seq?: number; reference: string; draw: string; fee?: number; dueAt?: number } | { source: 'treasury'; reason?: ArfRefusal }

export interface ArfSweep {
  repaid: number
  signature?: string
  draws: { seq: number; reference: string; amount: number }[]
}

export interface RailSettlement {
  id: string
  status: 'completed'
  sandbox: boolean
  amountOut: number
  externalTransactionId?: string
  signature?: string
  funding?: RailFunding
  arf?: ArfSweep | { error: string }
}

export interface ArfDraw {
  seq: number
  reference: string
  address: string
  amount: number
  fee: number
  repaid: number
  owed: number
  drawnAt: number
  dueAt: number
  status: 'open' | 'repaid' | 'overdue'
}

export type ArfFacility =
  | { enabled: false }
  | {
      enabled: true
      sandbox: boolean
      program: string
      line: string
      provider: string
      operator: string
      vault: string
      limit: number
      termDays: number
      feeBps: number
      frozen: boolean
      outstanding: number
      available: number
      liquidity: number
      drawn: number
      fees: number
      repaid: number
      overdue: number
      count: number
      draws: ArfDraw[]
      updatedAt: number
    }

export interface FiatRail {
  readonly id: RailId
  readonly ready: boolean
  readonly sandbox: boolean
  readonly label: string
  readonly todo: readonly TodoItem[]
  quote(side: RailSide, amount: number): Promise<RailQuote>
  startPayout(account: string, usdc: number): Promise<PayoutInstruction>
  confirmPayout(instruction: PayoutInstruction, signature: string): Promise<RailSettlement>
  startDeposit(account: string, tryAmount: number): Promise<DepositInstruction>
  settleDeposit(instruction: DepositInstruction): Promise<RailSettlement>
}

async function call<T>(action: string, init?: { body?: Record<string, unknown>; query?: Record<string, string> }): Promise<T> {
  const params = new URLSearchParams({ action, ...(init?.query ?? {}) })
  const response = await fetch(`${RAIL_API}?${params}`, init?.body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) } : undefined)
  const body = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `rail ${response.status}`)
  return body
}

export class SandboxRail implements FiatRail {
  readonly id = 'sandbox' as const
  readonly ready = true
  readonly sandbox = true
  readonly label = 'Paralyx sandbox rail'
  readonly todo: readonly TodoItem[] = []

  quote(side: RailSide, amount: number): Promise<RailQuote> {
    return call<RailQuote>('quote', { query: { side, amount: String(amount) } })
  }

  startPayout(account: string, usdc: number): Promise<PayoutInstruction> {
    return call<PayoutInstruction>('payout', { body: { account, usdc } })
  }

  confirmPayout(instruction: PayoutInstruction, signature: string): Promise<RailSettlement> {
    return call<RailSettlement>('confirm', { body: { token: instruction.token, signature } })
  }

  startDeposit(account: string, tryAmount: number): Promise<DepositInstruction> {
    return call<DepositInstruction>('deposit', { body: { account, tryAmount } })
  }

  settleDeposit(instruction: DepositInstruction): Promise<RailSettlement> {
    return call<RailSettlement>('settle', { body: { token: instruction.token } })
  }
}

export class RailNotWired extends Error {
  constructor(step: string) {
    super(`BiLira production rail is not wired yet: ${step}`)
  }
}

export interface TodoItem {
  tr: string
  en: string
}

export const BILIRA_TODO: readonly TodoItem[] = [
  {
    tr: 'Bilira Kripto Varlık Alım Satım Platformu A.Ş. ile iş ortaklığı sözleşmesi ve kurumsal API erişimi. Herkese açık bir çıkış API\'si bulunamadı; entegrasyon şirket üzerinden yürür.',
    en: 'Partner agreement and business API access with Bilira Kripto Varlık Alım Satım Platformu A.Ş.; no public off-ramp API was found, so the integration goes through the company.',
  },
  {
    tr: 'KYC ve AML BiLira\'da kalır: kullanıcı BiLira\'da kimlik doğrular, Paralyx kimlik verisi tutmaz.',
    en: 'KYC and AML stay with BiLira: the user verifies with BiLira, Paralyx keeps no identity data.',
  },
  {
    tr: 'Kur: BiLira\'dan USDC karşılığı TRY teklifi (ya da USDC\'den TRYB\'ye, ardından TRYB itfası), ücret ve geçerlilik süresiyle.',
    en: 'Quote: request BiLira\'s USDC to TRY rate (or USDC to TRYB, then TRYB redemption) with fees and an expiry.',
  },
  {
    tr: 'Ödeme: borç alınan USDC ya da TRYB (Solana mint A94X2fRy3wydNShU4dRaDyap2UuoeWJGWyATtyp61WZf) sipariş referansıyla BiLira yatırma adresine gider; BiLira lirayı kullanıcının kendi IBAN\'ına öder ve banka referansını webhook ile döner.',
    en: 'Payout: send the borrowed USDC, or TRYB (Solana mint A94X2fRy3wydNShU4dRaDyap2UuoeWJGWyATtyp61WZf), to the BiLira deposit address with the order reference; BiLira pays lira to the user\'s own IBAN and returns the bank reference through a webhook.',
  },
  {
    tr: 'Yatırma: kullanıcı sipariş referansıyla BiLira\'ya lira gönderir; BiLira USDC\'yi kullanıcının cüzdanına teslim eder; uygulama Kamino borcunu bununla öder.',
    en: 'Deposit: the user wires lira to BiLira with the order reference; BiLira delivers USDC to the user\'s wallet; the app repays the Kamino debt with it.',
  },
  {
    tr: 'Tamamlanan her ödeme record_payout ile, BiLira sipariş numarası rail_tx_id olarak kaydedilir.',
    en: 'Record every settled payout with record_payout, using BiLira\'s order id as rail_tx_id.',
  },
  {
    tr: 'Lisans: yayından önce BiLira\'nın 7518 sayılı kanun kapsamındaki nihai SPK iznini doğrula; 1 Ekim 2026 itibarıyla SPK\'nın geçici faaliyet listesinde görünüyor.',
    en: 'Licensing: confirm BiLira\'s final CMB (SPK) authorization under Law 7518 before launch; as of 1 October 2026 it appears on SPK\'s provisional operating list.',
  },
]

export class BiLiraDirectRail implements FiatRail {
  readonly id = 'bilira' as const
  readonly ready = false
  readonly sandbox = false
  readonly label = 'BiLira'
  readonly todo = BILIRA_TODO

  quote(): Promise<RailQuote> {
    return Promise.reject(new RailNotWired('quote'))
  }

  startPayout(): Promise<PayoutInstruction> {
    return Promise.reject(new RailNotWired('payout'))
  }

  confirmPayout(): Promise<RailSettlement> {
    return Promise.reject(new RailNotWired('payout confirmation'))
  }

  startDeposit(): Promise<DepositInstruction> {
    return Promise.reject(new RailNotWired('deposit'))
  }

  settleDeposit(): Promise<RailSettlement> {
    return Promise.reject(new RailNotWired('deposit settlement'))
  }
}

export const ARF_TODO: readonly TodoItem[] = [
  {
    tr: 'Arf hattı Paralyx\'in değil, lisanslı ray operatörünün (ör. BiLira) hattıdır: operatör Arf Liquidity\'ye başvurur ve Arf\'ın kurumsal onboarding sürecinden geçer. Arf yalnızca lisanslı finans kuruluşlarıyla çalışır; Paralyx fonları hiçbir zaman tutmaz.',
    en: 'The Arf line belongs to the licensed rail operator (for example BiLira), not to Paralyx: the operator applies for Arf Liquidity and passes Arf\'s institutional onboarding. Arf works only with licensed financial institutions; Paralyx never holds the funds.',
  },
  {
    tr: 'Takas varlığı ve ağ: çekilişlerin ve geri ödemelerin Solana üzerinde USDC ile yapılabildiğini Arf ile teyit et. Arf\'ın herkese açık materyallerinde Circle ve Stellar geçiyor; Solana üzerinde takas belgelenmemiş.',
    en: 'Settlement asset and chain: confirm with Arf that draws and repayments can settle in USDC on Solana. Arf\'s public material names Circle and Stellar; settlement on Solana is not documented.',
  },
  {
    tr: 'Alacak: her çekiliş, operatöre ulaşmış bir lira mevduatına ve kullanıcının açık Kamino borcuna dayanır; mevduat referansı çekilişin referansı olur, sandbox\'ta olduğu gibi.',
    en: 'Receivable: every draw rests on a lira deposit the operator has received and on the user\'s open Kamino debt; the deposit reference becomes the draw reference, as in the sandbox.',
  },
  {
    tr: 'Koşullar: limit, vade (Arf 1 ila 5 gün diyor) ve ücret sözleşmeden gelir. Sandbox değerleri (ARF_LIMIT_USDC, ARF_TERM_DAYS, ARF_FEE_BPS) yer tutucudur, Arf\'ın fiyatı değildir.',
    en: 'Terms: limit, tenor (Arf states 1 to 5 days) and fee come from the agreement. The sandbox values (ARF_LIMIT_USDC, ARF_TERM_DAYS, ARF_FEE_BPS) are placeholders, not Arf\'s pricing.',
  },
  {
    tr: 'Geri ödeme: operatör her çekilişi vadesi içinde, nakit çekimlerden gelen USDC ile ve aldığı lirayı USDC\'ye çevirerek öder. Vadesi geçmiş çekiliş varken yeni çekiliş yapılmaz.',
    en: 'Repayment: the operator repays each draw within its term from cash-out USDC and by converting the lira it received. No new draw while one is overdue.',
  },
  {
    tr: 'Zincir üstü defter: her çekiliş arf_line programında bir hesaptır, her geri ödeme bir olaydır; limit, vade ve ücreti program uygular, Arf hattı dondurabilir. Arf\'ın zincir üstü raporlaması bu koridoru doğrudan okuyabilir.',
    en: 'On-chain ledger: every draw is an account of the arf_line program and every repayment an event; the program enforces limit, term and fee, and Arf can freeze the line. Arf\'s on-chain reporting can read this corridor directly.',
  },
  {
    tr: 'arf_line\'ın bağımsız denetimi ve mainnet\'e deploy\'u; yükseltme yetkisinin Arf ve operatörün ortak çoklu imzasına ya da zaman kilidine taşınması.',
    en: 'An independent audit of arf_line and its mainnet deployment; the upgrade authority moves to a multisig of Arf and the operator, or behind a timelock.',
  },
  {
    tr: 'Hukuk: lira bacağı operatörün 7518 sayılı kanun kapsamındaki SPK iznine, hat ise Arf\'ın İsviçre\'deki düzenlemesine dayanır; yayından önce iki tarafın da hukuki incelemesi gerekir.',
    en: 'Legal: the lira leg rests on the operator\'s CMB (SPK) authorization under Law 7518 and the line on Arf\'s Swiss regulation; both need legal review before launch.',
  },
]

export const rail: FiatRail = NETWORK.rail === 'sandbox' ? new SandboxRail() : new BiLiraDirectRail()

export interface FxReading {
  tryPerUsd: number
  source: string
  publishTime: number
}

export function getFx(): Promise<FxReading> {
  return call<FxReading>('fx')
}

export function getFxHistory(): Promise<{ points: { t: number; v: number }[]; source: string }> {
  return call('fx-history')
}

export function getSolUsd(): Promise<{ solUsd: number; publishTime: number }> {
  return call('sol')
}

export function getSolHistory(range: string): Promise<{ points: { t: number; v: number }[]; source: string }> {
  return call('sol-history', { query: { range } })
}

export function getTreasury(): Promise<{ treasury: string; usdc: number }> {
  return call('treasury')
}

export function getArfFacility(): Promise<ArfFacility> {
  return call('arf')
}
