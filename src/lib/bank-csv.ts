export type BankCsvLine={bookingDate:string;reference:string;amount:string};
export function parseBankCsv(raw:string):BankCsvLine[]{
 if(raw.length>180000)throw new Error("CSV exceeds 180000 characters");
 const input=raw.replace(/^\uFEFF/,""),rows:string[][]=[];let row:string[]=[],field="",quoted=false,closed=false;
 const endField=()=>{row.push(field);field="";closed=false;};
 const endRow=()=>{endField();if(row.some(v=>v.trim()!==""))rows.push(row);row=[];if(rows.length>501)throw new Error("Maximum 500 bank movements");};
 for(let i=0;i<input.length;i++){
  const c=input[i];
  if(quoted){if(c==='"'){if(input[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
  if(c===','){endField();continue;}
  if(c==='\n'||c==='\r'){if(c==='\r'&&input[i+1]==='\n')i++;endRow();continue;}
  if(closed){if(c===' '||c==='\t')continue;throw new Error("Unexpected character after quoted CSV field");}
  if(c==='"'){if(field.length)throw new Error("Quote inside an unquoted CSV field");quoted=true;}else field+=c;
 }
 if(quoted)throw new Error("Unclosed CSV quote");if(field.length||row.length||closed)endRow();
 if(!rows.length||rows[0].map(v=>v.trim()).join(",")!=="date,reference,amount"||rows[0].length!==3)throw new Error("CSV header must be date,reference,amount");
 return rows.slice(1).map((r,index)=>{if(r.length!==3)throw new Error(`CSV row ${index+2} must have three fields`);const [bookingDate,reference,amount]=r.map(v=>v.trim());return {bookingDate,reference,amount};});
}
