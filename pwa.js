(function(){
  if('serviceWorker' in navigator){addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}))}
  const standalone=matchMedia('(display-mode: fullscreen)').matches||matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  const d=document,root=d.documentElement;
  // Mantém a tela do tablet acesa enquanto a roleta está aberta
  let lock=null;
  async function wake(){try{if('wakeLock' in navigator&&d.visibilityState==='visible'&&!lock){lock=await navigator.wakeLock.request('screen');lock.addEventListener('release',()=>{lock=null})}}catch(e){}}
  d.addEventListener('visibilitychange',wake);d.addEventListener('pointerdown',wake,{once:true});wake();
  const fsEl=()=>d.fullscreenElement||d.webkitFullscreenElement;
  const canFs=!!(root.requestFullscreen||root.webkitRequestFullscreen);
  const own=d.getElementById('appBar');const bar=own||d.createElement('div');bar.className='app-bar';
  const ico={fs:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    ex:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
    dl:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M4 20h16"/></svg>'};
  const bFs=d.createElement('button');bFs.type='button';bFs.className='app-btn';
  const bIn=d.createElement('button');bIn.type='button';bIn.className='app-btn y';bIn.innerHTML=ico.dl+'<span>Instalar app</span>';bIn.hidden=true;
  function paint(){const on=!!fsEl();bFs.innerHTML=(on?ico.ex:ico.fs)+'<span>'+(on?'Sair da tela cheia':'Tela cheia')+'</span>';bFs.setAttribute('aria-label',on?'Sair da tela cheia':'Tela cheia')}
  bFs.onclick=()=>{try{if(fsEl()){(d.exitFullscreen||d.webkitExitFullscreen).call(d)}else{const p=(root.requestFullscreen||root.webkitRequestFullscreen).call(root);if(p&&p.catch)p.catch(()=>{})}}catch(e){}};
  d.addEventListener('fullscreenchange',paint);d.addEventListener('webkitfullscreenchange',paint);paint();
  let deferred=null;
  addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferred=e;bIn.hidden=false});
  bIn.onclick=async()=>{if(!deferred)return;deferred.prompt();try{await deferred.userChoice}catch(e){}deferred=null;bIn.hidden=true};
  addEventListener('appinstalled',()=>{bIn.hidden=true});
  if(!(standalone&&matchMedia('(display-mode: fullscreen)').matches)&&canFs)bar.appendChild(bFs);
  bar.appendChild(bIn);
  if(!own)addEventListener('DOMContentLoaded',()=>d.body.appendChild(bar));
  if(standalone)root.classList.add('is-app');
})();
