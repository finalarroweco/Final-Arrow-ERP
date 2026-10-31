import {z} from "zod";
import {dueDate} from "./date";
export const paymentTermsInput=z.object({label:z.string().trim().min(3).max(120),dueDate:dueDate.refine(v=>v>="2000-01-01"&&v<="2099-12-31")}).strict();
export const paymentTermsData=(terms:z.infer<typeof paymentTermsInput>|undefined)=>({paymentTerms:terms?.label??null,paymentDueDate:terms?new Date(terms.dueDate+"T00:00:00Z"):null});
