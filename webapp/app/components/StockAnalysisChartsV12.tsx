"use client";

import {useMemo} from "react";

type Point={label:string;values:(number|null)[]};
type Series={label:string;key:string};

type Props={report:any};

const finite=(value:unknown):number|null=>typeof value==="number"&&Number.isFinite(value)?value:Number.isFinite(Number(value))?Number(value):null;
const compact=(value:number)=>new Intl.NumberFormat("en-US",{notation:"compact",maximumFractionDigits:1}).format(value);
const money=(value:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(value);

export default function StockAnalysisChartsV12({report}:Props){
 const charts=useMemo(()=>buildCharts(report),[report]);
 return <section className="card" data-analysis-charts="12.2">
  <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}>
   <div><span className="tag">COMPARATIVE VISUAL ANALYTICS</span><h3 className="sub" style={{margin:"10px 0 4px"}}>Institutional comparison charts</h3><p className="muted" style={{margin:0}}>Charts use the same underwriting report object as the tables and Excel export.</p></div>
   <span className="tag">SINGLE SOURCE OF TRUTH</span>
  </div>
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))",gap:14,marginTop:16}}>
   <ScoreBars title="Research score comparison" items={charts.scores}/>
   <PriceMap title="Price, risk and valuation map" items={charts.priceMap}/>
   <MultiLineChart title="Annual financial trend" subtitle="Revenue, operating income and free cash flow" points={charts.financialTrend} series={[{label:"Revenue",key:"revenue"},{label:"Operating income",key:"operating"},{label:"FCF",key:"fcf"}]}/>
   <MultiLineChart title="Eight-quarter earnings trend" subtitle="Quarterly revenue and EPS are normalized independently" points={charts.earningsTrend} series={[{label:"Revenue",key:"revenue"},{label:"EPS",key:"eps"}]} normalized/>
   <PeerBars title="Competitor growth comparison" items={charts.peerGrowth} suffix="%"/>
   <PeerBars title="Competitor margin comparison" items={charts.peerMargin} suffix="%"/>
   <MultiLineChart title="Bull / Base / Bear revenue forecast" subtitle="Five-year modeled scenario comparison" points={charts.forecastTrend} series={[{label:"Bull",key:"bull"},{label:"Base",key:"base"},{label:"Bear",key:"bear"}]}/>
   <HeatGrid title="DCF sensitivity" rows={charts.dcfRows}/>
  </div>
 </section>
}

function buildCharts(report:any){
 const annual=Array.isArray(report?.financial?.annual)?[...report.financial.annual].reverse():[];
 const quarters=Array.isArray(report?.earnings?.quarters)?[...report.earnings.quarters].reverse():[];
 const peers=Array.isArray(report?.competitors?.rows)?report.competitors.rows:[];
 const scenarios=Array.isArray(report?.forecast?.scenarios)?report.forecast.scenarios:[];
 const byScenario=(name:string)=>scenarios.find((item:any)=>String(item?.name).toLowerCase()===name.toLowerCase())?.years??[];
 const bull=byScenario("Bull"),base=byScenario("Base"),bear=byScenario("Bear");
 const dcf=Array.isArray(report?.dcf?.sensitivity)?report.dcf.sensitivity:[];
 const grouped=new Map<number,{wacc:number;cells:{growth:number;value:number|null}[]}>();
 for(const item of dcf){const wacc=finite(item?.waccPct);const growth=finite(item?.terminalGrowthPct);if(wacc==null||growth==null)continue;if(!grouped.has(wacc))grouped.set(wacc,{wacc,cells:[]});grouped.get(wacc)!.cells.push({growth,value:finite(item?.value)});}
 return {
  scores:[
   {label:"Quality",value:finite(report?.quality?.score)??0},
   {label:"Growth",value:finite(report?.growth?.score)??0},
   {label:"Valuation",value:finite(report?.valuation?.score)??0},
   {label:"Risk",value:finite(report?.risk?.score)??0},
   {label:"Conviction",value:finite(report?.conviction)??0},
   {label:"Evidence",value:finite(report?.evidence?.score)??0},
  ],
  priceMap:[
   {label:"Stop",value:finite(report?.technical?.stopLoss)},
   {label:"Entry low",value:finite(report?.technical?.entryZoneLow)},
   {label:"Current",value:finite(report?.valuation?.price)},
   {label:"Entry high",value:finite(report?.technical?.entryZoneHigh)},
   {label:"Fair value",value:finite(report?.valuation?.fairValue)},
   {label:"Target",value:finite(report?.valuation?.targetPrice)},
  ],
  financialTrend:annual.map((row:any)=>({label:String(row.period??"—"),values:[finite(row.revenue),null,finite(row.freeCashFlow)],operating:row.revenue!=null&&row.operatingMarginPct!=null?Number(row.revenue)*Number(row.operatingMarginPct)/100:null})).map((row:any)=>({label:row.label,values:[row.values[0],row.operating,row.values[2]]})),
  earningsTrend:quarters.map((row:any)=>({label:String(row.period??"—"),values:[finite(row.revenue),finite(row.eps)]})),
  peerGrowth:peers.map((row:any)=>({label:String(row.ticker??"—"),value:finite(row.growthPct)})).filter((row:any)=>row.value!=null).sort((a:any,b:any)=>b.value-a.value).slice(0,8),
  peerMargin:peers.map((row:any)=>({label:String(row.ticker??"—"),value:finite(row.marginPct)})).filter((row:any)=>row.value!=null).sort((a:any,b:any)=>b.value-a.value).slice(0,8),
  forecastTrend:Array.from({length:Math.max(bull.length,base.length,bear.length)},(_,index)=>({label:`Year ${index+1}`,values:[finite(bull[index]?.revenue),finite(base[index]?.revenue),finite(bear[index]?.revenue)]})),
  dcfRows:[...grouped.values()].sort((a,b)=>a.wacc-b.wacc).map(row=>({...row,cells:row.cells.sort((a,b)=>a.growth-b.growth)})),
 };
}

function ScoreBars({title,items}:{title:string;items:{label:string;value:number}[]}){return <ChartCard title={title}>{items.map(item=><div key={item.label} style={{display:"grid",gridTemplateColumns:"92px 1fr 42px",gap:10,alignItems:"center",marginTop:10}}><span className="muted" style={{fontSize:12}}>{item.label}</span><div style={{height:9,borderRadius:99,background:"rgba(90,112,168,.18)",overflow:"hidden"}}><div style={{height:"100%",width:`${Math.max(0,Math.min(100,item.value))}%`,background:"linear-gradient(90deg,#25d6c8,#4f7eff,#8b5cf6)",borderRadius:99}}/></div><strong style={{fontSize:12,textAlign:"right"}}>{Math.round(item.value)}</strong></div>)}</ChartCard>}

function PriceMap({title,items}:{title:string;items:{label:string;value:number|null}[]}){const clean=items.filter(item=>item.value!=null) as {label:string;value:number}[];if(!clean.length)return <EmptyChart title={title}/>;const min=Math.min(...clean.map(item=>item.value));const max=Math.max(...clean.map(item=>item.value));const span=Math.max(.01,max-min);return <ChartCard title={title}><div style={{position:"relative",height:178,marginTop:14,borderBottom:"1px solid rgba(121,142,190,.28)"}}>{clean.map((item,index)=>{const left=((item.value-min)/span)*92+4;return <div key={item.label} style={{position:"absolute",left:`${left}%`,top:index%2?82:24,transform:"translateX(-50%)",textAlign:"center",minWidth:68}}><div style={{fontSize:11,fontWeight:700}}>{item.label}</div><div style={{fontSize:12,color:"var(--accent)",marginTop:4}}>{money(item.value)}</div><div style={{width:2,height:index%2?42:86,background:"linear-gradient(#8b5cf6,#31d9f3)",margin:"5px auto 0",opacity:.75}}/></div>})}<div style={{position:"absolute",bottom:-24,left:0,fontSize:10}}>{money(min)}</div><div style={{position:"absolute",bottom:-24,right:0,fontSize:10}}>{money(max)}</div></div></ChartCard>}

function MultiLineChart({title,subtitle,points,series,normalized=false}:{title:string;subtitle:string;points:Point[];series:Series[];normalized?:boolean}){if(!points.length)return <EmptyChart title={title}/>;const width=640,height=240,padX=46,padY=26;const normalizedValues=series.map((_,seriesIndex)=>{const vals=points.map(point=>point.values[seriesIndex]);if(!normalized)return vals;const first=vals.find(value=>value!=null);return vals.map(value=>value==null||first==null||first===0?null:value/first*100)});const all=normalizedValues.flat().filter((value):value is number=>value!=null&&Number.isFinite(value));if(!all.length)return <EmptyChart title={title}/>;const min=Math.min(...all),max=Math.max(...all),span=Math.max(1,max-min);const x=(index:number)=>padX+(index/Math.max(1,points.length-1))*(width-padX*2);const y=(value:number)=>height-padY-((value-min)/span)*(height-padY*2);const colors=["#31d9f3","#8b5cf6","#16c784","#f5b942"];return <ChartCard title={title} subtitle={subtitle}><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} style={{width:"100%",height:250,display:"block"}}>{[0,.25,.5,.75,1].map(step=><line key={step} x1={padX} x2={width-padX} y1={padY+step*(height-padY*2)} y2={padY+step*(height-padY*2)} stroke="rgba(130,151,196,.16)"/>)}{normalizedValues.map((values,seriesIndex)=>{const path=values.map((value,index)=>value==null?null:{x:x(index),y:y(value)}).filter(Boolean) as {x:number;y:number}[];if(!path.length)return null;return <g key={series[seriesIndex].label}><polyline points={path.map(point=>`${point.x},${point.y}`).join(" ")} fill="none" stroke={colors[seriesIndex%colors.length]} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/>{path.map((point,index)=><circle key={index} cx={point.x} cy={point.y} r="3.5" fill={colors[seriesIndex%colors.length]}/>)}</g>})}{points.map((point,index)=><text key={point.label} x={x(index)} y={height-5} textAnchor="middle" fontSize="10" fill="#94a3b8">{point.label.length>10?point.label.slice(0,10):point.label}</text>)}</svg><div style={{display:"flex",gap:14,flexWrap:"wrap"}}>{series.map((item,index)=><span key={item.label} className="muted" style={{fontSize:11}}><span style={{display:"inline-block",width:9,height:9,borderRadius:99,background:colors[index%colors.length],marginRight:6}}/>{item.label}{normalized?" (indexed)":""}</span>)}</div></ChartCard>}

function PeerBars({title,items,suffix}:{title:string;items:{label:string;value:number}[];suffix:string}){if(!items.length)return <EmptyChart title={title}/>;const max=Math.max(...items.map(item=>Math.abs(item.value)),1);return <ChartCard title={title}>{items.map(item=><div key={item.label} style={{display:"grid",gridTemplateColumns:"48px 1fr 58px",gap:9,alignItems:"center",marginTop:9}}><strong style={{fontSize:11}}>{item.label}</strong><div style={{height:10,borderRadius:99,background:"rgba(90,112,168,.18)",overflow:"hidden"}}><div style={{height:"100%",width:`${Math.abs(item.value)/max*100}%`,background:item.value>=0?"linear-gradient(90deg,#31d9f3,#4f7eff)":"linear-gradient(90deg,#ff5b6e,#f5b942)",borderRadius:99}}/></div><span style={{fontSize:11,textAlign:"right"}}>{item.value.toFixed(1)}{suffix}</span></div>)}</ChartCard>}

function HeatGrid({title,rows}:{title:string;rows:{wacc:number;cells:{growth:number;value:number|null}[]}[]}){if(!rows.length)return <EmptyChart title={title}/>;const values=rows.flatMap(row=>row.cells.map(cell=>cell.value)).filter((value):value is number=>value!=null);const min=Math.min(...values),max=Math.max(...values),span=Math.max(.01,max-min);return <ChartCard title={title}><div style={{overflowX:"auto"}}><table className="table"><thead><tr><th>WACC \ g</th>{rows[0].cells.map(cell=><th key={cell.growth}>{cell.growth.toFixed(1)}%</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.wacc}><th>{row.wacc.toFixed(1)}%</th>{row.cells.map(cell=>{const ratio=cell.value==null?0:(cell.value-min)/span;return <td key={cell.growth} style={{background:`rgba(79,126,255,${.1+ratio*.55})`,fontWeight:700}}>{cell.value==null?"—":money(cell.value)}</td>})}</tr>)}</tbody></table></div></ChartCard>}

function ChartCard({title,subtitle,children}:{title:string;subtitle?:string;children:React.ReactNode}){return <div className="card" style={{padding:18,minHeight:290}}><h4 style={{margin:"0 0 4px"}}>{title}</h4>{subtitle&&<p className="muted" style={{margin:"0 0 8px",fontSize:11}}>{subtitle}</p>}{children}</div>}
function EmptyChart({title}:{title:string}){return <ChartCard title={title}><div className="notice" style={{marginTop:18}}>Evidence unavailable for this chart.</div></ChartCard>}
