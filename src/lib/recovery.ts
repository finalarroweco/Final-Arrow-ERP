import {createHash,randomBytes} from "node:crypto";
export const recoveryHash=(code:string)=>createHash("sha256").update(`erp-recovery:${code}`).digest("hex");
export function normalizeRecoveryCode(code:string){const normalized=code.replace(/[\s-]/g,"").toLowerCase();return /^[0-9a-f]{32}$/.test(normalized)?normalized:null;}
export function makeRecoveryCodes(){return Array.from({length:10},()=>{const raw=randomBytes(16).toString("hex");return {code:raw.match(/.{4}/g)!.join("-"),codeHash:recoveryHash(raw)};});}
export const recoveryHeaders={"Cache-Control":"no-store","Referrer-Policy":"no-referrer"};
