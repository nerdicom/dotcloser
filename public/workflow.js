/* An illustrative, self-contained walkthrough. No research or email requests. */
(() => {
  const svg = (name) => {
    const paths = {
      globe: 'M2 12h20 M12 2c6 6 6 14 0 20-6-6-6-14 0-20 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
      check: 'm5 12 4 4L19 6',
      mail: 'M3 5h18v14H3Z M3 5l9 8 9-8',
      arrow: 'M4 12h16 M14 6l6 6-6 6',
      person: 'M20 21v-2a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v2 M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
      send: 'm22 2-7 20-4-9-9-4Z M22 2 11 13',
      edit: 'm15 3 6 6-12 12H3v-6Z M12 6l6 6',
    };
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+paths[name]+'"/></svg>';
  };
  const steps = [
    {label:'Your domains',icon:'globe',title:'Start with the names you own.',text:'Paste one domain or a list of domains you want to sell. Add an asking price to give every offer a clear starting point.',note:'One domain or a whole portfolio.',visual:'<div class="flow-window-label">YOUR DOMAIN PORTFOLIO</div><div class="flow-domain-row"><span class="flow-domain-icon">S</span><strong>sunnyharbor.com</strong><span class="flow-price">$8,500</span></div><div class="flow-domain-row"><span class="flow-domain-icon peach">B</span><strong>buildnest.com</strong><span class="flow-price">$5,900</span></div><div class="flow-domain-row"><span class="flow-domain-icon mint">U</span><strong>urbancrate.com</strong><span class="flow-price">$4,200</span></div><div class="flow-mini-footer">'+svg('check')+'Ready to discover potential buyers</div>'},
    {label:'Matching names',icon:'globe',title:'Discover who uses a similar name.',text:'Search other registered extensions and related domain names. Build a list of businesses that could be a fit for your domain.',note:'Domain matches become potential buyers.',visual:'<div class="flow-window-label">DOMAIN DISCOVERY</div><div class="flow-network"><div class="flow-network-source">'+svg('globe')+'<strong>sunnyharbor<span>.com</span></strong><small>Your domain for sale</small></div><div class="flow-branches" aria-hidden="true"><i></i><i></i><i></i></div><div class="flow-matches"><div>sunnyharbor<strong>.net</strong></div><div>sunnyharbor<strong>.io</strong></div><div>sunnyharbor<strong>.co</strong></div></div></div><div class="flow-mini-footer">'+svg('globe')+'Other extensions. New opportunities.</div>'},
    {label:'Contact details',icon:'person',title:'Find a way to start the conversation.',text:'Locate published business email addresses using contact lookup. Review the source and the business to make sure your offer is relevant.',note:'Sourced contacts, ready for your review.',visual:'<div class="flow-window-label">BUSINESS CONTACT LOOKUP</div><div class="flow-contact"><div class="flow-contact-avatar">SH</div><div><strong>Sunny Harbor</strong><small>Example business</small></div><span class="flow-found">Contact found</span></div><div class="flow-contact-detail">'+svg('mail')+'<div><small>Published business email</small><strong>hello@sunnyharbor.example</strong></div></div><div class="flow-contact-detail">'+svg('globe')+'<div><small>Contact source</small><strong>Company contact page</strong></div></div><div class="flow-mini-footer">'+svg('check')+'You confirm the contact is a good fit</div>'},
    {label:'Branded drafts',icon:'edit',title:'Make every offer feel personal.',text:'Generate an editable offer for each reviewed contact. Your seller name, company, logo, and avatar give the email a familiar, professional signature.',note:'Your domain. Your offer. Your brand.',visual:'<div class="flow-email-meta"><span>To</span> hello@sunnyharbor.example</div><div class="flow-email-subject">sunnyharbor.com is available for your business</div><div class="flow-email-copy"><p>Hello Sunny Harbor team,</p><p>I own <strong>sunnyharbor.com</strong> and am offering it for sale at <strong>$8,500</strong>. It could be a memorable home for your brand.</p></div><div class="flow-signature"><span class="flow-sample-logo">N<span>.</span></span><span class="flow-small-avatar">AM</span><div><strong>Alex Morgan</strong><small>Example Domain Co.</small></div><span class="flow-signature-tag">Your branding</span></div>'},
    {label:'Review & send',icon:'send',title:'Approve the offers. Start the outreach.',text:'Review your recipients and messages, then approve your campaign. DotCloser sends through your connected Gmail or Outlook account. Replies arrive in your own inbox.',note:'You stay in control of what gets sent.',visual:'<div class="flow-window-label">YOUR OUTBOUND CAMPAIGN</div><div class="flow-approved">'+svg('check')+'Recipients and messages approved by you</div><div class="flow-delivery"><div class="flow-delivery-inbox">'+svg('mail')+'<strong>Your inbox</strong><small>Gmail or Outlook</small></div><div class="flow-flight" aria-hidden="true">'+svg('send')+'</div><div class="flow-delivery-buyer">'+svg('person')+'<strong>Potential buyers</strong><small>Personal domain offers</small></div></div><div class="flow-mini-footer">'+svg('check')+'Track sends in DotCloser. Reply from your inbox.</div>'},
  ];
  let cleanup = () => {};
  function markup() {
    return '<section class="flow-explainer" aria-labelledby="flow-title"><div class="flow-heading"><div><span class="flow-eyebrow">HOW DOTCLOSER WORKS</span><h2 id="flow-title">From domain to outbound email.</h2></div><button type="button" class="flow-play" data-flow-play aria-label="Pause walkthrough"><span class="flow-play-symbol" aria-hidden="true">Ⅱ</span><span data-flow-play-label>Pause</span></button></div><div class="flow-tabs" role="tablist" aria-label="Outreach workflow">'+steps.map((step,i)=>'<button type="button" role="tab" id="flow-tab-'+i+'" aria-controls="flow-panel" aria-selected="'+(i===0)+'" tabindex="'+(i===0?'0':'-1')+'" data-flow-step="'+i+'"><span class="flow-tab-number">'+(i+1)+'</span><span>'+step.label+'</span><span class="flow-tab-track" aria-hidden="true"><i></i></span></button>').join('')+'</div><div id="flow-panel" class="flow-panel" role="tabpanel" aria-labelledby="flow-tab-0" tabindex="0"></div><div class="flow-footnote"><span class="flow-example-dot"></span>Illustrative example · research and contact availability depend on connected providers.</div></section>';
  }
  function mount() {
    cleanup();
    const root = document.querySelector('.flow-explainer');
    if (!root) return;
    const panel = root.querySelector('#flow-panel');
    const tabs = [...root.querySelectorAll('[data-flow-step]')];
    const play = root.querySelector('[data-flow-play]');
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let current=0, paused=motion.matches, visible=false, finished=false, timer;
    function stopTimer() { clearTimeout(timer); root.classList.remove('is-playing'); }
    function schedule() {
      stopTimer();
      if (paused || !visible || document.hidden || finished) return;
      root.classList.add('is-playing');
      timer=setTimeout(()=>{
        if(current===steps.length-1){finished=true;paused=true;updatePlay();stopTimer();}
        else show(current+1);
      },6000);
    }
    function updatePlay() {
      const label=finished?'Replay':paused?'Play':'Pause';
      play.setAttribute('aria-label',label+' walkthrough');
      play.querySelector('[data-flow-play-label]').textContent=label;
      play.querySelector('.flow-play-symbol').textContent=paused?'▷':'Ⅱ';
      root.classList.toggle('flow-reduced-motion',motion.matches);
    }
    function show(index) {
      current=index;
      tabs.forEach((tab,i)=>{tab.setAttribute('aria-selected',String(i===index));tab.tabIndex=i===index?0:-1;tab.classList.toggle('is-complete',i<index);});
      const step=steps[index];
      panel.setAttribute('aria-labelledby','flow-tab-'+index);
      panel.innerHTML='<div class="flow-story"><span class="flow-stage">STEP 0'+(index+1)+' <span>/ 05</span></span><h3>'+step.title+'</h3><p>'+step.text+'</p><div class="flow-story-note">'+svg(step.icon)+step.note+'</div></div><div class="flow-stage-art flow-art-'+index+'"><div class="flow-art-top"><span></span><span></span><span></span><small>EXAMPLE WORKFLOW</small></div><div class="flow-art-content">'+step.visual+'</div></div>';
      updatePlay();schedule();
    }
    function onClick(event) {
      const tab=event.target.closest('[data-flow-step]');
      if(tab){paused=true;finished=false;show(Number(tab.dataset.flowStep));}
      else if(event.target.closest('[data-flow-play]')){
        paused=!paused;
        if(finished){finished=false;paused=false;show(0);}else{updatePlay();schedule();}
      }
    }
    function onKey(event) {
      if(!event.target.matches('[data-flow-step]')) return;
      let index=Number(event.target.dataset.flowStep);
      if(event.key==='ArrowRight')index=(index+1)%steps.length;
      else if(event.key==='ArrowLeft')index=(index+steps.length-1)%steps.length;
      else if(event.key==='Home')index=0;
      else if(event.key==='End')index=steps.length-1;
      else return;
      event.preventDefault();paused=true;finished=false;show(index);tabs[index].focus();
    }
    function onMotion(){paused=true;updatePlay();schedule();}
    const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;schedule();},{threshold:0.2});
    root.addEventListener('click',onClick);root.addEventListener('keydown',onKey);
    document.addEventListener('visibilitychange',schedule);motion.addEventListener('change',onMotion);
    observer.observe(root);show(0);
    cleanup=()=>{stopTimer();observer.disconnect();root.removeEventListener('click',onClick);root.removeEventListener('keydown',onKey);document.removeEventListener('visibilitychange',schedule);motion.removeEventListener('change',onMotion);};
  }
  window.DotCloserFlow={markup,mount,unmount:()=>cleanup()};
})();
