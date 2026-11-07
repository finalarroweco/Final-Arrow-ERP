import {OperationalRecordPage,type RecordQuery} from "../../operations/record-page";
export default function Page({searchParams}:{searchParams:RecordQuery}){return <OperationalRecordPage kind="ticket" searchParams={searchParams}/>;}
