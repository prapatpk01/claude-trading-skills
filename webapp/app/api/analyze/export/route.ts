import {NextRequest,NextResponse} from "next/server";
import ExcelJS from "exceljs";

export const runtime="nodejs";
export const dynamic="force-dynamic";

type Sheet={name:string;headers:string[];rows:(string|number|null)[][]};

function safeTicker(value:unknown){const ticker=String(value??"").trim().toUpperCase();return /^[A-Z.\-]{1,10}$/.test(ticker)?ticker:"REPORT"}
function validSheets(value:unknown):Sheet[]{
 if(!Array.isArray(value))return[];
 return value.filter((sheet:any)=>sheet&&typeof sheet.name==="string"&&Array.isArray(sheet.headers)&&Array.isArray(sheet.rows)).slice(0,12).map((sheet:any)=>({name:String(sheet.name).slice(0,31),headers:sheet.headers.map((x:any)=>String(x)).slice(0,30),rows:sheet.rows.slice(0,500).map((row:any)=>Array.isArray(row)?row.slice(0,30).map((cell:any)=>typeof cell==="number"&&Number.isFinite(cell)?cell:cell==null?null:String(cell)):[])}));
}

export async function POST(req:NextRequest){
 try{
  const body=await req.json();const ticker=safeTicker(body?.ticker);const sheets=validSheets(body?.sheets);
  if(!sheets.length)return NextResponse.json({error:"No export sheets supplied"},{status:400});
  const workbook=new ExcelJS.Workbook();workbook.creator="Sentinel Investment OS";workbook.company="Sentinel Investment";workbook.created=new Date();
  for(const sheet of sheets){
   const ws=workbook.addWorksheet(sheet.name,{views:[{state:"frozen",ySplit:1}]});
   ws.addRow(sheet.headers);for(const row of sheet.rows)ws.addRow(row);
   const header=ws.getRow(1);header.font={bold:true,color:{argb:"FFFFFFFF"}};header.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF172554"}};header.alignment={vertical:"middle",horizontal:"center"};header.height=24;
   ws.columns=sheet.headers.map((headerName,index)=>{const lengths=[headerName.length,...sheet.rows.slice(0,100).map(row=>String(row[index]??"").length)];return{width:Math.min(42,Math.max(12,Math.max(...lengths)+2))}});
   ws.autoFilter={from:{row:1,column:1},to:{row:1,column:Math.max(1,sheet.headers.length)}};
   ws.eachRow((row,rowNumber)=>{if(rowNumber>1&&rowNumber%2===0)row.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFF3F6FB"}}});
  }
  const buffer=await workbook.xlsx.writeBuffer();
  return new NextResponse(Buffer.from(buffer),{status:200,headers:{"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename="Sentinel_${ticker}_Institutional_Research.xlsx"`,"Cache-Control":"no-store"}});
 }catch(error:unknown){return NextResponse.json({error:error instanceof Error?error.message:"Export failed"},{status:500})}
}
