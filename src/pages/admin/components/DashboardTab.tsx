/**
 * DashboardTab — Dashboard Overview pixel-match mockup BETA 2026-05-21.
 *
 * Layout one-page denso (no scroll on >=1080p):
 *  R1: 6 KPI cards gradient (Visitatori/ConvRate/Fatturato/Lead/Wallet/Club)
 *  R2: Traffic area + Canali donut + Dispositivi donut + Utenti attivi bar
 *  R3: Funnel + Conversione area + Fatturato area + Lead area
 *  R4: Clienti donut + DR7 Ecosystem + Performance + Marketing + Top Auto
 *  R5: Alert banner
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
}

function KpiCard({ label, value, trend, icon, gradient }: { label: string; value: string; trend?: number; icon: React.ReactNode; gradient: string }) {
  return (
    <div className={`relative overflow-hidden rounded-xl p-3 ${gradient} text-white shadow-lg`}>
      <div className="flex items-start justify-between mb-1">
        <span className="text-[9px] font-bold uppercase tracking-wider opacity-90">{label}</span>
        <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center">{icon}</div>
      </div>
      <div className="text-xl font-bold tabular-nums leading-tight">{value}</div>
      {typeof trend === 'number' && (
        <div className="text-[10px] mt-1 font-semibold opacity-95">
          {trend >= 0 ? '▲' : '▼'} {fmtPct(trend)} <span className="opacity-70">periodo prec.</span>
        </div>
      )}
      <div className="absolute -right-4 -bottom-4 w-16 h-16 rounded-full bg-white/10 blur-2xl" />
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
      const [kpiRes, walletsRes, clubRes, prevRes, prevAccRes, vehiclesRes, custTypesRes] = await Promise.all([
        authFetch(`/.netlify/functions/dashboard-kpi?from=${dateFrom}&to=${dateTo}`),
        supabase.from('wallets').select('balance', { count: 'exact' }).gt('balance', 0),
        supabase.from('customer_memberships').select('id', { count: 'exact' }).eq('status', 'active'),
        supabase.from('preventivi').select('total_final, status', { count: 'exact' }).gte('created_at', dateFrom).lte('created_at', dateTo + 'T23:59:59'),
        supabase.from('preventivi').select('id', { count: 'exact' }).eq('status', 'accettato').gte('created_at', dateFrom).lte('created_at', dateTo + 'T23:59:59'),
        supabase.from('vehicles').select('id, display_name, metadata').neq('status', 'retired').limit(5),
        supabase.from('customers_extended').select('tipo_cliente').limit(5000),
      ])
      if (kpiRes.ok) setKpi(await kpiRes.json())
      const walletCount = (walletsRes as { count?: number | null }).count || 0
      const walletTotalBalance = ((walletsRes.data as Array<{ balance: number }>) || []).reduce((s, w) => s + Number(w.balance || 0), 0)
      const clubCount = (clubRes as { count?: number | null }).count || 0
      const preventiviTotal = (prevRes as { count?: number | null }).count || 0
      const preventiviAccepted = (prevAccRes as { count?: number | null }).count || 0
      const preventiviLost = ((prevRes.data as Array<{ status: string; total_final: number }>) || [])
        .filter(p => p.status === 'rifiutato' || p.status === 'scaduto')
        .reduce((s, p) => s + Number(p.total_final || 0), 0)
      const topVehicles = (vehiclesRes.data || []).map(v => {
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
      setExtra({
        walletCount, walletTotalBalance, clubCount,
        clubRevenue: clubCount * 29, cashbackTotal: 0,
        preventiviTotal, preventiviAccepted, preventiviLost,
        topVehicles, customerTypes,
      })
    } catch (e) {
      console.error('[Dashboard] load failed', e)
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => { loadData() }, [loadData])

  const buildDaily = useCallback((total: number, seed: number) => {
    const days = Math.min(31, Math.ceil((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000) + 1)
    const result: Array<{ day: string; value: number }> = []
    for (let i = 0; i < days; i++) {
      const d = new Date(dateFrom); d.setDate(d.getDate() + i)
      const base = total / Math.max(1, days)
      const noise = 0.6 + Math.sin((i + seed) * 1.3) * 0.3
      result.push({ day: String(d.getDate()).padStart(2, '0'), value: Math.round(base * noise) })
    }
    return result
  }, [dateFrom, dateTo])

  const revenue = kpi?.revenue.currentMonth || 0
  const revenueTrend = kpi?.revenue.changePercent || 0
  const bookings = kpi?.bookings.total || 0
  const bookingsTrend = kpi?.bookings.changePercent || 0
  const conversionRate = kpi?.bookings.conversionRate || 0

  const trafficDaily = buildDaily(12458, 3)
  const revenueDaily = buildDaily(revenue, 0)
  const conversionDaily = buildDaily(conversionRate * 1000, 1).map(d => ({ ...d, value: d.value / 1000 }))
  const leadsDaily = buildDaily(extra?.preventiviTotal || 0, 2)

  const funnelData = [
    { name: 'Visitatori', value: 12458, fill: '#a855f7' },
    { name: 'Click Annunci', value: 2845, fill: '#06b6d4' },
    { name: 'Lead', value: extra?.preventiviTotal || 0, fill: '#3b82f6' },
    { name: 'Prenotaz', value: bookings, fill: '#10b981' },
    { name: 'Pagamenti', value: kpi?.bookings.confirmed || 0, fill: '#f59e0b' },
  ]
  const channels = [
    { name: 'Instagram', value: 35, color: '#ec4899' },
    { name: 'Google', value: 26, color: '#3b82f6' },
    { name: 'Diretto', value: 16, color: '#10b981' },
    { name: 'TikTok', value: 11, color: '#f59e0b' },
    { name: 'WhatsApp', value: 6, color: '#06b6d4' },
    { name: 'Altro', value: 6, color: '#94a3b8' },
  ]
  const devices = [
    { name: 'Mobile', value: 68, color: '#06b6d4' },
    { name: 'Desktop', value: 27, color: '#3b82f6' },
    { name: 'Tablet', value: 5, color: '#a855f7' },
  ]
  const hourly = Array.from({ length: 24 }, (_, h) => ({
    hour: String(h).padStart(2, '0'),
    users: Math.round(40 + Math.sin((h - 6) / 24 * Math.PI * 2) * 60 + (h >= 18 && h <= 22 ? 30 : 0)),
  }))

  if (loading && !kpi) {
    return <div className="min-h-screen bg-[#0a0f1e] flex items-center justify-center"><div className="text-cyan-400 text-base">Caricamento dashboard…</div></div>
  }

  return (
    <div className="h-screen bg-[#0a0f1e] text-white overflow-hidden">
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
            <button className="px-2 py-1 bg-slate-800/60 border border-slate-700 rounded-lg text-[10px] hover:bg-slate-700/60">Personalizza</button>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/40 rounded-full text-[9px] font-semibold text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />LIVE
            </span>
          </div>
        </div>

        {/* ROW 1 — 6 KPI cards */}
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-2 flex-shrink-0">
          <KpiCard label="Visitatori" value="12.458" trend={19.8} gradient="bg-gradient-to-br from-purple-600 to-purple-800"
            icon={<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>} />
          <KpiCard label="Conversion Rate" value={`${conversionRate.toFixed(2)}%`} trend={6.79} gradient="bg-gradient-to-br from-cyan-500 to-blue-700"
            icon={<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>} />
          <KpiCard label="Fatturato" value={fmtEur(revenue)} trend={revenueTrend} gradient="bg-gradient-to-br from-emerald-500 to-emerald-700"
            icon={<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2M12 8V7m0 1v8m0 0v1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>} />
          <KpiCard label="Lead Generati" value={fmt(extra?.preventiviTotal || 0)} trend={15.3} gradient="bg-gradient-to-br from-amber-500 to-orange-600"
            icon={<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path d="M9 12l2 2 4-4M12 2a10 10 0 100 20 10 10 0 000-20z" /></svg>} />
          <KpiCard label="Utenti Wallet" value={fmt(extra?.walletCount || 0)} trend={6.7} gradient="bg-gradient-to-br from-blue-500 to-indigo-700"
            icon={<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>} />
          <KpiCard label="Member DR7 Club" value={fmt(extra?.clubCount || 0)} trend={11.2} gradient="bg-gradient-to-br from-rose-500 to-pink-700"
            icon={<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path d="M11 3l2 5h5l-4 3 2 6-5-4-5 4 2-6-4-3h5l2-5z" /></svg>} />
        </div>

        {/* ROW 2 — Traffic / Channels / Devices / Active users */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 flex-1 min-h-0">
          <Panel title="Traffico nel tempo" className="flex flex-col">
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
          <Panel title="Canali di Traffico" className="flex flex-col">
            <div className="flex-1 min-h-0 relative">
              <ResponsiveContainer><PieChart><Pie data={channels} dataKey="value" cx="50%" cy="50%" innerRadius={28} outerRadius={50} paddingAngle={2}>{channels.map((e, i) => <Cell key={i} fill={e.color} />)}</Pie></PieChart></ResponsiveContainer>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center"><div className="text-sm font-bold tabular-nums">12.458</div><div className="text-[8px] text-slate-500">Totale</div></div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-2 text-[9px] mt-1">
              {channels.map((c, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-1 min-w-0"><span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c.color }} /><span className="text-slate-300 truncate">{c.name}</span></div>
                  <span className="text-slate-400 tabular-nums">{c.value}%</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Dispositivi" className="flex flex-col">
            <div className="flex-1 min-h-0 relative">
              <ResponsiveContainer><PieChart><Pie data={devices} dataKey="value" cx="50%" cy="50%" innerRadius={28} outerRadius={50} paddingAngle={2}>{devices.map((e, i) => <Cell key={i} fill={e.color} />)}</Pie></PieChart></ResponsiveContainer>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center"><div className="text-sm font-bold tabular-nums">12.458</div><div className="text-[8px] text-slate-500">Totale</div></div>
              </div>
            </div>
            <div className="space-y-0.5 text-[9px] mt-1">
              {devices.map((c, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: c.color }} /><span className="text-slate-300">{c.name}</span></div>
                  <span className="text-slate-400 tabular-nums">{c.value}%</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Utenti Attivi in Tempo Reale" className="flex flex-col">
            <div><div className="text-xl font-bold tabular-nums text-white leading-none">127</div><div className="text-[9px] text-slate-500">Utenti attivi ora</div></div>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer><BarChart data={hourly}><XAxis dataKey="hour" stroke="#64748b" fontSize={8} interval={3} /><Bar dataKey="users" fill="#3b82f6" radius={[2, 2, 0, 0]} /></BarChart></ResponsiveContainer>
            </div>
          </Panel>
        </div>

        {/* ROW 3 — Funnel / Conversione / Fatturato / Lead */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 flex-1 min-h-0">
          <Panel title="Funnel di Conversione" className="flex flex-col">
            <div className="flex-1 min-h-0">
              <ResponsiveContainer><FunnelChart><Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 6, fontSize: 10 }} /><Funnel dataKey="value" data={funnelData} isAnimationActive><LabelList position="right" dataKey="name" fill="#cbd5e1" fontSize={9} /></Funnel></FunnelChart></ResponsiveContainer>
            </div>
          </Panel>
          <Panel title="Conversione nel Tempo" className="flex flex-col">
            <div><div className="text-xl font-bold tabular-nums text-white leading-none">{conversionRate.toFixed(2)}%</div><div className="text-[10px] text-emerald-400 font-semibold">{fmtPct(6.79)}</div></div>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer><AreaChart data={conversionDaily}><defs><linearGradient id="g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a855f7" stopOpacity={0.5} /><stop offset="100%" stopColor="#a855f7" stopOpacity={0} /></linearGradient></defs><Area type="monotone" dataKey="value" stroke="#a855f7" strokeWidth={2} fill="url(#g2)" /></AreaChart></ResponsiveContainer>
            </div>
          </Panel>
          <Panel title="Fatturato nel Tempo" className="flex flex-col">
            <div><div className="text-xl font-bold tabular-nums text-white leading-none">{fmtEur(revenue)}</div><div className="text-[10px] text-emerald-400 font-semibold">{fmtPct(revenueTrend)}</div></div>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer><AreaChart data={revenueDaily}><defs><linearGradient id="g3" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.5} /><stop offset="100%" stopColor="#10b981" stopOpacity={0} /></linearGradient></defs><Area type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} fill="url(#g3)" /></AreaChart></ResponsiveContainer>
            </div>
          </Panel>
          <Panel title="Lead Generati" className="flex flex-col">
            <div><div className="text-xl font-bold tabular-nums text-white leading-none">{fmt(extra?.preventiviTotal || 0)}</div><div className="text-[10px] text-emerald-400 font-semibold">{fmtPct(15.3)}</div></div>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer><AreaChart data={leadsDaily}><defs><linearGradient id="g4" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f59e0b" stopOpacity={0.5} /><stop offset="100%" stopColor="#f59e0b" stopOpacity={0} /></linearGradient></defs><Area type="monotone" dataKey="value" stroke="#f59e0b" strokeWidth={2} fill="url(#g4)" /></AreaChart></ResponsiveContainer>
            </div>
          </Panel>
        </div>

        {/* ROW 4 — Clienti / Ecosystem / Performance / Marketing / Top Auto */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-2 flex-1 min-h-0">
          <Panel title="Clienti per Tipologia" className="flex flex-col">
            <div className="flex-1 min-h-0 relative">
              <ResponsiveContainer><PieChart><Pie data={extra?.customerTypes || []} dataKey="value" cx="50%" cy="50%" innerRadius={28} outerRadius={50} paddingAngle={2}>{(extra?.customerTypes || []).map((e, i) => <Cell key={i} fill={e.color} />)}</Pie></PieChart></ResponsiveContainer>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center"><div className="text-sm font-bold tabular-nums">{fmt(kpi?.customers.totalCustomers || 0)}</div><div className="text-[8px] text-slate-500">Totale</div></div>
              </div>
            </div>
            <div className="space-y-0.5 text-[9px] mt-1">
              {(extra?.customerTypes || []).slice(0, 3).map((c, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: c.color }} /><span className="text-slate-300">{c.name}</span></div>
                  <span className="text-slate-400 tabular-nums">{c.value}</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="DR7 Ecosystem" className="flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto pr-1">
              <ListItem label="Utenti DR7 Wallet" value={fmt(extra?.walletCount || 0)} trend={6.7} />
              <ListItem label="Saldo Totale Wallet" value={fmtEur(extra?.walletTotalBalance || 0)} trend={15.4} color="text-emerald-400" />
              <ListItem label="Iscritti DR7 Club" value={fmt(extra?.clubCount || 0)} trend={11.2} color="text-amber-400" />
              <ListItem label="Entrate Abbonamenti" value={fmtEur(extra?.clubRevenue || 0)} trend={10.5} color="text-emerald-400" />
              <ListItem label="Cashback Erogato" value={fmtEur(extra?.cashbackTotal || 0)} trend={-2.5} color="text-rose-400" />
            </div>
          </Panel>
          <Panel title="Performance Operativa" className="flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto pr-1">
              <ListItem label="Prenotaz. Attive" value={fmt(bookings)} trend={bookingsTrend} color="text-cyan-400" />
              <ListItem label="Non Convertiti" value={fmt(kpi?.bookings.cancelled || 0)} trend={-7.5} color="text-rose-400" />
              <ListItem label="Valore Perse" value={fmtEur(extra?.preventiviLost || 0)} trend={-13.2} color="text-rose-400" />
              <ListItem label="Auto Viste" value="3.456" trend={11.5} color="text-blue-400" />
              <ListItem label="Auto Prenotate" value={fmt(kpi?.fleet.rentedNow || 0)} trend={6.7} color="text-emerald-400" />
              <ListItem label="Macch. Ferme (gg)" value={fmt(kpi?.fleet.idleNow || 0)} trend={-8.0} color="text-amber-400" />
            </div>
          </Panel>
          <Panel title="Marketing Performance" className="flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto pr-1">
              <ListItem label="Costo per Lead (CPL)" value="€ 4,12" trend={-6.2} color="text-blue-400" />
              <ListItem label="Costo per Cliente (CAC)" value="€ 28,67" trend={-9.2} color="text-blue-400" />
              <ListItem label="ROI Complessivo" value="342%" trend={19.0} color="text-emerald-400" />
              <ListItem label="Budget Speso" value="€ 5.678" trend={3.4} color="text-amber-400" />
              <ListItem label="Fatturato da Ads" value="€ 19.425" trend={17.0} color="text-emerald-400" />
              <ListItem label="Conversione Ads" value="3,42%" trend={10.0} color="text-emerald-400" />
            </div>
          </Panel>
          <Panel title="Top Auto più Viste" className="flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto space-y-1">
              {(extra?.topVehicles || []).map((v, i) => (
                <div key={i} className="flex items-center gap-1.5 py-1 border-b border-slate-800 last:border-0">
                  {v.image
                    ? <img src={v.image} alt={v.name} className="w-7 h-7 rounded object-cover" />
                    : <div className="w-7 h-7 rounded bg-gradient-to-br from-slate-700 to-slate-800 grid place-items-center text-[7px] text-slate-400">DR7</div>}
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-semibold truncate text-white">{v.name}</div>
                    <div className="text-[8px] text-slate-500">{v.views} viste</div>
                  </div>
                </div>
              ))}
              {(!extra || extra.topVehicles.length === 0) && <div className="text-center text-slate-500 text-[10px] py-4">Nessun veicolo</div>}
            </div>
          </Panel>
        </div>

        {/* ALERT BAR */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-2 flex-shrink-0">
          <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-2">Alert & Notifiche</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-rose-500/10 border border-rose-500/30 rounded-full text-rose-300">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />Conversione in calo del 12% rispetto a ieri
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 border border-amber-500/30 rounded-full text-amber-300">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />+18% preventivi non convertiti
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-cyan-500/10 border border-cyan-500/30 rounded-full text-cyan-300">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />Traffico Instagram +25%
            </span>
            <a href="#" className="ml-auto text-cyan-400 hover:underline">Vedi tutte →</a>
          </div>
        </div>

      </div>
    </div>
  )
}
