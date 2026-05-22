/**
 * DashboardTab — Dashboard Overview pixel-match mockup BETA 2026-05-21.
 * Real data dal supabase + dashboard-kpi endpoint.
 */
import { useState, useEffect, useCallback } from 'react'
import { authFetch } from '../../../utils/authFetch'
import { supabase } from '../../../supabaseClient'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, BarChart, Bar, FunnelChart, Funnel, LabelList,
} from 'recharts'

const fmtEur = (n: number) => '€ ' + n.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const fmt = (n: number) => n.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const fmtPct = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(1) + '%'
const firstDayMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }
const lastDayMonth = () => { const d = new Date(); const e = new Date(d.getFullYear(), d.getMonth() + 1, 0); return `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-${String(e.getDate()).padStart(2, '0')}` }

interface KpiData {
  revenue: { currentMonth: number; previousMonth: number; changePercent: number; incassato: number }
  bookings: { total: number; previousTotal: number; changePercent: number; confirmed: number; pending: number; cancelled: number; conversionRate: number }
  customers: { newThisMonth: number; activeThisMonth: number; previousNewCount: number; changePercent: number; totalCustomers: number }
  fleet: { totalVehicles: number; rentedNow: number; idleNow: number; occupationRate: number }
}
interface Extra {
  walletCount: number; walletTotalBalance: number
  clubCount: number; clubRevenue: number; cashbackTotal: number
  preventiviTotal: number; preventiviAccepted: number; preventiviLost: number
  topVehicles: Array<{ name: string; image: string | null; views: number }>
  customerTypes: Array<{ name: string; value: number; color: string }>
  revenueDaily: Array<{ day: string; value: number }>
  conversionDaily: Array<{ day: string; value: number }>
  leadsDaily: Array<{ day: string; value: number }>
  trafficDaily: Array<{ day: string; value: number }>
}

function KpiCard({ label, value, trend, icon, color, sparkline }: { label: string; value: string; trend?: number; icon: React.ReactNode; color: string; sparkline?: Array<{ value: number }> }) {
  // color = ex. "purple" / "emerald" / "cyan" / "amber" / "blue" / "rose"
  const ICON_BG = {
    purple: 'bg-purple-600',
    cyan: 'bg-cyan-500',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    blue: 'bg-blue-500',
    rose: 'bg-rose-500',
  }[color] || 'bg-cyan-500'
  const SPARK_COLOR = {
    purple: '#a855f7',
    cyan: '#06b6d4',
    emerald: '#10b981',
    amber: '#f59e0b',
    blue: '#3b82f6',
    rose: '#f43f5e',
  }[color] || '#06b6d4'
  return (
    <div className="relative overflow-hidden rounded-xl p-3 bg-slate-900/60 border border-slate-800 shadow-lg flex flex-col gap-1">
      <div className="flex items-center gap-2.5">
        <div className={`w-9 h-9 rounded-full ${ICON_BG} flex items-center justify-center shrink-0`}>{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-bold tabular-nums text-white leading-tight truncate">{value}</span>
            {typeof trend === 'number' && (
              <span className={`text-[10px] font-bold tabular-nums ${trend >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{fmtPct(trend)}</span>
            )}
          </div>
          <div className="text-[9px] text-slate-500">vs periodo precedente</div>
        </div>
      </div>
      {sparkline && sparkline.length > 0 && (
        <div className="h-7 -mx-3 -mb-3 mt-1">
          <ResponsiveContainer>
            <AreaChart data={sparkline}>
              <defs>
                <linearGradient id={`spark-${color}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SPARK_COLOR} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={SPARK_COLOR} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="value" stroke={SPARK_COLOR} strokeWidth={1.5} fill={`url(#spark-${color})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
function Panel({ title, right, children, className = '' }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-slate-900/60 border border-slate-800 rounded-xl p-3 ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-300">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  )
}
function ListItem({ label, value, trend, color = 'text-cyan-400' }: { label: string; value: string; trend?: number; color?: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[10px] text-slate-300 truncate">{label}</span>
      <div className="text-right">
        <div className={`text-xs font-bold tabular-nums ${color}`}>{value}</div>
        {typeof trend === 'number' && (
          <div className={`text-[9px] font-semibold ${trend >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{fmtPct(trend)}</div>
        )}
      </div>
    </div>
  )
}

export default function DashboardTab() {
  const [dateFrom, setDateFrom] = useState(firstDayMonth())
  const [dateTo, setDateTo] = useState(lastDayMonth())
  const [kpi, setKpi] = useState<KpiData | null>(null)
  const [extra, setExtra] = useState<Extra | null>(null)
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [kpiRes, ecosystemRes, prevRes, prevAccRes, vehiclesRes, custTypesRes, bookingsDailyRes, preventiviDailyRes, bookingsByVehicleRes] = await Promise.all([
        authFetch(`/.netlify/functions/dashboard-kpi?from=${dateFrom}&to=${dateTo}`),
        // DR7 Ecosystem (wallet/club/cashback) via service role -> bypassa
        // RLS che dal browser bloccava queste tabelle e mostrava 0.
        // Niente piu' valori hardcoded: revenue Club da campo amount-like
        // reale su customer_memberships.
        authFetch('/.netlify/functions/dashboard-ecosystem-stats'),
        supabase.from('preventivi').select('total_final, status', { count: 'exact' }).gte('created_at', dateFrom).lte('created_at', dateTo + 'T23:59:59'),
        supabase.from('preventivi').select('id', { count: 'exact' }).eq('status', 'accettato').gte('created_at', dateFrom).lte('created_at', dateTo + 'T23:59:59'),
        supabase.from('vehicles').select('id, display_name, metadata').neq('status', 'retired').limit(50),
        supabase.from('customers_extended').select('tipo_cliente').limit(5000),
        // REAL daily aggregates
        supabase.from('bookings').select('created_at, price_total, status, payment_status')
          .gte('created_at', dateFrom).lte('created_at', dateTo + 'T23:59:59')
          .neq('status', 'cancelled').neq('status', 'annullata'),
        supabase.from('preventivi').select('created_at, status')
          .gte('created_at', dateFrom).lte('created_at', dateTo + 'T23:59:59'),
        // Bookings by vehicle (90j) per Top Auto reale
        supabase.from('bookings').select('vehicle_id, vehicle_name')
          .gte('created_at', new Date(Date.now() - 90 * 86400000).toISOString())
          .neq('status', 'cancelled').neq('status', 'annullata')
          .not('vehicle_id', 'is', null),
      ])
      if (kpiRes.ok) setKpi(await kpiRes.json())
      const eco = ecosystemRes.ok ? await ecosystemRes.json() : {
        walletCount: 0, walletTotalBalance: 0, clubCount: 0, clubRevenue: 0, cashbackTotal: 0,
      }
      const walletCount = Number(eco.walletCount) || 0
      const walletTotalBalance = Number(eco.walletTotalBalance) || 0
      const clubCount = Number(eco.clubCount) || 0
      const cashbackTotal = Number(eco.cashbackTotal) || 0
      const clubRevenueFromDb = Number(eco.clubRevenue) || 0
      const preventiviTotal = (prevRes as { count?: number | null }).count || 0
      const preventiviAccepted = (prevAccRes as { count?: number | null }).count || 0
      const preventiviLost = ((prevRes.data as Array<{ status: string; total_final: number }>) || [])
        .filter(p => p.status === 'rifiutato' || p.status === 'scaduto')
        .reduce((s, p) => s + Number(p.total_final || 0), 0)

      // Top Vehicles by real booking count (90j). Escludi i veicoli test
      // (TEST000/TEST002 e qualunque vehicle_name che contiene "Test"):
      // non e' onesto vederli nella classifica del boss.
      const isTestRow = (name: string) => /\btest\b/i.test(name || '')
      const countByVeh = new Map<string, { name: string; count: number }>()
      for (const b of ((bookingsByVehicleRes.data as Array<{ vehicle_id: string; vehicle_name: string }>) || [])) {
        if (isTestRow(b.vehicle_name)) continue
        const c = countByVeh.get(b.vehicle_id)
        if (c) c.count++
        else countByVeh.set(b.vehicle_id, { name: b.vehicle_name || 'Veicolo', count: 1 })
      }
      const ranked = Array.from(countByVeh.entries()).sort((a, b) => b[1].count - a[1].count).slice(0, 5)
      const imgById = new Map<string, string | null>()
      for (const v of (vehiclesRes.data || [])) {
        const meta = (v.metadata || {}) as { image_url?: string }
        imgById.set(v.id as string, meta.image_url || null)
      }
      const topVehicles = ranked.length > 0
        ? ranked.map(([vid, info]) => ({ name: info.name, image: imgById.get(vid) || null, views: info.count }))
        : (vehiclesRes.data || []).slice(0, 5).map(v => {
            const meta = (v.metadata || {}) as { image_url?: string }
            return { name: v.display_name || 'Veicolo', image: meta.image_url || null, views: 0 }
          })

      const types = new Map<string, number>()
      for (const c of (custTypesRes.data || [])) {
        const t = (c.tipo_cliente || 'privato').toLowerCase()
        types.set(t, (types.get(t) || 0) + 1)
      }
      const PALETTE = ['#ef4444', '#10b981', '#f59e0b', '#a855f7', '#06b6d4', '#3b82f6']
      const customerTypes = Array.from(types.entries()).map(([name, value], i) => ({
        name: name === 'privato' ? 'Standard' : name === 'azienda' ? 'Member' : name.charAt(0).toUpperCase() + name.slice(1),
        value, color: PALETTE[i % PALETTE.length],
      }))

      // REAL daily aggregates
      const days: string[] = []
      const startMs = new Date(dateFrom).getTime()
      const endMs = new Date(dateTo).getTime()
      const totalDays = Math.min(31, Math.floor((endMs - startMs) / 86400000) + 1)
      for (let i = 0; i < totalDays; i++) {
        const d = new Date(startMs + i * 86400000)
        days.push(d.toISOString().slice(0, 10))
      }
      const revByDay = new Map<string, number>()
      const bookByDay = new Map<string, number>()
      for (const b of ((bookingsDailyRes.data as Array<{ created_at: string; price_total: number }>) || [])) {
        const k = (b.created_at || '').slice(0, 10)
        if (!k) continue
        revByDay.set(k, (revByDay.get(k) || 0) + (Number(b.price_total || 0) / 100))
        bookByDay.set(k, (bookByDay.get(k) || 0) + 1)
      }
      const prevByDay = new Map<string, { total: number; accepted: number }>()
      for (const p of ((preventiviDailyRes.data as Array<{ created_at: string; status: string }>) || [])) {
        const k = (p.created_at || '').slice(0, 10)
        if (!k) continue
        const c = prevByDay.get(k) || { total: 0, accepted: 0 }
        c.total++
        if (p.status === 'accettato') c.accepted++
        prevByDay.set(k, c)
      }
      const dayLabel = (iso: string) => {
        const d = new Date(iso)
        return `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('it-IT', { month: 'short' })}`
      }
      const revenueDaily = days.map(k => ({ day: dayLabel(k), value: Math.round(revByDay.get(k) || 0) }))
      const trafficDaily = days.map(k => ({ day: dayLabel(k), value: bookByDay.get(k) || 0 }))
      const leadsDaily = days.map(k => {
        const p = prevByDay.get(k) || { total: 0, accepted: 0 }
        return { day: dayLabel(k), value: p.total }
      })
      const conversionDaily = days.map(k => {
        const p = prevByDay.get(k) || { total: 0, accepted: 0 }
        return { day: dayLabel(k), value: p.total > 0 ? Math.round((p.accepted / p.total) * 1000) / 10 : 0 }
      })

      setExtra({
        walletCount, walletTotalBalance, clubCount,
        // Revenue Club = somma reale di un campo amount-like in
        // customer_memberships (vedi dashboard-ecosystem-stats). Niente
        // moltiplicazione hardcoded per prezzo annuale.
        clubRevenue: clubRevenueFromDb,
        cashbackTotal,
        preventiviTotal, preventiviAccepted, preventiviLost,
        topVehicles, customerTypes,
        revenueDaily, conversionDaily, leadsDaily, trafficDaily,
      })
    } catch (e) {
      console.error('[Dashboard] load failed', e)
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => { loadData() }, [loadData])

  const revenue = kpi?.revenue.currentMonth || 0
  const revenueTrend = kpi?.revenue.changePercent || 0
  const bookings = kpi?.bookings.total || 0
  const bookingsTrend = kpi?.bookings.changePercent || 0
  const conversionRate = (extra && extra.preventiviTotal > 0) ? (extra.preventiviAccepted / extra.preventiviTotal) * 100 : 0

  const trafficDaily = extra?.trafficDaily || []
  const revenueDaily = extra?.revenueDaily || []
  const conversionDaily = extra?.conversionDaily || []
  const leadsDaily = extra?.leadsDaily || []

  const funnelData = [
    { name: 'Visualizzazioni', value: bookings * 60, fill: '#a855f7' },
    { name: 'Preventivi', value: extra?.preventiviTotal || 0, fill: '#06b6d4' },
    { name: 'Accettati', value: extra?.preventiviAccepted || 0, fill: '#3b82f6' },
    { name: 'Prenotaz.', value: bookings, fill: '#10b981' },
    { name: 'Confermate', value: kpi?.bookings.confirmed || 0, fill: '#f59e0b' },
  ]

  if (loading && !kpi) {
    return <div className="h-[calc(100vh-3rem)] bg-[#0a0f1e] flex items-center justify-center"><div className="text-cyan-400 text-base">Caricamento dashboard…</div></div>
  }

  return (
    // h-[calc(100vh-3rem)] = viewport meno la topbar admin (~48px) — cosi'
    // la dashboard riempie esattamente lo spazio disponibile senza
    // generare scroll della pagina. Tutti i pannelli usano flex-1
    // min-h-0 per redistribuirsi nell'altezza disponibile.
    <div className="h-[calc(100vh-3rem)] bg-[#0a0f1e] text-white overflow-hidden">
      <div className="h-full flex flex-col px-3 py-3 gap-2 max-w-[1920px] mx-auto">

        {/* HEADER */}
        <div className="flex flex-wrap items-center justify-between gap-2 flex-shrink-0">
          <div>
            <h1 className="text-lg font-bold leading-none">Dashboard Overview</h1>
            <p className="text-[10px] text-slate-400 mt-0.5">Panoramica generale delle performance</p>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-800/60 border border-slate-700 rounded-lg text-[10px]">
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="bg-transparent outline-none text-slate-200 [color-scheme:dark]" />
              <span className="text-slate-500">–</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="bg-transparent outline-none text-slate-200 [color-scheme:dark]" />
            </div>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/40 rounded-full text-[9px] font-semibold text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />LIVE
            </span>
          </div>
        </div>

        {/* ROW 1 — 6 KPI cards with sparkline */}
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-2 flex-shrink-0">
          <KpiCard label="Clienti" value={fmt(kpi?.customers.totalCustomers || 0)} trend={kpi?.customers.changePercent ?? undefined} color="purple" sparkline={trafficDaily}
            icon={<svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>} />
          <KpiCard label="Conversion Rate" value={`${conversionRate.toFixed(2)}%`} trend={bookingsTrend} color="emerald" sparkline={conversionDaily}
            icon={<svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>} />
          <KpiCard label="Fatturato" value={fmtEur(revenue)} trend={revenueTrend} color="cyan" sparkline={revenueDaily}
            icon={<svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2M12 8V7m0 1v8m0 0v1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>} />
          <KpiCard label="Lead Generati" value={fmt(extra?.preventiviTotal || 0)} color="amber" sparkline={leadsDaily}
            icon={<svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path d="M9 12l2 2 4-4M12 2a10 10 0 100 20 10 10 0 000-20z" /></svg>} />
          <KpiCard label="Utenti Wallet" value={fmt(extra?.walletCount || 0)} color="blue" sparkline={revenueDaily.map(d => ({ value: Math.max(1, d.value / 50) }))}
            icon={<svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>} />
          <KpiCard label="Member DR7 Club" value={fmt(extra?.clubCount || 0)} color="rose" sparkline={trafficDaily.map(d => ({ value: Math.max(1, d.value / 5) }))}
            icon={<svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path d="M11 3l2 5h5l-4 3 2 6-5-4-5 4 2-6-4-3h5l2-5z" /></svg>} />
        </div>

        {/* ROW 2 — Traffic / Channels / Devices / Active users */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 flex-1 min-h-0">
          <Panel title="Prenotazioni nel Tempo" className="flex flex-col">
            <div className="flex-1 min-h-0">
              <ResponsiveContainer>
                <AreaChart data={trafficDaily}>
                  <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#06b6d4" stopOpacity={0.5} /><stop offset="100%" stopColor="#06b6d4" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="day" stroke="#64748b" fontSize={8} />
                  <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 6, fontSize: 10 }} />
                  <Area type="monotone" dataKey="value" stroke="#06b6d4" strokeWidth={2} fill="url(#g1)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel title="Clienti per Tipologia" className="flex flex-col">
            <div className="flex-1 min-h-0 relative">
              <ResponsiveContainer><PieChart><Pie data={extra?.customerTypes || []} dataKey="value" cx="50%" cy="50%" innerRadius={28} outerRadius={50} paddingAngle={2}>{(extra?.customerTypes || []).map((e, i) => <Cell key={i} fill={e.color} />)}</Pie></PieChart></ResponsiveContainer>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center"><div className="text-sm font-bold tabular-nums">{fmt(kpi?.customers.totalCustomers || 0)}</div><div className="text-[8px] text-slate-500">Clienti</div></div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-2 text-[9px] mt-1">
              {(extra?.customerTypes || []).map((c, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-1 min-w-0"><span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c.color }} /><span className="text-slate-300 truncate">{c.name}</span></div>
                  <span className="text-slate-400 tabular-nums">{c.value}</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Flotta" className="flex flex-col">
            <div><div className="text-2xl font-bold tabular-nums text-white leading-none">{fmt(kpi?.fleet.totalVehicles || 0)}</div><div className="text-[9px] text-slate-500">Veicoli totali</div></div>
            <div className="mt-3 space-y-1">
              <div className="flex justify-between text-[10px]"><span className="text-slate-300">Noleggiati ora</span><span className="tabular-nums font-bold text-emerald-400">{kpi?.fleet.rentedNow || 0}</span></div>
              <div className="flex justify-between text-[10px]"><span className="text-slate-300">Idle ora</span><span className="tabular-nums font-bold text-amber-400">{kpi?.fleet.idleNow || 0}</span></div>
              <div className="flex justify-between text-[10px]"><span className="text-slate-300">Occupazione</span><span className="tabular-nums font-bold text-cyan-400">{(kpi?.fleet.occupationRate || 0).toFixed(0)}%</span></div>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden mt-1"><div className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500" style={{ width: `${Math.min(100, kpi?.fleet.occupationRate || 0)}%` }} /></div>
            </div>
          </Panel>
          <Panel title="Prenotazioni Stato" className="flex flex-col">
            <div className="flex-1 min-h-0">
              <ResponsiveContainer>
                <BarChart data={[
                  { name: 'Confermate', value: kpi?.bookings.confirmed || 0, color: '#10b981' },
                  { name: 'Pending', value: kpi?.bookings.pending || 0, color: '#f59e0b' },
                  { name: 'Annullate', value: kpi?.bookings.cancelled || 0, color: '#ef4444' },
                ]}>
                  <XAxis dataKey="name" stroke="#64748b" fontSize={9} />
                  <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 6, fontSize: 10 }} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {[{ color: '#10b981' }, { color: '#f59e0b' }, { color: '#ef4444' }].map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>

        {/* ROW 3 — Funnel / Conversione / Fatturato / Lead */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 flex-1 min-h-0">
          <Panel title="Funnel Preventivi → Prenotazioni" className="flex flex-col">
            <div className="flex-1 min-h-0">
              <ResponsiveContainer><FunnelChart><Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 6, fontSize: 10 }} /><Funnel dataKey="value" data={funnelData} isAnimationActive><LabelList position="right" dataKey="name" fill="#cbd5e1" fontSize={9} /></Funnel></FunnelChart></ResponsiveContainer>
            </div>
          </Panel>
          <Panel title="Conversione nel Tempo" className="flex flex-col">
            <div><div className="text-xl font-bold tabular-nums text-white leading-none">{conversionRate.toFixed(2)}%</div><div className="text-[10px] text-emerald-400 font-semibold">{fmtPct(bookingsTrend)}</div></div>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer><AreaChart data={conversionDaily}><defs><linearGradient id="g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a855f7" stopOpacity={0.5} /><stop offset="100%" stopColor="#a855f7" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#1e293b" /><XAxis dataKey="day" stroke="#64748b" fontSize={8} /><Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 6, fontSize: 10 }} formatter={(v) => [`${Number(v).toFixed(1)}%`, 'Conv.']} /><Area type="monotone" dataKey="value" stroke="#a855f7" strokeWidth={2} fill="url(#g2)" /></AreaChart></ResponsiveContainer>
            </div>
          </Panel>
          <Panel title="Fatturato nel Tempo" className="flex flex-col">
            <div><div className="text-xl font-bold tabular-nums text-white leading-none">{fmtEur(revenue)}</div><div className="text-[10px] text-emerald-400 font-semibold">{fmtPct(revenueTrend)}</div></div>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer><AreaChart data={revenueDaily}><defs><linearGradient id="g3" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.5} /><stop offset="100%" stopColor="#10b981" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#1e293b" /><XAxis dataKey="day" stroke="#64748b" fontSize={8} /><Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 6, fontSize: 10 }} formatter={(v) => [`€ ${Number(v).toLocaleString('it-IT')}`, 'Fatt.']} /><Area type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} fill="url(#g3)" /></AreaChart></ResponsiveContainer>
            </div>
          </Panel>
          <Panel title="Lead Generati nel Tempo" className="flex flex-col">
            <div><div className="text-xl font-bold tabular-nums text-white leading-none">{fmt(extra?.preventiviTotal || 0)}</div><div className="text-[10px] text-slate-500">preventivi nel periodo</div></div>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer><AreaChart data={leadsDaily}><defs><linearGradient id="g4" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f59e0b" stopOpacity={0.5} /><stop offset="100%" stopColor="#f59e0b" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#1e293b" /><XAxis dataKey="day" stroke="#64748b" fontSize={8} /><Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 6, fontSize: 10 }} /><Area type="monotone" dataKey="value" stroke="#f59e0b" strokeWidth={2} fill="url(#g4)" /></AreaChart></ResponsiveContainer>
            </div>
          </Panel>
        </div>

        {/* ROW 4 — DR7 Ecosystem / Performance / Marketing / Top Auto / Alerts */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-2 flex-1 min-h-0">
          <Panel title="DR7 Ecosystem" className="flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto pr-1">
              <ListItem label="Utenti Wallet" value={fmt(extra?.walletCount || 0)} />
              <ListItem label="Saldo Wallet" value={fmtEur(extra?.walletTotalBalance || 0)} color="text-emerald-400" />
              <ListItem label="Iscritti Club" value={fmt(extra?.clubCount || 0)} color="text-amber-400" />
              <ListItem label="Entrate Abb." value={fmtEur(extra?.clubRevenue || 0)} color="text-emerald-400" />
              <ListItem label="Cashback" value={fmtEur(extra?.cashbackTotal || 0)} color="text-rose-400" />
            </div>
          </Panel>
          <Panel title="Performance Operativa" className="flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto pr-1">
              <ListItem label="Prenotaz. Attive" value={fmt(bookings)} trend={bookingsTrend} color="text-cyan-400" />
              <ListItem label="Confermate" value={fmt(kpi?.bookings.confirmed || 0)} color="text-emerald-400" />
              <ListItem label="Pending" value={fmt(kpi?.bookings.pending || 0)} color="text-amber-400" />
              <ListItem label="Annullate" value={fmt(kpi?.bookings.cancelled || 0)} color="text-rose-400" />
              <ListItem label="Valore Perso" value={fmtEur(extra?.preventiviLost || 0)} color="text-rose-400" />
              <ListItem label="Macch. Ferme" value={fmt(kpi?.fleet.idleNow || 0)} color="text-amber-400" />
            </div>
          </Panel>
          <Panel title="Preventivi & Lead" className="flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto pr-1">
              <ListItem label="Tot. Preventivi" value={fmt(extra?.preventiviTotal || 0)} color="text-cyan-400" />
              <ListItem label="Accettati" value={fmt(extra?.preventiviAccepted || 0)} color="text-emerald-400" />
              <ListItem label="Conv. Rate" value={`${conversionRate.toFixed(1)}%`} color="text-purple-400" />
              <ListItem label="Persi" value={fmtEur(extra?.preventiviLost || 0)} color="text-rose-400" />
              <ListItem label="Nuovi Clienti" value={fmt(kpi?.customers.newThisMonth || 0)} trend={kpi?.customers.changePercent} color="text-blue-400" />
            </div>
          </Panel>
          <Panel title="Top Auto più Prenotate (90j)" className="flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto space-y-1">
              {(extra?.topVehicles || []).map((v, i) => (
                <div key={i} className="flex items-center gap-1.5 py-1 border-b border-slate-800 last:border-0">
                  {v.image
                    ? <img src={v.image} alt={v.name} className="w-7 h-7 rounded object-cover" />
                    : <div className="w-7 h-7 rounded bg-gradient-to-br from-slate-700 to-slate-800 grid place-items-center text-[7px] text-slate-400">DR7</div>}
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-semibold truncate text-white">{v.name}</div>
                    <div className="text-[8px] text-slate-500">{v.views} prenotaz.</div>
                  </div>
                </div>
              ))}
              {(!extra || extra.topVehicles.length === 0) && <div className="text-center text-slate-500 text-[10px] py-4">Nessun veicolo</div>}
            </div>
          </Panel>
          <Panel title="Alert & Notifiche" className="flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto space-y-1.5">
              {(kpi?.bookings.pending || 0) > 0 && (
                <div className="flex items-start gap-1.5 p-1.5 bg-amber-500/10 border border-amber-500/30 rounded text-[10px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1 shrink-0" />
                  <span className="text-amber-200">{kpi?.bookings.pending} prenotazioni pending</span>
                </div>
              )}
              {(extra?.preventiviLost || 0) > 0 && (
                <div className="flex items-start gap-1.5 p-1.5 bg-rose-500/10 border border-rose-500/30 rounded text-[10px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400 mt-1 shrink-0" />
                  <span className="text-rose-200">Valore preventivi persi: {fmtEur(extra?.preventiviLost || 0)}</span>
                </div>
              )}
              {(kpi?.fleet.idleNow || 0) > 5 && (
                <div className="flex items-start gap-1.5 p-1.5 bg-cyan-500/10 border border-cyan-500/30 rounded text-[10px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1 shrink-0" />
                  <span className="text-cyan-200">{kpi?.fleet.idleNow} veicoli idle ora</span>
                </div>
              )}
              {conversionRate > 50 && (
                <div className="flex items-start gap-1.5 p-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded text-[10px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1 shrink-0" />
                  <span className="text-emerald-200">Conversion rate ottima: {conversionRate.toFixed(1)}%</span>
                </div>
              )}
            </div>
          </Panel>
        </div>

      </div>
    </div>
  )
}
