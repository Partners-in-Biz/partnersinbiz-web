// app/embed/newsletter/[sourceId]/widget.js/route.ts
//
// GET /embed/newsletter/[sourceId]/widget.js
//
// Returns a self-contained JavaScript bundle that, when included via
// <script src="..."></script> on any web page, renders a styled signup
// form in one of five display modes:
//
//   inline       — form rendered next to the script tag (legacy default)
//   popup        — full-screen modal with backdrop, triggered by delay /
//                  scroll / pageviews / exit-intent
//   slide-in     — small toaster sliding in from a corner
//   exit-intent  — popup that only fires when the user signals leaving
//   multi-step   — progressive form; first step captures the email, then
//                  cycles through extra fields. Partial submits POST to a
//                  separate /progressive endpoint so the email is captured
//                  even if the user abandons after step 1.
//
// Frequency control via localStorage and pageview gating via sessionStorage,
// path filters via simple glob matching, and CSS isolation via a high-z-index
// scoped block — everything namespaced with `pib_lc_<sourceId>_` so multiple
// widgets can coexist on a single page.

import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import {
  LEAD_CAPTURE_SOURCES,
  type CaptureSource,
} from '@/lib/lead-capture/types'

type Params = { params: Promise<{ sourceId: string }> }

function appUrl(req: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL
  if (env) return env.replace(/\/$/, '')
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host = req.headers.get('host') ?? 'partnersinbiz.online'
  return `${proto}://${host}`
}

function jsResponse(js: string, status: number = 200): NextResponse {
  return new NextResponse(js, {
    status,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

function escapeForJs(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/<\//g, '<\\/')
}

function turnstileConfigured(source: CaptureSource): boolean {
  return (
    source.turnstileEnabled === true &&
    typeof source.turnstileSiteKey === 'string' &&
    source.turnstileSiteKey.trim().length > 0 &&
    Boolean(process.env.TURNSTILE_SECRET_KEY)
  )
}

export async function GET(req: NextRequest, context: Params) {
  const { sourceId } = await context.params

  const snap = await adminDb.collection(LEAD_CAPTURE_SOURCES).doc(sourceId).get()
  if (!snap.exists || snap.data()?.deleted) {
    return jsResponse(
      `console.warn('[partnersinbiz] capture source ${escapeForJs(sourceId)} not found');`,
      404,
    )
  }
  const source = { id: snap.id, ...snap.data() } as CaptureSource
  if (!source.active) {
    return jsResponse(
      `console.warn('[partnersinbiz] capture source ${escapeForJs(sourceId)} is not active');`,
    )
  }

  const isTurnstileConfigured = turnstileConfigured(source)
  const publicConfig = {
    id: source.id,
    name: source.name,
    fields: source.fields ?? [],
    successMessage: source.successMessage,
    successRedirectUrl: source.successRedirectUrl ?? '',
    doubleOptIn: source.doubleOptIn,
    widgetTheme: source.widgetTheme,
    turnstileEnabled: isTurnstileConfigured,
    turnstileSiteKey: isTurnstileConfigured ? source.turnstileSiteKey : '',
    display: source.display ?? { mode: 'inline' },
  }

  const submitUrl = `${appUrl(req)}/api/embed/newsletter/${encodeURIComponent(sourceId)}/submit`
  const progressiveUrl = `${appUrl(req)}/api/v1/capture-sources/${encodeURIComponent(sourceId)}/progressive`
  const configJson = JSON.stringify(publicConfig)
  const safeId = escapeForJs(sourceId)

  const js = `(function(){
  if (window['__pibLeadCaptureLoaded_' + '${safeId}']) return;
  window['__pibLeadCaptureLoaded_' + '${safeId}'] = true;
  var CONFIG = ${configJson};
  var SUBMIT_URL = '${escapeForJs(submitUrl)}';
  var PROGRESSIVE_URL = '${escapeForJs(progressiveUrl)}';
  var theme = CONFIG.widgetTheme || {};
  var display = CONFIG.display || { mode: 'inline' };
  var MODE = display.mode || 'inline';
  var NS = 'pib_lc_' + CONFIG.id;
  var Z = 2147483647;
  var scripts = document.getElementsByTagName('script');
  var currentScript = document.currentScript || scripts[scripts.length - 1];
  var shown = false;
  var dismissed = false;

  // ─── storage helpers ─────────────────────────────────────────────────────
  function lsGet(k){ try { return window.localStorage.getItem(NS + '_' + k); } catch(e){ return null; } }
  function lsSet(k, v){ try { window.localStorage.setItem(NS + '_' + k, v); } catch(e){} }
  function ssGet(k){ try { return window.sessionStorage.getItem(NS + '_' + k); } catch(e){ return null; } }
  function ssSet(k, v){ try { window.sessionStorage.setItem(NS + '_' + k, v); } catch(e){} }

  // ─── path glob match: "*" = any chars, otherwise literal ────────────────
  function globMatch(pattern, path){
    if (!pattern) return false;
    var trimmed = String(pattern).trim();
    if (!trimmed) return false;
    if (trimmed === '*' || trimmed === '/*') return true;
    var re = '^' + trimmed.replace(/[.+?^$(){}|\\\\\\[\\]]/g, function(m){return '\\\\' + m;}).replace(/\\*/g, '.*') + '$';
    try { return new RegExp(re).test(path); } catch(e){ return false; }
  }
  function pathMatchesAny(patterns, path){
    if (!Array.isArray(patterns) || patterns.length === 0) return false;
    for (var i = 0; i < patterns.length; i++) {
      if (globMatch(patterns[i], path)) return true;
    }
    return false;
  }

  // ─── frequency gates ────────────────────────────────────────────────────
  function isDismissedRecently(){
    var raw = lsGet('dismissed_at');
    if (!raw) return false;
    var days = (typeof display.dismissCooldownDays === 'number' && display.dismissCooldownDays >= 0)
      ? display.dismissCooldownDays : 7;
    var ms = days * 24 * 60 * 60 * 1000;
    var when = parseInt(raw, 10);
    return Number.isFinite(when) && (Date.now() - when) < ms;
  }
  function isSubscribedRecently(){
    var raw = lsGet('subscribed_at');
    if (!raw) return false;
    var days = (typeof display.suppressForSubscribedDays === 'number' && display.suppressForSubscribedDays >= 0)
      ? display.suppressForSubscribedDays : 365;
    var ms = days * 24 * 60 * 60 * 1000;
    var when = parseInt(raw, 10);
    return Number.isFinite(when) && (Date.now() - when) < ms;
  }
  function incrementAndReadPageviews(){
    var raw = ssGet('views');
    var n = (parseInt(raw, 10) || 0) + 1;
    ssSet('views', String(n));
    return n;
  }
  function pageviewsThresholdMet(){
    var need = display.triggerPagesViewed;
    if (!need || need <= 1) return true;
    var n = parseInt(ssGet('views'), 10) || 0;
    return n >= need;
  }

  // ─── path filter check ─────────────────────────────────────────────────
  function pathAllowed(){
    var p = window.location && window.location.pathname || '/';
    var hide = display.hideOnPaths || [];
    if (pathMatchesAny(hide, p)) return false;
    var show = display.showOnPaths || [];
    if (Array.isArray(show) && show.length > 0) {
      return pathMatchesAny(show, p);
    }
    return true;
  }

  // ─── element factory ────────────────────────────────────────────────────
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function(k){
      if (k === 'style' && typeof attrs[k] === 'object') {
        Object.assign(node.style, attrs[k]);
      } else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      } else if (k === 'className') {
        node.className = attrs[k];
      } else if (attrs[k] != null) {
        node.setAttribute(k, attrs[k]);
      }
    });
    if (children) (Array.isArray(children) ? children : [children]).forEach(function(c){
      if (c == null) return;
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    });
    return node;
  }

  // ─── Turnstile lazy loader ──────────────────────────────────────────────
  var turnstileLoaded = false;
  function ensureTurnstileScript() {
    if (turnstileLoaded) return;
    turnstileLoaded = true;
    if (document.querySelector('script[data-pib-turnstile]')) return;
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    s.async = true;
    s.defer = true;
    s.setAttribute('data-pib-turnstile', '1');
    document.head.appendChild(s);
  }

  // ─── input builder ──────────────────────────────────────────────────────
  var inputStyle = {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid rgba(0,0,0,0.18)',
    borderRadius: '8px',
    fontSize: '14px',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    background: '#fff',
    color: '#111'
  };
  function buildInput(field) {
    var name = field.key;
    var placeholder = field.placeholder || field.label;
    if (field.type === 'textarea') {
      return el('textarea', {
        name: name, placeholder: placeholder, required: field.required ? 'required' : null,
        rows: '4', className: 'pib-lc-input', style: inputStyle
      });
    }
    if (field.type === 'select') {
      var sel = el('select', { name: name, required: field.required ? 'required' : null, className: 'pib-lc-input', style: inputStyle });
      sel.appendChild(el('option', { value: '' }, placeholder));
      (field.options || []).forEach(function(opt){
        sel.appendChild(el('option', { value: opt }, opt));
      });
      return sel;
    }
    return el('input', {
      type: field.type === 'email' ? 'email' : field.type === 'tel' ? 'tel' : 'text',
      name: name, placeholder: placeholder, required: field.required ? 'required' : null,
      className: 'pib-lc-input',
      style: inputStyle
    });
  }

  // ─── shared form renderers ──────────────────────────────────────────────
  function buildContainerStyles(extra) {
    var base = {
      background: theme.backgroundColor || '#ffffff',
      color: theme.textColor || '#111827',
      padding: '24px',
      borderRadius: (theme.borderRadius || 12) + 'px',
      fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Arial, sans-serif',
      fontSize: '15px',
      lineHeight: '1.5',
      boxSizing: 'border-box',
      position: 'relative'
    };
    if (extra) Object.keys(extra).forEach(function(k){ base[k] = extra[k]; });
    return base;
  }

  function fieldsByKeys(keys){
    var all = CONFIG.fields || [];
    var byKey = {};
    all.forEach(function(f){ if (f && f.key) byKey[f.key] = f; });
    var out = [];
    (keys || []).forEach(function(k){
      if (k === 'email') return; // email is rendered as its own input
      if (byKey[k]) out.push(byKey[k]);
    });
    return out;
  }

  // Render the actual signup form into a container. Returns nothing — uses
  // callbacks to signal success/dismiss to the outer renderer.
  function renderFormInto(container, opts) {
    opts = opts || {};
    container.innerHTML = '';

    var step = (opts.step != null) ? opts.step : 0;
    var steps = Array.isArray(display.steps) ? display.steps : null;
    var isMultiStep = MODE === 'multi-step' && steps && steps.length > 0;
    var currentStepCfg = isMultiStep ? steps[step] : null;
    var isLastStep = isMultiStep ? (step >= steps.length - 1) : true;

    var headingText = (currentStepCfg && currentStepCfg.headingText)
      || theme.headingText || 'Join our newsletter';
    var subheadingText = (currentStepCfg && currentStepCfg.subheadingText)
      || theme.subheadingText || '';
    var buttonText = (currentStepCfg && currentStepCfg.buttonText)
      || theme.buttonText || 'Subscribe';

    var heading = el('h3', {
      className: 'pib-lc-heading',
      style: { margin: '0 0 6px', fontSize: '20px', fontWeight: '600', color: theme.textColor || '#111827' }
    }, headingText);
    container.appendChild(heading);

    if (subheadingText) {
      container.appendChild(el('p', {
        className: 'pib-lc-subheading',
        style: { margin: '0 0 18px', color: theme.textColor || '#475569', opacity: '0.8', fontSize: '14px' }
      }, subheadingText));
    }

    var form = el('form', {
      className: 'pib-lc-form',
      style: { display: 'flex', flexDirection: 'column', gap: '10px' },
      novalidate: 'true'
    });
    var status = el('div', { className: 'pib-lc-status', style: { fontSize: '13px', minHeight: '18px' }}, '');

    // Honeypot — always present, only enforced server-side
    var honeypot = el('input', {
      type: 'text', name: '_hp', tabindex: '-1', autocomplete: 'off',
      'aria-hidden': 'true',
      style: { position: 'absolute', left: '-9999px', width: '1px', height: '1px', opacity: '0' }
    });
    form.appendChild(honeypot);

    // Email is always present on step 0 (first step). Subsequent multi-step
    // screens hide it but include it as readonly so the user knows what they
    // signed up with.
    var emailInput;
    if (step === 0) {
      var emailLabel = el('label', {
        className: 'pib-lc-label',
        style: { fontSize: '13px', fontWeight: '500' }
      }, 'Email');
      emailInput = el('input', {
        type: 'email', name: 'email', placeholder: 'you@example.com', required: 'required',
        className: 'pib-lc-input',
        style: inputStyle,
        value: opts.email || ''
      });
      form.appendChild(el('div', {
        style: { display: 'flex', flexDirection: 'column', gap: '4px' }
      }, [emailLabel, emailInput]));
    }

    // Which fields show on this step
    var fieldsToShow;
    if (isMultiStep && currentStepCfg) {
      fieldsToShow = fieldsByKeys(currentStepCfg.fields);
    } else {
      // Single-screen: every non-email field on the source
      fieldsToShow = (CONFIG.fields || []).filter(function(f){ return f && f.key && f.key !== 'email'; });
    }
    fieldsToShow.forEach(function(field){
      var lbl = el('label', {
        className: 'pib-lc-label',
        style: { fontSize: '13px', fontWeight: '500' }
      }, field.label + (field.required ? ' *' : ''));
      var control = buildInput(field);
      var wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' }}, [lbl, control]);
      form.appendChild(wrap);
    });

    // Turnstile — only on the final step (or single-screen)
    var turnstileContainer = null;
    if (isLastStep && CONFIG.turnstileEnabled && CONFIG.turnstileSiteKey) {
      turnstileContainer = el('div', {
        className: 'cf-turnstile',
        'data-sitekey': CONFIG.turnstileSiteKey,
        style: { marginTop: '4px' }
      });
      form.appendChild(turnstileContainer);
      if (emailInput) {
        emailInput.addEventListener('focus', ensureTurnstileScript, { once: true });
        emailInput.addEventListener('input', ensureTurnstileScript, { once: true });
      } else {
        // No email field on this step — load turnstile right away
        ensureTurnstileScript();
      }
    }

    var submitBtn = el('button', {
      type: 'submit',
      className: 'pib-lc-submit',
      style: {
        marginTop: '6px',
        padding: '12px 16px',
        background: theme.primaryColor || '#0f766e',
        color: '#fff',
        border: 'none',
        borderRadius: '8px',
        fontSize: '15px',
        fontWeight: '600',
        cursor: 'pointer',
        fontFamily: 'inherit'
      }
    }, buttonText);
    form.appendChild(submitBtn);
    form.appendChild(status);

    function setSubmitting(on) {
      submitBtn.disabled = on;
      submitBtn.style.opacity = on ? '0.7' : '1';
      submitBtn.textContent = on ? 'Submitting…' : buttonText;
    }

    function showSuccess(message, requiresConfirmation, redirect) {
      lsSet('subscribed_at', String(Date.now()));
      container.innerHTML = '';
      container.appendChild(el('div', {
        className: 'pib-lc-done',
        style: { textAlign: 'center', padding: '20px 0' }
      }, [
        el('h3', { style: { margin: '0 0 8px', fontSize: '20px', color: theme.textColor || '#111827' }},
          requiresConfirmation ? 'Check your inbox' : 'Thanks!'),
        el('p', { style: { color: theme.textColor || '#475569', opacity: '0.8' }},
          message || CONFIG.successMessage || 'You are subscribed.')
      ]));
      if (opts.onSuccess) opts.onSuccess();
      if (redirect) {
        setTimeout(function(){ window.location.href = redirect; }, 1200);
      }
    }

    form.addEventListener('submit', function(ev) {
      ev.preventDefault();
      status.textContent = '';
      status.style.color = '';
      var formData = new FormData(form);

      // Gather step data (any non-honeypot non-empty field)
      var stepData = {};
      fieldsToShow.forEach(function(field){
        var v = formData.get(field.key);
        if (typeof v === 'string' && v.trim()) stepData[field.key] = v.trim();
      });
      stepData._hp = (formData.get('_hp') || '').toString();

      // Required-field check (per step)
      var missing = null;
      for (var i = 0; i < fieldsToShow.length; i++) {
        var f = fieldsToShow[i];
        if (f.required && !stepData[f.key]) { missing = f; break; }
      }
      if (missing) {
        status.style.color = '#b91c1c';
        status.textContent = missing.label + ' is required.';
        return;
      }

      // Email validation on step 0
      var email = opts.email || '';
      if (step === 0) {
        var rawEmail = (formData.get('email') || '').toString().trim();
        if (!rawEmail) {
          status.style.color = '#b91c1c';
          status.textContent = 'Email is required.';
          return;
        }
        email = rawEmail;
      }

      // Turnstile (only on last step)
      var turnstileToken = '';
      if (isLastStep && CONFIG.turnstileEnabled && CONFIG.turnstileSiteKey) {
        turnstileToken = (formData.get('cf-turnstile-response') || '').toString();
        if (!turnstileToken) {
          status.style.color = '#b91c1c';
          status.textContent = 'Please complete the CAPTCHA challenge.';
          return;
        }
      }

      setSubmitting(true);

      // ── Multi-step: route to progressive endpoint while there are more steps
      if (isMultiStep && !isLastStep) {
        var progressivePayload = {
          email: email,
          step: step,
          data: stepData,
          referer: location.href
        };
        if (opts.submissionId) progressivePayload.submissionId = opts.submissionId;

        fetch(PROGRESSIVE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(progressivePayload)
        })
        .then(function(r){ return r.json().then(function(b){ return { ok: r.ok, body: b }; }); })
        .then(function(res){
          setSubmitting(false);
          if (!res.ok || !res.body || res.body.ok === false) {
            status.style.color = '#b91c1c';
            status.textContent = (res.body && res.body.error) || 'Submission failed.';
            return;
          }
          // Advance to next step, carry submissionId + email forward
          renderFormInto(container, {
            step: (typeof res.body.nextStep === 'number') ? res.body.nextStep : (step + 1),
            email: email,
            submissionId: res.body.submissionId,
            onSuccess: opts.onSuccess
          });
        })
        .catch(function(err){
          setSubmitting(false);
          status.style.color = '#b91c1c';
          status.textContent = 'Network error — please try again.';
          try { console.error('[partnersinbiz] progressive error', err); } catch(e){}
        });
        return;
      }

      // ── Final step (single-step OR last multi-step screen)
      if (isMultiStep && isLastStep && opts.submissionId) {
        // Use the progressive endpoint for the final step — it will run
        // auto-enroll + DOI internally and return the same shape as /submit.
        var finalPayload = {
          email: email,
          step: step,
          data: stepData,
          submissionId: opts.submissionId,
          referer: location.href
        };
        if (turnstileToken) finalPayload.turnstileToken = turnstileToken;

        fetch(PROGRESSIVE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(finalPayload)
        })
        .then(function(r){ return r.json().then(function(b){ return { ok: r.ok, body: b }; }); })
        .then(function(res){
          setSubmitting(false);
          if (!res.ok || !res.body || res.body.ok === false) {
            status.style.color = '#b91c1c';
            status.textContent = (res.body && res.body.error) || 'Submission failed.';
            return;
          }
          showSuccess(
            res.body.message || CONFIG.successMessage,
            !!res.body.requiresConfirmation,
            res.body.redirect || CONFIG.successRedirectUrl
          );
        })
        .catch(function(err){
          setSubmitting(false);
          status.style.color = '#b91c1c';
          status.textContent = 'Network error — please try again.';
          try { console.error('[partnersinbiz] progressive final error', err); } catch(e){}
        });
        return;
      }

      // ── Single-step submit (inline / popup / slide-in / exit-intent)
      var payload = { email: email, data: stepData, referer: location.href };
      if (turnstileToken) payload.turnstileToken = turnstileToken;

      fetch(SUBMIT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      .then(function(r){ return r.json().then(function(b){ return { ok: r.ok, body: b }; }); })
      .then(function(res){
        setSubmitting(false);
        if (!res.ok) {
          status.style.color = '#b91c1c';
          status.textContent = (res.body && res.body.error) || 'Submission failed. Please try again.';
          return;
        }
        showSuccess(
          res.body.message || CONFIG.successMessage,
          !!res.body.requiresConfirmation,
          res.body.redirect || CONFIG.successRedirectUrl
        );
      })
      .catch(function(err){
        setSubmitting(false);
        status.style.color = '#b91c1c';
        status.textContent = 'Network error — please try again.';
        try { console.error('[partnersinbiz] submit error', err); } catch(e){}
      });
    });

    container.appendChild(form);
  }

  // ─── inline mount (legacy) ──────────────────────────────────────────────
  function renderInline(host) {
    host.innerHTML = '';
    var container = el('div', {
      className: 'pib-lc-inline-container',
      style: buildContainerStyles({
        maxWidth: '460px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.06)'
      })
    });
    renderFormInto(container, {});
    host.appendChild(container);
  }

  function mountInline() {
    var targetSel = currentScript && currentScript.getAttribute('data-target');
    if (targetSel) {
      var nodes = document.querySelectorAll(targetSel);
      if (nodes.length) {
        Array.prototype.forEach.call(nodes, function(n){ renderInline(n); });
        return;
      }
    }
    var host = document.createElement('div');
    host.setAttribute('data-pib-lead-capture', CONFIG.id);
    if (currentScript && currentScript.parentNode) {
      currentScript.parentNode.insertBefore(host, currentScript.nextSibling);
    } else {
      document.body.appendChild(host);
    }
    renderInline(host);
  }

  // ─── modal / popup ──────────────────────────────────────────────────────
  function buildModalRoot() {
    var backdrop = el('div', {
      className: 'pib-lc-backdrop',
      style: {
        position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '12px', zIndex: String(Z),
        overflowX: 'hidden', overflowY: 'auto',
        animation: 'pibLcFadeIn 200ms ease-out both'
      }
    });
    var card = el('div', {
      className: 'pib-lc-card',
      style: buildContainerStyles({
        width: '100%',
        maxWidth: 'min(460px, calc(100vw - 24px))',
        maxHeight: 'calc(100dvh - 24px)',
        overflowY: 'auto',
        overflowX: 'hidden',
        boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
        animation: 'pibLcPop 240ms cubic-bezier(.2,.9,.3,1.2) both'
      })
    });
    var closeBtn = el('button', {
      type: 'button',
      'aria-label': 'Close',
      className: 'pib-lc-close',
      style: {
        position: 'absolute', top: '8px', right: '10px',
        background: 'transparent', border: 'none', color: theme.textColor || '#111827',
        fontSize: '22px', lineHeight: '1', cursor: 'pointer', padding: '6px 10px', opacity: '0.7'
      }
    }, '\\u00d7');
    card.appendChild(closeBtn);
    backdrop.appendChild(card);
    // Click backdrop to dismiss (not card)
    backdrop.addEventListener('click', function(ev){
      if (ev.target === backdrop) dismiss(backdrop);
    });
    closeBtn.addEventListener('click', function(){ dismiss(backdrop); });
    // Esc to close
    function onKey(e){
      if (e.key === 'Escape' || e.keyCode === 27) {
        dismiss(backdrop);
        document.removeEventListener('keydown', onKey);
      }
    }
    document.addEventListener('keydown', onKey);
    return { root: backdrop, content: card };
  }

  function dismiss(node) {
    if (dismissed) return;
    dismissed = true;
    lsSet('dismissed_at', String(Date.now()));
    if (node && node.parentNode) node.parentNode.removeChild(node);
  }

  function renderPopup() {
    if (shown) return; shown = true;
    var parts = buildModalRoot();
    renderFormInto(parts.content, { onSuccess: function(){
      // Auto-close after success animation
      setTimeout(function(){
        if (parts.root && parts.root.parentNode) parts.root.parentNode.removeChild(parts.root);
      }, 3000);
    }});
    document.body.appendChild(parts.root);
  }

  // ─── slide-in toast ─────────────────────────────────────────────────────
  function positionStyles(pos){
    pos = pos || 'bottom-right';
    var out = { position: 'fixed', zIndex: String(Z), maxWidth: 'calc(100vw - 24px)' };
    if (pos === 'bottom-right') { out.bottom = '12px'; out.right = '12px'; }
    else if (pos === 'bottom-left') { out.bottom = '12px'; out.left = '12px'; }
    else if (pos === 'top-right') { out.top = '12px'; out.right = '12px'; }
    else if (pos === 'top-left') { out.top = '12px'; out.left = '12px'; }
    else if (pos === 'center') {
      out.top = '50%'; out.left = '50%';
      out.transform = 'translate(-50%, -50%)';
    }
    return out;
  }

  function renderSlideIn() {
    if (shown) return; shown = true;
    var pos = display.position || 'bottom-right';
    var fromBottom = pos.indexOf('bottom') === 0;
    var card = el('div', {
      className: 'pib-lc-slide',
      style: Object.assign(
        buildContainerStyles({
          width: 'min(320px, calc(100vw - 24px))',
          maxHeight: 'calc(100dvh - 24px)',
          overflowY: 'auto',
          overflowX: 'hidden',
          boxShadow: '0 14px 36px rgba(0,0,0,0.22)',
          padding: '20px',
          transition: 'transform 320ms cubic-bezier(.2,.9,.3,1.05), opacity 240ms ease-out',
          transform: fromBottom ? 'translateY(140%)' : 'translateY(-140%)',
          opacity: '0'
        }),
        positionStyles(pos)
      )
    });
    var closeBtn = el('button', {
      type: 'button',
      'aria-label': 'Close',
      className: 'pib-lc-close',
      style: {
        position: 'absolute', top: '6px', right: '8px',
        background: 'transparent', border: 'none', color: theme.textColor || '#111827',
        fontSize: '20px', lineHeight: '1', cursor: 'pointer', padding: '4px 8px', opacity: '0.7'
      }
    }, '\\u00d7');
    card.appendChild(closeBtn);
    closeBtn.addEventListener('click', function(){ dismiss(card); });

    renderFormInto(card, { onSuccess: function(){
      setTimeout(function(){
        if (card && card.parentNode) card.parentNode.removeChild(card);
      }, 3500);
    }});

    document.body.appendChild(card);
    // Trigger entrance animation
    requestAnimationFrame(function(){
      card.style.transform = 'translateY(0)';
      card.style.opacity = '1';
    });
  }

  // ─── exit-intent ────────────────────────────────────────────────────────
  function bindExitIntent(handler) {
    var isMobile = window.innerWidth <= 768;
    if (!isMobile) {
      var fn = function(ev){
        // Only when the mouse leaves the top of the viewport
        if (ev.clientY <= 0) {
          document.removeEventListener('mouseleave', fn);
          document.removeEventListener('mouseout', mouseOut);
          handler();
        }
      };
      var mouseOut = function(ev){
        // Some browsers fire mouseout instead of mouseleave on doc
        if (ev.relatedTarget == null && (ev.clientY == null || ev.clientY <= 0)) {
          document.removeEventListener('mouseleave', fn);
          document.removeEventListener('mouseout', mouseOut);
          handler();
        }
      };
      document.addEventListener('mouseleave', fn);
      document.addEventListener('mouseout', mouseOut);
    } else {
      // Mobile back-button heuristic: push a history entry, fire on popstate
      try {
        history.pushState({ pibLc: CONFIG.id }, '');
      } catch(e){}
      var popHandler = function(){
        window.removeEventListener('popstate', popHandler);
        handler();
      };
      window.addEventListener('popstate', popHandler);
    }
  }

  // ─── trigger orchestration ──────────────────────────────────────────────
  function injectStyles(){
    if (document.getElementById('pib-lc-styles')) return;
    var s = document.createElement('style');
    s.id = 'pib-lc-styles';
    s.textContent = [
      '@keyframes pibLcFadeIn { from { opacity: 0; } to { opacity: 1; } }',
      '@keyframes pibLcPop { 0% { opacity: 0; transform: scale(.94); } 100% { opacity: 1; transform: scale(1); } }',
      '.pib-lc-input:focus { outline: 2px solid ' + (theme.primaryColor || '#0f766e') + '; outline-offset: 1px; }',
      '.pib-lc-submit:hover { filter: brightness(0.95); }',
      '.pib-lc-close:hover { opacity: 1 !important; }'
    ].join('\\n');
    document.head.appendChild(s);
  }

  function showOverlay() {
    // Decide what to render based on MODE
    if (MODE === 'slide-in') return renderSlideIn();
    return renderPopup();
  }

  function scheduleTrigger() {
    var delaySec = (typeof display.triggerDelaySeconds === 'number' && display.triggerDelaySeconds >= 0)
      ? display.triggerDelaySeconds
      : (MODE === 'slide-in' ? 10 : 5);
    var scrollPct = (typeof display.triggerScrollPercent === 'number' && display.triggerScrollPercent > 0)
      ? display.triggerScrollPercent : 0;
    var allowExitIntent = MODE === 'exit-intent' ||
      (display.triggerOnExitIntent === true);

    var fired = false;
    function fire(){
      if (fired || shown || dismissed) return;
      fired = true;
      showOverlay();
    }

    // Delay trigger (skip for pure exit-intent)
    if (MODE !== 'exit-intent') {
      setTimeout(fire, Math.max(0, delaySec) * 1000);
    }

    // Scroll-depth trigger
    if (scrollPct > 0) {
      var onScroll = function(){
        var doc = document.documentElement;
        var body = document.body;
        var scrollTop = doc.scrollTop || body.scrollTop;
        var height = (doc.scrollHeight || body.scrollHeight) - doc.clientHeight;
        if (height <= 0) return;
        var pct = (scrollTop / height) * 100;
        if (pct >= scrollPct) {
          window.removeEventListener('scroll', onScroll);
          fire();
        }
      };
      window.addEventListener('scroll', onScroll, { passive: true });
    }

    // Exit-intent trigger
    if (allowExitIntent) {
      bindExitIntent(fire);
    }
  }

  function shouldShow() {
    // Multi-step rendered as inline if MODE is multi-step but no
    // overlay-style positioning desired. Default for multi-step
    // (when this script is used standalone) is popup chrome.
    if (MODE === 'inline') return true;
    if (!pathAllowed()) return false;
    if (isSubscribedRecently()) return false;
    if (isDismissedRecently()) return false;
    incrementAndReadPageviews();
    if (!pageviewsThresholdMet()) return false;
    return true;
  }

  function boot(){
    injectStyles();
    if (MODE === 'inline') {
      mountInline();
      return;
    }
    if (MODE === 'multi-step') {
      // Multi-step has no built-in overlay choice; render inline by default.
      // If the operator wants multi-step in a modal, they should set up an
      // explicit popup mode and use the steps config (the form respects
      // steps in either mode).
      if (!shouldShow()) return;
      // Increment views was called above; render inline
      mountInline();
      return;
    }
    // popup / slide-in / exit-intent — all use overlay chrome
    if (!shouldShow()) return;
    scheduleTrigger();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
`
  return jsResponse(js)
}
