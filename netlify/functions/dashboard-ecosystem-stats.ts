import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

/**
 * Stats per il pannello "DR7 Ecosystem" della Dashboard.
 *
 * Le query qui usano la service role per bypassare RLS — le tabelle
 * wallets / user_credit_balance / credit_transactions /
 * customer_memberships hanno RLS attiva e dal browser tornavano sempre
 * count=0 anche quando in DB c'erano righe reali (motivo per cui il
 * pannello mostrava tutti zero).
 *
 * Niente valori hardcoded: il revenue Club viene dalle transazioni
 * reali (credit_transactions con reference_type relativo a iscrizione
 * Club) oppure dal campo `amount`/`price`/`paid_amount` se esiste in
 * customer_memberships. Cashback dalla somma di card_bonus.
 */
const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: 'Method Not Allowed' }
  }

  try {
    const authHeader = event.headers['authorization']
    if (!authHeader?.startsWith('Bearer ')) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Non autorizzato' }) }
    }

    const authToken = authHeader.replace('Bearer ', '')
    const authClient = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!)
    const { data: { user }, error: authError } = await authClient.auth.getUser(authToken)
    if (authError || !user) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token non valido' }) }
    }

    const supabase = createClient(
      process.env.VITE_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    // 1. Referral wallets (`wallets.balance_cents`).
    const { data: wallets } = await supabase
      .from('wallets')
      .select('balance_cents')
      .gt('balance_cents', 0)
    const referralCount = (wallets || []).length
    const referralEur = (wallets || []).reduce(
      (s, w: { balance_cents?: number }) => s + Number(w.balance_cents || 0) / 100, 0,
    )

    // 2. Wallet del sito (`user_credit_balance.balance`, EUR).
    const { data: creditBals } = await supabase
      .from('user_credit_balance')
      .select('balance')
      .gt('balance', 0)
    const siteCount = (creditBals || []).length
    const siteEur = (creditBals || []).reduce(
      (s, w: { balance?: number }) => s + Number(w.balance || 0), 0,
    )

    // 3. Iscritti Club attivi + revenue Club.
    // Tentiamo di leggere *tutti* i campi e poi cerchiamo runtime un
    // campo "amount-like" (amount / price / paid_amount / total /
    // annual_fee / monthly_fee). Cosi' niente hardcoded.
    const { data: memberships } = await supabase
      .from('customer_memberships')
      .select('*')
      .eq('status', 'active')
    const clubCount = (memberships || []).length
    const PRICE_KEYS = ['amount', 'price', 'paid_amount', 'total', 'annual_fee', 'monthly_fee', 'fee', 'price_paid']
    let clubRevenue = 0
    let priceFieldUsed: string | null = null
    for (const m of (memberships || []) as Array<Record<string, unknown>>) {
      for (const k of PRICE_KEYS) {
        const v = m[k]
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
          clubRevenue += v
          if (!priceFieldUsed) priceFieldUsed = k
          break
        }
      }
    }

    // 4. Cashback: sum di credit_transactions.amount WHERE reference_type='card_bonus'.
    const { data: cashbackRows } = await supabase
      .from('credit_transactions')
      .select('amount')
      .eq('reference_type', 'card_bonus')
    const cashbackTotal = (cashbackRows || []).reduce(
      (s, r: { amount?: number }) => s + Number(r.amount || 0), 0,
    )

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        walletCount: referralCount + siteCount,
        walletTotalBalance: referralEur + siteEur,
        breakdown: { referralCount, referralEur, siteCount, siteEur },
        clubCount,
        clubRevenue,
        priceFieldUsed,
        cashbackTotal,
      }),
    }
  } catch (e) {
    console.error('[dashboard-ecosystem-stats]', e)
    return { statusCode: 500, headers, body: JSON.stringify({ error: (e as Error).message }) }
  }
}

export { handler }
