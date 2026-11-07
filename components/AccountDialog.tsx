import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { AccountState, SharedLicense, licensing } from '../src/auth/licenseClient';

import { ProPlans, ProShowcase } from './ProShowcase';

const button = 'rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700 disabled:opacity-50';
const input = 'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500';
const licenseSummary = (license: SharedLicense) => {
  if (license.status !== 'active') return 'Pro access is inactive.';
  if (license.billing_kind === 'perpetual') return 'Web Pro continues after desktop update coverage ends.';
  return license.ent_exp ? `Paid through ${new Date(license.ent_exp * 1000).toLocaleDateString()}` : 'Paid period unavailable. Contact support.';
};

export default function AccountDialog({ account, onClose }: { account: AccountState; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState(''); const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState(''); const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [link, setLink] = useState('');
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const controls = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]') || [])];
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root.current)) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keys);
    return () => { document.removeEventListener('keydown', keys); previous?.focus(); };
  }, [onClose]);
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return; setBusy(true); setMessage(''); setLink('');
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  };
  const external = (kind: 'checkout' | 'billing', value: string) => {
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    void run(async () => {
      try {
        const result = await (kind === 'billing' ? licensing.billing(value) : licensing.checkout(value));
        const url = new URL(result.url);
        if (url.protocol !== 'https:' || url.hostname !== (kind === 'billing' ? 'billing.stripe.com' : 'checkout.stripe.com')) throw new Error('The payment link could not be verified.');
        if (popup) popup.location.href = url.href; else setLink(url.href);
        setMessage(kind === 'billing' ? 'Billing opened in a new tab. Changes refresh when you return.' : 'Checkout opened in a new tab. After payment, redeem the key from your purchase email.');
      } catch (error) { popup?.close(); throw error; }
    });
  };
  return createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="account-title" className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 p-6 text-zinc-100 shadow-2xl space-y-5">
      <div className="sticky -top-6 z-10 -mx-6 flex items-center justify-end bg-zinc-900 px-6 py-1"><h2 id="account-title" className="sr-only">FrameCut account</h2><button aria-label="Close account" onClick={onClose} className={button}><X size={18} /></button></div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.1fr)]">
      <ProShowcase />
      <div className="space-y-5">
      {!account.pro && <ProPlans authenticated={account.authenticated} busy={busy} checkout={sku => external('checkout', sku)} />}
      <h3 className="border-t border-zinc-700 pt-5 font-semibold">{account.authenticated ? 'Your account' : 'Sign in to continue'}</h3>
      {account.error && <p role="status" className="text-sm text-amber-300">{account.error}</p>}
      <fieldset disabled={busy} className="space-y-5 disabled:opacity-70">
        {!account.authenticated ? <form className="space-y-3" onSubmit={event => { event.preventDefault(); void run(async () => {
          if (challenge) { await licensing.verify(challenge, code); setCode(''); setChallenge(''); }
          else { const result = await licensing.requestCode(email); setChallenge(result.challenge_id); setMessage('Check your email for an eight-digit sign-in code. It expires in 10 minutes.'); }
        }); }}>
          <label className="block text-sm">Purchase email<input className={input} type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} disabled={!!challenge} /></label>
          {challenge && <label className="block text-sm">Sign-in code<input className={input} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" maxLength={8} required value={code} onChange={event => setCode(event.target.value)} /></label>}
          <button className={button} type="submit">{challenge ? 'Verify and sign in' : 'Email me a sign-in code'}</button>
          {challenge && <button type="button" className={`${button} ml-2`} onClick={() => { setChallenge(''); setCode(''); setMessage(''); }}>Use another email / new code</button>}
        </form> : <>
          <div className="flex items-center justify-between gap-3"><div><p className="font-medium">{account.email}</p><p className="text-sm text-amber-300">{account.pro ? 'Pro active' : 'Free exports'}{account.sandbox ? ' · InnoSage sandbox' : ''}</p></div><button className={button} onClick={() => void run(() => licensing.logout())}>Sign out</button></div>
          {!account.session_active && <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-2"><p className="text-sm">{account.session_released ? 'This browser session was released. Resume it to use Pro here.' : 'Two browser sessions may be active at once. Release an old session below, then resume this browser.'} You can keep editing and export for free.</p><button className={button} onClick={() => void run(() => licensing.resume())}>Resume this browser</button></div>}
          <form className="space-y-2" onSubmit={event => { event.preventDefault(); void run(async () => { await licensing.redeem(key); setKey(''); setMessage('License linked to your verified account.'); }); }}>
            <label className="block text-sm">Redeem your license<input className={input} type="password" autoComplete="off" placeholder="FRAMECUT-…" maxLength={200} required value={key} onChange={event => setKey(event.target.value)} /></label><p className="text-xs text-zinc-400">Use the key from your purchase email. Your sign-in email must match the purchase email. Redemption does not consume a Mac seat.</p><button className={button} type="submit">Redeem license</button>
          </form>
          {account.licenses.length > 0 && <section className="space-y-2"><h3 className="font-medium">Your licenses</h3>{account.licenses.map(license => <div key={license.id} className="rounded-lg border border-zinc-700 p-3 space-y-2"><p className="text-sm">{license.billing_kind === 'perpetual' ? 'One-time Pro' : 'Pro subscription'} · {license.status}{license.key_suffix ? ` · …${license.key_suffix}` : ''}</p><p className="text-xs text-zinc-400">{licenseSummary(license)}</p><button className={button} onClick={() => external('billing', license.id)}>Manage Stripe billing</button></div>)}</section>}
          <section className="space-y-2"><h3 className="font-medium">Active browser sessions · {account.sessions.length}/2</h3><p className="text-xs text-zinc-400">Tabs in the same browser share a session. Abandoned sessions expire after two minutes. Releasing one stops it from automatically reclaiming access.</p>{account.sessions.map(session => <div key={session.id} className="flex items-center justify-between gap-2 text-sm"><span>{session.label}{session.id === account.session_id ? ' · This browser' : ''}</span><button className={button} onClick={() => void run(() => licensing.release(session.id))}>Release session</button></div>)}</section>
          <button className={button} onClick={() => void run(() => licensing.refresh())}>Refresh account</button>
        </>}
      </fieldset>
      {(busy || message) && <p role="status" className="text-sm text-blue-200">{busy ? 'Working…' : message}</p>}
      {link && <a className="text-sm text-blue-300 underline" href={link} target="_blank" rel="noopener noreferrer">Open secure Stripe page</a>}
      </div></div>
    </div>
  </div>, document.body);
}
