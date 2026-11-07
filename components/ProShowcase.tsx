import React, { useEffect, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, Monitor } from 'lucide-react';

const slides = [
  { id: '01', title: 'Make every cut count.' },
  { id: '02', title: 'Bring the details into focus.' },
  { id: '03', title: 'Give every frame your style.' },
  { id: '04', title: 'Make your message clear.' },
  { id: '05', title: 'Ready for wherever you share.' },
];

export function ProShowcase() {
  const [index, setIndex] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (hovering || focused) return;
    const timer = window.setInterval(() => {
      if (!document.hidden && !motion.matches) setIndex(current => (current + 1) % slides.length);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [index, hovering, focused]);
  const slide = slides[index];
  const move = (offset: number) => setIndex(current => (current + offset + slides.length) % slides.length);
  return <section aria-label="FrameCut Pro feature carousel" aria-roledescription="carousel" tabIndex={0}
    onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}
    onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1); } }}
    className="flex min-w-0 flex-col gap-4 rounded-2xl border border-white/10 bg-gradient-to-br from-zinc-800/80 to-blue-950/30 p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">
    <div className="flex items-center justify-between text-xs text-zinc-400"><span className="flex items-center gap-2 font-semibold"><Monitor size={16} aria-hidden="true" />FrameCut for Mac</span></div>
    <img src={`/pro-features/app-store-${slide.id}.png`} width={2880} height={1800} alt={`FrameCut for Mac: ${slide.title}`} className="aspect-[8/5] w-full rounded-xl object-contain" />
    <div role="region" aria-label="Included with every Pro plan">
      <h4 className="text-xs font-semibold">Every plan includes</h4>
      <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">{['No watermark', '1080p & 4K video', 'Longer GIFs', 'Clean PNG images'].map(feature => <li key={feature} className="flex items-start gap-2 text-xs text-zinc-300"><CheckCircle2 size={14} className="shrink-0 text-blue-300" aria-hidden="true" />{feature}</li>)}</ul>
    </div>
    <div className="flex items-center justify-between gap-4">
      <button type="button" aria-label="Previous feature" onClick={() => move(-1)} className="rounded-full border border-white/15 p-2 text-zinc-300 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"><ChevronLeft size={16} /></button>
      <div className="flex gap-1" aria-label="Choose a feature">{slides.map((item, itemIndex) => <button key={item.id} type="button" aria-label={`Show feature: ${item.title}`} aria-pressed={index === itemIndex} onClick={() => setIndex(itemIndex)} className="rounded-full p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"><span className={`block h-1.5 w-1.5 rounded-full ${index === itemIndex ? 'bg-blue-400' : 'bg-zinc-600'}`} /></button>)}</div>
      <button type="button" aria-label="Next feature" onClick={() => move(1)} className="rounded-full border border-white/15 p-2 text-zinc-300 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"><ChevronRight size={16} /></button>
    </div>
  </section>;
}

const plans = [
  { sku: 'framecut_pro_perpetual', title: 'One-time Pro', price: '$59', period: 'once', highlights: ['Keep eligible Mac releases', '1 year of Mac updates'] },
  { sku: 'framecut_pro_annual', title: 'Annual', price: '$48', period: '/ year', highlights: ['12 months of Pro + updates'] },
  { sku: 'framecut_pro_monthly', title: 'Monthly', price: '$8', period: '/ month', highlights: ['1 month of Pro + updates'] },
];

export function ProPlans({ authenticated, busy, checkout }: { authenticated: boolean; busy: boolean; checkout: (sku: string) => void }) {
  const [selected, setSelected] = useState(plans[0].sku);
  return <section aria-label="Pro plans" className="space-y-3">
    <div><h3 className="text-2xl font-semibold tracking-tight">Choose your Pro</h3><p className="mt-2 text-xs text-zinc-400">Web Pro + two Macs · prices in USD</p></div>
    <div role="group" aria-label="Choose a Pro plan" className="space-y-3">{plans.map(plan => <button type="button" key={plan.sku} disabled={busy} aria-pressed={selected === plan.sku} onClick={() => setSelected(plan.sku)}
      className={`grid w-full grid-cols-[0.85fr_1.15fr] items-center gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300 disabled:opacity-50 ${selected === plan.sku ? 'border-blue-400 bg-blue-400/10' : 'border-zinc-700 bg-zinc-950/30 hover:border-zinc-500'}`}>
      <span><span className="block text-sm font-semibold">{plan.title}</span><span className="mt-2 block text-2xl font-semibold tracking-tight">{plan.price}<span className="ml-1 text-xs font-normal tracking-normal text-zinc-400">{plan.period}</span></span></span>
      <span className="space-y-2 border-l border-white/10 pl-3">{plan.highlights.map(highlight => <span key={highlight} className="flex items-start gap-2 text-xs leading-relaxed text-zinc-300"><CheckCircle2 size={14} className={`mt-0.5 shrink-0 ${selected === plan.sku ? 'text-blue-300' : 'text-zinc-500'}`} aria-hidden="true" />{highlight}</span>)}</span>
    </button>)}</div>
    {authenticated ? <button type="button" disabled={busy} onClick={() => checkout(selected)} className="w-full rounded-xl bg-blue-500 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300 disabled:opacity-50">Continue to secure checkout</button> : <p className="text-xs text-blue-200">Sign in below to purchase or redeem a license.</p>}
    <p className="text-xs leading-relaxed text-zinc-400">{selected === plans[0].sku ? 'One-time payment. No renewal.' : 'Auto-renews until canceled in Manage Stripe billing.'} Mac App Store purchases are separate. 30-day refund window. <a href="mailto:licensing@innosage.co" className="underline underline-offset-2">Support & refunds</a></p>
  </section>;
}
