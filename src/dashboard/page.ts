export const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>sprinty</title>
<style>body{font:14px ui-monospace,monospace;margin:2rem;background:#0b0b0c;color:#e6e6e6}
.sub{border:1px solid #333;border-radius:8px;padding:1rem;margin:1rem 0}
.done{opacity:.55}.gate{color:#7aa2f7}.bad{color:#f7768e}.ok{color:#9ece6a}h1{font-size:1rem}</style></head>
<body><h1 id="goal">loading…</h1><div id="root"></div>
<script>
async function tick(){
  const s=await (await fetch('/state')).json();
  document.getElementById('goal').textContent='Sprint: '+s.goal+' ['+s.status+'] @'+s.branch;
  document.getElementById('root').innerHTML=s.subsprints.map(function(ss){
    return '<div class="sub"><b>'+ss.id+'</b> '+ss.description+' <i>['+ss.status+']</i>'+
      ss.items.map(function(i){return '<div class="'+(i.status==='resolved'?'done':'')+'">'+
        i.id+' — '+i.description+(i.disposition?' ('+i.disposition+')':'')+'</div>';}).join('')+'</div>';
  }).join('');
}
tick();setInterval(tick,2000);
</script></body></html>`;
