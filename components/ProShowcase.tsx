import React, { useState } from 'react';
import { Check, Crown, Film, Monitor, Sparkles } from 'lucide-react';

const features = [
  { icon: Sparkles, title: 'A clean, professional finish', detail: 'Export videos, GIFs, and PNG images without the FrameCut watermark.' },
  { icon: Monitor, title: 'Every detail, up to 4K', detail: 'Unlock 1080p and 4K video exports, beyond Free’s 720p limit.' },
  { icon: Film, title: 'GIFs that tell the whole story', detail: 'Go beyond 15 seconds, with larger GIFs within your browser’s resource limits.' },
];

export function ProShowcase() {
  const [preview, setPreview] = useState('export');
  return <section aria-label="FrameCut Pro features" className="space-y-5">
    <div><p className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-wide text-violet-300"><Crown size={18} aria-hidden="true" /> FRAMECUT PRO</p>
      <h3 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">Your best work.<br />Beautifully exported.</h3>
      <p className="mt-3 text-sm leading-relaxed text-zinc-300">Keep every detail. Make the final video yours.</p></div>
    <figure className="overflow-hidden rounded-xl border border-white/10 bg-zinc-950">
      <img src={`/pro-features/${preview}.jpg`} width={1440} height={900} alt={preview === 'export' ? 'FrameCut web export settings with 4K video resolution selected' : 'FrameCut web editor with a video preview and editing timeline'} className="aspect-[8/5] w-full object-contain" />
      <figcaption className="flex gap-2 border-t border-white/10 p-2">{[['export', 'Export in detail'], ['editor', 'See the editor']].map(([id, label]) => <button key={id} type="button" aria-pressed={preview === id} onClick={() => setPreview(id)} className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300 ${preview === id ? 'bg-violet-500/20 text-violet-200' : 'text-zinc-400 hover:bg-white/5 hover:text-white'}`}>{label}</button>)}</figcaption>
    </figure>
    <div className="space-y-4">{features.map(({ icon: Icon, title, detail }) => <div key={title} className="flex items-start gap-3"><span className="rounded-lg bg-violet-400/10 p-2 text-violet-300"><Icon size={18} aria-hidden="true" /></span><div><h4 className="text-sm font-semibold">{title}</h4><p className="mt-1 text-xs leading-relaxed text-zinc-400">{detail}</p></div></div>)}</div>
    <p className="rounded-xl border border-white/10 p-3 text-xs leading-relaxed text-zinc-400"><Check size={14} className="mr-1 inline text-emerald-400" aria-hidden="true" /> Recording, importing, editing, zoom, backgrounds, and captions are already free. Free exports have a watermark: 720p video and GIFs up to 15 seconds.</p>
  </section>;
}

export function ProPlans({ authenticated, busy, checkout }: { authenticated: boolean; busy: boolean; checkout: (sku: string) => void }) {
  const [selected, setSelected] = useState('framecut_pro_perpetual');
  const plans = [
    { sku: 'framecut_pro_perpetual', title: 'One-time Pro', price: '$59', period: 'once', detail: 'Ongoing web Pro + 1 year of Mac updates' },
    { sku: 'framecut_pro_annual', title: 'Annual', price: '$48', period: '/ year', detail: 'Billed yearly · renews automatically' },
    { sku: 'framecut_pro_monthly', title: 'Monthly', price: '$8', period: '/ month', detail: 'Billed monthly · renews automatically' },
  ];
  return <section aria-label="Pro plans" className="space-y-3">
    <div><h3 className="text-lg font-semibold">Choose your Pro</h3><p className="mt-1 text-xs text-zinc-400">One direct license for web Pro and two Macs.</p></div>
    <div role="group" aria-label="Choose a Pro plan" className="space-y-2">{plans.map(plan => <button type="button" key={plan.sku} disabled={busy} aria-pressed={selected === plan.sku} onClick={() => setSelected(plan.sku)} className={`w-full rounded-xl border p-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300 ${selected === plan.sku ? 'border-violet-400 bg-violet-400/10' : 'border-zinc-700 bg-zinc-950/40 hover:border-zinc-500'}`}><span className="flex items-center justify-between gap-2"><span className="text-sm font-semibold">{plan.title}</span><span className="text-xl font-semibold">{plan.price}<span className="ml-1 text-xs font-normal text-zinc-400">{plan.period}</span></span></span><span className="mt-2 block text-xs text-zinc-400">{plan.detail}</span></button>)}</div>
    {authenticated ? <button type="button" disabled={busy} onClick={() => checkout(selected)} className="w-full rounded-xl bg-violet-500 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300 disabled:opacity-50">Continue to secure checkout</button> : <p className="text-xs leading-relaxed text-violet-200">Sign in below to purchase Pro or redeem an existing license.</p>}
    <p className="text-xs leading-relaxed text-zinc-400">Prices in USD. One-time Pro does not renew; eligible Mac releases keep working after update coverage ends. Subscriptions renew until canceled in Manage Stripe billing. 30-day refund window. Contact licensing@innosage.co for refunds or email changes. Mac App Store purchases are separate.</p>
  </section>;
}
