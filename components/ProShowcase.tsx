import React, { useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, Crown } from 'lucide-react';

const slides = [
  { id: 'export', title: 'Every detail.\nBeautifully exported.', caption: 'Export a crisp, polished version of your work.', alt: 'FrameCut web export settings with 4K selected beside the demo video' },
  { id: 'editor', title: 'Your story.\nReady to share.', caption: 'Record and edit for free. Give your exports the Pro finish.', alt: 'FrameCut web editor showing a demo video and editing timeline' },
];

export function ProShowcase() {
  const [index, setIndex] = useState(0);
  const slide = slides[index];
  const move = (offset: number) => setIndex(current => (current + offset + slides.length) % slides.length);
  return <section aria-label="FrameCut Pro feature carousel" aria-roledescription="carousel" tabIndex={0}
    onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1); } }}
    className="flex min-w-0 flex-col rounded-2xl border border-white/10 bg-gradient-to-br from-zinc-800/80 to-blue-950/30 p-6 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 lg:min-h-[620px]">
    <p className="flex items-center gap-2 text-xs font-semibold tracking-widest text-blue-300"><Crown size={16} aria-hidden="true" /> FRAMECUT PRO</p>
    <h3 className="mt-5 whitespace-pre-line text-3xl font-semibold leading-tight tracking-tight" aria-live="polite">{slide.title}</h3>
    <div className="my-6 flex flex-1 items-center">
      <img src={`/pro-features/${slide.id}.jpg`} width={1440} height={900} alt={slide.alt} className="aspect-[8/5] w-full rounded-xl object-contain shadow-xl" />
    </div>
    <p className="min-h-10 text-sm leading-relaxed text-zinc-300">{slide.caption}</p>
    <div role="region" aria-label="Included with every Pro plan" className="mt-4">
      <h4 className="text-xs font-semibold">Every plan includes</h4>
      <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">{['No watermark', '1080p & 4K video', 'Longer GIFs', 'Clean PNG images'].map(feature => <li key={feature} className="flex items-start gap-2 text-xs text-zinc-300"><CheckCircle2 size={14} className="shrink-0 text-blue-300" aria-hidden="true" />{feature}</li>)}</ul>
    </div>
    <div className="mt-6 flex items-center justify-between gap-4">
      <button type="button" aria-label="Previous feature" onClick={() => move(-1)} className="rounded-full border border-white/15 p-2 text-zinc-300 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"><ChevronLeft size={16} /></button>
      <div className="flex gap-2" aria-label="Choose a feature">{slides.map((item, itemIndex) => <button key={item.id} type="button" aria-label={`Show ${item.id} feature`} aria-pressed={index === itemIndex} onClick={() => setIndex(itemIndex)} className="rounded-full p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"><span className={`block h-1.5 w-1.5 rounded-full ${index === itemIndex ? 'bg-blue-400' : 'bg-zinc-600'}`} /></button>)}</div>
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
      className={`grid w-full grid-cols-[0.8fr_1.2fr] items-center gap-4 rounded-2xl border p-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300 disabled:opacity-50 ${selected === plan.sku ? 'border-blue-400 bg-blue-400/10' : 'border-zinc-700 bg-zinc-950/30 hover:border-zinc-500'}`}>
      <span><span className="block text-sm font-semibold">{plan.title}</span><span className="mt-2 block text-3xl font-semibold tracking-tight">{plan.price}<span className="ml-1 text-xs font-normal tracking-normal text-zinc-400">{plan.period}</span></span></span>
      <span className="space-y-2 border-l border-white/10 pl-4">{plan.highlights.map(highlight => <span key={highlight} className="flex items-start gap-2 text-xs leading-relaxed text-zinc-300"><CheckCircle2 size={14} className={`mt-0.5 shrink-0 ${selected === plan.sku ? 'text-blue-300' : 'text-zinc-500'}`} aria-hidden="true" />{highlight}</span>)}</span>
    </button>)}</div>
    {authenticated ? <button type="button" disabled={busy} onClick={() => checkout(selected)} className="w-full rounded-xl bg-blue-500 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300 disabled:opacity-50">Continue to secure checkout</button> : <p className="text-xs text-blue-200">Sign in below to purchase or redeem a license.</p>}
    <p className="text-xs leading-relaxed text-zinc-400">{selected === plans[0].sku ? 'One-time payment. No renewal.' : 'Auto-renews until canceled in Manage Stripe billing.'} Mac App Store purchases are separate. 30-day refund window. <a href="mailto:licensing@innosage.co" className="underline underline-offset-2">Support & refunds</a></p>
  </section>;
}
