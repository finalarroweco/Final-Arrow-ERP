import {SalesDocument} from "../../document";
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <SalesDocument id={id} kind="quotes"/>;}
