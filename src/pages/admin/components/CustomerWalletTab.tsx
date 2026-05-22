import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'
import { logger } from '../../../utils/logger'
import { authFetch } from '../../../utils/authFetch'

interface CustomerResult {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  balance_cents: number | null
  user_id?: string | null
  membership_tier?: string | null
  recent_transactions?: { amount_cents: number; created_at: string }[]
}

interface WalletInfo {
  id: string
  customer_id: string
  balance_cents: number
  total_earned_cents: number
  total_spent_cents: number
  created_at: string
  updated_at: string
}

interface WalletTransaction {
  id: string
  wallet_id: string
  type: string
  amount_cents: number
  balance_after_cents: number
  description: string | null
  admin_user_id: string | null
  created_at: string
}

interface PerUserStat {
  spent_cents: number
  recharged_cents: number
  last_used_at: string | null
  tx_count: number
}

interface WalletStats {
  months: string[]
  monthly: Record<string, { credits_cents: number; debits_cents: number }>
  per_user: Record<string, PerUserStat>
  totals: { recharged_cents: number; spent_cents: number; recharged_this_month_cents: number }
}

const TYPE_LABELS: Record<string, string> = {
  registration_bonus: 'Bonus Registrazione',
  referral_friend_topup: 'Bonus Amico Referral',
  milestone_10_friends: 'Milestone 10 Amici',
  topup: 'Ricarica',
  manual_credit: 'Credito Manuale',
  manual_debit: 'Addebito Manuale',
  booking_payment: 'Pagamento Prenotazione',
  refund: 'Rimborso',
}

const TEAL = '#1a3a3a'
const TEAL_LIGHT = '#2a5a5a'
const TEAL_BORDER = '#3a6a6a'

const PAGE_SIZE = 10

const MONTH_LABELS_IT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']

function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number)
  return `${MONTH_LABELS_IT[m - 1]} ${String(y).slice(2)}`
}

function tierBadge(raw: string | null | undefined) {
  if (!raw) return { label: 'STANDARD', cls: 'bg-slate-500/15 text-slate-300 border-slate-500/30' }
  const t = raw.toLowerCase()
  if (t.includes('platino') || t.includes('platinum') || t.includes('elite') || t.includes('signature')) {
    return { label: 'GOLD', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40' }
  }
  if (t.includes('oro') || t.includes('gold') || t.includes('black')) {
    return { label: 'PRO', cls: 'bg-violet-500/15 text-violet-300 border-violet-500/40' }
  }
  if (t.includes('argento') || t.includes('silver') || t.includes('member')) {
    return { label: 'MBR', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/40' }
  }
  return { label: raw.slice(0, 8).toUpperCase(), cls: 'bg-slate-500/15 text-slate-300 border-slate-500/30' }
}

function formatEur(cents: number, frac = 2) {
  return `€${(cents / 100).toLocaleString('it-IT', { minimumFractionDigits: frac, maximumFractionDigits: frac })}`
}

function relativeDate(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function daysAgo(iso: string | null): number | null {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

export default function CustomerWalletTab() {
  const [searchQuery, setSearchQuery] = useState('')
  const [allWalletCustomers, setAllWalletCustomers] = useState<CustomerResult[]>([])
  const [loadingAll, setLoadingAll] = useState(true)
  const [stats, setStats] = useState<WalletStats | null>(null)
  const [page, setPage] = useState(1)

  // Filter chips
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [tierFilter, setTierFilter] = useState<'all' | 'gold' | 'pro' | 'mbr' | 'standard'>('all')

  const [expandedCustomerId, setExpandedCustomerId] = useState<string | null>(null)
  const [expandedTransactions, setExpandedTransactions] = useState<any[]>([])
  const [loadingTransactions, setLoadingTransactions] = useState(false)

  const [modalCustomer, setModalCustomer] = useState<CustomerResult | null>(null)
  const [modalAction, setModalAction] = useState<'credit' | 'debit'>('credit')
  const [wallet, setWallet] = useState<WalletInfo | null>(null)
  const [transactions, setTransactions] = useState<WalletTransaction[]>([])
  const [, setDetailLoading] = useState(false)

  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  const [recurringEnabled, setRecurringEnabled] = useState(false)
  const [recurringDay, setRecurringDay] = useState(1)
  const [recurringHour, setRecurringHour] = useState(9)
  const [recurringAmount, setRecurringAmount] = useState('')
  const [recurringSettings, setRecurringSettings] = useState<Map<string, { day: number; hour?: number; amount: number; active: boolean }>>(new Map())

  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', ''])
  const [sentOtp, setSentOtp] = useState('')
  const [otpSending, setOtpSending] = useState(false)
  const [otpSent, setOtpSent] = useState(false)
  const [otpVerified, setOtpVerified] = useState(false)
  const otpRefs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => { loadAllWalletCustomers() }, [])

  async function loadAllWalletCustomers() {
    setLoadingAll(true)
    try {
      const response = await fetch('/.netlify/functions/list-customers')
      const result = await response.json()
      const allCustomers: any[] = result.customers || []

      const { data: participants } = await supabase
        .from('referral_participants')
        .select('id, telefono')

      const { data: wallets } = await supabase
        .from('wallets')
        .select('participant_id, balance_cents')

      const phoneBalanceMap = new Map<string, number>()
      if (participants && wallets) {
        const participantMap = new Map<string, string>()
        for (const p of participants) {
          if (p.telefono) participantMap.set(p.id, p.telefono)
        }
        for (const w of wallets) {
          const phone = participantMap.get(w.participant_id)
          if (phone && w.balance_cents > 0) {
            phoneBalanceMap.set(phone, (phoneBalanceMap.get(phone) || 0) + w.balance_cents)
          }
        }
      }

      let creditBalances: any[] | null = null
      const token = (await supabase.auth.getSession()).data.session?.access_token
      try {
        const cbRes = await fetch('/.netlify/functions/customer-wallet-admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: 'list_all_balances' })
        })
        const cbData = await cbRes.json()
        if (cbData.success) creditBalances = cbData.balances
      } catch (e) {
        logger.warn('Failed to load credit balances via function, trying direct:', e)
      }
      if (!creditBalances) {
        const { data } = await supabase.from('user_credit_balance').select('user_id, balance')
        creditBalances = data
      }

      const userCreditMap = new Map<string, number>()
      if (creditBalances) {
        for (const cb of creditBalances) {
          if (cb.balance && cb.balance > 0) {
            userCreditMap.set(cb.user_id, Math.round(cb.balance * 100))
          }
        }
      }

      const mapped: CustomerResult[] = allCustomers.map((cust: any) => {
        const phone = cust.telefono || null
        const referralBalance = phone ? (phoneBalanceMap.get(phone) || 0) : 0
        const creditBalance = cust.user_id ? (userCreditMap.get(cust.user_id) || 0) : 0
        const totalBalance = referralBalance + creditBalance
        return {
          id: cust.id,
          full_name: (`${cust.nome || ''} ${cust.cognome || ''}`.trim() || cust.ragione_sociale || cust.denominazione || 'N/A'),
          email: cust.email || null,
          phone,
          balance_cents: totalBalance,
          user_id: cust.user_id || null,
          membership_tier: cust.membership_tier || null,
        }
      })

      mapped.sort((a, b) => {
        if ((b.balance_cents || 0) !== (a.balance_cents || 0)) return (b.balance_cents || 0) - (a.balance_cents || 0)
        return (a.full_name || '').localeCompare(b.full_name || '')
      })

      setAllWalletCustomers(mapped)

      const { data: custExtended } = await supabase
        .from('customers_extended')
        .select('id, metadata')
        .not('metadata->wallet_recurring', 'is', 'null')
      if (custExtended) {
        const rMap = new Map<string, { day: number; hour?: number; amount: number; active: boolean }>()
        for (const c of custExtended) {
          const r = c.metadata?.wallet_recurring
          if (r && r.active) rMap.set(c.id, r)
        }
        setRecurringSettings(rMap)
      }

      // Aggregated transaction stats (last 6 months)
      try {
        const statsRes = await fetch('/.netlify/functions/customer-wallet-admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: 'wallet_stats' })
        })
        const statsData = await statsRes.json()
        if (statsData.success) setStats(statsData)
      } catch (e) {
        logger.warn('wallet_stats failed:', e)
      }
    } catch (err) {
      console.error('Error loading customers:', err)
    } finally {
      setLoadingAll(false)
    }
  }

  async function saveRecurring(customerId: string, settings: { day: number; hour?: number; amount: number; active: boolean } | null) {
    try {
      const { data: cust } = await supabase.from('customers_extended').select('metadata').eq('id', customerId).single()
      const meta = cust?.metadata || {}
      const { error } = await supabase.from('customers_extended').update({
        metadata: { ...meta, wallet_recurring: settings }
      }).eq('id', customerId)
      if (error) throw error
      if (settings?.active) {
        setRecurringSettings(prev => new Map(prev).set(customerId, settings))
      } else {
        setRecurringSettings(prev => { const m = new Map(prev); m.delete(customerId); return m })
      }
      toast.success(settings?.active ? 'Ricarica automatica attivata' : 'Ricarica automatica disattivata')
    } catch (err) {
      toast.error('Errore salvataggio: ' + (err instanceof Error ? err.message : 'Errore'))
    }
  }

  async function apiCall(body: Record<string, any>) {
    const token = (await supabase.auth.getSession()).data.session?.access_token
    const res = await fetch('/.netlify/functions/customer-wallet-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok && !data.error) {
      data.error = `HTTP ${res.status}: ${JSON.stringify(data).substring(0, 200)}`
    }
    return data
  }

  async function toggleExpandCustomer(customer: CustomerResult) {
    if (expandedCustomerId === customer.id) {
      setExpandedCustomerId(null)
      return
    }
    setExpandedCustomerId(customer.id)
    setLoadingTransactions(true)
    setExpandedTransactions([])
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      const res = await fetch('/.netlify/functions/customer-wallet-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'credit_transactions', customer_id: customer.id, user_id: customer.user_id })
      })
      const data = await res.json()
      if (data.success) setExpandedTransactions(data.transactions || [])
    } catch (e) {
      console.error('Failed to load transactions:', e)
    } finally {
      setLoadingTransactions(false)
    }
  }

  async function openModal(customer: CustomerResult, action: 'credit' | 'debit') {
    setModalCustomer(customer)
    setModalAction(action)
    setAmount('')
    setDescription('')
    setOtpDigits(['', '', '', '', '', ''])
    setSentOtp('')
    setOtpSent(false)
    setOtpVerified(false)
    const existing = recurringSettings.get(customer.id)
    setRecurringEnabled(!!existing?.active)
    setRecurringDay(existing?.day || 1)
    setRecurringHour(Number.isFinite(existing?.hour) ? Number(existing?.hour) : 9)
    setRecurringAmount(existing ? String(existing.amount) : '')
    setDetailLoading(true)
    setWallet(null)
    setTransactions([])

    try {
      const data = await apiCall({ action: 'transactions', customer_id: customer.id })
      if (data.success) {
        setWallet(data.wallet)
        setTransactions(data.transactions)
      }
    } catch {
      toast.error('Errore caricamento dettagli')
    }
    setDetailLoading(false)
  }

  function closeModal() {
    setModalCustomer(null)
    setOtpSent(false)
    setOtpVerified(false)
    setSentOtp('')
    setOtpDigits(['', '', '', '', '', ''])
  }

  async function sendOtp() {
    if (!modalCustomer) return
    const parsedAmount = parseFloat(amount)
    const recurringAmountNum = parseFloat(recurringAmount || '')
    const isRecurringOnly = (!parsedAmount || parsedAmount <= 0)
      && modalAction === 'credit'
      && recurringEnabled
      && Number.isFinite(recurringAmountNum)
      && recurringAmountNum > 0
    const otpAmount = parsedAmount > 0 ? parsedAmount : (isRecurringOnly ? recurringAmountNum : 0)
    if (otpAmount <= 0) {
      toast.error('Inserisci un importo (singolo o ricorrente) prima di chiedere l\'OTP')
      return
    }
    setOtpSending(true)
    try {
      const code = String(Math.floor(100000 + Math.random() * 900000))
      setSentOtp(code)
      const res = await authFetch('/.netlify/functions/send-wallet-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          action: modalAction,
          customerName: modalCustomer.full_name,
          amount: otpAmount.toFixed(2),
          description: description || (isRecurringOnly ? `Programmazione ricarica mensile €${otpAmount.toFixed(2)} il ${recurringDay} di ogni mese` : '')
        })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      const data = await res.json().catch(() => ({}))
      if (data.autoApproved) {
        setOtpSent(true)
        setOtpVerified(true)
        setOtpDigits(code.split(''))
        toast.success('Approvato direttamente (direzione)')
      } else {
        setOtpSent(true)
        setOtpVerified(false)
        setOtpDigits(['', '', '', '', '', ''])
        toast.success('Codice di verifica inviato via email')
        setTimeout(() => otpRefs.current[0]?.focus(), 100)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[wallet-otp] send failed:', err)
      toast.error('Errore invio codice OTP: ' + msg)
    } finally {
      setOtpSending(false)
    }
  }

  function verifyOtp() {
    const code = otpDigits.join('')
    if (code === sentOtp) {
      setOtpVerified(true)
      toast.success('Codice verificato!')
    } else {
      toast.error('Codice errato')
    }
  }

  async function handleConfirm() {
    if (!modalCustomer) return
    const recurringAmountNum = parseFloat(recurringAmount || '')
    const wantsRecurringOnly =
      !amount
      && modalAction === 'credit'
      && recurringEnabled
      && Number.isFinite(recurringAmountNum)
      && recurringAmountNum > 0
    if (wantsRecurringOnly) {
      if (!otpVerified) { sendOtp(); return }
      setActionLoading(true)
      try {
        await saveRecurring(modalCustomer.id, { day: recurringDay, hour: recurringHour, amount: recurringAmountNum, active: true })
        toast.success(`Ricarica automatica salvata: €${recurringAmountNum.toFixed(2)} il ${recurringDay} di ogni mese alle ${String(recurringHour).padStart(2, '0')}:00`)
        closeModal()
        loadAllWalletCustomers()
      } catch (err: unknown) {
        const _errMsg = err instanceof Error ? err.message : String(err)
        toast.error('Errore salvataggio programmazione: ' + (_errMsg || ''))
      } finally {
        setActionLoading(false)
      }
      return
    }

    if (!amount) return
    const parsedAmount = parseFloat(amount)
    if (!parsedAmount || parsedAmount <= 0) return
    if (!otpVerified) { sendOtp(); return }

    setActionLoading(true)
    try {
      const data = await apiCall({
        action: modalAction,
        customer_id: modalCustomer.id,
        amount: parsedAmount,
        description: description || undefined,
      })
      if (data.success) {
        toast.success(`${modalAction === 'credit' ? 'Credito' : 'Addebito'} di €${parsedAmount.toFixed(2)} applicato`)
        if (modalAction === 'credit' && recurringEnabled && recurringAmount) {
          await saveRecurring(modalCustomer.id, { day: recurringDay, hour: recurringHour, amount: parseFloat(recurringAmount), active: true })
        } else if (modalAction === 'credit' && !recurringEnabled && recurringSettings.has(modalCustomer.id)) {
          await saveRecurring(modalCustomer.id, null)
        }
        setAllWalletCustomers(prev => prev.map(c =>
          c.id === modalCustomer.id ? { ...c, balance_cents: data.new_balance_cents } : c
        ))
        closeModal()
        loadAllWalletCustomers()
      } else {
        console.error('[Wallet] API error:', data)
        toast.error(data.error || `Errore: ${JSON.stringify(data).substring(0, 150)}`)
      }
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error('Errore di connessione: ' + (_errMsg || ''))
    }
    setActionLoading(false)
  }

  const initials = (name: string) => {
    const parts = name.split(' ').filter(Boolean)
    return parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}`.toUpperCase() : name.substring(0, 2).toUpperCase()
  }
  const formatEurDec = (cents: number) => `€${(cents / 100).toFixed(2)}`

  // ── Derived metrics ────────────────────────────────────────────────────
  const totalBalance = allWalletCustomers.reduce((s, c) => s + (c.balance_cents || 0), 0)
  const activeCustomers = allWalletCustomers.filter(c => (c.balance_cents || 0) > 0)
  const activeCount = activeCustomers.length
  const totalCount = allWalletCustomers.length
  const inactiveCount = totalCount - activeCount

  const rechargedThisMonthCents = stats?.totals.recharged_this_month_cents || 0
  const reusedCents = stats?.totals.spent_cents || 0
  const totalRechargedCents = stats?.totals.recharged_cents || 0
  const conversionPct = totalRechargedCents > 0
    ? Math.round((reusedCents / totalRechargedCents) * 100)
    : 0

  // Donut: utilizzato / disponibile / inattivo (saldo non toccato >90gg)
  const activeBalance = activeCustomers.reduce((s, c) => {
    const u = stats?.per_user?.[c.user_id || ''] || null
    const d = daysAgo(u?.last_used_at || null)
    if (d == null || d > 90) return s
    return s + (c.balance_cents || 0)
  }, 0)
  const inactiveBalance = totalBalance - activeBalance
  const usedDisplayCents = reusedCents

  const donutTotal = Math.max(1, usedDisplayCents + activeBalance + inactiveBalance)
  const usedFrac = usedDisplayCents / donutTotal
  const availFrac = activeBalance / donutTotal
  const inactiveFrac = inactiveBalance / donutTotal

  // Top 3 lists
  const topBalances = [...activeCustomers]
    .sort((a, b) => (b.balance_cents || 0) - (a.balance_cents || 0))
    .slice(0, 3)

  const inactiveCandidates = useMemo(() => {
    if (!stats) return [] as Array<{ c: CustomerResult; days: number }>
    return activeCustomers
      .map(c => {
        const u = stats.per_user[c.user_id || '']
        const d = daysAgo(u?.last_used_at || null)
        return { c, days: d == null ? 9999 : d }
      })
      .filter(x => x.days >= 90)
      .sort((a, b) => b.days - a.days)
      .slice(0, 3)
  }, [stats, activeCustomers])

  const recurringEntries: Array<{ id: string; name: string; amountEur: number; day: number; hour: number }> = []
  for (const c of allWalletCustomers) {
    const r = recurringSettings.get(c.id)
    if (!r || !r.active) continue
    const amountEur = Number(r.amount || 0)
    const day = Number(r.day || 0)
    const hour = Number.isFinite(r.hour) ? Number(r.hour) : 9
    if (amountEur > 0) {
      recurringEntries.push({ id: c.id, name: c.full_name || c.email || c.phone || 'N/A', amountEur, day, hour })
    }
  }
  const recurringActiveCount = recurringEntries.length
  const recurringMonthlyTotalEur = recurringEntries.reduce((s, e) => s + e.amountEur, 0)
  const recurringTop = [...recurringEntries].sort((a, b) => b.amountEur - a.amountEur).slice(0, 3)

  // Filter + paginate
  const filtered = allWalletCustomers.filter(c => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      const hit = (c.full_name?.toLowerCase().includes(q)) ||
                  (c.email?.toLowerCase().includes(q)) ||
                  (c.phone?.includes(q))
      if (!hit) return false
    }
    const balance = c.balance_cents || 0
    if (statusFilter === 'active' && balance <= 0) return false
    if (statusFilter === 'inactive' && balance > 0) return false
    if (tierFilter !== 'all') {
      const tb = tierBadge(c.membership_tier).label.toLowerCase()
      if (tierFilter === 'gold' && tb !== 'gold') return false
      if (tierFilter === 'pro' && tb !== 'pro') return false
      if (tierFilter === 'mbr' && tb !== 'mbr') return false
      if (tierFilter === 'standard' && tb !== 'standard') return false
    }
    return true
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  // ── Chart helpers ──────────────────────────────────────────────────────
  const chart = useMemo(() => {
    if (!stats) return null
    const months = stats.months
    const credits = months.map(m => (stats.monthly[m]?.credits_cents || 0) / 100)
    const debits = months.map(m => (stats.monthly[m]?.debits_cents || 0) / 100)
    const max = Math.max(1, ...credits, ...debits)
    const W = 560, H = 180, PAD_L = 32, PAD_R = 10, PAD_T = 14, PAD_B = 26
    const innerW = W - PAD_L - PAD_R
    const innerH = H - PAD_T - PAD_B
    const xAt = (i: number) => PAD_L + (months.length <= 1 ? innerW / 2 : (i * innerW) / (months.length - 1))
    const yAt = (v: number) => PAD_T + innerH - (v / max) * innerH
    const path = (vals: number[]) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(v)}`).join(' ')
    const area = (vals: number[]) => `${path(vals)} L ${xAt(vals.length - 1)} ${PAD_T + innerH} L ${xAt(0)} ${PAD_T + innerH} Z`
    return { W, H, PAD_L, PAD_R, PAD_T, PAD_B, innerW, innerH, months, credits, debits, max, xAt, yAt, path, area }
  }, [stats])

  return (
    <div className="space-y-4 lg:space-y-5">
      {/* Header */}
      <div className="relative overflow-hidden bg-gradient-to-br from-theme-bg-secondary via-theme-bg-secondary to-theme-bg-tertiary rounded-2xl border border-theme-border p-5 lg:p-6">
        <div className="absolute -top-12 -right-12 w-56 h-56 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"/>
        <div className="absolute -bottom-12 -left-12 w-56 h-56 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"/>
        <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/30 grid place-items-center flex-shrink-0">
              <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 10h18M7 15h2m4 0h6m-9 5h12a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
              </svg>
            </div>
            <div className="min-w-0">
              <h2 className="text-xl lg:text-2xl font-bold text-theme-text-primary leading-tight">Credit Wallet Clienti</h2>
              <p className="text-xs lg:text-sm text-theme-text-muted mt-0.5">Gestisci i wallet e il credito dei tuoi clienti</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button className="px-3 py-2 text-xs font-semibold text-theme-text-secondary bg-theme-bg-tertiary border border-theme-border rounded-lg hover:bg-theme-bg-hover transition-colors flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              Impostazioni Wallet
            </button>
            <button className="px-3 py-2 text-xs font-semibold text-theme-text-secondary bg-theme-bg-tertiary border border-theme-border rounded-lg hover:bg-theme-bg-hover transition-colors flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
              Esporta Report
            </button>
            <button
              onClick={() => { if (allWalletCustomers[0]) openModal(allWalletCustomers[0], 'credit') }}
              className="px-3.5 py-2 text-xs font-bold text-white rounded-lg shadow-lg shadow-emerald-500/20 hover:opacity-90 transition-opacity flex items-center gap-1.5"
              style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
              Nuova Ricarica
            </button>
          </div>
        </div>
      </div>

      {/* 5 KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 lg:gap-4">
        <KpiCard
          label="Totale wallet sistema"
          value={formatEur(totalBalance)}
          hint={`+${activeCount} clienti attivi`}
          color="blue"
          icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h2m4 0h6M5 6h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z"/>}
        />
        <KpiCard
          label="Credito attivo"
          value={formatEur(activeBalance)}
          hint={`${totalBalance > 0 ? Math.round((activeBalance / totalBalance) * 100) : 0}% del totale`}
          color="emerald"
          icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>}
        />
        <KpiCard
          label="Ricariche questo mese"
          value={formatEur(rechargedThisMonthCents)}
          hint="da inizio mese"
          color="purple"
          icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>}
        />
        <KpiCard
          label="Credito riutilizzato"
          value={formatEur(reusedCents)}
          hint="utilizzi ultimi 6 mesi"
          color="amber"
          icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z"/>}
        />
        <KpiCard
          label="Conversione wallet → spesa"
          value={`${conversionPct}%`}
          hint="utilizzato / caricato"
          color="cyan"
          icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/>}
        />
      </div>

      {/* Middle row: Chart + Azioni + Riepilogo */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Line chart */}
        <div className="lg:col-span-5 rounded-2xl border border-theme-border bg-gradient-to-br from-theme-bg-secondary to-theme-bg-tertiary p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-theme-text-primary">Andamento Ricariche & Utilizzi</h3>
            <div className="flex items-center gap-3 text-[10px]">
              <span className="flex items-center gap-1.5 text-theme-text-secondary"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-400"></span>Ricariche</span>
              <span className="flex items-center gap-1.5 text-theme-text-secondary"><span className="w-2.5 h-2.5 rounded-sm bg-purple-400"></span>Utilizzi</span>
            </div>
          </div>
          {!chart ? (
            <div className="h-[180px] grid place-items-center text-xs text-theme-text-muted">
              {loadingAll ? 'Caricamento...' : 'Dati insufficienti'}
            </div>
          ) : (
            <svg viewBox={`0 0 ${chart.W} ${chart.H}`} className="w-full h-[180px]" preserveAspectRatio="none">
              <defs>
                <linearGradient id="grCredits" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.35"/>
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0"/>
                </linearGradient>
                <linearGradient id="grDebits" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.3"/>
                  <stop offset="100%" stopColor="#a78bfa" stopOpacity="0"/>
                </linearGradient>
              </defs>
              {/* gridlines */}
              {[0.25, 0.5, 0.75, 1].map(f => (
                <line key={f} x1={chart.PAD_L} x2={chart.W - chart.PAD_R}
                  y1={chart.PAD_T + chart.innerH * (1 - f)}
                  y2={chart.PAD_T + chart.innerH * (1 - f)}
                  stroke="currentColor" strokeOpacity="0.08" strokeDasharray="3 3" className="text-theme-text-muted"/>
              ))}
              {/* areas */}
              <path d={chart.area(chart.credits)} fill="url(#grCredits)"/>
              <path d={chart.area(chart.debits)} fill="url(#grDebits)"/>
              {/* lines */}
              <path d={chart.path(chart.credits)} fill="none" stroke="#10b981" strokeWidth={2}/>
              <path d={chart.path(chart.debits)} fill="none" stroke="#a78bfa" strokeWidth={2}/>
              {/* points */}
              {chart.credits.map((v, i) => (
                <circle key={`c${i}`} cx={chart.xAt(i)} cy={chart.yAt(v)} r={3} fill="#10b981"/>
              ))}
              {chart.debits.map((v, i) => (
                <circle key={`d${i}`} cx={chart.xAt(i)} cy={chart.yAt(v)} r={3} fill="#a78bfa"/>
              ))}
              {/* x labels */}
              {chart.months.map((m, i) => (
                <text key={m} x={chart.xAt(i)} y={chart.H - 8} textAnchor="middle"
                  fontSize="10" className="fill-current text-theme-text-muted">{monthLabel(m)}</text>
              ))}
            </svg>
          )}
        </div>

        {/* Azioni rapide */}
        <div className="lg:col-span-4 rounded-2xl border border-theme-border bg-gradient-to-br from-theme-bg-secondary to-theme-bg-tertiary p-4">
          <h3 className="text-sm font-bold text-theme-text-primary mb-3">Azioni Rapide</h3>
          <div className="grid grid-cols-2 gap-2">
            <QuickAction label="Ricarica Cliente" color="emerald" onClick={() => { if (allWalletCustomers[0]) openModal(allWalletCustomers[0], 'credit') }}
              icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>}/>
            <QuickAction label="Scarica Bilancio" color="blue" onClick={() => toast('Export bilancio in arrivo')}
              icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>}/>
            <QuickAction label="Bonus / Promozione" color="amber" onClick={() => toast('Promozioni gestite da Centralina Pro')}
              icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>}/>
            <QuickAction label="Movimenti Generali" color="purple" onClick={() => toast('Movimenti: usa "Dettagli" sul cliente')}
              icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>}/>
            <QuickAction label="Wallet Bloccati" color="rose" onClick={() => toast('Nessun wallet bloccato')}
              icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>}/>
            <QuickAction label="Impostazioni Auto" color="cyan" onClick={() => toast('Le ricariche automatiche si gestiscono dal cliente')}
              icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>}/>
          </div>
        </div>

        {/* Donut + Promo */}
        <div className="lg:col-span-3 space-y-3">
          <div className="rounded-2xl border border-theme-border bg-gradient-to-br from-theme-bg-secondary to-theme-bg-tertiary p-4">
            <h3 className="text-sm font-bold text-theme-text-primary mb-2">Riepilogo Wallet</h3>
            <div className="flex items-center gap-3">
              <Donut used={usedFrac} avail={availFrac} inactive={inactiveFrac}
                centerLabel={formatEur(totalBalance, 0).replace('€', '€ ')}/>
              <div className="flex-1 space-y-1.5 text-[11px]">
                <LegendRow color="bg-emerald-400" label="Utilizzato" value={formatEur(usedDisplayCents, 0)} pct={Math.round(usedFrac * 100)}/>
                <LegendRow color="bg-blue-400" label="Disponibile" value={formatEur(activeBalance, 0)} pct={Math.round(availFrac * 100)}/>
                <LegendRow color="bg-amber-400" label="Inattivo >90gg" value={formatEur(inactiveBalance, 0)} pct={Math.round(inactiveFrac * 100)}/>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-transparent p-4">
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">Promozione attiva</div>
                <div className="text-sm font-bold text-theme-text-primary mt-1">Ricarica €100 e Ricevi +€10</div>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold">ATTIVA</span>
            </div>
            <p className="text-[11px] text-theme-text-muted">Bonus automatico sulle ricariche ≥ €100</p>
          </div>
        </div>
      </div>

      {/* Search + filters */}
      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1) }}
            placeholder="Cerca cliente per nome, email o telefono..."
            className="w-full pl-10 pr-4 py-3 bg-theme-bg-secondary border border-theme-border rounded-xl text-theme-text-primary outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 transition-all"
          />
        </div>
        <div className="flex items-center gap-2">
          <FilterChip active={statusFilter === 'all'} onClick={() => { setStatusFilter('all'); setPage(1) }}>Tutti gli stati</FilterChip>
          <FilterChip active={statusFilter === 'active'} onClick={() => { setStatusFilter('active'); setPage(1) }}>Attivi</FilterChip>
          <FilterChip active={statusFilter === 'inactive'} onClick={() => { setStatusFilter('inactive'); setPage(1) }}>Inattivi</FilterChip>
        </div>
        <select
          value={tierFilter}
          onChange={e => { setTierFilter(e.target.value as any); setPage(1) }}
          className="px-3 py-3 bg-theme-bg-secondary border border-theme-border rounded-xl text-theme-text-primary text-sm outline-none"
        >
          <option value="all">Tutti i livelli</option>
          <option value="gold">Gold</option>
          <option value="pro">Pro</option>
          <option value="mbr">Member</option>
          <option value="standard">Standard</option>
        </select>
        <button className="px-3 py-3 bg-theme-bg-secondary border border-theme-border rounded-xl text-theme-text-primary text-sm font-semibold flex items-center gap-1.5 hover:bg-theme-bg-hover transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"/></svg>
          Filtri Avanzati
        </button>
      </div>

      {/* Main grid: table + sidebar */}
      <div className="lg:flex lg:gap-4 lg:items-start">
        <div className="lg:flex-1 lg:min-w-0">
          {loadingAll ? (
            <div className="text-center py-16 text-theme-text-muted bg-theme-bg-secondary border border-theme-border rounded-2xl">Caricamento wallet...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-theme-text-muted bg-theme-bg-secondary border border-theme-border rounded-2xl">Nessun cliente con wallet trovato</div>
          ) : (
            <div className="bg-theme-bg-secondary border border-theme-border rounded-2xl overflow-hidden">
              <div className="hidden lg:grid grid-cols-[2.2fr_1.8fr_0.8fr_1.1fr_1.4fr_1.1fr_1.2fr_0.9fr_36px] gap-3 px-4 py-3 border-b border-theme-border text-[10px] font-bold text-theme-text-muted uppercase tracking-wider">
                <span>Cliente</span>
                <span>Contatti</span>
                <span>Livello</span>
                <span className="text-right">Saldo Wallet</span>
                <span>Utilizzo Medio</span>
                <span className="text-right">Spesa Totale</span>
                <span>Ultimo Utilizzo</span>
                <span>Stato</span>
                <span></span>
              </div>

              <div className="divide-y divide-theme-border/40">
                {pageRows.map(customer => {
                  const balance = customer.balance_cents || 0
                  const isActive = balance > 0
                  const u = stats?.per_user?.[customer.user_id || '']
                  const spent = u?.spent_cents || 0
                  const recharged = u?.recharged_cents || 0
                  const totalFlow = spent + recharged + balance
                  const usagePct = totalFlow > 0 ? Math.min(100, Math.round((spent / Math.max(spent + balance, 1)) * 100)) : 0
                  const lastUsed = u?.last_used_at || null
                  const tier = tierBadge(customer.membership_tier)
                  const palettes = [
                    'bg-rose-500/20 text-rose-300 border-rose-500/40',
                    'bg-amber-500/20 text-amber-300 border-amber-500/40',
                    'bg-blue-500/20 text-blue-300 border-blue-500/40',
                    'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
                    'bg-purple-500/20 text-purple-300 border-purple-500/40',
                    'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
                    'bg-orange-500/20 text-orange-300 border-orange-500/40',
                    'bg-pink-500/20 text-pink-300 border-pink-500/40',
                  ]
                  let hash = 0
                  for (let i = 0; i < customer.id.length; i++) hash = (hash * 31 + customer.id.charCodeAt(i)) | 0
                  const avatarColor = palettes[Math.abs(hash) % palettes.length]
                  const hasRecurring = recurringSettings.has(customer.id)

                  return (
                    <div key={customer.id} className="hover:bg-white/[0.02] transition-colors">
                      <div className="grid grid-cols-1 lg:grid-cols-[2.2fr_1.8fr_0.8fr_1.1fr_1.4fr_1.1fr_1.2fr_0.9fr_36px] gap-3 px-4 py-3 items-center">
                        {/* Cliente */}
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-10 h-10 rounded-full grid place-items-center text-sm font-bold border flex-shrink-0 ${avatarColor}`}>
                            {initials(customer.full_name)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-theme-text-primary truncate">{customer.full_name}</p>
                            <p className="text-[11px] text-theme-text-muted truncate">ID #{customer.id.slice(0, 8)}</p>
                          </div>
                        </div>
                        {/* Contatti */}
                        <div className="min-w-0 text-[11px]">
                          <p className="text-theme-text-secondary truncate">{customer.email || '—'}</p>
                          <p className="text-theme-text-muted truncate">{customer.phone || '—'}</p>
                        </div>
                        {/* Livello */}
                        <div>
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide border ${tier.cls}`}>
                            {tier.label}
                          </span>
                        </div>
                        {/* Saldo */}
                        <div className={`text-sm font-bold tabular-nums text-right ${
                          balance >= 50000 ? 'text-emerald-400'
                          : balance > 0 ? 'text-theme-text-primary'
                          : 'text-theme-text-muted'
                        }`}>
                          {formatEur(balance)}
                        </div>
                        {/* Utilizzo medio (bar) */}
                        <div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-theme-bg-tertiary rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${usagePct}%`, background: usagePct >= 75 ? '#10b981' : usagePct >= 40 ? '#f59e0b' : '#64748b' }}
                              />
                            </div>
                            <span className="text-[10px] font-semibold text-theme-text-secondary tabular-nums w-9 text-right">{usagePct}%</span>
                          </div>
                        </div>
                        {/* Spesa totale */}
                        <div className="text-sm font-semibold text-theme-text-primary tabular-nums text-right">
                          {formatEur(spent)}
                        </div>
                        {/* Ultimo utilizzo */}
                        <div className="text-[11px] text-theme-text-secondary">
                          {relativeDate(lastUsed)}
                        </div>
                        {/* Stato */}
                        <div>
                          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${
                            isActive
                              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                              : 'bg-slate-500/15 text-slate-400 border-slate-500/40'
                          }`}>
                            {isActive ? 'Attivo' : 'Inattivo'}
                          </span>
                          {hasRecurring && (
                            <span className="ml-1 px-1 py-0.5 rounded text-[9px] font-bold uppercase bg-amber-500/15 text-amber-300 border border-amber-500/40">Auto</span>
                          )}
                        </div>
                        {/* Actions */}
                        <div className="flex justify-end">
                          <button
                            onClick={() => openModal(customer, 'credit')}
                            title="Ricarica wallet"
                            className="w-8 h-8 rounded-lg grid place-items-center text-theme-text-muted hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01"/></svg>
                          </button>
                        </div>
                      </div>

                      {/* Expanded transactions */}
                      {expandedCustomerId === customer.id && (
                        <div className="px-4 pb-4 -mt-1">
                          <div className="bg-theme-bg-primary/50 rounded-lg border border-theme-border/50 p-3">
                            {loadingTransactions ? (
                              <p className="text-xs text-theme-text-muted text-center py-2">Caricamento...</p>
                            ) : expandedTransactions.length === 0 ? (
                              <p className="text-xs text-theme-text-muted text-center py-2">Nessuna transazione</p>
                            ) : (
                              <div className="space-y-1 max-h-60 overflow-y-auto">
                                {expandedTransactions.map((txn: any, i: number) => (
                                  <div key={txn.id || i} className="flex justify-between items-center text-xs py-1.5 px-2 rounded hover:bg-theme-bg-tertiary/30">
                                    <div className="flex-1 min-w-0">
                                      <span className={`font-semibold ${txn.transaction_type === 'credit' ? 'text-green-400' : 'text-red-400'}`}>
                                        {txn.transaction_type === 'credit' ? '+' : '-'}€{Math.abs(Number(txn.amount)).toFixed(2)}
                                      </span>
                                      <span className="text-theme-text-muted ml-2 truncate">{txn.description || '-'}</span>
                                    </div>
                                    <div className="text-theme-text-muted whitespace-nowrap ml-2">
                                      {new Date(txn.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="px-4 pb-2 -mt-1.5">
                        <button onClick={() => toggleExpandCustomer(customer)} className="text-[11px] text-blue-400 hover:text-blue-300">
                          {expandedCustomerId === customer.id ? 'Chiudi dettagli' : 'Vedi movimenti'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-theme-border text-[11px] text-theme-text-muted">
                <span>Mostra <strong className="text-theme-text-primary">{pageRows.length}</strong> di <strong className="text-theme-text-primary">{filtered.length}</strong> clienti</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={safePage === 1}
                    className="w-7 h-7 rounded-md grid place-items-center text-theme-text-secondary hover:bg-theme-bg-tertiary disabled:opacity-30"
                  >‹</button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let n = i + 1
                    if (totalPages > 5) {
                      if (safePage <= 3) n = i + 1
                      else if (safePage >= totalPages - 2) n = totalPages - 4 + i
                      else n = safePage - 2 + i
                    }
                    return (
                      <button
                        key={n}
                        onClick={() => setPage(n)}
                        className={`w-7 h-7 rounded-md grid place-items-center text-[11px] font-semibold ${
                          n === safePage
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'text-theme-text-secondary hover:bg-theme-bg-tertiary'
                        }`}
                      >{n}</button>
                    )
                  })}
                  {totalPages > 5 && safePage < totalPages - 2 && <span className="text-theme-text-muted px-1">…</span>}
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={safePage === totalPages}
                    className="w-7 h-7 rounded-md grid place-items-center text-theme-text-secondary hover:bg-theme-bg-tertiary disabled:opacity-30"
                  >›</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <aside className="hidden lg:block w-72 flex-shrink-0 space-y-4 lg:sticky lg:top-4">
          {/* Ricariche Automatiche */}
          <div className="rounded-2xl border border-theme-border bg-gradient-to-br from-theme-bg-secondary to-theme-bg-tertiary p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-theme-text-primary uppercase tracking-wider">Ricariche Automatiche</h3>
              <button className="text-[10px] text-emerald-400 font-semibold hover:underline">Vedi tutto</button>
            </div>
            {recurringTop.length === 0 ? (
              <div className="text-xs text-theme-text-muted py-3 text-center">Nessuna attiva</div>
            ) : (
              <div className="space-y-3">
                {recurringTop.map(r => (
                  <div key={r.id} className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-amber-500/15 border border-amber-500/30 grid place-items-center flex-shrink-0">
                      <svg className="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-theme-text-primary font-semibold truncate">{r.name}</div>
                      <div className="text-[10px] text-theme-text-muted">il {r.day} ogni mese · ore {String(r.hour).padStart(2, '0')}:00</div>
                    </div>
                    <div className="text-xs font-bold text-emerald-400 tabular-nums whitespace-nowrap">€{r.amountEur.toLocaleString('it-IT')}</div>
                  </div>
                ))}
                <div className="pt-2 mt-1 border-t border-theme-border flex items-center justify-between text-[11px]">
                  <span className="text-theme-text-muted">Totale mensile</span>
                  <span className="text-emerald-400 font-bold tabular-nums">€{recurringMonthlyTotalEur.toLocaleString('it-IT')}</span>
                </div>
                {recurringActiveCount > recurringTop.length && (
                  <div className="text-[10px] text-theme-text-muted text-center">+ altre {recurringActiveCount - recurringTop.length} attive</div>
                )}
              </div>
            )}
          </div>

          {/* Clienti con saldo alto */}
          <div className="rounded-2xl border border-theme-border bg-gradient-to-br from-theme-bg-secondary to-theme-bg-tertiary p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-theme-text-primary uppercase tracking-wider">Clienti con Saldo Alto</h3>
              <button className="text-[10px] text-emerald-400 font-semibold hover:underline">Vedi classifica</button>
            </div>
            {topBalances.length === 0 ? (
              <div className="text-xs text-theme-text-muted py-3 text-center">Nessun cliente con saldo</div>
            ) : (
              <div className="space-y-2.5">
                {topBalances.map((c, i) => {
                  const init = initials(c.full_name || c.email || '?')
                  const palettes = ['bg-amber-500/20 text-amber-300 border-amber-500/40', 'bg-blue-500/20 text-blue-300 border-blue-500/40', 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40']
                  const color = palettes[i] || palettes[0]
                  return (
                    <button
                      key={c.id}
                      onClick={() => openModal(c, 'credit')}
                      className="w-full flex items-center gap-2.5 hover:bg-theme-bg-primary/40 rounded-lg p-1.5 -mx-1.5 transition-colors text-left"
                    >
                      <div className={`w-8 h-8 rounded-full grid place-items-center text-[11px] font-bold border flex-shrink-0 ${color}`}>{init}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-theme-text-primary font-semibold truncate">{c.full_name || c.email}</div>
                        <div className="text-[10px] text-theme-text-muted truncate">{c.email || c.phone}</div>
                      </div>
                      <div className="text-xs font-bold text-emerald-400 tabular-nums whitespace-nowrap">€{((c.balance_cents || 0) / 100).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Clienti inattivi */}
          <div className="rounded-2xl border border-theme-border bg-gradient-to-br from-theme-bg-secondary to-theme-bg-tertiary p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-theme-text-primary uppercase tracking-wider">Inattivi &gt; 90 giorni</h3>
              <button className="text-[10px] text-emerald-400 font-semibold hover:underline">Vedi tutti</button>
            </div>
            {inactiveCandidates.length === 0 ? (
              <div className="text-xs text-theme-text-muted py-3 text-center">{stats ? 'Nessuno' : '—'}</div>
            ) : (
              <div className="space-y-2.5">
                {inactiveCandidates.map(({ c, days }) => {
                  const init = initials(c.full_name || c.email || '?')
                  return (
                    <button
                      key={c.id}
                      onClick={() => openModal(c, 'credit')}
                      className="w-full flex items-center gap-2.5 hover:bg-theme-bg-primary/40 rounded-lg p-1.5 -mx-1.5 transition-colors text-left"
                    >
                      <div className="w-8 h-8 rounded-full grid place-items-center text-[11px] font-bold border bg-rose-500/20 text-rose-300 border-rose-500/40 flex-shrink-0">{init}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-theme-text-primary font-semibold truncate">{c.full_name || c.email}</div>
                        <div className="text-[10px] text-theme-text-muted">{days >= 9999 ? 'mai utilizzato' : `${days} giorni fa`}</div>
                      </div>
                      <div className="text-xs font-bold text-rose-400 tabular-nums whitespace-nowrap">€{((c.balance_cents || 0) / 100).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Footer trio */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-2">
        <FooterCard title="Sicurezza & Controlli" body="Tutte le transazioni wallet richiedono OTP via email per autorizzazione." icon={
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
        } iconColor="text-emerald-400 bg-emerald-500/10 border-emerald-500/30"/>
        <FooterCard title="Regole di utilizzo" body="Il credito wallet può essere usato per noleggi, lavaggi e meccanica. Non rimborsabile." icon={
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
        } iconColor="text-blue-400 bg-blue-500/10 border-blue-500/30"/>
        <FooterCard title="Assistenza" body="Hai dubbi? Apri un ticket di supporto e ti risponderemo entro 24h." icon={
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z"/>
        } iconColor="text-amber-400 bg-amber-500/10 border-amber-500/30"
          cta={<button className="mt-2 px-3 py-1.5 text-[11px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 rounded-lg hover:bg-emerald-500/25 transition-colors">Apri Supporto</button>}/>
      </div>

      {/* ===== MODAL ===== */}
      {modalCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeModal} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-fadeIn">
            <div className="flex items-center justify-between px-6 pt-6 pb-2">
              <h3 className="text-xl font-bold text-gray-900">
                {modalAction === 'credit' ? 'Carica Wallet' : 'Addebita Wallet'}
              </h3>
              <button onClick={closeModal} className="p-1 text-gray-400 hover:text-gray-600 transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-3 flex items-center gap-3">
              <div className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0" style={{ backgroundColor: TEAL }}>
                {initials(modalCustomer.full_name)}
              </div>
              <div>
                <p className="font-semibold text-gray-900">{modalCustomer.full_name}</p>
                <p className="text-sm text-gray-500">
                  {modalCustomer.email || '—'}
                  {modalCustomer.phone && <span className="ml-2">{modalCustomer.phone}</span>}
                </p>
              </div>
              {wallet && (
                <div className="ml-auto text-right">
                  <p className="text-xs text-gray-400">Saldo</p>
                  <p className="font-bold text-gray-900">{formatEurDec(wallet.balance_cents)}</p>
                </div>
              )}
            </div>

            <div className="px-6 pb-6 space-y-4">
              <div className="flex rounded-lg overflow-hidden border border-gray-200">
                <button
                  onClick={() => { setModalAction('credit'); setOtpSent(false); setOtpVerified(false); setOtpDigits(['','','','','','']) }}
                  className={`flex-1 py-2 text-sm font-semibold transition-colors ${modalAction === 'credit' ? 'text-white' : 'text-gray-600 bg-gray-50 hover:bg-gray-100'}`}
                  style={modalAction === 'credit' ? { backgroundColor: TEAL } : {}}
                >+ Credita</button>
                <button
                  onClick={() => { setModalAction('debit'); setOtpSent(false); setOtpVerified(false); setOtpDigits(['','','','','','']) }}
                  className={`flex-1 py-2 text-sm font-semibold transition-colors ${modalAction === 'debit' ? 'bg-red-500 text-white' : 'text-gray-600 bg-gray-50 hover:bg-gray-100'}`}
                >- Addebita</button>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Importo</label>
                <div className="relative">
                  <input
                    type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00" min="0.01" step="0.01"
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-gray-900 text-lg font-semibold outline-none focus:border-[#3a6a6a] focus:ring-1 focus:ring-[#3a6a6a] transition-all"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 font-medium">&euro;</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nota (facoltativa)</label>
                <input
                  type="text" value={description} onChange={(e) => setDescription(e.target.value)}
                  placeholder="Pagamento anticipato noleggio"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-gray-900 outline-none focus:border-[#3a6a6a] focus:ring-1 focus:ring-[#3a6a6a] transition-all"
                />
              </div>

              {modalAction === 'credit' && (
                <div className={`border rounded-xl p-4 transition-colors ${recurringEnabled ? 'border-green-400 bg-green-50' : 'border-gray-200'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Caricamento automatico mensile</p>
                      <p className="text-xs text-gray-500">Attiva per programmare un accredito ricorrente.</p>
                    </div>
                    <button onClick={() => setRecurringEnabled(!recurringEnabled)}
                      className={`w-11 h-6 rounded-full relative transition-colors ${recurringEnabled ? 'bg-green-500' : 'bg-gray-300'}`}>
                      <div className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all shadow ${recurringEnabled ? 'left-[22px]' : 'left-0.5'}`} />
                    </button>
                  </div>
                  {recurringEnabled && (
                    <div className="grid grid-cols-3 gap-3 mt-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Giorno del mese</label>
                        <select value={recurringDay} onChange={e => setRecurringDay(parseInt(e.target.value))}
                          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-gray-900 outline-none focus:border-[#3a6a6a]">
                          {Array.from({ length: 28 }, (_, i) => (<option key={i + 1} value={i + 1}>{i + 1}</option>))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Ora (Europe/Rome)</label>
                        <select value={recurringHour} onChange={e => setRecurringHour(parseInt(e.target.value))}
                          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-gray-900 outline-none focus:border-[#3a6a6a]">
                          {Array.from({ length: 24 }, (_, i) => (<option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Importo ricorrente</label>
                        <div className="relative">
                          <input type="number" value={recurringAmount} onChange={e => setRecurringAmount(e.target.value)}
                            placeholder="0" min="1" step="1"
                            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-gray-900 outline-none focus:border-[#3a6a6a]" />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">&euro;</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">Codice OTP</label>
                  <button
                    onClick={sendOtp}
                    disabled={otpSending || (!amount && !(recurringEnabled && parseFloat(recurringAmount || '') > 0))}
                    className="px-4 py-1.5 text-sm font-semibold text-white rounded-lg disabled:opacity-50 transition-colors"
                    style={{ backgroundColor: TEAL }}
                    onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.backgroundColor = TEAL_LIGHT }}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = TEAL}
                  >{otpSending ? 'Invio...' : 'Invia OTP'}</button>
                </div>

                <div className="mb-3">
                  <input
                    ref={el => { otpRefs.current[0] = el }}
                    type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                    value={otpDigits.join('')}
                    onChange={(e) => {
                      const cleaned = e.target.value.replace(/\D/g, '').slice(0, 6)
                      const next = ['', '', '', '', '', '']
                      for (let i = 0; i < cleaned.length; i++) next[i] = cleaned[i]
                      setOtpDigits(next)
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') verifyOtp() }}
                    placeholder="------"
                    className={`w-full h-14 text-center text-2xl font-bold tracking-[0.5em] border-2 rounded-xl outline-none transition-all ${
                      otpVerified
                        ? 'border-green-400 bg-green-50 text-green-700'
                        : otpDigits.some(d => d) ? 'border-[#3a6a6a] bg-white text-gray-900' : 'border-gray-200 bg-gray-50 text-gray-900'
                    } focus:border-[#3a6a6a] focus:ring-1 focus:ring-[#3a6a6a]`}
                    disabled={otpVerified}
                  />
                </div>

                {otpVerified && (
                  <p className="text-sm text-green-600 font-medium flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Codice verificato
                  </p>
                )}

                {!otpVerified && (
                  <p className="text-xs text-gray-400">
                    {otpSent ? 'Codice inviato via email. Inserisci il codice per confermare.' : 'Caricamento Wallet richiede l\'autorizzazione. Un codice OTP verra inviato via email per confermare.'}
                  </p>
                )}
              </div>

              {transactions.length > 0 && (
                <div className="border-t border-gray-100 pt-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Ultime transazioni</p>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {transactions.slice(0, 5).map(txn => (
                      <div key={txn.id} className="flex justify-between text-xs">
                        <span className="text-gray-500">{TYPE_LABELS[txn.type] || txn.type}</span>
                        <span className={txn.amount_cents >= 0 ? 'text-green-600 font-medium' : 'text-red-500 font-medium'}>
                          {txn.amount_cents >= 0 ? '+' : ''}{formatEurDec(txn.amount_cents)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3 pt-2">
                <button onClick={closeModal}
                  className="px-5 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors">
                  Annulla
                </button>
                {otpSent && !otpVerified && (
                  <button onClick={verifyOtp} disabled={otpDigits.join('').length < 6}
                    className="px-5 py-2.5 text-sm font-medium rounded-xl border-2 transition-colors disabled:opacity-40"
                    style={{ borderColor: TEAL_BORDER, color: TEAL }}>
                    Verifica OTP
                  </button>
                )}
                <button
                  onClick={handleConfirm}
                  disabled={(() => {
                    if (actionLoading) return true
                    const recurOnly = !amount && modalAction === 'credit' && recurringEnabled && parseFloat(recurringAmount || '') > 0
                    if (recurOnly) return false
                    return !amount || (otpSent && !otpVerified)
                  })()}
                  className="flex-1 px-5 py-2.5 text-sm font-bold text-white rounded-xl disabled:opacity-40 transition-colors"
                  style={{ backgroundColor: modalAction === 'credit' ? TEAL : '#ef4444' }}
                  onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.opacity = '0.9' }}
                  onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                >
                  {(() => {
                    if (actionLoading) return 'Elaborazione...'
                    const recurOnly = !amount && modalAction === 'credit' && recurringEnabled && parseFloat(recurringAmount || '') > 0
                    if (recurOnly) return 'Salva Programmazione'
                    if (otpVerified) return `Conferma ${modalAction === 'credit' ? 'Caricamento' : 'Addebito'}`
                    return `${modalAction === 'credit' ? 'Carica' : 'Addebita'} Wallet`
                  })()}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Small presentational components ─────────────────────────────────────

function KpiCard({ label, value, hint, color, icon }: {
  label: string; value: string; hint: string; color: 'blue' | 'emerald' | 'purple' | 'amber' | 'cyan';
  icon: React.ReactNode
}) {
  const map = {
    blue:    { border: 'border-blue-500/25',    text: 'text-blue-300',    val: 'text-blue-400',    glow: 'bg-blue-500/10',    ic: 'bg-blue-500/15 border-blue-500/30 text-blue-400' },
    emerald: { border: 'border-emerald-500/25', text: 'text-emerald-300', val: 'text-emerald-400', glow: 'bg-emerald-500/10', ic: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' },
    purple:  { border: 'border-purple-500/25',  text: 'text-purple-300',  val: 'text-purple-400',  glow: 'bg-purple-500/10',  ic: 'bg-purple-500/15 border-purple-500/30 text-purple-400' },
    amber:   { border: 'border-amber-500/25',   text: 'text-amber-300',   val: 'text-amber-400',   glow: 'bg-amber-500/10',   ic: 'bg-amber-500/15 border-amber-500/30 text-amber-400' },
    cyan:    { border: 'border-cyan-500/25',    text: 'text-cyan-300',    val: 'text-cyan-400',    glow: 'bg-cyan-500/10',    ic: 'bg-cyan-500/15 border-cyan-500/30 text-cyan-400' },
  }[color]
  return (
    <div className={`relative overflow-hidden rounded-2xl border ${map.border} bg-gradient-to-br from-theme-bg-secondary to-theme-bg-tertiary p-4`}>
      <div className={`absolute -top-6 -right-6 w-24 h-24 ${map.glow} rounded-full blur-2xl pointer-events-none`}/>
      <div className="relative">
        <div className="flex items-center justify-between">
          <div className={`text-[10px] ${map.text} uppercase tracking-wider font-bold`}>{label}</div>
          <div className={`w-7 h-7 rounded-lg border grid place-items-center ${map.ic}`}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">{icon}</svg>
          </div>
        </div>
        <div className={`text-2xl lg:text-3xl font-bold ${map.val} mt-2.5 tabular-nums`}>{value}</div>
        <div className="text-[11px] text-theme-text-muted mt-1">{hint}</div>
      </div>
    </div>
  )
}

function QuickAction({ label, color, icon, onClick }: {
  label: string; color: 'emerald' | 'blue' | 'amber' | 'purple' | 'rose' | 'cyan';
  icon: React.ReactNode; onClick: () => void
}) {
  const map: Record<string, string> = {
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    blue:    'text-blue-400 bg-blue-500/10 border-blue-500/30',
    amber:   'text-amber-400 bg-amber-500/10 border-amber-500/30',
    purple:  'text-purple-400 bg-purple-500/10 border-purple-500/30',
    rose:    'text-rose-400 bg-rose-500/10 border-rose-500/30',
    cyan:    'text-cyan-400 bg-cyan-500/10 border-cyan-500/30',
  }
  return (
    <button onClick={onClick}
      className="flex items-center gap-2 p-2.5 rounded-xl bg-theme-bg-primary/40 border border-theme-border hover:bg-theme-bg-primary/60 transition-colors text-left">
      <div className={`w-8 h-8 rounded-lg border grid place-items-center flex-shrink-0 ${map[color]}`}>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">{icon}</svg>
      </div>
      <span className="text-xs font-semibold text-theme-text-primary truncate">{label}</span>
    </button>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-2 rounded-xl text-xs font-semibold transition-colors border ${
        active
          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
          : 'bg-theme-bg-secondary text-theme-text-secondary border-theme-border hover:bg-theme-bg-hover'
      }`}>{children}</button>
  )
}

function Donut({ used, avail, inactive, centerLabel }: {
  used: number; avail: number; inactive: number; centerLabel: string
}) {
  const R = 38, C = 2 * Math.PI * R
  const u = used * C, a = avail * C, n = inactive * C
  return (
    <div className="relative w-[110px] h-[110px] flex-shrink-0">
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="12"/>
        <circle cx="50" cy="50" r={R} fill="none" stroke="#10b981" strokeWidth="12"
          strokeDasharray={`${u} ${C - u}`} strokeDashoffset={0}/>
        <circle cx="50" cy="50" r={R} fill="none" stroke="#60a5fa" strokeWidth="12"
          strokeDasharray={`${a} ${C - a}`} strokeDashoffset={-u}/>
        <circle cx="50" cy="50" r={R} fill="none" stroke="#fbbf24" strokeWidth="12"
          strokeDasharray={`${n} ${C - n}`} strokeDashoffset={-(u + a)}/>
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="text-[10px] text-theme-text-muted">Totale</div>
          <div className="text-xs font-bold text-theme-text-primary tabular-nums">{centerLabel}</div>
        </div>
      </div>
    </div>
  )
}

function LegendRow({ color, label, value, pct }: { color: string; label: string; value: string; pct: number }) {
  return (
    <div className="flex items-center justify-between gap-1">
      <span className="flex items-center gap-1.5 text-theme-text-secondary truncate">
        <span className={`w-2 h-2 rounded-sm ${color}`}/>
        <span className="truncate">{label}</span>
      </span>
      <span className="text-theme-text-primary font-semibold tabular-nums whitespace-nowrap">{value} <span className="text-theme-text-muted">· {pct}%</span></span>
    </div>
  )
}

function FooterCard({ title, body, icon, iconColor, cta }: {
  title: string; body: string; icon: React.ReactNode; iconColor: string; cta?: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-theme-border bg-gradient-to-br from-theme-bg-secondary to-theme-bg-tertiary p-4 flex items-start gap-3">
      <div className={`w-10 h-10 rounded-xl border grid place-items-center flex-shrink-0 ${iconColor}`}>
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">{icon}</svg>
      </div>
      <div className="min-w-0 flex-1">
        <h4 className="text-sm font-bold text-theme-text-primary">{title}</h4>
        <p className="text-[11px] text-theme-text-muted mt-0.5">{body}</p>
        {cta}
      </div>
    </div>
  )
}
