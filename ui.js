'use strict';
// Shared navigation and select controls for evaluator and administrator screens.
(() => {
  const drawer = document.getElementById('sidebar');
  const toggle = document.getElementById('menuToggle');
  const overlay = document.getElementById('navOverlay');
  const closeButton = document.getElementById('closeMobileMenu');
  const main = document.querySelector('.app-main');
  const compact = matchMedia('(max-width: 1100px)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let menuOpen = false, scrollPosition = 0, overlayTimer;
  let savedBodyStyle = null;
  const focusables = () => [...drawer.querySelectorAll('a[href], button:not(:disabled), [tabindex="0"]')].filter(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
  function setMenu(open, returnFocus = true) {
    open = Boolean(open && compact.matches && !document.getElementById('appShell')?.hidden);
    if (open === menuOpen) return;
    menuOpen = open; clearTimeout(overlayTimer);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'ปิดเมนู' : 'เปิดเมนู');
    drawer.classList.toggle('mobile-open', open);
    document.body.classList.toggle('menu-open', open);
    if (open) {
      scrollPosition = window.scrollY;
      savedBodyStyle = {position: document.body.style.position, top: document.body.style.top, width: document.body.style.width, overflow: document.body.style.overflow};
      Object.assign(document.body.style, {position:'fixed', top:-scrollPosition+'px', width:'100%', overflow:'hidden'});
      drawer.setAttribute('role','dialog'); drawer.setAttribute('aria-modal','true'); drawer.setAttribute('aria-label','เมนูหลัก');
      main.inert = true;
      overlay.hidden = false; overlay.inert = false;
      requestAnimationFrame(() => { if (menuOpen) { overlay.classList.add('is-visible'); (closeButton || focusables()[0])?.focus({preventScroll:true}); } });
    } else {
      main.inert = false;
      drawer.removeAttribute('role'); drawer.removeAttribute('aria-modal'); drawer.removeAttribute('aria-label');
      overlay.classList.remove('is-visible'); overlay.inert = true;
      overlayTimer = setTimeout(() => { if (!menuOpen) overlay.hidden = true; }, reduced.matches ? 0 : 220);
      if (savedBodyStyle) { Object.assign(document.body.style, savedBodyStyle); savedBodyStyle = null; window.scrollTo({top:scrollPosition,behavior:'instant'}); }
      if (returnFocus && compact.matches) toggle.focus({preventScroll:true});
    }
  }
  toggle?.addEventListener('click', () => setMenu(!menuOpen));
  overlay?.addEventListener('click', () => setMenu(false));
  closeButton?.addEventListener('click', () => setMenu(false));
  compact.addEventListener('change', () => { if (!compact.matches) setMenu(false,false); closeSelect(); });
  document.addEventListener('keydown', event => {
    if (!menuOpen) return;
    if (event.key === 'Escape') { event.preventDefault(); setMenu(false); }
    if (event.key === 'Tab') {
      const targets = focusables(), first = targets[0], last = targets.at(-1);
      if (!first) return;
      if (event.shiftKey && (document.activeElement === first || !drawer.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !drawer.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
  });

  const selects = [];
  let opened = null, typeBuffer = '', typeTimer;
  function positionPanel(control) {
    if (control !== opened) return;
    const rect = control.button.getBoundingClientRect();
    const viewportHeight = window.visualViewport?.height || innerHeight;
    const below = viewportHeight - rect.bottom - 12, above = rect.top - 12;
    const upward = below < 180 && above > below;
    control.panel.style.width = Math.min(Math.max(rect.width,180),innerWidth-24)+'px';
    control.panel.style.left = Math.max(12,Math.min(rect.left, innerWidth-control.panel.offsetWidth-12))+'px';
    control.panel.style.maxHeight = Math.max(80,Math.min(300,upward ? above : below))+'px';
    const height = Math.min(control.panel.scrollHeight,parseFloat(control.panel.style.maxHeight));
    control.panel.style.top = (upward ? Math.max(8,rect.top-height-6) : rect.bottom+6)+'px';
    control.panel.classList.toggle('opens-up',upward);
  }
  function markActive(control, index) {
    const options = [...control.native.options];
    if (!options[index] || options[index].disabled) return;
    control.active = index;
    control.panel.querySelectorAll('[role="option"]').forEach((option,i) => option.classList.toggle('is-active', i === index));
    control.button.setAttribute('aria-activedescendant',control.native.id+'-option-'+index);
    control.panel.children[index]?.scrollIntoView({block:'nearest'});
  }
  function closeSelect() {
    if (!opened) return;
    const control = opened; opened = null;
    control.button.setAttribute('aria-expanded','false'); control.button.removeAttribute('aria-activedescendant');
    control.wrapper.classList.remove('select-open'); control.panel.classList.remove('is-open'); control.panel.inert = true;
    // Each closing panel owns its timer so opening a second select cannot leave it visible.
    setTimeout(() => { if (opened !== control) control.panel.hidden = true; }, reduced.matches ? 0 : 140);
  }
  function openSelect(control) {
    if (control.native.disabled) return;
    if (opened === control) { closeSelect(); return; }
    closeSelect(); sync(control); opened = control;
    control.panel.hidden = false; control.panel.inert = false;
    control.wrapper.classList.add('select-open'); control.button.setAttribute('aria-expanded','true');
    positionPanel(control);
    const selected = control.native.selectedIndex;
    const first = [...control.native.options].findIndex(option => !option.disabled);
    markActive(control, selected >= 0 && !control.native.options[selected].disabled ? selected : first);
    requestAnimationFrame(() => { if (opened === control) control.panel.classList.add('is-open'); });
  }
  function choose(control,index) {
    const option = control.native.options[index];
    if (!option || option.disabled) return;
    control.native.selectedIndex = index;
    control.native.dispatchEvent(new Event('input',{bubbles:true}));
    control.native.dispatchEvent(new Event('change',{bubbles:true}));
    closeSelect(); syncAll(); control.button.focus({preventScroll:true});
  }
  function sync(control) {
    const native = control.native, selected = native.options[native.selectedIndex];
    control.label.textContent = selected?.textContent || 'เลือกรายการ';
    control.button.disabled = native.disabled;
    control.panel.setAttribute('aria-label', control.button.getAttribute('aria-label') || 'เลือกรายการ');
    const signature = JSON.stringify([...native.options].map(option => [option.textContent,option.disabled,option.value]));
    if (signature !== control.signature) {
      control.signature = signature; control.panel.replaceChildren();
      [...native.options].forEach((option,index) => {
        const node = document.createElement('div'); node.id = native.id+'-option-'+index; node.setAttribute('role','option');
        node.setAttribute('aria-disabled',String(option.disabled)); node.className = 'select-option';
        const text = document.createElement('span'); text.textContent = option.textContent;
        const check = document.createElement('span'); check.textContent = '✓'; check.className = 'option-check'; check.setAttribute('aria-hidden','true');
        node.append(text,check);
        node.addEventListener('pointerdown', event => event.preventDefault());
        node.addEventListener('click', () => choose(control,index));
        node.addEventListener('pointermove', () => { if (opened === control && !option.disabled) { control.active=index; control.panel.querySelectorAll('[role="option"]').forEach((item,i)=>item.classList.toggle('is-active',i===index)); control.button.setAttribute('aria-activedescendant',node.id); } });
        control.panel.append(node);
      });
    }
    [...control.panel.children].forEach((option,index) => option.setAttribute('aria-selected',String(index === native.selectedIndex)));
    if (opened === control) positionPanel(control);
  }
  function syncAll() { selects.forEach(sync); }
  document.querySelectorAll('select').forEach(native => {
    if (native.multiple || native.size > 1) return;
    const wrapper=document.createElement('div');wrapper.className='custom-select';
    const button=document.createElement('button');button.type='button';button.className='select-trigger';button.id=native.id+'-trigger';
    button.setAttribute('role','combobox');button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');
    const label=document.createElement('span');label.className='select-label-text';
    const arrow=document.createElement('span');arrow.className='select-chevron';arrow.setAttribute('aria-hidden','true');
    button.append(label,arrow);
    const panel=document.createElement('div');panel.id=native.id+'-listbox';panel.className='select-panel';panel.setAttribute('role','listbox');panel.hidden=true;panel.inert=true;
    button.setAttribute('aria-controls',panel.id);
    const originalLabel = [...document.querySelectorAll('label[for]')].find(item=>item.htmlFor===native.id);
    button.setAttribute('aria-label',native.getAttribute('aria-label') || originalLabel?.textContent || 'เลือกรายการ');
    if (originalLabel) originalLabel.htmlFor=button.id;
    native.before(wrapper);wrapper.append(native,button);native.hidden=true;native.tabIndex=-1;document.body.append(panel);
    const control={native,wrapper,button,label,panel,active:0,signature:null};selects.push(control);
    button.addEventListener('click',()=>openSelect(control));
    button.addEventListener('keydown',event=>{
      const key=event.key, enabled=[...native.options].map((option,index)=>({option,index})).filter(item=>!item.option.disabled).map(item=>item.index);
      if (['ArrowDown','ArrowUp','Home','End'].includes(key)) {
        event.preventDefault();if(opened!==control)openSelect(control);
        const position=enabled.indexOf(control.active);
        const index=key==='Home'?enabled[0]:key==='End'?enabled.at(-1):enabled[Math.max(0,Math.min(enabled.length-1,position+(key==='ArrowDown'?1:-1)))];
        markActive(control,index);return;
      }
      if(key==='Escape'){if(opened===control){event.preventDefault();event.stopPropagation();closeSelect();}return;}
      if(key==='Tab'){closeSelect();return;}
      if(key==='Enter'||key===' '){event.preventDefault();if(opened===control)choose(control,control.active);else openSelect(control);return;}
      if(key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
        event.preventDefault();clearTimeout(typeTimer);typeBuffer+=key.toLocaleLowerCase();typeTimer=setTimeout(()=>{typeBuffer='';},600);
        if(opened!==control)openSelect(control);
        const index=enabled.find(index=>native.options[index].textContent.trim().toLocaleLowerCase().startsWith(typeBuffer));
        if(index!==undefined)markActive(control,index);
      }
    });
    native.addEventListener('change',()=>sync(control));
    new MutationObserver(()=>sync(control)).observe(native,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','selected','label']});
    sync(control);
  });
  document.addEventListener('pointerdown',event=>{if(opened&&!opened.wrapper.contains(event.target)&&!opened.panel.contains(event.target))closeSelect();});
  document.addEventListener('click',()=>queueMicrotask(syncAll));
  document.addEventListener('submit',()=>queueMicrotask(syncAll));
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&opened){event.preventDefault();closeSelect();}});
  window.addEventListener('resize',()=>{if(opened)positionPanel(opened);});
  window.visualViewport?.addEventListener('resize',()=>{if(opened)positionPanel(opened);});
  document.addEventListener('scroll',event=>{if(opened&&!opened.panel.contains(event.target))positionPanel(opened);},true);
  window.SPUI={setMenu,closeSelect,refreshSelects:syncAll};
})();
