export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>sprinty dashboard</title>
<style>
:root{color-scheme:dark;--bg:#101112;--panel:#191b1f;--panel2:#20242a;--line:#333842;--text:#f0f2f4;--muted:#9ca6b3;--blue:#80b8ff;--green:#7bd88f;--red:#ff8b8b;--yellow:#f4c96b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
header{display:grid;grid-template-columns:1fr auto;gap:1rem;align-items:end;padding:1.25rem 1.5rem;border-bottom:1px solid var(--line);background:#15171a}
h1{margin:0;font-size:1.25rem;font-weight:700;letter-spacing:0}.meta{display:flex;flex-wrap:wrap;gap:.6rem;color:var(--muted);font-size:.85rem}.pill{border:1px solid var(--line);border-radius:999px;padding:.2rem .55rem;background:var(--panel2);color:var(--muted)}
.pill.active{color:var(--green);border-color:#3b7049}.pill.closed{color:var(--blue);border-color:#355c88}
main{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(22rem,.75fr);gap:1rem;padding:1rem;max-width:1400px;margin:0 auto}
section{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:1rem;min-width:0}section+section{margin-top:1rem}
h2{margin:0 0 .75rem;font-size:.82rem;text-transform:uppercase;color:var(--muted);letter-spacing:.04em}
.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.6rem}.metric{background:var(--panel2);border:1px solid var(--line);border-radius:6px;padding:.75rem}.metric b{display:block;font-size:1.3rem}.metric span{color:var(--muted);font-size:.8rem}
.sub{border-top:1px solid var(--line);padding:1rem 0}.sub:first-child{border-top:0;padding-top:0}.row{display:flex;gap:.6rem;align-items:center;justify-content:space-between}.title{font-weight:650}.desc{color:var(--muted);margin:.15rem 0 .6rem}.items{display:grid;gap:.55rem}
.item{border:1px solid var(--line);background:var(--panel2);border-radius:6px;padding:.7rem}.item.terminal{opacity:.72}.item-head{display:flex;flex-wrap:wrap;gap:.45rem;align-items:center;margin-bottom:.3rem}.id{font:12px ui-monospace,monospace;color:var(--blue)}
.status{font-size:.75rem;color:var(--muted)}.open{color:var(--yellow)}.completed{color:var(--green)}.split{color:var(--blue)}.deprecated,.failed{color:var(--red)}
.gates{display:grid;gap:.25rem;margin-top:.45rem}.gate{font:12px ui-monospace,monospace;color:var(--muted);overflow-wrap:anywhere}.gate.pass{color:var(--green)}.gate.fail{color:var(--red)}
.timeline{display:grid;gap:.5rem}.event{display:grid;grid-template-columns:8.5rem minmax(0,1fr);gap:.7rem;border-top:1px solid var(--line);padding-top:.5rem}.event:first-child{border-top:0;padding-top:0}.time{color:var(--muted);font:12px ui-monospace,monospace}.event b{font-size:.82rem}.event p{margin:.12rem 0 0;color:var(--muted);overflow-wrap:anywhere}
.empty{color:var(--muted);padding:.6rem 0}.error{color:var(--red)}
@media(max-width:850px){header{grid-template-columns:1fr}main{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.event{grid-template-columns:1fr}}
</style>
</head>
<body>
<header>
  <div>
    <h1 id="goal">Loading sprint...</h1>
    <div class="meta">
      <span id="branch"></span>
      <span id="worktree"></span>
      <span id="created"></span>
    </div>
  </div>
  <span id="status" class="pill">loading</span>
</header>
<main>
  <div>
    <section>
      <h2>Progress</h2>
      <div class="metrics">
        <div class="metric"><b id="metric-subsprints">0</b><span>subsprints</span></div>
        <div class="metric"><b id="metric-items">0</b><span>items</span></div>
        <div class="metric"><b id="metric-open">0</b><span>open</span></div>
        <div class="metric"><b id="metric-gates">0</b><span>gate results</span></div>
        <div class="metric"><b id="metric-coverage">--</b><span>line coverage</span></div>
      </div>
    </section>
    <section>
      <h2>Active Items</h2>
      <div id="active-items" class="items"></div>
    </section>
    <section>
      <h2>Subsprints</h2>
      <div id="subsprints"></div>
    </section>
  </div>
  <aside>
    <section>
      <h2>Hotspots</h2>
      <div id="hotspots" class="items"></div>
    </section>
    <section>
      <h2>Timeline</h2>
      <div id="timeline" class="timeline"></div>
    </section>
  </aside>
</main>
<script>
function byId(id){return document.getElementById(id)}
function clear(node){node.replaceChildren()}
function text(tag, className, value){
  const node=document.createElement(tag);
  if(className)node.className=className;
  node.textContent=value == null ? "" : String(value);
  return node;
}
function fmt(ts){
  if(!ts)return "";
  const d=new Date(ts);
  return Number.isNaN(d.valueOf()) ? ts : d.toLocaleString();
}
function summarize(s){
  const subs=s.subsprints||[];
  const items=subs.flatMap(function(ss){return ss.items||[]});
  const gateResults=items.reduce(function(n,i){return n+(i.gate_results||[]).length},0);
  return {subs:subs,items:items,open:items.filter(function(i){return i.status==="open"}),gateResults:gateResults};
}
function renderGateResults(item, target){
  const gates=document.createElement("div");
  gates.className="gates";
  const results=item.gate_results||[];
  if(results.length===0){
    gates.append(text("div","gate","pending evidence"));
  } else {
    results.forEach(function(g){
      gates.append(text("div","gate "+(g.passed?"pass":"fail"),(g.passed?"pass ":"fail ")+g.kind+": "+g.spec+" - "+g.evidence));
    });
  }
  target.append(gates);
}
function renderItem(item){
  const node=document.createElement("div");
  node.className="item "+(item.status!=="open"?"terminal":"");
  const head=document.createElement("div");
  head.className="item-head";
  head.append(text("span","id",item.id));
  head.append(text("span","status "+item.status,item.disposition||item.status));
  if(item.commit_id)head.append(text("span","status","commit "+item.commit_id));
  if(item.changelog)head.append(text("span","status",item.changelog.verb+": "+item.changelog.line));
  head.append(text("span","status",fmt(item.created_at)));
  node.append(head);
  node.append(text("div","title",item.title||item.description));
  if(item.title&&item.description&&item.title!==item.description)node.append(text("div","desc",item.description));
  if(item.code_locations&&item.code_locations.length)node.append(text("div","desc",item.code_locations.join(", ")));
  renderGateResults(item,node);
  return node;
}
function renderSubsprint(ss){
  const node=document.createElement("div");
  node.className="sub";
  const row=document.createElement("div");
  row.className="row";
  row.append(text("div","title",ss.id+" - "+ss.description));
  row.append(text("span","pill "+ss.status,ss.status));
  node.append(row);
  node.append(text("div","desc",(ss.goals||[]).join("; ")));
  const items=document.createElement("div");
  items.className="items";
  (ss.items||[]).forEach(function(item){items.append(renderItem(item))});
  if(!items.childNodes.length)items.append(text("div","empty","No items yet."));
  node.append(items);
  return node;
}
function renderTimeline(s){
  const timeline=byId("timeline");
  clear(timeline);
  const events=(s.timeline||[]).slice(-30).reverse();
  if(events.length===0){timeline.append(text("div","empty","No events yet."));return}
  events.forEach(function(e){
    const node=document.createElement("div");
    node.className="event";
    node.append(text("div","time",fmt(e.ts)));
    const body=document.createElement("div");
    body.append(text("b","",e.id+" / "+e.type));
    body.append(text("p","",e.text));
    node.append(body);
    timeline.append(node);
  });
}
function renderHotspots(s){
  const target=byId("hotspots");
  clear(target);
  const rows=((s.change_map&&s.change_map.hotspots)||[]).slice(0,8);
  if(rows.length===0){target.append(text("div","empty","No changed files yet."));return}
  rows.forEach(function(row){
    const node=document.createElement("div");
    node.className="item";
    const head=document.createElement("div");
    head.className="item-head";
    head.append(text("span","id",row.file));
    head.append(text("span","status","churn "+row.churn));
    head.append(text("span","status","+"+row.additions+" -"+row.deletions));
    node.append(head);
    node.append(text("div","desc",row.language+" / "+row.directory+" / "+(row.items||[]).join(", ")));
    target.append(node);
  });
}
function render(s){
  const summary=summarize(s);
  byId("goal").textContent=s.goal||"(no sprint)";
  byId("branch").textContent=s.branch ? "branch "+s.branch : "";
  byId("worktree").textContent="git "+(s.dir||s.worktree||"")+" data "+(s.data_dir||"");
  byId("created").textContent=s.created_at ? "started "+fmt(s.created_at) : "";
  const status=byId("status");
  status.className="pill "+(s.status||"active");
  status.textContent=s.status||"active";
  byId("metric-subsprints").textContent=String(summary.subs.length);
  byId("metric-items").textContent=String(summary.items.length);
  byId("metric-open").textContent=String(summary.open.length);
  byId("metric-gates").textContent=String(summary.gateResults);
  byId("metric-coverage").textContent=s.coverage&&s.coverage.lines ? String(s.coverage.lines.percent)+"%" : "--";
  const active=byId("active-items");
  clear(active);
  summary.open.forEach(function(item){active.append(renderItem(item))});
  if(!active.childNodes.length)active.append(text("div","empty","No open items."));
  const subsprints=byId("subsprints");
  clear(subsprints);
  summary.subs.forEach(function(ss){subsprints.append(renderSubsprint(ss))});
  if(!subsprints.childNodes.length)subsprints.append(text("div","empty","No subsprints yet."));
  renderHotspots(s);
  renderTimeline(s);
}
async function tick(){
  try{
    const response=await fetch("/state");
    render(await response.json());
  }catch(err){
    byId("goal").textContent="Dashboard disconnected";
    const active=byId("active-items");
    clear(active);
    active.append(text("div","error",err && err.message ? err.message : "Unable to load state."));
  }
}
tick();setInterval(tick,2000);
</script>
</body>
</html>`;
