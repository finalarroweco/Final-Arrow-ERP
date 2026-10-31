import {SourceAgingPage,type AgingSearch} from "../../reports/source-aging";
export default function Page({searchParams}:{searchParams:AgingSearch}){return <SourceAgingPage kind="customer" overdue searchParams={searchParams}/>;}
