"use client";

import {useMemo} from "react";
import styles from "./StockAnalysisChartsV12.module.css";

type Point={label:string;values:(number|null)[]};
type Series={label:string;key:string};
type Props={report:any};

const finite=(value:unknown):number|null=>{
 if(typeof value==="number")return Number.isFinite(value)?value:null;
 if(typeof value==="string"&&value.trim()!==""){const n=Number(value);return Number.isFinite(n)?n:null}
 return null;
};
const money=(value:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(value);
const hasMeasured=(points:Point[])=>points.some(point=>point.values.some(value=>value!=null&&Number.isFinite(value)));

export default function StockAnalysisChartsV12({report}:Props){
 const charts=useMemo(()=>buildCharts(report),[report]);
 return <section className="card" data-analysis-charts="12.3">
  <div className={styles.header}>
   <div><span className="tag">COMPARATIVE VISUAL ANALYTICS</span><h3 className="sub" style={{margin:"10px 0 4px"}}>Institutional comparison charts</h3><p className="muted" style={{margin:0}}>Only measured values are plotted. Missing evidence remains unavailable rather than becoming zero.</p></div>
   <span className="tag">SINGLE SOURCE OF TRUTH</span>
  </div>
  <div className={styles.grid}>
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
 const dcf=report?.dcf?.status==="MODEL_AVAILABLE"&&Array.isArray(report?.dcf?.sensitivity)?report.dcf.sensitivity:[];
 const grouped=new Map<number,{wacc:number;cells:{growth:number;value:number|null}[]}>();
 for(const item of dcf){const wacc=finite(item?.waccPct),growth=finite(item?.terminalGrowthPct),value=finite(item?.value);if(wacc==null||growth==null||value==null)continue;if(!grouped.has(wacc))grouped.set(wacc,{wacc,cells:[]});grouped.get(wacc)!.cells.push({growth,value})}
 const scores=[
  {label:"Quality",value:finite(report?.quality?.score)},
  {label:"Growth",value:finite(report?.growth?.score)},
  {label:"Valuation",value:finite(report?.valuation?.score)},
  {label:"Risk",value:finite(report?.risk?.score)},
  {label:"Conviction",value:finite(report?.conviction)},
  {label:"Evidence",value:finite(report?.evidence?.score)},
 ].filter((row):row is {label:string;value:number}=>row.value!=null);
 const financialTrend=annual.map((row:any)=>{const revenue=finite(row.revenue),margin=finite(row.operatingMarginPct);return{label:String(row.period??"—"),values:[revenue,revenue!=null&&margin!=null?revenue*margin/100:null,finite(row.freeCashFlow)]}});
 const earningsTrend=quarters.map((row:any)=>({label:String(row.period??"—"),values:[finite(row.revenue),finite(row.eps)]}));
 const forecastTrend=Array.from({length:Math.max(bull.length,base.length,bear.length)},(_,index)=>({label:`Year ${index+1}`,values:[finite(bull[index]?.revenue),finite(base[index]?.revenue),finite(bear[index]?.revenue)]}));
 return{
  scores,
  priceMap:[
   {label:"Stop",value:finite(report?.technical?.stopLoss)},
   {label:"Entry low",value:finite(report?.technical?.entryZoneLow)},
   {label:"Current",value:finite(report?.valuation?.price)},
   {label:"Entry high",value:finite(report?.technical?.entryZoneHigh)},
   {label:"Bear",value:finite(report?.valuation?.bearValue)},
   {label:"Fair value",value:finite(report?.valuation?.fairValue)},
   {label:"Bull",value:finite(report?.valuation?.bullValue)},
  ],
  financialTrend:hasMeasured(financialTrend)?financialTrend:[],
  earningsTrend:hasMeasured(earningsTrend)?earningsTrend:[],
  peerGrowth:peers.map((row:any)=>({label:String(row.ticker??"—"),value:finite(row.growthPct)})).filter((row:any):row is {label:string;value:number}=>row.value!=null).sort((a:any,b:any)=>b.value-a.value).slice(0,8),
  peerMargin:peers.map((row:any)=>({label:String(row.ticker??"—"),value:finite(row.marginPct)})).filter((row:any):row is {label:string;value:number}=>row.value!=null).sort((a:any,b:any)=>b.value-a.value).slice(0,8),
  forecastTrend:hasMeasured(forecastTrend)?forecastTrend:[],
  dcfRows:[...grouped.values()].sort((a,b)=>a.wacc-b.wacc).map(row=>({...row,cells:row.cells.sort((a,b)=>a.growth-b.growth)})),
 };
}

function ScoreBars({title,items}:{title:string;items:{label:string;value:number}[]}){
 if(!items.length)return <EmptyChart title={title}/>;
 return <ChartCard title={title}>{items.map(item=><div key={item.label} className={styles.scoreRow}><span className="muted" style={{fontSize:12}}>{item.label}</span><div className={styles.track}><div className={styles.scoreFill} style={{width:`${Math.max(0,Math.min(100,item.value))}%`}}/></div><strong style={{fontSize:12,textAlign:"right"}}>{Math.round(item.value)}</strong></div>)}</ChartCard>
}

function PriceMap({title,items}:{title:string;items:{label:string;value:number|null}[]}){
 const clean=items.filter((item):item is {label:string;value:number}=>item.value!=null&&Number.isFinite(item.value));
 if(!clean.length)return <EmptyChart title={title}/>;
 const rawMin=Math.min(...clean.map(item=>item.value)),rawMax=Math.max(...clean.map(item=>item.value));
 const pad=rawMax===rawMin?Math.max(rawMax*.05,1):(rawMax-rawMin)*.06;const min=Math.max(0,rawMin-pad),max=rawMax+pad,span=Math.max(.01,max-min);
 return <ChartCard title={title}><div className={styles.priceRows}>{clean.map(item=>{const left=Math.max(0,Math.min(100,((item.value-min)/span)*100));return <div className={styles.priceRow} key={item.label}><span className={styles.priceLabel}>{item.label}</span><div className={styles.priceTrack}><span className={styles.priceMarker} style={{left:`${left}%`}}/></div><span className={styles.priceValue}>{money(item.value)}</span></div>})}</div><div className={styles.axis}><span>{money(min)}</span><span>{money(max)}</span></div></ChartCard>
}

function MultiLineChart({title,subtitle,points,series,normalized=false}:{title:string;subtitle:string;points:Point[];series:Series[];normalized?:boolean}){
 if(!points.length||!hasMeasured(points))return <EmptyChart title={title}/>;
 const width=640,height=230,padX=46,padY=26;
 const normalizedValues=series.map((_,seriesIndex)=>{const vals=points.map(point=>point.values[seriesIndex]);if(!normalized)return vals;const first=vals.find(value=>value!=null&&value!==0);return vals.map(value=>value==null||first==null?null:value/first*100)});
 const all=normalizedValues.flat().filter((value):value is number=>value!=null&&Number.isFinite(value));if(!all.length)return <EmptyChart title={title}/>;
 const min=Math.min(...all),max=Math.max(...all),span=Math.max(1,max-min);const x=(index:number)=>padX+(index/Math.max(1,points.length-1))*(width-padX*2);const y=(value:number)=>height-padY-((value-min)/span)*(height-padY*2);const colors=["#31d9f3","#8b5cf6","#16c784","#f5b942"];
 return <ChartCard title={title} subtitle={subtitle}><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} className={styles.svg}>{[0,.25,.5,.75,1].map(step=><line key={step} x1={padX} x2={width-padX} y1={padY+step*(height-padY*2)} y2={padY+step*(height-padY*2)} stroke="rgba(130,151,196,.16)"/>)}{normalizedValues.map((values,seriesIndex)=>{const path=values.map((value,index)=>value==null?null:{x:x(index),y:y(value)}).filter(Boolean) as {x:number;y:number}[];if(!path.length)return null;return <g key={series[seriesIndex].label}><polyline points={path.map(point=>`${point.x},${point.y}`).join(" ")} fill="none" stroke={colors[seriesIndex%colors.length]} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/>{path.map((point,index)=><circle key={index} cx={point.x} cy={point.y} r="3.5" fill={colors[seriesIndex%colors.length]}/>)}</g>})}{points.map((point,index)=><text key={`${point.label}-${index}`} x={x(index)} y={height-5} textAnchor="middle" fontSize="10" fill="#94a3b8">{point.label.length>9?point.label.slice(0,9):point.label}</text>)}</svg><div className={styles.legend}>{series.map((item,index)=><span key={item.label} className="muted" style={{fontSize:11}}><span className={styles.dot} style={{background:colors[index%colors.length]}}/>{item.label}{normalized?" (indexed)":""}</span>)}</div></ChartCard>
}

function PeerBars({title,items,suffix}:{title:string;items:{label:string;value:number}[];suffix:string}){
 if(!items.length)return <EmptyChart title={title}/>;const max=Math.max(...items.map(item=>Math.abs(item.value)),1);
 return <ChartCard title={title}>{items.map(item=><div key={item.label} className={styles.peerRow}><strong style={{fontSize:11}}>{item.label}</strong><div className={styles.track}><div className={item.value>=0?styles.peerFillPositive:styles.peerFillNegative} style={{width:`${Math.abs(item.value)/max*100}%`}}/></div><span style={{fontSize:11,textAlign:"right"}}>{item.value>=0?"+":""}{item.value.toFixed(1)}{suffix}</span></div>)}</ChartCard>
}

function HeatGrid({title,rows}:{title:string;rows:{wacc:number;cells:{growth:number;value:number|null}[]}[]}){
 const values=rows.flatMap(row=>row.cells.map(cell=>cell.value)).filter((value):value is number=>value!=null&&Number.isFinite(value));if(!rows.length||!values.length)return <EmptyChart title={title}/>;
 const min=Math.min(...values),max=Math.max(...values),span=Math.max(.01,max-min);
 return <ChartCard title={title}><div className={styles.tableWrap}><table className={styles.heatTable}><thead><tr><th>WACC \ g</th>{rows[0].cells.map(cell=><th key={cell.growth}>{cell.growth.toFixed(1)}%</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.wacc}><th>{row.wacc.toFixed(1)}%</th>{row.cells.map(cell=>{const ratio=cell.value==null?0:(cell.value-min)/span;return <td key={cell.growth} style={{background:`rgba(79,126,255,${.1+ratio*.55})`}}>{cell.value==null?"—":money(cell.value)}</td>})}</tr>)}</tbody></table></div></ChartCard>
}

function ChartCard({title,subtitle,children}:{title:string;subtitle?:string;children:React.ReactNode}){return <div className={`card ${styles.chartCard}`}><h4>{title}</h4>{subtitle&&<p className={`muted ${styles.subtitle}`}>{subtitle}</p>}{children}</div>}
function EmptyChart({title}:{title:string}){return <div className={`card ${styles.emptyCard}`}><h4 style={{margin:0}}>{title}</h4><div className={styles.empty}>Evidence unavailable for this chart. No synthetic zero series is drawn.</div></div>}
