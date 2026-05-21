/**
 * DashboardReportTab — nuovo Dashboard moderno (dark theme, KPI cards
 * gradient, charts recharts) ispirato al mockup BETA 2026-05-21.
 *
 * Riusa l'endpoint /.netlify/functions/dashboard-kpi (gia' implementato
 * per DashboardTab originale) + supabase queries dirette per
 * wallets/club members/preventivi.
 *
 * Per ora coabita con DashboardTab classico — nuovo tab nel menu;
 * quando l'admin lo valida verra' promosso a Dashboard principale.
 */
import { useState, useEffect, useCallback } from 'react'
import { authFetch } from '../../../utils/authFetch'
import { supabase } from '../../../supabaseClient'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, BarChart, Bar, LineChart, Line,
} from 'recharts'

function fmtEur(n: number): string {
  return '€' + n.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
function fmt(n: number): string {
  return n.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
function fmtPct(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%'
}
function firstDayOfMonth(): string {
  const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function lastDayOfMonth(): string {
  const d = new Date(); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`
}

// ── KPI Card with gradient background ─────────────────────────────────────
function KpiCard({
  label, value, trend, icon, gradient,
}: {
  label: string
  value: string
  trend?: number
  icon: React.ReactNode
  gradient: string
}) {
  return (
    <div className={`relative overflow-hidden rounded-2xl p-5 ${gradient} text-white shadow-xl`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider opacity-90">{label}</div>
          <div className="text-3xl font-bold mt-2 tabular-nums">{value}</div>
        </div>
        <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
          {icon}
        </div>
      </div>
      {typeof trend === 'number' && (
        <div className={`text-xs mt-3 font-semibold inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${trend >= 0 ? 'bg-white/20' : 'bg-white/20'}`}>
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path d={trend >= 0
              ? 'M10 3l7 7H3l7-7z'
              : 'M10 17L3 10h14l-7 7z'} />
          </svg>
          {fmtPct(trend)} vs periodo precedente
        </div>
      )}
      {/* glow corner */}
      <div className="absolute -right-6 -bottom-6 w-24 h-24 rounded-full bg-white/10 blur-2xl" />
    </div>
  )
}

interface DashboardData {
  revenue: {
    currentMonth: number; previousMonth: number; changePercent: number
    incassato: number
  }
  bookings: {
    total: number; previousTotal: number; changePercent: number
    confirmed: number; pending: number; cancelled: number; conversionRate: number
  }
  customers: {
    newThisMonth: number; activeThisMonth: number; previousNewCount: number
    changePercent: number; totalCustomers: number
  }
  fleet: { totalVehicles: number; rentedNow: number; occupationRate: number }
}

interface ExtraData {
  walletCount: number
  walletTrend: number
  clubCount: number
  clubTrend: number
  preventiviCount: number
  preventiviTrend: number
  preventiviAccepted: number
  topVehicles: Array<{ name: string; bookings: number; revenue: number; image?: string | null }>
  customerTypes: Array<{ name: string; value: number; color: string }>
  revenueDaily: Array<{ day: string; value: number }>
  bookingsDaily: Array<{ day: string; value: number }>
  recentAlerts: Array<{ message: string; severity: 'info' | 'warning' | 'success' }>
}

export default function DashboardReportTab() {
  const [dateFrom, setDateFrom] = useState(firstDayOfMonth())
  const [dateTo, setDateTo] = useState(lastDayOfMonth())
  const [kpi, setKpi] = useState<DashboardData | null>(null)
  const [extra, setExtra] = useState<ExtraData | null>(null)
  const [loading, setLoading] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // Dashboard KPI (existing endpoint)
      const res = await authFetch(`/.netlify/functions/dashboard-kpi?from=${dateFrom}&to=${dateTo}`)
      if (res.ok) {
        const json = await res.json()
        setKpi(json)
      }

      // Wallets + club members + preventivi (queries dirette)
      const [walletsRes, clubRes, preventiviRes, prevAcceptedRes, vehiclesRes, custTypesRes] = await Promise.all([
        supabase.from('wallets').select('id, balance', { count: 'exact' }).gt('balance', 0),
        supabase.from('customer_memberships').select('id', { count: 'exact' }).eq('status', 'active'),
        supabase.from('preventivi').select('id', { count: 'exact' }).gte('created_at', dateFrom).lte('created_at', dateTo + 'T23:59:59'),
        supabase.from('preventivi').select('id', { count: 'exact' }).eq('status', 'accettato').gte('created_at', dateFrom).lte('created_at', dateTo + 'T23:59:59'),
        supabase.from('vehicles').select('id, display_name, plate, metadata').neq('status', 'retired').limit(5),
        supabase.from('customers_extended').select('tipo_cliente').limit(5000),
      ])

      const walletCount = (walletsRes as { count?: number | null }).count ?? 0
      const clubCount = (clubRes as { count?: number | null }).count ?? 0
      const preventiviCount = (preventiviRes as { count?: number | null }).count ?? 0
      const preventiviAccepted = (prevAcceptedRes as { count?: number | null }).count ?? 0

      // Top auto piu' viste (placeholder — il primo 5)
      const topVehicles = (vehiclesRes.data || []).map(v => {
        const meta = (v as { metadata?: { image_url?: string } }).metadata
        return {
          name: v.display_name || 'Veicolo',
          bookings: 0,
          revenue: 0,
          image: meta?.image_url || null,
        }
      })

      // Clienti per tipologia
      const types = new Map<string, number>()
      for (const c of (custTypesRes.data || [])) {
        const t = c.tipo_cliente || 'privato'
        types.set(t, (types.get(t) || 0) + 1)
      }
      const PALETTE = ['#a855f7', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#3b82f6']
      const customerTypes = Array.from(types.entries()).map(([name, value], i) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        value,
        color: PALETTE[i % PALETTE.length],
      }))

      // Daily revenue/bookings (sintetico — useremo dati reali quando endpoint sara' aggiornato)
      const days = Math.max(1, Math.ceil((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000))
      const revenueDaily: Array<{ day: string; value: number }> = []
      const bookingsDaily: Array<{ day: string; value: number }> = []
      for (let i = 0; i < Math.min(days, 31); i++) {
        const d = new Date(dateFrom)
        d.setDate(d.getDate() + i)
        const dayLabel = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
        revenueDaily.push({ day: dayLabel, value: 0 })
        bookingsDaily.push({ day: dayLabel, value: 0 })
      }

      setExtra({
        walletCount,
        walletTrend: 0,
        clubCount,
        clubTrend: 0,
        preventiviCount,
        preventiviTrend: 0,
        preventiviAccepted,
        topVehicles,
        customerTypes,
        revenueDaily,
        bookingsDaily,
        recentAlerts: [],
      })
    } catch (e) {
      console.error('[DashboardReport] load failed', e)
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => { loadData() }, [loadData])

  if (loading && !kpi) {
    return (
      <div className="min-h-screen bg-[#0a0f1e] flex items-center justify-center">
        <div className="text-cyan-400 text-lg">Caricamento dashboard…</div>
      </div>
    )
  }

  const revenue = kpi?.revenue.currentMonth || 0
  const revenueTrend = kpi?.revenue.changePercent || 0
  const bookings = kpi?.bookings.total || 0
  const bookingsTrend = kpi?.bookings.changePercent || 0
  const conversionRate = kpi?.bookings.conversionRate || 0
  const newCustomers = kpi?.customers.newThisMonth || 0
  const customersTrend = kpi?.customers.changePercent || 0

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white pb-20">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6">

        {/* HEADER */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Dashboard Overview</h1>
            <p className="text-sm text-slate-400 mt-0.5">Panoramica generale delle performance</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-800/60 border border-slate-700 rounded-xl text-sm">
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="bg-transparent outline-none text-slate-200 [color-scheme:dark]" />
              <span className="text-slate-500">–</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="bg-transparent outline-none text-slate-200 [color-scheme:dark]" />
            </div>
            <button className="px-3 py-2 bg-slate-800/60 border border-slate-700 rounded-xl text-sm hover:bg-slate-700/60">
              Personalizza
            </button>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/40 rounded-full text-[11px] font-semibold text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              LIVE
            </span>
          </div>
        </div>

        {/* ROW 1 — 6 KPI CARDS */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
          <KpiCard
            label="Visitatori"
            value="—"
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>}
            gradient="bg-gradient-to-br from-purple-600 to-purple-800"
          />
          <KpiCard
            label="Conversion Rate"
            value={`${conversionRate.toFixed(2)}%`}
            trend={bookingsTrend}
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>}
            gradient="bg-gradient-to-br from-cyan-500 to-blue-700"
          />
          <KpiCard
            label="Fatturato"
            value={fmtEur(revenue)}
            trend={revenueTrend}
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
            gradient="bg-gradient-to-br from-emerald-500 to-emerald-700"
          />
          <KpiCard
            label="Lead Generati"
            value={fmt(extra?.preventiviCount || 0)}
            trend={extra?.preventiviTrend}
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg>}
            gradient="bg-gradient-to-br from-amber-500 to-orange-600"
          />
          <KpiCard
            label="Utenti Wallet"
            value={fmt(extra?.walletCount || 0)}
            trend={extra?.walletTrend}
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>}
            gradient="bg-gradient-to-br from-blue-500 to-indigo-700"
          />
          <KpiCard
            label="Member DR7 Club"
            value={fmt(extra?.clubCount || 0)}
            trend={extra?.clubTrend}
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>}
            gradient="bg-gradient-to-br from-rose-500 to-pink-700"
          />
        </div>

        {/* ROW 2 — 4 chart cards */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 mb-4">
          {/* Traffico nel tempo */}
          <div className="lg:col-span-2 bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold">Fatturato giornaliero</h3>
              <span className="text-xs text-slate-500">Periodo selezionato</span>
            </div>
            <div className="h-48">
              <ResponsiveContainer>
                <AreaChart data={extra?.revenueDaily || []}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#06b6d4" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="day" stroke="#64748b" fontSize={11} />
                  <YAxis stroke="#64748b" fontSize={11} />
                  <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }} />
                  <Area type="monotone" dataKey="value" stroke="#06b6d4" strokeWidth={2} fill="url(#revGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Clienti per tipologia */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
            <h3 className="text-sm font-bold mb-3">Clienti per tipologia</h3>
            <div className="h-48 flex items-center">
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={extra?.customerTypes || []}
                    dataKey="value"
                    cx="50%" cy="50%"
                    innerRadius={40} outerRadius={70}
                    paddingAngle={3}
                  >
                    {(extra?.customerTypes || []).map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-1.5 mt-2 text-xs">
              {(extra?.customerTypes || []).slice(0, 4).map((c, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
                    <span className="text-slate-300">{c.name}</span>
                  </div>
                  <span className="text-slate-400 tabular-nums">{c.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Flotta */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
            <h3 className="text-sm font-bold mb-3">Flotta</h3>
            <div className="text-4xl font-bold text-white mb-1">{fmt(kpi?.fleet.totalVehicles || 0)}</div>
            <div className="text-xs text-slate-400 mb-4">Veicoli totali</div>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-300">Noleggiati ora</span>
                <span className="tabular-nums font-bold text-emerald-400">{kpi?.fleet.rentedNow || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-300">Occupazione</span>
                <span className="tabular-nums font-bold text-cyan-400">{(kpi?.fleet.occupationRate || 0).toFixed(0)}%</span>
              </div>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden mt-2">
                <div className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500"
                  style={{ width: `${Math.min(100, kpi?.fleet.occupationRate || 0)}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* ROW 3 — 4 metric cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <MetricCard
            label="Prenotazioni totali"
            value={fmt(bookings)}
            trend={bookingsTrend}
            subValue={`${kpi?.bookings.confirmed || 0} confermate`}
            accent="cyan"
          />
          <MetricCard
            label="Conversion Rate"
            value={`${conversionRate.toFixed(2)}%`}
            trend={bookingsTrend}
            subValue={`${kpi?.bookings.confirmed || 0} / ${bookings}`}
            accent="green"
          />
          <MetricCard
            label="Nuovi Clienti"
            value={fmt(newCustomers)}
            trend={customersTrend}
            subValue={`${kpi?.customers.totalCustomers || 0} totali`}
            accent="amber"
          />
          <MetricCard
            label="Preventivi Accettati"
            value={`${extra?.preventiviCount ? Math.round((extra.preventiviAccepted / extra.preventiviCount) * 100) : 0}%`}
            subValue={`${extra?.preventiviAccepted || 0} / ${extra?.preventiviCount || 0}`}
            accent="pink"
          />
        </div>

        {/* ROW 4 — wide cards (top vehicles + alerts) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 lg:col-span-2">
            <h3 className="text-sm font-bold mb-3">Top Auto più viste</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(extra?.topVehicles || []).map((v, i) => (
                <div key={i} className="flex items-center gap-3 p-2 bg-slate-800/40 rounded-xl border border-slate-800">
                  {v.image ? (
                    <img src={v.image} alt={v.name} className="w-12 h-12 rounded-lg object-cover" />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center text-xs text-slate-400">DR7</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{v.name}</div>
                    <div className="text-xs text-slate-400">{v.bookings} prenotazioni</div>
                  </div>
                  <div className="text-emerald-400 text-sm font-bold tabular-nums">{fmtEur(v.revenue)}</div>
                </div>
              ))}
              {(!extra || extra.topVehicles.length === 0) && (
                <div className="col-span-2 text-center text-slate-500 text-sm py-8">Nessun veicolo</div>
              )}
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
            <h3 className="text-sm font-bold mb-3">Alert & Notifiche</h3>
            <div className="space-y-2 text-xs">
              <div className="flex items-start gap-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <span className="w-2 h-2 rounded-full bg-amber-400 mt-1 shrink-0" />
                <span className="text-amber-200">Periodo attivo: {dateFrom} → {dateTo}</span>
              </div>
              <div className="flex items-start gap-2 p-2 bg-cyan-500/10 border border-cyan-500/30 rounded-lg">
                <span className="w-2 h-2 rounded-full bg-cyan-400 mt-1 shrink-0" />
                <span className="text-cyan-200">{bookings} prenotazioni nel periodo</span>
              </div>
              <div className="flex items-start gap-2 p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                <span className="w-2 h-2 rounded-full bg-emerald-400 mt-1 shrink-0" />
                <span className="text-emerald-200">Fatturato: {fmtEur(revenue)}</span>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}

// ── Small metric card (row 3) ─────────────────────────────────────────────
function MetricCard({
  label, value, trend, subValue, accent,
}: {
  label: string
  value: string
  trend?: number
  subValue?: string
  accent: 'cyan' | 'green' | 'amber' | 'pink'
}) {
  const ACCENT_RING = {
    cyan: 'border-cyan-500/30',
    green: 'border-emerald-500/30',
    amber: 'border-amber-500/30',
    pink: 'border-pink-500/30',
  }[accent]
  const ACCENT_TEXT = {
    cyan: 'text-cyan-400',
    green: 'text-emerald-400',
    amber: 'text-amber-400',
    pink: 'text-pink-400',
  }[accent]
  return (
    <div className={`bg-slate-900/60 border ${ACCENT_RING} rounded-2xl p-4`}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">{label}</div>
      <div className={`text-2xl font-bold ${ACCENT_TEXT} tabular-nums`}>{value}</div>
      {subValue && <div className="text-xs text-slate-400 mt-1">{subValue}</div>}
      {typeof trend === 'number' && (
        <div className={`text-[11px] mt-2 font-semibold ${trend >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {trend >= 0 ? '↗' : '↘'} {fmtPct(trend)}
        </div>
      )}
    </div>
  )
}
