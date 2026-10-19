"use client";
export function PrintReceipt({label}:{label:string}){return <button className="no-print" onClick={()=>window.print()}>{label}</button>;}
