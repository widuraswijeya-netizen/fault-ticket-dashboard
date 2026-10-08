let currentUser=null,tickets=[],selectedTicket=null,selectedCategory=null,selectedStatusFilter=null;
const $=id=>document.getElementById(id);
const CATEGORY_DEFS=[
 {id:"GLDUFTTH",title:"GL / DU",tag:"FTTH",sub:"GL or DU FTTH faults"},
 {id:"UNWHARIMFTTH",title:"UNW / HAR / IM",tag:"FTTH",sub:"UNW, HAR or IM FTTH faults"},
 {id:"GLDU",title:"GL / DU",tag:"COPPER",sub:"GL and DU copper faults"},
 {id:"UNWHAR",title:"UNW / HAR",tag:"COPPER",sub:"UNW and HAR copper faults"},
 {id:"UMNF",title:"UM / NF",tag:"COPPER",sub:"UM and NF copper faults"},
 {id:"IM",title:"IM",tag:"COPPER",sub:"IM copper faults"},
 {id:"4G",title:"4G",tag:"MOBILE",sub:"4G / LTE faults"},
 {id:"UG",title:"UG",tag:"UG FAULT",sub:"UG faults"}
];
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function digits(v){return String(v??"").replace(/\D/g,"")}
function circuitCallNumber(v){var d=digits(v);return d.length<9?"":"0"+d.slice(-9)}
function fmtElapsed(v){var t=Date.parse(v||"");if(!Number.isFinite(t))return "—";var m=Math.max(0,Math.floor((Date.now()-t)/60000)),h=Math.floor(m/60);return h+"h "+(m%60)+"m"}
function elapsedPct(v){var t=Date.parse(v||"");if(!Number.isFinite(t))return 25;return Math.min(100,Math.max(8,((Date.now()-t)/86400000)*100))}
function activeTicket(t){return true}
function isPending(s){s=String(s||"").toUpperCase();return s.includes("OPEN")||s.includes("ACKNOWLEDGED")||s.includes("ASSIGNED")}
function isClearedStatus(s){var v=String(s||"").trim().toUpperCase();return v.includes("CLEARED")||v.includes("COMPLETED")||v.includes("RESOLVED")||v.includes("CLOSED")}
function statusInfo(s){var v=String(s||"").trim().toUpperCase();if(v.includes("CLEARED")||v.includes("COMPLETED")||v.includes("RESOLVED")||v.includes("CLOSED"))return {label:"CLEARED",cls:"cleared"};if(v.includes("ACKNOWLEDGED")||v.includes("ACKNOWLAGHED")||v.includes("ASSIGNED"))return {label:"ACKNOWLEDGED",cls:"acknowledged"};return {label:v.includes("OPEN")?"OPEN":(v||"OPEN"),cls:"open"}}
function isCopper(t){var s=String(t.SA_SERVICE_TYPE||"").toUpperCase();return s.includes("V-VOICE COPPER")||s.includes("E-IPTV COPPER")||s.includes("BB-INTERNET COPPER")}
function classify(t){
 var lea=String(t.SA_LEA||"").trim().toUpperCase(),type=String(t.SA_SERVICE_TYPE||"").trim().toUpperCase(),wg=String(t["Assigned WG"]||"").toUpperCase(),circuit=String(t["Circuit Display Name"]||"").trim().toUpperCase(),dp=String(t.SA_DP_LOOP||"").trim().toUpperCase();
 var copper=isCopper(t),ug=wg.includes("CDM"),ftth=type.includes("FTTH"),fourG=!copper&&(wg.includes("LTE")||circuit.includes("0913")||circuit.includes("94913"));
 if(ug)return "UG";
 if(ftth){if(["GL","DU"].includes(lea))return "GLDUFTTH";if(["UNW","HAR","IM"].includes(lea))return "UNWHARIMFTTH";return null}
 if(fourG)return "4G";
 if(!copper)return null;
 if(dp.startsWith("UNW")||dp.startsWith("HAR"))return "UNWHAR";
 if(["GL","DU"].includes(lea))return "GLDU";
 if(["UM","NF"].includes(lea))return "UMNF";
 if(lea==="IM")return "IM";
 return null;
}
function showLogin(){$("loginScreen").hidden=false;$("app").hidden=true}
function showApp(){$("loginScreen").hidden=true;$("app").hidden=false;$("userLabel").textContent=currentUser?"Service "+currentUser.serviceNumber:"";$("menuUser").textContent=currentUser?"Service Number: "+currentUser.serviceNumber:"";renderCategories();showCategoryView()}
async function login(serviceNumber,password){var r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"include",body:JSON.stringify({serviceNumber,password})}),d=await r.json().catch(()=>({}));if(!r.ok||!d.user)throw new Error(d.error||"Login failed.");currentUser=d.user;showApp();await loadFaults()}
async function loadSession(){var r=await fetch("/api/me",{credentials:"include",cache:"no-store"});if(!r.ok){showLogin();return}var d=await r.json();currentUser=d.user;if(!currentUser){showLogin();return}showApp();await loadFaults()}
async function loadFaults(){try{var r=await fetch("/api/cloud/state",{credentials:"include",cache:"no-store"}),d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Unable to load cloud faults.");tickets=Array.isArray(d&&d.tickets)?d.tickets.filter(activeTicket):[];renderCategories();if(selectedCategory)renderFaults()}catch(e){console.error(e);$("categoryGrid").innerHTML='<div class="empty-state">'+esc(e.message||"Unable to load faults.")+"</div>"}}
function categoryRows(id){return tickets.filter(t=>classify(t)===id)}
function statusCounts(rows){return rows.reduce((a,t)=>{var s=String(t.Status||"").toUpperCase();if(isClearedStatus(s))a.cleared++;else if(s.includes("ACKNOWLEDGED")||s.includes("ACKNOWLAGHED")||s.includes("ASSIGNED"))a.ack++;else if(s.includes("OPEN"))a.open++;return a},{open:0,ack:0,cleared:0})}
function matchesStatus(t,filter){
 if(!filter)return true;
 var s=String(t.Status||"").toUpperCase();
 if(filter==="open")return s.includes("OPEN")&&!isClearedStatus(s);
 if(filter==="ack")return (s.includes("ACKNOWLEDGED")||s.includes("ACKNOWLAGHED")||s.includes("ASSIGNED"))&&!isClearedStatus(s);
 if(filter==="cleared")return isClearedStatus(s);
 if(filter==="pending")return isPending(s)&&!isClearedStatus(s);
 return true;
}
function statusFilterLabel(filter){
 return ({open:"OPEN",ack:"ACKNOWLEDGED",cleared:"CLEARED",pending:"PENDING"})[filter]||"ALL";
}
function renderCategories(){
 $("categoryGrid").innerHTML=CATEGORY_DEFS.map(def=>{var rows=categoryRows(def.id),c=statusCounts(rows);return '<div class="info-card worker-info-card" data-category="'+def.id+'" role="button" tabindex="0"><div class="card-header"><span>'+esc(def.title)+'</span><span class="tag">'+esc(def.tag)+'</span></div><div class="category-sub">'+esc(def.sub)+'</div><div class="card-metrics"><button type="button" class="metric-filter metric-open" data-status-filter="open"><span>Open</span><strong>'+c.open+'</strong></button><button type="button" class="metric-filter metric-ack" data-status-filter="ack"><span>Ack</span><strong>'+c.ack+'</strong></button><button type="button" class="metric-filter metric-pending" data-status-filter="pending"><span>Pending</span><strong>'+(c.open+c.ack)+'</strong></button><button type="button" class="metric-filter metric-cleared" data-status-filter="cleared"><span>Cleared</span><strong>'+c.cleared+'</strong></button></div><div class="category-footer"><span>View Faults</span><span>→</span></div></div>'}).join("")
}
function showCategoryView(){selectedCategory=null;selectedStatusFilter=null;$("categoryView").hidden=false;$("faultView").hidden=true}
function selectCategory(id,statusFilter){
 selectedCategory=id;
 selectedStatusFilter=statusFilter||null;
 $("categoryView").hidden=true;
 $("faultView").hidden=false;
 var def=CATEGORY_DEFS.find(x=>x.id===id),counts=statusCounts(categoryRows(id)),filterLabel=statusFilterLabel(selectedStatusFilter);
 $("selectedTitle").innerHTML=esc(def?def.title:"Faults")+' <span id="faultCount">0</span>';
 $("selectedSummary").innerHTML=esc(def?def.sub:"")+(selectedStatusFilter?'<span class="active-status-filter">Showing '+filterLabel+' faults</span>':'<span class="status-summary"><b class="sum-open">OPEN <i>'+counts.open+'</i></b><b class="sum-ack">ACKNOWLEDGED <i>'+counts.ack+'</i></b><b class="sum-cleared">CLEARED <i>'+counts.cleared+'</i></b></span>');
 renderFaults();
 window.scrollTo({top:0,behavior:"smooth"});
}
function renderFaults(){
 var allRows=categoryRows(selectedCategory),filtered=allRows.filter(t=>matchesStatus(t,selectedStatusFilter)),active=filtered.filter(t=>!isClearedStatus(t.Status)),cleared=filtered.filter(t=>isClearedStatus(t.Status));
 active.sort((a,b)=>(Number(b.Priority)||0)-(Number(a.Priority)||0));
 cleared.sort((a,b)=>Date.parse(b["Reported On"]||"")-Date.parse(a["Reported On"]||""));
 var rows=active.concat(cleared);
 $("faultCount").textContent=rows.length;
 $("emptyState").hidden=rows.length!==0;
 $("faultList").innerHTML=rows.map((t,i)=>{var priority=esc(t.Priority||"—"),elapsed=fmtElapsed(t["Reported On"]),pct=elapsedPct(t["Reported On"]),status=statusInfo(t.Status),clearedClass=isClearedStatus(t.Status)?" cleared-ticket":"";return '<article class="fault-card status-'+status.cls+clearedClass+'"><div class="fault-status">'+esc(status.label)+'</div><div class="fault-top"><div><div class="circuit">'+esc(t["Circuit Display Name"]||"No circuit name")+'</div><div class="next-toggle">NEXT <span>◉</span></div></div><div class="priority">'+priority+"</div></div><div class="elapsed">⏱ "+esc(elapsed)+'</div><div class="elapsed-bar"><i style="width:'+pct+'%"></i></div><div class="ticket-id">'+esc(t.ID||"No ID")+'</div><div class="address">'+esc(t.SA_ADDRESS||"Address unavailable")+'</div><div class="dp">DP: '+esc(t.SA_DP_LOOP||"N/A")+'</div><div class="card-actions"><button class="details-btn" data-detail="'+i+'">View Details</button><button class="call-btn" aria-label="Call" data-call="'+i+'">☎</button></div></article>'}).join("");
 window._visibleTickets=rows;
 var divider=$("faultList").querySelector(".cleared-divider");if(divider)divider.remove();
 if(cleared.length){var el=document.createElement("div");el.className="cleared-divider";el.innerHTML="<span>Cleared Tickets</span>";var firstCleared=$("faultList").querySelector(".cleared-ticket");if(firstCleared)$("faultList").insertBefore(el,firstCleared)}
}
function openCall(t){selectedTicket=t;var fa=digits(t.FA_CONTACT_NUMBER),circuit=circuitCallNumber(t["Circuit Display Name"]);$("callTicketLabel").textContent=t.ID?"Ticket "+t.ID:"";$("callFaNumber").textContent=fa||"Number unavailable";$("callCircuitNumber").textContent=circuit||"Unable to derive from Circuit Display Name";$("callFaBtn").href=fa?"tel:"+fa:"#";$("callCircuitBtn").href=circuit?"tel:"+circuit:"#";$("callModal").hidden=false}
function openDetail(t){selectedTicket=t;var fields=[["Priority",t.Priority],["Circuit Display Name",t["Circuit Display Name"]],["Customer Name",t["Customer Name"]],["Service Address",t.SA_ADDRESS],["FA Contact Number",t.FA_CONTACT_NUMBER],["Ticket ID",t.ID],["Status",t.Status],["DP Loop",t.SA_DP_LOOP],["LEA",t.SA_LEA],["Assigned WG",t["Assigned WG"]],["Description",t.Description],["Reported On",t["Reported On"]],["Service Type",t.SA_SERVICE_TYPE]];$("detailBody").innerHTML=fields.map(f=>'<div class="detail-row"><div class="detail-label">'+esc(f[0])+'</div><div class="detail-value">'+esc(f[1]||"N/A")+"</div></div>").join("");$("detailModal").hidden=false}
$("loginForm").addEventListener("submit",async e=>{e.preventDefault();$("loginError").textContent="";try{await login($("serviceNumber").value.trim(),$("password").value)}catch(err){$("loginError").textContent=err.message}});
$("refreshBtn").onclick=loadFaults;
$("categoryGrid").addEventListener("click",e=>{var metric=e.target.closest(".metric-filter"),card=e.target.closest("[data-category]");if(metric&&card){e.stopPropagation();selectCategory(card.dataset.category,metric.dataset.statusFilter);return}if(card)selectCategory(card.dataset.category)});
$("categoryGrid").addEventListener("keydown",e=>{var card=e.target.closest("[data-category]");if(!card||e.target.closest(".metric-filter"))return;if(e.key==="Enter"||e.key===" "){e.preventDefault();selectCategory(card.dataset.category)}});
$("backCategoriesBtn").onclick=()=>{renderCategories();showCategoryView();window.scrollTo({top:0,behavior:"smooth"})};
$("faultList").addEventListener("click",e=>{var d=e.target.closest("[data-detail]"),c=e.target.closest("[data-call]"),rows=window._visibleTickets||[];if(d)return openDetail(rows[Number(d.dataset.detail)]);if(c)return openCall(rows[Number(c.dataset.call)])});
$("closeCallBtn").onclick=()=>{$("callModal").hidden=true};$("callModal").addEventListener("click",e=>{if(e.target===$("callModal"))$("callModal").hidden=true});
$("closeDetailBtn").onclick=()=>{$("detailModal").hidden=true};$("detailModal").addEventListener("click",e=>{if(e.target===$("detailModal"))$("detailModal").hidden=true});
$("menuBtn").onclick=()=>{$("menuPanel").hidden=false};$("menuPanel").onclick=e=>{if(e.target===$("menuPanel"))$("menuPanel").hidden=true};
$("logoutBtn").onclick=async()=>{await fetch("/api/logout",{method:"POST",credentials:"include"});currentUser=null;selectedCategory=null;selectedStatusFilter=null;showLogin();$("password").value=""};
loadSession();